import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';

function mockUpstream(handler: (req: Request) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(handler(req));
  });
}

function clientRequest(signal: AbortSignal, path = '/v1/responses'): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(path === '/v1/responses'
      ? { model: 'gpt-5.6-sol', input: 'hi', stream: true }
      : { model: 'claude-fable-5', messages: [{ role: 'user', content: 'hi' }] }),
    signal,
  });
}

beforeEach(() => {
  vi.stubEnv('PXPIPE_MODELS', 'claude-fable-5,gpt-5.6-sol');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('client abort propagation', () => {
  it('aborts the upstream signal and rejects a pending stream read', async () => {
    const client = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    mockUpstream((req) => {
      upstreamSignal = req.signal;
      // Model fetch's response-body behavior: only its supplied signal can end this stream.
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          req.signal.addEventListener('abort', () => controller.error(req.signal.reason), { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const proxy = createProxy({ openAIUpstream: 'https://api.openai.test', transform: {} });
    const response = await proxy(clientRequest(client.signal));
    const reader = response.body!.getReader();
    const pending = expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    client.abort();

    expect(upstreamSignal).toBeDefined();
    expect(upstreamSignal?.aborted).toBe(true);
    await pending;
    reader.releaseLock();
  }, 200);

  it('keeps the upstream signal active after normal completion', async () => {
    const client = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    mockUpstream((req) => {
      upstreamSignal = req.signal;
      return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const proxy = createProxy({ openAIUpstream: 'https://api.openai.test', transform: {} });
    const response = await proxy(clientRequest(client.signal));

    expect(await response.text()).toBe('data: [DONE]\n\n');
    expect(upstreamSignal).toBeDefined();
    expect(upstreamSignal?.aborted).toBe(false);
  });

  it.each(['/v1/responses', '/v1/messages'])('does not retry or report an aborted fetch on %s as an upstream failure', async (path) => {
    const client = new AbortController();
    const upstreamRequests: Request[] = [];
    const events: ProxyEvent[] = [];
    let started!: () => void;
    const mainFetchStarted = new Promise<void>((resolve) => { started = resolve; });
    mockUpstream((req) => {
      upstreamRequests.push(req);
      if (!req.url.endsWith('/count_tokens')) started();
      return new Promise<Response>((_resolve, reject) => {
        req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true });
      });
    });
    const proxy = createProxy({
      upstream: 'https://api.anthropic.test',
      openAIUpstream: 'https://api.openai.test',
      transform: {},
      onRequest: (event) => { events.push(event); },
    });
    const pending = expect(proxy(clientRequest(client.signal, path))).rejects.toMatchObject({ name: 'AbortError' });
    await mainFetchStarted;
    client.abort();
    await pending;

    expect(upstreamRequests.filter((req) => !req.url.endsWith('/count_tokens'))).toHaveLength(1);
    if (path === '/v1/messages') {
      expect(upstreamRequests.some((req) => req.url.endsWith('/count_tokens'))).toBe(true);
    }
    expect(upstreamRequests.every((req) => req.signal.aborted)).toBe(true);
    expect(events).toEqual([]);
    // The probe's retry budget is 250 ms; no delayed fetch may follow the abort.
    const callsAtAbort = upstreamRequests.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(upstreamRequests).toHaveLength(callsAtAbort);
  });
});
