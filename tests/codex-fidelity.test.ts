import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countTokens as countO200kTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { isPxpipeSupportedGptModel } from '../src/core/applicability.js';
import {
  buildExactContextManifest,
  buildExactContextPlan,
} from '../src/core/exact-context.js';
import {
  transformOpenAIChatCompletions,
  transformOpenAIResponses,
} from '../src/core/openai.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function responseInputTextParts(body: Uint8Array): string[] {
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
  return text;
}

function responseInputText(body: Uint8Array): string {
  return responseInputTextParts(body).join('\n');
}

function occurrenceCount(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function mixedAuthorityContext(targetChars: number): string {
  const lines = [
    '# Runtime assignment',
    'trace_id=a1b2c3d4e5f6 lane=x7',
    '',
  ];
  const prose = 'This authority paragraph explains normal behavior using ordinary language without structured identifiers.';
  let chars = lines.join('\n').length;
  while (chars < targetChars) {
    lines.push(prose);
    chars += prose.length + 1;
  }
  return lines.join('\n');
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

  it('still images large non-critical prose while charging pointer and end-marker overhead', async () => {
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
    expect(result.info.preservedTextTokens ?? 0).toBeGreaterThan(0);
    expect(result.info.preservedTextTokens).toBe(result.info.gateEval?.preservedTextTokens);
    expect(responseInputText(result.body)).not.toContain('[Exact native source');
  });

  it('keeps all fifteen dur_ms/id associations as exact native text and charges them to the gate', async () => {
    const associations = Array.from({ length: 15 }, (_, i) => {
      const id = `a1b2c3d4${i.toString(16).padStart(4, '0')}`;
      return `dur_ms=${4439 + i} id=${id}`;
    });
    const instructions = [
      'This is non-critical explanatory context. '.repeat(500),
      '## Exact timing table',
      ...associations,
    ].join('\n');
    const plan = buildExactContextPlan(instructions);
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [{ role: 'user', content: 'Return the id associated with each duration.' }],
    }));

    const result = await transformOpenAIResponses(body, { minCompressChars: 1 });

    expect(result.info.compressed).toBe(true);
    const nativeText = responseInputText(result.body);
    expect(nativeText).toContain('[Exact native source removed from the rendered context.]');
    for (const association of associations) {
      expect(occurrenceCount(nativeText, association)).toBe(1);
      expect(plan.imageSource).not.toContain(association);
      expect(plan.imageableText).not.toContain(association);
      expect(result.info.imageSourceText).not.toContain(association);
    }

    const gate = result.info.gateEval;
    expect(gate).toBeDefined();
    const transformed = JSON.parse(dec.decode(result.body)) as { instructions: string };
    const expectedOverhead = Math.max(
      0,
      countO200kTokens(plan.text) - countO200kTokens(plan.protectedText),
    ) + countO200kTokens(transformed.instructions)
      + countO200kTokens('[End of rendered GPT system/tool context.]');
    expect(result.info.origChars).toBe(instructions.length);
    expect(result.info.compressedChars).toBe(plan.imageableChars);
    expect(result.info.baselineImagedTokens).toBe(countO200kTokens(plan.imageableText));
    expect(gate!.textTokens).toBe(result.info.baselineImagedTokens);
    expect(gate!.preservedTextTokens).toBe(expectedOverhead);
    expect(result.info.preservedTextTokens).toBe(expectedOverhead);
    expect(gate!.profitable).toBe(
      gate!.imageTokens + (gate!.preservedTextTokens ?? 0) < gate!.textTokens,
    );
  });

  it.each([65_000, 106_000])('compresses a representative %i-character mixed authority context', async (targetChars) => {
    const instructions = mixedAuthorityContext(targetChars);
    const protectedLine = 'trace_id=a1b2c3d4e5f6 lane=x7';
    const plan = buildExactContextPlan(instructions);
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [{ role: 'user', content: 'Return the runtime assignment.' }],
    }));

    const result = await transformOpenAIResponses(body, { charsPerToken: 1, minCompressChars: 1 });

    expect(instructions.length).toBeGreaterThanOrEqual(targetChars);
    expect(plan.complete).toBe(true);
    expect(result.info.compressed).toBe(true);
    expect(result.info.imageCount ?? 0).toBeGreaterThan(0);
    expect(result.info.reason).not.toBe('exact_context_too_many_chars');
    expect(occurrenceCount(responseInputText(result.body), protectedLine)).toBe(1);
    expect(plan.imageSource).not.toContain(protectedLine);
    expect(plan.imageableText).not.toContain(protectedLine);
    expect(result.info.imageSourceText).not.toContain(protectedLine);
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

  it('builds a source-exclusive selective plan with active heading and fence provenance', () => {
    const exactLine = 'retry=3 lane=x7 trace_id=a1b2c3d4e5f6';
    const codeLine = 'const route_id = "r7";';
    const source = [
      '# Unrelated section',
      'ordinary introductory prose',
      '# Runtime state',
      'ordinary qualifying prose',
      exactLine,
      'more ordinary prose',
      '```ts',
      codeLine,
      '```',
      'ordinary closing prose',
    ].join('\n');

    const plan = buildExactContextPlan(source);

    expect(plan.complete).toBe(true);
    expect(plan.nativeParts.length).toBeGreaterThan(0);
    expect(plan.text).toBe(plan.nativeParts.join('\n'));
    expect(plan.nativeParts.every((part) => part.length <= 32_768)).toBe(true);
    expect(plan.nativeWrapperChars).toBe(plan.text.length - plan.protectedText.length);
    expect(plan.protectedText).toContain('# Runtime state');
    expect(plan.protectedText).not.toContain('# Unrelated section');
    for (const protectedValue of [exactLine, codeLine, '```ts']) {
      expect(occurrenceCount(plan.protectedText, protectedValue)).toBe(1);
      expect(plan.imageSource).not.toContain(protectedValue);
      expect(plan.imageableText).not.toContain(protectedValue);
    }
    expect(plan.protectedText.split('\n').filter((line) => line === '```')).toHaveLength(1);
    expect(plan.imageSource.split('\n')).not.toContain('```');
    expect(plan.imageableText.split('\n')).not.toContain('```');
    expect(plan.imageSource).toMatch(/\[Exact native block B\d+: source lines /);
  });

  it('splits more than 256 protected lines into bounded native wire parts', async () => {
    const associations = Array.from({ length: 257 }, (_, i) => {
      const id = `b2c3d4e5${i.toString(16).padStart(4, '0')}`;
      return `dur_ms=${10_000 + i} id=${id}`;
    });
    const prose = 'ordinary explanatory context with no structured identifiers '.repeat(900);
    const instructions = [prose, '## Exact timing table', ...associations].join('\n');
    const plan = buildExactContextPlan(instructions);
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [{ role: 'user', content: 'Inspect the table.' }],
    }));

    const result = await transformOpenAIResponses(body, { charsPerToken: 1, minCompressChars: 1 });
    const nativeParts = responseInputTextParts(result.body).filter((part) =>
      part.startsWith('[Exact native source removed from the rendered context.]'));

    expect(plan.complete).toBe(true);
    expect(plan.nativeParts).toHaveLength(2);
    expect(plan.text).toBe(plan.nativeParts.join('\n'));
    expect(plan.nativeParts.every((part) => part.length <= 32_768)).toBe(true);
    expect(result.info.compressed).toBe(true);
    expect(nativeParts).toHaveLength(2);
    expect(nativeParts).toEqual(plan.nativeParts);
    for (const association of associations) {
      expect(occurrenceCount(nativeParts.join('\n'), association)).toBe(1);
      expect(plan.imageSource).not.toContain(association);
      expect(plan.imageableText).not.toContain(association);
      expect(result.info.imageSourceText).not.toContain(association);
    }
  });

  it('rejects a structured slab when preservation cost makes an image-only peer unprofitable', async () => {
    const plain = Array.from(
      { length: 40 },
      () => `ordinary prose row containing descriptive words only ${'detail '.repeat(8)}`,
    ).join('\n');
    const structuredRows = Array.from(
      { length: 40 },
      (_, i) => `retry_${i}=${i} lane=x${i} ${'detail '.repeat(8)}`,
    ).join('\n');
    const structured = `${structuredRows}\n${'ordinary prose remainder '.repeat(12)}`;
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

  it('fails closed when protected source exceeds the explicit 64-part bound', async () => {
    const dense = Array.from(
      { length: 256 * 64 + 1 },
      (_, i) => `relation_${i}=${i}`,
    ).join('\n');
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
    expect(result.info.reason).toBe('exact_context_too_many_parts');
    expect(result.body).toEqual(body);
  });

  it('reports planner wrapper overflow without truncating protected source', () => {
    const plan = buildExactContextPlan('relation=exact-value', { maxChars: 64 });

    expect(plan.complete).toBe(false);
    expect(plan.reason).toBe('too_many_chars');
    expect(plan.nativeParts).toEqual([]);
    expect(plan.text).toBe('');
  });

  it.each([
    ['CRLF', 'ordinary prose\r\ntrace_id=a1b2c3d4e5f6 lane=x7\r\n'],
    ['lone CR', 'ordinary prose\rtrace_id=a1b2c3d4e5f6 lane=x7\r'],
  ])('fails the selective plan closed for %s source instead of normalizing it', (_label, instructions) => {
    const plan = buildExactContextPlan(instructions);

    expect(plan.complete).toBe(false);
    expect(plan.reason).toBe('unsupported_line_endings');
    expect(plan.imageSource).toBe('');
    expect(plan.imageableText).toBe('');
    expect(plan.protectedText).toBe('');
    expect(plan.nativeParts).toEqual([]);
    expect(plan.text).toBe('');
  });

  it.each([
    ['CRLF', 'ordinary prose\r\ntrace_id=a1b2c3d4e5f6 lane=x7\r\n'],
    ['lone CR', 'ordinary prose\rtrace_id=a1b2c3d4e5f6 lane=x7\r'],
  ])('returns byte-identical SOL input for unsupported %s source', async (_label, instructions) => {
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [{ role: 'user', content: 'Inspect the runtime assignment.' }],
    }));

    const result = await transformOpenAIResponses(body, { minCompressChars: 1 });

    expect(result.info.compressed).toBe(false);
    expect(result.info.reason).toBe('exact_context_unsupported_line_endings');
    expect(result.body).toEqual(body);
  });

  it('returns byte-identical input for an overlong protected line', async () => {
    const instructions = `relation=${'x'.repeat(4_100)}`;
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [{ role: 'user', content: 'Inspect the relations.' }],
    }));

    const result = await transformOpenAIResponses(body, { minCompressChars: 1 });

    expect(result.info.compressed).toBe(false);
    expect(result.info.reason).toBe('exact_context_line_too_long');
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
