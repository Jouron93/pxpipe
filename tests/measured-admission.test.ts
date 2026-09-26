/**
 * Measured-loss revert on the Anthropic Messages lane.
 *
 * Live motivation (2026-09-26, ~/.pxpipe/events.jsonl): claude-haiku-4-5 billed
 * more than its count_tokens plain-text baseline on 40/40 imaged requests
 * (-9.9%), and pxpipe kept imaging it because the probe was telemetry only.
 *
 *   pnpm vitest run tests/measured-admission.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';
import {
  MeasuredAdmission,
  anthropicBilledInputTokens,
  measuredRevertEnabled,
} from '../src/core/measured-admission.js';

describe('MeasuredAdmission (unit)', () => {
  it('trips only after minSamples and only when billed exceeds baseline by the margin', () => {
    let t = 1_000;
    const m = new MeasuredAdmission({ window: 4, minSamples: 3, lossMargin: 0.02, cooldownMs: 60_000, now: () => t });
    expect(m.record('claude-haiku-4-5', 110, 100)).toBe(false);
    expect(m.record('claude-haiku-4-5', 110, 100)).toBe(false);
    expect(m.shouldBypass('claude-haiku-4-5')).toBe(false);
    expect(m.record('claude-haiku-4-5', 110, 100)).toBe(true);
    expect(m.shouldBypass('claude-haiku-4-5')).toBe(true);
    // case-insensitive, and other models are unaffected
    expect(m.shouldBypass('CLAUDE-HAIKU-4-5')).toBe(true);
    expect(m.shouldBypass('claude-opus-5-5')).toBe(false);
    t += 60_001;
    expect(m.shouldBypass('claude-haiku-4-5')).toBe(false);
    expect(m.snapshot()['claude-haiku-4-5']).toMatchObject({ trips: 1, samples: 0, bypassUntil: null });
  });

  it('does not trip inside the margin, or on a saving', () => {
    const m = new MeasuredAdmission({ minSamples: 3, lossMargin: 0.02 });
    for (let i = 0; i < 8; i++) expect(m.record('a', 101, 100)).toBe(false); // +1% < 2%
    for (let i = 0; i < 8; i++) expect(m.record('b', 80, 100)).toBe(false);
    expect(m.shouldBypass('a')).toBe(false);
    expect(m.shouldBypass('b')).toBe(false);
  });

  it('judges the window in aggregate, so one bad request among savings does not trip', () => {
    const m = new MeasuredAdmission({ window: 4, minSamples: 4 });
    m.record('m', 80, 100);
    m.record('m', 80, 100);
    m.record('m', 80, 100);
    expect(m.record('m', 150, 100)).toBe(false); // 390 vs 400
    expect(m.shouldBypass('m')).toBe(false);
  });

  it('ignores unusable samples', () => {
    const m = new MeasuredAdmission({ minSamples: 1 });
    expect(m.record(undefined, 200, 100)).toBe(false);
    expect(m.record('m', 200, 0)).toBe(false);
    expect(m.record('m', Number.NaN, 100)).toBe(false);
    expect(m.record('m', -1, 100)).toBe(false);
    expect(m.shouldBypass('m')).toBe(false);
  });

  it('sums the three disjoint Anthropic input buckets', () => {
    expect(anthropicBilledInputTokens({ input_tokens: 10, cache_creation_input_tokens: 43_880, cache_read_input_tokens: 113_299 }))
      .toBe(157_189);
    expect(anthropicBilledInputTokens({ input_tokens: 2 })).toBe(2);
    expect(anthropicBilledInputTokens({})).toBeNull();
    expect(anthropicBilledInputTokens(undefined)).toBeNull();
  });

  it('PXPIPE_MEASURED_REVERT=0 disables; unset or anything else enables', () => {
    expect(measuredRevertEnabled({})).toBe(true);
    expect(measuredRevertEnabled({ PXPIPE_MEASURED_REVERT: '1' })).toBe(true);
    for (const off of ['0', 'false', 'OFF', ' no ']) {
      expect(measuredRevertEnabled({ PXPIPE_MEASURED_REVERT: off })).toBe(false);
    }
  });
});

// ── end to end through the real proxy ──────────────────────────────────────

let ambientPxpipeModels: string | undefined;
beforeAll(() => {
  ambientPxpipeModels = process.env.PXPIPE_MODELS;
  process.env.PXPIPE_MODELS = 'claude-fable-5';
});
afterAll(() => {
  if (ambientPxpipeModels === undefined) delete process.env.PXPIPE_MODELS;
  else process.env.PXPIPE_MODELS = ambientPxpipeModels;
});

const BASELINE = 20_000; // canned count_tokens answer for the ORIGINAL body

function fakeUpstream(billedInput: number) {
  const main: { body: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(req.url).pathname.endsWith('/count_tokens')) {
      return new Response(JSON.stringify({ input_tokens: BASELINE }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    main.push({ body: await req.clone().text() });
    return new Response(JSON.stringify({
      id: 'm1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-fable-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, cache_creation_input_tokens: billedInput - 10, cache_read_input_tokens: 0, output_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { main, restore: () => { globalThis.fetch = real; } };
}

const slab = (n: number): string =>
  '# CLAUDE.md\nYou are a helpful coding assistant.\n' + 'Follow the rules carefully. '.repeat(Math.ceil(n / 28));

const body = JSON.stringify({
  model: 'claude-fable-5',
  max_tokens: 16,
  system: [{ type: 'text', text: slab(80_000), cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'hello' }],
});

async function drive(
  proxy: (r: Request) => Promise<Response>,
  events: ProxyEvent[],
): Promise<ProxyEvent> {
  const before = events.length;
  const res = await proxy(new Request('http://127.0.0.1/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }));
  await res.text();
  for (let i = 0; i < 50 && events.length === before; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(events.length).toBe(before + 1);
  return events[events.length - 1]!;
}

function makeProxy(measuredAdmission: MeasuredAdmission | false, events: ProxyEvent[]) {
  return createProxy({
    upstream: 'http://anthropic.test',
    apiKey: 'sk-ant',
    transform: {},
    measuredAdmission,
    onRequest: (e) => { events.push(e); },
  });
}

describe('measured-loss revert through the real proxy', () => {
  it('a model that bills MORE than baseline is passed through after minSamples, then re-measured after the cooldown', async () => {
    const up = fakeUpstream(BASELINE * 1.2); // imaging measured 20% worse than text
    let t = 0;
    const admission = new MeasuredAdmission({ minSamples: 2, cooldownMs: 1_000, now: () => t });
    const events: ProxyEvent[] = [];
    const proxy = makeProxy(admission, events);
    try {
      const e1 = await drive(proxy, events);
      expect(e1.info?.compressed).toBe(true);
      expect(e1.info?.baselineTokens).toBe(BASELINE);
      const e2 = await drive(proxy, events);
      expect(e2.info?.compressed).toBe(true);
      expect(admission.shouldBypass('claude-fable-5')).toBe(true);

      const e3 = await drive(proxy, events);
      expect(e3.info?.compressed).toBe(false);
      expect(e3.info?.reason).toBe('measured_loss');
      // forwarded byte-for-byte: no image parts reached the upstream
      expect(up.main.at(-1)!.body).not.toContain('"type":"image"');
      expect(JSON.parse(up.main.at(-1)!.body)).toEqual(JSON.parse(body));

      t += 1_001;
      const e4 = await drive(proxy, events);
      expect(e4.info?.compressed).toBe(true);
    } finally {
      up.restore();
    }
  });

  it('CONTROL: a model that bills LESS than baseline keeps being imaged', async () => {
    const up = fakeUpstream(BASELINE * 0.6);
    const admission = new MeasuredAdmission({ minSamples: 2 });
    const events: ProxyEvent[] = [];
    const proxy = makeProxy(admission, events);
    try {
      for (let i = 0; i < 4; i++) {
        const e = await drive(proxy, events);
        expect(e.info?.compressed).toBe(true);
      }
      expect(admission.shouldBypass('claude-fable-5')).toBe(false);
    } finally {
      up.restore();
    }
  });

  it('measuredAdmission: false leaves the old behaviour (always imaged)', async () => {
    const up = fakeUpstream(BASELINE * 2);
    const events: ProxyEvent[] = [];
    const proxy = makeProxy(false, events);
    try {
      for (let i = 0; i < 4; i++) {
        const e = await drive(proxy, events);
        expect(e.info?.compressed).toBe(true);
        expect(e.info?.reason).not.toBe('measured_loss');
      }
    } finally {
      up.restore();
    }
  });
});
