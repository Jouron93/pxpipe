/**
 * Findings from the 2026-09-09 adversarial audit of `pxpipe warp` (6a7a828..116bd27),
 * each pinned by the behaviour that was missing:
 *
 *  P1-1  a .cmd shim ran through cmd.exe with `shell: true`, so prompt text was shell syntax
 *  P1-3  the CA cert/key/bundle were written in place, unlocked, under concurrent launches
 *  P1-4  codex on a ChatGPT login (chatgpt.com/backend-api/codex) tunnelled past warp, and a
 *        stale OPENAI_BASE_URL survived into the child
 *  P2-1  CONNECT host, TLS SNI and HTTP Host each chose something different
 *  P2-2  a CONNECT to port 0 or 70000 threw synchronously and took the proxy down
 *  P2-5  an upstream error after headers were sent appended plaintext to a live stream
 *
 * Run just this file:  pnpm vitest run tests/warp-hardening.test.ts
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateKey, X509Certificate } from 'node:crypto';

import { CertificateAuthority, writeFileAtomic, withDirectoryLock } from '../src/warp/ca.js';
import { createWarpHandlers, parseAuthority } from '../src/warp/connect.js';
import {
  childEnvironment,
  defaultRoutes,
  findUnsafeCmdArgument,
  resolveShimTarget,
} from '../src/warp/index.js';
import { matchRoute, parseRoute, rewriteUrl } from '../src/warp/route.js';

const dirs: string[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'pxpipe-warp-hard-'));
  dirs.push(d);
  return d;
};
const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
const readAll = (socket: Socket): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
const readUntil = (socket: Socket, marker: string): Promise<string> =>
  new Promise((resolve) => {
    let buf = '';
    const onData = (c: Buffer) => {
      buf += c.toString('utf8');
      if (buf.includes(marker)) {
        socket.off('data', onData);
        resolve(buf);
      }
    };
    socket.on('data', onData);
  });

describe('P1-4: codex on chatgpt.com is diverted, provider base URLs are stripped', () => {
  it('maps chatgpt.com/backend-api/codex/* onto pxpipe /v1/*', () => {
    const routes = defaultRoutes(47821);
    const route = matchRoute(routes, 'chatgpt.com:443', '/backend-api/codex/responses');
    expect(route).not.toBeNull();
    expect(rewriteUrl(route!, '/backend-api/codex/responses?x=1')).toBe(
      'http://127.0.0.1:47821/v1/responses?x=1',
    );
    expect(rewriteUrl(route!, '/backend-api/codex/models')).toBe('http://127.0.0.1:47821/v1/models');
  });

  it('a "*" target substitutes the pattern prefix; a plain target keeps the whole path', () => {
    const sub = parseRoute('a.test/x/y/*=http://127.0.0.1:1/z/*');
    expect(rewriteUrl(sub, '/x/y/q?k=v')).toBe('http://127.0.0.1:1/z/q?k=v');
    const keep = parseRoute('a.test/x/y/*=http://127.0.0.1:1/z');
    expect(rewriteUrl(keep, '/x/y/q')).toBe('http://127.0.0.1:1/z/x/y/q');
    expect(() => parseRoute('a.test/x=http://127.0.0.1:1/*')).toThrow(/needs a "\*" in the pattern path/);
  });

  it('removes every provider base URL, not just Anthropic', () => {
    const env = childEnvironment(
      {
        PATH: 'x',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:47821',
        OPENAI_BASE_URL: 'http://127.0.0.1:47822/v1',
        OPENAI_API_BASE: 'http://127.0.0.1:47822/v1',
        XAI_BASE_URL: 'http://127.0.0.1:47822/v1',
        KEEP_ME: 'yes',
      },
      'http://127.0.0.1:5',
      { certPath: '/ca.pem', bundlePath: '/bundle.pem' },
    );
    for (const k of ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'XAI_BASE_URL']) {
      expect(env[k], k).toBeUndefined();
    }
    expect(env.KEEP_ME).toBe('yes');
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:5');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/ca.pem');
    expect(env.SSL_CERT_FILE).toBe('/bundle.pem');
  });
});

describe('P1-1: .cmd shims are unwrapped instead of run through cmd.exe', () => {
  it('finds the node script an npm shim ends with', () => {
    const d = tmp();
    mkdirSync(join(d, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true });
    writeFileSync(join(d, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), '');
    writeFileSync(
      join(d, 'codex.cmd'),
      '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n' +
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    );
    const target = resolveShimTarget(join(d, 'codex.cmd'));
    expect(target).toEqual({ kind: 'node', script: join(d, 'node_modules', '@openai', 'codex', 'bin', 'codex.js') });
  });

  it('finds the native exe a shim ends with', () => {
    const d = tmp();
    mkdirSync(join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin'), { recursive: true });
    writeFileSync(join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), '');
    writeFileSync(join(d, 'claude.cmd'), 'SET dp0=%~dp0\r\n:start\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
    expect(resolveShimTarget(join(d, 'claude.cmd'))).toEqual({
      kind: 'exe',
      path: join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    });
  });

  it('returns null for a shim whose target is missing or unrecognisable', () => {
    const d = tmp();
    writeFileSync(join(d, 'gone.cmd'), '"%dp0%\\nothing\\here.js" %*\r\n');
    expect(resolveShimTarget(join(d, 'gone.cmd'))).toBeNull();
    writeFileSync(join(d, 'opaque.cmd'), '@echo off\r\nsomething %*\r\n');
    expect(resolveShimTarget(join(d, 'opaque.cmd'))).toBeNull();
    expect(resolveShimTarget(join(d, 'absent.cmd'))).toBeNull();
  });

  it('names the argument cmd.exe would reinterpret', () => {
    expect(findUnsafeCmdArgument(['-p', 'plain prompt with spaces'])).toBeNull();
    expect(findUnsafeCmdArgument(['-p', 'run this & del *'])).toBe('run this & del *');
    expect(findUnsafeCmdArgument(['--x', '%USERPROFILE%'])).toBe('%USERPROFILE%');
    expect(findUnsafeCmdArgument(['say "hi"'])).toBe('say "hi"');
  });
});

describe('P1-3: CA persistence is atomic, locked and self-consistent', () => {
  it('writeFileAtomic leaves no temp file behind and the content is complete', () => {
    const d = tmp();
    const p = join(d, 'f.pem');
    writeFileAtomic(p, 'one', 0o644);
    writeFileAtomic(p, 'two', 0o644);
    expect(readFileSync(p, 'utf8')).toBe('two');
    expect(readFileSync(p, 'utf8')).not.toContain('one');
    const leftovers = readdir(d).filter((n) => n.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('a cert whose key on disk belongs to another CA is replaced, not loaded', () => {
    const a = tmp();
    const b = tmp();
    const caA = CertificateAuthority.loadOrCreate(a);
    CertificateAuthority.loadOrCreate(b);
    // Interleave: A's cert with B's key — what two racing writers produced before.
    writeFileSync(join(a, 'warp-ca-key.pem'), readFileSync(join(b, 'warp-ca-key.pem')));
    const reloaded = CertificateAuthority.loadOrCreate(a);
    const cert = new X509Certificate(readFileSync(reloaded.certPath, 'utf8'));
    const key = createPrivateKey(readFileSync(join(a, 'warp-ca-key.pem'), 'utf8'));
    expect(cert.checkPrivateKey(key)).toBe(true);
    expect(readFileSync(reloaded.certPath, 'utf8')).not.toBe(readFileSync(caA.certPath, 'utf8') && '');
  });

  it('a matching pair is reused across launches (no re-mint, no lock left behind)', () => {
    const d = tmp();
    const first = readFileSync(CertificateAuthority.loadOrCreate(d).certPath, 'utf8');
    const second = readFileSync(CertificateAuthority.loadOrCreate(d).certPath, 'utf8');
    expect(second).toBe(first);
    expect(readdir(d)).not.toContain('warp-ca.lock');
  });

  it('the directory lock is taken over when stale and released after the callback', () => {
    const d = tmp();
    const lock = join(d, 'lock');
    mkdirSync(lock);
    const past = new Date(Date.now() - 120_000);
    utimes(lock, past);
    expect(withDirectoryLock(lock, () => 'ran', 30_000, 200)).toBe('ran');
    expect(readdir(d)).not.toContain('lock');
  });
});

describe('P2-2: CONNECT authorities are validated before a socket is opened', () => {
  it('accepts hosts and IP literals with a sane port', () => {
    expect(parseAuthority('api.anthropic.com:443', '443')).toEqual({ host: 'api.anthropic.com', port: 443 });
    expect(parseAuthority('api.anthropic.com', '443')).toEqual({ host: 'api.anthropic.com', port: 443 });
    expect(parseAuthority('[::1]:8080', '443')).toEqual({ host: '::1', port: 8080 });
    expect(parseAuthority('127.0.0.1:47821', '443')).toEqual({ host: '127.0.0.1', port: 47821 });
  });

  it('rejects what net.connect would throw on', () => {
    for (const bad of ['host:0', 'host:70000', 'host:abc', ':443', '', 'ho st:1', 'a/b:1', '[::1:1']) {
      expect(parseAuthority(bad, '443'), bad).toBeNull();
    }
  });

  it('answers a bad CONNECT line with 400 instead of crashing the process', async () => {
    const ca = CertificateAuthority.loadOrCreate(tmp());
    const handlers = createWarpHandlers({ routes: [], ca });
    const proxy = createHttpServer(handlers.handleAbsoluteForm);
    proxy.on('connect', handlers.handleConnect);
    const port = await listen(proxy);
    const socket = netConnect(port, '127.0.0.1');
    sockets.push(socket);
    await new Promise<void>((r) => socket.once('connect', () => r()));
    socket.write('CONNECT example.test:70000 HTTP/1.1\r\nHost: example.test:70000\r\n\r\n');
    const reply = await readAll(socket);
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(proxy.listening).toBe(true);
  });
});

describe('P2-5: an upstream failure after headers were sent cuts the stream instead of appending text', () => {
  it('never writes "upstream error" into a body that already started', async () => {
    const upstream = createHttpServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => res.socket?.destroy(), 30);
    });
    const upstreamPort = await listen(upstream);
    const ca = CertificateAuthority.loadOrCreate(tmp());
    const handlers = createWarpHandlers({ routes: [], ca });
    const proxy = createHttpServer(handlers.handleAbsoluteForm);
    const proxyPort = await listen(proxy);

    const socket = netConnect(proxyPort, '127.0.0.1');
    sockets.push(socket);
    await new Promise<void>((r) => socket.once('connect', () => r()));
    socket.write(`GET http://127.0.0.1:${upstreamPort}/stream HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\n\r\n`);
    const got = await readAll(socket);
    expect(got).toContain('data: first');
    expect(got).not.toContain('pxpipe warp: upstream error');
  });
});

describe('P2-1: CONNECT host, TLS SNI and HTTP Host must agree', () => {
  async function connectThrough(
    proxyPort: number,
    connectHost: string,
    sni: string,
    caPem: string,
  ): Promise<import('node:tls').TLSSocket> {
    const raw = netConnect(proxyPort, '127.0.0.1');
    sockets.push(raw);
    await new Promise<void>((r) => raw.once('connect', () => r()));
    raw.write(`CONNECT ${connectHost}:443 HTTP/1.1\r\nHost: ${connectHost}:443\r\n\r\n`);
    const banner = await readUntil(raw, '\r\n\r\n');
    expect(banner).toMatch(/^HTTP\/1\.1 200 /);
    const tls = tlsConnect({ socket: raw, servername: sni, ca: caPem, ALPNProtocols: ['http/1.1'] });
    sockets.push(tls);
    await new Promise<void>((resolve, reject) => {
      tls.once('secureConnect', () => resolve());
      tls.once('error', reject);
    });
    return tls;
  }

  it('serves the request when all three names match, and refuses when Host or SNI drifts', async () => {
    const upstream = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`served ${req.headers.host} ${req.url}`);
    });
    const upstreamPort = await listen(upstream);
    const dir = tmp();
    const ca = CertificateAuthority.loadOrCreate(dir);
    const caPem = readFileSync(ca.certPath, 'utf8');
    const routes = [parseRoute(`intercepted.test/*=http://127.0.0.1:${upstreamPort}`)];
    const handlers = createWarpHandlers({ routes, ca });
    const proxy = createHttpServer(handlers.handleAbsoluteForm);
    proxy.on('connect', handlers.handleConnect);
    const proxyPort = await listen(proxy);

    // Positive control: the honest client is served through the route.
    const ok = await connectThrough(proxyPort, 'intercepted.test', 'intercepted.test', caPem);
    ok.write('GET /v1/x HTTP/1.1\r\nHost: intercepted.test\r\nConnection: close\r\n\r\n');
    const okReply = await readAll(ok);
    expect(okReply).toMatch(/^HTTP\/1\.1 200 /);
    expect(okReply).toContain('served intercepted.test /v1/x');

    // Host header for a different origin on a connection opened for intercepted.test.
    const hostDrift = await connectThrough(proxyPort, 'intercepted.test', 'intercepted.test', caPem);
    hostDrift.write('GET /v1/x HTTP/1.1\r\nHost: other.test\r\nConnection: close\r\n\r\n');
    const driftReply = await readAll(hostDrift);
    expect(driftReply).toMatch(/^HTTP\/1\.1 400 /);
    expect(driftReply).toContain('does not match CONNECT authority');

    // SNI for a different name: the leaf minted is for other.test, but the
    // request is still refused because the tunnel was opened for intercepted.test.
    const sniDrift = await connectThrough(proxyPort, 'intercepted.test', 'other.test', caPem);
    sniDrift.write('GET /v1/x HTTP/1.1\r\nHost: intercepted.test\r\nConnection: close\r\n\r\n');
    const sniReply = await readAll(sniDrift);
    expect(sniReply).toMatch(/^HTTP\/1\.1 400 /);
    expect(sniReply).toContain('does not match CONNECT host');
  });
});

// Small fs helpers kept local so the test reads top to bottom.
import { readdirSync, utimesSync } from 'node:fs';
function readdir(d: string): string[] {
  return readdirSync(d);
}
function utimes(p: string, when: Date): void {
  utimesSync(p, when, when);
}
