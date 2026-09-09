import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fetchUpstreamCodexModels } from '../src/core/codex-models.js';

// Pins the contract of the codex catalog forwarder. Two independent reviews shaped it
// (2026-09-05): gpt-6-astra found the missing deadline, the HTML-as-JSON pass-through and the
// silent error paths; Grok 4.6 found that the first cut forwarded ANY non-Anthropic bearer —
// a Grok CLI's SuperGrok JWT included — to chatgpt.com. Forwarding is now decided by
// credential shape: only a ChatGPT-issued OAuth JWT goes upstream. Every fallback returns
// undefined so node.ts serves the synthesized list; 401/403 pass through so an expired
// session surfaces as an auth error rather than a stale picker.

const UPSTREAM = 'http://127.0.0.1:47822';
const URL_WITH_VERSION = new URL('http://127.0.0.1:47821/v1/models?client_version=0.153.3');
const URL_NO_VERSION = new URL('http://127.0.0.1:47821/v1/models');
const GOOD_BODY = JSON.stringify({ models: [{ slug: 'gpt-6-astra', display_name: 'GPT-6 Astra' }] });

/** Unsigned JWT with the given issuer — shape is all the forwarder inspects. */
function fakeJwt(iss: string): string {
  const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64url('{"alg":"none","typ":"JWT"}')}.${b64url(JSON.stringify({ iss, sub: 'u1' }))}.sig`;
}
const CHATGPT_JWT = fakeJwt('https://auth.openai.com');
const XAI_JWT = fakeJwt('https://auth.x.ai');

const CODEX_HEADERS: IncomingHttpHeaders = {
  authorization: `Bearer ${CHATGPT_JWT}`,
  'chatgpt-account-id': 'acct-1',
  originator: 'codex_cli_rs',
  'user-agent': 'codex_cli_rs/0.153.3 (Windows 11) WindowsTerminal',
};

type Handler = (input: string, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('fetchUpstreamCodexModels', () => {
  it('forwards a ChatGPT session to <upstream>/models with the caller\'s query and exactly the four headers', async () => {
    let seenUrl = '';
    let seenHeaders: unknown;
    const res = await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, UPSTREAM, {
      fetchImpl: fakeFetch((url, init) => {
        seenUrl = url;
        seenHeaders = init?.headers;
        return new Response(GOOD_BODY, { status: 200 });
      }),
    });

    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('application/json');
    expect(await res!.text()).toBe(GOOD_BODY); // preserved verbatim, never re-serialised
    expect(seenUrl).toBe(`${UPSTREAM}/models?client_version=0.153.3`);
    expect(seenHeaders).toEqual({
      authorization: `Bearer ${CHATGPT_JWT}`,
      'chatgpt-account-id': 'acct-1',
      originator: 'codex_cli_rs',
      'user-agent': 'codex_cli_rs/0.153.3 (Windows 11) WindowsTerminal',
    });
  });

  it('derives client_version from the User-Agent only when the query lacks it', async () => {
    let seenUrl = '';
    await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_NO_VERSION, UPSTREAM, {
      fetchImpl: fakeFetch((url) => {
        seenUrl = url;
        return new Response(GOOD_BODY);
      }),
    });
    expect(seenUrl).toBe(`${UPSTREAM}/models?client_version=0.153.3`);
  });

  it('strips trailing slashes from the upstream before appending /models', async () => {
    let seenUrl = '';
    await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, `${UPSTREAM}///`, {
      fetchImpl: fakeFetch((url) => {
        seenUrl = url;
        return new Response(GOOD_BODY);
      }),
    });
    expect(seenUrl).toBe(`${UPSTREAM}/models?client_version=0.153.3`);
  });

  it.each<[string, IncomingHttpHeaders, URL, string | undefined, RegExp]>([
    ['no authorization', { ...CODEX_HEADERS, authorization: undefined }, URL_WITH_VERSION, UPSTREAM, /no authorization/],
    ['an x-api-key alongside the bearer', { ...CODEX_HEADERS, 'x-api-key': 'sk-ant-abc' }, URL_WITH_VERSION, UPSTREAM, /x-api-key/],
    ['an Anthropic key', { ...CODEX_HEADERS, authorization: 'Bearer sk-ant-abc' }, URL_WITH_VERSION, UPSTREAM, /anthropic credential/],
    ['a Claude OAuth token', { ...CODEX_HEADERS, authorization: 'Bearer sk-ant-oat01-abc' }, URL_WITH_VERSION, UPSTREAM, /anthropic credential/],
    ['an OpenAI API key', { ...CODEX_HEADERS, authorization: 'Bearer sk-proj-abc' }, URL_WITH_VERSION, UPSTREAM, /not a ChatGPT session token/],
    ['an xAI console key', { ...CODEX_HEADERS, authorization: 'Bearer xai-abc' }, URL_WITH_VERSION, UPSTREAM, /not a ChatGPT session token/],
    ['a SuperGrok JWT (auth.x.ai)', { ...CODEX_HEADERS, authorization: `Bearer ${XAI_JWT}` }, URL_WITH_VERSION, UPSTREAM, /not a ChatGPT session token/],
    ['a malformed JWT', { ...CODEX_HEADERS, authorization: 'Bearer eyJ.not-base64.sig' }, URL_WITH_VERSION, UPSTREAM, /not a ChatGPT session token/],
    ['no upstream configured', CODEX_HEADERS, URL_WITH_VERSION, undefined, /no openai upstream/],
    ['no client_version anywhere', { ...CODEX_HEADERS, 'user-agent': 'curl/8.0' }, URL_NO_VERSION, UPSTREAM, /no client_version/],
  ])('declines without touching the network when there is %s', async (_label, headers, url, upstream, reason) => {
    let calls = 0;
    const reasons: string[] = [];
    const res = await fetchUpstreamCodexModels({ headers }, url, upstream, {
      fetchImpl: fakeFetch(() => {
        calls += 1;
        return new Response(GOOD_BODY);
      }),
      onDecline: (why) => reasons.push(why),
    });
    expect(res).toBeUndefined();
    expect(calls).toBe(0);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(reason);
  });

  it.each([401, 403])('passes a %i straight through so an expired session is not masked as a stale list', async (status) => {
    const reasons: string[] = [];
    const res = await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, UPSTREAM, {
      fetchImpl: fakeFetch(() => new Response('{"detail":"token expired"}', { status, headers: { 'content-type': 'application/json' } })),
      onDecline: (why) => reasons.push(why),
    });
    expect(res?.status).toBe(status);
    expect(await res!.text()).toBe('{"detail":"token expired"}');
    expect(reasons).toEqual([]);
  });

  it('falls back on any other non-2xx upstream and names the status', async () => {
    const reasons: string[] = [];
    const res = await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, UPSTREAM, {
      fetchImpl: fakeFetch(() => new Response('{"error":"bad gateway"}', { status: 502 })),
      onDecline: (why) => reasons.push(why),
    });
    expect(res).toBeUndefined();
    expect(reasons).toEqual(['upstream HTTP 502']);
  });

  it('falls back on a 200 whose body is not JSON instead of forwarding it as JSON', async () => {
    const reasons: string[] = [];
    const res = await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, UPSTREAM, {
      fetchImpl: fakeFetch(() => new Response('<html><body>Sign in</body></html>', { status: 200 })),
      onDecline: (why) => reasons.push(why),
    });
    expect(res).toBeUndefined();
    expect(reasons[0]).toMatch(/non-JSON body/);
  });

  it.each(['null', '[]', '"ok"', '{"error":{"message":"nope"}}'])(
    'falls back on a 200 whose JSON (%s) is not a models catalog',
    async (body) => {
      const reasons: string[] = [];
      const res = await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, UPSTREAM, {
        fetchImpl: fakeFetch(() => new Response(body, { status: 200 })),
        onDecline: (why) => reasons.push(why),
      });
      expect(res).toBeUndefined();
      expect(reasons[0]).toMatch(/not a models catalog/);
    },
  );

  it('accepts a catalog shaped as data[] as well as models[]', async () => {
    const body = JSON.stringify({ object: 'list', data: [{ id: 'gpt-6-astra' }] });
    const res = await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, UPSTREAM, {
      fetchImpl: fakeFetch(() => new Response(body, { status: 200 })),
    });
    expect(res?.status).toBe(200);
  });

  it('falls back when the upstream stalls past the timeout, via the abort signal it was given', async () => {
    const reasons: string[] = [];
    const res = await fetchUpstreamCodexModels({ headers: CODEX_HEADERS }, URL_WITH_VERSION, UPSTREAM, {
      timeoutMs: 40,
      fetchImpl: fakeFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            // Never resolves on its own; only the signal we were handed can end it.
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
      onDecline: (why) => reasons.push(why),
    });
    expect(res).toBeUndefined();
    expect(reasons[0]).toMatch(/upstream fetch failed/);
  });
});
