import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countTokens as countO200kTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { isPxpipeSupportedGptModel } from '../src/core/applicability.js';
import {
  buildExactContextManifest,
  buildExactContextPlan,
  buildExactContextPlanFromDocuments,
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

type TestLineEnding = '\r\n' | '\n' | '\r';

function joinSourceLines(
  lines: readonly string[],
  endings: readonly TestLineEnding[],
): string {
  return lines.map((line, index) =>
    index === lines.length - 1
      ? line
      : line + endings[index % endings.length]!).join('');
}

function nativeLineEndingContext(
  targetChars: number,
  endings: readonly TestLineEnding[],
): {
  instructions: string;
  protectedBlock: string;
  protectedEnding: TestLineEnding;
  protectedLine: string;
} {
  const protectedLine = 'trace_id=a1b2c3d4e5f6 lane=x7';
  const lines = [
    'This native Windows authority preface uses only ordinary descriptive prose.',
    '# Runtime assignment',
    protectedLine,
    '',
  ];
  const prose = 'This authority paragraph explains normal behavior using ordinary language without structured identifiers.';
  let chars = joinSourceLines(lines, endings).length;
  while (chars < targetChars) {
    const separator = endings[(lines.length - 1) % endings.length]!;
    lines.push(prose);
    chars += separator.length + prose.length;
  }

  const headingEnding = endings[1 % endings.length]!;
  const protectedEnding = endings[2 % endings.length]!;
  return {
    instructions: joinSourceLines(lines, endings),
    protectedBlock: `# Runtime assignment${headingEnding}${protectedLine}${protectedEnding}`,
    protectedEnding,
    protectedLine,
  };
}

const nativeLineEndingCases = [
  ['CRLF', ['\r\n']],
  ['lone CR', ['\r']],
  ['mixed line endings', ['\r\n', '\r', '\n']],
] as const satisfies ReadonlyArray<readonly [string, readonly TestLineEnding[]]>;

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
    const sourceLines = [prose, '## Exact timing table', ...associations];
    const sourceEndings = ['\r\n', '\r', '\n'] as const;
    const instructions = joinSourceLines(sourceLines, sourceEndings);
    const protectedBlock = instructions.slice(instructions.indexOf('## Exact timing table'));
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
    expect(enc.encode(plan.protectedText)).toEqual(enc.encode(protectedBlock));
    expect(result.info.compressed).toBe(true);
    expect(nativeParts).toHaveLength(2);
    expect(nativeParts).toEqual(plan.nativeParts);
    for (let index = 1; index < sourceLines.length; index++) {
      const line = sourceLines[index]!;
      const ending = index === sourceLines.length - 1
        ? ''
        : sourceEndings[index % sourceEndings.length]!;
      const exactSpan = line + ending;
      const nativeOccurrences = nativeParts.reduce(
        (count, part) => count + occurrenceCount(part, exactSpan),
        0,
      );
      expect(nativeOccurrences).toBe(1);
    }
    for (const association of associations) {
      expect(plan.imageSource).not.toContain(association);
      expect(plan.imageableText).not.toContain(association);
      expect(result.info.imageSourceText).not.toContain(association);
    }
  });

  it.each([
    ['without a trailing terminator', ''],
    ['with a trailing CRLF terminator', '\r\n'],
  ] as const)(
    'preserves protected first and final blocks %s',
    (_label, trailingEnding) => {
      const firstBlock = '# First assignment\r\ntrace_id=a1b2c3d4e5f6 lane=x7\r';
      const imageableMiddle = 'ordinary explanatory prose between exact blocks\n';
      const finalBlock = `# Final assignment\nfinal_id=z9c8b7a6${trailingEnding}`;
      const source = firstBlock + imageableMiddle + finalBlock;
      const plan = buildExactContextPlan(source);
      const markers = [...plan.imageSource.matchAll(
        /\[Exact native block B\d+: source lines \d+(?:-\d+)?\.\]/g,
      )].map((match) => match[0]);

      expect(plan.complete).toBe(true);
      expect(plan.blockCount).toBe(2);
      expect(enc.encode(plan.protectedText)).toEqual(enc.encode(firstBlock + finalBlock));
      expect(plan.imageableText).toBe(imageableMiddle);
      expect(markers).toHaveLength(2);
      expect(plan.imageSource).toBe(
        `${markers[0]}\r${imageableMiddle}${markers[1]}${trailingEnding}`,
      );
      expect(plan.nativeParts).toHaveLength(1);
      expect(occurrenceCount(plan.nativeParts[0]!, firstBlock)).toBe(1);
      expect(occurrenceCount(plan.nativeParts[0]!, finalBlock)).toBe(1);
    },
  );

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['lone CR', '\r'],
  ] as const)('charges the exact rendered %s terminator against maxChars', (_label, ending) => {
    const source = `relation_id=x7${ending}`;
    const initial = buildExactContextPlan(source);
    const exactChars = initial.nativeParts[0]!.length;

    expect(buildExactContextPlan(source, { maxChars: exactChars }).complete).toBe(true);
    const oneOver = buildExactContextPlan(source, { maxChars: exactChars - 1 });
    expect(oneOver.complete).toBe(false);
    expect(oneOver.reason).toBe('too_many_chars');
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

  it.each(nativeLineEndingCases)(
    'compresses %s authority while preserving native and image-safe source exactly',
    async (_label, endings) => {
      const {
        instructions,
        protectedBlock,
        protectedEnding,
        protectedLine,
      } = nativeLineEndingContext(65_000, endings);
      const plan = buildExactContextPlan(instructions);
      const body = enc.encode(JSON.stringify({
        model: 'gpt-5.6-sol',
        instructions,
        input: [{ role: 'user', content: 'Inspect the runtime assignment.' }],
      }));

      const result = await transformOpenAIResponses(body, {
        charsPerToken: 1,
        minCompressChars: 1,
      });
      const nativeParts = responseInputTextParts(result.body).filter((part) =>
        part.startsWith('[Exact native source removed from the rendered context.]'));
      const marker = plan.imageSource.match(
        /\[Exact native block B\d+: source lines \d+(?:-\d+)?\.\]/,
      )?.[0];

      expect(plan.complete).toBe(true);
      expect(plan.protectedText).toBe(protectedBlock);
      expect(plan.sourceChars).toBe(instructions.length);
      expect(plan.imageableChars).toBe(plan.imageableText.length);
      expect(plan.preservedChars).toBe(plan.protectedText.length);
      expect(plan.imageChars).toBe(plan.imageSource.length);
      expect(plan.sourceChars).toBe(plan.imageableChars + plan.preservedChars);
      expect(occurrenceCount(plan.nativeParts.join('\n'), protectedBlock)).toBe(1);
      expect(plan.imageableText).toBe(instructions.replace(protectedBlock, ''));
      expect(marker).toBeDefined();
      expect(plan.imageSource).toBe(
        instructions.replace(protectedBlock, `${marker!}${protectedEnding}`),
      );
      expect(plan.imageSource).not.toContain(protectedLine);
      expect(result.info.compressed).toBe(true);
      expect(nativeParts).toEqual(plan.nativeParts);
      expect(occurrenceCount(nativeParts.join('\n'), protectedBlock)).toBe(1);
      expect(result.info.imageSourceText).not.toContain(protectedLine);
    },
  );

  it('preserves exact endings across separate instructions and developer authority documents', async () => {
    const instructionNeedle = 'trace_id=crlf-a1b2 lane=sol';
    const developerNeedle = 'route_id=lone-cr-c3d4 mode=native';
    const instructionProtected = `# Instruction assignment\r\n${instructionNeedle}\r\n`;
    const developerProtected = `# Developer assignment\r${developerNeedle}\r`;
    const instructionProse = 'This instruction paragraph contains ordinary descriptive authority text only.';
    const developerProse = 'This developer paragraph contains ordinary descriptive authority text only.';
    const instructionTail = 'Final ordinary instruction paragraph.';
    const developerPrefix = 'Opening ordinary developer paragraph.';
    const instructions = [
      instructionProse,
      '# Instruction assignment',
      instructionNeedle,
      '',
      ...Array.from({ length: 450 }, () => instructionProse),
      instructionTail,
    ].join('\r\n');
    const developer = [
      developerPrefix,
      '# Developer assignment',
      developerNeedle,
      '',
      ...Array.from({ length: 450 }, () => developerProse),
    ].join('\r');
    const combinedAuthority = `${instructions}\n\n${developer}`;
    const plan = buildExactContextPlanFromDocuments([instructions, developer]);
    const userText = 'Return both authority assignments exactly.';
    const body = enc.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      instructions,
      input: [
        { role: 'developer', content: developer },
        { role: 'user', content: userText },
      ],
    }));

    const result = await transformOpenAIResponses(body, {
      charsPerToken: 1,
      minCompressChars: 1,
    });
    const transformed = JSON.parse(dec.decode(result.body)) as {
      instructions?: string;
      input?: Array<{ role?: string; content?: unknown }>;
    };
    const nativeParts = responseInputTextParts(result.body).filter((part) =>
      part.startsWith('[Exact native source removed from the rendered context.]'));
    const developerItem = transformed.input?.find((item) => item.role === 'developer');
    const userItems = transformed.input?.filter((item) => item.role === 'user') ?? [];

    expect(combinedAuthority.length).toBeGreaterThan(65_000);
    expect(occurrenceCount(combinedAuthority, '\n\n')).toBe(1);
    expect(plan.complete).toBe(true);
    expect(enc.encode(plan.protectedText)).toEqual(
      enc.encode(instructionProtected + developerProtected),
    );
    expect(plan.imageableText).toBe(
      combinedAuthority
        .replace(instructionProtected, '')
        .replace(developerProtected, ''),
    );
    expect(plan.imageableText).toContain(`${instructionTail}\n\n${developerPrefix}\r`);
    expect(occurrenceCount(plan.imageableText, '\n\n')).toBe(1);
    expect(plan.sourceChars).toBe(combinedAuthority.length);
    expect(plan.sourceChars).toBe(plan.imageableChars + plan.preservedChars);
    expect(result.info.compressed).toBe(true);
    expect(nativeParts).toEqual(plan.nativeParts);
    expect(nativeParts.reduce(
      (count, part) => count + occurrenceCount(part, instructionProtected),
      0,
    )).toBe(1);
    expect(nativeParts.reduce(
      (count, part) => count + occurrenceCount(part, developerProtected),
      0,
    )).toBe(1);
    expect(result.info.imageSourceText).not.toContain(instructionNeedle);
    expect(result.info.imageSourceText).not.toContain(developerNeedle);
    expect(typeof transformed.instructions).toBe('string');
    expect(developerItem?.content).toBe(transformed.instructions);
    expect(transformed.instructions).not.toContain(instructionNeedle);
    expect(developerItem?.content).not.toContain(developerNeedle);
    expect(userItems.at(-1)?.content).toBe(userText);
  });

  it.each([
    ['unterminated protected instructions', ''],
    ['lone-CR protected instructions', '\r'],
  ] as const)(
    'preserves a protected authority boundary with %s',
    async (_label, trailingEnding) => {
      const instructionNeedle = 'trace_id=boundary-a1b2 lane=sol';
      const instructions = `# Instruction assignment\r\n${instructionNeedle}${trailingEnding}`;
      const developer = 'This developer authority contains ordinary descriptive prose only. '.repeat(1_100);
      const plan = buildExactContextPlanFromDocuments([instructions, developer]);
      const body = enc.encode(JSON.stringify({
        model: 'gpt-5.6-sol',
        instructions,
        input: [
          { role: 'developer', content: developer },
          { role: 'user', content: 'Return the protected assignment exactly.' },
        ],
      }));

      const result = await transformOpenAIResponses(body, {
        charsPerToken: 1,
        minCompressChars: 1,
      });
      const nativeParts = responseInputTextParts(result.body).filter((part) =>
        part.startsWith('[Exact native source removed from the rendered context.]'));

      expect(plan.complete).toBe(true);
      expect(enc.encode(plan.protectedText)).toEqual(enc.encode(instructions));
      expect(plan.imageableText).toBe(`\n\n${developer}`);
      expect(plan.imageableText.slice(0, 2)).toBe('\n\n');
      expect(plan.sourceChars).toBe(instructions.length + 2 + developer.length);
      expect(plan.sourceChars).toBe(plan.imageableChars + plan.preservedChars);
      for (const protectedValue of ['# Instruction assignment', instructionNeedle]) {
        expect(plan.imageSource).not.toContain(protectedValue);
        expect(plan.imageableText).not.toContain(protectedValue);
        expect(result.info.imageSourceText).not.toContain(protectedValue);
      }
      expect(nativeParts).toEqual(plan.nativeParts);
      expect(nativeParts.reduce(
        (count, part) => count + occurrenceCount(part, instructions),
        0,
      )).toBe(1);
      expect(result.info.compressed).toBe(true);
      expect(result.info.imageSourceText).not.toContain('\r');
      expect(result.info.droppedCodepointsTop?.['U+000D']).toBeUndefined();
    },
  );

  it.each(nativeLineEndingCases)(
    'fails closed byte-identically for an impossible overlong %s plan',
    async (_label, endings) => {
      const instructions = joinSourceLines([
        'ordinary descriptive prose',
        `relation=${'x'.repeat(4_100)}`,
        'ordinary closing prose',
      ], endings);
      const plan = buildExactContextPlan(instructions);
      const body = enc.encode(JSON.stringify({
        model: 'gpt-5.6-sol',
        instructions,
        input: [{ role: 'user', content: 'Inspect the relations.' }],
      }));

      const result = await transformOpenAIResponses(body, { minCompressChars: 1 });

      expect(plan.complete).toBe(false);
      expect(plan.reason).toBe('line_too_long');
      expect(result.info.compressed).toBe(false);
      expect(result.info.reason).toBe('exact_context_line_too_long');
      expect(result.body).toEqual(body);
    },
  );

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
