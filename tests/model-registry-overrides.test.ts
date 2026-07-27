import { describe, expect, it } from 'vitest';
import {
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  resolveModelProfile,
  BUILTIN_CATALOG,
} from '../src/core/model-registry.js';

describe('model-registry runtime overrides', () => {
  it('applies overrides directly to suffix-qualified model profiles without creating duplicate/dynamic fallback entries', () => {
    const initialProfiles = getAllModelProfiles();
    const initialCount = initialProfiles.length;
    expect(initialCount).toBe(BUILTIN_CATALOG.length);

    // Override built-in suffix-qualified profiles via exact canonical IDs and alias keys
    applyRuntimeConfigOverrides({
      modelProfiles: {
        'agy-gemini-3.6-flash-high': {
          contextWindowTokens: 3_000_000,
          status: 'validated',
          pricing: {
            inputPerMtok: 0.99,
            outputPerMtok: 1.99,
          },
        },
        'gemini-3.6-flash-medium': {
          contextWindowTokens: 2_500_000,
          status: 'validated',
        },
        'agy/gemini-3.6-flash-low': {
          contextWindowTokens: 2_100_000,
        },
        'nvidia/nemotron-3-ultra-550b-a55b': {
          contextWindowTokens: 1_200_000,
          pricing: {
            inputPerMtok: 0.05,
            outputPerMtok: 0.10,
          },
        },
        'nemotron-3-ultra-550b': { // alias for nvidia/nemotron-3-ultra-550b-a55b
          factsheetEnabled: true,
        },
        'grok-4.5-thinking': { // alias for grok-4.5
          maxOutputTokens: 200_000,
        },
      },
    });

    const updatedProfiles = getAllModelProfiles();
    expect(updatedProfiles.length).toBe(initialCount);

    // Verify agy-gemini-3.6-flash-high override applied directly
    const highProfile = resolveModelProfile('agy-gemini-3.6-flash-high');
    expect(highProfile.canonicalId).toBe('agy-gemini-3.6-flash-high');
    expect(highProfile.contextWindowTokens).toBe(3_000_000);
    expect(highProfile.status).toBe('validated');
    expect(highProfile.pricing.inputPerMtok).toBe(0.99);
    expect(highProfile.pricing.outputPerMtok).toBe(1.99);

    // Verify alias resolution for overridden profile
    const highAliasProfile = resolveModelProfile('gemini-3.6-flash-high');
    expect(highAliasProfile.canonicalId).toBe('agy-gemini-3.6-flash-high');
    expect(highAliasProfile.contextWindowTokens).toBe(3_000_000);

    // Verify agy-gemini-3.6-flash-medium override via alias key
    const medProfile = resolveModelProfile('agy-gemini-3.6-flash-medium');
    expect(medProfile.canonicalId).toBe('agy-gemini-3.6-flash-medium');
    expect(medProfile.contextWindowTokens).toBe(2_500_000);
    expect(medProfile.status).toBe('validated');

    // Verify agy-gemini-3.6-flash-low override via slash alias key
    const lowProfile = resolveModelProfile('agy-gemini-3.6-flash-low');
    expect(lowProfile.canonicalId).toBe('agy-gemini-3.6-flash-low');
    expect(lowProfile.contextWindowTokens).toBe(2_100_000);

    // Verify nvidia flagship override
    const nemoProfile = resolveModelProfile('nvidia/nemotron-3-ultra-550b-a55b');
    expect(nemoProfile.canonicalId).toBe('nvidia/nemotron-3-ultra-550b-a55b');
    expect(nemoProfile.contextWindowTokens).toBe(1_200_000);
    expect(nemoProfile.pricing.inputPerMtok).toBe(0.05);

    // Verify alias override updated built-in grok-4.5 profile
    const grokProfile = resolveModelProfile('grok-4.5');
    expect(grokProfile.canonicalId).toBe('grok-4.5');
    expect(grokProfile.maxOutputTokens).toBe(200_000);

    // Ensure no dynamic fallback profiles exist in the catalog list
    const fallbackInCatalog = updatedProfiles.some(p => p.displayName === p.canonicalId && !BUILTIN_CATALOG.some(b => b.canonicalId === p.canonicalId));
    expect(fallbackInCatalog).toBe(false);
  });

  it('handles config under different config root keys (PXPIPE_MODELS_CONFIG / models / modelProfiles)', () => {
    applyRuntimeConfigOverrides({
      PXPIPE_MODELS_CONFIG: {
        'claude-fable-5': {
          displayName: 'Fable 5 Overridden',
        },
      },
    });
    expect(resolveModelProfile('claude-fable-5').displayName).toBe('Fable 5 Overridden');

    applyRuntimeConfigOverrides({
      models: {
        'gpt-5.6-sol': {
          displayName: 'GPT 5.6 Sol Overridden',
        },
      },
    });
    expect(resolveModelProfile('gpt-5.6-sol').displayName).toBe('GPT 5.6 Sol Overridden');
  });

  it('creates new profile only when canonicalId and family are explicitly provided for a genuinely new model', () => {
    const countBefore = getAllModelProfiles().length;
    applyRuntimeConfigOverrides({
      modelProfiles: {
        'custom-brand-new-model': {
          canonicalId: 'custom-brand-new-model',
          family: 'openai',
          displayName: 'Custom Brand New Model',
          contextWindowTokens: 500_000,
        },
      },
    });
    const countAfter = getAllModelProfiles().length;
    expect(countAfter).toBe(countBefore + 1);
    const customProfile = resolveModelProfile('custom-brand-new-model');
    expect(customProfile.displayName).toBe('Custom Brand New Model');
    expect(customProfile.contextWindowTokens).toBe(500_000);
  });
});
