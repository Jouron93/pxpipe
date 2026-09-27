/**
 * Comprehensive Deterministic Rendering Benchmark Harness
 * Evaluates candidate geometries, fonts, cell bonuses, AA, and grid rules
 * across 6 representative fixtures in evidence/fixtures/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  renderTextToPngsWithCharLimit,
  clearRenderCache,
  type RenderFont,
  type RenderStyle,
  type RenderedImage,
  renderCellWidth,
  renderCellHeight,
} from '../src/core/render.js';

interface BenchmarkFixture {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly lineCount: number;
  readonly charCount: number;
}

interface CandidateConfig {
  readonly name: string;
  readonly cols: number;
  readonly maxHeightPx: number;
  readonly font: RenderFont;
  readonly cellWBonus: number;
  readonly cellHBonus: number;
  readonly aa: boolean;
  readonly grid: boolean;
}

interface FixtureResult {
  readonly fixtureId: string;
  readonly imageCount: number;
  readonly totalBytes: number;
  readonly totalPixels: number;
  readonly charsRendered: number;
  readonly droppedChars: number;
  readonly latencyMs: number;
  readonly maxImageWidth: number;
  readonly maxImageHeight: number;
  readonly clippingPassed: boolean;
  readonly droppedCodepointCounts: Record<string, number>;
}

interface ConfigEvaluation {
  readonly config: CandidateConfig;
  readonly fixtureResults: FixtureResult[];
  readonly totalImages: number;
  readonly totalBytes: number;
  readonly totalPixels: number;
  readonly totalLatencyMs: number;
  readonly totalDroppedChars: number;
  readonly allClippingPassed: boolean;
  readonly score: number;
}

const FIXTURES_DIR = 'C:\\Projects\\pxpipe\\evidence\\fixtures';

function loadFixtures(): BenchmarkFixture[] {
  const files = [
    { id: '01-short-code', name: 'Short Code Snippet (~100 lines)', file: '01-short-code.txt' },
    { id: '02-long-monolith', name: 'Long Monolithic File (~1,500 lines)', file: '02-long-monolith.txt' },
    { id: '03-structured-json', name: 'Structured JSON / Config', file: '03-structured-json.txt' },
    { id: '04-unicode-box', name: 'Unicode & Non-ASCII Matrix', file: '04-unicode-box.txt' },
    { id: '05-dense-table', name: 'Dense Formatted Table', file: '05-dense-table.txt' },
    { id: '06-git-diff', name: 'Unified Git Diff', file: '06-git-diff.txt' },
  ];

  return files.map((f) => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, f.file), 'utf8');
    const lines = raw.split('\n');
    let charCount = 0;
    for (const _ of raw) charCount++;
    return {
      id: f.id,
      name: f.name,
      content: raw,
      lineCount: lines.length,
      charCount,
    };
  });
}

function buildCandidateGrid(): CandidateConfig[] {
  const candidates: CandidateConfig[] = [];

  // 1. Core Profile Presets
  candidates.push({
    name: 'Anthropic-Default-Spleen-312x728',
    cols: 312,
    maxHeightPx: 728,
    font: 'spleen-5x8',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: true,
    grid: false,
  });

  candidates.push({
    name: 'Anthropic-Precise-JB14-172x728',
    cols: 172,
    maxHeightPx: 728,
    font: 'jetbrains-mono-14',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: true,
    grid: false,
  });

  candidates.push({
    name: 'OpenAI-Astra-JB14-84x1954',
    cols: 84,
    maxHeightPx: 1954,
    font: 'jetbrains-mono-14',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: true,
    grid: false,
  });

  candidates.push({
    name: 'xAI-Grok-Spleen-152x512',
    cols: 152,
    maxHeightPx: 512,
    font: 'spleen-5x8',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: true,
    grid: false,
  });

  // 2. Systematic Column Sweeps (84, 152, 200, 312) at 728px
  for (const cols of [84, 152, 200, 312]) {
    for (const font of ['spleen-5x8', 'jetbrains-mono-14'] as RenderFont[]) {
      const name = `Sweep-Cols-${cols}-${font}`;
      if (!candidates.some((c) => c.cols === cols && c.font === font && c.maxHeightPx === 728 && c.cellWBonus === 0 && c.cellHBonus === 0 && c.aa === true && !c.grid)) {
        candidates.push({
          name,
          cols,
          maxHeightPx: 728,
          font,
          cellWBonus: 0,
          cellHBonus: 0,
          aa: true,
          grid: false,
        });
      }
    }
  }

  // 3. Systematic Height Sweeps (512, 728, 1568, 1954)
  for (const maxHeightPx of [512, 728, 1568, 1954]) {
    const name = `Sweep-Height-${maxHeightPx}-Spleen312`;
    if (!candidates.some((c) => c.maxHeightPx === maxHeightPx && c.cols === 312 && c.font === 'spleen-5x8' && c.cellWBonus === 0 && c.cellHBonus === 0 && c.aa === true && !c.grid)) {
      candidates.push({
        name,
        cols: 312,
        maxHeightPx,
        font: 'spleen-5x8',
        cellWBonus: 0,
        cellHBonus: 0,
        aa: true,
        grid: false,
      });
    }

    const jbName = `Sweep-Height-${maxHeightPx}-JB14-84`;
    if (!candidates.some((c) => c.maxHeightPx === maxHeightPx && c.cols === 84 && c.font === 'jetbrains-mono-14' && c.cellWBonus === 0 && c.cellHBonus === 0 && c.aa === true && !c.grid)) {
      candidates.push({
        name: jbName,
        cols: 84,
        maxHeightPx,
        font: 'jetbrains-mono-14',
        cellWBonus: 0,
        cellHBonus: 0,
        aa: true,
        grid: false,
      });
    }
  }

  // 4. Cell Spacing Sweeps (cellWBonus, cellHBonus: 0, 2, 4)
  for (const bonus of [2, 4]) {
    candidates.push({
      name: `Sweep-CellSpacing-W${bonus}-Spleen`,
      cols: 200,
      maxHeightPx: 728,
      font: 'spleen-5x8',
      cellWBonus: bonus,
      cellHBonus: 0,
      aa: true,
      grid: false,
    });
    candidates.push({
      name: `Sweep-CellSpacing-H${bonus}-Spleen`,
      cols: 312,
      maxHeightPx: 728,
      font: 'spleen-5x8',
      cellWBonus: 0,
      cellHBonus: bonus,
      aa: true,
      grid: false,
    });
    candidates.push({
      name: `Sweep-CellSpacing-WH${bonus}-Spleen`,
      cols: 200,
      maxHeightPx: 728,
      font: 'spleen-5x8',
      cellWBonus: bonus,
      cellHBonus: bonus,
      aa: true,
      grid: false,
    });
  }

  // 5. Font Family Sweeps (spleen-5x8, jetbrains-mono-10, jetbrains-mono-12, jetbrains-mono-14)
  for (const font of ['jetbrains-mono-10', 'jetbrains-mono-12'] as RenderFont[]) {
    candidates.push({
      name: `Sweep-Font-${font}`,
      cols: 152,
      maxHeightPx: 728,
      font,
      cellWBonus: 0,
      cellHBonus: 0,
      aa: true,
      grid: false,
    });
  }

  // 6. Anti-Aliasing Sweeps (aa: false vs true)
  candidates.push({
    name: 'Sweep-AA-False-Spleen-312x728',
    cols: 312,
    maxHeightPx: 728,
    font: 'spleen-5x8',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: false,
    grid: false,
  });

  candidates.push({
    name: 'Sweep-AA-False-JB14-84x1954',
    cols: 84,
    maxHeightPx: 1954,
    font: 'jetbrains-mono-14',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: false,
    grid: false,
  });

  // 7. Grid Lines Sweeps (grid: true vs false)
  candidates.push({
    name: 'Sweep-Grid-True-Spleen-312x728',
    cols: 312,
    maxHeightPx: 728,
    font: 'spleen-5x8',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: true,
    grid: true,
  });

  candidates.push({
    name: 'Sweep-Grid-True-JB14-84x1954',
    cols: 84,
    maxHeightPx: 1954,
    font: 'jetbrains-mono-14',
    cellWBonus: 0,
    cellHBonus: 0,
    aa: true,
    grid: true,
  });

  return candidates;
}

async function evaluateCandidateOnFixture(
  config: CandidateConfig,
  fixture: BenchmarkFixture,
): Promise<FixtureResult> {
  clearRenderCache();

  const style: RenderStyle = {
    font: config.font,
    cellWBonus: config.cellWBonus,
    cellHBonus: config.cellHBonus,
    aa: config.aa,
    grid: config.grid,
  };

  // Warmup run
  await renderTextToPngsWithCharLimit(
    fixture.content.slice(0, 500),
    config.cols,
    28080,
    style,
    config.maxHeightPx,
  );
  clearRenderCache();

  // Timed measurement
  const t0 = performance.now();
  const images = await renderTextToPngsWithCharLimit(
    fixture.content,
    config.cols,
    28080,
    style,
    config.maxHeightPx,
  );
  const latencyMs = performance.now() - t0;

  let totalBytes = 0;
  let totalPixels = 0;
  let charsRendered = 0;
  let droppedChars = 0;
  let maxImageWidth = 0;
  let maxImageHeight = 0;
  const droppedCodepointCounts: Record<string, number> = {};

  for (const img of images) {
    totalBytes += img.png.byteLength;
    totalPixels += img.width * img.height;
    charsRendered += img.charsRendered;
    droppedChars += img.droppedChars;
    if (img.width > maxImageWidth) maxImageWidth = img.width;
    if (img.height > maxImageHeight) maxImageHeight = img.height;

    for (const [cp, count] of img.droppedCodepoints.entries()) {
      const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
      droppedCodepointCounts[hex] = (droppedCodepointCounts[hex] ?? 0) + count;
    }
  }

  // Hard Veto: any character loss or dropped character fails clipping check
  // Note: for Unicode fixture, non-BMP or unmapped characters count as droppedChars.
  // Clipping check: charsRendered must match fixture or no text was dropped
  const clippingPassed = droppedChars === 0;

  return {
    fixtureId: fixture.id,
    imageCount: images.length,
    totalBytes,
    totalPixels,
    charsRendered,
    droppedChars,
    latencyMs,
    maxImageWidth,
    maxImageHeight,
    clippingPassed,
    droppedCodepointCounts,
  };
}

export async function runBenchmark(): Promise<{
  fixtures: BenchmarkFixture[];
  evaluations: ConfigEvaluation[];
}> {
  const fixtures = loadFixtures();
  const candidates = buildCandidateGrid();
  const evaluations: ConfigEvaluation[] = [];

  console.log(`Starting benchmark across ${fixtures.length} fixtures and ${candidates.length} candidate configurations...`);

  for (const config of candidates) {
    const fixtureResults: FixtureResult[] = [];
    let totalImages = 0;
    let totalBytes = 0;
    let totalPixels = 0;
    let totalLatencyMs = 0;
    let totalDroppedChars = 0;
    let allClippingPassed = true;

    for (const fixture of fixtures) {
      const res = await evaluateCandidateOnFixture(config, fixture);
      fixtureResults.push(res);
      totalImages += res.imageCount;
      totalBytes += res.totalBytes;
      totalPixels += res.totalPixels;
      totalLatencyMs += res.latencyMs;
      totalDroppedChars += res.droppedChars;
      if (!res.clippingPassed) allClippingPassed = false;
    }

    // Scoring weights per baseline.md § 8.3:
    // Clipping: Hard Veto (score = 0 if any drop, except we record score for comparison)
    // Image Count Efficiency (minimize): weight 0.35
    // Payload Size (minimize): weight 0.30
    // Latency (minimize): weight 0.20
    // Simplicity (maximize): weight 0.15
    const simplicityPenalty =
      (config.cellWBonus !== 0 ? 0.2 : 0) +
      (config.cellHBonus !== 0 ? 0.2 : 0) +
      (config.grid ? 0.1 : 0) +
      (config.font !== 'spleen-5x8' && config.font !== 'jetbrains-mono-14' ? 0.2 : 0);

    const simplicityScore = Math.max(0, 1 - simplicityPenalty);

    evaluations.push({
      config,
      fixtureResults,
      totalImages,
      totalBytes,
      totalPixels,
      totalLatencyMs,
      totalDroppedChars,
      allClippingPassed,
      score: simplicityScore, // will normalize below
    });
  }

  // Normalize metrics across candidates to compute final composite scores (0 to 100)
  const minImages = Math.min(...evaluations.map((e) => e.totalImages));
  const maxImages = Math.max(...evaluations.map((e) => e.totalImages));
  const minBytes = Math.min(...evaluations.map((e) => e.totalBytes));
  const maxBytes = Math.max(...evaluations.map((e) => e.totalBytes));
  const minLat = Math.min(...evaluations.map((e) => e.totalLatencyMs));
  const maxLat = Math.max(...evaluations.map((e) => e.totalLatencyMs));

  const scored = evaluations.map((e) => {
    // Inverted normalized: min is best (1.0), max is worst (0.0)
    const imgScore = maxImages === minImages ? 1.0 : (maxImages - e.totalImages) / (maxImages - minImages);
    const byteScore = maxBytes === minBytes ? 1.0 : (maxBytes - e.totalBytes) / (maxBytes - minBytes);
    const latScore = maxLat === minLat ? 1.0 : (maxLat - e.totalLatencyMs) / (maxLat - minLat);
    const simpScore = e.score;

    // Composite: 0.35 * img + 0.30 * byte + 0.20 * lat + 0.15 * simp
    let composite = (0.35 * imgScore + 0.30 * byteScore + 0.20 * latScore + 0.15 * simpScore) * 100;
    if (!e.allClippingPassed) {
      // Hard veto penalty
      composite *= 0.1;
    }

    return {
      ...e,
      score: Number(composite.toFixed(2)),
    };
  });

  return { fixtures, evaluations: scored };
}

// Execute directly if run as main
if (process.argv[1]?.includes('benchmark-render')) {
  runBenchmark().then(({ fixtures, evaluations }) => {
    const outJsonPath = 'C:\\Projects\\pxpipe\\evidence\\benchmark-results.json';
    fs.writeFileSync(outJsonPath, JSON.stringify({ fixtures, evaluations }, null, 2), 'utf8');
    console.log(`\nBenchmark complete! Results written to ${outJsonPath}`);
    console.log(`Evaluated ${evaluations.length} configurations across ${fixtures.length} fixtures.`);
    
    // Sort by composite score descending
    const sorted = [...evaluations].sort((a, b) => b.score - a.score);
    console.log('\nTop 5 Candidates by Composite Score:');
    for (let i = 0; i < Math.min(5, sorted.length); i++) {
      const e = sorted[i]!;
      console.log(`${i + 1}. [${e.score.toFixed(1)}] ${e.config.name} | Imgs: ${e.totalImages}, Bytes: ${(e.totalBytes / 1024).toFixed(1)} KiB, Latency: ${e.totalLatencyMs.toFixed(1)} ms, Dropped: ${e.totalDroppedChars}`);
    }
  }).catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
}
