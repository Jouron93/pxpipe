/** Applicability helpers for pxpipe's production-safe model scope.
 *  Modified by AI agent under coordination with @jules
 */

export type PxpipeApplicabilityReason =
  | 'eligible'
  | 'unsupported_model'
  | 'unsupported_method'
  | 'unsupported_path'
  | 'empty_body'
  | 'below_min_size';

export interface PxpipeApplicabilityInput {
  readonly model?: string | null;
  readonly method?: string | null;
  readonly path?: string | null;
  readonly bodyBytes?: number | null;
}

/** Bracketed variant tags (e.g. `[1m]`) stripped before model matching so base and variant gate identically. */
const VARIANT_TAG = /\[[^\]]*\]/g;

function baseModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((thinking|high|medium|med|low)\)/g, '')
    .replace(/^models\//, '')
    .replace(/^(openai|anthropic|google|x-ai|xai|agy|codex)[/:-]/, '')
    .replace(/^(moonshot|zhipu|kimi|nvidia|hermes|deepseek)[/:]/, '')
    .replace(/[ _]+/g, '-')
    .replace(/-(thinking|high|medium|med|low|fast|stable|low-context|long-context|reason|nonreason|reasoning|reasoner|effort|thought|extended-thinking|extended|high-effort|medium-effort|low-effort|high-thinking|medium-thinking|low-thinking)$/, '')
    .replace(/^-|-$/g, '');
}

/** Dashboard runtime override; null = fall back to PXPIPE_MODELS env / built-in default. In-memory only. */
let runtimeModelBases: readonly string[] | null = null;

/** Built-in default scope when PXPIPE_MODELS is unset: Fable 5 only.
 *  Everything else is opt-in via dashboard chips or PXPIPE_MODELS:
 *  - Opus 4.7/4.8 — worse at reading imaged content (FINDINGS.md 2026-06-16:
 *    Opus 4.8 ~2pp arithmetic, 6/15 dense-hex vs Fable 100/100).
 *  - GPT 5.5 — degrades on imaged history/context.
 *  - GPT 5.6 Sol — 98/100 production arithmetic, but 79/93 completed gist,
 *    4/15 completed guard confabulations, and 0/15 dense hex.
 *  - Grok 4.5 — 82/100 arithmetic, 83/98 gist, and 13/18 state tracking.
 *  Both profiles remain available for explicit opt-in.
 *  Silently imaging weak or unvalidated readers is the wrong default. */
import { resolveModelProfile, getAllModelProfiles } from './model-registry.js';

function getDefaultModelBases(): string[] {
  const enabled = getAllModelProfiles()
    .filter((p) => p.enabledByDefault)
    .map((p) => p.canonicalId);
  return enabled.length > 0 ? enabled : ['claude-fable-5'];
}

function falsey(v: string): boolean {
  return /^(0|false|no|off|none)$/i.test(v.trim());
}

/** PXPIPE_MODELS env / built-in default, ignoring the runtime override. One CSV
 *  controls every family (Claude + GPT). Resolution (read per-call so scope flips LIVE):
 *  - unset or empty        → built-in default (Fable 5 only)
 *  - `off`/`0`/`false`/... → compress nothing
 *  - CSV of model bases    → exactly those families (e.g. `claude-fable-5,gpt-5.6-sol`) */
function envOrDefaultBases(): string[] {
  // Edge-safe: `process` is undefined off-Node; `typeof` avoids a ReferenceError.
  const raw = typeof process !== 'undefined' ? process.env?.PXPIPE_MODELS : undefined;
  if (raw === undefined) return getDefaultModelBases();
  const trimmed = raw.trim();
  if (!trimmed) return getDefaultModelBases();
  if (falsey(trimmed)) return [];
  if (trimmed.toLowerCase() === 'all' || trimmed === '*') {
    return getAllModelProfiles().map((p) => p.canonicalId);
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

function allowedModelBases(): string[] {
  if (runtimeModelBases !== null) return [...runtimeModelBases];
  return envOrDefaultBases();
}

/** Current effective allowed-model scope (Claude + GPT). */
export function getAllowedModelBases(): string[] {
  return allowedModelBases();
}

/** PXPIPE_MODELS env / default scope, independent of runtime override.
 *  Dashboard unions this into its chip set so env-enabled models are always shown as toggles. */
export function getConfiguredModelBases(): string[] {
  return envOrDefaultBases();
}

/** Set the dashboard runtime override. Empty array = compress nothing; null = clear override. Not persisted. */
export function setAllowedModelBases(list: readonly string[] | null): void {
  runtimeModelBases = list === null ? null : list.map((s) => s.trim()).filter(Boolean);
}

// ---- imaged-reading validation registry -----------------------------------

/** Per-model imaged-reading verdicts (FINDINGS.md). Compression on a weak
 *  reader degrades into confident confabulation, so only 'validated' readers
 *  may be enabled from the dashboard; everything else requires the deliberate,
 *  persisted PXPIPE_MODELS env opt-in. */
export type PxpipeReaderValidation = {
  readonly status: 'validated' | 'degraded' | 'unvalidated';
  readonly note: string;
};

/** Verdict for a model base; unknown ids fail closed as 'unvalidated'. */
export function readerValidation(base: string): PxpipeReaderValidation {
  const profile = resolveModelProfile(base);
  let note = `no imaged-reading benchmark for ${profile.displayName}`;
  if (profile.canonicalId === 'claude-fable-5') {
    note = '100/100 novel arithmetic, 13/15 verbatim, 98/98 gist parity (FINDINGS.md 2026-06-10/11)';
  } else if (profile.canonicalId === 'claude-opus-4-8') {
    note = '6/15 dense-hex; confident confabulation on imaged detail (FINDINGS.md 2026-06-12/16)';
  } else if (profile.canonicalId.startsWith('claude-opus-4-')) {
    note = 'Opus imaged-reading failure family; disabled alongside 4.8 (FINDINGS.md)';
  } else if (profile.canonicalId === 'gpt-5.6-sol') {
    note = '98/100 arithmetic but 0/15 dense-hex and 4/15 confabulation guard (FINDINGS.md 2026-07-09)';
  } else if (profile.canonicalId === 'gpt-5.5') {
    note = 'degrades on imaged history/context (FINDINGS.md)';
  } else if (profile.canonicalId === 'grok-4.5') {
    note = '82/100 arithmetic, 83/98 gist, 13/18 state tracking (FINDINGS.md)';
  } else if (profile.status === 'validated') {
    note = `${profile.displayName} is validated for imaged reading.`;
  } else if (profile.status === 'degraded') {
    note = `${profile.displayName} degrades on imaged history/context.`;
  }
  return {
    status: profile.status,
    note,
  };
}

/** True when the dashboard may turn this base ON at runtime: validated readers
 *  always; anything else only when PXPIPE_MODELS already opts it in (deliberate,
 *  persisted config outranks the UI guard). Turning OFF is never gated. */
export function canEnableFromDashboard(base: string): boolean {
  if (readerValidation(base).status === 'validated') return true;
  return getConfiguredModelBases().some((b) => b === base);
}

/** Membership test against the single allowed scope. Matches exact base or `-suffix`
 *  alias; [variant] tags stripped first. */
function isAllowed(model: string | null | undefined): boolean {
  if (typeof model !== 'string') return false;
  const base = baseModelId(model);
  const allowed = allowedModelBases();
  return allowed.some((b) => base === b || base.startsWith(`${b}-`));
}

/** True when pxpipe may transform this Anthropic model. */
export function isPxpipeSupportedModel(model: string | null | undefined): boolean {
  return isAllowed(model);
}

/** True when pxpipe may transform this GPT model. Shares the single PXPIPE_MODELS scope. */
export function isPxpipeSupportedGptModel(model: string | null | undefined): boolean {
  return isAllowed(model);
}

/** Whole-request imaging floor: request bodies smaller than this always pass
 *  through as text. Dashboard evidence (2026-07-16, port 47821): bodies at
 *  ≈22k as-text tokens saved ≤584 tokens once imaged, and ~1.1k-token side
 *  calls (titling/summaries) went NEGATIVE (-1.1k to -1.2k, cache-create
 *  overhead swamps the shrink). ≥ ~300KB bodies saved 58-70k. Below the floor,
 *  imaging costs money AND byte-exactness — strictly worse than text.
 *  Override with PXPIPE_MIN_BODY_BYTES (0 disables the floor). Read per-call
 *  so it flips live, matching PXPIPE_MODELS semantics. */
const DEFAULT_MIN_BODY_BYTES = 200_000;

export function minCompressBodyBytes(): number {
  if (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true')) {
    return 0;
  }
  const raw = typeof process !== 'undefined' ? process.env?.PXPIPE_MIN_BODY_BYTES : undefined;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MIN_BODY_BYTES;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_BODY_BYTES;
}

/** Canonical set of Anthropic Messages routes pxpipe transforms. Shared with
 *  createProxy (src/core/proxy.ts) so the public applicability helper and the
 *  proxy router can never disagree on which paths are eligible — they did: the
 *  proxy accepts /anthropic/messages, but the helper's old `endsWith` check
 *  rejected it (and would have wrongly accepted /foo/v1/messages). Exact matches
 *  only, so /v1/messages/count_tokens stays unsupported. */
export function isAnthropicMessagesPath(pathname: string): boolean {
  return pathname === '/v1/messages'
    || pathname === '/anthropic/v1/messages'
    || pathname === '/anthropic/messages';
}

export function shouldTransformAnthropicMessages(
  input: PxpipeApplicabilityInput,
): { eligible: boolean; reason: PxpipeApplicabilityReason } {
  if (input.method !== undefined && input.method !== null && input.method.toUpperCase() !== 'POST') {
    return { eligible: false, reason: 'unsupported_method' };
  }
  if (input.path !== undefined && input.path !== null && !isAnthropicMessagesPath(input.path)) {
    return { eligible: false, reason: 'unsupported_path' };
  }
  if (input.bodyBytes !== undefined && input.bodyBytes !== null && input.bodyBytes <= 0) {
    return { eligible: false, reason: 'empty_body' };
  }
  if (input.bodyBytes !== undefined && input.bodyBytes !== null && input.bodyBytes < minCompressBodyBytes()) {
    return { eligible: false, reason: 'below_min_size' };
  }
  if (!isPxpipeSupportedModel(input.model)) {
    return { eligible: false, reason: 'unsupported_model' };
  }
  return { eligible: true, reason: 'eligible' };
}
