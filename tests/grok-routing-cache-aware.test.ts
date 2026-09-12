/**
 * Grok CLI routing, auth-lane isolation, bootstrap plane, and cache-aware
 * profitability gate V2.
 *
 * The signed-in CLI's native host is cli-chat-proxy.grok.com. Pointing
 * GROK_CLI_CHAT_PROXY_BASE_URL at pxpipe used to dump /v1/settings (etc.) onto
 * OPENAI_UPSTREAM / api.x.ai, which 404. Warp now intercepts only inference;
 * the proxy routes leftover bootstrap hits to cli-chat-proxy.grok.com.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';
import {
  evalCacheAwareProfitability,
  GROK_CACHE_READ_RATE,
} from '../src/core/openai-savings.js';
import {
  transformOpenAIChatCompletions,
  transformOpenAIResponses,
} from '../src/core/openai.js';
import { matchRoute, rewriteUrl } from '../src/warp/route.js';
import { childEnvironment, defaultRoutes } from '../src/warp/index.js';

let ambientPxpipeModels: string | undefined;
beforeAll(() => {
  ambientPxpipeModels = process.env.PXPIPE_MODELS;
  process.env.PXPIPE_MODELS = 'grok-4.5';
});
afterAll(() => {
  if (ambientPxpipeModels === undefined) delete process.env.PXPIPE_MODELS;
  else process.env.PXPIPE_MODELS = ambientPxpipeModels;
});

const ANTHROPIC = 'https://anthropic.test';
const OPENAI = 'https://openai.test';
const XAI = 'https://xai.test';
const CLI = 'https://cli-chat-proxy.grok.com';

function fakeJwt(iss: string): string {
  const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ iss, sub: 'u1' }))}.sig`;
}
const CHATGPT_JWT = fakeJwt('https://auth.openai.com');
const XAI_JWT = fakeJwt('https://auth.x.ai');
const GROK_UA = 'grok-cli/1.0';

interface Seen {
  url: URL;
  headers: Headers;
  method: string;
  bodyText: string;
}

function captureUpstream(body = '{"ok":true}', status = 200, contentType = 'application/json') {
  const real = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(String(input), init);
    const bodyText = await r.clone().text();
    seen.push({ url: new URL(r.url), headers: new Headers(r.headers), method: r.method, bodyText });
    return new Response(body, { status, headers: { 'content-type': contentType } });
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

function mainRequest(seen: Seen[]): Seen {
  const hit = seen.find((s) => !s.url.pathname.includes('count_tokens'));
  if (!hit) throw new Error('upstream never received the main request');
  return hit;
}

type Proxy = ReturnType<typeof createProxy>;
async function send(
  proxy: Proxy,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; method?: string } = {},
): Promise<Response> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const res = await proxy(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
  await res.text();
  await new Promise((r) => setTimeout(r, 20));
  return res;
}

const BASE = {
  transform: { compress: false },
  upstream: ANTHROPIC,
  openAIUpstream: OPENAI,
  xaiUpstream: XAI,
  cliChatProxyUpstream: CLI,
};

const CHAT_BODY = (model: string) => ({ model, messages: [{ role: 'user', content: 'hi' }] });

describe('Grok signed-in chat route preserves original cli-chat-proxy host', () => {
  it('forwards grok chat to cli-chat-proxy when Host is the Grok CLI proxy', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: {
          host: 'cli-chat-proxy.grok.com',
          authorization: `Bearer ${XAI_JWT}`,
          'user-agent': GROK_UA,
        },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('cli-chat-proxy.grok.com');
      expect(m.url.pathname).toBe('/v1/chat/completions');
    } finally {
      restore();
    }
  });

  it('forwards API-key grok chat without that Host to xaiUpstream, not OpenAI', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: { authorization: 'Bearer xai-console-key' },
      });
      expect(mainRequest(seen).url.host).toBe('xai.test');
    } finally {
      restore();
    }
  });
});

describe('Grok OAuth bearer and xAI headers are preserved to Grok, never replaced', () => {
  it('keeps SuperGrok Authorization on the Grok chat lane', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, openAIApiKey: 'sk-proj-PROXYKEY' });
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: {
          authorization: `Bearer ${XAI_JWT}`,
          'user-agent': GROK_UA,
        },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('xai.test');
      expect(m.headers.get('authorization')).toBe(`Bearer ${XAI_JWT}`);
    } finally {
      restore();
    }
  });

  it('preserves X-XAI-Token-Auth', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, openAIApiKey: 'sk-proj-PROXYKEY' });
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: {
          authorization: `Bearer ${XAI_JWT}`,
          'x-xai-token-auth': 'session-token-shape',
          'user-agent': GROK_UA,
        },
      });
      expect(mainRequest(seen).headers.get('x-xai-token-auth')).toBe('session-token-shape');
    } finally {
      restore();
    }
  });

  it('preserves x-grok-model-override', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: {
          authorization: `Bearer ${XAI_JWT}`,
          'x-grok-model-override': 'grok-4.5',
          'user-agent': GROK_UA,
        },
      });
      expect(mainRequest(seen).headers.get('x-grok-model-override')).toBe('grok-4.5');
    } finally {
      restore();
    }
  });

  it('preserves caller x-grok-conv-id instead of overwriting it', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: {
          authorization: `Bearer ${XAI_JWT}`,
          'x-grok-conv-id': 'conv-stable-1',
          'user-agent': GROK_UA,
        },
      });
      expect(mainRequest(seen).headers.get('x-grok-conv-id')).toBe('conv-stable-1');
    } finally {
      restore();
    }
  });

  it('does not let a configured OpenAI key replace Grok OAuth', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, openAIApiKey: 'sk-proj-PROXYKEY' });
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: {
          host: 'cli-chat-proxy.grok.com',
          authorization: `Bearer ${XAI_JWT}`,
          'user-agent': GROK_UA,
        },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('cli-chat-proxy.grok.com');
      expect(m.headers.get('authorization')).toBe(`Bearer ${XAI_JWT}`);
      expect(m.headers.get('authorization')).not.toContain('sk-proj-PROXYKEY');
    } finally {
      restore();
    }
  });
});

describe('Grok bootstrap endpoints hit cli-chat-proxy.grok.com, not Codex/OpenAI', () => {
  it.each(['/v1/settings', '/v1/subagents/bundle', '/v1/feedback/config', '/v1/bundle/archive'])(
    'routes %s to cli-chat-proxy with Grok auth intact',
    async (path) => {
      const { seen, restore } = captureUpstream('{"ok":true}');
      try {
        const proxy = createProxy({
          ...BASE,
          openAIUpstream: 'https://chatgpt.com/backend-api/codex',
          openAIApiKey: undefined,
        });
        const res = await send(proxy, path, {
          headers: {
            authorization: `Bearer ${XAI_JWT}`,
            'x-xai-token-auth': 'session-token-shape',
            'user-agent': GROK_UA,
          },
        });
        expect(res.status).toBe(200);
        const m = mainRequest(seen);
        expect(m.url.origin).toBe('https://cli-chat-proxy.grok.com');
        expect(m.url.pathname).toBe(path);
        expect(m.headers.get('authorization')).toBe(`Bearer ${XAI_JWT}`);
        expect(m.headers.get('x-xai-token-auth')).toBe('session-token-shape');
      } finally {
        restore();
      }
    },
  );
});

describe('P0 credential isolation across providers', () => {
  it('never sends a Codex OAuth bearer to Grok', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: { authorization: `Bearer ${CHATGPT_JWT}` },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('xai.test');
      expect(m.headers.get('authorization')).toBeNull();
    } finally {
      restore();
    }
  });

  it('never sends Grok OAuth to OpenAI', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, openAIApiKey: 'sk-proj-PROXYKEY' });
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('gpt-5.6-sol'),
        headers: { authorization: `Bearer ${XAI_JWT}` },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('openai.test');
      expect(m.headers.get('authorization')).toBe('Bearer sk-proj-PROXYKEY');
      expect(m.headers.get('authorization')).not.toContain(XAI_JWT);
    } finally {
      restore();
    }
  });

  it('never sends an Anthropic credential to OpenAI or Grok', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: { authorization: 'Bearer sk-ant-api03-REAL', 'x-api-key': 'sk-ant-api03-REAL' },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('xai.test');
      expect(m.headers.get('authorization')).toBeNull();
      expect(m.headers.get('x-api-key')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('Warp original-host identity', () => {
  it('maps cli-chat-proxy inference onto pxpipe and does not map bootstrap', () => {
    const routes = defaultRoutes(47821);
    const chat = matchRoute(routes, 'cli-chat-proxy.grok.com:443', '/v1/chat/completions');
    expect(chat).not.toBeNull();
    expect(rewriteUrl(chat!, '/v1/chat/completions')).toBe('http://127.0.0.1:47821/v1/chat/completions');
    expect(matchRoute(routes, 'cli-chat-proxy.grok.com:443', '/v1/settings')).toBeNull();
  });

  it('strips GROK_CLI_CHAT_PROXY_BASE_URL so the child keeps the first-party host', () => {
    const env = childEnvironment(
      { GROK_CLI_CHAT_PROXY_BASE_URL: 'http://127.0.0.1:47821/v1', PATH: 'x' },
      'http://127.0.0.1:5',
      { certPath: '/ca.pem', bundlePath: '/bundle.pem' },
    );
    expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).toBeUndefined();
  });
});

describe('Streaming Grok request succeeds', () => {
  it('returns 200 for a streamed grok chat completion', async () => {
    const sse = 'data: {"id":"c1","choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    const { seen, restore } = captureUpstream(sse, 200, 'text/event-stream');
    try {
      const proxy = createProxy(BASE);
      const res = await send(proxy, '/v1/chat/completions', {
        body: { model: 'grok-4.5', stream: true, messages: [{ role: 'user', content: 'hi' }] },
        headers: { authorization: `Bearer ${XAI_JWT}`, 'user-agent': GROK_UA },
      });
      expect(res.status).toBe(200);
      expect(mainRequest(seen).url.host).toBe('xai.test');
    } finally {
      restore();
    }
  });
});

describe('Profitability Gate V2 — warm cached Grok text is never imaged', () => {
  it('keeps text when a 0.25x cached prefix is cheaper than vision tokens', () => {
    const r = evalCacheAwareProfitability({
      model: 'grok-4.5',
      textTokens: 10_000,
      imageTokens: 4_000,
      providerCacheLikely: true,
    });
    expect(r.cacheWeight).toBe(GROK_CACHE_READ_RATE);
    expect(r.profitable).toBe(false);
    expect(r.reason).toBe('warm_cached_text_cheaper');
    expect(r.textCost).toBe(10_000 * GROK_CACHE_READ_RATE);
  });

  it('images a cold bulky eligible prefix when vision is cheaper than full-price text', () => {
    const r = evalCacheAwareProfitability({
      model: 'grok-4.5',
      textTokens: 20_000,
      imageTokens: 4_000,
      providerCacheLikely: false,
    });
    expect(r.cacheWeight).toBe(1);
    expect(r.profitable).toBe(true);
    expect(r.reason).toBe('image_cheaper');
  });

  it('passes through when warm savings are marginal', () => {
    const r = evalCacheAwareProfitability({
      model: 'grok-4.5',
      textTokens: 1_000,
      imageTokens: 240,
      providerCacheLikely: true,
    });
    expect(r.profitable).toBe(false);
  });
});

describe('Exact/verbatim blocks remain text; pass-through and kill switch', () => {
  it('does not image a grok request when providerCacheLikely is set', async () => {
    const bulky = 'system context with stable prefix '.repeat(2_000);
    const { body, info } = await transformOpenAIChatCompletions(
      new TextEncoder().encode(
        JSON.stringify({
          model: 'grok-4.5',
          prompt_cache_key: 'warm-1',
          messages: [
            { role: 'system', content: bulky },
            { role: 'user', content: 'sha256=deadbeefcafebabe0123456789abcdef continue' },
          ],
        }),
      ),
      { compress: true, providerCacheLikely: true, minCompressChars: 100 },
    );
    const parsed = JSON.parse(new TextDecoder().decode(body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const system = parsed.messages.find((m) => m.role === 'system');
    expect(info.compressed).toBe(false);
    expect(info.reason ?? '').toMatch(/not_profitable|unsupported_model|below_min/);
    expect(JSON.stringify(system?.content ?? '')).not.toContain('image_url');
  });

  it('leaves unsupported models uncompressed at the proxy', async () => {
    const bulky = 'x'.repeat(5000);
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({
        ...BASE,
        transform: { compress: true, minCompressChars: 10 },
      });
      await send(proxy, '/v1/chat/completions', {
        body: {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'system', content: bulky }, { role: 'user', content: 'hi' }],
        },
        headers: { authorization: 'Bearer sk-proj-client' },
      });
      const req = mainRequest(seen);
      expect(req.url.host).toBe('openai.test');
      expect(req.bodyText).toContain(bulky);
      expect(req.bodyText).not.toContain('image_url');
    } finally {
      restore();
    }
  });

  it('kill switch compress=false remains a no-op', async () => {
    const { info } = await transformOpenAIChatCompletions(
      new TextEncoder().encode(JSON.stringify(CHAT_BODY('grok-4.5'))),
      { compress: false },
    );
    expect(info.reason).toBe('compress=false');
    expect(info.compressed).toBe(false);
  });
});

describe('Codex subscription OpenAI_UPSTREAM cannot steal Grok bootstrap', () => {
  it('still returns 200 from cli-chat-proxy when Codex upstream is configured', async () => {
    let event: ProxyEvent | undefined;
    const { seen, restore } = captureUpstream('{"settings":{}}');
    try {
      const proxy = createProxy({
        transform: { compress: false },
        upstream: ANTHROPIC,
        openAIUpstream: 'https://chatgpt.com/backend-api/codex',
        xaiUpstream: XAI,
        onRequest: (e) => {
          event = e;
        },
      });
      const res = await send(proxy, '/v1/settings', {
        headers: { authorization: `Bearer ${XAI_JWT}`, 'user-agent': GROK_UA },
      });
      expect(res.status).toBe(200);
      expect(mainRequest(seen).url.host).toBe('cli-chat-proxy.grok.com');
      expect(event?.status).toBe(200);
    } finally {
      restore();
    }
  });
});

describe('Responses transform preserves caller cache identity and gates unprofitable tool requests', () => {
  it('bypasses Responses requests when baseline text savings do not justify image and overhead cost', async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({
        model: 'gpt-4o',
        instructions: 'Brief instruction context that does not justify rendering.',
        tools: [
          {
            type: 'function',
            function: {
              name: 'query_data',
              description: 'Fetch data from backend database with filtering options.',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
              },
            },
          },
        ],
        input: [{ role: 'user', content: 'hello' }],
      }),
    );
    const result = await transformOpenAIResponses(body, {
      compress: true,
      minCompressChars: 10,
    });
    expect(result.info.compressed).toBe(false);
    expect(result.info.reason).toMatch(/not_profitable|below_min_chars/);
  });

  it('does not inject synthetic prompt_cache_key when caller omits it', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.5'),
        headers: {
          authorization: `Bearer ${XAI_JWT}`,
          'user-agent': GROK_UA,
        },
      });
      const m = mainRequest(seen);
      const parsed = JSON.parse(m.bodyText);
      expect(parsed.prompt_cache_key).toBeUndefined();
      expect(m.bodyText).not.toContain('pxpipe-grok');
    } finally {
      restore();
    }
  });

  it('preserves caller-supplied prompt_cache_key on Grok requests', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: {
          ...CHAT_BODY('grok-4.5'),
          prompt_cache_key: 'custom-session-key-42',
        },
        headers: {
          authorization: `Bearer ${XAI_JWT}`,
          'user-agent': GROK_UA,
        },
      });
      const m = mainRequest(seen);
      const parsed = JSON.parse(m.bodyText);
      expect(parsed.prompt_cache_key).toBe('custom-session-key-42');
    } finally {
      restore();
    }
  });
});

