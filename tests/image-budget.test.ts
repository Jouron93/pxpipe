/**
 * Image Budget Rules & Boundary Test Suite
 *
 * Enforces upstream provider constraints:
 * 1. Anthropic wire limit: maximum 100 images per request.
 * 2. Decoded image payload ceiling: 18 MiB soft limit / 20 MiB hard ceiling.
 * 3. Graceful degradation: content is preserved as text when budget is exhausted.
 * 4. Priority: caller native images outrank compression and are never evicted.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MAX_IMAGES_WIRE,
  MAX_DECODED_IMAGE_PAYLOAD_SOFT_BYTES,
  MAX_DECODED_IMAGE_PAYLOAD_HARD_BYTES,
} from '../src/core/render.js';
import {
  ANTHROPIC_MAX_IMAGES,
  ANTHROPIC_HISTORY_IMAGE_BUDGET,
} from '../src/core/history.js';
import {
  countNativeImageBytes,
  countNativeImages,
  imageByteHeadroom,
  imageHeadroom,
  transformRequest,
} from '../src/core/transform.js';
import { resetSessionState } from '../src/core/session-state.js';
import type { Message, TransformInfo } from '../src/core/types.js';

const bigText = (n: number) => 'x'.repeat(n);
const encodeReq = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));
const decodeRes = (b: Uint8Array): any => JSON.parse(new TextDecoder().decode(b));

/** Generate synthetic caller image block with specified decoded byte weight */
function makeCallerImage(decodedBytes: number) {
  const b64Chars = Math.ceil(decodedBytes / 3) * 4;
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/png' as const,
      data: 'B'.repeat(b64Chars),
    },
  };
}

function makeToolResult(id: string, chars = 35_000): Message {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: id,
        content: `TOOL_OUTPUT ${id}\n` + bigText(chars),
      },
    ],
  } as unknown as Message;
}

function makeSlabRequest(messages: Message[], slabChars = 50_000) {
  return encodeReq({
    model: 'claude-3-5-sonnet',
    system: [{ type: 'text', text: 'SYSTEM_SLAB_CONTEXT\n' + bigText(slabChars) }],
    messages,
  });
}

function calculateWireBytes(messages: any[]): number {
  let total = 0;
  const countBlock = (b: any): void => {
    if (b?.type === 'image' && typeof b.source?.data === 'string') {
      const data = b.source.data as string;
      const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
      total += Math.floor((data.length * 3) / 4) - pad;
    }
  };
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      countBlock(block);
      if (block?.type === 'tool_result' && Array.isArray(block.content)) {
        for (const inner of block.content) countBlock(inner);
      }
    }
  }
  return total;
}

describe('Image Budget Upstream Constants & Contracts', () => {
  it('exports exact upstream image limits matching baseline specifications', () => {
    expect(ANTHROPIC_MAX_IMAGES_WIRE).toBe(100);
    expect(ANTHROPIC_MAX_IMAGES).toBe(100);
    expect(ANTHROPIC_HISTORY_IMAGE_BUDGET).toBe(80);
    expect(MAX_DECODED_IMAGE_PAYLOAD_SOFT_BYTES).toBe(18 * 1024 * 1024);
    expect(MAX_DECODED_IMAGE_PAYLOAD_HARD_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('Image Count Headroom & Boundary Rules', () => {
  beforeEach(() => resetSessionState());

  it('calculates image headroom correctly with safety margin', () => {
    const info: TransformInfo = {
      imageCount: 10,
      nativeImages: 5,
    } as any;

    // Headroom = Math.max(0, 100 - 5 (safety) - 10 - 5) = 80
    expect(imageHeadroom(info)).toBe(80);
  });

  it('returns 0 headroom when images reach or exceed the cap boundary', () => {
    const atCap: TransformInfo = {
      imageCount: 95,
      nativeImages: 0,
    } as any;
    expect(imageHeadroom(atCap)).toBe(0);

    const overCap: TransformInfo = {
      imageCount: 50,
      nativeImages: 60,
    } as any;
    expect(imageHeadroom(overCap)).toBe(0);
  });

  it('respects caller native images when checking count headroom', () => {
    const callerOnly: Message[] = [
      {
        role: 'user',
        content: [
          makeCallerImage(1000),
          makeCallerImage(1000),
          makeCallerImage(1000),
        ],
      } as unknown as Message,
    ];

    expect(countNativeImages(callerOnly)).toBe(3);
  });

  it('falls back gracefully to text when image headroom is exhausted', async () => {
    // Construct request with 96 caller images so headroom is 0
    const manyImages = Array.from({ length: 96 }, (_, i) => makeCallerImage(500));
    const req = makeSlabRequest([
      { role: 'user', content: manyImages } as unknown as Message,
      { role: 'user', content: 'Execute query' },
    ]);

    const { body: out, info } = await transformRequest(req);
    expect(info.nativeImages).toBe(96);
    expect(info.imageCount).toBe(0); // slab was NOT converted to images
    expect(info.reason).toMatch(/headroom|budget|image/);

    const parsed = decodeRes(out);
    expect(JSON.stringify(parsed.system)).toContain('SYSTEM_SLAB_CONTEXT');
  });
});

describe('Decoded Payload Weight Ceiling (18 MiB soft / 20 MiB hard)', () => {
  beforeEach(() => resetSessionState());

  it('computes byte headroom subtracting existing and native images', () => {
    const limit = 18 * 1024 * 1024;
    const info: TransformInfo = {
      imageBytes: 5 * 1024 * 1024,
      nativeImageBytes: 3 * 1024 * 1024,
    } as any;

    expect(imageByteHeadroom(info, limit)).toBe(10 * 1024 * 1024);
  });

  it('never returns negative byte headroom on overflow', () => {
    const limit = 18 * 1024 * 1024;
    const info: TransformInfo = {
      imageBytes: 15 * 1024 * 1024,
      nativeImageBytes: 5 * 1024 * 1024,
    } as any;

    expect(imageByteHeadroom(info, limit)).toBe(0);
  });

  it('admits groups atomically without partial image splitting', async () => {
    // Test atomic admission: if a group does not fit within headroom, it stays as text.
    // Budget = measured slab weight + 1 KB, so the slab is admitted and the tool
    // result group cannot fit. Derived, not hard-coded, so it tracks encoder size.
    const slabOnly = await transformRequest(
      makeSlabRequest([{ role: 'user', content: 'test step' }]),
      { maxImageBytes: 64 * 1024 * 1024 },
    );
    resetSessionState();
    const budget = slabOnly.info.imageBytes + 1024;
    const { body: out, info } = await transformRequest(
      makeSlabRequest([
        { role: 'user', content: 'test step' },
        makeToolResult('t_group_1'),
      ]),
      { maxImageBytes: budget },
    );

    // Slab fits; the tool result does not fit in the remaining ~1 KB headroom
    expect(info.imageCount).toBeGreaterThan(0); // Slab admitted
    expect(info.toolResultImgs ?? 0).toBe(0); // Tool result group stayed as text
    expect(info.imageByteSkips ?? 0).toBeGreaterThan(0);

    const wire = decodeRes(out);
    expect(JSON.stringify(wire.messages)).toContain('TOOL_OUTPUT t_group_1');
    expect(calculateWireBytes(wire.messages)).toBeLessThanOrEqual(budget);
  });

  it('preserves caller images unconditionally even if near or exceeding ceiling', async () => {
    // 500 KB caller image with tight 400 KB budget
    const largeCallerImg = makeCallerImage(500 * 1024);
    const req = makeSlabRequest([
      { role: 'user', content: [largeCallerImg] } as unknown as Message,
      { role: 'user', content: 'process image' },
    ], 30_000);

    const { body: out, info } = await transformRequest(req, { maxImageBytes: 400 * 1024 });

    // Caller image remains intact on wire
    expect(info.nativeImageBytes).toBeGreaterThan(450 * 1024);
    expect(info.imageCount).toBe(0); // our compression did not add further images

    const wire = decodeRes(out);
    expect(calculateWireBytes(wire.messages)).toBeGreaterThan(450 * 1024);
  });

  it('sets imageBytesNearLimit telemetry flag when payload approaches 90% of budget', async () => {
    // Measure the rendered 60,000-char slab, then budget it at ~93% utilization (>=90%).
    const probe = await transformRequest(
      makeSlabRequest([{ role: 'user', content: 'hello' }], 60_000),
      { maxImageBytes: 64 * 1024 * 1024 },
    );
    resetSessionState();
    const { info } = await transformRequest(
      makeSlabRequest([{ role: 'user', content: 'hello' }], 60_000),
      { maxImageBytes: Math.ceil(probe.info.imageBytes / 0.93) },
    );

    expect(info.imageCount).toBeGreaterThan(0);
    expect(info.imageBytesNearLimit).toBe(true);
  });
});
