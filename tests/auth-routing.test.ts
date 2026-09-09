import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';

// Pins the credential-routing fixes from the 2026-09-05 Gemini 3.8 census (G1-G5) and the
// Grok 4.6 critique. Each test drives createProxy against an in-process fake upstream and
// asserts two things the old code got wrong: WHICH host the request reached, and WHICH
// credential (if any) travelled with it. The rule throughout is fail closed — a bearer that
// is not provably the destination provider's credential is stripped, never forwarded.

let ambientPxpipeModels: string | undefined;
beforeAll(() => {
  ambientPxpipeModels = process.env.PXPIPE_MODELS;
  process.env.PXPIPE_MODELS = 'off'; // no imaging: these are routing tests
});
afterAll(() => {
  if (ambientPxpipeModels === undefined) delete process.env.PXPIPE_MODELS;
  else process.env.PXPIPE_MODELS = ambientPxpipeModels;
});

const ANTHROPIC = 'https://anthropic.test';
const OPENAI = 'https://openai.test';
const XAI = 'https://xai.test';

function fakeJwt(iss: string): string {
  const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ iss, sub: 'u1' }))}.sig`;
}
const CHATGPT_JWT = fakeJwt('https://auth.openai.com');
const XAI_JWT = fakeJwt('https://auth.x.ai');

interface Seen {
  url: URL;
  headers: Headers;
}

/** Patch global fetch; record every upstream request; answer with a small JSON 200. */
function captureUpstream(body = '{"ok":true}') {
  const real = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(String(input), init);
    seen.push({ url: new URL(r.url), headers: new Headers(r.headers) });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return {
    seen,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

/** The forwarded request itself — not a count_tokens baseline probe. */
function mainRequest(seen: Seen[]): Seen {
  const hit = seen.find((s) => !s.url.pathname.includes('count_tokens'));
  if (!hit) throw new Error('upstream never received the main request');
  return hit;
}

type Proxy = ReturnType<typeof createProxy>;
async function send(
  proxy: Proxy,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const res = await proxy(
    new Request(`http://127.0.0.1${path}`, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
  await res.text();
  await new Promise((r) => setTimeout(r, 20)); // onRequest fires behind a void promise
  return res;
}

const BASE = { transform: {}, upstream: ANTHROPIC, openAIUpstream: OPENAI, xaiUpstream: XAI };
const CHAT_BODY = (model: string) => ({ model, messages: [{ role: 'user', content: 'hi' }] });

describe('G1: claude-* on an OpenAI path reroutes to Anthropic under Anthropic auth rules', () => {
  it('strips a ChatGPT JWT instead of sending it to Anthropic, and never injects the OpenAI key', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, openAIApiKey: 'sk-proj-PROXYKEY' });
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('claude-opus-5'),
        headers: { authorization: `Bearer ${CHATGPT_JWT}` },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('anthropic.test');
      expect(m.headers.get('authorization')).toBeNull();
      expect(m.headers.get('x-api-key')).toBeNull();
    } finally {
      restore();
    }
  });

  it.each([
    ['an Anthropic API key', 'Bearer sk-ant-api03-key'],
    ['a Claude OAuth token', 'Bearer sk-ant-oat01-session'],
  ])('forwards %s to Anthropic unchanged', async (_label, auth) => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, openAIApiKey: 'sk-proj-PROXYKEY' });
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('claude-opus-5'),
        headers: { authorization: auth },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('anthropic.test');
      expect(m.headers.get('authorization')).toBe(auth);
    } finally {
      restore();
    }
  });
});

describe('G2: the grok lane never forwards a non-xAI credential to api.x.ai', () => {
  it('strips the ChatGPT JWT of a Codex client that asked for grok-*', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.6'),
        headers: {
          authorization: `Bearer ${CHATGPT_JWT}`,
          'user-agent': 'codex_cli_rs/0.153.3 (Windows 11)',
        },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('xai.test');
      expect(m.headers.get('authorization')).toBeNull();
    } finally {
      restore();
    }
  });

  it.each([
    ['an xAI console key', 'Bearer xai-console-key'],
    ['a SuperGrok JWT (auth.x.ai)', `Bearer ${XAI_JWT}`],
  ])('forwards %s', async (_label, auth) => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.6'),
        headers: { authorization: auth },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('xai.test');
      expect(m.headers.get('authorization')).toBe(auth);
    } finally {
      restore();
    }
  });

  it('after stripping a foreign bearer, fills the configured xaiApiKey if there is one', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, xaiApiKey: 'xai-configured' });
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.6'),
        headers: { authorization: `Bearer ${CHATGPT_JWT}` },
      });
      expect(mainRequest(seen).headers.get('authorization')).toBe('Bearer xai-configured');
    } finally {
      restore();
    }
  });
});

describe('G3: a Claude Max OAuth session is never re-billed as API usage', () => {
  it('does not inject the configured key over the OAuth bearer and bills claude_max_subscription', async () => {
    const { seen, restore } = captureUpstream();
    let event: ProxyEvent | undefined;
    try {
      const proxy = createProxy({ ...BASE, apiKey: 'sk-ant-api03-PROXY', onRequest: (e) => { event = e; } });
      await send(proxy, '/v1/messages', {
        body: { model: 'claude-opus-5', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] },
        headers: { authorization: 'Bearer sk-ant-oat01-SESSION', 'anthropic-beta': 'oauth-2025-04-20' },
      });
      const m = mainRequest(seen);
      expect(m.headers.get('x-api-key')).toBeNull();
      expect(m.headers.get('authorization')).toBe('Bearer sk-ant-oat01-SESSION');
      expect(event?.billingLane).toBe('claude_max_subscription');
      expect(event?.billingLaneSource).toBe('anthropic_oauth_marker');
    } finally {
      restore();
    }
  });

  it('still injects the configured key for a keyless request and bills it as api_key', async () => {
    const { seen, restore } = captureUpstream();
    let event: ProxyEvent | undefined;
    try {
      const proxy = createProxy({ ...BASE, apiKey: 'sk-ant-api03-PROXY', onRequest: (e) => { event = e; } });
      await send(proxy, '/v1/messages', {
        body: { model: 'claude-opus-5', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(mainRequest(seen).headers.get('x-api-key')).toBe('sk-ant-api03-PROXY');
      expect(event?.billingLane).toBe('api_key');
    } finally {
      restore();
    }
  });
});

describe('G4: a trailing slash does not change the destination', () => {
  it('routes /v1/chat/completions/ to the OpenAI upstream with the OpenAI bearer, not to Anthropic', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions/', {
        body: CHAT_BODY('gpt-5.6-sol'),
        headers: { authorization: 'Bearer sk-proj-client' },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('openai.test');
      expect(m.headers.get('authorization')).toBe('Bearer sk-proj-client');
    } finally {
      restore();
    }
  });
});

// Round 2: defects found by a gpt-6-astra review OF the round-1 fixes. A1 was a leak both
// reviewers caught independently; A4 and A5 are regressions round 1 introduced.

describe('A1: x-api-key is a credential too and is shape-checked like the bearer', () => {
  it('never sends an Anthropic x-api-key to api.x.ai alongside a grok-* body', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy(BASE);
      await send(proxy, '/v1/chat/completions', {
        body: CHAT_BODY('grok-4.6'),
        headers: { authorization: `Bearer ${CHATGPT_JWT}`, 'x-api-key': 'sk-ant-api03-REAL' },
      });
      const m = mainRequest(seen);
      expect(m.url.host).toBe('xai.test');
      expect(m.headers.get('x-api-key')).toBeNull();
      expect(m.headers.get('authorization')).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('A4: the OAuth MARKER alone is not a credential', () => {
  it('still injects the configured key when the marker rides on a request with no bearer', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, apiKey: 'sk-ant-api03-PROXY' });
      await send(proxy, '/v1/messages', {
        body: { model: 'claude-opus-5', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] },
        headers: { 'anthropic-beta': 'oauth-2025-04-20' },
      });
      // Round 1 suppressed on the marker alone -> unauthenticated -> 401.
      expect(mainRequest(seen).headers.get('x-api-key')).toBe('sk-ant-api03-PROXY');
    } finally {
      restore();
    }
  });
});

describe('A5: routing normalises a trailing slash; forwarding does not rewrite the path', () => {
  it('forwards a provider-prefixed path byte-for-byte, trailing slash included', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, apiKey: 'sk-ant-api03-PROXY' });
      await send(proxy, '/anthropic/v1/messages/', {
        body: { model: 'claude-opus-5', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] },
      });
      // Round 1 mutated url.pathname in place, so the upstream saw the slash stripped.
      expect(mainRequest(seen).url.pathname).toBe('/anthropic/v1/messages/');
    } finally {
      restore();
    }
  });
});

describe('G5: /v1/models/<id> passthrough', () => {
  it('returns a single-model body instead of a 500 from a disturbed stream', async () => {
    const single = '{"id":"gpt-4o","object":"model","owned_by":"system"}';
    const { restore } = captureUpstream(single);
    try {
      const proxy = createProxy(BASE);
      const res = await proxy(
        new Request('http://127.0.0.1/v1/models/gpt-4o', {
          headers: { authorization: 'Bearer sk-proj-client' },
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(single);
      expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(single)));
    } finally {
      restore();
    }
  });
});

describe('Multi-provider routing: AGY and LM Studio', () => {
  const AGY = 'http://127.0.0.1:4017';
  const LMSTUDIO = 'http://127.0.0.1:1234';

  it('routes agy-gemini-3.8-flash-high on /v1/chat/completions to agyUpstream :4017', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, agyUpstream: AGY });
      await send(proxy, '/v1/chat/completions', {
        headers: { authorization: 'Bearer dummy-agy-token' },
        body: { model: 'agy-gemini-3.8-flash-high', messages: [{ role: 'user', content: 'hi' }] },
      });
      const req = mainRequest(seen);
      expect(req.url.origin).toBe('http://127.0.0.1:4017');
      expect(req.url.pathname).toBe('/v1/chat/completions');
      expect(req.headers.get('authorization')).toBe('Bearer dummy-agy-token');
    } finally {
      restore();
    }
  });

  it('routes qwen / local model on /v1/chat/completions to lmStudioUpstream :1234', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({ ...BASE, lmStudioUpstream: LMSTUDIO });
      await send(proxy, '/v1/chat/completions', {
        headers: { authorization: 'Bearer dummy-local-token' },
        body: { model: 'qwen3.8-27b-obliterated', messages: [{ role: 'user', content: 'hi' }] },
      });
      const req = mainRequest(seen);
      expect(req.url.origin).toBe('http://127.0.0.1:1234');
      expect(req.url.pathname).toBe('/v1/chat/completions');
      expect(req.headers.get('authorization')).toBe('Bearer dummy-local-token');
    } finally {
      restore();
    }
  });
});
