import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CATALOG,
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  normalizeModelId,
  resolveModelProfile,
} from '../src/core/model-registry.js';

describe('src/core/model-registry.ts', () => {
  describe('Built-in Catalog & Profile Properties', () => {
    it('contains valid PxpipeModelProfile structures across all model families', () => {
      const profiles = getAllModelProfiles();
      expect(profiles.length).toBeGreaterThanOrEqual(BUILTIN_CATALOG.length);

      const families = new Set(profiles.map((p) => p.family));
      expect(families.has('claude')).toBe(true);
      expect(families.has('openai')).toBe(true);
      expect(families.has('grok')).toBe(true);
      expect(families.has('agy')).toBe(true);
      expect(families.has('nvidia')).toBe(true);

      for (const p of profiles) {
        expect(p.canonicalId).toBeTypeOf('string');
        expect(p.displayName).toBeTypeOf('string');
        expect(['validated', 'degraded', 'unvalidated']).toContain(p.status);
        expect(p.enabledByDefault).toBeTypeOf('boolean');
        expect(p.pricing.inputPerMtok).toBeGreaterThanOrEqual(0);
        expect(p.pricing.outputPerMtok).toBeGreaterThanOrEqual(0);
        expect(p.renderProfile.stripCols).toBeGreaterThan(0);
        expect(p.renderProfile.maxHeightPx).toBeGreaterThan(0);
        expect(p.contextWindowTokens).toBeGreaterThan(0);
        expect(p.maxOutputTokens).toBeGreaterThan(0);
        expect(p.factsheetEnabled).toBeTypeOf('boolean');
        expect(Array.isArray(p.aliases)).toBe(true);
      }
    });

    it('verifies specific Claude family model profiles', () => {
      const fable = resolveModelProfile('claude-fable-5');
      expect(fable.canonicalId).toBe('claude-fable-5');
      expect(fable.family).toBe('claude');
      expect(fable.status).toBe('validated');
      expect(fable.enabledByDefault).toBe(true);
      expect(fable.contextWindowTokens).toBe(1_048_576);
      expect(fable.pricing).toEqual({
        inputPerMtok: 10,
        cacheWritePerMtok: 12.5,
        cacheReadPerMtok: 1,
        outputPerMtok: 50,
      });

      const opus = resolveModelProfile('claude-opus-5');
      expect(opus.canonicalId).toBe('claude-opus-5');
      expect(opus.contextWindowTokens).toBe(1_048_576);
      expect(opus.pricing).toEqual({
        inputPerMtok: 5,
        cacheWritePerMtok: 6.25,
        cacheReadPerMtok: 0.5,
        outputPerMtok: 25,
      });
    });

    it('verifies OpenAI / Codex family profiles', () => {
      const sol = resolveModelProfile('gpt-5.6-sol');
      expect(sol.canonicalId).toBe('gpt-5.6-sol');
      expect(sol.family).toBe('openai');
      expect(sol.contextWindowTokens).toBe(262_144);
      expect(sol.pricing.inputPerMtok).toBe(5);

      const terra = resolveModelProfile('gpt-5.6-terra');
      expect(terra.contextWindowTokens).toBe(1_050_000);
    });

    it('verifies Grok family profiles', () => {
      const grok45 = resolveModelProfile('grok-4.5');
      expect(grok45.canonicalId).toBe('grok-4.5');
      expect(grok45.family).toBe('grok');
      expect(grok45.contextWindowTokens).toBe(524_288);
      expect(grok45.maxOutputTokens).toBe(128_000);
    });

    it('verifies AGY Proxy family profiles', () => {
      // Sourced 2026-09-05: DeepMind 3.6 model card (1,048,576 ctx / 65,536 out) and Google
      // Cloud pricing ($0.75 / $3.75 intro, cached $0.075). The 0.15 / 0.60 + 2,097,152 this
      // pinned before were Gemini 2.x Flash numbers carried forward.
      const agyGemini = resolveModelProfile('agy-gemini-3.6-flash-high');
      expect(agyGemini.canonicalId).toBe('agy-gemini-3.6-flash-high');
      expect(agyGemini.family).toBe('agy');
      expect(agyGemini.contextWindowTokens).toBe(1_048_576);
      expect(agyGemini.pricing).toEqual({
        inputPerMtok: 0.75,
        cacheWritePerMtok: 0.9375,
        cacheReadPerMtok: 0.075,
        outputPerMtok: 3.75,
      });
    });

    it('verifies NVIDIA NIM family flagship profiles', () => {
      const ultra550 = resolveModelProfile('nvidia/nemotron-3-ultra-550b-a55b');
      expect(ultra550.canonicalId).toBe('nvidia/nemotron-3-ultra-550b-a55b');
      expect(ultra550.family).toBe('nvidia');
      expect(ultra550.contextWindowTokens).toBe(1_048_576);

      const super120 = resolveModelProfile('nvidia/nemotron-3-super-120b-a12b');
      expect(super120.contextWindowTokens).toBe(262_144);

      const llama70 = resolveModelProfile('meta/llama-3.3-70b-instruct');
      expect(llama70.contextWindowTokens).toBe(131_072);
    });
  });

  describe('Alias Resolution', () => {
    it('resolves claude-opus aliases to claude-opus-5 profile', () => {
      for (const alias of ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'opus', 'claude-opus-4.8']) {
        const profile = resolveModelProfile(alias);
        expect(profile.canonicalId).toBe('claude-opus-5');
        expect(profile.contextWindowTokens).toBe(1_048_576);
        expect(profile.pricing.inputPerMtok).toBe(5);
        expect(profile.pricing.outputPerMtok).toBe(25);
      }
    });

    it('resolves fable, sonnet, and haiku aliases correctly', () => {
      expect(resolveModelProfile('claude-fable-5-20260601').canonicalId).toBe('claude-fable-5');
      expect(resolveModelProfile('fable-5').canonicalId).toBe('claude-fable-5');
      expect(resolveModelProfile('sonnet').canonicalId).toBe('claude-sonnet-5');
      expect(resolveModelProfile('claude-sonnet-4-6').canonicalId).toBe('claude-sonnet-5');
      expect(resolveModelProfile('haiku-4-5').canonicalId).toBe('claude-haiku-4-5');
    });

    it('resolves OpenAI and Codex aliases correctly', () => {
      expect(resolveModelProfile('gpt-5.6-sol-2026-06-01').canonicalId).toBe('gpt-5.6-sol');
      expect(resolveModelProfile('codex-5.3').canonicalId).toBe('gpt-5.3-codex');
    });

    it('resolves Grok aliases correctly', () => {
      expect(resolveModelProfile('grok-4.5-thinking').canonicalId).toBe('grok-4.5');
    });

    it('resolves AGY aliases correctly', () => {
      expect(resolveModelProfile('gemini-3.6-flash').canonicalId).toBe('agy-gemini-3.6-flash-high');
      expect(resolveModelProfile('agy/gemini-3.6-flash-high').canonicalId).toBe('agy-gemini-3.6-flash-high');
      expect(resolveModelProfile('claude-opus-4.6-thinking').canonicalId).toBe('agy-claude-opus-4.6-thinking');
    });

    it('resolves NVIDIA NIM catalog aliases correctly', () => {
      expect(resolveModelProfile('nemotron-3-ultra-550b').canonicalId).toBe('nvidia/nemotron-3-ultra-550b-a55b');
      expect(resolveModelProfile('nemotron-120b').canonicalId).toBe('nvidia/nemotron-3-super-120b-a12b');
      expect(resolveModelProfile('deepseek-v4-pro').canonicalId).toBe('deepseek-ai/deepseek-v4-pro');
      expect(resolveModelProfile('llama-3.3-70b').canonicalId).toBe('meta/llama-3.3-70b-instruct');
    });
  });

  describe('Accurate Context Window Sizes', () => {
    it('returns 1M (1,048,576) context for Claude 5 Fable, Opus, Sonnet, Nemotron Ultra 550B, DeepSeek V4 Pro, Nemotron 4 340B', () => {
      expect(resolveModelProfile('claude-opus-5').contextWindowTokens).toBe(1_048_576);
      expect(resolveModelProfile('claude-opus-4-8').contextWindowTokens).toBe(1_048_576);
      expect(resolveModelProfile('nvidia/nemotron-3-ultra-550b-a55b').contextWindowTokens).toBe(1_048_576);
      expect(resolveModelProfile('deepseek-ai/deepseek-v4-pro').contextWindowTokens).toBe(1_048_576);
      expect(resolveModelProfile('nvidia/nemotron-4-340b-instruct').contextWindowTokens).toBe(1_048_576);
    });

    it('returns 1M (1,048,576) context for every AGY Gemini Flash tier 3.5 through 3.8', () => {
      for (const ver of ['3.5', '3.6', '3.7', '3.8']) {
        for (const tier of ['high', 'medium', 'low']) {
          expect(resolveModelProfile(`agy-gemini-${ver}-flash-${tier}`).contextWindowTokens).toBe(1_048_576);
        }
      }
    });

    it('returns 2M (2,097,152) context for AGY Gemini 3.1 Pro', () => {
      expect(resolveModelProfile('agy-gemini-3.1-pro-high').contextWindowTokens).toBe(2_097_152);
    });

    it('returns 262K (262,144) context for GPT 5.6 Sol, Nemotron Super 120B, Nemotron Ultra 253B, Qwen 3.5 397B, Kimi K2.7 Code', () => {
      expect(resolveModelProfile('gpt-5.6-sol').contextWindowTokens).toBe(262_144);
      expect(resolveModelProfile('nvidia/nemotron-3-super-120b-a12b').contextWindowTokens).toBe(262_144);
      expect(resolveModelProfile('nvidia/llama-3.1-nemotron-ultra-253b-v1').contextWindowTokens).toBe(262_144);
      expect(resolveModelProfile('qwen/qwen3.5-397b-a17b').contextWindowTokens).toBe(262_144);
      expect(resolveModelProfile('kimi-k2.7-code').contextWindowTokens).toBe(262_144);
    });

    it('returns 128K/131K context for standard models (Meta Llama 3.3 70B, Mistral Large 2, GPT-OSS 120B, StarCoder2 15B)', () => {
      expect(resolveModelProfile('meta/llama-3.3-70b-instruct').contextWindowTokens).toBe(131_072);
      expect(resolveModelProfile('mistralai/mistral-large-2-instruct').contextWindowTokens).toBe(128_000);
      expect(resolveModelProfile('openai/gpt-oss-120b').contextWindowTokens).toBe(128_000);
      expect(resolveModelProfile('bigcode/starcoder2-15b').contextWindowTokens).toBe(128_000);
    });
  });

  describe('Dynamic Fallback Resolver', () => {
    it('creates appropriate dynamic fallback profiles for unknown nvidia/* models', () => {
      const customUltra = resolveModelProfile('nvidia/custom-ultra-model');
      expect(customUltra.canonicalId).toBe('nvidia/custom-ultra-model');
      expect(customUltra.family).toBe('nvidia');
      expect(customUltra.contextWindowTokens).toBe(1_048_576);

      const customSuper = resolveModelProfile('nvidia/custom-super-model');
      expect(customSuper.family).toBe('nvidia');
      expect(customSuper.contextWindowTokens).toBe(262_144);

      const customBase = resolveModelProfile('nvidia/custom-base-model');
      expect(customBase.family).toBe('nvidia');
      expect(customBase.contextWindowTokens).toBe(131_072);
    });

    it('creates appropriate dynamic fallback profiles for unknown deepseek-ai/* models', () => {
      const deepseekPro = resolveModelProfile('deepseek-ai/unknown-deepseek-v4-pro-variant');
      expect(deepseekPro.family).toBe('nvidia');
      expect(deepseekPro.contextWindowTokens).toBe(1_048_576);

      const deepseekFlash = resolveModelProfile('deepseek-ai/unknown-deepseek-flash-variant');
      expect(deepseekFlash.family).toBe('nvidia');
      expect(deepseekFlash.contextWindowTokens).toBe(131_072);
    });

    it('creates appropriate dynamic fallback profiles for meta/*, qwen/*, agy/*', () => {
      const meta = resolveModelProfile('meta/unknown-llama-model');
      expect(meta.family).toBe('nvidia');

      const qwen = resolveModelProfile('qwen/unknown-qwen-model');
      expect(qwen.family).toBe('nvidia');
      expect(qwen.contextWindowTokens).toBe(262_144);

      const agy = resolveModelProfile('agy/gemini-unknown-model');
      expect(agy.family).toBe('agy');
      expect(agy.contextWindowTokens).toBe(2_097_152);
    });
  });

  describe('Runtime Configuration Overrides', () => {
    it('overrides existing model properties dynamically', () => {
      applyRuntimeConfigOverrides({
        modelProfiles: {
          'claude-haiku-4-5': {
            contextWindowTokens: 300_000,
            status: 'validated',
            pricing: {
              inputPerMtok: 1.5,
              outputPerMtok: 7.5,
            },
          },
        },
      });

      const profile = resolveModelProfile('claude-haiku-4-5');
      expect(profile.contextWindowTokens).toBe(300_000);
      expect(profile.status).toBe('validated');
      expect(profile.pricing.inputPerMtok).toBe(1.5);
      expect(profile.pricing.outputPerMtok).toBe(7.5);
    });

    it('registers new custom models when canonicalId and family are provided', () => {
      applyRuntimeConfigOverrides({
        models: {
          'my-custom-org/special-model': {
            canonicalId: 'my-custom-org/special-model',
            displayName: 'Special Model',
            family: 'openai',
            contextWindowTokens: 400_000,
            pricing: { inputPerMtok: 3, outputPerMtok: 12 },
          },
        },
      });

      const profile = resolveModelProfile('my-custom-org/special-model');
      expect(profile.displayName).toBe('Special Model');
      expect(profile.family).toBe('openai');
      expect(profile.contextWindowTokens).toBe(400_000);
    });
  });

  describe('normalizeModelId helper', () => {
    it('normalizes model strings correctly', () => {
      expect(normalizeModelId('models/claude-opus-4-8(thinking)')).toBe('claude-opus-4-8');
      expect(normalizeModelId('GPT-5.6-Sol(thinking)')).toBe('gpt-5.6-sol');
      expect(normalizeModelId(undefined)).toBe('');
    });
  });
});
