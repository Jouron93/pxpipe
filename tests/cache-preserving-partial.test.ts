/**
 * P1 partial warm gate — preserve tools+system cache prefix; image history only.
 *
 * Cache bleed (plain English): if we re-image the warm system/tools text that
 * Anthropic already cached at 0.1×, the next turn pays ~1.25× cache_create for a
 * new image prefix and the cheap reads disappear — bill goes UP. Partial gate
 * keeps that prefix as text and only collapses post-breakpoint history.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  transformRequest,
  toolsSystemDigest,
  partialWarmGateEnabled,
  HISTORY_CHARS_PER_TOKEN,
} from '../src/core/transform.js';
import { HISTORY_SYNTHETIC_INTRO } from '../src/core/history.js';

afterEach(() => {
  delete process.env.PXPIPE_PARTIAL_WARM_GATE;
  delete process.env.PXPIPE_MIN_COLD_SAVE_FRACTION;
});

const CACHE = { type: 'ephemeral' as const };

function bigToolResult(n: number): string {
  return Array.from({ length: n }, (_, i) => `LINE_${i}_` + 'x'.repeat(80)).join('\n');
}

/** Warm Claude-shaped request: system cache_control + long assistant history.
 *  Message order matches Claude Code: assistant tool_use → user tool_result (closes). */
function warmLargeHistoryBody(opts?: { turns?: number; toolLines?: number }): Uint8Array {
  const turns = opts?.turns ?? 18; // enough for collapseChunk grid (≥50 msgs after keepTail)
  const toolBlock = bigToolResult(opts?.toolLines ?? 200);
  const system = [
    {
      type: 'text',
      text: '# Stable system rules\n' + 'RULE '.repeat(500),
      cache_control: CACHE,
    },
    {
      type: 'text',
      text: '# Environment\nWorking directory: C:/tmp/proj\n',
    },
  ];
  const tools = [
    {
      name: 'Bash',
      description: 'Run a shell command. ' + 'desc '.repeat(200),
      input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
  ];
  const messages: unknown[] = [];
  for (let t = 0; t < turns; t++) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: `user ask ${t}: please run a command` }],
    });
    messages.push({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: `toolu_${t}`,
          name: 'Bash',
          input: { command: `echo ${t}` },
        },
      ],
    });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: `toolu_${t}`,
          content: toolBlock,
        },
      ],
    });
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: `assistant summary ${t}` }],
    });
  }
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: 'live tail question with more context ' + 'y'.repeat(2000) }],
  });
  return new TextEncoder().encode(
    JSON.stringify({
      model: 'claude-fable-5',
      max_tokens: 1024,
      system,
      tools,
      messages,
    }),
  );
}

function coldBody(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      model: 'claude-fable-5',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'cold ' + 'z'.repeat(30_000), cache_control: CACHE }],
      messages: [{ role: 'user', content: 'hello cold' }],
    }),
  );
}

describe('partialWarmGateEnabled', () => {
  it('defaults ON', () => {
    expect(partialWarmGateEnabled()).toBe(true);
  });
  it('kill switch OFF', () => {
    process.env.PXPIPE_PARTIAL_WARM_GATE = '0';
    expect(partialWarmGateEnabled()).toBe(false);
  });
});

describe('P1 partial warm gate', () => {
  it('warm + markers + large history → history images; tools+system digest stable', async () => {
    const body = warmLargeHistoryBody();
    const before = JSON.parse(new TextDecoder().decode(body));
    const digestBefore = await toolsSystemDigest(before);

    const { body: out, info } = await transformRequest(body, {
      // Force history cpt low so large tool dumps look expensive as text
      charsPerToken: HISTORY_CHARS_PER_TOKEN,
      historyAmortizationHorizon: 5,
    });
    const after = JSON.parse(new TextDecoder().decode(out));
    const digestAfter = await toolsSystemDigest(after);

    expect(info.cachePreservingPrefix).toBe(true);
    expect(digestAfter).toBe(digestBefore);
    expect(info.toolsSystemSha8).toBe(digestBefore);
    // System/tools JSON must be byte-identical
    expect(JSON.stringify(after.system)).toBe(JSON.stringify(before.system));
    expect(JSON.stringify(after.tools)).toBe(JSON.stringify(before.tools));

    expect(info.compressed).toBe(true);
    expect(info.reason).toBe('cache_preserving_partial');
    expect(info.collapsedTurns ?? 0).toBeGreaterThan(0);
    expect(info.collapsedImages ?? 0).toBeGreaterThan(0);
    expect(info.passthroughReasons?.cache_preserving).toBeGreaterThan(0);

    // History synthetic banner present; no cache_control on history images
    const histMsg = (after.messages as Array<{ content: unknown[] }>).find((m) => {
      const c0 = m.content?.[0] as { type?: string; text?: string } | undefined;
      return c0?.type === 'text' && c0.text === HISTORY_SYNTHETIC_INTRO;
    });
    expect(histMsg).toBeTruthy();
    for (const b of histMsg!.content) {
      if ((b as { type?: string }).type === 'image') {
        expect((b as { cache_control?: unknown }).cache_control).toBeUndefined();
      }
    }
  });

  it('warm + markers, short history → cache_preserving passthrough (no collapse)', async () => {
    const body = warmLargeHistoryBody({ turns: 1 });
    const { body: out, info } = await transformRequest(body, {});
    expect(info.cachePreservingPrefix).toBe(true);
    expect(info.compressed).toBe(false);
    expect(info.reason).toBe('cache_preserving');
    expect(info.collapsedTurns).toBeUndefined();
    expect(new TextDecoder().decode(out)).toBe(new TextDecoder().decode(body));
  });

  it('kill switch restores full early-return even with large history', async () => {
    process.env.PXPIPE_PARTIAL_WARM_GATE = '0';
    const body = warmLargeHistoryBody();
    const { info } = await transformRequest(body, {
      charsPerToken: HISTORY_CHARS_PER_TOKEN,
      historyAmortizationHorizon: 5,
    });
    expect(info.reason).toBe('cache_preserving');
    expect(info.compressed).toBe(false);
    expect(info.collapsedImages ?? 0).toBe(0);
  });

  it('two consecutive warm collapses keep toolsSystemSha8 identical', async () => {
    const body1 = warmLargeHistoryBody({ turns: 16 });
    const r1 = await transformRequest(body1, {
      charsPerToken: HISTORY_CHARS_PER_TOKEN,
      historyAmortizationHorizon: 5,
    });
    expect(r1.info.compressed).toBe(true);
    const sha1 = r1.info.toolsSystemSha8!;

    // Second turn: grow history by one more closed tool cycle
    const parsed = JSON.parse(new TextDecoder().decode(body1));
    parsed.messages.push(
      {
        role: 'user',
        content: [{ type: 'text', text: 'another ask' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_extra',
            name: 'Bash',
            input: { command: 'echo extra' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_extra',
            content: bigToolResult(200),
          },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'extra summary' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'next live question' }],
      },
    );
    const body2 = new TextEncoder().encode(JSON.stringify(parsed));
    const r2 = await transformRequest(body2, {
      charsPerToken: HISTORY_CHARS_PER_TOKEN,
      historyAmortizationHorizon: 5,
    });
    expect(r2.info.toolsSystemSha8).toBe(sha1);
    expect(r2.info.cachePreservingPrefix).toBe(true);
  });

  it('cold first turn still images (partial gate does not apply)', async () => {
    // Lower cold floor for this unit test so a 30k slab can image under vitest
    process.env.PXPIPE_MIN_COLD_SAVE_FRACTION = '0';
    const { info } = await transformRequest(coldBody(), {});
    // May or may not compress depending on min chars / profitability — must NOT be cache_preserving
    expect(info.reason === 'cache_preserving' || info.reason === 'cache_preserving_partial').toBe(false);
    expect(info.cachePreservingPrefix).toBeUndefined();
  });

  it('projected savings: collapsed history chars exceed passthrough text cost of those chars', async () => {
    const body = warmLargeHistoryBody({ turns: 18 });
    const { info } = await transformRequest(body, {
      charsPerToken: HISTORY_CHARS_PER_TOKEN,
      historyAmortizationHorizon: 8,
    });
    expect(info.compressed).toBe(true);
    const collapsedChars = info.collapsedChars ?? 0;
    const images = info.collapsedImages ?? 0;
    expect(collapsedChars).toBeGreaterThan(50_000);
    expect(images).toBeGreaterThan(0);
    // Rough Anthropic image budget: each page ≤ ~1525 tokens. Even at 2× safety,
    // image tokens << text tokens for huge tool dumps (cpt≈2 ⇒ textTok = chars/2).
    const textTok = collapsedChars / HISTORY_CHARS_PER_TOKEN;
    const imageTokCeiling = images * 2000;
    expect(imageTokCeiling).toBeLessThan(textTok * 0.5);
    // Fulltext-weighted floor vs history-only: (T - 1.25*I)/T should beat ~0.10
    // leftover of pure cache_read-on-everything (the 89.7% warm-CP ceiling gap).
    const histFulltextSave = (textTok - 1.25 * imageTokCeiling) / textTok;
    expect(histFulltextSave).toBeGreaterThan(0.5);
  });
});
