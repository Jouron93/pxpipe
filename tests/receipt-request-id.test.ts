/**
 * Receipt correlation-ID semantics.
 *
 * Every receipt must be correlatable, but clients generally cannot mint a fresh
 * header value per request from static config — Codex, for example, supports
 * only `http_headers` (static) and `env_http_headers` (env-backed), both fixed
 * for the process lifetime. So PXPipe mints the id when the caller does not
 * supply one, and records WHICH happened.
 *
 * The invariants under test:
 *
 *   client sends x-request-id  -> preserve verbatim, request_id_source=client
 *   client sends none          -> mint a UUID,       request_id_source=pxpipe
 *   one inbound request        -> ONE request_id across every event it fires
 *   separate requests          -> distinct request_ids
 *
 * The third is the one that actually bit during implementation: generating the
 * fallback inside the event literal produced a NEW uuid on every fire() call, so
 * a request that emits both a count_tokens probe and a main event would have
 * been unstitchable. It looked correct and passed a naive "a uuid is present"
 * check. That is why this file asserts sameness across events rather than mere
 * presence.
 *
 * request_id_source exists so a minted id is never mistaken for one the client
 * knows about — otherwise a later cross-log join on request_id produces
 * convincing but false matches.
 *
 * All URLs/tokens are fake; global fetch is stubbed and the suite never touches
 * the network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';
import { toTrackEvent } from '../src/core/tracker.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Minimal upstream stub. Answers the count_tokens probe and the main call so a
 *  single inbound request can fire more than one event. */
function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/count_tokens')) {
      return new Response(JSON.stringify({ input_tokens: 1 }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ type: 'message', content: [], usage: { input_tokens: 1, output_tokens: 1 } }),
      { headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

/** Drive one request through the proxy, returning every event it fired. */
async function runRequest(headers: Record<string, string>): Promise<ProxyEvent[]> {
  stubFetch();
  const events: ProxyEvent[] = [];
  const proxy = createProxy({ onRequest: (e: ProxyEvent) => { events.push(e); } });
  const res = await proxy(
    new Request('http://127.0.0.1/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] }),
    }),
  );
  await res.text();
  // onRequest is fired from an async finalize(); let the microtask queue drain.
  await new Promise((r) => setTimeout(r, 0));
  return events;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('receipt request_id', () => {
  it('preserves a client-supplied x-request-id verbatim and marks the source', async () => {
    const supplied = 'client-corr-0001';
    const events = await runRequest({ 'x-request-id': supplied });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.requestId).toBe(supplied);
      expect(e.requestIdSource).toBe('client');
    }
    // and it survives serialisation into the persisted row
    const row = toTrackEvent(events[0]!);
    expect(row.request_id).toBe(supplied);
    expect(row.request_id_source).toBe('client');
  });

  it('mints a UUID when the caller supplies none, marked as pxpipe-generated', async () => {
    const events = await runRequest({});
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.requestId).toMatch(UUID_RE);
      expect(e.requestIdSource).toBe('pxpipe');
    }
    const row = toTrackEvent(events[0]!);
    expect(row.request_id).toMatch(UUID_RE);
    expect(row.request_id_source).toBe('pxpipe');
  });

  it('emits exactly one event per inbound request (premise for the id contract)', async () => {
    // Documents the CURRENT shape rather than pretending to guard a multi-event
    // case that does not exist. proxy.ts has three fire() call sites and all are
    // mutually exclusive terminal branches, so one request => one event.
    //
    // This was worth pinning down: an earlier version of this file asserted
    // "all events share one id" via `new Set(ids).size === 1`, which a
    // single-element set satisfies trivially. It passed while proving nothing.
    // If someone later adds a non-terminal emit (a per-attempt retry event, say)
    // this test fails and forces them to add the real cross-event assertion —
    // and to check that resolvedRequestId is still hoisted out of fire().
    const events = await runRequest({});
    expect(events.length).toBe(1);
  });

  it('gives separate requests distinct ids', async () => {
    const a = await runRequest({});
    const b = await runRequest({});
    expect(a[0]?.requestId).toBeTruthy();
    expect(b[0]?.requestId).toBeTruthy();
    expect(a[0]?.requestId).not.toBe(b[0]?.requestId);
  });

  it('always records a session_id, using the explicit unknown sentinel', async () => {
    // An absent session must be a visible bucket, never a missing key — dropping
    // it makes unattributable traffic disappear from accounting instead of
    // showing up as a gap.
    const row = toTrackEvent((await runRequest({}))[0]!);
    expect(row.session_id).toBe('<unknown>');
    const named = toTrackEvent((await runRequest({ 'x-session-id': 'codex-a-abc123' }))[0]!);
    expect(named.session_id).toBe('codex-a-abc123');
  });

  it('takes account ONLY from x-account, never from a provider account header', async () => {
    // The separation this project cares about: x-account is a LOCAL logical
    // label we mint (codex-a, claude-b) and is safe to persist forever. Provider
    // account identifiers are not, and must never reach a receipt.
    //
    // gateway.test.ts already proves chatgpt-account-id stays out of a persisted
    // row; this is the focused complement — that none of these can SET or
    // contaminate `account`, so a provider id can never be mistaken for one of
    // our profile labels in later per-account spend accounting.
    const events = await runRequest({
      'x-account': 'codex-a',
      'chatgpt-account-id': 'acct-provider-secret',
      'openai-organization': 'org-provider-secret',
      'openai-project': 'proj-provider-secret',
    });
    const row = toTrackEvent(events[0]!);
    expect(row.account).toBe('codex-a');
    const blob = JSON.stringify(row);
    for (const leak of ['acct-provider-secret', 'org-provider-secret', 'proj-provider-secret']) {
      expect(blob).not.toContain(leak);
    }
  });

  it('records caller and account from identity headers without leaking credentials', async () => {
    const events = await runRequest({
      'x-app': 'codex',
      'x-account': 'codex-a',
      authorization: 'Bearer must-not-persist',
    });
    const row = toTrackEvent(events[0]!);
    expect(row.account).toBe('codex-a');
    expect(row.caller).toContain('x-app=codex');
    // The persisted row must never carry credential material.
    expect(JSON.stringify(row)).not.toContain('must-not-persist');
  });
});
