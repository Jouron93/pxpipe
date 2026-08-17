import { describe, it, expect } from 'vitest';
import {
  estimateAdmission,
  ECONOMIC_FLOORS,
} from '../src/core/admission-estimator.js';

describe('PXPIPE-REQ-01: Admission Estimator Unit Tests', () => {
  it('ADMITs Fable-5 above 25k chars and BYPASSes below 25k chars', () => {
    const smallFable = estimateAdmission({
      model: 'claude-fable-5',
      payloadChars: 10_000,
    });
    expect(smallFable.decision).toBe('BYPASS');
    expect(smallFable.reason).toBe('below_fable_economic_floor');

    const hugeFable = estimateAdmission({
      model: 'claude-fable-5',
      payloadChars: 274_000,
    });
    expect(hugeFable.decision).toBe('ADMIT');
    expect(hugeFable.reason).toBe('above_fable_economic_floor');
    // COLD transformed rate, measured against a bypass control arm (T-239).
    // NOT the warm 97.5%: that figure had no control and was mostly Anthropic
    // native prompt caching, and it is unreachable on the cold openers this
    // branch exists to admit.
    expect(hugeFable.predictedSavingsPct).toBe(79.2);
    expect(hugeFable.confidence).toBe('high');
  });

  it('ADMITs Opus-5 above 50k chars and BYPASSes below 50k chars', () => {
    const smallOpus = estimateAdmission({
      model: 'claude-opus-5',
      payloadChars: 30_000,
    });
    expect(smallOpus.decision).toBe('BYPASS');
    expect(smallOpus.reason).toBe('below_opus_economic_floor');

    const largeOpus = estimateAdmission({
      model: 'claude-opus-5',
      payloadChars: 75_000,
    });
    expect(largeOpus.decision).toBe('ADMIT');
    expect(largeOpus.reason).toBe('above_opus_economic_floor');
    expect(largeOpus.predictedSavingsPct).toBeGreaterThan(0);
  });

  it('ADMITs Sonnet-5 above 200k chars and BYPASSes below 200k chars', () => {
    const mediumSonnet = estimateAdmission({
      model: 'claude-sonnet-5',
      payloadChars: 85_000,
    });
    expect(mediumSonnet.decision).toBe('BYPASS');
    expect(mediumSonnet.reason).toBe('below_sonnet_economic_floor');

    const massiveSonnet = estimateAdmission({
      model: 'claude-sonnet-5',
      payloadChars: 250_000,
    });
    expect(massiveSonnet.decision).toBe('ADMIT');
    expect(massiveSonnet.reason).toBe('above_sonnet_economic_floor');
  });

  it('ADMITs Codex GPT-5.6 above 25k chars and BYPASSes below 25k chars', () => {
    const smallCodex = estimateAdmission({
      model: 'gpt-5.6-sol',
      payloadChars: 15_000,
    });
    expect(smallCodex.decision).toBe('BYPASS');
    expect(smallCodex.reason).toBe('below_codex_economic_floor');

    const largeCodex = estimateAdmission({
      model: 'gpt-5.6-terra',
      payloadChars: 50_000,
    });
    expect(largeCodex.decision).toBe('ADMIT');
    expect(largeCodex.reason).toBe('above_codex_economic_floor');
  });

  it('ADMITs Grok above 25k chars and BYPASSes below 25k chars', () => {
    const smallGrok = estimateAdmission({
      model: 'grok-4.5',
      payloadChars: 10_000,
    });
    expect(smallGrok.decision).toBe('BYPASS');

    const largeGrok = estimateAdmission({
      model: 'grok-4.5',
      payloadChars: 40_000,
    });
    expect(largeGrok.decision).toBe('ADMIT');
  });

  it('BYPASSes unsupported or lightweight models like Haiku or GPT-4o', () => {
    const haiku = estimateAdmission({
      model: 'claude-haiku-4-5',
      payloadChars: 100_000,
    });
    expect(haiku.decision).toBe('BYPASS');
    expect(haiku.reason).toBe('unsupported_or_lightweight_model');

    const gpt4o = estimateAdmission({
      model: 'gpt-4o',
      payloadChars: 100_000,
    });
    expect(gpt4o.decision).toBe('BYPASS');
  });

  it('returns INSUFFICIENT_EVIDENCE on unknown model profiles or missing input', () => {
    const unknown = estimateAdmission({
      model: 'custom-unregistered-model-2026',
      payloadChars: 100_000,
    });
    expect(unknown.decision).toBe('INSUFFICIENT_EVIDENCE');

    const missing = estimateAdmission({
      model: null,
      payloadChars: 50_000,
    });
    expect(missing.decision).toBe('INSUFFICIENT_EVIDENCE');
  });
});
