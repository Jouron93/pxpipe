#!/usr/bin/env node
/**
 * read_local_vlm.mjs — surrogate-reader arm of the glyph-matrix sweep.
 *
 * FINDINGS.md (2026-07-05) parked three threads. Thread 3:
 *   "Surrogate-reader pre-flight (novel, untested): the proxy holds ground truth
 *    for every page it renders, so a local VLM can proofread each render before
 *    it ships. Go/no-go is one free experiment: miss-set correlation between a
 *    local VLM and Fable on the already-banked glyph-matrix pages and outs."
 *
 * This is that arm. It reuses the existing harness wholesale:
 *   - pages   : gen_sweep.mjs (deterministic, mulberry32 seed 20260616)
 *   - gold    : golds.json
 *   - grading : grade_sweep.py <TAG>   (unchanged — hence the out_<TAG>_<k>_<i>.txt naming)
 * Only the reader is new, because eval/lib/anthropic-client.mjs is Anthropic-only
 * (it strips ANTHROPIC_BASE_URL by design) and cannot target a local endpoint.
 *
 * Zero cost: hits LM Studio's OpenAI-compatible endpoint on 127.0.0.1.
 *
 *   node read_local_vlm.mjs --model qwen2.5-vl-7b --tag qwenvl
 *   python grade_sweep.py qwenvl
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    model: { type: 'string', default: 'qwen2.5-vl-7b' },
    tag: { type: 'string', default: 'qwenvl' },
    dir: { type: 'string', default: 'C:/tmp/sweep' },
    base: { type: 'string', default: 'http://127.0.0.1:1234/v1' },
    sizes: { type: 'string', default: 's0,s1,s2,s3,s4' },
    timeout: { type: 'string', default: '180' },
  },
});

const DIR = a.dir;
const golds = JSON.parse(readFileSync(join(DIR, 'golds.json'), 'utf8'));
const SIZES = a.sizes.split(',').map((s) => s.trim()).filter(Boolean);
const CELL = { s0: '5x8', s1: '7x10', s2: '10x16', s3: '14x22', s4: '20x32' };

// Matches what the banked opus arm was asked for, so the two arms are comparable.
// grade_sweep.py's LINE regex is ^\s*([A-E])\s*[:.]\s*`?([0-9a-fA-F]{12})`?\s*$
const PROMPT = [
  'This image contains lines of JSON. Exactly five of them carry a "label" field',
  'with the values A, B, C, D and E. Each of those five also carries a 12-character',
  'lowercase hexadecimal "id".',
  '',
  'Transcribe the id for each label. Output EXACTLY five lines, nothing else:',
  'A: <12 hex chars>',
  'B: <12 hex chars>',
  'C: <12 hex chars>',
  'D: <12 hex chars>',
  'E: <12 hex chars>',
  '',
  'Do not explain. Do not guess a plausible-looking id — if a character is genuinely',
  'unreadable, still give your single best reading of it.',
].join('\n');

async function readPage(pngPath) {
  const b64 = readFileSync(pngPath).toString('base64');
  const body = {
    model: a.model,
    max_tokens: 300,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
  };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Number(a.timeout) * 1000);
  try {
    const r = await fetch(`${a.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) return { ok: false, text: '', err: `HTTP ${r.status} ${(await r.text()).slice(0, 160)}` };
    const j = await r.json();
    return { ok: true, text: j?.choices?.[0]?.message?.content ?? '' };
  } catch (e) {
    return { ok: false, text: '', err: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

console.log(`model=${a.model}  tag=${a.tag}  endpoint=${a.base}`);
console.log(`${'cell'.padEnd(8)}${'page'.padStart(5)}  ${'chars'.padStart(6)}  status`);
console.log('-'.repeat(52));

let wrote = 0, failed = 0;
for (const k of SIZES) {
  const pages = golds[k]?.length ?? 0;
  for (let i = 0; i < pages; i++) {
    const png = join(DIR, `${k}_${i}.png`);
    if (!existsSync(png)) { console.log(`${(CELL[k] || k).padEnd(8)}${String(i).padStart(5)}  ${'-'.padStart(6)}  MISSING ${png}`); failed++; continue; }
    const t0 = Date.now();
    const res = await readPage(png);
    const out = join(DIR, `out_${a.tag}_${k}_${i}.txt`);
    // Write even on failure: grade_sweep.py counts an empty/absent file as a miss,
    // which is the honest grading of "the reader could not produce a reading".
    writeFileSync(out, res.text ?? '', 'utf8');
    if (res.ok) wrote++; else failed++;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${(CELL[k] || k).padEnd(8)}${String(i).padStart(5)}  ${String((res.text || '').length).padStart(6)}  ${res.ok ? `ok ${secs}s` : `FAIL ${res.err?.slice(0, 40)}`}`);
  }
}
console.log();
console.log(`wrote=${wrote} failed=${failed}`);
console.log(`next: python grade_sweep.py ${a.tag}   (compare its curve to the banked out_opus_* arm)`);
