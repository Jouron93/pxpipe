#!/usr/bin/env node
/**
 * decode_atlas.mjs — deterministic surrogate reader (NOT a VLM).
 *
 * FINDINGS.md says the reason imaged text misreads silently is that
 * "model vision is not OCR": no glyph segmentation, no per-character
 * confidence, no way to return "unreadable". Every surrogate candidate
 * evaluated so far has been a VLM, which structurally cannot supply the one
 * signal the surrogate needs.
 *
 * But pxpipe renders from a KNOWN 1-bit atlas onto a KNOWN cell grid. The
 * bitmasks that produced the image are in src/core/atlas.ts. So the surrogate
 * does not need to LEARN to read - it can template-decode:
 *
 *   crop cell -> compare against all 95 Spleen ASCII glyphs -> best match
 *   margin(best, runner-up) IS the per-character confidence
 *   no unique match  ->  "unreadable", cleanly, by construction
 *
 * Atlas format, read from scripts/gen-atlas.ts (NOT guessed):
 *   ATLAS_OFFSETS[rank] is a BIT offset (gen-atlas.ts:7,336 - the GRAY atlas
 *   uses byte offsets, the production 1-bit atlas does not).
 *   bit index = off + gy*W + gx, row-major, MSB-first within each byte.
 *   40 bits per narrow 5x8 glyph. Verified by rendering 'A','0','H' to ASCII.
 *
 * Usage:
 *   node decode_atlas.mjs --dir C:/tmp/sweep --tag decoder
 *   python grade_sweep.py decoder
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as A from '../../../dist/core/atlas.js';

const { values: a } = parseArgs({
  options: {
    dir: { type: 'string', default: 'C:/tmp/sweep' },
    tag: { type: 'string', default: 'decoder' },
    sizes: { type: 'string', default: 's0,s1,s2,s3,s4' },
    pad: { type: 'string', default: '4' },
    verbose: { type: 'boolean', default: false },
  },
});

const AW = A.ATLAS_CELL_W;   // 5
const AH = A.ATLAS_CELL_H;   // 8
const PAD = Number(a.pad);
const CELL = { s0: [5, 8], s1: [7, 10], s2: [10, 16], s3: [14, 22], s4: [20, 32] };
const LABEL = { s0: '5x8', s1: '7x10', s2: '10x16', s3: '14x22', s4: '20x32' };

/** bit at (gx,gy) of the glyph whose atlas bit-offset is `off`. MSB-first. */
function atlasBit(off, gx, gy) {
  const i = off + gy * AW + gx;
  return (A.ATLAS_PIXELS[i >> 3] >> (7 - (i & 7))) & 1;
}

// Template set: printable ASCII only. That is the alphabet these pages use,
// and restricting it is what makes "no match" meaningful rather than a
// reach into 35k CJK codepoints.
const TEMPLATES = [];
for (let cp = 0x20; cp <= 0x7e; cp++) {
  const r = A.atlasRank(cp);
  if (r < 0) continue;
  const off = A.ATLAS_OFFSETS[r];
  const bits = new Uint8Array(AW * AH);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) bits[y * AW + x] = atlasBit(off, x, y);
  TEMPLATES.push({ ch: String.fromCodePoint(cp), bits, ink: bits.reduce((s, v) => s + v, 0) });
}

/** Nearest-neighbour decode of one cell. Returns {ch, d, margin}. */
function matchCell(cellBits) {
  let b1 = 1e9, b2 = 1e9, ch = '\uFFFD';
  for (const t of TEMPLATES) {
    let d = 0;
    for (let i = 0; i < cellBits.length; i++) if (cellBits[i] !== t.bits[i]) { d++; if (d >= b2) break; }
    if (d < b1) { b2 = b1; b1 = d; ch = t.ch; }
    else if (d < b2) b2 = d;
  }
  return { ch, d: b1, margin: b2 - b1 };
}

async function decodePage(png, cw, chh) {
  const img = await loadImage(png);
  const cv = createCanvas(img.width, img.height);
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, img.width, img.height).data;

  const cols = Math.floor((img.width - 2 * PAD) / cw);
  const rows = Math.floor((img.height - 2 * PAD) / chh);
  const lines = [];
  const conf = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const bits = new Uint8Array(AW * AH);
      let ink = 0;
      for (let gy = 0; gy < AH; gy++) {
        for (let gx = 0; gx < AW; gx++) {
          const X = PAD + c * cw + gx;
          const Y = PAD + r * chh + gy;
          if (X >= img.width || Y >= img.height) continue;
          const o = (Y * img.width + X) * 4;
          // Renderer draws DARK text on a LIGHT background (measured: corner
          // pixel = 255, ink = 0). Ink is therefore the LOW values.
          const v = (px[o] + px[o + 1] + px[o + 2]) / 3;
          const b = v < 128 ? 1 : 0;
          bits[gy * AW + gx] = b;
          ink += b;
        }
      }
      if (ink === 0) { line += ' '; conf.push({ ch: ' ', d: 0, margin: 99 }); continue; }
      const m = matchCell(bits);
      line += m.ch;
      conf.push(m);
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return { text: lines.join('\n'), conf };
}

const golds = JSON.parse(readFileSync(join(a.dir, 'golds.json'), 'utf8'));
const SIZES = a.sizes.split(',').map((s) => s.trim());

console.log(`templates=${TEMPLATES.length} printable-ASCII glyphs (atlas ${AW}x${AH}, MSB-first row-major)`);
console.log(`${'cell'.padEnd(8)}${'page'.padStart(5)}${'cells'.padStart(7)}${'exact'.padStart(7)}${'ambig'.padStart(7)}${'unread'.padStart(8)}  ms`);
console.log('-'.repeat(56));

for (const k of SIZES) {
  const [cw, chh] = CELL[k] || [5, 8];
  for (let i = 0; i < (golds[k]?.length ?? 0); i++) {
    const png = join(a.dir, `${k}_${i}.png`);
    if (!existsSync(png)) { console.log(`${LABEL[k].padEnd(8)}${String(i).padStart(5)}   MISSING`); continue; }
    const t0 = Date.now();
    const { text, conf } = await decodePage(png, cw, chh);
    const ms = Date.now() - t0;
    const nonblank = conf.filter((c) => c.ch !== ' ');
    const exact = nonblank.filter((c) => c.d === 0).length;
    const ambig = nonblank.filter((c) => c.d > 0 && c.margin <= 1).length;
    const unread = nonblank.filter((c) => c.d > 6).length;
    writeFileSync(join(a.dir, `out_${a.tag}_${k}_${i}.txt`), text, 'utf8');
    console.log(`${LABEL[k].padEnd(8)}${String(i).padStart(5)}${String(nonblank.length).padStart(7)}${String(exact).padStart(7)}${String(ambig).padStart(7)}${String(unread).padStart(8)}  ${ms}`);
    if (a.verbose && i === 0) console.log(text.split('\n').slice(0, 3).map((l) => '    ' + l).join('\n'));
  }
}
console.log();
console.log(`next: python grade_sweep.py ${a.tag}`);
