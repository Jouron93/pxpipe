/**
 * Opus 5.5 renders at JetBrains Mono 10px on high-res-tier pages (see
 * CLAUDE_OPUS55_PROFILE). Pin the geometry, the id matching, and that every page
 * stays inside the high-res tier so Anthropic never downscales it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_SPACED_PROFILE,
  CLAUDE_OPUS55_PROFILE,
  isOpus55Claude,
  resolveClaudeProfile,
} from '../src/core/claude-model-profiles.js';
import { transformRequest } from '../src/core/transform.js';
import { resetSessionState } from '../src/core/session-state.js';

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

describe('Opus 5.5 profile', () => {
  beforeEach(() => resetSessionState());

  it('matches Opus 5.5 ids only', () => {
    for (const id of ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'anthropic/claude-opus-5-5', 'claude-opus-5-5-20260901']) {
      expect(isOpus55Claude(id)).toBe(true);
    }
    for (const id of ['claude-opus-5', 'claude-opus-5-50', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-opus-4-8']) {
      expect(isOpus55Claude(id)).toBe(false);
    }
  });

  it('routes Opus 5.5 to jb10 high-res geometry and leaves siblings on jb14', () => {
    const p = resolveClaudeProfile('claude-opus-5-5');
    expect(p).toBe(CLAUDE_OPUS55_PROFILE);
    expect(p.style.font).toBe('jetbrains-mono-10');
    expect(p.historyStyle?.font).toBe('jetbrains-mono-10');
    expect(p.stripCols).toBe(428);
    expect(p.maxHeightPx).toBe(1260);
    expect(p.cacheReadRate).toBe(0.1); // Anthropic cache read = 0.10x input (evidence/provider-cache-matrix.md)
    expect(resolveClaudeProfile('claude-opus-5')).toBe(CLAUDE_SPACED_PROFILE);
    expect(resolveClaudeProfile('claude-sonnet-5')).toBe(CLAUDE_SPACED_PROFILE);
  });

  it('renders pages inside the high-res tier (no server-side downscale)', async () => {
    const lines = Array.from({ length: 900 }, (_, i) => `    value_${i} = compute_level(price * ${i}, qty=${i % 17}, side="BUY")  # step ${i}`);
    const { info } = await transformRequest(
      enc({
        model: 'claude-opus-5-5',
        system: [{ type: 'text', text: 'SLAB\n' + 'The system prompt line with words. '.repeat(2000) }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'go' }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: lines.join('\n') }] },
        ],
      }),
      { model: 'claude-opus-5-5' },
    );
    const dims = (info as { imageDims?: Array<{ width: number; height: number }> }).imageDims ?? [];
    expect(dims.length).toBeGreaterThan(0);
    for (const d of dims) {
      expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(2576);
      expect(Math.ceil(d.width / 28) * Math.ceil(d.height / 28)).toBeLessThanOrEqual(4784);
    }
    expect(Math.max(...dims.map((d) => d.width))).toBeGreaterThan(1568);
  });
});
