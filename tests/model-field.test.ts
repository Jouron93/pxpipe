import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';

// Pin the model scope so these gate-contract tests stay independent of the developer shell.
let ambientPxpipeModels: string | undefined;
beforeAll(() => {
  ambientPxpipeModels = process.env.PXPIPE_MODELS;
  process.env.PXPIPE_MODELS = 'claude-fable-5,gpt-5.6-sol';
});
afterAll(() => {
  if (ambientPxpipeModels === undefined) delete process.env.PXPIPE_MODELS;
  else process.env.PXPIPE_MODELS = ambientPxpipeModels;
});

function mockUpstream(handler: (req: Request) => Promise<Response> | Response) {
  const real = globalThis.fetch;
  globalThis.fetch = ((req: Request | string | URL, init?: RequestInit) => {
    const r = req instanceof Request ? req : new Request(String(req), init);
    return Promise.resolve(handler(r));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

const OK_RESPONSE = () =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      model: 'claude-fable-5',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

/** Drive one request through the proxy and return the telemetry event. */
async function runOnce(body: string): Promise<ProxyEvent> {
  const restore = mockUpstream(OK_RESPONSE);
  let captured: ProxyEvent | undefined;
  const proxy = createProxy({
    transform: {},
    onRequest: (e) => {
      captured = e;
    },
  });
  const res = await proxy(
    new Request('http://127.0.0.1/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
  await res.text();
  await new Promise((r) => setTimeout(r, 20));
  restore();
  expect(captured).toBeDefined();
  return captured!;
}

// readModelField is module-private; `requestedModel` on the telemetry event is
// assigned directly from its return value, so it is a faithful probe of it.
describe('top-level model extraction (gate input)', () => {
  it('finds `model` on a body larger than the old 128 KiB scan window', async () => {
    // JSON.stringify preserves insertion order, so `model` declared last
    // serializes past any fixed-size prefix window. This is the shape that
    // matters: real Claude Code bodies carry history before the trailing keys.
    const filler = 'x'.repeat(200_000);
    const body = JSON.stringify({
      messages: [{ role: 'user', content: filler }],
      model: 'claude-fable-5',
    });
    expect(body.indexOf('"model"')).toBeGreaterThan(131072); // past the old window

    const e = await runOnce(body);
    // Regression: the windowed reader returned null here, so the gate fell
    // closed to unsupported_model and forwarded the LARGEST bodies at full
    // price — the exact opposite of what the gate exists to do.
    expect(e.requestedModel).toBe('claude-fable-5');
    expect(e.info?.reason).not.toBe('unsupported_model');
  });

  it('ignores a `"model":` string sitting inside message content', async () => {
    // A pasted log/transcript can contain this text. A first-match regex over a
    // prefix window would adopt it and compress for a model the caller never
    // asked for; only the top-level key may drive the gate.
    const body = JSON.stringify({
      messages: [{ role: 'user', content: 'log said: "model": "claude-fable-5" <- not mine' }],
      model: 'some-unsupported-model',
    });
    expect(body.indexOf('claude-fable-5')).toBeLessThan(body.indexOf('some-unsupported-model'));

    const e = await runOnce(body);
    expect(e.requestedModel).toBe('some-unsupported-model');
    expect(e.info?.reason).toBe('unsupported_model');
  });

  it('fails closed to no-compression when the body is not JSON', async () => {
    const e = await runOnce('not json at all');
    expect(e.requestedModel).toBeUndefined();
    expect(e.info?.reason).toBe('unsupported_model');
  });
});
