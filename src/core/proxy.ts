/**
 * pxpipe proxy as a single Web-standard fetch handler.
 * Adapted by src/node.ts and src/worker.ts; uses only Request/Response/URL/fetch.
 */

import { transformRequest, type TransformOptions, type TransformInfo } from './transform.js';
import { isClaudeModel, isGrokModel, transformOpenAIChatCompletions, transformOpenAIResponses } from './openai.js';
import { isAnthropicMessagesPath, isPxpipeSupportedGptModel, isPxpipeSupportedModel, minCompressBodyBytes } from './applicability.js';
import {
  buildBaselineCountTokensBody,
  buildCacheablePrefixCountTokensBody,
} from './measurement.js';
import type { Usage } from './types.js';

export type BillingLane =
  | 'agy_ultra_subscription'
  | 'claude_max_subscription'
  | 'codex_subscription'
  | 'nvidia_build_free'
  | 'api_key'
  | 'local'
  | 'unknown';

export type BillingLaneSource =
  | 'configured_route'
  | 'agy_bridge_origin'
  | 'anthropic_oauth_marker'
  | 'chatgpt_codex_origin'
  | 'api_key'
  | 'local_origin'
  | 'unresolved';

export interface ProxyConfig {
  /** 'cloudflare-ai-gateway': routes both families through gatewayBaseUrl;
   *  OpenAI paths drop the `/v1` prefix to match gateway shape. */
  provider?: 'cloudflare-ai-gateway';
  /** Gateway base URL (account/gateway-scoped). Required when provider is set. */
  gatewayBaseUrl?: string;
  /** Extra headers injected on every upstream request (e.g. gateway auth). */
  gatewayHeaders?: Record<string, string>;
  /** Anthropic API base, no trailing slash. Defaults to api.anthropic.com. */
  upstream?: string;
  /** Override or supply an API key. If unset, we forward whatever the client sent. */
  apiKey?: string;
  /** OpenAI API base for GPT chat completions, no trailing slash. */
  openAIUpstream?: string;
  /** xAI API base for Grok models on OpenAI-shaped paths. Defaults to api.x.ai.
   *  Selected per-request when the body model is grok-* so Codex can keep
   *  OPENAI_UPSTREAM=chatgpt.com/backend-api/codex without stealing Grok traffic. */
  xaiUpstream?: string;
  /** Override or supply an OpenAI API key. If unset, we forward Authorization. */
  openAIApiKey?: string;
  /** xAI API key / OAuth JWT injected for all grok-* models.
   *  This replaces whatever the client sent so that Codex/ChatGPT tokens
   *  never reach api.x.ai. The operator must provide a real xAI credential. */
  xaiApiKey?: string;
  /** Trusted route-level billing attribution. Never derived from model names. */
  billingLanes?: Partial<Record<'anthropic' | 'openai' | 'passthrough', BillingLane>>;
  /** Pass a function to inject dynamic values per-request (e.g. live charsPerToken);
   *  static object for Workers/tests. */
  transform?: TransformOptions | (() => TransformOptions);
  /** Debug-only: retain the full transformed request body on upstream 4xx.
   *  Disabled by default because coding-agent requests can contain credentials,
   *  source code, and other sensitive operator context. */
  captureRequestBodiesOn4xx?: boolean;
  /** Called after every request — useful for logging / metrics in the host. */
  onRequest?: (event: ProxyEvent) => void | Promise<void>;
}

export interface ProxyEvent {
  method: string;
  path: string;
  /** Top-level request model when present. Used for telemetry/dashboard labels only. */
  model?: string;
  /** Model requested by the client before gateway aliases or fallback routing. */
  requestedModel?: string;
  /** Model identity reported by the successful upstream response. */
  actualModel?: string;
  billingLane: BillingLane;
  billingLaneSource: BillingLaneSource;
  /** Provider rate-limit headers observed on the upstream response. Values are
   * retained verbatim because providers use both durations and timestamps. */
  rateLimit?: RateLimitTelemetry;
  status: number;
  /** Wall-clock ms from request start to event fire (≈ end of upstream body). */
  durationMs: number;
  /** Wall-clock ms from request start to upstream response headers. */
  firstByteMs?: number;
  /** Upstream response media type, retained to diagnose usage scanner coverage. */
  responseContentType?: string;
  /** Whether response usage scanning completed, degraded, or was intentionally skipped. */
  usageScanStatus?: UsageScanStatus;
  /** Safe scanner failure category. Never contains response content. */
  usageScanError?: string;
  /** True when the scanner observed a provider terminal event or sentinel. */
  usageTerminalEventSeen?: boolean;
  /** Number of JSON SSE events parsed successfully. */
  usageSseEventCount?: number;
  /** Number of malformed SSE data payloads encountered. */
  usageParseErrorCount?: number;
  info?: TransformInfo;
  /** Usage block from Anthropic's response — input/output/cache tokens. */
  usage?: Usage;
  /** Model stop reason from the response ("end_turn", "tool_use", "max_tokens",
   *  "refusal", …). "refusal" = safety classifier fired on the transformed request —
   *  scorers must fail cost comparisons on refusal rows (refusals emit almost no
   *  output and would otherwise look "cheaper"). OpenAI finish_reason ("stop",
   *  "length", "content_filter", …) is normalized into the same field. */
  stopReason?: string;
  error?: string;
  /** First ~2 KiB of the upstream 4xx body (not captured on 2xx or 5xx). */
  errorBody?: string;
  /** sha256[0..8] of the transformed outgoing body — set on every /v1/messages POST for correlation. */
  reqBodySha8?: string;
  /** Gzipped transformed body, populated only on 4xx when explicitly enabled.
   *  Node may write to sidecar (see reqBodySamplePath). */
  reqBodyGz?: Uint8Array;
  /** Set by the Node host instead of reqBodyGz when the body was written to a sidecar file. */
  reqBodySamplePath?: string;
  /** Ground-truth char counts from the response stream, independent of usage.output_tokens.
   *  Absent when the body couldn't be scanned (5xx, unknown content-type). See OutputMeasurement. */
  measurement?: OutputMeasurement;
}

export interface RateLimitTelemetry {
  retryAfter?: string;
  requestLimit?: string;
  requestRemaining?: string;
  requestReset?: string;
  tokenLimit?: string;
  tokenRemaining?: string;
  tokenReset?: string;
}

function readRateLimitTelemetry(headers: Headers): RateLimitTelemetry | undefined {
  const first = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = headers.get(name);
      if (value !== null && value.trim() !== '') return value.trim();
    }
    return undefined;
  };
  const out: RateLimitTelemetry = {
    retryAfter: first('retry-after'),
    requestLimit: first('anthropic-ratelimit-requests-limit', 'x-ratelimit-limit-requests', 'ratelimit-limit'),
    requestRemaining: first('anthropic-ratelimit-requests-remaining', 'x-ratelimit-remaining-requests', 'ratelimit-remaining'),
    requestReset: first('anthropic-ratelimit-requests-reset', 'x-ratelimit-reset-requests', 'ratelimit-reset'),
    tokenLimit: first('anthropic-ratelimit-tokens-limit', 'x-ratelimit-limit-tokens'),
    tokenRemaining: first('anthropic-ratelimit-tokens-remaining', 'x-ratelimit-remaining-tokens'),
    tokenReset: first('anthropic-ratelimit-tokens-reset', 'x-ratelimit-reset-tokens'),
  };
  return Object.values(out).some((value) => value !== undefined) ? out : undefined;
}

/** Max chars of 4xx error body captured on ProxyEvent — enough for Anthropic's full error JSON. */
const ERROR_BODY_MAX = 2048;

/** Read the top-level `model` field from a /v1/messages body without parsing the full JSON.
 *  Returns null when not found — callers treat null as outside supported scope (fail-closed). */
function readModelField(body: Uint8Array): string | null {
  try {
    const text = new TextDecoder().decode(body.subarray(0, 131072));
    const m = /"model"\s*:\s*"([^"]{1,80})"/.exec(text);
    if (m) return m[1]!;
    const j = JSON.parse(text) as { model?: unknown };
    return typeof j?.model === 'string' ? j.model : null;
  } catch {
    return null;
  }
}

/** Gzip via CompressionStream — available in Node 18+ and Cloudflare Workers. */
async function gzipBytes(body: Uint8Array): Promise<Uint8Array> {
  // Cast: TS doesn't model Response(Uint8Array) even though it works in both runtimes.
  const stream = new Response(body as BufferSource).body!.pipeThrough(
    new CompressionStream('gzip'),
  );
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** sha256[0..8] hex of a byte buffer. */
async function sha8Bytes(body: Uint8Array): Promise<string> {
  // Cast: Web Crypto accepts Uint8Array at runtime despite the BufferSource type.
  const digest = await crypto.subtle.digest('SHA-256', body as BufferSource);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 4; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Ground-truth char counts from the response stream, independent of usage.output_tokens.
 * redactedBlockCount blocks are opaque server bytes — no char count available for those.
 */
export interface OutputMeasurement {
  textChars: number;
  thinkingChars: number;
  toolUseChars: number;
  redactedBlockCount: number;
}

export type UsageScanStatus =
  | 'complete'
  | 'no_usage'
  | 'partial_stream_error'
  | 'partial_parse_error'
  | 'invalid_json'
  | 'unsupported_content_type'
  | 'no_body'
  | 'skipped_client_error'
  | 'skipped_server_error';

interface UsageScanState {
  usage: Usage | undefined;
  actualModel: string | undefined;
  stopReason: string | undefined;
  terminalEventSeen: boolean;
  sseEventCount: number;
  parseErrorCount: number;
}

function readResponseModel(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.model === 'string' && obj.model.trim() !== '') return obj.model;
  const response = obj.response as { model?: unknown } | undefined;
  if (typeof response?.model === 'string' && response.model.trim() !== '') return response.model;
  const message = obj.message as { model?: unknown } | undefined;
  if (typeof message?.model === 'string' && message.model.trim() !== '') return message.model;
  return undefined;
}

/** Parse one SSE block into the running usage + measurement accumulators. Silent on malformed input. */
function processSseEvent(
  block: string,
  m: OutputMeasurement,
  state: UsageScanState,
): void {
  // Parse `event:` + `data:` lines; continuation data: lines concatenate per SSE spec.
  let event = '';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^\s/, ''));
  }
  if (dataLines.length === 0) return;
  const data = dataLines.join('');
  if (data.trim() === '[DONE]') {
    state.terminalEventSeen = true;
    return;
  }
  let j: unknown;
  try {
    j = JSON.parse(data);
  } catch {
    // Some compatible gateways coalesce one-JSON-object-per-data-line streams
    // without blank SSE separators. Recover each complete line independently.
    if (dataLines.length > 1) {
      for (const dataLine of dataLines) {
        processSseEvent(`${event ? `event: ${event}\n` : ''}data: ${dataLine}`, m, state);
      }
    } else {
      state.parseErrorCount += 1;
    }
    return;
  }
  state.sseEventCount += 1;
  const obj = j as Record<string, unknown>;
  const responseModel = readResponseModel(obj);
  if (responseModel) state.actualModel = responseModel;
  // OpenAI Responses streams commonly carry the discriminator only in JSON.
  // Prefer the explicit SSE event name when present, otherwise use `type`.
  if (!event && typeof obj.type === 'string') event = obj.type;

  // OpenAI chunks have no `event:` line; usage only present when stream_options.include_usage is set.
  const openAIUsage = normalizeUsage((obj as { usage?: unknown }).usage);
  if (openAIUsage) state.usage = openAIUsage;
  // OpenAI Responses API streams usage nested under `response` on the terminal
  // `response.completed` (or `.incomplete`) event — not at the top level.
  if (event === 'response.completed' || event === 'response.incomplete') {
    state.terminalEventSeen = true;
    const resp = obj.response as
      | { usage?: unknown; incomplete_details?: { reason?: unknown } }
      | undefined;
    const respUsage = normalizeUsage(resp?.usage);
    if (respUsage) state.usage = respUsage;
    // Responses API has no stop_reason; normalize the terminal status/reason instead.
    const reason = resp?.incomplete_details?.reason;
    state.stopReason = typeof reason === 'string' ? reason
      : event === 'response.incomplete' ? 'incomplete' : 'stop';
  }
  if (event === 'response.output_text.delta' && typeof obj.delta === 'string') {
    m.textChars += obj.delta.length;
  } else if (
    (event === 'response.reasoning_summary_text.delta' || event === 'response.reasoning_text.delta') &&
    typeof obj.delta === 'string'
  ) {
    m.thinkingChars += obj.delta.length;
  } else if (event === 'response.function_call_arguments.delta' && typeof obj.delta === 'string') {
    m.toolUseChars += obj.delta.length;
  }
  measureOpenAIChoices(obj, m);
  // OpenAI chat chunks: the final chunk carries choices[].finish_reason (earlier chunks ship null).
  const choices = obj.choices;
  if (Array.isArray(choices)) {
    for (const c of choices) {
      const fr = (c as { finish_reason?: unknown } | undefined)?.finish_reason;
      if (typeof fr === 'string') state.stopReason = fr;
      if (typeof fr === 'string') state.terminalEventSeen = true;
    }
  }

  if (event === 'message_start') {
    const msg = obj.message as { usage?: Usage } | undefined;
    const usage = normalizeUsage(msg?.usage);
    if (usage) state.usage = usage;
  } else if (event === 'content_block_start') {
    const cb = obj.content_block as { type?: string } | undefined;
    if (cb?.type === 'redacted_thinking') m.redactedBlockCount += 1;
  } else if (event === 'content_block_delta') {
    const d = obj.delta as
      | { type?: string; text?: string; thinking?: string; partial_json?: string }
      | undefined;
    if (d?.type === 'text_delta' && typeof d.text === 'string') {
      m.textChars += d.text.length;
    } else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string') {
      m.thinkingChars += d.thinking.length;
    } else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
      m.toolUseChars += d.partial_json.length;
    }
  } else if (event === 'message_delta') {
    // Anthropic ships the final stop_reason here ("end_turn", "refusal", …).
    const d = obj.delta as { stop_reason?: unknown } | undefined;
    if (typeof d?.stop_reason === 'string') state.stopReason = d.stop_reason;
    // Authoritative final output_tokens; merge over message_start (which ships output_tokens: 1).
    const u = obj.usage as Partial<Usage> | undefined;
    if (u) {
      if (!state.usage) state.usage = {} as Usage;
      const cur = state.usage;
      if (typeof u.output_tokens === 'number') cur.output_tokens = u.output_tokens;
      if (typeof u.input_tokens === 'number' && cur.input_tokens === undefined) {
        cur.input_tokens = u.input_tokens;
      }
      if (typeof u.cache_creation_input_tokens === 'number') {
        cur.cache_creation_input_tokens = u.cache_creation_input_tokens;
      }
      if (typeof u.cache_read_input_tokens === 'number') {
        cur.cache_read_input_tokens = u.cache_read_input_tokens;
      }
    }
  } else if (event === 'message_stop') {
    state.terminalEventSeen = true;
  }
}

function normalizeUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const out: Usage = {};

  if (typeof u.input_tokens === 'number') out.input_tokens = u.input_tokens;
  if (typeof u.output_tokens === 'number') out.output_tokens = u.output_tokens;
  if (typeof u.cache_creation_input_tokens === 'number') {
    out.cache_creation_input_tokens = u.cache_creation_input_tokens;
  }
  if (typeof u.cache_read_input_tokens === 'number') {
    out.cache_read_input_tokens = u.cache_read_input_tokens;
  }
  if (typeof u.cache_creation === 'object' && u.cache_creation !== null) {
    out.cache_creation = u.cache_creation as Usage['cache_creation'];
  }
  if (typeof u.server_tool_use === 'object' && u.server_tool_use !== null) {
    out.server_tool_use = u.server_tool_use as Usage['server_tool_use'];
  }

  // OpenAI field aliases.
  if (typeof u.prompt_tokens === 'number') out.input_tokens = u.prompt_tokens;
  if (typeof u.completion_tokens === 'number') out.output_tokens = u.completion_tokens;
  // OpenAI prompt-cache hits live in a details sub-object: Responses uses
  // `input_tokens_details.cached_tokens`, Chat uses `prompt_tokens_details`.
  const details =
    (u.input_tokens_details as Record<string, unknown> | undefined) ??
    (u.prompt_tokens_details as Record<string, unknown> | undefined);
  if (details && typeof details.cached_tokens === 'number') {
    out.cached_tokens = details.cached_tokens;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function measureOpenAIChoices(obj: Record<string, unknown>, m: OutputMeasurement): void {
  const choices = obj.choices;
  if (!Array.isArray(choices)) return;
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const c = choice as { delta?: unknown; message?: unknown };
    const payload = (c.delta ?? c.message) as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') continue;
    if (typeof payload.content === 'string') m.textChars += payload.content.length;
    const toolCalls = payload.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const fn = (tc as { function?: unknown } | undefined)?.function;
        const args = (fn as { arguments?: unknown } | undefined)?.arguments;
        if (typeof args === 'string') m.toolUseChars += args.length;
      }
    }
  }
}

/** Measure non-streaming messages.content[] — same OutputMeasurement shape as the SSE accumulator. */
function measureFromMessageJson(j: unknown): OutputMeasurement {
  const m: OutputMeasurement = { textChars: 0, thinkingChars: 0, toolUseChars: 0, redactedBlockCount: 0 };
  if (j && typeof j === 'object') measureOpenAIChoices(j as Record<string, unknown>, m);
  const content = (j as { content?: unknown })?.content;
  if (!Array.isArray(content)) return m;
  for (const block of content) {
    const b = block as { type?: string; text?: unknown; thinking?: unknown; input?: unknown };
    if (b?.type === 'text' && typeof b.text === 'string') {
      m.textChars += b.text.length;
    } else if (b?.type === 'thinking' && typeof b.thinking === 'string') {
      m.thinkingChars += b.thinking.length;
    } else if (b?.type === 'redacted_thinking') {
      m.redactedBlockCount += 1;
    } else if (b?.type === 'tool_use') {
      try {
        m.toolUseChars += JSON.stringify(b.input ?? {}).length;
      } catch {
        /* circular / unserialisable input — leave the counter as-is */
      }
    }
  }
  return m;
}

/** Stop reason from a non-streaming response JSON: Anthropic `stop_reason`,
 *  OpenAI chat `choices[].finish_reason`, Responses `incomplete_details.reason`. */
function readStopReasonFromJson(j: unknown): string | undefined {
  if (!j || typeof j !== 'object') return undefined;
  const obj = j as {
    stop_reason?: unknown;
    choices?: unknown;
    status?: unknown;
    incomplete_details?: { reason?: unknown };
  };
  if (typeof obj.stop_reason === 'string') return obj.stop_reason;
  if (Array.isArray(obj.choices)) {
    for (const c of obj.choices) {
      const fr = (c as { finish_reason?: unknown } | undefined)?.finish_reason;
      if (typeof fr === 'string') return fr;
    }
  }
  if (obj.status === 'incomplete') {
    const reason = obj.incomplete_details?.reason;
    return typeof reason === 'string' ? reason : 'incomplete';
  }
  return undefined;
}

/**
 * Tee the response body to extract usage + output measurement without blocking the client.
 * Streams are scanned to EOF (final output_tokens is in message_delta; redacted_thinking
 * blocks can appear anywhere). 4xx bodies are capped at ERROR_BODY_MAX. 5xx is skipped.
 */
function teeForUsage(res: Response): {
  response: Response;
  usagePromise: Promise<Usage | undefined>;
  actualModelPromise: Promise<string | undefined>;
  errorBodyPromise: Promise<string | undefined>;
  measurementPromise: Promise<OutputMeasurement | undefined>;
  stopReasonPromise: Promise<string | undefined>;
  scanStatusPromise: Promise<UsageScanStatus>;
  scanErrorPromise: Promise<string | undefined>;
  terminalEventSeenPromise: Promise<boolean | undefined>;
  sseEventCountPromise: Promise<number | undefined>;
  parseErrorCountPromise: Promise<number | undefined>;
} {
  // No body at all: nothing to extract on either path.
  if (!res.body) {
    return {
      response: res,
      usagePromise: Promise.resolve(undefined),
      actualModelPromise: Promise.resolve(undefined),
      errorBodyPromise: Promise.resolve(undefined),
      measurementPromise: Promise.resolve(undefined),
      stopReasonPromise: Promise.resolve(undefined),
      scanStatusPromise: Promise.resolve('no_body'),
      scanErrorPromise: Promise.resolve(undefined),
      terminalEventSeenPromise: Promise.resolve(undefined),
      sseEventCountPromise: Promise.resolve(undefined),
      parseErrorCountPromise: Promise.resolve(undefined),
    };
  }
  // 4xx: tee for the error body but skip usage scanning entirely.
  if (res.status >= 400 && res.status < 500) {
    const [forClient, forUs] = res.body.tee();
    const errorBodyPromise = (async (): Promise<string | undefined> => {
      const reader = forUs.getReader();
      const decoder = new TextDecoder();
      let out = '';
      try {
        while (out.length < ERROR_BODY_MAX) {
          const { done, value } = await reader.read();
          if (done) break;
          out += decoder.decode(value, { stream: true });
        }
        out += decoder.decode();
        // Drain the rest so the tee buffer doesn't hold the stream open.
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        /* client may have aborted */
      }
      return out.length > ERROR_BODY_MAX ? out.slice(0, ERROR_BODY_MAX) : out;
    })();
    return {
      response: new Response(forClient, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      }),
      usagePromise: Promise.resolve(undefined),
      actualModelPromise: Promise.resolve(undefined),
      errorBodyPromise,
      measurementPromise: Promise.resolve(undefined),
      stopReasonPromise: Promise.resolve(undefined),
      scanStatusPromise: Promise.resolve('skipped_client_error'),
      scanErrorPromise: Promise.resolve(undefined),
      terminalEventSeenPromise: Promise.resolve(undefined),
      sseEventCountPromise: Promise.resolve(undefined),
      parseErrorCountPromise: Promise.resolve(undefined),
    };
  }
  // 5xx: skip both (the host already synthesizes an error message).
  if (res.status >= 500) {
    return {
      response: res,
      usagePromise: Promise.resolve(undefined),
      actualModelPromise: Promise.resolve(undefined),
      errorBodyPromise: Promise.resolve(undefined),
      measurementPromise: Promise.resolve(undefined),
      stopReasonPromise: Promise.resolve(undefined),
      scanStatusPromise: Promise.resolve('skipped_server_error'),
      scanErrorPromise: Promise.resolve(undefined),
      terminalEventSeenPromise: Promise.resolve(undefined),
      sseEventCountPromise: Promise.resolve(undefined),
      parseErrorCountPromise: Promise.resolve(undefined),
    };
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  const [forClient, forUs] = res.body.tee();

  // Single read loop resolves all three; exposed as separate promises for call-site readability.
  const scanResult = (async (): Promise<{
    usage: Usage | undefined;
    actualModel: string | undefined;
    measurement: OutputMeasurement | undefined;
    stopReason: string | undefined;
    scanStatus: UsageScanStatus;
    scanError: string | undefined;
    terminalEventSeen: boolean | undefined;
    sseEventCount: number | undefined;
    parseErrorCount: number | undefined;
  }> => {
    const reader = forUs.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const m: OutputMeasurement = {
      textChars: 0,
      thinkingChars: 0,
      toolUseChars: 0,
      redactedBlockCount: 0,
    };
    const state: UsageScanState = {
      usage: undefined,
      actualModel: undefined,
      stopReason: undefined,
      terminalEventSeen: false,
      sseEventCount: 0,
      parseErrorCount: 0,
    };
    let mode: 'sse' | 'json' | 'unsupported' = ct.includes('text/event-stream')
      ? 'sse'
      : ct.includes('application/json')
        ? 'json'
        : 'unsupported';

    try {
      if (ct === '' && res.status >= 200 && res.status < 300) {
        const first = await reader.read();
        if (!first.done && first.value) buf += decoder.decode(first.value, { stream: true });
        const prefix = buf.trimStart();
        mode = prefix.startsWith('{') || prefix.startsWith('[') ? 'json' : 'sse';
      }

      if (mode === 'sse') {
        // Walk every SSE event to EOF — message_delta (final output_tokens) is last.
        const processBufferedEvents = (): void => {
          let boundary: RegExpExecArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(buf)) !== null) {
            const block = buf.slice(0, boundary.index);
            buf = buf.slice(boundary.index + boundary[0].length);
            processSseEvent(block, m, state);
          }
        };
        while (true) {
          // Headerless streams are sniffed by reading one chunk above. Parse it
          // before the next read so a late transport error cannot erase a
          // terminal event that is already buffered locally.
          processBufferedEvents();
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
        }
        buf += decoder.decode();
        processBufferedEvents();
        if (buf.trim().length > 0) processSseEvent(buf, m, state); // trailing partial event
        const scanStatus: UsageScanStatus = state.parseErrorCount > 0
          ? 'partial_parse_error'
          : state.usage
            ? 'complete'
            : 'no_usage';
        return {
          usage: state.usage,
          actualModel: state.actualModel,
          measurement: m,
          stopReason: state.stopReason,
          scanStatus,
          scanError: state.parseErrorCount > 0 ? 'malformed_sse_data' : undefined,
          terminalEventSeen: state.terminalEventSeen,
          sseEventCount: state.sseEventCount,
          parseErrorCount: state.parseErrorCount,
        };
      }

      if (mode === 'json') {
        // Buffer fully, capped at 4 MiB.
        const MAX = 4 * 1024 * 1024;
        while (buf.length < MAX) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
        }
        buf += decoder.decode();
        try {
          const j = JSON.parse(buf);
          const usage = normalizeUsage(j?.usage);
          const actualModel = j && typeof j === 'object'
            ? readResponseModel(j as Record<string, unknown>)
            : undefined;
          return {
            usage,
            actualModel,
            measurement: measureFromMessageJson(j),
            stopReason: readStopReasonFromJson(j),
            scanStatus: usage ? 'complete' : 'no_usage',
            scanError: undefined,
            terminalEventSeen: true,
            sseEventCount: undefined,
            parseErrorCount: undefined,
          };
        } catch {
          return {
            usage: undefined,
            actualModel: undefined,
            measurement: undefined,
            stopReason: undefined,
            scanStatus: 'invalid_json',
            scanError: 'invalid_json',
            terminalEventSeen: undefined,
            sseEventCount: undefined,
            parseErrorCount: undefined,
          };
        }
      }
    } catch (error) {
      // A provider can deliver the terminal usage event and then fail while the
      // tee drains. Preserve everything already parsed instead of erasing it.
      return {
        usage: state.usage,
        actualModel: state.actualModel,
        measurement: mode === 'sse' ? m : undefined,
        stopReason: state.stopReason,
        scanStatus: 'partial_stream_error',
        scanError: error instanceof Error ? error.name : 'stream_read_error',
        terminalEventSeen: mode === 'sse' ? state.terminalEventSeen : undefined,
        sseEventCount: mode === 'sse' ? state.sseEventCount : undefined,
        parseErrorCount: mode === 'sse' ? state.parseErrorCount : undefined,
      };
    }
    // Unknown content-type: drain to release the tee buffer.
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      /* ignore */
    }
    return {
      usage: undefined,
      actualModel: undefined,
      measurement: undefined,
      stopReason: undefined,
      scanStatus: 'unsupported_content_type',
      scanError: undefined,
      terminalEventSeen: undefined,
      sseEventCount: undefined,
      parseErrorCount: undefined,
    };
  })();

  return {
    response: new Response(forClient, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    }),
    usagePromise: scanResult.then((s) => s.usage),
    actualModelPromise: scanResult.then((s) => s.actualModel),
    errorBodyPromise: Promise.resolve(undefined),
    measurementPromise: scanResult.then((s) => s.measurement),
    stopReasonPromise: scanResult.then((s) => s.stopReason),
    scanStatusPromise: scanResult.then((s) => s.scanStatus),
    scanErrorPromise: scanResult.then((s) => s.scanError),
    terminalEventSeenPromise: scanResult.then((s) => s.terminalEventSeen),
    sseEventCountPromise: scanResult.then((s) => s.sseEventCount),
    parseErrorCountPromise: scanResult.then((s) => s.parseErrorCount),
  };
}

const DEFAULT_UPSTREAM = 'https://api.anthropic.com';
const DEFAULT_OPENAI_UPSTREAM = 'https://api.openai.com';
const DEFAULT_XAI_UPSTREAM = 'https://api.x.ai';

/** Headers we strip on the way out — they're hop-by-hop or proxy-injected. */
const STRIP_REQ_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'content-length', // we recompute
  'expect',
  'accept-encoding', // let upstream choose
]);

const STRIP_RES_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // we don't re-encode
  'content-length',   // body may differ after streaming
]);

function filterHeaders(src: Headers, strip: Set<string>): Headers {
  const out = new Headers();
  src.forEach((v, k) => {
    if (!strip.has(k.toLowerCase())) out.append(k, v);
  });
  return out;
}

const PASSTHROUGH_PREFIXES = [
  '/anthropic/',
  '/openai/',
  '/google-ai-studio/',
  '/compat/',
  '/xai/',
  '/agy/',
  '/lmstudio/',
  '/nim/',
] as const;

function isProviderPrefixedPath(pathname: string): boolean {
  return PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isOpenAIChatPath(pathname: string): boolean {
  return pathname === '/v1/chat/completions' || pathname === '/openai/v1/chat/completions';
}

function isOpenAIResponsesPath(pathname: string): boolean {
  return pathname === '/v1/responses'
    || pathname === '/openai/v1/responses'
    || pathname === '/openai/responses';
}

/** True when the client's Authorization bearer is unambiguously an Anthropic
 *  credential. `/v1/models` is served by BOTH providers, so the only usable
 *  routing signal is the credential itself. Treating any bearer as "OpenAI"
 *  sends `sk-ant-*` keys to the OpenAI upstream, which forwards them verbatim
 *  (no proxy key to overwrite with) and 401s with
 *  `Incorrect API key provided: sk-ant-…`. Observed 8× in events.jsonl. */
function isAnthropicBearer(headers: Headers): boolean {
  const auth = headers.get('authorization');
  if (!auth) return false;
  return /^bearer\s+sk-ant-/i.test(auth.trim());
}

function isCanonicalOpenAIPath(pathname: string, headers: Headers, hasOpenAIKey: boolean): boolean {
  const isModelsPath = pathname === '/v1/models' || pathname.startsWith('/v1/models/');
  // `hasOpenAIKey` stays an independent signal: in that case the proxy REPLACES
  // the client's Authorization with its own OpenAI key, so the client's
  // credential shape is irrelevant. The client-bearer signal is only trusted
  // when the credential is not visibly Anthropic.
  const clientBearerLooksOpenAI = headers.has('authorization')
    && !headers.has('x-api-key')
    && !isAnthropicBearer(headers);
  const looksOpenAIAuth = hasOpenAIKey || clientBearerLooksOpenAI;
  return pathname === '/v1/chat/completions'
    || pathname === '/v1/responses'
    || pathname.startsWith('/v1/responses/')
    || (isModelsPath && looksOpenAIAuth);
}

/** Headers that identify the CALLER and carry no credential material. */
const CALLER_ID_HEADERS = [
  'user-agent',
  'x-app',
  'x-session-id',
  'x-request-id',
  'anthropic-version',
  'anthropic-beta',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-os',
  'x-stainless-arch',
  'x-stainless-retry-count',
  'openai-organization',
  'openai-project',
  'chatgpt-account-id',
] as const;

/** Credential headers. Values are NEVER emitted — only fingerprinted. */
const CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'cookie', 'proxy-authorization'] as const;

/** 32-bit FNV-1a. Used ONLY to fingerprint credentials so the same key is
 *  recognisable across events without its value ever being written. Lossy by
 *  construction (32 bits for an arbitrary-length secret) — deliberately not a
 *  truncated crypto hash, which would leak materially more about the input. */
function fnv1a8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Compact, redacted caller identity for auth-denial rows (401/403).
 *  Before this, `grep -rn "403" src/` returned zero hits — a 2,581-request 403
 *  burst on gpt-4o had no attributable caller anywhere in the logs. This records
 *  WHO called and WHICH upstream refused them, using only context the request
 *  already carries. Credential values are never emitted. */
function describeAuthDenial(status: number, headers: Headers, upstreamUrl: string): string {
  const parts: string[] = [`auth_denied status=${status}`];
  try {
    parts.push(`upstream=${new URL(upstreamUrl).origin}`);
  } catch {
    /* unparseable upstream — omit rather than guess */
  }
  for (const name of CREDENTIAL_HEADERS) {
    const v = headers.get(name);
    if (v) parts.push(`${name}=<redacted:${fnv1a8(v)}>`);
  }
  for (const name of CALLER_ID_HEADERS) {
    const v = headers.get(name);
    // Truncated and de-delimited so one hostile header cannot bloat or split the row.
    if (v) parts.push(`${name}=${v.slice(0, 80).replace(/[\s|]+/g, ' ')}`);
  }
  return parts.join(' | ');
}

/** Bounded backoff shared by the count_tokens probe and the main upstream
 *  forward. Both replay ONLY requests whose body is a replayable buffer, and
 *  ONLY for statuses that mean "rejected before processing" — so a replay can
 *  never duplicate work the upstream already performed. */
const RETRY_BASE_DELAY_MS = 250;
/** Longest single sleep for the main forward. A Retry-After longer than this is
 *  honoured by NOT retrying (see retryDelayMs) rather than by under-waiting. */
const FORWARD_MAX_DELAY_MS = 8_000;
/** Main forward: 2 retries = 3 attempts worst case. */
const FORWARD_MAX_RETRIES = 2;
/** The probe only gates telemetry and finalize() awaits it — keep it cheap. */
const PROBE_MAX_RETRIES = 1;
const PROBE_MAX_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse Retry-After: either delta-seconds or an HTTP-date. Returns ms, or null
 *  when the header is absent/unparseable. Never returns a negative delay. */
function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    return Number.isFinite(secs) ? secs * 1000 : null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/** Delay before the next attempt, or null meaning "do not retry".
 *  When the upstream supplies Retry-After we obey it exactly; if it asks for
 *  longer than our budget we STOP and surface the 429 rather than retrying
 *  early and hammering a provider that just told us to back off.
 *  Without Retry-After: exponential with FULL jitter (spreads a thundering herd
 *  of concurrent agents instead of re-synchronising them). `attempt` is 0-based. */
function retryDelayMs(attempt: number, retryAfterMs: number | null, maxDelayMs: number): number | null {
  if (retryAfterMs !== null) return retryAfterMs > maxDelayMs ? null : retryAfterMs;
  const ceiling = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, maxDelayMs);
  return Math.random() * ceiling;
}

/** POST /v1/messages/count_tokens with the given body. Returns the upstream's
 *  `input_tokens` number or null on any failure. count_tokens is documented
 *  as a free endpoint (no input-token billing) — we use it once per request
 *  on the PRE-COMPRESSION body to get the ground-truth baseline. Actual
 *  post-compression tokens already come back free in the /v1/messages usage
 *  block (input_tokens + cache_create + cache_read), so no second probe. */
async function countTokensUpstream(
  countTokensUrl: string,
  body: Uint8Array,
  headers: Headers,
): Promise<number | null> {
  // The probe body is a replayable buffer and count_tokens is a pure read, so a
  // retry can never double-charge or double-apply anything. Budget is kept far
  // tighter than the main forward: the probe only gates telemetry, and
  // finalize() awaits it, so a slow probe delays event logging.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(countTokensUrl, {
        method: 'POST',
        headers,
        body: body as unknown as BodyInit,
      });
    } catch {
      // Network-level failure (upstream unreachable / socket reset).
      if (attempt >= PROBE_MAX_RETRIES) return null;
      await sleep(retryDelayMs(attempt, null, PROBE_MAX_DELAY_MS) ?? 0);
      continue;
    }
    if (!res.ok) {
      // Retry only "rejected, not processed" statuses. A 400/401/403 here is a
      // deterministic rejection — replaying it just burns another round trip.
      const transient = res.status === 429 || res.status >= 500;
      const delay = transient && attempt < PROBE_MAX_RETRIES
        ? retryDelayMs(attempt, parseRetryAfterMs(res.headers.get('retry-after'), Date.now()), PROBE_MAX_DELAY_MS)
        : null;
      // Drain the discarded body so the socket is released promptly.
      await res.body?.cancel().catch(() => undefined);
      if (delay === null) return null;
      await sleep(delay);
      continue;
    }
    try {
      const json = (await res.json()) as { input_tokens?: unknown };
      return typeof json.input_tokens === 'number' ? json.input_tokens : null;
    } catch {
      return null; // 200 with an unparseable body is not a transient condition.
    }
  }
}

/** Resolve upstream URLs from config. Pure — unit-testable. */
export function resolveUpstreams(config: ProxyConfig): {
  anthropic: string;
  openai: string;
  stripOpenAIV1: boolean;
} {
  if (config.provider === 'cloudflare-ai-gateway') {
    const base = (config.gatewayBaseUrl ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new Error(
        "provider 'cloudflare-ai-gateway' requires gatewayBaseUrl (PXPIPE_GATEWAY_BASE_URL)",
      );
    }
    return { anthropic: `${base}/anthropic`, openai: `${base}/openai`, stripOpenAIV1: true };
  }
  const openai = (config.openAIUpstream ?? DEFAULT_OPENAI_UPSTREAM).replace(/\/+$/, '');
  const chatGptCodex = isChatGptCodexUpstream(openai);
  if (chatGptCodex && config.openAIApiKey) {
    throw new Error('ChatGPT Codex OAuth upstream cannot be combined with OPENAI_API_KEY');
  }
  if (chatGptCodex) {
    const sensitiveOverrides = Object.keys(config.gatewayHeaders ?? {}).filter((key) =>
      /^(authorization|chatgpt-account-id|x-openai-fedramp)$/i.test(key),
    );
    if (sensitiveOverrides.length > 0) {
      throw new Error('ChatGPT Codex OAuth upstream cannot override authentication headers');
    }
  }
  return {
    anthropic: (config.upstream ?? DEFAULT_UPSTREAM).replace(/\/+$/, ''),
    openai,
    stripOpenAIV1: chatGptCodex,
  };
}

function isChatGptCodexUpstream(base: string): boolean {
  try {
    const url = new URL(base);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'chatgpt.com'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && url.pathname.replace(/\/+$/, '') === '/backend-api/codex';
  } catch {
    return false;
  }
}

/** Parse PXPIPE_GATEWAY_HEADERS — JSON object or `k=v;k2=v2`. */
export function parseGatewayHeaders(spec: string | undefined): Record<string, string> {
  if (!spec) return {};
  const trimmed = spec.trim();
  if (trimmed.startsWith('{')) {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = String(v);
    return out;
  }
  const out: Record<string, string> = {};
  for (const pair of trimmed.split(';')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

/** Build the proxy fetch handler. */
export function createProxy(config: ProxyConfig = {}) {
  const routes = resolveUpstreams(config);
  const upstream = routes.anthropic;
  const openAIUpstream = routes.openai;
  const passthroughUpstream = config.provider === 'cloudflare-ai-gateway'
    ? (config.gatewayBaseUrl ?? '').replace(/\/+$/, '')
    : upstream;
  const gatewayHeaders = config.gatewayHeaders ?? {};
  const applyGatewayHeaders = (h: Headers): Headers => {
    for (const [k, v] of Object.entries(gatewayHeaders)) h.set(k, v);
    return h;
  };

  return async function handle(req: Request): Promise<Response> {
    const t0 = Date.now();
    const url = new URL(req.url);
    const path = url.pathname + url.search;

    // reqBodyBytes: kept for lazy gzip on 4xx. reqBodySha8: computed eagerly for correlation.
    let reqBodyBytes: Uint8Array | undefined;
    let reqBodySha8: string | undefined;
    let billingLane: BillingLane = 'unknown';
    let billingLaneSource: BillingLaneSource = 'unresolved';

    const fire = (
      status: number,
      info?: TransformInfo,
      error?: string,
      firstByteMs?: number,
      usage?: Usage,
      errorBody?: string,
      measurement?: OutputMeasurement,
      stopReason?: string,
      responseContentType?: string,
      usageScanStatus?: UsageScanStatus,
      usageScanError?: string,
      usageTerminalEventSeen?: boolean,
      usageSseEventCount?: number,
      usageParseErrorCount?: number,
      actualModel?: string,
      rateLimit?: RateLimitTelemetry,
    ): void => {
      const is4xx = status >= 400 && status < 500;
      // Gzip body lazily (only on 4xx). Async IIFE keeps fire() synchronous.
      const finalize = async (): Promise<void> => {
        let reqBodyGz: Uint8Array | undefined;
        if (
          config.captureRequestBodiesOn4xx === true &&
          is4xx &&
          reqBodyBytes &&
          reqBodyBytes.byteLength > 0
        ) {
          try {
            reqBodyGz = await gzipBytes(reqBodyBytes);
          } catch {
            // Non-fatal — drop body sample.
          }
        }
        // Await both count_tokens probes so baseline numbers land on the same event row.
        // Each probe is independent; null leaves the field absent and dashboard math degrades cleanly.
        if (info && baselineStatusApplies) {
          // Track both halves so the dashboard can gate on probe completeness (partial vs ok).
          // A missing cacheable-prefix probe must NOT be treated as cacheable=0 — that fabricates savings.
          let baselineResolved: number | null = null;
          let cacheableExpected = false;
          let cacheableResolved: number | null = null;
          if (baselinePromise) {
            try {
              baselineResolved = await baselinePromise;
              if (baselineResolved !== null) info.baselineTokens = baselineResolved;
            } catch {
              /* probe threw — drop */
            }
          }
          if (baselineCacheablePromise) {
            cacheableExpected = true;
            try {
              cacheableResolved = await baselineCacheablePromise;
              if (cacheableResolved !== null) info.baselineCacheableTokens = cacheableResolved;
            } catch {
              /* probe threw */
            }
          }
          if (baselineResolved === null) {
            info.baselineProbeStatus = 'failed';
          } else if (cacheableExpected && cacheableResolved === null) {
            info.baselineProbeStatus = 'partial'; // dashboard excludes row; must not treat as cacheable=0
          } else {
            info.baselineProbeStatus = 'ok';
          }
        }
        await config.onRequest?.({
          method: req.method,
          path: url.pathname,
          model: requestModel,
          requestedModel: requestModel,
          actualModel,
          billingLane,
          billingLaneSource,
          rateLimit,
          status,
          durationMs: Date.now() - t0,
          firstByteMs,
          info,
          usage,
          error,
          errorBody,
          reqBodySha8,
          reqBodyGz,
          measurement,
          stopReason,
          responseContentType,
          usageScanStatus,
          usageScanError,
          usageTerminalEventSeen,
          usageSseEventCount,
          usageParseErrorCount,
        });
      };
      void finalize();
    };

    // Transform only known shapes; everything else passes through.
    const providerPrefixed = isProviderPrefixedPath(url.pathname);
    const isMessages = req.method === 'POST' && isAnthropicMessagesPath(url.pathname);
    const isOpenAIChat = req.method === 'POST' && isOpenAIChatPath(url.pathname);
    const isOpenAIResponses = req.method === 'POST' && isOpenAIResponsesPath(url.pathname);
    const isOpenAIPath = isCanonicalOpenAIPath(
      url.pathname,
      req.headers,
      config.openAIApiKey !== undefined,
    );
    // Mutable: Grok models on OpenAI-shaped paths re-route to api.x.ai after
    // the body model is known (Codex keeps OPENAI_UPSTREAM; Grok must not).
    let upstreamBase = providerPrefixed ? passthroughUpstream : isOpenAIPath ? openAIUpstream : upstream;
    let stripOpenAIV1ForRequest = routes.stripOpenAIV1;
    let isGrokLane = false;
    let routeKey: 'passthrough' | 'openai' | 'anthropic' = providerPrefixed
      ? 'passthrough'
      : isOpenAIPath
        ? 'openai'
        : 'anthropic';
    const xaiUpstream = (config.xaiUpstream
      ?? (typeof process !== 'undefined' ? process.env?.XAI_UPSTREAM : undefined)
      ?? DEFAULT_XAI_UPSTREAM).replace(/\/+$/, '');

    let bodyOut: BodyInit | null = null;
    let info: TransformInfo | undefined;
    let requestModel: string | undefined;

    // Two count_tokens probes on the pre-compression body (see docs/HISTORY_CACHE_MODEL.md):
    //   baselinePromise          → full-body input_tokens
    //   baselineCacheablePromise → input_tokens truncated at last cache_control marker
    // Dashboard combines them for cache-aware baseline. Both run in parallel with the main forward.
    let baselinePromise: Promise<number | null> | undefined;
    let baselineCacheablePromise: Promise<number | null> | undefined;
    let baselineStatusApplies = false;

    if (isMessages || isOpenAIChat || isOpenAIResponses) {
      const bodyIn = new Uint8Array(await req.arrayBuffer());
      try {
        const transformOpts =
          typeof config.transform === 'function' ? config.transform() : config.transform;
        // Fail-closed: unreadable model → no compression, not a risky guess.
        const model = readModelField(bodyIn);
        requestModel = model ?? undefined;

        // Grok on /v1/responses|/v1/chat/completions → compress here, forward to
        // api.x.ai with the client's xAI bearer. Never use Codex/OpenAI upstream.
        if ((isOpenAIChat || isOpenAIResponses) && isGrokModel(model)) {
          isGrokLane = true;
          upstreamBase = xaiUpstream;
          stripOpenAIV1ForRequest = false;
          routeKey = 'openai';
        }

        // /v1/messages is only a wire schema: Claude Code can target a non-
        // Anthropic model (for example GPT-5.6 Sol). Do not apply Claude's
        // renderer or Anthropic count_tokens merely because the route is
        // Messages-shaped. Non-Anthropic Messages requests fail closed to
        // passthrough until a model-aware Messages→Sol transform exists.
        const messagesAnthropic = isMessages && isClaudeModel(model);
        const modelOk = isMessages
          ? messagesAnthropic && isPxpipeSupportedModel(model)
          : isPxpipeSupportedGptModel(model);
        // Unsupported model → a true passthrough: no break-even compression
        // (a text-only model may not accept injected image blocks at all).
        // Below the size floor → same passthrough: small bodies (side calls,
        // titling, early turns) lose tokens to image + cache-create overhead
        // and byte-exactness for zero real savings (see minCompressBodyBytes).
        const floorOk = bodyIn.byteLength >= minCompressBodyBytes();
        const effectiveOpts = modelOk && floorOk
          ? transformOpts
          : { ...transformOpts, compress: false };
        const r = isMessages
          ? await transformRequest(bodyIn, effectiveOpts)
          : isOpenAIChat
            ? await transformOpenAIChatCompletions(bodyIn, effectiveOpts)
            : await transformOpenAIResponses(bodyIn, effectiveOpts);
        if (!modelOk) r.info.reason = 'unsupported_model';
        else if (!floorOk) r.info.reason = 'below_min_size';
        bodyOut = r.body as unknown as BodyInit; // TS narrows Uint8Array away from BodyInit
        info = r.info;
        reqBodyBytes = r.body;
        if (r.body.byteLength > 0) {
          reqBodySha8 = await sha8Bytes(r.body);
        }

        if (isMessages && messagesAnthropic) {
          baselineStatusApplies = true;
          // Probes fire on the ORIGINAL body before the main forward so all three overlap.
          // count_tokens is not billed; ~30-80ms latency is hidden by the main forward.
          const ctBody = buildBaselineCountTokensBody(bodyIn);
          if (ctBody) {
            const ctHeaders = applyGatewayHeaders(filterHeaders(req.headers, STRIP_REQ_HEADERS));
            ctHeaders.set('content-type', 'application/json');
            if (config.apiKey) ctHeaders.set('x-api-key', config.apiKey);
            // Mirror the actual outbound request base+path: count_tokens lives at
            // `<messages-path>/count_tokens`, so provider-prefixed routes like
            // `/anthropic/messages` probe `/anthropic/messages/count_tokens`.
            const ctBase = providerPrefixed ? passthroughUpstream : upstream;
            const ctUrl = ctBase + url.pathname + '/count_tokens';
            baselinePromise = countTokensUpstream(ctUrl, ctBody, ctHeaders);
            // Null = no markers → cacheable=0 by definition, no probe needed.
            const ctCacheableBody = buildCacheablePrefixCountTokensBody(bodyIn);
            if (ctCacheableBody) {
              baselineCacheablePromise = countTokensUpstream(
                ctUrl,
                ctCacheableBody,
                new Headers(ctHeaders),
              );
            }
          }
        }
      } catch (e) {
        // Compression is an optimization, never a reason to break an agent
        // session. Forward the exact original body and retain a telemetry reason.
        bodyOut = bodyIn as unknown as BodyInit;
        reqBodyBytes = bodyIn;
        if (bodyIn.byteLength > 0) reqBodySha8 = await sha8Bytes(bodyIn);
        info = {
          compressed: false,
          reason: `transform_error: ${(e as Error).message}`,
          origChars: 0,
          compressedChars: 0,
          imageCount: 0,
          imageBytes: 0,
          staticChars: 0,
          dynamicChars: 0,
          dynamicBlockCount: 0,
          droppedChars: 0,
        };
      }
    } else {
      bodyOut = req.body; // pass through unchanged
    }

    // Billing after model-aware upstream selection (Grok vs Codex vs Claude).
    {
      const configuredLane = config.billingLanes?.[routeKey];
      const upstreamOrigin = (() => {
        try { return new URL(upstreamBase).origin; } catch { return ''; }
      })();
      if (configuredLane) {
        billingLane = configuredLane;
        billingLaneSource = 'configured_route';
      } else if (isGrokLane) {
        billingLane = 'api_key';
        billingLaneSource = 'api_key';
      } else if (upstreamOrigin === 'http://127.0.0.1:4017') {
        billingLane = 'agy_ultra_subscription';
        billingLaneSource = 'agy_bridge_origin';
      } else if (upstreamOrigin === 'http://127.0.0.1:1234') {
        billingLane = 'local';
        billingLaneSource = 'local_origin';
      } else if (isOpenAIPath && isChatGptCodexUpstream(openAIUpstream)) {
        billingLane = 'codex_subscription';
        billingLaneSource = 'chatgpt_codex_origin';
      } else if (isOpenAIPath && config.openAIApiKey) {
        billingLane = 'api_key';
        billingLaneSource = 'api_key';
      } else if (!isOpenAIPath && (config.apiKey || req.headers.has('x-api-key'))) {
        billingLane = 'api_key';
        billingLaneSource = 'api_key';
      } else if (
        !isOpenAIPath
        && req.headers.get('authorization')?.toLowerCase().startsWith('bearer ')
        && req.headers.get('anthropic-beta')?.toLowerCase().includes('oauth-2025-04-20')
      ) {
        billingLane = 'claude_max_subscription';
        billingLaneSource = 'anthropic_oauth_marker';
      }
    }

    const outHeaders = filterHeaders(req.headers, STRIP_REQ_HEADERS);
    // Grok lane: always inject the configured XAI_API_KEY (or xaiApiKey).
    // This prevents Codex/ChatGPT OAuth tokens from being forwarded to api.x.ai.
    // Non-Grok lanes keep their normal key injection behavior.
    if (isGrokLane) {
      if (config.xaiApiKey) {
        outHeaders.set('authorization', `Bearer ${config.xaiApiKey}`);
      }
      // If no xaiApiKey is configured we still forward the client's header
      // (may 401, but at least we don't silently break a working setup).
    } else if (isOpenAIPath) {
      if (config.openAIApiKey) outHeaders.set('authorization', `Bearer ${config.openAIApiKey}`);
    } else if (!isOpenAIPath && config.apiKey && (!providerPrefixed || url.pathname.startsWith('/anthropic/'))) {
      outHeaders.set('x-api-key', config.apiKey);
    }

    applyGatewayHeaders(outHeaders);

    // Gateway OpenAI routes drop the `/v1` prefix; provider-prefixed passthrough
    // routes keep their full path so ocproxy-style upstreams see `/openai/*`,
    // `/google-ai-studio/*`, etc. exactly as the client sent them.
    // Grok → api.x.ai keeps `/v1` (stripOpenAIV1ForRequest=false).
    const outPath = isOpenAIPath && stripOpenAIV1ForRequest ? path.replace(/^\/v1(?=\/)/, '') : path;
    const upstreamUrl = upstreamBase + outPath;
    // A streamed request body is consumed by the first attempt and cannot be
    // replayed, so those requests are never retried regardless of status.
    const bodyIsReplayable = !(bodyOut instanceof ReadableStream);
    let attempted: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        attempted = await fetch(upstreamUrl, {
          method: req.method,
          headers: outHeaders,
          body: bodyOut,
          // duplex is required by spec when sending a stream as body
          ...(bodyOut instanceof ReadableStream ? { duplex: 'half' } : {}),
        } as RequestInit);
      } catch (e) {
        // Deliberately NOT retried. A transport failure is ambiguous: the
        // request may already have reached the upstream and been applied, and
        // pxpipe cannot distinguish that from a request that never landed.
        // Replaying it could duplicate non-idempotent work. Fail loud instead.
        fire(502, info, `upstream_error: ${(e as Error).message}`);
        return new Response(JSON.stringify({ error: 'pxpipe upstream unreachable' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      // 429 is the ONLY retried status. It is an explicit statement that the
      // provider rejected the request before doing any work, so a replay cannot
      // duplicate anything. Every other 4xx is deterministic — replaying it
      // just burns a round trip and another rate-limit token.
      if (attempted.status !== 429 || !bodyIsReplayable || attempt >= FORWARD_MAX_RETRIES) break;
      const delay = retryDelayMs(
        attempt,
        parseRetryAfterMs(attempted.headers.get('retry-after'), Date.now()),
        FORWARD_MAX_DELAY_MS,
      );
      if (delay === null) break; // upstream asked for longer than our budget — surface the 429
      // Release the socket before sleeping; the discarded body is never read.
      await attempted.body?.cancel().catch(() => undefined);
      await sleep(delay);
    }
    if (!attempted) {
      // Unreachable: the loop only exits via break, after a successful assignment.
      fire(502, info, 'upstream_error: no response');
      return new Response(JSON.stringify({ error: 'pxpipe upstream unreachable' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    const upstreamRes: Response = attempted;

    const firstByteMs = Date.now() - t0;

    // Tee: client gets one side; scanner reads the other for usage/measurement/error body.
    const {
      response: teed,
      usagePromise,
      actualModelPromise,
      errorBodyPromise,
      measurementPromise,
      stopReasonPromise,
      scanStatusPromise,
      scanErrorPromise,
      terminalEventSeenPromise,
      sseEventCountPromise,
      parseErrorCountPromise,
    } = teeForUsage(upstreamRes);

    // Fire event in background once all four resolve (all share the same stream read).
    void Promise.all([
      usagePromise.catch(() => undefined),
      actualModelPromise.catch(() => undefined),
      errorBodyPromise.catch(() => undefined),
      measurementPromise.catch(() => undefined),
      stopReasonPromise.catch(() => undefined),
      scanStatusPromise.catch(() => 'partial_stream_error' as const),
      scanErrorPromise.catch(() => 'scan_promise_error'),
      terminalEventSeenPromise.catch(() => undefined),
      sseEventCountPromise.catch(() => undefined),
      parseErrorCountPromise.catch(() => undefined),
    ]).then(([
      usage,
      actualModel,
      errorBody,
      measurement,
      stopReason,
      usageScanStatus,
      usageScanError,
      usageTerminalEventSeen,
      usageSseEventCount,
      usageParseErrorCount,
    ]) =>
      fire(
        upstreamRes.status,
        info,
        // 401/403 carry no upstream diagnostic beyond the body, and the caller
        // was previously unrecoverable from the logs. Attach a redacted
        // caller fingerprint on exactly those statuses; every other status
        // keeps `error` unset so existing consumers are unaffected.
        upstreamRes.status === 401 || upstreamRes.status === 403
          ? describeAuthDenial(upstreamRes.status, req.headers, upstreamUrl)
          : undefined,
        firstByteMs,
        usage,
        errorBody,
        measurement,
        stopReason,
        upstreamRes.headers.get('content-type') ?? '<missing>',
        usageScanStatus,
        usageScanError,
        usageTerminalEventSeen,
        usageSseEventCount,
        usageParseErrorCount,
        actualModel,
        readRateLimitTelemetry(upstreamRes.headers),
      ),
    );

    const isModelsReq = url.pathname === '/v1/models'
      || url.pathname.startsWith('/v1/models/')
      || url.pathname === '/openai/v1/models'
      || url.pathname.startsWith('/openai/v1/models/');

    if (isModelsReq && upstreamRes.status === 200) {
      try {
        const text = await teed.text();
        const json = JSON.parse(text) as Record<string, unknown>;
        if (json && typeof json === 'object') {
          let modified = false;
          if (Array.isArray(json.data) && !Array.isArray(json.models)) {
            json.models = json.data;
            modified = true;
          } else if (Array.isArray(json.models) && !Array.isArray(json.data)) {
            json.data = json.models;
            modified = true;
          }
          if (modified) {
            const outText = JSON.stringify(json);
            const resHeaders = filterHeaders(upstreamRes.headers, STRIP_RES_HEADERS);
            resHeaders.set('content-type', 'application/json; charset=utf-8');
            resHeaders.set('content-length', String(Buffer.byteLength(outText)));
            return new Response(outText, {
              status: upstreamRes.status,
              statusText: upstreamRes.statusText,
              headers: resHeaders,
            });
          }
        }
      } catch {
        /* fall through */
      }
    }

    return new Response(teed.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: filterHeaders(upstreamRes.headers, STRIP_RES_HEADERS),
    });
  };
}
