/**
 * Anthropic cache_control TTL ORDERING contract.
 *
 * The API rejects a request with 400 when a `ttl:'1h'` block appears AFTER a
 * `ttl:'5m'` block, evaluated across the whole request in the documented
 * processing order: `tools`, then `system`, then `messages`.
 *
 * This is not hypothetical. On 2026-08-17 a live Claude Code session was wedged
 * by exactly this, five consecutive 400s on claude-fable-5, every one
 * compressed=true / reason=cache_preserving_partial:
 *
 *   400 messages.0.content.11.content.0.cache_control.ttl: a ttl='1h'
 *   cache_control block must not come after a ttl='5m' cache_control block.
 *
 * Note the path: content[11].content[0] -- a NESTED block inside a tool_result.
 * clampCacheControlMarkers() only walks top-level content, so it never saw it.
 * The session could not self-recover, because the ordering is a deterministic
 * function of conversation state and every retry rebuilt the same bad request.
 *
 * Run just this file:  pnpm vitest run tests/cache-ttl-order.test.ts
 */
import { describe, expect, it } from 'vitest';
import { normalizeCacheControlTtlOrder } from '../src/core/measurement.js';

const cc = (ttl?: '5m' | '1h') =>
  ttl === undefined ? { type: 'ephemeral' } : { type: 'ephemeral', ttl };

describe('normalizeCacheControlTtlOrder', () => {
  it('demotes a 1h marker that follows a 5m marker', () => {
    const req = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a', cache_control: cc('5m') }] },
        { role: 'user', content: [{ type: 'text', text: 'b', cache_control: cc('1h') }] },
      ],
    };
    expect(normalizeCacheControlTtlOrder(req)).toBe(1);
    expect((req.messages[1]!.content[0] as { cache_control: { ttl: string } }).cache_control.ttl).toBe('5m');
  });

  it('leaves a correctly ordered request untouched', () => {
    const req = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a', cache_control: cc('1h') }] },
        { role: 'user', content: [{ type: 'text', text: 'b', cache_control: cc('5m') }] },
      ],
    };
    expect(normalizeCacheControlTtlOrder(req)).toBe(0);
    expect((req.messages[0]!.content[0] as { cache_control: { ttl: string } }).cache_control.ttl).toBe('1h');
  });

  it('reaches a NESTED block -- the exact shape that wedged the live session', () => {
    // messages[0].content[11].content[0] : a tool_result carrying its own blocks.
    const nested = { type: 'text', text: 'deep', cache_control: cc('1h') };
    const filler = Array.from({ length: 11 }, (_, i) => ({ type: 'text', text: `f${i}` }));
    const req = {
      system: [{ type: 'text', text: 'sys', cache_control: cc('5m') }],
      messages: [
        {
          role: 'user',
          content: [...filler, { type: 'tool_result', tool_use_id: 't1', content: [nested] }],
        },
      ],
    };
    expect(normalizeCacheControlTtlOrder(req)).toBe(1);
    expect(nested.cache_control.ttl).toBe('5m');
  });

  it('honours tools -> system -> messages ordering, not array position', () => {
    const later = { type: 'text', text: 'm', cache_control: cc('1h') };
    const req = {
      tools: [{ name: 'x', cache_control: cc('5m') }],
      messages: [{ role: 'user', content: [later] }],
    };
    expect(normalizeCacheControlTtlOrder(req)).toBe(1);
    expect(later.cache_control.ttl).toBe('5m');
  });

  it('treats a missing ttl as 5m, since that is the API default', () => {
    const later = { type: 'text', text: 'b', cache_control: cc('1h') };
    const req = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a', cache_control: cc() }] },
        { role: 'user', content: [later] },
      ],
    };
    expect(normalizeCacheControlTtlOrder(req)).toBe(1);
    expect(later.cache_control.ttl).toBe('5m');
  });

  it('leaves an all-1h request alone', () => {
    const req = {
      system: [{ type: 'text', text: 's', cache_control: cc('1h') }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a', cache_control: cc('1h') }] }],
    };
    expect(normalizeCacheControlTtlOrder(req)).toBe(0);
  });

  it('is a no-op on requests with no markers at all', () => {
    expect(normalizeCacheControlTtlOrder({ messages: [{ role: 'user', content: 'plain' }] })).toBe(0);
    expect(normalizeCacheControlTtlOrder({})).toBe(0);
  });

  it('does not descend into image payloads (bounded recursion)', () => {
    // A base64 image block has no `content` key, so the walker must stop there.
    const req = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'a', cache_control: cc('5m') },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(50_000) } },
            { type: 'text', text: 'b', cache_control: cc('1h') },
          ],
        },
      ],
    };
    const t0 = Date.now();
    expect(normalizeCacheControlTtlOrder(req)).toBe(1);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
