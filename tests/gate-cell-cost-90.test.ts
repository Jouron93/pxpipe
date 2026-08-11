/**
 * Gate must price Opus 9×12 (cell bonuses) and honor cold honest-90% floor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  imageTokensCost,
  isCompressionProfitable,
  minColdSaveFraction,
  SLAB_CHARS_PER_TOKEN,
} from '../src/core/transform.js';
import { ANTHROPIC_SLAB_COLS } from '../src/core/render.js';

const OPUS_STYLE = { cellWBonus: 4, cellHBonus: 4, aa: true };
const FABLE_STYLE = { cellWBonus: 0, cellHBonus: 0, aa: true };

afterEach(() => {
  delete process.env.PXPIPE_MIN_COLD_SAVE_FRACTION;
});

describe('style-aware image token gate', () => {
  it('Opus 9×12 costs substantially more image tokens than Fable 5×8 for same slab', () => {
    const text = Array.from({ length: 400 }, () => 'x'.repeat(200)).join('\n');
    const fable = imageTokensCost(text, ANTHROPIC_SLAB_COLS, 1, undefined, false, undefined as unknown as number, FABLE_STYLE);
    const opus = imageTokensCost(text, ANTHROPIC_SLAB_COLS, 1, undefined, false, undefined as unknown as number, OPUS_STYLE);
    expect(fable).toBeGreaterThan(0);
    expect(opus).toBeGreaterThan(fable);
    expect(opus / fable).toBeGreaterThan(1.8);
  });

  it('without style, gate matches Fable 5×8 (legacy default)', () => {
    const text = Array.from({ length: 200 }, () => 'a'.repeat(100)).join('\n');
    const bare = imageTokensCost(text, ANTHROPIC_SLAB_COLS, 1, undefined, false);
    const fable = imageTokensCost(text, ANTHROPIC_SLAB_COLS, 1, undefined, false, undefined as unknown as number, FABLE_STYLE);
    expect(bare).toBe(fable);
    expect(bare).toBeGreaterThan(0);
  });
});

describe('PXPIPE_MIN_COLD_SAVE_FRACTION honest 90%', () => {
  it('minColdSaveFraction reads env in vitest when set', () => {
    process.env.PXPIPE_MIN_COLD_SAVE_FRACTION = '0.90';
    expect(minColdSaveFraction()).toBe(0.90);
  });

  it('refuses cold Opus imaging when projected honest save < 90%', () => {
    process.env.PXPIPE_MIN_COLD_SAVE_FRACTION = '0.90';
    const text = Array.from({ length: 250 }, () => 'm'.repeat(120)).join('\n');
    const opusFloor = isCompressionProfitable(
      text, ANTHROPIC_SLAB_COLS, undefined, 1, SLAB_CHARS_PER_TOKEN, 0, 0, false, undefined as unknown as number, OPUS_STYLE,
    );
    expect(opusFloor).toBe(false);
  });

  it('documents whether a packed Fable slab can clear honest 90%', () => {
    process.env.PXPIPE_MIN_COLD_SAVE_FRACTION = '0.90';
    const text = Array.from({ length: 2000 }, () => 'word '.repeat(60)).join('\n');
    const img = imageTokensCost(text, ANTHROPIC_SLAB_COLS, 1, undefined, false, undefined as unknown as number, FABLE_STYLE);
    const textTok = text.length / SLAB_CHARS_PER_TOKEN;
    const ratio = img / textTok;
    const ok = isCompressionProfitable(
      text, ANTHROPIC_SLAB_COLS, undefined, 1, SLAB_CHARS_PER_TOKEN, 0, 0, false, undefined as unknown as number, FABLE_STYLE,
    );
    // Honest 90% ⇔ I/T <= 0.10. Gate must agree with that inequality.
    expect(ok).toBe(ratio <= 0.10);
  });
});
