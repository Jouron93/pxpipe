/**
 * Provider Prompt/Context Caching Alignment & Fixture Test Suite (Phase 3).
 *
 * Implements the 5 concrete test specifications defined in:
 * `C:\Projects\pxpipe\evidence\provider-cache-matrix.md § 4`
 *
 * Tests:
 * 1. Anthropic cache_control marker relocation onto terminal image block,
 *    ensuring `system` parameter remains text-only and strips `scope: "global"`.
 * 2. OpenAI prefix byte-stability: verifying that across consecutive conversation turns
 *    within a chunk (`collapseChunk: 20` and `collapseChunk: 50`), the generated history
 *    images are 100% byte-identical (identical SHA-256 and base64).
 * 3. Forward-compatible header (`x-grok-conv-id`) and request body field
 *    (`prompt_cache_key`, `custom_metadata_tag`) pass-through via createProxy.
 * 4. Response usage accounting: verifying Anthropic, OpenAI, DeepSeek, and Gemini
 *    cache metrics are accurately parsed without double-counting or fabricating values.
 * 5. Symmetric burn gate: verifying mode-switch anti-flapping logic prevents flipping
 *    from warm text to image mode unless savings strictly exceed the one-time write penalty.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { transformRequest, isCompressionProfitable } from '../src/core/transform.js';
import { countCacheControlMarkers } from '../src/core/measurement.js';
import { planGptCollapse } from '../src/core/openai-history.js';
import { createProxy } from '../src/core/proxy.js';
import { extractUsageTokens } from '../src/core/usage-accounting.js';

// ===========================================================================
// Test 1: Anthropic Breakpoint Relocation & Marker Conservation
// ===========================================================================
describe('Phase 3 Fixture 1: Anthropic Breakpoint Relocation & Marker Conservation', () => {
  it('relocates single marker to terminal image block and preserves exact count', async () => {
    const rawRequest = {
      model: 'claude-3-5-sonnet',
      system: [
        {
          type: 'text',
          text: '# System Slab\n' + 'Instruction rule. '.repeat(5000),
          cache_control: { type: 'ephemeral', scope: 'global', ttl: '1h' },
        },
      ],
      messages: [
        { role: 'user', content: 'Turn 1: hello' },
        { role: 'assistant', content: 'Turn 1: response' },
      ],
    };

    const inBytes = new TextEncoder().encode(JSON.stringify(rawRequest));
    const inMarkerCount = countCacheControlMarkers(inBytes);
    expect(inMarkerCount).toBe(1);

    const { body: outBytes } = await transformRequest(inBytes);
    const outMarkerCount = countCacheControlMarkers(outBytes);

    // Invariant 1: Total markers conserved (never increased, never dropped)
    expect(outMarkerCount).toBe(1);

    const outJson = JSON.parse(new TextDecoder().decode(outBytes));

    // Invariant 2: System prompt retains no images and no cache markers
    expect(Array.isArray(outJson.system)).toBe(true);
    for (const block of outJson.system) {
      expect(block.type).not.toBe('image');
      expect(block.cache_control).toBeUndefined();
    }

    // Invariant 3: Marker is located on the terminal image block in messages[0]
    const firstMsg = outJson.messages[0];
    expect(firstMsg.role).toBe('user');
    const imageBlocks = firstMsg.content.filter((b: any) => b.type === 'image');
    expect(imageBlocks.length).toBeGreaterThan(0);

    const terminalImage = imageBlocks[imageBlocks.length - 1];
    expect(terminalImage.cache_control).toBeDefined();
    expect(terminalImage.cache_control.type).toBe('ephemeral');
    expect(terminalImage.cache_control.ttl).toBe('1h');
    // Scope 'global' must be stripped to prevent Anthropic 400 invalid_request_error
    expect(terminalImage.cache_control.scope).toBeUndefined();

    // Intermediate image blocks must NOT have cache_control
    for (let i = 0; i < imageBlocks.length - 1; i++) {
      expect(imageBlocks[i].cache_control).toBeUndefined();
    }
  });
});

// ===========================================================================
// Test 2: OpenAI Automatic Prefix Byte-Stability Across Consecutive Turns
// ===========================================================================
describe('Phase 3 Fixture 2: OpenAI Prefix Byte-Stability Across Turns', () => {
  const buildTurns = (count: number, turnChars = 1200) =>
    Array.from({ length: count }, (_, i) => ({
      text: `--- ${i % 2 === 0 ? 'user' : 'assistant'} ---\nLog entry ${i}: ` + 'x'.repeat(turnChars),
      openIds: [],
      closeIds: [],
      opaque: false,
    }));

  it('guarantees identical image SHA-256 across turns within a collapseChunk: 20 chunk', async () => {
    // Turn 35 and Turn 36 in a conversation where collapseChunk = 20, keepTail = 4
    // Both turns snap to quantized cutoff = floor((len - 4)/20) * 20 = 20
    const turnsA = buildTurns(35);
    const turnsB = buildTurns(36);

    const planA = await planGptCollapse(turnsA, 0, () => true, { collapseChunk: 20, keepTail: 4 });
    const planB = await planGptCollapse(turnsB, 0, () => true, { collapseChunk: 20, keepTail: 4 });

    expect(planA.images.length).toBeGreaterThan(0);
    expect(planB.images.length).toBe(planA.images.length);

    // Assert that every image's PNG binary hash is 100% byte-identical
    for (let i = 0; i < planA.images.length; i++) {
      const shaA = crypto.createHash('sha256').update(planA.images[i].png).digest('hex');
      const shaB = crypto.createHash('sha256').update(planB.images[i].png).digest('hex');
      expect(shaA).toBe(shaB);
    }

    // Invariant: No OpenAI request contains cache_control
    for (const img of planA.images) {
      expect((img as any).cache_control).toBeUndefined();
    }
  });

  it('guarantees 100% byte-identical images across consecutive turns within collapseChunk: 50', async () => {
    // Turn 55, Turn 70, and Turn 103 in a conversation where collapseChunk = 50, keepTail = 4
    // All turns snap to quantized cutoff = floor((len - 4)/50) * 50 = 50
    const turns55 = buildTurns(55);
    const turns56 = buildTurns(56);
    const turns70 = buildTurns(70);

    const plan55 = await planGptCollapse(turns55, 0, () => true, { collapseChunk: 50, keepTail: 4 });
    const plan56 = await planGptCollapse(turns56, 0, () => true, { collapseChunk: 50, keepTail: 4 });
    const plan70 = await planGptCollapse(turns70, 0, () => true, { collapseChunk: 50, keepTail: 4 });

    expect(plan55.images.length).toBeGreaterThan(0);
    expect(plan56.images.length).toBe(plan55.images.length);
    expect(plan70.images.length).toBe(plan55.images.length);

    for (let i = 0; i < plan55.images.length; i++) {
      const sha55 = crypto.createHash('sha256').update(plan55.images[i].png).digest('hex');
      const sha56 = crypto.createHash('sha256').update(plan56.images[i].png).digest('hex');
      const sha70 = crypto.createHash('sha256').update(plan70.images[i].png).digest('hex');

      expect(sha56).toBe(sha55);
      expect(sha70).toBe(sha55);

      // Verify base64 representation is also 100% byte-identical
      const b64_55 = Buffer.from(plan55.images[i].png).toString('base64');
      const b64_56 = Buffer.from(plan56.images[i].png).toString('base64');
      expect(b64_56).toBe(b64_55);
    }
  });
});

// ===========================================================================
// Test 3: Request Header and Forward-Compatible Field Pass-Through
// ===========================================================================
describe('Phase 3 Fixture 3: Header and Field Preservation', () => {
  it('preserves x-grok-conv-id header and prompt_cache_key field', async () => {
    let capturedRequest: Request | null = null;
    const fakeFetch = async (input: Request | string | URL, init?: RequestInit) => {
      capturedRequest = input instanceof Request ? input : new Request(String(input), init);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          choices: [{ message: { role: 'assistant', content: 'ack' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as typeof fetch;

    try {
      const proxy = createProxy({
        upstream: 'https://api.x.ai',
        openAIUpstream: 'https://api.x.ai',
        apiKey: 'xai-test-key',
        onRequest: () => {},
      });

      const outboundPayload = {
        model: 'grok-4',
        messages: [{ role: 'user', content: 'test message' }],
        prompt_cache_key: 'sess_project_quantum_99',
        custom_metadata_tag: 'retained_passthrough',
      };

      const req = new Request('http://127.0.0.1:47821/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer xai-test-key',
          'x-grok-conv-id': 'cluster-shard-us-east-4a',
        },
        body: JSON.stringify(outboundPayload),
      });

      const res = await proxy(req);
      expect(res.status).toBe(200);

      expect(capturedRequest).not.toBeNull();
      const forwardedReq = capturedRequest as unknown as Request;

      // Invariant 1: Critical routing header preserved
      expect(forwardedReq.headers.get('x-grok-conv-id')).toBe('cluster-shard-us-east-4a');

      // Invariant 2: Body fields preserved
      const forwardedBody = await forwardedReq.json();
      expect(forwardedBody.prompt_cache_key).toBe('sess_project_quantum_99');
      expect(forwardedBody.custom_metadata_tag).toBe('retained_passthrough');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// ===========================================================================
// Test 4: Response Usage Accounting & Zero Double-Counting
// ===========================================================================
describe('Phase 3 Fixture 4: Response Usage Accounting', () => {
  it('correctly maps Anthropic usage without double-counting', () => {
    const rawAnthropicResponse = {
      usage: {
        input_tokens: 1500,
        cache_creation_input_tokens: 4000,
        cache_read_input_tokens: 25000,
        output_tokens: 350,
      },
    };

    const parsed = extractUsageTokens('anthropic', rawAnthropicResponse);
    expect(parsed.uncachedInput).toBe(1500);
    expect(parsed.cacheCreate).toBe(4000);
    expect(parsed.cacheRead).toBe(25000);
    expect(parsed.output).toBe(350);
    // Effective total prompt tokens processed = uncached + create + read
    expect(parsed.totalPromptTokens).toBe(30500);
  });

  it('correctly maps OpenAI prompt_tokens_details.cached_tokens', () => {
    const rawOpenAiResponse = {
      usage: {
        prompt_tokens: 12000,
        prompt_tokens_details: {
          cached_tokens: 10240,
        },
        completion_tokens: 180,
        total_tokens: 12180,
      },
    };

    const parsed = extractUsageTokens('openai', rawOpenAiResponse);
    expect(parsed.totalPromptTokens).toBe(12000);
    expect(parsed.cacheRead).toBe(10240);
    expect(parsed.uncachedInput).toBe(1760); // 12000 - 10240
    expect(parsed.cacheCreate).toBe(0); // OpenAI has 0 surcharge for writes
  });

  it('correctly maps DeepSeek prompt_cache_hit_tokens', () => {
    const rawDeepSeekResponse = {
      usage: {
        prompt_tokens: 8192,
        prompt_cache_hit_tokens: 8000,
        prompt_cache_miss_tokens: 192,
        completion_tokens: 64,
        total_tokens: 8256,
      },
    };

    const parsed = extractUsageTokens('deepseek', rawDeepSeekResponse);
    expect(parsed.cacheRead).toBe(8000);
    expect(parsed.uncachedInput).toBe(192);
    expect(parsed.totalPromptTokens).toBe(8192);
  });

  it('correctly maps Gemini cachedContentTokenCount without double counting', () => {
    const rawGeminiResponse = {
      usageMetadata: {
        promptTokenCount: 10000,
        cachedContentTokenCount: 8000,
        candidatesTokenCount: 250,
        totalTokenCount: 10250,
      },
    };

    const parsed = extractUsageTokens('gemini', rawGeminiResponse);
    expect(parsed.totalPromptTokens).toBe(10000);
    expect(parsed.cacheRead).toBe(8000);
    expect(parsed.uncachedInput).toBe(2000); // 10000 - 8000
    expect(parsed.cacheCreate).toBe(0);
    expect(parsed.output).toBe(250);
  });

  it('returns undefined and does not fabricate metrics when usage is missing', () => {
    const emptyResponse = { choices: [{ message: { content: 'hello' } }] };
    const parsed = extractUsageTokens('openai', emptyResponse);
    expect(parsed.haveUsage).toBe(false);
    expect(parsed.cacheRead).toBeUndefined();
    expect(parsed.uncachedInput).toBeUndefined();
  });
});

// ===========================================================================
// Test 5: Mode-Switching Symmetric Cache Burn Gate
// ===========================================================================
describe('Phase 3 Fixture 5: Symmetric Cache Burn Gate', () => {
  it('blocks image conversion when warm text cache burn penalty exceeds savings', () => {
    // 20,000 warm text tokens in cache
    // Flipping to image would burn: 20000 * (1.25 - 0.10) = 23,000 token penalty
    const priorWarmTextTokens = 20000;
    const textTokens = 25000;
    const imageTokens = 12000; // Raw compression saves 13,000 tokens

    // Without burn penalty: 12000 < 25000 (profitable)
    // With burn penalty: imageTokens (12000) + burn (23000) = 35000 > textTokens (25000) -> NOT profitable!
    const profitable = isCompressionProfitable({
      textTokens,
      imageTokens,
      priorWarmTokens: priorWarmTextTokens,
      priorWarmImageTokens: 0,
    });

    expect(profitable).toBe(false);
  });

  it('permits image conversion when savings easily exceed the burn penalty', () => {
    const priorWarmTextTokens = 5000; // Burn = 5000 * 1.15 = 5750
    const textTokens = 80000;
    const imageTokens = 15000; // Raw save = 65,000 tokens

    // 15000 + 5750 = 20750 < 80000 -> Highly profitable
    const profitable = isCompressionProfitable({
      textTokens,
      imageTokens,
      priorWarmTokens: priorWarmTextTokens,
      priorWarmImageTokens: 0,
    });

    expect(profitable).toBe(true);
  });
});
