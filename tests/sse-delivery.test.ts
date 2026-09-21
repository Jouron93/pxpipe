import { afterEach, expect, it } from 'vitest';
import { createServer, request, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { createWarpHandlers } from '../src/warp/connect.js';
import type { CertificateAuthority } from '../src/warp/ca.js';

const servers: Server[] = [];
let child: ChildProcess | undefined;
let dir: string | undefined;
afterEach(async () => {
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
  child = undefined;
  await Promise.all(servers.splice(0).map(async server => {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return (server.address() as { port: number }).port;
}
function deadline<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSE delivery stalled before upstream completion')), 3000);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

it.each(['node', 'warp'] as const)('%s delivers headers before the first token and tokens before upstream completion', async mode => {
  let upstream: ServerResponse | undefined;
  const upstreamPort = await listen(createServer((req, res) => {
    req.resume();
    upstream = res;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
    // No timer writes or ends this response: downstream receipt gates each step.
  }));
  let port: number;
  if (mode === 'warp') {
    const handlers = createWarpHandlers({ routes: [], ca: {
      secureContextFor() { throw new Error('unexpected TLS in HTTP regression test'); },
    } as unknown as CertificateAuthority });
    port = await listen(createServer(handlers.handleAbsoluteForm));
  } else {
    const reservation = createServer();
    port = await listen(reservation);
    await new Promise<void>(done => reservation.close(() => done()));
    dir = mkdtempSync(join(tmpdir(), 'pxpipe-sse-'));
    child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'src/node.ts'], {
      cwd: resolve('.'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
        PXPIPE_CONFIG: join(dir, 'config.json'), PXPIPE_LOG: join(dir, 'events.jsonl'),
        PXPIPE_MODELS: 'off', ANTHROPIC_UPSTREAM: `http://127.0.0.1:${upstreamPort}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await deadline(new Promise<void>((done, reject) => {
      let output = '';
      const read = (chunk: Buffer) => { output += chunk.toString(); if (output.includes('[pxpipe] listening on')) done(); };
      child!.stdout!.on('data', read); child!.stderr!.on('data', read);
      child!.once('exit', code => reject(new Error(`test node exited: ${code}`)));
    }));
  }
  const req = request({ hostname: '127.0.0.1', port, method: 'POST',
    path: mode === 'warp' ? `http://127.0.0.1:${upstreamPort}/v1/messages` : '/v1/messages',
    headers: { 'content-type': 'application/json' } });
  const responsePromise = new Promise<IncomingMessage>((done, reject) => { req.once('response', done); req.once('error', reject); });
  req.end(JSON.stringify({ model: 'claude-fable-5', stream: true, max_tokens: 10, messages: [{ role: 'user', content: 'hello' }] }));
  try {
    const response = await deadline(responsePromise);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(upstream?.writableEnded).toBe(false);
    const chunk = once(response, 'data');
    upstream!.write('data: {"token":"first"}\n\n');
    expect(String((await deadline(chunk))[0])).toBe('data: {"token":"first"}\n\n');
    expect(upstream!.writableEnded).toBe(false);
    const ended = once(response, 'end');
    upstream!.end('data: [DONE]\n\n');
    response.resume();
    await deadline(ended);
  } finally { req.destroy(); }
}, 15000);
