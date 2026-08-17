/**
 * PXPIPE-REQ-01: Shadow Admission Estimator
 *
 * Predicts whether an incoming request is worth transforming prior to invocation.
 * Inputs remain minimal (payload size/type/model/known transform family).
 * Outputs deterministic decisions: ADMIT, BYPASS, INSUFFICIENT_EVIDENCE.
 */

export type AdmissionDecision = 'ADMIT' | 'BYPASS' | 'INSUFFICIENT_EVIDENCE';

export interface AdmissionEstimatorInput {
  readonly model?: string | null;
  readonly payloadSizeBytes?: number | null;
  readonly payloadChars?: number | null;
  readonly transformFamily?: 'anthropic_messages' | 'openai_chat' | 'openai_responses' | 'unknown';
  readonly isWarm?: boolean | null;
}

export interface AdmissionEstimatorResult {
  readonly decision: AdmissionDecision;
  readonly reason: string;
  readonly predictedSavingsPct: number;
  readonly breakEvenThresholdChars: number;
  readonly confidence: 'high' | 'medium' | 'low';
}

/** Default model economic floor thresholds in characters */
export const ECONOMIC_FLOORS = {
  FABLE_5_CHARS: 25_000,
  OPUS_5_CHARS: 50_000,
  SONNET_5_CHARS: 200_000,
  CODEX_GPT_CHARS: 25_000,
  GROK_CHARS: 25_000,
} as const;

function cleanModelId(model: string | null | undefined): string {
  if (!model) return '';
  return model.trim().toLowerCase();
}

/**
 * Deterministic Admission Estimator.
 * Evaluates whether image transformation will yield positive token ROI given
 * empirical cache economics and payload size constraints.
 */
export function estimateAdmission(input: AdmissionEstimatorInput): AdmissionEstimatorResult {
  const model = cleanModelId(input.model);
  const chars = Math.max(0, input.payloadChars ?? (input.payloadSizeBytes ? Math.floor(input.payloadSizeBytes / 3) : 0));

  // 1. Claude Fable 5: profitable above 25k chars.
  //
  // Measured 2026-08-17 with a BYPASS control arm (rows pxpipe never touched),
  // which is what separates our effect from Anthropic's native prompt caching:
  //   WARM  transformed 97.5%  vs control  77.3%  ->  +20.2pp attributable
  //   COLD  transformed 79.2%  vs control -24.7%  -> +104.0pp attributable
  //
  // predictedSavingsPct is deliberately the COLD transformed rate, not the warm
  // 97.5%. This estimator cannot see cache state, and 97.5% is unreachable on a
  // cold opener -- quoting it would over-promise on exactly the requests this
  // branch exists to admit. 79.2% is the conservative, measured floor.
  //
  // The earlier 97.0 here came from an aggregate that had no control arm and was
  // superseded (T-239): it was mostly native caching, not transform.
  if (model.includes('fable')) {
    if (chars >= ECONOMIC_FLOORS.FABLE_5_CHARS) {
      return {
        decision: 'ADMIT',
        reason: 'above_fable_economic_floor',
        predictedSavingsPct: 79.2,
        breakEvenThresholdChars: ECONOMIC_FLOORS.FABLE_5_CHARS,
        confidence: 'high',
      };
    }
    return {
      decision: 'BYPASS',
      reason: 'below_fable_economic_floor',
      predictedSavingsPct: -20.0,
      breakEvenThresholdChars: ECONOMIC_FLOORS.FABLE_5_CHARS,
      confidence: 'high',
    };
  }

  // 2. Claude Opus 5: Highly profitable above 50k chars (p50=+38.4%, 90/116 in 50k-100k tier, 13/13 in >200k tier).
  if (model.includes('opus-5') || model.includes('opus-4-8') || model.includes('opus-4-7')) {
    if (chars >= ECONOMIC_FLOORS.OPUS_5_CHARS) {
      return {
        decision: 'ADMIT',
        reason: 'above_opus_economic_floor',
        predictedSavingsPct: 38.4,
        breakEvenThresholdChars: ECONOMIC_FLOORS.OPUS_5_CHARS,
        confidence: 'high',
      };
    }
    return {
      decision: 'BYPASS',
      reason: 'below_opus_economic_floor',
      predictedSavingsPct: -50.0,
      breakEvenThresholdChars: ECONOMIC_FLOORS.OPUS_5_CHARS,
      confidence: 'high',
    };
  }

  // 3. Claude Sonnet 5: High image-token density requires large payloads (>200k chars) to overcome cache_create overhead.
  if (model.includes('sonnet-5') || model.includes('sonnet-4-6') || model.includes('sonnet-4-5')) {
    if (chars >= ECONOMIC_FLOORS.SONNET_5_CHARS) {
      return {
        decision: 'ADMIT',
        reason: 'above_sonnet_economic_floor',
        predictedSavingsPct: 50.0,
        breakEvenThresholdChars: ECONOMIC_FLOORS.SONNET_5_CHARS,
        confidence: 'medium',
      };
    }
    return {
      decision: 'BYPASS',
      reason: 'below_sonnet_economic_floor',
      predictedSavingsPct: -200.0,
      breakEvenThresholdChars: ECONOMIC_FLOORS.SONNET_5_CHARS,
      confidence: 'high',
    };
  }

  // 4. Codex GPT-5.6 family (sol, terra, luna): Linear token replacement, break-even at 25k chars.
  if (model.includes('gpt-5.6') || model.includes('codex') || model.includes('gpt-5.4')) {
    if (chars >= ECONOMIC_FLOORS.CODEX_GPT_CHARS) {
      return {
        decision: 'ADMIT',
        reason: 'above_codex_economic_floor',
        predictedSavingsPct: 40.0,
        breakEvenThresholdChars: ECONOMIC_FLOORS.CODEX_GPT_CHARS,
        confidence: 'high',
      };
    }
    return {
      decision: 'BYPASS',
      reason: 'below_codex_economic_floor',
      predictedSavingsPct: -20.0,
      breakEvenThresholdChars: ECONOMIC_FLOORS.CODEX_GPT_CHARS,
      confidence: 'high',
    };
  }

  // 5. Grok family (grok-4.5, grok-4.3): Break-even at 25k chars.
  if (model.includes('grok')) {
    if (chars >= ECONOMIC_FLOORS.GROK_CHARS) {
      return {
        decision: 'ADMIT',
        reason: 'above_grok_economic_floor',
        predictedSavingsPct: 30.0,
        breakEvenThresholdChars: ECONOMIC_FLOORS.GROK_CHARS,
        confidence: 'medium',
      };
    }
    return {
      decision: 'BYPASS',
      reason: 'below_grok_economic_floor',
      predictedSavingsPct: -20.0,
      breakEvenThresholdChars: ECONOMIC_FLOORS.GROK_CHARS,
      confidence: 'high',
    };
  }

  // 6. Known lightweight or text-only models (Haiku, GPT-4o, etc.)
  if (model.includes('haiku') || model.includes('gpt-4o') || model.includes('gpt-4')) {
    return {
      decision: 'BYPASS',
      reason: 'unsupported_or_lightweight_model',
      predictedSavingsPct: 0.0,
      breakEvenThresholdChars: Infinity,
      confidence: 'high',
    };
  }

  // 7. Unknown model profile
  if (!model || model === 'unknown') {
    return {
      decision: 'INSUFFICIENT_EVIDENCE',
      reason: 'missing_or_unknown_model',
      predictedSavingsPct: 0.0,
      breakEvenThresholdChars: Infinity,
      confidence: 'low',
    };
  }

  return {
    decision: 'INSUFFICIENT_EVIDENCE',
    reason: 'unbenchmarked_model_profile',
    predictedSavingsPct: 0.0,
    breakEvenThresholdChars: Infinity,
    confidence: 'low',
  };
}
