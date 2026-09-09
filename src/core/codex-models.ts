/** Codex's `/model` picker is built from the UPSTREAM catalog, which carries ~48
 *  fields per model (`slug`, `display_name`, `context_window`, `service_tiers`,
 *  reasoning levels, ...). pxpipe's synthesized `/v1/models` has four, so codex's
 *  models manager fails to decode it ("missing field `display_name`") and falls
 *  back to a stale built-in list — which is why a model pxpipe served correctly
 *  was still unselectable in the picker. Synthesizing 48 fields would be guessing
 *  at someone else's schema; forwarding the real request is not.
 *
 *  Lives in core (no side effects, injectable fetch) so the fallback behaviour is
 *  unit-testable — `node.ts` starts the server at import and cannot be.
 *
 *  WHO gets forwarded is decided by credential SHAPE, not by User-Agent. The ChatGPT
 *  codex backend accepts exactly one kind of credential — a ChatGPT OAuth JWT issued by
 *  auth.openai.com — so that is the only bearer this forwards. A Grok CLI's SuperGrok JWT
 *  (also `eyJ…`), a Cursor `sk-proj-` key, an Anthropic `sk-ant-` key or `x-api-key` all
 *  decline BEFORE any network call: the first cut forwarded any non-Anthropic bearer and
 *  would have handed a Grok JWT to chatgpt.com (Grok 4.6 review, 2026-09-05).
 *
 *  Returns undefined — leaving the synthesized list in place — unless ALL hold:
 *    - Authorization is a ChatGPT session token (see credential-shape.ts) and there is
 *      no `x-api-key` header;
 *    - an OpenAI upstream is configured at all;
 *    - a `client_version` is available: the caller's own query string first (codex
 *      sends it), the `codex_cli_rs/<v>` User-Agent as a fallback source.
 *  The upstream is NOT required to be chatgpt.com directly: on Abyss it is a local
 *  shim (`pxpipe_codex_upstream.mjs`) that rewrites `/models` onto
 *  `/backend-api/codex/models`, so pinning the hostname here disabled the path.
 *
 *  Upstream outcomes: 401/403 are PASSED THROUGH (an expired session must surface as an
 *  auth error, not as a stale picker that looks fine); any other non-2xx, a timeout, a
 *  thrown error, a non-JSON body, or JSON that is not a models catalog all fall through
 *  to the synthesized list. */

import type { IncomingHttpHeaders } from 'node:http';
import { isAnthropicCredential, isChatGptSessionToken } from './credential-shape.js';

/** Upper bound on the upstream catalog fetch. Codex's picker refresh is not
 *  latency-critical, but an unbounded wait here blocks `/v1/models` for every caller. */
export const UPSTREAM_MODELS_TIMEOUT_MS = 8_000;

/** The one thing this needs from a request. A real IncomingMessage satisfies it. */
export interface UpstreamModelsRequest {
  readonly headers: IncomingHttpHeaders;
}

export interface UpstreamModelsOptions {
  /** Injected by tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Receives the reason a request was NOT forwarded. Default: stderr when
   *  PXPIPE_DEBUG_MODELS=1, otherwise silent — declining is a valid answer, not an
   *  error, which is exactly what made a mis-tuned guard invisible before. */
  readonly onDecline?: (why: string) => void;
}

const FORWARDED_HEADERS = ['chatgpt-account-id', 'originator', 'user-agent'] as const;
const PASSTHROUGH_STATUSES: ReadonlySet<number> = new Set([401, 403]);

function defaultDecline(why: string): void {
  // Edge-safe: `process` is undefined off-Node.
  if (typeof process !== 'undefined' && process.env?.PXPIPE_DEBUG_MODELS === '1') {
    console.error(`[pxpipe] upstream models declined: ${why}`);
  }
}

function isModelsCatalog(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const obj = parsed as { models?: unknown; data?: unknown };
  return Array.isArray(obj.models) || Array.isArray(obj.data);
}

export async function fetchUpstreamCodexModels(
  req: UpstreamModelsRequest,
  url: URL,
  openAIUpstream: string | undefined,
  opts: UpstreamModelsOptions = {},
): Promise<Response | undefined> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_MODELS_TIMEOUT_MS;
  const onDecline = opts.onDecline ?? defaultDecline;
  const decline = (why: string): undefined => {
    onDecline(why);
    return undefined;
  };

  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.trim()) return decline('no authorization header');
  if (req.headers['x-api-key']) return decline('x-api-key present (anthropic-style client)');
  if (isAnthropicCredential(auth)) return decline('anthropic credential');
  if (!isChatGptSessionToken(auth)) {
    return decline('bearer is not a ChatGPT session token (issuer host); not forwarding it');
  }
  const base = (openAIUpstream ?? '').replace(/\/+$/, '');
  if (!base) return decline('no openai upstream configured');

  // `client_version` is REQUIRED upstream (400 without it). Prefer the caller's OWN
  // query — codex knows its version better than we can infer it — and only fall back
  // to parsing the UA. A literal version pinned here would go stale on the next codex
  // release and fail closed for everyone.
  const params = new URLSearchParams(url.search);
  if (!params.get('client_version')) {
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
    const version = /codex_cli_rs\/([0-9][^\s(]*)/.exec(ua)?.[1];
    if (!version) {
      return decline(`no client_version in query (${url.search || '<none>'}) or UA (${ua || '<absent>'})`);
    }
    params.set('client_version', version);
  }

  const headers: Record<string, string> = { authorization: auth };
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) headers[name] = value;
  }

  try {
    // Bounded: a stalled upstream must degrade to the synthesized list, never hang the
    // picker. The signal also aborts the body read, so `res.text()` is covered.
    const res = await fetchImpl(`${base}/models?${params.toString()}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    if (PASSTHROUGH_STATUSES.has(res.status)) {
      // The session is dead or forbidden. Say so; a synthesized 200 would hide it.
      return new Response(body, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
      });
    }
    if (!res.ok) return decline(`upstream HTTP ${res.status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (parseErr) {
      void parseErr;
      // A 200 carrying HTML (a login page behind a redirect, say) forwarded with a JSON
      // content-type is worse for every client than the synthesized list.
      return decline(`upstream 200 with a non-JSON body (${body.length} bytes)`);
    }
    if (!isModelsCatalog(parsed)) {
      return decline('upstream 200 whose JSON is not a models catalog (no models[]/data[])');
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return decline(`upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
