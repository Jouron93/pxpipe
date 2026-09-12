/**
 * Cache-aware GPT/OpenAI savings math.
 *
 * This is deliberately separate from src/core/baseline.ts (Anthropic): OpenAI
 * has no `count_tokens`, no explicit cache_control breakpoints, no cache-create
 * premium, and images are billed by OpenAI's vision-token formula rather than
 * text tokens. The transform path records two GPT-specific facts per imaged
 * request:
 *
 *   imageTokens           = what the rendered images actually cost as input
 *   baselineImagedTokens  = o200k text tokens the imaged/stripped content would
 *                           have cost if left as plain text
 *
 * OpenAI usage then tells us how many prompt tokens were served from prompt
 * cache (`cached_tokens`, a subset of input_tokens). For the gpt-5 family, cached
 * input is billed at ~0.1× the normal input rate; there is no 1.25× write
 * premium like Anthropic's ephemeral cache.
 */

import { cacheReadRatio, outputInputRatio } from './model-pricing.js';

/** gpt-5 cached input list ratio: $0.125 / $1.25 per 1M tokens. */
export const OPENAI_GPT5_CACHE_READ_RATE = 0.1;

/** gpt-5 output/input list ratio: $10 / $1.25 per 1M tokens. */
export const OPENAI_GPT5_OUTPUT_RATE = 8;

/** Older OpenAI families use a less aggressive cached-input discount. pxpipe's
 * GPT compression gate is currently gpt-5.x-only, but keep the helper explicit
 * so passthrough telemetry does not accidentally get priced at Anthropic rates. */
/** Grok cached prompt list ratio from xAI model pricing metadata
 *  (cachedPromptTokenPrice / promptTextTokenPrice = 5000/20000). */
export const GROK_CACHE_READ_RATE = 0.25;

/** Grok completion/input list ratio (completionTextTokenPrice / promptTextTokenPrice
 *  = 60000/20000). */
export const GROK_OUTPUT_RATE = 3;

export function openAICacheReadRate(model: string | undefined): number {
  return cacheReadRatio(model);
}

export function openAIOutputRate(model: string | undefined): number {
  return outputInputRatio(model);
}

/** Weighted input tokens actually paid to OpenAI this turn. `cachedTokens` is a
 * subset of `inputTokens`, not an additive bucket. */
export function computeOpenAIActualInputEff(
  inputTokens: number,
  cachedTokens: number,
  model?: string,
): number {
  if (inputTokens <= 0) return 0;
  const cached = Math.max(0, Math.min(cachedTokens || 0, inputTokens));
  const uncached = inputTokens - cached;
  return uncached + cached * openAICacheReadRate(model);
}

/** Raw token count for the unproxied GPT counterfactual: replace the rendered
 * images with the o200k text they stood in for. */
export function computeOpenAIBaselineRawTokens(
  inputTokens: number,
  imageTokens: number,
  baselineImagedTokens: number,
): number {
  if (inputTokens <= 0) return 0;
  const delta = (baselineImagedTokens || 0) - (imageTokens || 0);
  return Math.max(0, inputTokens + delta);
}

/** Weighted input tokens for the unproxied GPT text counterfactual.
 *
 * We cannot ask OpenAI `count_tokens`, and the API does not expose per-block
 * cache accounting. The only honest observable is whether this request had a
 * prompt-cache hit at all (`cached_tokens > 0`). The imaged slab sits in the
 * stable prefix; when OpenAI reports cached tokens, that slab would have been
 * cached as text too, so the text↔image delta is discounted by the same cached
 * input rate. On a cold/no-cache turn, the delta is paid at the full input rate.
 */
export function computeOpenAIBaselineInputEff(
  inputTokens: number,
  cachedTokens: number,
  imageTokens: number,
  baselineImagedTokens: number,
  model?: string,
): number {
  const actual = computeOpenAIActualInputEff(inputTokens, cachedTokens, model);
  if (inputTokens <= 0 || imageTokens <= 0 || baselineImagedTokens <= 0) return actual;
  const delta = baselineImagedTokens - imageTokens;
  const deltaWeight = (cachedTokens || 0) > 0 ? openAICacheReadRate(model) : 1.0;
  return actual + delta * deltaWeight;
}

/**
 * Profitability Gate V2 — decide whether imaging beats leaving text native,
 * counting provider prompt-cache discounts. Distinct from pxpipe's local PNG
 * render cache: this is the provider's prefix-equality cache
 * (`cached_tokens` / `x-grok-conv-id` / `prompt_cache_key`).
 *
 * Warm Grok text is billed at GROK_CACHE_READ_RATE (0.25 = 75% off). Imaging
 * that prefix pays full vision tokens and busts the cached text. If discounted
 * native text is cheaper, KEEP TEXT.
 */
export interface CacheAwareGateInput {
  model?: string;
  textTokens: number;
  imageTokens: number;
  preservedTextTokens?: number;
  /** True when this turn is expected to hit a warm provider prompt cache. */
  providerCacheLikely?: boolean;
}

export type CacheAwareGateReason =
  | 'warm_cached_text_cheaper'
  | 'image_cheaper'
  | 'text_cheaper'
  | 'marginal';

export interface CacheAwareGateResult {
  profitable: boolean;
  cacheWeight: number;
  textCost: number;
  imageCost: number;
  reason: CacheAwareGateReason;
}

export function evalCacheAwareProfitability(input: CacheAwareGateInput): CacheAwareGateResult {
  const textTokens = Math.max(0, input.textTokens || 0);
  const imageTokens = Math.max(0, input.imageTokens || 0);
  const preserved = Math.max(0, input.preservedTextTokens || 0);
  const imageCost = imageTokens + preserved;
  const cacheWeight = input.providerCacheLikely ? openAICacheReadRate(input.model) : 1;
  const textCost = textTokens * cacheWeight;
  const delta = textCost - imageCost;
  if (input.providerCacheLikely) {
    // Noisy/marginal warm savings are not worth busting a cached prefix.
    const material = Math.max(32, textCost * 0.05);
    if (imageCost >= textCost || delta < material) {
      return {
        profitable: false,
        cacheWeight,
        textCost,
        imageCost,
        reason: imageCost >= textCost ? 'warm_cached_text_cheaper' : 'marginal',
      };
    }
    return { profitable: true, cacheWeight, textCost, imageCost, reason: 'image_cheaper' };
  }
  if (imageCost >= textCost) {
    return { profitable: false, cacheWeight, textCost, imageCost, reason: 'text_cheaper' };
  }
  return { profitable: true, cacheWeight, textCost, imageCost, reason: 'image_cheaper' };
}
