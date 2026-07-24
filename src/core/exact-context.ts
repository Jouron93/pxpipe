import { extractFactSheetTokens } from './factsheet.js';

const DEFAULT_MAX_LINES = 256;
const DEFAULT_MAX_CHARS = 32_768;
const DEFAULT_MAX_LINE_CHARS = 4_096;

export interface ExactContextLimits {
  readonly maxLines?: number;
  readonly maxChars?: number;
  readonly maxLineChars?: number;
}

export interface ExactContextManifest {
  /** Native text placed next to the rendered slab. Empty when no sharp lines exist. */
  readonly text: string;
  readonly lineCount: number;
  readonly sourceChars: number;
  readonly preservedChars: number;
  /** False means the caller must fail closed and leave the request byte-identical. */
  readonly complete: boolean;
  readonly reason?: 'too_many_lines' | 'too_many_chars' | 'line_too_long';
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

  const maxLines = positiveLimit(limits.maxLines, DEFAULT_MAX_LINES);
  const maxChars = positiveLimit(limits.maxChars, DEFAULT_MAX_CHARS);
  const maxLineChars = positiveLimit(limits.maxLineChars, DEFAULT_MAX_LINE_CHARS);
  const lines = source.split(/\r\n|\n|\r/);
  const sharpLines = new Set<number>();
  const headingLines = new Set<number>();
  const activeHeadings = new Map<number, number>();
  let openFence: MarkdownFence | undefined;

  const preserveWithHeadings = (lineIndex: number): void => {
    sharpLines.add(lineIndex);
    for (const headingIndex of activeHeadings.values()) headingLines.add(headingIndex);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
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

  if (sharpLines.size === 0) {
    return { text: '', lineCount: 0, sourceChars: source.length, preservedChars: 0, complete: true };
  }

  const selected: string[] = [];
  let preservedChars = 0;

  for (let i = 0; i < lines.length; i++) {
    if (sharpLines.has(i) || headingLines.has(i)) {
      const line = lines[i]!;
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
