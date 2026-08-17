// Local glyph-integrity fixture renderer. This is intentionally offline: it
// proves the built renderer still emits the checked-in printable-ASCII corpus;
// it does not measure a daemon, an upstream API, or VLM/OCR behavior.
import { renderTextToPngs } from '../../../dist/core/render.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const REFERENCE_PATH = new URL('./glyph_integrity_reference.json', import.meta.url);
const { values: args } = parseArgs({
  options: {
    dir: { type: 'string', default: 'C:/tmp/sweep' },
  },
});

const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'));
const fixture = reference.fixture;

function fail(message) {
  throw new Error(`GLYPH_FIXTURE_INVALID: ${message}`);
}

function validateFixture() {
  if (!fixture || typeof fixture !== 'object') fail('fixture is missing');
  if (!Number.isInteger(fixture.columns) || fixture.columns <= 0) fail('columns must be a positive integer');
  if (typeof fixture.ascii_corpus_text !== 'string' || fixture.ascii_corpus_text.length === 0) {
    fail('printable-ASCII corpus is empty');
  }
  const corpus = Array.from(fixture.ascii_corpus_text.replaceAll('\n', ''));
  if (corpus.length !== 95 || corpus.some((ch, index) => ch.codePointAt(0) !== 0x20 + index)) {
    fail('corpus must contain U+0020 through U+007E exactly once and in order');
  }
  if (!Array.isArray(fixture.pages) || fixture.pages.length === 0) fail('pages must be non-empty');
  for (const [index, page] of fixture.pages.entries()) {
    if (!page || typeof page.text !== 'string' || page.text.length === 0) fail(`page ${index} is empty`);
    if (!page.text.startsWith(`${fixture.ascii_corpus_text}\n`)) {
      fail(`page ${index} does not begin with the printable-ASCII corpus`);
    }
    const rows = page.text.split('\n');
    if (rows.some((row) => row.length === 0 || row.length > fixture.columns)) {
      fail(`page ${index} has an empty or over-wide row`);
    }
  }
  if (!Array.isArray(fixture.geometries) || fixture.geometries.length === 0) fail('geometries must be non-empty');
  const ids = new Set();
  for (const geometry of fixture.geometries) {
    if (!geometry || typeof geometry.id !== 'string' || geometry.id.length === 0 || ids.has(geometry.id)) {
      fail('geometry ids must be non-empty and unique');
    }
    ids.add(geometry.id);
    if (!Number.isInteger(geometry.cell_width) || geometry.cell_width <= 0 ||
        !Number.isInteger(geometry.cell_height) || geometry.cell_height <= 0) {
      fail(`geometry ${geometry.id} has an invalid cell size`);
    }
  }
}

validateFixture();
mkdirSync(args.dir, { recursive: true });

for (const geometry of fixture.geometries) {
  for (const [pageIndex, page] of fixture.pages.entries()) {
    const pngs = await renderTextToPngs(page.text, fixture.columns, {
      aa: true,
      cellWBonus: geometry.cell_width - 5,
      cellHBonus: geometry.cell_height - 8,
    });
    if (pngs.length !== 1) {
      fail(`${geometry.id}_${pageIndex} rendered ${pngs.length} PNG pages; expected exactly one`);
    }
    const rendered = pngs[0];
    if (!rendered?.png?.length || rendered.width <= 0 || rendered.height <= 0 || rendered.droppedChars !== 0) {
      fail(`${geometry.id}_${pageIndex} produced an invalid or truncated PNG`);
    }
    writeFileSync(join(args.dir, `${geometry.id}_${pageIndex}.png`), rendered.png);
    console.log(
      `${geometry.id} cell=${geometry.cell_width}x${geometry.cell_height}px ` +
      `page=${pageIndex} ${rendered.width}x${rendered.height}px chars=${Array.from(page.text).length}`,
    );
  }
}

// Diagnostic only. The decoder always reads the checked-in reference, never this
// generated copy, so generated output cannot become its own source of truth.
writeFileSync(join(args.dir, 'glyph_integrity_fixture.json'), JSON.stringify(reference, null, 2) + '\n');
console.log(`GLYPH_FIXTURE_RENDERED geometries=${fixture.geometries.length} pages=${fixture.pages.length}`);
