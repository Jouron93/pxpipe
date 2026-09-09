import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveModelRate,
  normalizeModelName,
  cacheReadRatio,
  outputInputRatio,
} from '../src/core/model-pricing.js';
import {
  resolveModelProfile,
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  BUILTIN_CATALOG,
} from '../src/core/model-registry.js';
import {
  isPxpipeSupportedModel,
  isPxpipeSupportedGptModel,
  canEnableFromDashboard,
  readerValidation,
  getAllowedModelBases,
  getConfiguredModelBases,
  setAllowedModelBases,
} from '../src/core/applicability.js';

describe('Challenger M2_2: Long-Context Pricing, PXPIPE_CONFIG Overrides, and Applicability', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
    setAllowedModelBases(null);
  });

  describe('1. Long-Context Pricing Logic (>272,000 input tokens)', () => {
    it('applies standard vs long-context rates correctly for gpt-5.6-sol', () => {
      // Exactly at boundary 272,000 -> Standard tier
      const std = resolveModelRate('gpt-5.6-sol', 272_000);
      expect(std.id).toBe('openai:gpt-5.6-sol');
      expect(std.inputPerMtok).toBe(5);
      expect(std.cachedInputPerMtok).toBe(0.5);
      expect(std.outputPerMtok).toBe(30);
      expect(std.contextWindowTokens).toBe(262_144);
      expect(std.status).toBe('api_equivalent');

      // 272,001 -> Long-context tier
      const long = resolveModelRate('gpt-5.6-sol', 272_001);
      expect(long.id).toBe('openai:gpt-5.6-sol:long');
      expect(long.inputPerMtok).toBe(10); // 5 * 2
      expect(long.cachedInputPerMtok).toBe(1.0); // 0.5 * 2
      expect(long.outputPerMtok).toBe(45); // 30 * 1.5
      expect(long.contextWindowTokens).toBe(1_050_000);
      expect(long.note).toContain('Long-context tier: 2x input and 1.5x output.');
      expect(long.status).toBe('api_equivalent');

      // 500,000 tokens -> Long-context tier
      const mega = resolveModelRate('gpt-5.6-sol', 500_000);
      expect(mega.id).toBe('openai:gpt-5.6-sol:long');
      expect(mega.inputPerMtok).toBe(10);
      expect(mega.cachedInputPerMtok).toBe(1.0);
      expect(mega.outputPerMtok).toBe(45);
      expect(mega.contextWindowTokens).toBe(1_050_000);
    });

    it('applies standard vs long-context rates correctly for gpt-5.5', () => {
      const std = resolveModelRate('gpt-5.5', 272_000);
      expect(std.id).toBe('openai:gpt-5.5');
      expect(std.inputPerMtok).toBe(5);
      expect(std.cachedInputPerMtok).toBe(0.5);
      expect(std.outputPerMtok).toBe(30);
      expect(std.contextWindowTokens).toBe(1_050_000);

      const long = resolveModelRate('gpt-5.5', 272_001);
      expect(long.id).toBe('openai:gpt-5.5:long');
      expect(long.inputPerMtok).toBe(10);
      expect(long.cachedInputPerMtok).toBe(1.0);
      expect(long.outputPerMtok).toBe(45);
      expect(long.contextWindowTokens).toBe(1_050_000);
    });

    it('applies long-context rates for other GPT-5 long-context models (terra, luna, 5.4)', () => {
      for (const model of ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4']) {
        const std = resolveModelRate(model, 272_000);
        expect(std.id).not.toContain(':long');

        const long = resolveModelRate(model, 272_001);
        expect(long.id).toContain(':long');
        const profile = resolveModelProfile(model);
        expect(long.inputPerMtok).toBe(profile.pricing.inputPerMtok * 2);
        expect(long.outputPerMtok).toBe(profile.pricing.outputPerMtok * 1.5);
      }
    });

    it('does NOT apply long-context pricing to non-GPT-5 models even at >272,000 tokens', () => {
      const fable = resolveModelRate('claude-fable-5', 500_000);
      expect(fable.id).toBe('anthropic:claude-fable-5');
      expect(fable.inputPerMtok).toBe(10);
      expect(fable.outputPerMtok).toBe(50);

      const codex = resolveModelRate('gpt-5.3-codex', 300_000);
      expect(codex.id).toBe('openai:gpt-5.3-codex');
      expect(codex.inputPerMtok).toBe(2);

      const grok = resolveModelRate('grok-4.5', 400_000);
      expect(grok.id).toBe('xai:grok-4.5');
      expect(grok.inputPerMtok).toBe(2);

      const nim = resolveModelRate('nvidia/nemotron-3-ultra-550b-a55b', 500_000);
      expect(nim.id).toBe('nvidia:nemotron-3-ultra-550b-a55b');
    });

    it('preserves quota_only status when long-context GPT-5 models use subscription lanes or agy- prefix', () => {
      const agySolLong = resolveModelRate('agy-gpt-5.6-sol', 300_000);
      expect(agySolLong.status).toBe('quota_only');
      expect(agySolLong.id).toBe('agy:gpt-5.6-sol');

      const subLaneSolLong = resolveModelRate('gpt-5.6-sol', 300_000, {
        billingLane: 'codex_subscription',
        billingLaneSource: 'configured_route',
      });
      expect(subLaneSolLong.status).toBe('quota_only');
    });
  });

  describe('2. Runtime Config Overrides via applyRuntimeConfigOverrides', () => {
    it('overrides pricing, contextWindowTokens, and status on built-in models', () => {
      applyRuntimeConfigOverrides({
        modelProfiles: {
          'gpt-5.6-sol': {
            contextWindowTokens: 524_288,
            pricing: {
              inputPerMtok: 8,
              outputPerMtok: 40,
            },
          },
        },
      });

      const profile = resolveModelProfile('gpt-5.6-sol');
      expect(profile.contextWindowTokens).toBe(524_288);
      expect(profile.pricing.inputPerMtok).toBe(8);
      expect(profile.pricing.outputPerMtok).toBe(40);

      // Verify that resolveModelRate reflects the override (8 * 2 = 16 for long context)
      const stdRate = resolveModelRate('gpt-5.6-sol', 100_000);
      expect(stdRate.inputPerMtok).toBe(8);

      const longRate = resolveModelRate('gpt-5.6-sol', 300_000);
      expect(longRate.inputPerMtok).toBe(16);
      expect(longRate.outputPerMtok).toBe(60); // 40 * 1.5
    });

    it('adds aliases and registers new custom models when canonicalId and family are given', () => {
      applyRuntimeConfigOverrides({
        models: {
          'claude-fable-5': {
            aliases: ['my-custom-fable-alias'],
          },
          'new-test-model-xyz': {
            canonicalId: 'new-test-model-xyz',
            family: 'openai',
            displayName: 'New Test Model XYZ',
            contextWindowTokens: 800_000,
            pricing: {
              inputPerMtok: 1.5,
              outputPerMtok: 4.5,
            },
          },
        },
      });

      const aliasProfile = resolveModelProfile('my-custom-fable-alias');
      expect(aliasProfile.canonicalId).toBe('claude-fable-5');

      const newModel = resolveModelProfile('new-test-model-xyz');
      expect(newModel.canonicalId).toBe('new-test-model-xyz');
      expect(newModel.displayName).toBe('New Test Model XYZ');
      expect(newModel.contextWindowTokens).toBe(800_000);
    });
  });

  describe('3. Applicability Checks (isPxpipeSupportedModel, canEnableFromDashboard)', () => {
    it('uses default scope (claude-fable-5, claude-opus-5) when PXPIPE_MODELS is unset', () => {
      delete process.env.PXPIPE_MODELS;

      expect(getAllowedModelBases()).toEqual(['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-haiku-4-5', 'grok-4.6']);
      expect(isPxpipeSupportedModel('claude-fable-5')).toBe(true);
      expect(isPxpipeSupportedModel('claude-fable-5-20260601')).toBe(true);
      expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(false);
      expect(isPxpipeSupportedModel('claude-opus-5')).toBe(true);
    });

    it('evaluates canEnableFromDashboard correctly based on reader validation status and configured bases', () => {
      delete process.env.PXPIPE_MODELS;

      // Validated reader can always be enabled from dashboard
      expect(readerValidation('claude-fable-5').status).toBe('validated');
      expect(canEnableFromDashboard('claude-fable-5')).toBe(true);

      // Degraded/unvalidated readers CANNOT be enabled from dashboard by default
      expect(readerValidation('gpt-5.6-sol').status).toBe('degraded');
      expect(canEnableFromDashboard('gpt-5.6-sol')).toBe(false);

      // claude-opus-5 is a validated reader at its 9x12 render profile, so it is
      // enable-able regardless of the configured scope (see model-registry).
      expect(readerValidation('claude-opus-5').status).toBe('validated');
      expect(canEnableFromDashboard('claude-opus-5')).toBe(true);

      // But if PXPIPE_MODELS explicitly opts them in via environment, canEnableFromDashboard becomes true
      process.env.PXPIPE_MODELS = 'claude-fable-5,gpt-5.6-sol';
      expect(getConfiguredModelBases()).toEqual(['claude-fable-5', 'gpt-5.6-sol']);
      expect(canEnableFromDashboard('gpt-5.6-sol')).toBe(true);
      expect(canEnableFromDashboard('claude-opus-5')).toBe(true);
    });

    it('respects runtime dashboard overrides via setAllowedModelBases', () => {
      delete process.env.PXPIPE_MODELS;

      expect(isPxpipeSupportedModel('gpt-5.5')).toBe(false);

      // Dashboard runtime override
      setAllowedModelBases(['claude-fable-5', 'gpt-5.5']);
      expect(getAllowedModelBases()).toEqual(['claude-fable-5', 'gpt-5.5']);
      expect(isPxpipeSupportedModel('gpt-5.5')).toBe(true);
      expect(isPxpipeSupportedGptModel('gpt-5.5-2026-04-23')).toBe(true);

      // Reset runtime override
      setAllowedModelBases(null);
      expect(getAllowedModelBases()).toEqual(['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-haiku-4-5', 'grok-4.6']);
      expect(isPxpipeSupportedModel('gpt-5.5')).toBe(false);
    });

    it('handles PXPIPE_MODELS=off or falsey strings correctly', () => {
      process.env.PXPIPE_MODELS = 'off';
      expect(getAllowedModelBases()).toEqual([]);
      expect(isPxpipeSupportedModel('claude-fable-5')).toBe(false);

      process.env.PXPIPE_MODELS = '0';
      expect(getAllowedModelBases()).toEqual([]);

      process.env.PXPIPE_MODELS = 'false';
      expect(getAllowedModelBases()).toEqual([]);
    });
  });
});
