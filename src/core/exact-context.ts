import { extractFactSheetTokens } from './factsheet.js';

const DEFAULT_MAX_LINES = 256;
const DEFAULT_MAX_CHARS = 32_768;
const DEFAULT_MAX_LINE_CHARS = 4_096;
const DEFAULT_MAX_PARTS = 64;

const DEFAULT_MANIFEST_MAX_LINES = 1024;
const DEFAULT_MANIFEST_MAX_CHARS = 128_000;
const DEFAULT_MANIFEST_MAX_LINE_CHARS = 4_096;

export interface ExactContextLimits {
  readonly maxLines?: number;
  readonly maxChars?: number;
  readonly maxLineChars?: number;
}

export interface ExactContextPlanLimits extends ExactContextLimits {
  readonly maxParts?: number;
}

export type ExactContextFailureReason =
  | 'too_many_lines'
  | 'too_many_chars'
  | 'line_too_long'
  | 'too_many_parts'
  | 'unsupported_line_endings';

export interface ExactContextManifest {
  /** Native text placed next to the rendered slab. Empty when no sharp lines exist. */
  readonly text: string;
  readonly lineCount: number;
  readonly sourceChars: number;
  readonly preservedChars: number;
  /** False means the caller must fail closed and leave the request byte-identical. */
  readonly complete: boolean;
  readonly reason?: ExactContextFailureReason;
}

/**
 * A selective exact-context transform plan.
 *
 * `imageableText` is the counterfactual baseline: original, image-safe source only,
 * with no PXPipe markers or native wrappers. `imageSource` is the actual render
 * payload and adds one small marker at every removed block. `protectedText` contains
 * the unwrapped protected source exactly once, in source order. `nativeParts` are
 * independently intelligible, bounded payloads suitable for separate input_text
 * parts. `text` is their exact newline-joined wire-accounting view.
 */
export interface ExactContextPlan {
  readonly imageSource: string;
  readonly imageableText: string;
  readonly protectedText: string;
  readonly nativeParts: readonly string[];
  readonly text: string;
  readonly lineCount: number;
  readonly blockCount: number;
  readonly sourceChars: number;
  readonly imageableChars: number;
  readonly imageChars: number;
  readonly preservedChars: number;
  readonly nativeWrapperChars: number;
  /** False means the caller must fail closed and leave the request byte-identical. */
  readonly complete: boolean;
  readonly reason?: ExactContextFailureReason;
}

const OPEN = [
  '[Exact source lines from the rendered context above.]',
  'These native-text lines are authoritative for identifiers, values, and their associations; use them instead of transcribing the image.',
].join('\n');
const CLOSE = '[End of exact source lines.]';

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

interface MarkdownFence {
  readonly marker: '`' | '~';
  readonly length: number;
}

function fenceAt(line: string): { fence: MarkdownFence; suffix: string } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return undefined;
  const run = match[1]!;
  const suffix = match[2]!;
  if (run[0] === '`' && suffix.includes('`')) return undefined;
  return {
    fence: { marker: run[0] as MarkdownFence['marker'], length: run.length },
    suffix,
  };
}

function isPrecisionSensitiveLine(line: string): boolean {
  if (extractFactSheetTokens(line).length > 0) return true;
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Keep complete structured rows so small values and their keys remain associated.
  if (/(?:^|[\s,{[(])["']?[A-Za-z_][\w.-]*["']?\s*[:=]\s*\S/.test(line)) return true;
  if (trimmed.includes('|') && trimmed.split('|').length >= 3) return true;

  // Preserve code-like identifiers even when they are too short for the legacy fact sheet.
  if (/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/.test(line)) return true;
  return /\b(?=[A-Za-z0-9_-]{2,32}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/.test(line);
}

interface ClassifiedExactContext {
  readonly lines: readonly SourceLine[];
  readonly sharpLines: ReadonlySet<number>;
  readonly headingLines: ReadonlySet<number>;
}

interface SourceLine {
  readonly text: string;
  readonly ending: '\r\n' | '\n' | '\r' | '';
  readonly documentIndex: number;
  readonly synthetic: boolean;
}

function splitSourceLines(source: string, documentIndex = 0): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char !== '\r' && char !== '\n') {
      cursor++;
      continue;
    }

    const ending = char === '\r' && source[cursor + 1] === '\n'
      ? '\r\n'
      : char;
    lines.push({
      text: source.slice(start, cursor),
      ending: ending as SourceLine['ending'],
      documentIndex,
      synthetic: false,
    });
    cursor += ending.length;
    start = cursor;
  }

  lines.push({
    text: source.slice(start),
    ending: '',
    documentIndex,
    synthetic: false,
  });
  return lines;
}

function sourceDocumentLines(documents: readonly string[]): SourceLine[] {
  const lines: SourceLine[] = [];
  for (let documentIndex = 0; documentIndex < documents.length; documentIndex++) {
    lines.push(...splitSourceLines(documents[documentIndex]!, documentIndex));
    if (documentIndex === documents.length - 1) continue;

    // Responses combines separate authority documents with two synthetic LFs for
    // rendering and accounting. Keep them independent from either document's
    // source endings so an unterminated or lone-CR protected line remains exact.
    lines.push(
      { text: '', ending: '\n', documentIndex: -1, synthetic: true },
      { text: '', ending: '\n', documentIndex: -1, synthetic: true },
    );
  }
  return lines;
}

function classifyExactContextDocuments(documents: readonly string[]): ClassifiedExactContext {
  const lines = sourceDocumentLines(documents);
  const sharpLines = new Set<number>();
  const headingLines = new Set<number>();
  const activeHeadings = new Map<number, number>();
  let openFence: MarkdownFence | undefined;
  let activeDocumentIndex = -1;

  const preserveWithHeadings = (lineIndex: number): void => {
    sharpLines.add(lineIndex);
    for (const headingIndex of activeHeadings.values()) headingLines.add(headingIndex);
  };

  for (let i = 0; i < lines.length; i++) {
    const sourceLine = lines[i]!;
    if (sourceLine.synthetic) {
      activeHeadings.clear();
      openFence = undefined;
      activeDocumentIndex = -1;
      continue;
    }
    if (sourceLine.documentIndex !== activeDocumentIndex) {
      activeHeadings.clear();
      openFence = undefined;
      activeDocumentIndex = sourceLine.documentIndex;
    }

    const line = sourceLine.text;
    const heading = /^ {0,3}(#{1,6})\s/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      for (const activeLevel of [...activeHeadings.keys()]) {
        if (activeLevel >= level) activeHeadings.delete(activeLevel);
      }
      activeHeadings.set(level, i);
    }

    const marker = fenceAt(line);
    if (openFence) {
      preserveWithHeadings(i);
      if (
        marker?.fence.marker === openFence.marker
        && marker.fence.length >= openFence.length
        && marker.suffix.trim().length === 0
      ) {
        openFence = undefined;
      }
      continue;
    }

    if (marker) {
      preserveWithHeadings(i);
      openFence = marker.fence;
      continue;
    }

    if (isPrecisionSensitiveLine(line)) preserveWithHeadings(i);
  }

  return { lines, sharpLines, headingLines };
}

function classifyExactContext(source: string): ClassifiedExactContext {
  return classifyExactContextDocuments([source]);
}

interface ProtectedLine {
  readonly blockId: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly ending: SourceLine['ending'];
  readonly documentIndex: number;
}

interface ProtectedBlock {
  readonly id: number;
  readonly startLineIndex: number;
  readonly endLineIndex: number;
  readonly lines: readonly ProtectedLine[];
}

const NATIVE_PART_OPEN = [
  '[Exact native source removed from the rendered context.]',
  'The verbatim source below is authoritative; use it instead of inferring exact text from the image.',
].join('\n');
const NATIVE_PART_CLOSE = '[End of exact native source.]';

function nativeBlockMarker(blockId: number, startLineIndex: number, endLineIndex: number): string {
  const start = startLineIndex + 1;
  const end = endLineIndex + 1;
  const span = start === end ? `${start}` : `${start}-${end}`;
  return `[Exact native block B${blockId}: source lines ${span}.]`;
}

function renderNativePart(lines: readonly ProtectedLine[]): string {
  let body = `${NATIVE_PART_OPEN}\n`;
  let start = 0;
  while (start < lines.length) {
    const first = lines[start]!;
    let end = start + 1;
    while (
      end < lines.length
      && lines[end]!.blockId === first.blockId
      && lines[end]!.lineIndex === lines[end - 1]!.lineIndex + 1
    ) {
      end++;
    }
    const last = lines[end - 1]!;
    body += `${nativeBlockMarker(first.blockId, first.lineIndex, last.lineIndex)}\n`;
    for (let i = start; i < end; i++) {
      const line = lines[i]!;
      body += line.text + line.ending;
    }
    start = end;
  }
  if (lines[lines.length - 1]!.ending === '') body += '\n';
  return body + NATIVE_PART_CLOSE;
}

function failedPlan(
  sourceChars: number,
  lineCount: number,
  blockCount: number,
  preservedChars: number,
  reason: ExactContextFailureReason,
): ExactContextPlan {
  return {
    imageSource: '',
    imageableText: '',
    protectedText: '',
    nativeParts: [],
    text: '',
    lineCount,
    blockCount,
    sourceChars,
    imageableChars: 0,
    imageChars: 0,
    preservedChars,
    nativeWrapperChars: 0,
    complete: false,
    reason,
  };
}

/**
 * Build a selective preservation plan for large Codex authority contexts.
 *
 * Precision-sensitive lines and complete fenced blocks remain native. The render
 * source contains only image-safe original lines plus deterministic block markers,
 * so exact values are never duplicated into the image. Protected lines are packed
 * into as many bounded native parts as necessary, without truncation or reordering.
 * A long individual source line or exhaustion of the explicit part bound is the
 * only reason to fail closed.
 */
function buildExactContextPlanInternal(
  documents: readonly string[],
  limits: ExactContextPlanLimits = {},
): ExactContextPlan {
  const source = documents.join('\n\n');
  if (!source) {
    return {
      imageSource: '',
      imageableText: '',
      protectedText: '',
      nativeParts: [],
      text: '',
      lineCount: 0,
      blockCount: 0,
      sourceChars: 0,
      imageableChars: 0,
      imageChars: 0,
      preservedChars: 0,
      nativeWrapperChars: 0,
      complete: true,
    };
  }

  const maxLines = positiveLimit(limits.maxLines, DEFAULT_MAX_LINES);
  const maxChars = positiveLimit(limits.maxChars, DEFAULT_MAX_CHARS);
  const maxLineChars = positiveLimit(limits.maxLineChars, DEFAULT_MAX_LINE_CHARS);
  const maxParts = positiveLimit(limits.maxParts, DEFAULT_MAX_PARTS);
  const { lines, sharpLines, headingLines } = classifyExactContextDocuments(documents);

  if (sharpLines.size === 0) {
    return {
      imageSource: source,
      imageableText: source,
      protectedText: '',
      nativeParts: [],
      text: '',
      lineCount: 0,
      blockCount: 0,
      sourceChars: source.length,
      imageableChars: source.length,
      imageChars: source.length,
      preservedChars: 0,
      nativeWrapperChars: 0,
      complete: true,
    };
  }

  // Keep the active heading chain with the sharp source it qualifies. Headings
  // are original source, not synthetic wrappers, and retaining them natively
  // preserves associations such as which section owns a timing or ID table.
  const protectedLineIndexes = new Set([...sharpLines, ...headingLines]);
  const blocks: ProtectedBlock[] = [];
  let current: ProtectedLine[] = [];
  let blockId = 0;
  const finishBlock = (): void => {
    if (current.length === 0) return;
    blocks.push({
      id: current[0]!.blockId,
      startLineIndex: current[0]!.lineIndex,
      endLineIndex: current[current.length - 1]!.lineIndex,
      lines: current,
    });
    current = [];
  };

  let previousSharp = -2;
  let previousDocumentIndex = -1;
  for (const lineIndex of [...protectedLineIndexes].sort((a, b) => a - b)) {
    const line = lines[lineIndex]!;
    if (
      lineIndex !== previousSharp + 1
      || line.documentIndex !== previousDocumentIndex
    ) {
      finishBlock();
      blockId++;
    }
    if (line.text.length > maxLineChars) {
      finishBlock();
      return failedPlan(
        source.length, protectedLineIndexes.size, blocks.length + 1, 0, 'line_too_long',
      );
    }
    current.push({
      blockId,
      lineIndex,
      text: line.text,
      ending: line.ending,
      documentIndex: line.documentIndex,
    });
    previousSharp = lineIndex;
    previousDocumentIndex = line.documentIndex;
  }
  finishBlock();

  const imageChunks: string[] = [];
  const imageableChunks: string[] = [];
  const blockByStart = new Map(blocks.map((block) => [block.startLineIndex, block]));
  for (let i = 0; i < lines.length; i++) {
    const block = blockByStart.get(i);
    if (block) {
      imageChunks.push(
        nativeBlockMarker(block.id, block.startLineIndex, block.endLineIndex),
        lines[block.endLineIndex]!.ending,
      );
      i = block.endLineIndex;
      continue;
    }
    if (protectedLineIndexes.has(i)) continue;
    const line = lines[i]!;
    const sourceLine = line.text + line.ending;
    imageChunks.push(sourceLine);
    imageableChunks.push(sourceLine);
  }

  const protectedLines = blocks.flatMap((block) => block.lines);
  const protectedText = protectedLines
    .map((line) => line.text + line.ending)
    .join('');
  const nativeParts: string[] = [];
  let partLines: ProtectedLine[] = [];

  const finishPart = (): boolean => {
    if (partLines.length === 0) return true;
    if (nativeParts.length >= maxParts) return false;
    nativeParts.push(renderNativePart(partLines));
    partLines = [];
    return true;
  };

  for (const line of protectedLines) {
    if (
      partLines.length > 0
      && partLines[partLines.length - 1]!.documentIndex !== line.documentIndex
      && !finishPart()
    ) {
      return failedPlan(
        source.length, protectedLineIndexes.size, blocks.length, protectedText.length, 'too_many_parts',
      );
    }

    const candidate = [...partLines, line];
    const candidateText = renderNativePart(candidate);
    if (candidate.length <= maxLines && candidateText.length <= maxChars) {
      partLines = candidate;
      continue;
    }

    if (!finishPart()) {
      return failedPlan(
        source.length, protectedLineIndexes.size, blocks.length, protectedText.length, 'too_many_parts',
      );
    }

    const singleText = renderNativePart([line]);
    if (singleText.length > maxChars) {
      return failedPlan(
        source.length, protectedLineIndexes.size, blocks.length, protectedText.length, 'too_many_chars',
      );
    }
    partLines = [line];
  }

  if (!finishPart()) {
    return failedPlan(
      source.length, protectedLineIndexes.size, blocks.length, protectedText.length, 'too_many_parts',
    );
  }

  const imageSource = imageChunks.join('');
  const imageableText = imageableChunks.join('');
  const text = nativeParts.join('\n');
  return {
    imageSource,
    imageableText,
    protectedText,
    nativeParts,
    text,
    lineCount: protectedLineIndexes.size,
    blockCount: blocks.length,
    sourceChars: source.length,
    imageableChars: imageableText.length,
    imageChars: imageSource.length,
    preservedChars: protectedText.length,
    nativeWrapperChars: text.length - protectedText.length,
    complete: true,
  };
}

export function buildExactContextPlan(
  source: string,
  limits: ExactContextPlanLimits = {},
): ExactContextPlan {
  return buildExactContextPlanInternal([source], limits);
}

/**
 * Build one exact-context plan from distinct Responses authority documents.
 * The synthetic two-LF separator remains imageable and is never attributed to
 * either document's protected source bytes.
 */
export function buildExactContextPlanFromDocuments(
  documents: readonly string[],
  limits: ExactContextPlanLimits = {},
): ExactContextPlan {
  return buildExactContextPlanInternal(documents, limits);
}

/**
 * Preserve precision-sensitive source associations as native text.
 *
 * The token-only fact sheet prevents OCR typos but cannot answer relational lookups
 * such as "which id belongs to dur_ms=4439?". This manifest keeps the complete source
 * line for every structured association, code-like identifier, and fenced-code line.
 * The active Markdown heading chain is retained as lightweight provenance.
 *
 * The function never truncates. If a bounded manifest cannot be emitted in full it
 * returns `complete: false`, requiring the caller to pass the original request through.
 */
export function buildExactContextManifest(
  source: string,
  limits: ExactContextLimits = {},
): ExactContextManifest {
  if (!source) {
    return { text: '', lineCount: 0, sourceChars: 0, preservedChars: 0, complete: true };
  }

  const maxLines = positiveLimit(limits.maxLines, DEFAULT_MANIFEST_MAX_LINES);
  const maxChars = positiveLimit(limits.maxChars, DEFAULT_MANIFEST_MAX_CHARS);
  const maxLineChars = positiveLimit(limits.maxLineChars, DEFAULT_MANIFEST_MAX_LINE_CHARS);
  const { lines, sharpLines, headingLines } = classifyExactContext(source);

  if (sharpLines.size === 0) {
    return { text: '', lineCount: 0, sourceChars: source.length, preservedChars: 0, complete: true };
  }

  const selected: string[] = [];
  let preservedChars = 0;

  for (let i = 0; i < lines.length; i++) {
    if (sharpLines.has(i) || headingLines.has(i)) {
      const line = lines[i]!.text;
      if (line.length > maxLineChars) {
        return {
          text: '', lineCount: selected.length, sourceChars: source.length,
          preservedChars, complete: false, reason: 'line_too_long',
        };
      }
      const nextChars = preservedChars + line.length + (selected.length > 0 ? 1 : 0);
      if (selected.length + 1 > maxLines) {
        return {
          text: '', lineCount: selected.length, sourceChars: source.length,
          preservedChars, complete: false, reason: 'too_many_lines',
        };
      }
      if (nextChars > maxChars) {
        return {
          text: '', lineCount: selected.length, sourceChars: source.length,
          preservedChars, complete: false, reason: 'too_many_chars',
        };
      }
      selected.push(line);
      preservedChars = nextChars;
    }
  }

  const text = `${OPEN}\n${selected.join('\n')}\n${CLOSE}`;
  return {
    text,
    lineCount: selected.length,
    sourceChars: source.length,
    preservedChars,
    complete: true,
  };
}
