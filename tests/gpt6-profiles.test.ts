/**
 * Unit tests for GPT-6 model profiles, identification, and vision pricing.
 */
import { describe, expect, it } from 'vitest';
import { resolveGptProfile, isMisresolvedModelId } from '../src/core/gpt-model-profiles.js';

describe('GPT-6 Model Profiles & Resolution', () => {
  it('resolves gpt-6-astra with native 14px geometry and patch pricing', () => {
    const prof = resolveGptProfile('gpt-6-astra');
    expect(prof.vision.regime).toBe('patch');
    if (prof.vision.regime === 'patch') {
      expect(prof.vision.multiplier).toBe(1);
    }
    expect(prof.stripCols).toBe(84);
    expect(prof.maxHeightPx).toBe(1954);
    expect(prof.style.font).toBe('jetbrains-mono-14');
    expect(prof.exactStaticBaseline).toBe(true);
    expect(prof.cacheReadRate).toBe(0.5);
    expect(prof.outputRate).toBe(5);
    expect(prof.history?.maxImages).toBe(64);
    expect(isMisresolvedModelId('gpt-6-astra')).toBe(false);
  });

  it('resolves gpt-6-sol with native 14px geometry and 50% cache discount', () => {
    const prof = resolveGptProfile('gpt-6-sol');
    expect(prof.vision.regime).toBe('patch');
    if (prof.vision.regime === 'patch') {
      expect(prof.vision.multiplier).toBe(1);
    }
    expect(prof.stripCols).toBe(84);
    expect(prof.maxHeightPx).toBe(1954);
    expect(prof.style.font).toBe('jetbrains-mono-14');
    expect(prof.cacheReadRate).toBe(0.5);
    expect(prof.outputRate).toBe(5);
    expect(isMisresolvedModelId('gpt-6-sol')).toBe(false);
  });

  it('resolves gpt-6-luna with fast tier patch pricing and 50% cache discount', () => {
    const prof = resolveGptProfile('gpt-6-luna');
    expect(prof.vision.regime).toBe('patch');
    if (prof.vision.regime === 'patch') {
      expect(prof.vision.multiplier).toBe(1);
      expect(prof.vision.patchCap).toBe(10000);
    }
    expect(prof.cacheReadRate).toBe(0.5);
    expect(prof.outputRate).toBe(4);
    expect(isMisresolvedModelId('gpt-6-luna')).toBe(false);
  });

  it('resolves gpt-6-terra to Gen 6 patch regime without legacy downgrade', () => {
    const prof = resolveGptProfile('gpt-6-terra');
    expect(prof.vision.regime).toBe('patch');
    if (prof.vision.regime === 'patch') {
      expect(prof.vision.multiplier).toBe(1);
    }
    expect(prof.cacheReadRate).toBe(0.5);
    expect(isMisresolvedModelId('gpt-6-terra')).toBe(false);
  });
});
