/**
 * Byte-fitted history collapse must be STABLE across turns of one session.
 *
 * A history whose full collapse overflows `maxImageBytes` is trimmed to a smaller
 * page budget. That budget is pinned per session: re-deriving it every request
 * made the collapse boundary flip between two states as the conversation grew,
 * and each flip re-wrote the whole cached image prefix (measured live on
 * claude-opus-5-5, 2026-09-27).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { transformRequest } from '../src/core/transform.js';
import {
  recordHistoryByteBudget,
  resetSessionState,
  stickyHistoryByteBudget,
} from '../src/core/session-state.js';

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const dec = (b: Uint8Array): any => JSON.parse(new TextDecoder().decode(b));

function turn(i: number) {
  const body = Array.from({ length: 60 }, (_, k) => `turn ${i} line ${k}: value_${i}_${k} = compute(${i * k}, "side-${k % 3}")`).join('\n');
  return [
    { role: 'assistant', content: [{ type: 'text', text: `step ${i}: ${body}` }] },
    { role: 'user', content: [{ type: 'text', text: `continue ${i}` }] },
  ];
}

function request(turns: number) {
  const messages: unknown[] = [{ role: 'user', content: [{ type: 'text', text: 'start the task' }] }];
  for (let i = 0; i < turns; i++) messages.push(...turn(i));
  return enc({
    model: 'claude-fable-5',
    system: [{ type: 'text', text: 'SLAB\n' + 'The system prompt line with words. '.repeat(2000) }],
    messages,
  });
}

/** First-image sha of the history run: identical when the collapsed prefix is byte-stable. */
function historyImages(body: Uint8Array): string[] {
  const out: string[] = [];
  for (const m of dec(body).messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) if (b.type === 'image') out.push(b.source.data.slice(0, 64) + b.source.data.length);
  }
  return out;
}

describe('sticky byte-fit history budget', () => {
  beforeEach(() => resetSessionState());

  it('pins a budget and keeps earlier history pages identical on the next turn', async () => {
    // Find the byte weight of an unconstrained collapse, then give the session a
    // budget that only fits part of it so the byte-fit trim has to engage.
    const free = await transformRequest(request(120), { model: 'claude-fable-5', maxImageBytes: 256 * 1024 * 1024 });
    const full = free.info.imageBytes;
    expect(free.info.historyReason).toBe('collapsed');
    resetSessionState();

    const maxImageBytes = Math.floor(full * 0.6);
    const a = await transformRequest(request(120), { model: 'claude-fable-5', maxImageBytes });
    expect(a.info.historyReason).toBe('collapsed');
    expect(a.info.historyBudgetTrimmed).toBe(true);
    const key = a.info.firstUserSha8;
    const pinned = stickyHistoryByteBudget(key);
    expect(pinned).toBeGreaterThan(0);

    // The conversation grows; the pinned budget must hold and the already-collapsed
    // pages must come out byte-identical (same prefix, same cache).
    const b = await transformRequest(request(128), { model: 'claude-fable-5', maxImageBytes });
    expect(b.info.historyReason).toBe('collapsed');
    expect(stickyHistoryByteBudget(key)).toBe(pinned);
    const ia = historyImages(a.body);
    const ib = historyImages(b.body);
    expect(ib.slice(0, ia.length)).toEqual(ia);
  });

  it('only lowers a pin while the cache lives, and a cold session may raise it', () => {
    recordHistoryByteBudget('s1', 40);
    recordHistoryByteBudget('s1', 55);
    expect(stickyHistoryByteBudget('s1')).toBe(40);
    recordHistoryByteBudget('s1', 30);
    expect(stickyHistoryByteBudget('s1')).toBe(30);
    recordHistoryByteBudget('s1', 60, true);
    expect(stickyHistoryByteBudget('s1')).toBe(60);
  });
});
