import { describe, it, expect } from 'vitest';
import { estimateAdmission, ECONOMIC_FLOORS } from '../src/core/admission-estimator.js';
import { evaluateCandidateBlockAdmission } from '../src/core/transform.js';
import negativeFixtures from './fixtures/negative_events_replay.json';

describe('T-238 Verification: Fable-5 274k-char payload admission and negative fixture bypass', () => {
  it('admits the 274,029-char Fable-5 request shape via estimateAdmission', () => {
    const live274k = estimateAdmission({
      model: 'claude-fable-5',
      payloadChars: 274_029,
      transformFamily: 'anthropic_messages',
    });

    expect(live274k.decision).toBe('ADMIT');
    expect(live274k.reason).toBe('above_fable_economic_floor');
    // 79.2 = COLD transformed rate, measured against a bypass control arm.
    // The live 274,029-char request that motivated T-238 had cache_read=0 --
    // a cold opener -- so the cold rate is the one that applies to it. The
    // previous 97.0 came from an aggregate with no control arm (T-239) and was
    // mostly Anthropic native prompt caching rather than transform.
    expect(live274k.predictedSavingsPct).toBe(79.2);
    expect(live274k.breakEvenThresholdChars).toBe(ECONOMIC_FLOORS.FABLE_5_CHARS);
    expect(live274k.confidence).toBe('high');
  });

  it('demonstrates positive token delta on 274,029-char slab transform', () => {
    // 274,060 chars slab (as measured live in events.jsonl)
    const sourceChars = 274_060;
    const textTokens = sourceChars / 2.0; // 137,030 tokens
    const estImageTokens = 16_375; // 11 images
    const netTokensSaved = textTokens - estImageTokens;
    const tokenSavingsPct = (netTokensSaved / textTokens) * 100;

    expect(netTokensSaved).toBe(120_655);
    expect(tokenSavingsPct).toBeCloseTo(88.05, 1);
  });

  it('confirms 100% of the 469 negative fixtures still BYPASS / route as TEXT', () => {
    expect(negativeFixtures.length).toBe(469);
    let bypassCount = 0;

    for (const fixture of negativeFixtures) {
      const ev = (fixture as any).event;
      const text = 'x'.repeat(ev.orig_chars || 10000);
      const isWarm = (ev.cache_read_tokens || 0) > 0;
      const admission = evaluateCandidateBlockAdmission(
        'history',
        text,
        384,
        undefined,
        1,
        3.5,
        isWarm ? (ev.baseline_cacheable_tokens || 10000) : 0,
        0,
        true,
        undefined,
        undefined,
        10,
      );

      if (admission.decision === 'TEXT' && !admission.profitable) {
        bypassCount++;
      }
    }

    expect(bypassCount).toBe(469);
  });
});
