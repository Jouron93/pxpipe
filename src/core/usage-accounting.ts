/**
 * Response token usage parsing and cache accounting.
 *
 * Normalizes provider-specific response usage objects (Anthropic, OpenAI, DeepSeek,
 * Google Gemini) into clean, non-fabricating accounting metrics:
 * - uncachedInput: prompt tokens billed at full 1.0x rate
 * - cacheRead: prompt tokens served from cache (discounted rate)
 * - cacheCreate: prompt tokens written to cache (Anthropic surcharge; 0 for others)
 * - totalPromptTokens: total input tokens processed by upstream
 * - output: completion/candidate tokens
 *
 * Invariant: Never double-counts prompt tokens and never fabricates values when usage is absent.
 */

export interface ParsedUsageTokens {
  haveUsage: boolean;
  totalPromptTokens?: number;
  uncachedInput?: number;
  cacheRead?: number;
  cacheCreate?: number;
  output?: number;
  totalTokens?: number;
}

export function extractUsageTokens(
  provider: string,
  rawResponse: unknown,
): ParsedUsageTokens {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return { haveUsage: false };
  }

  const res = rawResponse as Record<string, unknown>;
  const normProvider = (provider || '').trim().toLowerCase();

  // 1. Google Gemini / DeepMind usageMetadata
  if (normProvider === 'google' || normProvider === 'gemini') {
    const um = (res.usageMetadata ?? res.usage) as Record<string, unknown> | undefined;
    if (!um || typeof um !== 'object') {
      return { haveUsage: false };
    }

    const promptTokens = typeof um.promptTokenCount === 'number'
      ? um.promptTokenCount
      : typeof um.prompt_tokens === 'number'
        ? um.prompt_tokens
        : undefined;

    if (promptTokens === undefined) {
      return { haveUsage: false };
    }

    const cachedTokens = typeof um.cachedContentTokenCount === 'number'
      ? um.cachedContentTokenCount
      : typeof um.cached_tokens === 'number'
        ? um.cached_tokens
        : 0;

    const outputTokens = typeof um.candidatesTokenCount === 'number'
      ? um.candidatesTokenCount + (typeof um.thoughtsTokenCount === 'number' ? um.thoughtsTokenCount : 0)
      : typeof um.completion_tokens === 'number'
        ? um.completion_tokens
        : undefined;

    const totalTokens = typeof um.totalTokenCount === 'number'
      ? um.totalTokenCount
      : typeof um.total_tokens === 'number'
        ? um.total_tokens
        : promptTokens + (outputTokens ?? 0);

    return {
      haveUsage: true,
      totalPromptTokens: promptTokens,
      cacheRead: cachedTokens,
      uncachedInput: Math.max(0, promptTokens - cachedTokens),
      cacheCreate: 0,
      output: outputTokens,
      totalTokens,
    };
  }

  // 2. Generic usage block inspection for Anthropic, OpenAI, DeepSeek, xAI
  const usage = (res.usage ?? (res.message as Record<string, unknown> | undefined)?.usage) as
    | Record<string, unknown>
    | undefined;

  if (!usage || typeof usage !== 'object') {
    return { haveUsage: false };
  }

  // DeepSeek provider semantics
  if (normProvider === 'deepseek') {
    const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
    if (promptTokens === undefined) {
      return { haveUsage: false };
    }
    const cacheHit = typeof usage.prompt_cache_hit_tokens === 'number'
      ? usage.prompt_cache_hit_tokens
      : 0;
    const cacheMiss = typeof usage.prompt_cache_miss_tokens === 'number'
      ? usage.prompt_cache_miss_tokens
      : Math.max(0, promptTokens - cacheHit);
    const output = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
    const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : promptTokens + (output ?? 0);

    return {
      haveUsage: true,
      totalPromptTokens: promptTokens,
      cacheRead: cacheHit,
      uncachedInput: cacheMiss,
      cacheCreate: 0,
      output,
      totalTokens,
    };
  }

  // Anthropic provider semantics
  if (normProvider === 'anthropic') {
    const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
    const cacheCreate = typeof usage.cache_creation_input_tokens === 'number'
      ? usage.cache_creation_input_tokens
      : undefined;
    const cacheRead = typeof usage.cache_read_input_tokens === 'number'
      ? usage.cache_read_input_tokens
      : undefined;
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;

    if (inputTokens === undefined && cacheCreate === undefined && cacheRead === undefined && output === undefined) {
      return { haveUsage: false };
    }

    const effectiveUncached = inputTokens ?? 0;
    const effectiveCreate = cacheCreate ?? 0;
    const effectiveRead = cacheRead ?? 0;
    const totalPrompt = effectiveUncached + effectiveCreate + effectiveRead;

    return {
      haveUsage: true,
      uncachedInput: inputTokens,
      cacheCreate,
      cacheRead,
      output,
      totalPromptTokens: totalPrompt,
      totalTokens: totalPrompt + (output ?? 0),
    };
  }

  // OpenAI / xAI provider semantics
  if (normProvider === 'openai' || normProvider === 'xai' || normProvider === 'grok') {
    const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
    if (promptTokens === undefined) {
      return { haveUsage: false };
    }

    const details = (usage.prompt_tokens_details ?? usage.input_tokens_details) as
      | Record<string, unknown>
      | undefined;
    const cachedTokens = typeof details?.cached_tokens === 'number'
      ? details.cached_tokens
      : 0;

    const uncached = Math.max(0, promptTokens - cachedTokens);
    const output = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
    const totalTokens = typeof usage.total_tokens === 'number' ? usage.total_tokens : promptTokens + (output ?? 0);

    return {
      haveUsage: true,
      totalPromptTokens: promptTokens,
      cacheRead: cachedTokens,
      uncachedInput: uncached,
      cacheCreate: 0,
      output,
      totalTokens,
    };
  }

  // Fallback for unrecognized provider: detect by property names
  if (typeof usage.prompt_cache_hit_tokens === 'number') {
    const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
    const cacheHit = usage.prompt_cache_hit_tokens;
    const cacheMiss = typeof usage.prompt_cache_miss_tokens === 'number'
      ? usage.prompt_cache_miss_tokens
      : Math.max(0, promptTokens - cacheHit);
    return {
      haveUsage: true,
      totalPromptTokens: promptTokens,
      cacheRead: cacheHit,
      uncachedInput: cacheMiss,
      cacheCreate: 0,
      output: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
      totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
    };
  }

  if (typeof usage.cache_creation_input_tokens === 'number' || typeof usage.cache_read_input_tokens === 'number') {
    const uncached = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const create = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    const read = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    const totalPrompt = uncached + create + read;
    return {
      haveUsage: true,
      uncachedInput: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
      cacheCreate: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : undefined,
      cacheRead: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined,
      output: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
      totalPromptTokens: totalPrompt,
      totalTokens: totalPrompt + (typeof usage.output_tokens === 'number' ? usage.output_tokens : 0),
    };
  }

  if (typeof usage.prompt_tokens === 'number') {
    const details = (usage.prompt_tokens_details ?? usage.input_tokens_details) as Record<string, unknown> | undefined;
    const cached = typeof details?.cached_tokens === 'number' ? details.cached_tokens : 0;
    return {
      haveUsage: true,
      totalPromptTokens: usage.prompt_tokens,
      cacheRead: cached,
      uncachedInput: Math.max(0, usage.prompt_tokens - cached),
      cacheCreate: 0,
      output: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
      totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
    };
  }

  return { haveUsage: false };
}
