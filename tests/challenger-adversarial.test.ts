/**
 * Challenger 1: Adversarial Boundary & Stress Verification Suite.
 *
 * Rigorously stress-tests:
 * 1. Suffix routing stress: Bracketed tags (e.g. `[1m]`, `[200k]`, `[fast]`) resolution.
 * 2. Down-rewrite challenge: Empirically verify `gpt-6-terra` does NOT down-rewrite to `gpt-5.6-terra`,
 *    and Gen 6 models resolve natively to Gen 6 patch regime.
 * 3. Cache preservation challenge: Verify `cache_control: {"type": "ephemeral"}` blocks are preserved
 *    on the final image block of history slabs and not stripped or invalidated.
 * 4. Image budget challenge: Verify image limits (count caps and byte headroom) prevent token blowup
 *    or payload crashes, falling back safely to text.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveGptProfile,
  isMisresolvedModelId,
  DEFAULT_GPT_PROFILE,
} from '../src/core/gpt-model-profiles.js';
import {
  isClaudeModel,
  isPre47Claude,
  resolveClaudeProfile,
  CLAUDE_PROFILE,
  CLAUDE_LEGIBLE_PROFILE,
  CLAUDE_OPUS55_PROFILE,
} from '../src/core/claude-model-profiles.js';
import {
  isPxpipeSupportedModel,
  isPxpipeSupportedGptModel,
  setAllowedModelBases,
} from '../src/core/applicability.js';
import {
  collapseHistory,
  ANTHROPIC_MAX_IMAGES,
} from '../src/core/history.js';
import {
  transformRequest,
  countNativeImages,
  countNativeImageBytes,
  imageHeadroom,
  imageByteHeadroom,
  MAX_DECODED_IMAGE_BYTES,
} from '../src/core/transform.js';
import { countCacheControlMarkers } from '../src/core/measurement.js';
import type { Message, CacheControl } from '../src/core/types.js';

const big = (n: number) => 'x'.repeat(n);
const enc = (obj: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(obj));
const dec = (b: Uint8Array): any => JSON.parse(new TextDecoder().decode(b));

function convo(n: number, chars = 3500): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < n; i++) {
    const body = `turn ${i}: ` + big(chars);
    out.push(i % 2 === 0 ? { role: 'user', content: body } : { role: 'assistant', content: body });
  }
  return out;
}

describe('Challenger Challenge 1: Suffix Routing Stress', () => {
  it('strips bracketed tags [1m] and resolves Claude Opus 5.5 and Sonnet 5 natively', () => {
    const opusBase = resolveGptProfile('claude-opus-5-5');
    const opusTagged = resolveGptProfile('claude-opus-5-5[1m]');
    expect(opusTagged).toEqual(opusBase);
    expect(opusTagged.stripCols).toBe(428);
    expect(opusTagged.history?.maxImages).toBe(96);
    expect(isMisresolvedModelId('claude-opus-5-5[1m]')).toBe(false);

    const sonnetBase = resolveGptProfile('claude-sonnet-5');
    const sonnetTagged = resolveGptProfile('claude-sonnet-5[1m]');
    expect(sonnetTagged).toEqual(sonnetBase);
    expect(sonnetTagged.stripCols).toBe(172);
    expect(isMisresolvedModelId('claude-sonnet-5[1m]')).toBe(false);
  });

  it('handles arbitrary bracketed suffixes ([200k], [fast], [context=1m], empty [])', () => {
    const testCases = [
      'claude-opus-5-5[200k]',
      'claude-opus-5-5[fast]',
      'claude-opus-5-5[context=1m]',
      'claude-opus-5-5[]',
      'claude-sonnet-5[1m][extra]',
    ];
    for (const id of testCases) {
      const prof = resolveGptProfile(id);
      // Opus 5.5 has its own measured geometry; every other Claude id stays legible.
      expect(prof).toEqual(id.includes('opus-5-5') ? CLAUDE_OPUS55_PROFILE : CLAUDE_LEGIBLE_PROFILE);
      expect(isMisresolvedModelId(id)).toBe(false);
    }
  });

  it('preserves modern Claude 5.x classification through isPre47Claude', () => {
    expect(isPre47Claude('claude-opus-5-5[1m]')).toBe(false);
    expect(isPre47Claude('claude-sonnet-5[1m]')).toBe(false);
    expect(isPre47Claude('claude-opus-5-5')).toBe(false);
    expect(isPre47Claude('claude-sonnet-5')).toBe(false);
    expect(isClaudeModel('claude-opus-5-5[1m]')).toBe(true);
    expect(isClaudeModel('claude-sonnet-5[1m]')).toBe(true);
  });

  it('gating applicability recognizes bracketed variants identically to base models', () => {
    setAllowedModelBases(['claude-opus-5-5', 'claude-sonnet-5', 'gpt-6-astra']);
    try {
      expect(isPxpipeSupportedModel('claude-opus-5-5[1m]')).toBe(true);
      expect(isPxpipeSupportedModel('claude-opus-5-5')).toBe(true);
      expect(isPxpipeSupportedModel('claude-sonnet-5[1m]')).toBe(true);
      expect(isPxpipeSupportedModel('claude-sonnet-5')).toBe(true);
      expect(isPxpipeSupportedGptModel('gpt-6-astra[1m]')).toBe(true);
      expect(isPxpipeSupportedGptModel('gpt-6-astra')).toBe(true);
      // Non-allowed model rejected
      expect(isPxpipeSupportedModel('claude-3-haiku[1m]')).toBe(false);
    } finally {
      setAllowedModelBases(null);
    }
  });
});

describe('Challenger Challenge 2: Down-Rewrite Challenge (GPT-6)', () => {
  it('empirically verifies gpt-6-terra resolves to Gen 6 patch regime without legacy downgrade', () => {
    const prof6 = resolveGptProfile('gpt-6-terra');
    expect(prof6.vision.regime).toBe('patch');
    if (prof6.vision.regime === 'patch') {
      expect(prof6.vision.multiplier).toBe(1);
      expect(prof6.vision.patchCap).toBe(10000);
    }
    expect(prof6.stripCols).toBe(152);
    expect(prof6.maxHeightPx).toBe(1932);
    expect(prof6.cacheReadRate).toBe(0.5);
    expect(prof6.outputRate).toBe(5);
    expect(isMisresolvedModelId('gpt-6-terra')).toBe(false);

    // Verify it is NOT downgraded to gpt-5.6-terra
    const prof56 = resolveGptProfile('gpt-5.6-terra');
    expect(prof56.outputRate).toBe(8); // gpt-5.6 output rate is 8
    expect(prof6.outputRate).toBe(5);  // gpt-6 output rate is 5 (Gen 6 pricing)
    expect(prof6).not.toEqual(prof56);
    expect(prof6).not.toEqual(DEFAULT_GPT_PROFILE);
  });

  it('empirically verifies all Gen 6 frontier models resolve natively', () => {
    const astra = resolveGptProfile('gpt-6-astra');
    expect(astra.vision.regime).toBe('patch');
    expect(astra.exactStaticBaseline).toBe(true);
    expect(astra.stripCols).toBe(84);
    expect(astra.maxHeightPx).toBe(1954);
    expect(astra.style.font).toBe('jetbrains-mono-14');
    expect(astra.history?.maxImages).toBe(64);
    expect(astra.cacheReadRate).toBe(0.5);
    expect(astra.outputRate).toBe(5);
    expect(isMisresolvedModelId('gpt-6-astra')).toBe(false);

    const sol = resolveGptProfile('gpt-6-sol');
    expect(sol.vision.regime).toBe('patch');
    expect(sol.style.font).toBe('jetbrains-mono-14');
    expect(sol.cacheReadRate).toBe(0.5);
    expect(sol.outputRate).toBe(5);
    expect(isMisresolvedModelId('gpt-6-sol')).toBe(false);

    const luna = resolveGptProfile('gpt-6-luna');
    expect(luna.vision.regime).toBe('patch');
    if (luna.vision.regime === 'patch') {
      expect(luna.vision.multiplier).toBe(1);
      expect(luna.vision.patchCap).toBe(10000);
    }
    expect(luna.outputRate).toBe(4);
    expect(isMisresolvedModelId('gpt-6-luna')).toBe(false);
  });
});

describe('Challenger Challenge 3: Cache Preservation Challenge', () => {
  it('preserves cache_control on the final image block of history slabs', async () => {
    const msgs = convo(15, 4000);
    // Place ephemeral cache control on a mid-history boundary
    (msgs[8] as any).content = [
      { type: 'text', text: msgs[8].content as string, cache_control: { type: 'ephemeral' } },
    ];

    const body = enc({
      model: 'claude-3-5-sonnet',
      system: [
        {
          type: 'text',
          text: big(80_000),
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      messages: msgs,
    });

    const initialMarkerCount = countCacheControlMarkers(body);
    expect(initialMarkerCount).toBe(2);

    const { body: transformedBytes } = await transformRequest(body);
    const finalMarkerCount = countCacheControlMarkers(transformedBytes);
    expect(finalMarkerCount).toBe(initialMarkerCount);

    const req = dec(transformedBytes);
    // Find all image blocks carrying cache_control
    const imageMarkers: CacheControl[] = [];
    const collectImageMarkers = (blocks: any[]) => {
      if (!Array.isArray(blocks)) return;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b?.type === 'image' && b.cache_control) {
          imageMarkers.push(b.cache_control);
        }
      }
    };

    collectImageMarkers(req.system);
    for (const m of req.messages ?? []) {
      collectImageMarkers(m.content);
    }

    // At least one image block must carry the preserved cache_control marker
    expect(imageMarkers.length).toBeGreaterThanOrEqual(1);
    for (const marker of imageMarkers) {
      expect(marker.type).toBe('ephemeral');
    }
  });

  it('intermediate image blocks do NOT carry cache_control — only the terminal block does', async () => {
    // Generate large text that spans multiple images
    const msgs = convo(25, 5000);
    const body = enc({
      model: 'claude-3-5-sonnet',
      system: [
        {
          type: 'text',
          text: big(200_000),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: msgs,
    });

    const { body: out } = await transformRequest(body);
    const req = dec(out);

    // If system was converted to multiple images:
    if (Array.isArray(req.system)) {
      const imgBlocks = req.system.filter((b: any) => b.type === 'image');
      if (imgBlocks.length > 1) {
        // All intermediate images must NOT have cache_control
        for (let i = 0; i < imgBlocks.length - 1; i++) {
          expect(imgBlocks[i].cache_control).toBeUndefined();
        }
        // The last image block must have cache_control
        expect(imgBlocks[imgBlocks.length - 1].cache_control).toEqual({ type: 'ephemeral' });
      }
    }
  });
});

describe('Challenger Challenge 4: Image Budget Challenge', () => {
  it('strictly limits image count and calculates remaining headroom accurately', () => {
    const msgs: Message[] = [];
    // User already sent 95 client images
    for (let i = 0; i < 95; i++) {
      msgs.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
          },
        ],
      });
    }

    const counted = countNativeImages(msgs);
    expect(counted).toBe(95);

    // imageHeadroom tracks remaining slots against wire cap (accounting for safety margin)
    const headroom0 = imageHeadroom({ imageCount: 0, nativeImages: 0 } as any);
    const headroom95 = imageHeadroom({ imageCount: 0, nativeImages: 95 } as any);
    expect(headroom0).toBeLessThan(ANTHROPIC_MAX_IMAGES);
    expect(headroom95).toBe(0); // 95 native images consumes all headroom

    // If caller already has 100 images
    msgs.push({
      role: 'user',
      content: Array.from({ length: 5 }, () => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'AAAA' },
      })),
    });
    expect(countNativeImages(msgs)).toBe(100);
    expect(imageHeadroom({ imageCount: 0, nativeImages: 100 } as any)).toBe(0);
  });

  it('prevents payload crash by refusing imaging when image count headroom is exhausted', async () => {
    // 100 client images on the wire + huge text that would normally be imaged
    const msgs: Message[] = [];
    for (let i = 0; i < 100; i++) {
      msgs.push({
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
          },
        ],
      });
    }
    // Add bulky message
    msgs.push({
      role: 'user',
      content: 'MASSIVE TEXT: ' + big(50_000),
    });

    const body = enc({
      model: 'claude-3-5-sonnet',
      messages: msgs,
    });

    const { body: out, info } = await transformRequest(body);
    const req = dec(out);

    // Total images on wire must NEVER exceed 100
    const finalImages = countNativeImages(req.messages);
    expect(finalImages).toBeLessThanOrEqual(100);
    // Bulk text must remain text (not converted to image)
    expect(info.historyReason).not.toBe('collapsed');
  });

  it('enforces decoded image byte budget (20 MiB ceiling) to prevent socket timeouts', () => {
    // Single massive caller image of 18 MiB
    const b64_18mb = 'A'.repeat(Math.ceil(18 * 1024 * 1024 / 3) * 4);
    const msgs = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/png' as const, data: b64_18mb },
          },
        ],
      },
    ];

    const bytes = countNativeImageBytes(msgs);
    expect(bytes).toBeGreaterThan(17 * 1024 * 1024);

    const headroom = imageByteHeadroom({ imageBytes: 0, nativeImageBytes: bytes } as any, 20 * 1024 * 1024);
    expect(headroom).toBeLessThan(3 * 1024 * 1024);
    expect(headroom).toBeGreaterThanOrEqual(0);
  });
});
