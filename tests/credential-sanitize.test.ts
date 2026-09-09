import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeCredentialHeaders, type UpstreamProvider } from '../src/core/credential-shape.js';
import { createProxy } from '../src/core/proxy.js';

function fakeJwt(payload: unknown): string {
  const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

const CHATGPT_AUTH = `Bearer ${fakeJwt({ iss: 'https://auth.openai.com' })}`;
const XAI_AUTH = `Bearer ${fakeJwt({ iss: 'https://auth.x.ai' })}`;
const ANTHROPIC_AUTH = 'Bearer sk-ant-api03-client';
const CLAUDE_AUTH = 'Bearer sk-ant-oat01-session';
const OPENAI_AUTH = 'Bearer sk-proj-client';
const XAI_KEY_AUTH = 'Bearer xai-client';
type HeaderCase = [header: string, value: string];

const ambientCredentials: HeaderCase[] = [
  ['cookie', 'session=private'],
  ['proxy-authorization', 'Basic cHJpdmF0ZQ=='],
];
const foreignApiKey: HeaderCase = ['x-api-key', 'sk-ant-api03-client'];
const accountId: HeaderCase = ['chatgpt-account-id', 'account-private'];
// Shapes that name NO provider. The policy is deny-known-foreign, not allow-known-own, so
// these SURVIVE every lane: an opaque token is not evidence of anything, and stripping it
// would 401 the operator's own lane the day a provider changes token format. The repo's
// pre-existing tests/gateway.test.ts already depended on this — it sends an opaque
// `Bearer codex-test-secret` to the ChatGPT backend and asserts it arrives. Every leak
// actually measured on 2026-09-05 involved a credential whose shape names its owner, and
// those are still stripped (see each provider's `dropped` list).
const unrecognizedAuth: HeaderCase[] = [
  ['authorization', 'Basic cHJpdmF0ZQ=='],
  ['authorization', 'Bearer opaque-token'],
  ['authorization', 'Bearer eyJ.not-base64!!.sig'],
  ['authorization', `Bearer ${fakeJwt({ iss: 'https://auth.openai.com.evil.example' })}`],
];

const policies: { provider: UpstreamProvider; survive: HeaderCase[]; dropped: HeaderCase[] }[] = [
  {
    provider: 'anthropic',
    survive: [['authorization', ANTHROPIC_AUTH], ['authorization', CLAUDE_AUTH], foreignApiKey],
    dropped: [
      ['authorization', OPENAI_AUTH], ['authorization', CHATGPT_AUTH],
      ['authorization', XAI_AUTH], ['authorization', XAI_KEY_AUTH],
      ['x-api-key', 'sk-proj-client'], ['x-api-key', 'xai-client'],
      ['x-api-key', 'opaque-token'], accountId, ...ambientCredentials,
    ],
  },
  {
    provider: 'openai',
    survive: [
      ['authorization', OPENAI_AUTH], ['authorization', 'Bearer sk-legacy'],
      ['authorization', CHATGPT_AUTH], ['authorization', 'bearer   sk-proj-client'],
    ],
    dropped: [
      ['authorization', ANTHROPIC_AUTH], ['authorization', CLAUDE_AUTH],
      ['authorization', XAI_AUTH], ['authorization', XAI_KEY_AUTH],
      foreignApiKey, accountId, ...ambientCredentials,
    ],
  },
  {
    provider: 'chatgpt',
    survive: [['authorization', CHATGPT_AUTH], accountId],
    dropped: [
      ['authorization', OPENAI_AUTH], ['authorization', ANTHROPIC_AUTH],
      ['authorization', CLAUDE_AUTH], ['authorization', XAI_AUTH],
      ['authorization', XAI_KEY_AUTH], foreignApiKey, ...ambientCredentials,
    ],
  },
  {
    provider: 'xai',
    survive: [['authorization', XAI_AUTH], ['authorization', XAI_KEY_AUTH]],
    dropped: [
      ['authorization', OPENAI_AUTH], ['authorization', ANTHROPIC_AUTH],
      ['authorization', CLAUDE_AUTH], ['authorization', CHATGPT_AUTH],
      foreignApiKey, accountId, ...ambientCredentials,
    ],
  },
  {
    provider: 'passthrough',
    survive: [
      ['authorization', OPENAI_AUTH], ['authorization', ANTHROPIC_AUTH],
      ['authorization', CLAUDE_AUTH], ['authorization', CHATGPT_AUTH],
      ['authorization', XAI_AUTH], ['authorization', XAI_KEY_AUTH],
      foreignApiKey, ['x-api-key', 'gateway-private'], accountId,
      ...ambientCredentials,
    ],
    dropped: [], // The gateway owns authentication, including opaque credentials.
  },
];

for (const { provider, survive, dropped } of policies) {
  describe(`sanitizeCredentialHeaders: ${provider}`, () => {
    // Mutation controls for every survival row: delete the provider's keepAuthorization
    // assignment for authorization, `keepApiKey = headers.get('x-api-key')?.startsWith('sk-ant-') === true;`
    // for Anthropic x-api-key, or `keepAccountId = true;` for ChatGPT account IDs.
    // For every passthrough row, delete `if (provider === 'passthrough') return;` instead.
    it.each(survive)('preserves %s: %s', (header, value) => {
      const headers = new Headers({ [header]: value, 'content-type': 'application/json' });
      sanitizeCredentialHeaders(headers, provider);
      expect(headers.get(header)).toBe(value);
      expect(headers.get('content-type')).toBe('application/json');
    });

    // Mutation control for every removal row: delete the sanitizer line containing
    // `headers.delete('<header>')`, using the header named by that row.
    it.each(dropped)('drops %s: %s', (header, value) => {
      const headers = new Headers({ [header]: value, 'content-type': 'application/json' });
      sanitizeCredentialHeaders(headers, provider);
      expect(headers.get(header)).toBeNull();
      expect(headers.get('content-type')).toBe('application/json');
    });
  });
}

let ambientPxpipeModels: string | undefined;
beforeAll(() => {
  ambientPxpipeModels = process.env.PXPIPE_MODELS;
  process.env.PXPIPE_MODELS = 'off'; // no imaging: this is a routing test
});
afterAll(() => {
  if (ambientPxpipeModels === undefined) delete process.env.PXPIPE_MODELS;
  else process.env.PXPIPE_MODELS = ambientPxpipeModels;
});

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

describe('credential sanitization at the proxy boundary', () => {
  // Mutation control: delete `sanitizeCredentialHeaders(outHeaders, provider);` in proxy.ts
  // (or make the function a no-op): the Anthropic x-api-key then reaches openai.test.
  it('removes an Anthropic x-api-key before forwarding to OpenAI and preserves the injected OpenAI key', async () => {
    const { seen, restore } = captureUpstream();
    try {
      const proxy = createProxy({
        transform: {},
        upstream: 'https://anthropic.test',
        openAIUpstream: 'https://openai.test',
        xaiUpstream: 'https://xai.test',
        openAIApiKey: 'sk-proj-PROXYKEY',
      });
      const response = await send(proxy, '/v1/chat/completions', {
        body: { model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hi' }] },
        headers: { 'x-api-key': 'sk-ant-api03-client' },
      });
      const m = mainRequest(seen);
      expect(response.status).toBe(200);
      expect(m.url.host).toBe('openai.test');
      expect(m.url.pathname).toBe('/v1/chat/completions');
      expect(m.headers.get('x-api-key')).toBeNull();
      expect(m.headers.get('authorization')).toBe('Bearer sk-proj-PROXYKEY');
    } finally {
      restore();
    }
  });
});

// Added after Astra's implementation: Grok 4.6 noted `api-key` (Azure OpenAI) and
// `x-goog-api-key` (Google) were never inspected, so a client configured for either could
// hand that key to any destination. Control: delete either entry from
// ALWAYS_STRIPPED_CREDENTIAL_HEADERS in src/core/credential-shape.ts and the matching case
// below fails.
describe('vendor credential headers no built-in lane needs', () => {
  const PROVIDERS = ['anthropic', 'openai', 'chatgpt', 'xai'] as const;

  it.each(PROVIDERS)('strips api-key and x-goog-api-key for the %s lane', (provider) => {
    const h = new Headers({
      'api-key': 'azure-openai-key',
      'x-goog-api-key': 'google-key',
    });
    sanitizeCredentialHeaders(h, provider);
    expect(h.get('api-key')).toBeNull();
    expect(h.get('x-goog-api-key')).toBeNull();
  });

  it('preserves both for passthrough, where the configured gateway owns its own auth', () => {
    const h = new Headers({
      'api-key': 'azure-openai-key',
      'x-goog-api-key': 'google-key',
    });
    sanitizeCredentialHeaders(h, 'passthrough');
    expect(h.get('api-key')).toBe('azure-openai-key');
    expect(h.get('x-goog-api-key')).toBe('google-key');
  });
});
