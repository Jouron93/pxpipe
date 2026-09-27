/**
 * The provider's image cap is a property of the WIRE, not of pxpipe: it counts
 * the client's own images (screenshots, pasted pictures, images a tool already
 * returned) together with every image pxpipe adds. Pricing only our own is what
 * let a request carrying 100+ client images get imaged further and come back
 * 400/500 — a session the user then could not resume at all.
 *
 * These tests pin the two halves of the fix:
 *   1. `countNativeImages` sees the client's images, at both nesting levels,
 *   2. once they fill the cap, every pxpipe imaging path degrades to text
 *      instead of adding one more image block.
 *
 * Run just this file:  pnpm vitest run tests/native-image-cap.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MANY_IMAGE_MAX_EDGE_PX,
  ANTHROPIC_MANY_IMAGE_THRESHOLD,
  countNativeImages,
  imageDimsFromBase64,
  imageHeadroom,
  transformRequest,
  violatesManyImageLimit,
} from '../src/core/transform.js';
import { ANTHROPIC_MAX_IMAGES } from '../src/core/history.js';
import { resetSessionState } from '../src/core/session-state.js';
import { toTrackEvent } from '../src/core/tracker.js';
import type { Message } from '../src/core/types.js';

const big = (n: number) => 'x'.repeat(n);

/** Base64 of a PNG signature + IHDR declaring `w`×`h` — enough for a header read. */
function pngB64(w: number, h: number): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b.toString('base64');
}

// A small, measurable screenshot. The many-image guard treats an unreadable
// header as oversized, so the fixture carries a real IHDR.
const img = (w = 64, h = 64) => ({
  type: 'image' as const,
  source: { type: 'base64' as const, media_type: 'image/png' as const, data: pngB64(w, h) },
});

function enc(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}
function dec(b: Uint8Array): any {
  return JSON.parse(new TextDecoder().decode(b));
}

/** Every image on the wire, at both nesting levels — the number the provider counts. */
function wireImages(msgs: Message[]): number {
  let n = 0;
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as any[]) {
      if (b?.type === 'image') n++;
      else if (b?.type === 'tool_result' && Array.isArray(b.content)) {
        for (const ib of b.content) if (ib?.type === 'image') n++;
      }
    }
  }
  return n;
}

/** A user turn holding `n` client images, as Claude Code sends pasted screenshots. */
function clientImages(n: number): Message {
  return { role: 'user', content: Array.from({ length: n }, () => img()) };
}

/** A tool_result big enough that pxpipe would normally image it. */
function toolResult(id: string, chars = 40_000): Message {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: `RESULT ${id}\n` + big(chars) }],
  } as unknown as Message;
}

describe('countNativeImages — what the client already put on the wire', () => {
  it('counts top-level image blocks', () => {
    expect(countNativeImages([clientImages(7)])).toBe(7);
  });

  it('counts images nested inside tool_result content', () => {
    const msgs = [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: [img(), { type: 'text', text: 'hi' }, img()] }],
      },
    ] as unknown as Message[];
    expect(countNativeImages(msgs)).toBe(2);
  });

  it('ignores string content and is safe on empty/absent input', () => {
    expect(countNativeImages([{ role: 'user', content: 'plain text' }])).toBe(0);
    expect(countNativeImages([])).toBe(0);
    expect(countNativeImages(undefined)).toBe(0);
  });
});

describe('imageHeadroom — the client’s images spend from the same budget', () => {
  it('subtracts ours and theirs alike', () => {
    const a = imageHeadroom({ imageCount: 0, nativeImages: 0 } as any);
    const b = imageHeadroom({ imageCount: 10, nativeImages: 0 } as any);
    const c = imageHeadroom({ imageCount: 0, nativeImages: 10 } as any);
    expect(b).toBe(a - 10);
    expect(c).toBe(a - 10); // a client image costs exactly what one of ours costs
    expect(a).toBeLessThan(ANTHROPIC_MAX_IMAGES); // safety margin is applied
  });

  it('never goes negative — an over-full request reports zero, not a deficit', () => {
    expect(imageHeadroom({ imageCount: 0, nativeImages: 500 } as any)).toBe(0);
  });
});

describe('tool_result imaging respects the client’s images', () => {
  beforeEach(() => resetSessionState());

  // Positive control. tool_result imaging only runs on the main path, so the
  // request needs a system slab above the compress gate — the same shape real
  // Claude Code traffic has.
  const withSlab = (messages: Message[]) =>
    enc({ model: 'claude-3-5-sonnet', system: [{ type: 'text', text: 'SLAB\n' + big(30_000) }], messages });

  it('images a big tool_result when the wire is empty', async () => {
    const { body: out, info } = await transformRequest(
      withSlab([{ role: 'user', content: 'go' }, toolResult('t1')]),
    );
    expect(info.nativeImages).toBe(0);
    expect(info.toolResultImgs ?? 0).toBeGreaterThan(0);
    expect(wireImages(dec(out).messages)).toBeGreaterThan(0);
  });

  it('leaves the same tool_result as text when the client already filled the cap', async () => {
    const { body: out, info } = await transformRequest(
      withSlab([clientImages(ANTHROPIC_MAX_IMAGES), toolResult('t1')]),
    );

    expect(info.nativeImages).toBe(ANTHROPIC_MAX_IMAGES);
    // Nothing was added: the only images on the wire are the client's own.
    expect(wireImages(dec(out).messages)).toBe(ANTHROPIC_MAX_IMAGES);
    expect(info.imageBudgetSkips ?? 0).toBeGreaterThan(0);
    expect(info.passthroughReasons?.image_budget ?? 0).toBeGreaterThan(0);
    // The text survived — degrading must not drop content.
    expect(JSON.stringify(dec(out).messages)).toContain('RESULT t1');
  });

  it('never exceeds the cap when the client sits just under it', async () => {
    const near = ANTHROPIC_MAX_IMAGES - 3;
    const { body: out } = await transformRequest(
      withSlab([clientImages(near), toolResult('t1'), toolResult('t2'), toolResult('t3')]),
    );
    expect(wireImages(dec(out).messages)).toBeLessThanOrEqual(ANTHROPIC_MAX_IMAGES);
  });
});

describe('the cap is quantitative, not boolean', () => {
  beforeEach(() => resetSessionState());

  // The first cut of this guard asked "is there ANY room left?" and then emitted
  // a whole multi-page slab into it: 94 client images + a 400k system slab put
  // 109 images on the wire — still a hard reject, just a rarer one. Every path
  // must fit its actual page count, not merely find a nonzero headroom.
  it.each([
    [94, 400_000],
    [90, 400_000],
    [80, 800_000],
  ])('stays at or under the cap with %i client images and a %i-char slab', async (clients, slabChars) => {
    const body = enc({
      model: 'claude-3-5-sonnet',
      system: [{ type: 'text', text: 'SLAB\n' + big(slabChars) }],
      messages: [clientImages(clients), { role: 'user', content: 'hi ' + big(200) }],
    });
    const { body: out } = await transformRequest(body);
    expect(wireImages(dec(out).messages)).toBeLessThanOrEqual(ANTHROPIC_MAX_IMAGES);
  });

  it('spends nothing at all when the slab cannot fit whole', async () => {
    const body = enc({
      model: 'claude-3-5-sonnet',
      system: [{ type: 'text', text: 'SLAB\n' + big(400_000) }],
      messages: [clientImages(90), { role: 'user', content: 'hi ' + big(200) }],
    });
    const { info } = await transformRequest(body);
    // All-or-nothing: a half-imaged slab would re-key the cache prefix on every
    // turn whose client-image count moved.
    expect(info.imageCount).toBe(0);
    expect(info.reason).toMatch(/^image_budget/);
  });
});

describe('wireImages — what the provider actually counts', () => {
  beforeEach(() => resetSessionState());

  // The render counter and the wire disagree whenever the history collapse
  // absorbs a message that already carried one of our images: the message is
  // replaced wholesale, so the image inside it is never sent. Telemetry that
  // reads imageCount therefore over-reports, and any headroom math that trusts
  // it under-uses the budget.
  it('reports the outgoing body, not the render count, on a tool-heavy shape', async () => {
    const msgs: any[] = [{ role: 'user', content: 'ANCHOR ' + big(200) }];
    for (let i = 0; i < 60; i++) {
      msgs.push({ role: 'assistant', content: `turn ${i}: ` + big(4000) });
      msgs.push(
        i % 3 === 0
          ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + i, content: 'RES\n' + big(90_000) }] }
          : { role: 'user', content: `reply ${i}: ` + big(2000) },
      );
    }
    const { body: out, info } = await transformRequest(
      enc({ model: 'claude-opus-5', system: [{ type: 'text', text: 'SLAB\n' + big(50_000) }], messages: msgs }),
    );

    const actual = wireImages(dec(out).messages);
    expect(info.wireImages).toBe(actual);
    // This assertion used to read `imageCount > actual` — "we rendered materially
    // more than we shipped" — and on this shape it measured 95 rendered against 27
    // shipped. That gap was not a design property. It was tool_result imaging
    // running before the history collapse: 68 of those renders were thrown away
    // with the messages that absorbed them, and the tool output inside them
    // reached the wire in no form at all. With the stages ordered so the collapse
    // sees original text, the same fixture measures 92 rendered and 92 shipped.
    // A gap reappearing here now means renders are being discarded again.
    expect(info.imageCount!).toBe(actual - (info.nativeImages ?? 0));
    expect(actual).toBeLessThanOrEqual(ANTHROPIC_MAX_IMAGES);
  });

  it('agrees with the render count when nothing is absorbed', async () => {
    const { body: out, info } = await transformRequest(
      enc({
        model: 'claude-3-5-sonnet',
        system: [{ type: 'text', text: 'SLAB\n' + big(30_000) }],
        messages: [clientImages(2), { role: 'user', content: 'hi' }],
      }),
    );
    expect(info.wireImages).toBe(wireImages(dec(out).messages));
    expect(info.wireImages).toBe((info.imageCount ?? 0) + (info.nativeImages ?? 0));
  });
});

/** Every image on the wire with its header size (all fixtures are inline base64). */
function wireDims(msgs: Message[]): Array<{ width: number; height: number }> {
  const out: Array<{ width: number; height: number }> = [];
  const visit = (b: any) => {
    if (b?.type !== 'image') return;
    const d = imageDimsFromBase64(b.source.data);
    if (!d) throw new Error('unreadable image on the wire');
    out.push(d);
  };
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as any[]) {
      visit(b);
      if (b?.type === 'tool_result' && Array.isArray(b.content)) b.content.forEach(visit);
    }
  }
  return out;
}

/** A Claude Code session on claude-opus-5-5: anchor, then `turns` Read calls
 *  whose results are big enough to image. Transform it with {@link OPUS55}: the
 *  proxy always passes the effective model, and without it the jb10 profile never
 *  applies. Measured 2026-09-27: 16 turns ship 18 images at the 2576px jb10
 *  geometry; 20 turns ship 22, 28 turns ship 30 (both clamped to 2000px). */
const OPUS55 = { model: 'claude-opus-5-5' } as const;
function opus55Session(turns: number, extra: Message[] = []): Uint8Array {
  const messages: any[] = [{ role: 'user', content: 'ANCHOR ' + big(2000) }];
  for (let i = 0; i < turns; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 't' + i, name: 'Read', input: {} }] });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't' + i, content: 'RES\n' + 'word '.repeat(4000) }],
    });
  }
  messages.push(...extra, { role: 'user', content: 'go' });
  return enc({
    model: 'claude-opus-5-5',
    max_tokens: 16,
    system: [{ type: 'text', text: 'SLAB\n' + 'word '.repeat(10_000) }],
    messages,
  });
}

/** 20 small client screenshots plus one wider than the many-image edge. */
const oversizedClientTurn = (): Message =>
  ({ role: 'user', content: [img(2576, 900), ...Array.from({ length: 20 }, () => img())] }) as Message;

describe('many-image limit — >20 images forces every edge ≤ 2000px', () => {
  beforeEach(() => resetSessionState());
  const overEdge = (d: { width: number; height: number }) =>
    d.width > ANTHROPIC_MANY_IMAGE_MAX_EDGE_PX || d.height > ANTHROPIC_MANY_IMAGE_MAX_EDGE_PX;

  it('pins the documented numbers', () => {
    expect(ANTHROPIC_MANY_IMAGE_THRESHOLD).toBe(20);
    expect(ANTHROPIC_MANY_IMAGE_MAX_EDGE_PX).toBe(2000);
  });

  it('(a) re-renders at a smaller geometry when the request carries >20 images', async () => {
    const { body: out, info } = await transformRequest(opus55Session(28), OPUS55);
    const dims = wireDims(dec(out).messages);
    expect(dims.length).toBeGreaterThan(ANTHROPIC_MANY_IMAGE_THRESHOLD);
    expect(dims.filter(overEdge)).toEqual([]);
    expect(info.manyImageEdgeClampPx).toBe(ANTHROPIC_MANY_IMAGE_MAX_EDGE_PX);
    expect(info.compressed).toBe(true);
    expect(info.reason).not.toBe('many_images_limit');
    expect(violatesManyImageLimit(out)).toBe(false);
  });

  it('(b) leaves the high-res geometry alone at ≤20 images', async () => {
    const { body: out, info } = await transformRequest(opus55Session(16), OPUS55);
    const dims = wireDims(dec(out).messages);
    expect(dims.length).toBeGreaterThan(0);
    expect(dims.length).toBeLessThanOrEqual(ANTHROPIC_MANY_IMAGE_THRESHOLD);
    // The jb10 pages stay wider than the many-image edge: nothing was clamped.
    expect(dims.some(overEdge)).toBe(true);
    expect(info.manyImageEdgeClampPx).toBeUndefined();
  });

  it('(c) passes the original through when a client image over the edge rides a >20 request', async () => {
    const body = opus55Session(4, [oversizedClientTurn()]);
    const { body: out, info } = await transformRequest(body, OPUS55);
    expect(out).toBe(body);
    expect(info.compressed).toBe(false);
    expect(info.reason).toBe('many_images_limit');
    expect(info.passthroughReasons?.many_images_limit).toBe(1);
    expect(info.nativeImages).toBe(21);
  });

  it('(d) the reason and the clamp reach the events.jsonl record', async () => {
    const pass = await transformRequest(opus55Session(4, [oversizedClientTurn()]), OPUS55);
    const ev = toTrackEvent({
      method: 'POST', path: '/v1/messages', model: 'claude-opus-5-5', status: 200, durationMs: 1, info: pass.info,
    });
    expect(ev.reason).toBe('many_images_limit');
    expect(ev.passthrough_reasons?.many_images_limit).toBe(1);

    resetSessionState();
    const clamp = await transformRequest(opus55Session(28), OPUS55);
    const ev2 = toTrackEvent({
      method: 'POST', path: '/v1/messages', model: 'claude-opus-5-5', status: 200, durationMs: 1, info: clamp.info,
    });
    expect(ev2.many_image_edge_clamp_px).toBe(ANTHROPIC_MANY_IMAGE_MAX_EDGE_PX);
  });
});

describe('imageDimsFromBase64', () => {
  const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

  it('reads PNG, GIF, WebP (VP8X) and JPEG headers', () => {
    expect(imageDimsFromBase64(pngB64(2576, 1260))).toEqual({ width: 2576, height: 1260 });
    expect(imageDimsFromBase64(b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x08, 0x20, 0x04])))
      .toEqual({ width: 2064, height: 1056 });
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'latin1');
    webp.write('WEBPVP8X', 8, 'latin1');
    webp.writeUIntLE(2999, 24, 3);
    webp.writeUIntLE(1499, 27, 3);
    expect(imageDimsFromBase64(webp.toString('base64'))).toEqual({ width: 3000, height: 1500 });
    // SOI, APP0 (len 16), SOF0: height 0x0438 = 1080, width 0x0780 = 1920.
    const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0),
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03];
    expect(imageDimsFromBase64(b64(jpeg))).toEqual({ width: 1920, height: 1080 });
  });

  it('returns null for a truncated or unknown header', () => {
    expect(imageDimsFromBase64('iVBORw0KGgo=')).toBeNull();
    expect(imageDimsFromBase64(b64([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });

  it('counts an unreadable inline image as oversized once the request is over 20', () => {
    const bad = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
    const content: unknown[] = [bad, ...Array.from({ length: 20 }, () => img())];
    const body = () => enc({ model: 'claude-opus-5-5', messages: [{ role: 'user', content }] });
    expect(violatesManyImageLimit(body())).toBe(true);
    content.pop();
    expect(violatesManyImageLimit(body())).toBe(false);
  });
});
