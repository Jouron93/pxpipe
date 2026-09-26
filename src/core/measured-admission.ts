/**
 * Measured-loss admission for the Anthropic Messages lane.
 *
 * pxpipe decides to image a request from a LOCAL estimate of text vs image
 * tokens. On the Anthropic lane it also sends a free `count_tokens` probe on
 * the ORIGINAL body alongside every forward, and the response carries the
 * real billed usage. Until now that pair was telemetry only: when the estimate
 * was wrong, pxpipe measured the loss on every request and kept making it.
 *
 * Measured 2026-09-26 on live traffic (~/.pxpipe/events.jsonl, 48 h):
 * claude-haiku-4-5 billed MORE than its plain-text baseline on 40 of 40 imaged
 * requests (5,748,105 vs 5,232,177 tokens, -9.9%), a steady +13,673 tokens per
 * call from 341,152 chars of tool docs rendered into 45 images. Over the same
 * window claude-opus-5-5 saved 18.8% on 35 of 35. The Google lane already
 * reverts on a measured loss (`transformed >= baseline` via countTokens); this
 * gives the Anthropic lane the same property without adding latency, because
 * it acts on measurements the proxy already takes.
 *
 * Policy, per model: keep the last `window` measured imaged requests. When at
 * least `minSamples` are present and their billed total exceeds the baseline
 * total by more than `lossMargin`, pass that model through unmodified for
 * `cooldownMs`, then let it be imaged and measured again. Aggregating over a
 * window keeps one noisy request from flipping the decision, and the cooldown
 * bounds the cost of being wrong in either direction.
 *
 * Override: PXPIPE_MEASURED_REVERT=0 disables it.
 */

export interface MeasuredAdmissionOptions {
  /** Samples kept per model. */
  window?: number;
  /** Samples required before a verdict. */
  minSamples?: number;
  /** Billed may exceed baseline by this fraction before it counts as a loss. */
  lossMargin?: number;
  /** How long a losing model passes through before it is re-measured. */
  cooldownMs?: number;
  now?: () => number;
}

export interface MeasuredAdmissionModelState {
  samples: number;
  billed: number;
  baseline: number;
  bypassUntil: number | null;
  trips: number;
}

interface ModelState {
  billed: number[];
  baseline: number[];
  bypassUntil: number;
  trips: number;
}

export const MEASURED_ADMISSION_DEFAULTS = {
  window: 8,
  minSamples: 3,
  lossMargin: 0.02,
  cooldownMs: 30 * 60 * 1000,
} as const;

export class MeasuredAdmission {
  private readonly window: number;
  private readonly minSamples: number;
  private readonly lossMargin: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly models = new Map<string, ModelState>();

  constructor(opts: MeasuredAdmissionOptions = {}) {
    this.window = Math.max(1, Math.floor(opts.window ?? MEASURED_ADMISSION_DEFAULTS.window));
    this.minSamples = Math.min(
      this.window,
      Math.max(1, Math.floor(opts.minSamples ?? MEASURED_ADMISSION_DEFAULTS.minSamples)),
    );
    this.lossMargin = Math.max(0, opts.lossMargin ?? MEASURED_ADMISSION_DEFAULTS.lossMargin);
    this.cooldownMs = Math.max(0, opts.cooldownMs ?? MEASURED_ADMISSION_DEFAULTS.cooldownMs);
    this.now = opts.now ?? Date.now;
  }

  private key(model: string): string {
    return model.trim().toLowerCase();
  }

  /** True while `model` is in a measured-loss cooldown. */
  shouldBypass(model: string | null | undefined): boolean {
    if (!model) return false;
    const s = this.models.get(this.key(model));
    return s !== undefined && this.now() < s.bypassUntil;
  }

  /** Record one imaged request's billed input tokens against its measured
   *  plain-text baseline. Returns true when this sample trips the cooldown. */
  record(model: string | null | undefined, billed: number, baseline: number): boolean {
    if (!model) return false;
    if (!Number.isFinite(billed) || !Number.isFinite(baseline) || billed < 0 || baseline <= 0) {
      return false;
    }
    const k = this.key(model);
    let s = this.models.get(k);
    if (!s) {
      s = { billed: [], baseline: [], bypassUntil: 0, trips: 0 };
      this.models.set(k, s);
    }
    s.billed.push(billed);
    s.baseline.push(baseline);
    if (s.billed.length > this.window) {
      s.billed.shift();
      s.baseline.shift();
    }
    if (s.billed.length < this.minSamples) return false;
    const b = s.billed.reduce((a, x) => a + x, 0);
    const base = s.baseline.reduce((a, x) => a + x, 0);
    if (b <= base * (1 + this.lossMargin)) return false;
    s.bypassUntil = this.now() + this.cooldownMs;
    s.trips += 1;
    // Start the next measurement window fresh after the cooldown.
    s.billed = [];
    s.baseline = [];
    return true;
  }

  snapshot(): Record<string, MeasuredAdmissionModelState> {
    const out: Record<string, MeasuredAdmissionModelState> = {};
    const t = this.now();
    for (const [k, s] of this.models) {
      out[k] = {
        samples: s.billed.length,
        billed: s.billed.reduce((a, x) => a + x, 0),
        baseline: s.baseline.reduce((a, x) => a + x, 0),
        bypassUntil: t < s.bypassUntil ? s.bypassUntil : null,
        trips: s.trips,
      };
    }
    return out;
  }
}

/** Billed input tokens on the Anthropic lane: the three disjoint input buckets. */
export function anthropicBilledInputTokens(usage: {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
} | undefined): number | null {
  if (!usage) return null;
  const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens];
  if (parts.every((p) => typeof p !== 'number')) return null;
  return parts.reduce<number>((a, p) => a + (typeof p === 'number' ? p : 0), 0);
}

/** PXPIPE_MEASURED_REVERT=0|false|off|no disables the guard; anything else enables it. */
export function measuredRevertEnabled(env: Record<string, string | undefined> | undefined): boolean {
  const raw = env?.PXPIPE_MEASURED_REVERT;
  if (raw === undefined) return true;
  return !/^(0|false|off|no)$/i.test(raw.trim());
}
