import { describe, expect, it } from 'vitest';
import {
  cacheReadRatio,
  normalizeModelName,
  outputInputRatio,
  resolveModelRate,
} from '../src/core/model-pricing.js';

describe('provider-aware model pricing', () => {
  it('prices GPT 5.6 Sol standard and long-context API tiers', () => {
    expect(resolveModelRate('GPT 5.6 Sol', 200_000)).toMatchObject({
      status: 'api_equivalent', inputPerMtok: 5, cachedInputPerMtok: 0.5, outputPerMtok: 30,
    });
    expect(resolveModelRate('gpt-5.6-sol', 272_001)).toMatchObject({
      status: 'api_equivalent', inputPerMtok: 10, cachedInputPerMtok: 1, outputPerMtok: 45,
    });
    expect(resolveModelRate('gpt-5.6-sol-2026-07-01', 1)).toMatchObject({
      id: 'openai:gpt-5.6-sol', canonicalModel: 'gpt-5.6-sol',
    });
  });

  it('prices GPT-5.5 standard, snapshot, and long-context requests', () => {
    expect(resolveModelRate('gpt-5.5', 272_000)).toMatchObject({
      canonicalModel: 'gpt-5.5', inputPerMtok: 5, cachedInputPerMtok: 0.5,
      outputPerMtok: 30, contextWindowTokens: 1_050_000, maxOutputTokens: 128_000,
    });
    expect(resolveModelRate('gpt-5.5-2026-04-23', 1).id).toBe('openai:gpt-5.5');
    expect(resolveModelRate('gpt-5.5', 272_001)).toMatchObject({
      id: 'openai:gpt-5.5:long', inputPerMtok: 10, cachedInputPerMtok: 1, outputPerMtok: 45,
    });
    expect(cacheReadRatio('gpt-5.5')).toBe(0.1);
    expect(outputInputRatio('gpt-5.5')).toBe(6);
  });

  it('labels AGY lanes as subscription quota rather than cash charges', () => {
    expect(resolveModelRate('agy-gemini-3.5-flash-high')).toMatchObject({
      status: 'quota_only', inputPerMtok: 1.5, cachedInputPerMtok: 0.15, outputPerMtok: 9,
    });
    expect(resolveModelRate('agy-claude-opus-4.6-thinking')).toMatchObject({
      status: 'quota_only', inputPerMtok: 5, cachedInputPerMtok: 0.5, outputPerMtok: 25,
    });
    expect(resolveModelRate('agy-gpt-oss-120b-medium')).toMatchObject({
      status: 'quota_only', canonicalModel: 'gpt-oss-120b',
    });
    expect(resolveModelRate('agy-gpt-oss-120b-medium').inputPerMtok).toBeUndefined();
  });

  it('does not invent separate rates for AGY reasoning effort tiers', () => {
    const low = resolveModelRate('agy-gemini-3.1-pro-low');
    const high = resolveModelRate('agy-gemini-3.1-pro-high');
    expect(low.inputPerMtok).toBe(high.inputPerMtok);
    expect(low.outputPerMtok).toBe(high.outputPerMtok);
    expect(low.status).toBe('quota_only');
  });

  it('prices direct xAI API models without treating the Grok client as a model', () => {
    expect(resolveModelRate('grok-4.5')).toMatchObject({
      provider: 'xai', status: 'api_equivalent', inputPerMtok: 2, cachedInputPerMtok: 0.3, outputPerMtok: 6,
    });
    expect(cacheReadRatio('grok-4.5')).toBe(0.15);
    expect(cacheReadRatio('grok-4.5-latest')).toBe(0.15);
    expect(cacheReadRatio('grok-build-latest')).toBe(0.15);
    expect(resolveModelRate('grok-4.5-latest')).toMatchObject({
      provider: 'xai', status: 'api_equivalent', canonicalModel: 'grok-4.5', cachedInputPerMtok: 0.3,
    });
    expect(resolveModelRate('grok-build-latest')).toMatchObject({
      provider: 'xai', status: 'api_equivalent', canonicalModel: 'grok-4.5', cachedInputPerMtok: 0.3,
    });
    expect(resolveModelRate('grok-build')).toMatchObject({ status: 'unavailable' });
  });

  it('requires allocation for local models and rejects unknown identities', () => {
    expect(resolveModelRate('ornith-1.0-9b')).toMatchObject({
      provider: 'local', status: 'allocation_required',
    });
    expect(resolveModelRate('not-a-real-model')).toMatchObject({
      provider: 'unknown', status: 'unavailable',
    });
    expect(resolveModelRate('gpt-5.5', 1, {
      actualModel: 'gpt-5.5', billingLane: 'local', billingLaneSource: 'configured_route',
    })).toMatchObject({ provider: 'local', status: 'allocation_required' });
    expect(resolveModelRate('gpt-5.5', 1, {
      actualModel: 'gpt-5.5', billingLane: 'unknown', billingLaneSource: 'configured_route',
    })).toMatchObject({ provider: 'unknown', status: 'unavailable' });
    expect(resolveModelRate('gpt-5.5', 1, {
      billingLane: 'local', billingLaneSource: 'configured_route',
    }).inputPerMtok).toBeUndefined();
  });

  it('normalizes display suffixes without changing the model family', () => {
    expect(normalizeModelName('Claude Opus 4.6 (Thinking)')).toBe('claude-opus-4.6');
  });

  it('prices Kimi (Moonshot AI) models', () => {
    expect(resolveModelRate('moonshot-v1-8k')).toMatchObject({
      provider: 'moonshot', status: 'api_equivalent', inputPerMtok: 0.20, outputPerMtok: 2.00, contextWindowTokens: 8192,
    });
    expect(resolveModelRate('moonshot-v1-32k')).toMatchObject({
      provider: 'moonshot', status: 'api_equivalent', inputPerMtok: 1.00, outputPerMtok: 3.00, contextWindowTokens: 32768,
    });
    expect(resolveModelRate('moonshot-v1-128k')).toMatchObject({
      provider: 'moonshot', status: 'api_equivalent', inputPerMtok: 2.00, outputPerMtok: 5.00, contextWindowTokens: 131072,
    });
    expect(resolveModelRate('kimi-k2.7-code')).toMatchObject({
      provider: 'moonshot', status: 'api_equivalent', inputPerMtok: 0.95, cachedInputPerMtok: 0.19, outputPerMtok: 4.00, contextWindowTokens: 262144,
    });
    expect(resolveModelRate('kimi-k2.6')).toMatchObject({
      provider: 'moonshot', status: 'api_equivalent', inputPerMtok: 0.95, cachedInputPerMtok: 0.16, outputPerMtok: 4.00, contextWindowTokens: 262144,
    });
    expect(resolveModelRate('moonshot-v1-8k').cachedInputPerMtok).toBeUndefined();
    expect(resolveModelRate('moonshot-v1-32k').cachedInputPerMtok).toBeUndefined();
    expect(resolveModelRate('moonshot-v1-128k').cachedInputPerMtok).toBeUndefined();
    for (const alias of ['kimi-k2.5', 'kimi-k2.7-code-2026-07-01', 'kimi-k2.6-2026-07-01']) {
      expect(resolveModelRate(alias).status).toBe('unavailable');
    }
  });

  it('prices GLM (Zhipu AI) models', () => {
    expect(resolveModelRate('glm-4.5-flash')).toMatchObject({
      provider: 'zhipu', status: 'free_by_terms', inputPerMtok: 0, outputPerMtok: 0, contextWindowTokens: 128000,
    });
    expect(resolveModelRate('glm-4.7-flash')).toMatchObject({
      provider: 'zhipu', status: 'free_by_terms', inputPerMtok: 0, outputPerMtok: 0, contextWindowTokens: 128000,
    });
    expect(resolveModelRate('glm-4.5-air')).toMatchObject({
      provider: 'zhipu', status: 'api_equivalent', inputPerMtok: 0.20, cachedInputPerMtok: 0.03, outputPerMtok: 1.10, contextWindowTokens: 128000,
    });
    expect(resolveModelRate('glm-4-32b-0414-128k')).toMatchObject({
      provider: 'zhipu', status: 'api_equivalent', inputPerMtok: 0.10, outputPerMtok: 0.10, contextWindowTokens: 128000,
    });
    expect(resolveModelRate('glm-4-32b-0414-128k').cachedInputPerMtok).toBeUndefined();
    for (const alias of ['glm-4-flash', 'glm-4-air', 'glm-4', 'glm-4.7-flash-2026-07-01']) {
      expect(resolveModelRate(alias).status).toBe('unavailable');
    }
  });

  it('fails closed for OpenRouter without route provenance cash rates', () => {
    expect(resolveModelRate('openrouter/openai/gpt-5.5')).toMatchObject({
      provider: 'openrouter',
      id: 'openrouter:gpt-5.5',
      status: 'allocation_required',
    });
    expect(resolveModelRate('openrouter/openai/gpt-5.5').inputPerMtok).toBeUndefined();
    expect(resolveModelRate('agy-openrouter/openai/gpt-5.5')).toMatchObject({
      provider: 'openrouter',
      id: 'agy:gpt-5.5',
      status: 'quota_only',
    });
    expect(resolveModelRate('agy-openrouter/openai/gpt-5.5').inputPerMtok).toBeUndefined();
    expect(resolveModelRate('openrouter/anthropic/claude-sonnet-5')).toMatchObject({
      provider: 'openrouter',
      id: 'openrouter:claude-sonnet-5',
      status: 'allocation_required',
    });
    expect(resolveModelRate('openrouter/openai/gpt-5.5', 1, {
      actualModel: 'gpt-5.5', billingLane: 'api_key', billingLaneSource: 'configured_route',
    })).toMatchObject({
      provider: 'openrouter', id: 'openrouter:gpt-5.5', status: 'allocation_required',
    });
  });

  it('requires configured_route before treating NVIDIA catalog as free_by_terms', () => {
    expect(resolveModelRate('nvidia/meta/llama-3.3-70b-instruct')).toMatchObject({
      provider: 'nvidia',
      id: 'nvidia:meta-llama-3.3-70b-instruct',
      status: 'allocation_required',
    });
    expect(resolveModelRate('nvidia/meta/llama-3.3-70b-instruct').inputPerMtok).toBeUndefined();
    expect(resolveModelRate('nvidia:nvidia/llama-3.1-nemotron-70b-instruct', 0, {
      billingLaneSource: 'configured_route',
      billingLane: 'api_key',
    })).toMatchObject({
      provider: 'nvidia',
      id: 'nvidia:llama-3.1-nemotron-70b-instruct',
      status: 'allocation_required',
    });
    expect(resolveModelRate('nvidia:nvidia/llama-3.1-nemotron-70b-instruct', 0, {
      billingLaneSource: 'configured_route',
      billingLane: 'nvidia_build_free',
    })).toMatchObject({
      provider: 'nvidia',
      id: 'nvidia:llama-3.1-nemotron-70b-instruct',
      status: 'free_by_terms',
      inputPerMtok: 0,
      outputPerMtok: 0,
    });
    expect(resolveModelRate('agy-nvidia/meta/llama-3.3-70b-instruct')).toMatchObject({
      provider: 'nvidia',
      id: 'agy:meta-llama-3.3-70b-instruct',
      status: 'quota_only',
      inputPerMtok: 0,
      outputPerMtok: 0,
    });
  });

  it('does not claim free cash for bare NVIDIA-prefixed models without provenance', () => {
    expect(resolveModelRate('nvidia/kimi-k2.5')).toMatchObject({
      provider: 'nvidia',
      id: 'nvidia:kimi-k2.5',
      status: 'allocation_required',
      contextWindowTokens: 131072,
    });
    expect(resolveModelRate('nvidia/kimi-k2.5').inputPerMtok).toBeUndefined();
  });

  it('prices the successful upstream actual model when provided', () => {
    expect(resolveModelRate('client-alias', 1, { actualModel: 'gpt-5.5' })).toMatchObject({
      canonicalModel: 'gpt-5.5',
      status: 'api_equivalent',
      inputPerMtok: 5,
      outputPerMtok: 30,
    });
  });

  it('lets configured subscription billing lanes force quota_only', () => {
    expect(resolveModelRate('gpt-5.5', 1, {
      billingLane: 'codex_subscription',
      billingLaneSource: 'configured_route',
    })).toMatchObject({
      status: 'quota_only',
      inputPerMtok: 5,
      outputPerMtok: 30,
    });
  });

  describe('model-registry integration in rate resolution', () => {
    it('propagates exact context window sizes from model-registry profiles', () => {
      expect(resolveModelRate('claude-opus-4-8').contextWindowTokens).toBe(1_048_576);
      expect(resolveModelRate('agy-gemini-3.6-flash-high').contextWindowTokens).toBe(1_048_576);
      expect(resolveModelRate('nvidia/nemotron-3-ultra-550b-a55b', 0, {
        billingLaneSource: 'configured_route',
        billingLane: 'nvidia_build_free',
      }).contextWindowTokens).toBe(1_048_576);
      expect(resolveModelRate('nvidia/nemotron-3-super-120b-a12b', 0, {
        billingLaneSource: 'configured_route',
        billingLane: 'nvidia_build_free',
      }).contextWindowTokens).toBe(262_144);
    });

    it('resolves model aliases through model-registry for rate cards', () => {
      const rateOpus = resolveModelRate('claude-opus-4-8');
      expect(rateOpus.canonicalModel).toBe('claude-opus-5');
      expect(rateOpus.inputPerMtok).toBe(5);
      expect(rateOpus.outputPerMtok).toBe(25);

      const rateFable = resolveModelRate('fable-5');
      expect(rateFable.canonicalModel).toBe('claude-fable-5');
      expect(rateFable.inputPerMtok).toBe(10);
    });
  });
});
