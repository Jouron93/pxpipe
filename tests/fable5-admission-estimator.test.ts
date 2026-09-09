import { describe, it, expect } from 'vitest';
import {
  evaluateCandidateBlockAdmission,
  recordCandidateBlockInstrumentation,
  type TransformInfo,
} from '../src/core/transform.js';
import { resolveModelRate } from '../src/core/model-pricing.js';
import { renderStatsTableFragment } from '../src/dashboard/fragments.js';
import { toTrackEvent } from '../src/core/tracker.js';
import negativeFixtures from './fixtures/negative_events_replay.json';

describe('T-232 PXPIPE Fable-5 Admission Estimator & Diagnostics', () => {
  it('rejects the -96,942 negative event and routes as TEXT through evaluateCandidateBlockAdmission', () => {
    const f96k = negativeFixtures.find((f: any) => f.line === 67780);
    expect(f96k).toBeDefined();

    const ev = f96k!.event;
    // History text is 898,038 chars
    const historyText = 'A'.repeat(ev.orig_chars);
    const admission = evaluateCandidateBlockAdmission(
      'history',
      historyText,
      384,
      undefined,
      1,
      3.5,
      ev.baseline_cacheable_tokens, // priorWarmTokens (warm cache)
      0,
      true,
      undefined,
      undefined,
      10, // horizon
    );

    expect(admission.decision).toBe('TEXT');
    expect(admission.profitable).toBe(false);
    expect(admission.predictedCacheAwareActualTokens).toBeGreaterThan(admission.predictedCacheAwareBaselineTokens);
  });

  it('rejects 100% of the historical negative replay fixtures and defaults to TEXT', () => {
    let rejectedCount = 0;
    for (const fixture of negativeFixtures) {
      const ev = fixture.event;
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

      if (admission.decision === 'TEXT') {
        rejectedCount++;
      }
    }

    expect(rejectedCount).toBe(negativeFixtures.length);
  });

  it('correctly instruments candidate blocks in TransformInfo and TrackEvent', () => {
    const dummyInfo: TransformInfo = {
      compressed: false,
      origChars: 50000,
      compressedChars: 0,
      imageCount: 0,
      imageBytes: 0,
      staticChars: 0,
      dynamicChars: 0,
      dynamicBlockCount: 0,
    };

    const admission = evaluateCandidateBlockAdmission(
      'static_slab',
      'System prompt text '.repeat(1000),
      384,
      undefined,
      1,
      4,
      0, // cold
      0,
      false,
    );

    recordCandidateBlockInstrumentation(dummyInfo, admission, 'static_slab');
    expect(dummyInfo.candidateBlocks).toHaveLength(1);
    expect(dummyInfo.candidateBlocks![0]).toMatchObject({
      kind: 'static_slab',
      cacheStateBeforeTransform: 'cold',
      decision: expect.stringMatching(/^(IMAGE|TEXT)$/),
    });
    expect(dummyInfo.candidateBlocks![0]!.sourceChars).toBeGreaterThan(0);
    expect(dummyInfo.candidateBlocks![0]!.sourceTextTokens).toBeGreaterThan(0);

    const trackEvent = toTrackEvent({
      method: 'POST',
      path: '/v1/messages',
      status: 200,
      durationMs: 100,
      billingLane: 'claude_max_subscription',
      billingLaneSource: 'anthropic_oauth_marker',
      info: dummyInfo,
    });

    expect(trackEvent.candidate_blocks).toBeDefined();
    expect(trackEvent.candidate_blocks).toHaveLength(1);
  });

  it('formats bytes / char in renderStatsTableFragment without 100x multiplier', () => {
    const html = renderStatsTableFragment({
      parsed: 100,
      summary: {
        total: 100,
        ok2xx: 100,
        err4xx: 0,
        err5xx: 0,
        compressed: 80,
        passthrough: 20,
        inputTokensTotal: 10000,
        cacheCreateTokensTotal: 5000,
        cacheReadTokensTotal: 50000,
        outputTokensTotal: 2000,
        eventsWithBaseline: 100,
        cacheHitEvents: 80,
        origCharsTotal: 1_829_171_302,
        imageBytesTotal: 82_418_659_563,
        durationP50: 100,
        durationP95: 200,
        firstByteP50: 50,
        firstByteP95: 100,
      },
    } as any);

    // 82,418,659,563 / 1,829,171,302 = 45.058x
    expect(html).toContain('45.058x');
    expect(html).not.toContain('4505.792x');
  });

  it('correctly attributes claude_max_subscription to claude: prefix and Claude Max subscription lane', () => {
    const rate = resolveModelRate('claude-fable-5', 100_000, {
      billingLane: 'claude_max_subscription',
      billingLaneSource: 'anthropic_oauth_marker',
    });

    expect(rate.id).toBe('claude:claude-fable-5');
    expect(rate.status).toBe('quota_only');
    expect(rate.note).toContain('Claude Max subscription lane');
    expect(rate.note).not.toContain('AGY subscription lane');
  });

  it('correctly attributes codex_subscription to codex: prefix and Codex subscription lane', () => {
    const rate = resolveModelRate('gpt-5.6-sol', 100_000, {
      billingLane: 'codex_subscription',
      billingLaneSource: 'chatgpt_codex_origin',
    });

    expect(rate.id).toBe('codex:gpt-5.6-sol');
    expect(rate.status).toBe('quota_only');
    expect(rate.note).toContain('Codex subscription lane');
    expect(rate.note).not.toContain('AGY subscription lane');
  });
});
