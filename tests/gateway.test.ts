/**
 * Cloudflare AI Gateway provider mode. All URLs and tokens here are fake —
 * the suite never touches the network (global fetch is stubbed).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createProxy, parseGatewayHeaders, resolveUpstreams, type ProxyEvent } from '../src/core/proxy.js';
import { toTrackEvent } from '../src/core/tracker.js';

const FAKE_BASE = 'https://gateway.example.test/v1/acct_fake/gw_fake';
const FAKE_TOKEN = 'Bearer fake-gateway-token';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('resolveUpstreams', () => {
  it('defaults to direct upstreams without a provider', () => {
    expect(resolveUpstreams({})).toEqual({
      anthropic: 'https://api.anthropic.com',
      openai: 'https://api.openai.com',
      stripOpenAIV1: false,
    });
  });

  it('derives both family routes from one gateway base', () => {
    expect(resolveUpstreams({ provider: 'cloudflare-ai-gateway', gatewayBaseUrl: FAKE_BASE + '/' }))
      .toEqual({
        anthropic: `${FAKE_BASE}/anthropic`,
        openai: `${FAKE_BASE}/openai`,
        stripOpenAIV1: true,
      });
  });

  it('requires gatewayBaseUrl in provider mode', () => {
    expect(() => resolveUpstreams({ provider: 'cloudflare-ai-gateway' })).toThrow(
      /gatewayBaseUrl/,
    );
  });

  it('accepts only the exact credential-free ChatGPT Codex OAuth upstream', () => {
    expect(resolveUpstreams({ openAIUpstream: 'https://chatgpt.com/backend-api/codex/' }))
      .toEqual({
        anthropic: 'https://api.anthropic.com',
        openai: 'https://chatgpt.com/backend-api/codex',
        stripOpenAIV1: true,
      });
    expect(() => resolveUpstreams({
      openAIUpstream: 'https://chatgpt.com/backend-api/codex',
      openAIApiKey: 'sentinel',
    })).toThrow(/cannot be combined/i);
    expect(() => resolveUpstreams({
      openAIUpstream: 'https://chatgpt.com/backend-api/codex',
      gatewayHeaders: { authorization: 'sentinel' },
    })).toThrow(/cannot override/i);
    expect(() => resolveUpstreams({
      openAIUpstream: 'https://chatgpt.com/backend-api/codex',
      gatewayHeaders: { 'chatgpt-account-id': 'sentinel' },
    })).toThrow(/cannot override/i);
    expect(resolveUpstreams({ openAIUpstream: 'https://chatgpt.com/backend-api/codex-extra' }).stripOpenAIV1)
      .toBe(false);
  });
});

describe('parseGatewayHeaders', () => {
  it('parses JSON object form', () => {
    expect(parseGatewayHeaders('{"cf-aig-authorization": "Bearer x", "x-extra": "1"}')).toEqual({
      'cf-aig-authorization': 'Bearer x',
      'x-extra': '1',
    });
  });

  it('parses k=v;k2=v2 form (values may contain =)', () => {
    expect(parseGatewayHeaders('cf-aig-authorization=Bearer a=b; x-extra=1')).toEqual({
      'cf-aig-authorization': 'Bearer a=b',
      'x-extra': '1',
    });
  });

  it('returns empty for unset', () => {
    expect(parseGatewayHeaders(undefined)).toEqual({});
    expect(parseGatewayHeaders('')).toEqual({});
  });
});

function stubFetch(capture: { url?: string; headers?: Headers }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/count_tokens')) {
      return new Response(JSON.stringify({ input_tokens: 1 }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    capture.url = url;
    capture.headers = new Headers(init?.headers);
    return new Response(
      JSON.stringify({ type: 'message', content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

describe('gateway end-to-end routing (stubbed fetch)', () => {
  const proxy = () =>
    createProxy({
      provider: 'cloudflare-ai-gateway',
      gatewayBaseUrl: FAKE_BASE,
      gatewayHeaders: { 'cf-aig-authorization': FAKE_TOKEN },
    });

  it('routes Anthropic /v1/messages to {base}/anthropic/v1/messages with injected headers', async () => {
    const cap: { url?: string; headers?: Headers } = {};
    stubFetch(cap);
    const res = await proxy()(
      new Request('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'fake-anthropic-key' },
        body: JSON.stringify({ model: 'claude-fable-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(cap.url).toBe(`${FAKE_BASE}/anthropic/v1/messages`);
    expect(cap.headers?.get('cf-aig-authorization')).toBe(FAKE_TOKEN);
    expect(cap.headers?.get('x-api-key')).toBe('fake-anthropic-key');
  });

  it('routes ChatGPT Codex without persisting OAuth secrets', async () => {
    const cap: { url?: string; headers?: Headers } = {};
    stubFetch(cap);
    let resolveEvent!: (event: ProxyEvent) => void;
    const eventPromise = new Promise<ProxyEvent>((resolve) => { resolveEvent = resolve; });
    const response = await createProxy({
      openAIUpstream: 'https://chatgpt.com/backend-api/codex',
      onRequest: resolveEvent,
    })(
      new Request('http://127.0.0.1/v1/responses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer codex-test-secret',
          'chatgpt-account-id': 'acct-test-secret',
        },
        body: JSON.stringify({ model: 'gpt-5.6-sol', input: 'hi' }),
      }),
    );
    await response.text();
    const event = await eventPromise;

    expect(cap.url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(cap.headers?.get('authorization')).toBe('Bearer codex-test-secret');
    expect(cap.headers?.get('chatgpt-account-id')).toBe('acct-test-secret');
    expect(event.billingLane).toBe('codex_subscription');
    expect(event.billingLaneSource).toBe('chatgpt_codex_origin');
    const persisted = JSON.stringify(toTrackEvent(event));
    expect(persisted).not.toContain('codex-test-secret');
    expect(persisted).not.toContain('acct-test-secret');
  });

  const configuredLaneConflicts: Array<{
    name: string;
    config: NonNullable<Parameters<typeof createProxy>[0]>;
    request: () => Request;
    expectedLane: ProxyEvent['billingLane'];
  }> = [
    {
      name: 'AGY origin',
      config: { upstream: 'http://127.0.0.1:4017', billingLanes: { anthropic: 'api_key' } },
      request: () => new Request('http://127.0.0.1/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      }),
      expectedLane: 'api_key',
    },
    {
      name: 'local origin',
      config: { upstream: 'http://127.0.0.1:1234', billingLanes: { anthropic: 'api_key' } },
      request: () => new Request('http://127.0.0.1/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'local-model', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      }),
      expectedLane: 'api_key',
    },
    {
      name: 'ChatGPT Codex origin',
      config: {
        openAIUpstream: 'https://chatgpt.com/backend-api/codex',
        billingLanes: { openai: 'local' },
      },
      request: () => new Request('http://127.0.0.1/v1/responses', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.6-sol', input: 'hi' }),
      }),
      expectedLane: 'local',
    },
    {
      name: 'configured OpenAI API key',
      config: {
        openAIApiKey: 'sk-observed-secret',
        billingLanes: { openai: 'codex_subscription' },
      },
      request: () => new Request('http://127.0.0.1/v1/responses', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.6-sol', input: 'hi' }),
      }),
      expectedLane: 'codex_subscription',
    },
    {
      name: 'Anthropic API key',
      config: {
        apiKey: 'sk-observed-secret',
        billingLanes: { anthropic: 'claude_max_subscription' },
      },
      request: () => new Request('http://127.0.0.1/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'sk-request-secret' },
        body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      }),
      expectedLane: 'claude_max_subscription',
    },
    {
      name: 'Anthropic OAuth marker',
      config: { billingLanes: { anthropic: 'api_key' } },
      request: () => new Request('http://127.0.0.1/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer oauth-observed-secret',
          'anthropic-beta': 'oauth-2025-04-20',
        },
        body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      }),
      expectedLane: 'api_key',
    },
    {
      name: 'NVIDIA Build catalog route',
      config: { billingLanes: { anthropic: 'nvidia_build_free' } },
      request: () => new Request('http://127.0.0.1/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'nvidia/meta/llama-3.3-70b-instruct', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      }),
      expectedLane: 'nvidia_build_free',
    },
  ];

  it.each(configuredLaneConflicts)(
    'treats configured billing lanes as authoritative over $name inference',
    async ({ config, request, expectedLane }) => {
      stubFetch({});
      let resolveEvent!: (event: ProxyEvent) => void;
      const eventPromise = new Promise<ProxyEvent>((resolve) => { resolveEvent = resolve; });
      const response = await createProxy({ ...config, onRequest: resolveEvent })(request());
      await response.text();
      const event = await eventPromise;
      expect(event.billingLane).toBe(expectedLane);
      expect(event.billingLaneSource).toBe('configured_route');
    },
  );

  it('routes OpenAI /v1/chat/completions to {base}/openai/chat/completions', async () => {
    const cap: { url?: string; headers?: Headers } = {};
    stubFetch(cap);
    await proxy()(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer fake-openai-key' },
        body: JSON.stringify({ model: 'gpt-fake', messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );
    expect(cap.url).toBe(`${FAKE_BASE}/openai/chat/completions`);
    expect(cap.headers?.get('cf-aig-authorization')).toBe(FAKE_TOKEN);
    expect(cap.headers?.get('authorization')).toBe('Bearer fake-openai-key');
  });

  it('routes OpenAI /v1/responses to {base}/openai/responses', async () => {
    const cap: { url?: string; headers?: Headers } = {};
    stubFetch(cap);
    await proxy()(
      new Request('http://localhost/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer fake-openai-key' },
        body: JSON.stringify({ model: 'gpt-fake', input: 'hi' }),
      }),
    );
    expect(cap.url).toBe(`${FAKE_BASE}/openai/responses`);
  });

  it('passes unrecognized Anthropic-family paths through untouched', async () => {
    const cap: { url?: string; headers?: Headers } = {};
    stubFetch(cap);
    await proxy()(
      new Request('http://localhost/v1/some/unknown?x=1', {
        method: 'GET',
        headers: { 'x-api-key': 'fake-anthropic-key' },
      }),
    );
    expect(cap.url).toBe(`${FAKE_BASE}/anthropic/v1/some/unknown?x=1`);
    expect(cap.headers?.get('cf-aig-authorization')).toBe(FAKE_TOKEN);
  });

  it('preserves streaming responses byte-for-byte', async () => {
    const sse = 'event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/count_tokens')) {
        return new Response(JSON.stringify({ input_tokens: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(sse));
            c.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;
    const res = await proxy()(
      new Request('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'fake-anthropic-key' },
        body: JSON.stringify({ model: 'claude-fable-5', max_tokens: 1, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );
    expect(await res.text()).toBe(sse);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });
});

describe('provider-prefixed passthrough routing', () => {
  it('forwards non-Anthropic provider prefixes to the generic upstream', async () => {
    const cap: { url?: string; headers?: Headers } = {};
    stubFetch(cap);
    await createProxy({
      upstream: 'http://ocproxy.test',
      openAIUpstream: 'http://openai.test',
    })(
      new Request('http://localhost/google-ai-studio/v1beta/models/gemini-2.5:generateContent?alt=sse', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer local-token' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      }),
    );

    expect(cap.url).toBe('http://ocproxy.test/google-ai-studio/v1beta/models/gemini-2.5:generateContent?alt=sse');
    expect(cap.headers?.get('authorization')).toBe('Bearer local-token');
  });

  it('does not inject the Anthropic API key into non-Anthropic provider prefixes', async () => {
    const cap: { url?: string; headers?: Headers } = {};
    stubFetch(cap);
    await createProxy({
      upstream: 'http://ocproxy.test',
      apiKey: 'sk-anthropic-test',
    })(
      new Request('http://localhost/compat/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer local-token' },
        body: JSON.stringify({ model: '@cf/test/model', messages: [{ role: 'user', content: 'hi' }] }),
      }),
    );

    expect(cap.url).toBe('http://ocproxy.test/compat/v1/chat/completions');
    expect(cap.headers?.get('authorization')).toBe('Bearer local-token');
    expect(cap.headers?.get('x-api-key')).toBeNull();
  });
});
