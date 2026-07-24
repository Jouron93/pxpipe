import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPxpipeSupportedGptModel } from '../src/core/applicability.js';
import { buildExactContextManifest } from '../src/core/exact-context.js';
import {
  transformOpenAIChatCompletions,
  transformOpenAIResponses,
} from '../src/core/openai.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function responseInputText(body: Uint8Array): string {
  const parsed = JSON.parse(dec.decode(body)) as {
    input?: Array<{ content?: unknown }>;
  };
  const text: string[] = [];
  for (const item of parsed.input ?? []) {
    if (typeof item.content === 'string') {
      text.push(item.content);
      continue;
    }
    if (!Array.isArray(item.content)) continue;
    for (const part of item.content as Array<{ type?: string; text?: unknown }>) {
      if (part.type === 'input_text' && typeof part.text === 'string') text.push(part.text);
    }
  }
  return text.join('\n');
}

function chatText(body: Uint8Array): string {
  const parsed = JSON.parse(dec.decode(body)) as {
    messages?: Array<{ content?: unknown }>;
  };
  const text: string[] = [];
  for (const message of parsed.messages ?? []) {
    if (typeof message.content === 'string') {
      text.push(message.content);
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as Array<{ type?: string; text?: unknown }>) {
      if (part.type === 'text' && typeof part.text === 'string') text.push(part.text);
    }
  }
  return text.join('\n');
}

describe('safe Codex static-context compression', () => {
  let ambientModels: string | undefined;

  beforeEach(() => {
    ambientModels = process.env.PXPIPE_MODELS;
    delete process.env.PXPIPE_MODELS;
  });

  afterEach(() => {
    if (ambientModels === undefined) delete process.env.PXPIPE_MODELS;
    else process.env.PXPIPE_MODELS = ambientModels;
  });

  it('keeps Sol disabled unless explicitly opted in', () => {
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(false);
    process.env.PXPIPE_MODELS = 'gpt-5.6-sol';
    expect(isPxpipeSupportedGptModel('gpt-5.6-sol')).toBe(true);
  });

  it('still images large non-critical prose without adding an exact-context manifest', async () => {
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions: 'ordinary prose without precision-sensitive tokens or code fences. '.repeat(500),
      input: [{ role: 'user', content: 'Summarize the instructions.' }],
    }));

    const result = await transformOpenAIResponses(body, {
      minCompressChars: 1,
    });

    expect(result.info.compressed).toBe(true);
    expect(result.info.imageCount ?? 0).toBeGreaterThan(0);
    expect(result.info.preservedTextTokens ?? 0).toBe(0);
    expect(responseInputText(result.body)).not.toContain('[Exact source lines');
  });

  it('keeps all fifteen dur_ms/id associations as exact native text and charges them to the gate', async () => {
    const associations = Array.from({ length: 15 }, (_, i) => {
      const id = `a1b2c3d4${i.toString(16).padStart(4, '0')}`;
      return `dur_ms=${4439 + i} id=${id}`;
    });
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions: [
        'This is non-critical explanatory context. '.repeat(500),
        '## Exact timing table',
        ...associations,
      ].join('\n'),
      input: [{ role: 'user', content: 'Return the id associated with each duration.' }],
    }));

    const result = await transformOpenAIResponses(body, { minCompressChars: 1 });

    expect(result.info.compressed).toBe(true);
    const nativeText = responseInputText(result.body);
    expect(nativeText).toContain('[Exact source lines from the rendered context above.]');
    for (const association of associations) expect(nativeText).toContain(association);

    const gate = result.info.gateEval;
    expect(gate).toBeDefined();
    expect(gate!.preservedTextTokens).toBeGreaterThan(0);
    expect(result.info.preservedTextTokens).toBe(gate!.preservedTextTokens);
    expect(gate!.profitable).toBe(
      gate!.imageTokens + (gate!.preservedTextTokens ?? 0) < gate!.textTokens,
    );
  });

  it('preserves small structured associations with only their active heading provenance', () => {
    const exactLines = [
      'retry=3 lane=x7',
      'worker x7 owns trace_id',
      '{"retry":3,"lane":"x7"}',
      '| attempt | id |',
      '| 3 | x7 |',
    ];
    const manifest = buildExactContextManifest([
      '# Unrelated section',
      'ordinary prose only',
      '# Runtime state',
      ...exactLines,
    ].join('\n'));

    expect(manifest.complete).toBe(true);
    expect(manifest.text).toContain('# Runtime state');
    expect(manifest.text).not.toContain('# Unrelated section');
    for (const line of exactLines) expect(manifest.text).toContain(line);
  });

  it('preserves tilde and length-aware backtick fences without closing on a shorter run', () => {
    const manifest = buildExactContextManifest([
      '# Fences',
      '````ts',
      'const relation = "retry=3 lane=x7";',
      '```',
      'still inside the four-backtick fence',
      '````',
      '~~~json',
      '{"retry":3}',
      '~~~',
    ].join('\n'));

    expect(manifest.complete).toBe(true);
    expect(manifest.text).toContain('still inside the four-backtick fence');
    expect(manifest.text).toContain('~~~json');
    expect(manifest.text).toContain('{"retry":3}');
  });

  it('rejects invalid backtick info strings and ignores four-space-indented fake headings', () => {
    const invalidFence = buildExactContextManifest([
      '# Heading without sharp content',
      '```lang`bad',
      'ordinary prose only',
    ].join('\n'));
    expect(invalidFence.text).toBe('');

    const indentedHeading = buildExactContextManifest([
      '# Real heading',
      '    # fake heading in indented code',
      'retry=3 lane=x7',
    ].join('\n'));
    expect(indentedHeading.text).toContain('# Real heading');
    expect(indentedHeading.text).not.toContain('# fake heading in indented code');
  });

  it('accepts exact manifest boundaries and reports each one-over failure reason', () => {
    expect(buildExactContextManifest('a=1\r\nb=2', { maxLines: 2 }).complete).toBe(true);
    expect(buildExactContextManifest('a=1\r\nb=2\rc=3', { maxLines: 2 }).reason).toBe('too_many_lines');
    expect(buildExactContextManifest('a=1\nb=2', { maxChars: 7 }).complete).toBe(true);
    expect(buildExactContextManifest('a=1\nb=2', { maxChars: 6 }).reason).toBe('too_many_chars');
    expect(buildExactContextManifest('a=12', { maxLineChars: 4 }).complete).toBe(true);
    expect(buildExactContextManifest('a=123', { maxLineChars: 4 }).reason).toBe('line_too_long');
  });

  it('rejects a structured slab when preservation cost makes an image-only peer unprofitable', async () => {
    const plain = Array.from(
      { length: 40 },
      () => `ordinary prose row containing descriptive words only ${'detail '.repeat(8)}`,
    ).join('\n');
    const structured = Array.from(
      { length: 40 },
      (_, i) => `retry_${i}=${i} lane=x${i} ${'detail '.repeat(8)}`,
    ).join('\n');
    const request = (instructions: string): Uint8Array => enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [{ role: 'user', content: 'Summarize.' }],
    }));

    const imageOnly = await transformOpenAIResponses(request(plain), {
      minCompressChars: 1,
      charsPerToken: 2.5,
    });
    const withExactText = await transformOpenAIResponses(request(structured), {
      minCompressChars: 1,
      charsPerToken: 2.5,
    });

    expect(imageOnly.info.compressed).toBe(true);
    expect(withExactText.info.compressed).toBe(false);
    expect(withExactText.info.reason).toMatch(/^not_profitable/);
    expect(withExactText.info.gateEval?.preservedTextTokens ?? 0).toBeGreaterThan(0);
    expect(withExactText.body).toEqual(request(structured));
  });

  it('fails closed and returns the original bytes when exact context exceeds its bounded manifest', async () => {
    const dense = Array.from({ length: 257 }, (_, i) => {
      const id = `b2c3d4e5${i.toString(16).padStart(4, '0')}`;
      return `dur_ms=${10_000 + i} id=${id}`;
    }).join('\n');
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions: dense,
      input: [{ role: 'user', content: 'Inspect the table.' }],
    }));

    const result = await transformOpenAIResponses(body, {
      charsPerToken: 1,
      minCompressChars: 1,
    });

    expect(result.info.compressed).toBe(false);
    expect(result.info.reason).toBe('exact_context_too_many_lines');
    expect(result.body).toEqual(body);
  });

  it.each([
    {
      reason: 'exact_context_line_too_long',
      instructions: `relation=${'x'.repeat(4_100)}`,
    },
    {
      reason: 'exact_context_too_many_chars',
      instructions: Array.from(
        { length: 100 },
        (_, i) => `relation_${i}=${'x'.repeat(340)}`,
      ).join('\n'),
    },
  ])('returns byte-identical input for $reason', async ({ reason, instructions }) => {
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [{ role: 'user', content: 'Inspect the relations.' }],
    }));

    const result = await transformOpenAIResponses(body, { minCompressChars: 1 });

    expect(result.info.compressed).toBe(false);
    expect(result.info.reason).toBe(reason);
    expect(result.body).toEqual(body);
  });

  it('leaves the existing Chat/Fable fact-sheet path unchanged', async () => {
    const exactId = 'c3d4e5f60001';
    const body = enc.encode(JSON.stringify({
      model: 'claude-fable-5',
      messages: [
        {
          role: 'system',
          content: `${'Detailed Fable context. '.repeat(700)}\nreference id=${exactId}`,
        },
        { role: 'user', content: 'Use the reference.' },
      ],
    }));

    const result = await transformOpenAIChatCompletions(body, {
      charsPerToken: 1,
      minCompressChars: 1,
    });

    expect(result.info.compressed).toBe(true);
    const nativeText = chatText(result.body);
    expect(nativeText).toContain('[Exact identifiers from the rendered context above');
    expect(nativeText).toContain(exactId);
    expect(nativeText).not.toContain('[Exact source lines from the rendered context above.]');
  });
});
