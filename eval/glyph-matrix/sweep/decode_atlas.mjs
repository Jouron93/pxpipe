#!/usr/bin/env node
/**
 * Deterministic local renderer-integrity check (NOT a VLM/OCR benchmark).
 *
 * It decodes the built Spleen atlas from its cells and compares every expected
 * cell against a checked-in printable-ASCII fixture. The fixture also pins the
 * exact atlas artifacts it authorizes, so generated PNG output is never used
 * as its own oracle.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as A from '../../../dist/core/atlas.js';

const AUTHORIZED_SOURCE_COMMIT = 'baaa3b37fd9c950896279ea7bd63481d91bdd044';
const REQUIRED_ARTIFACTS = {
  'dist/core/atlas.js': '9609F45F35820528A32BC9D985735FD1CBA5F3D5D89ABBC12E42F38AFFB5D29F',
  'dist/core/atlas-gray.js': 'EAB751727E4FAB632AEBC53997C6539E037DD0FD225ACC4406F7D06E5B14C6DD',
};
const REFERENCE_PATH = new URL('./glyph_integrity_reference.json', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string', default: 'C:/tmp/sweep' },
    tag: { type: 'string', default: 'decoder' },
    sizes: { type: 'string' },
    pad: { type: 'string', default: '4' },
    verbose: { type: 'boolean', default: false },
    'assert-exact': { type: 'boolean', default: false },
  },
});

const PAD = Number(args.pad);
const AW = A.ATLAS_CELL_W;
const AH = A.ATLAS_CELL_H;

function fail(message) {
  throw new Error(`GLYPH_INTEGRITY_INVALID: ${message}`);
}

function readReference() {
  const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'));
  if (!Number.isInteger(reference.schema_version) || reference.schema_version < 1) {
    fail('reference schema_version is invalid');
  }
  if (reference.scope !== 'local-build-render-integrity-only') {
    fail('reference scope must be local-build-render-integrity-only');
  }
  if (reference.authorized_source_commit !== AUTHORIZED_SOURCE_COMMIT) {
    fail('reference authorized_source_commit does not match the approved source commit');
  }
  for (const [artifact, expectedHash] of Object.entries(REQUIRED_ARTIFACTS)) {
    if (reference.artifacts?.[artifact]?.sha256 !== expectedHash) {
      fail(`reference does not pin ${artifact}`);
    }
  }
  return reference;
}

function assertArtifactHashes(reference) {
  for (const [artifact, expectedHash] of Object.entries(REQUIRED_ARTIFACTS)) {
    const path = resolve(REPO_ROOT, artifact);
    if (!existsSync(path)) fail(`required built artifact is missing: ${artifact}`);
    const actualHash = createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
    if (actualHash !== expectedHash || actualHash !== reference.artifacts[artifact].sha256) {
      fail(`${artifact} SHA256=${actualHash}; expected ${expectedHash}`);
    }
  }
}

function validateFixture(reference) {
  const fixture = reference.fixture;
  if (!fixture || typeof fixture !== 'object') fail('fixture is missing');
  if (!Number.isInteger(fixture.columns) || fixture.columns <= 0) fail('fixture columns must be a positive integer');
  if (typeof fixture.ascii_corpus_text !== 'string' || fixture.ascii_corpus_text.length === 0) {
    fail('printable-ASCII corpus is empty');
  }
  const corpus = Array.from(fixture.ascii_corpus_text.replaceAll('\n', ''));
  if (corpus.length !== 95 || corpus.some((ch, index) => ch.codePointAt(0) !== 0x20 + index)) {
    fail('corpus must contain U+0020 through U+007E exactly once and in order');
  }
  if (!Array.isArray(fixture.pages) || fixture.pages.length === 0) fail('fixture pages are empty');
  for (const [pageIndex, page] of fixture.pages.entries()) {
    if (!page || typeof page.text !== 'string' || page.text.length === 0) fail(`page ${pageIndex} is empty`);
    if (!page.text.startsWith(`${fixture.ascii_corpus_text}\n`)) {
      fail(`page ${pageIndex} does not begin with the printable-ASCII corpus`);
    }
    const rows = page.text.split('\n');
    if (rows.some((row) => row.length === 0 || row.length > fixture.columns)) {
      fail(`page ${pageIndex} has an empty or over-wide row`);
    }
    if (!Array.isArray(page.labels) || page.labels.length === 0 ||
        page.labels.some((label) => !label?.label || !label?.id)) {
      fail(`page ${pageIndex} has invalid label/id assertions`);
    }
  }
  if (!Array.isArray(fixture.geometries) || fixture.geometries.length === 0) fail('fixture geometries are empty');
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
  if (!Number.isInteger(PAD) || PAD < 0) fail('pad must be a non-negative integer');
  return fixture;
}

/** Bit at (gx, gy) for a glyph whose atlas offset is in bits, MSB-first. */
function atlasBit(offset, gx, gy) {
  const bitIndex = offset + gy * AW + gx;
  return (A.ATLAS_PIXELS[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
}

const TEMPLATES = [];
for (let codepoint = 0x20; codepoint <= 0x7e; codepoint++) {
  const rank = A.atlasRank(codepoint);
  if (rank < 0) fail(`built atlas is missing U+${codepoint.toString(16).padStart(4, '0')}`);
  const bits = new Uint8Array(AW * AH);
  for (let y = 0; y < AH; y++) {
    for (let x = 0; x < AW; x++) bits[y * AW + x] = atlasBit(A.ATLAS_OFFSETS[rank], x, y);
  }
  TEMPLATES.push({ ch: String.fromCodePoint(codepoint), bits });
}
if (TEMPLATES.length !== 95) fail(`expected 95 ASCII templates, found ${TEMPLATES.length}`);

function matchCell(bits) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let runnerUp = Number.POSITIVE_INFINITY;
  let character = '\uFFFD';
  for (const template of TEMPLATES) {
    let distance = 0;
    for (let index = 0; index < bits.length; index++) {
      if (bits[index] !== template.bits[index]) {
        distance++;
        if (distance >= runnerUp) break;
      }
    }
    if (distance < bestDistance) {
      runnerUp = bestDistance;
      bestDistance = distance;
      character = template.ch;
    } else if (distance < runnerUp) {
      runnerUp = distance;
    }
  }
  return { character, distance: bestDistance, margin: runnerUp - bestDistance };
}

async function decodePage(png, geometry) {
  const image = await loadImage(png);
  if (!image.width || !image.height) fail(`${png} decoded to an empty image`);
  const usableWidth = image.width - 2 * PAD;
  const usableHeight = image.height - 2 * PAD;
  if (usableWidth <= 0 || usableHeight <= 0 ||
      usableWidth % geometry.cell_width !== 0 || usableHeight % geometry.cell_height !== 0) {
    fail(`${png} has invalid dimensions ${image.width}x${image.height} for ${geometry.id}`);
  }
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const cols = usableWidth / geometry.cell_width;
  const rows = usableHeight / geometry.cell_height;
  const decodedRows = [];
  for (let row = 0; row < rows; row++) {
    const cells = [];
    for (let col = 0; col < cols; col++) {
      const bits = new Uint8Array(AW * AH);
      let rawInk = 0;
      for (let gy = 0; gy < AH; gy++) {
        for (let gx = 0; gx < AW; gx++) {
          const x = PAD + col * geometry.cell_width + gx;
          const y = PAD + row * geometry.cell_height + gy;
          const pixelOffset = (y * image.width + x) * 4;
          const value = (pixels[pixelOffset] + pixels[pixelOffset + 1] + pixels[pixelOffset + 2]) / 3;
          const bit = value < 128 ? 1 : 0;
          bits[gy * AW + gx] = bit;
          rawInk += bit;
        }
      }
      cells.push(rawInk === 0
        ? { character: ' ', distance: 0, margin: Number.POSITIVE_INFINITY, rawInk }
        : { ...matchCell(bits), rawInk });
    }
    decodedRows.push(cells);
  }
  return { cols, rows, decodedRows };
}

function comparePage(decoded, page, geometry) {
  const expectedRows = page.text.split('\n');
  const actualRows = decoded.decodedRows;
  const result = {
    expectedCells: expectedRows.reduce((total, row) => total + row.length, 0),
    exactCells: 0,
    characterMismatches: 0,
    templateMismatches: 0,
    missingInkCells: 0,
    spaceInkCells: 0,
    extraInkCells: 0,
    rawInkCells: 0,
    labelHits: 0,
    expectedLabels: page.labels.length,
  };
  if (decoded.rows !== expectedRows.length) result.characterMismatches += Math.abs(decoded.rows - expectedRows.length) || 1;
  for (let row = 0; row < decoded.rows; row++) {
    const expected = expectedRows[row] ?? '';
    for (let col = 0; col < decoded.cols; col++) {
      const cell = actualRows[row][col];
      const expectedCharacter = col < expected.length ? expected[col] : null;
      if (cell.rawInk > 0) result.rawInkCells++;
      if (expectedCharacter === null) {
        if (cell.rawInk > 0) result.extraInkCells++;
        continue;
      }
      if (cell.character !== expectedCharacter) result.characterMismatches++;
      if (expectedCharacter === ' ') {
        if (cell.rawInk !== 0) result.spaceInkCells++;
        else if (cell.character === ' ') result.exactCells++;
      } else {
        if (cell.rawInk === 0) result.missingInkCells++;
        if (cell.distance !== 0) result.templateMismatches++;
        if (cell.character === expectedCharacter && cell.rawInk > 0 && cell.distance === 0) result.exactCells++;
      }
    }
  }
  const actualText = expectedRows.map((expected, row) =>
    (actualRows[row] ?? []).slice(0, expected.length).map((cell) => cell.character).join(''),
  ).join('\n');
  result.labelHits = page.labels.filter(({ label, id }) =>
    actualText.includes(`\"label\":\"${label}\",\"id\":\"${id}\"`),
  ).length;
  const failed = result.exactCells !== result.expectedCells ||
    result.characterMismatches !== 0 || result.templateMismatches !== 0 ||
    result.missingInkCells !== 0 || result.spaceInkCells !== 0 || result.extraInkCells !== 0 ||
    result.labelHits !== result.expectedLabels;
  return { actualText, result, failed };
}

const reference = readReference();
const fixture = validateFixture(reference);
assertArtifactHashes(reference);
const allGeometryIds = fixture.geometries.map((geometry) => geometry.id);
const requestedSizeText = args.sizes ?? allGeometryIds.join(',');
const selectedIds = requestedSizeText.split(',').map((id) => id.trim()).filter(Boolean);
if (selectedIds.length === 0 || new Set(selectedIds).size !== selectedIds.length) fail('sizes must be a non-empty, unique list');
const geometryById = new Map(fixture.geometries.map((geometry) => [geometry.id, geometry]));
const selectedGeometries = selectedIds.map((id) => {
  const geometry = geometryById.get(id);
  if (!geometry) fail(`unknown geometry size: ${id}`);
  return geometry;
});
if (args['assert-exact'] &&
    (selectedGeometries.length !== allGeometryIds.length || selectedGeometries.some((geometry) => !allGeometryIds.includes(geometry.id)))) {
  fail('--assert-exact requires every checked-in geometry');
}

console.log(`scope=${reference.scope}; source=${reference.authorized_source_commit}`);
console.log(`templates=${TEMPLATES.length}; corpus=U+0020..U+007E; fixture-pages=${fixture.pages.length}`);
console.log(
  `${'cell'.padEnd(8)}${'page'.padStart(5)}${'expect'.padStart(8)}${'exact'.padStart(8)}` +
  `${'raw-ink'.padStart(9)}${'char'.padStart(6)}${'bits'.padStart(6)}` +
  `${'space'.padStart(7)}${'extra'.padStart(7)}${'labels'.padStart(8)}  ms`,
);
console.log('-'.repeat(90));

let integrityFailed = false;
const totals = {
  expectedCells: 0, exactCells: 0, rawInkCells: 0, characterMismatches: 0,
  templateMismatches: 0, missingInkCells: 0, spaceInkCells: 0, extraInkCells: 0,
  labelHits: 0, expectedLabels: 0,
};
for (const geometry of selectedGeometries) {
  for (const [pageIndex, page] of fixture.pages.entries()) {
    const png = join(args.dir, `${geometry.id}_${pageIndex}.png`);
    if (!existsSync(png)) {
      console.log(`${geometry.id.padEnd(8)}${String(pageIndex).padStart(5)}   MISSING`);
      integrityFailed = true;
      continue;
    }
    const start = Date.now();
    const decoded = await decodePage(png, geometry);
    const { actualText, result, failed } = comparePage(decoded, page, geometry);
    const elapsed = Date.now() - start;
    for (const [key, value] of Object.entries(result)) totals[key] += value;
    if (failed) integrityFailed = true;
    writeFileSync(join(args.dir, `out_${args.tag}_${geometry.id}_${pageIndex}.txt`), actualText, 'utf8');
    console.log(
      `${geometry.id.padEnd(8)}${String(pageIndex).padStart(5)}` +
      `${String(result.expectedCells).padStart(8)}${String(result.exactCells).padStart(8)}` +
      `${String(result.rawInkCells).padStart(9)}${String(result.characterMismatches).padStart(6)}` +
      `${String(result.templateMismatches + result.missingInkCells).padStart(6)}` +
      `${String(result.spaceInkCells).padStart(7)}${String(result.extraInkCells).padStart(7)}` +
      `${`${result.labelHits}/${result.expectedLabels}`.padStart(8)}  ${elapsed}`,
    );
    if (args.verbose) console.log(actualText.split('\n').map((line) => `    ${line}`).join('\n'));
  }
}

console.log();
const summary =
  `cells=${totals.exactCells}/${totals.expectedCells} raw-ink=${totals.rawInkCells} ` +
  `char=${totals.characterMismatches} bits=${totals.templateMismatches + totals.missingInkCells} ` +
  `space-ink=${totals.spaceInkCells} extra-ink=${totals.extraInkCells} ` +
  `labels=${totals.labelHits}/${totals.expectedLabels}`;
if (args['assert-exact']) {
  if (integrityFailed) {
    console.error(`GLYPH_INTEGRITY_FAIL ${summary}`);
    process.exitCode = 1;
  } else {
    console.log(`GLYPH_INTEGRITY_OK ${summary}`);
  }
} else {
  console.log(`GLYPH_INTEGRITY_DIAGNOSTIC ${summary}`);
}
console.log('scope note: this validates only the local built renderer and atlas artifacts, not daemon routing or VLM/OCR parity.');
