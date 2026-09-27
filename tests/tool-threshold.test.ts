/**
 * The tool_result size threshold depends on which tool produced the result.
 *
 * File reads keep the conservative `minToolResultChars` floor (default 6,000): their
 * text is what an Edit must quote byte-exactly. Every other tool (Bash, Grep, WebFetch,
 * MCP) is imaged from `minNonReadToolResultChars` (default 2,500), where count_tokens
 * measured a 26.7% saving on claude-opus-5-5 (2026-09-26). A result whose tool_use
 * cannot be found is treated as a file read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { transformRequest } from '../src/core/transform.js';
import { resetSessionState } from '../src/core/session-state.js';

const enc = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));
// Realistic, varied lines so the profitability gate judges real text, not a run of one char.
const body3k = Array.from({ length: 70 }, (_, i) => `drwxr-xr-x  2 user staff  4096 Sep 26 12:${String(i % 60).padStart(2, '0')} dir_${i}_module`).join('\n');

function request(toolName: string | null) {
  const messages: unknown[] = [{ role: 'user', content: [{ type: 'text', text: 'go' }] }];
  if (toolName) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: toolName, input: {} }] });
  }
  messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: body3k }] });
  return enc({
    model: 'claude-opus-5-5',
    system: [{ type: 'text', text: 'SLAB\n' + 'The system prompt line with words. '.repeat(2000) }],
    messages,
  });
}

describe('tool-aware tool_result threshold', () => {
  beforeEach(() => resetSessionState());

  it('fixture sits between the two thresholds', () => {
    expect(body3k.length).toBeGreaterThan(2500);
    expect(body3k.length).toBeLessThan(6000);
  });

  it('images a mid-size Bash result', async () => {
    const { info } = await transformRequest(request('Bash'), { model: 'claude-opus-5-5' });
    expect(info.toolResultImgs ?? 0).toBeGreaterThan(0);
  });

  it('keeps a same-size Read result as text', async () => {
    const { info } = await transformRequest(request('Read'), { model: 'claude-opus-5-5' });
    expect(info.toolResultImgs ?? 0).toBe(0);
  });

  it('keeps a result with unknown provenance as text', async () => {
    const { info } = await transformRequest(request(null), { model: 'claude-opus-5-5' });
    expect(info.toolResultImgs ?? 0).toBe(0);
  });

  it('never lets the non-read threshold exceed the read threshold', async () => {
    const { info } = await transformRequest(request('Bash'), {
      model: 'claude-opus-5-5',
      minToolResultChars: 2000,
      minNonReadToolResultChars: 50_000,
    });
    expect(info.toolResultImgs ?? 0).toBeGreaterThan(0);
  });
});
