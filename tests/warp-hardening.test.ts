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
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateKey, X509Certificate } from 'node:crypto';

import { CertificateAuthority, writeFileAtomic, withDirectoryLock } from '../src/warp/ca.js';
import { createWarpHandlers, parseAuthority } from '../src/warp/connect.js';
import {
  childEnvironment,
  defaultRoutes,
  escapeCmdArg,
  findUnsafeCmdArgument,
  killProcessTree,
  reapWindowsOrphans,
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
    for (const k of ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'CODEX_BASE_URL', 'XAI_BASE_URL']) {
      expect(env[k], k).toBeUndefined();
    }
    expect(env.KEEP_ME).toBe('yes');
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:5');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/ca.pem');
    expect(env.SSL_CERT_FILE).toBe('/bundle.pem');
  });

  it('maps chatgpt.com/backend-api/codex without trailing slash and with query parameters, and rejects codex-other', () => {
    const routes = defaultRoutes(47821);
    const route = matchRoute(routes, 'chatgpt.com:443', '/backend-api/codex');
    expect(route).not.toBeNull();
    expect(rewriteUrl(route!, '/backend-api/codex')).toBe('http://127.0.0.1:47821/v1');
    expect(rewriteUrl(route!, '/backend-api/codex?client_version=1')).toBe(
      'http://127.0.0.1:47821/v1?client_version=1',
    );
    // Boundary check: /backend-api/codex-other must NOT match and rewrite to /v1-other
    expect(matchRoute(routes, 'chatgpt.com:443', '/backend-api/codex-other')).toBeNull();
  });

  it('removes provider base URLs case-insensitively and removes all case variations of NO_PROXY', () => {
    const env = childEnvironment(
      {
        PATH: 'x',
        openai_base_url: 'http://127.0.0.1:47822/v1',
        CODEX_BASE_URL: 'http://127.0.0.1:47822/v1',
        codex_api_base: 'http://127.0.0.1:47822/v1',
        OPENAI_BASE_PATH: '/v1',
        NO_PROXY: 'localhost,127.0.0.1,api.openai.com,chatgpt.com,internal.corp',
        no_proxy: '*,localhost',
        No_Proxy: '.com,googleapis.com',
        Keep_Me: 'ok',
      },
      'http://127.0.0.1:5',
      { certPath: '/ca.pem', bundlePath: '/bundle.pem' },
    );
    expect(env.openai_base_url).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.CODEX_BASE_URL).toBeUndefined();
    expect(env.codex_api_base).toBeUndefined();
    expect(env.OPENAI_BASE_PATH).toBeUndefined();
    expect(env.Keep_Me).toBe('ok');
    // All case variations of NO_PROXY removed to prevent bypasses
    expect(env.NO_PROXY).toBeUndefined();
    expect(env.no_proxy).toBeUndefined();
    expect(env.No_Proxy).toBeUndefined();
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

  it('finds node scripts in shims using forward slashes, parent paths, or unquoted %~dp0', () => {
    const d = tmp();
    mkdirSync(join(d, 'node_modules', 'tool', 'bin'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'tool', 'bin', 'cli.mjs'), '');
    writeFileSync(
      join(d, 'tool-slash.cmd'),
      '@echo off\r\n"%dp0%/node_modules/tool/bin/cli.mjs" %*\r\n',
    );
    expect(resolveShimTarget(join(d, 'tool-slash.cmd'))).toEqual({
      kind: 'node',
      script: join(d, 'node_modules', 'tool', 'bin', 'cli.mjs'),
    });

    writeFileSync(
      join(d, 'tool-unquoted.cmd'),
      '@echo off\r\nnode %~dp0\\node_modules\\tool\\bin\\cli.mjs %*\r\n',
    );
    expect(resolveShimTarget(join(d, 'tool-unquoted.cmd'))).toEqual({
      kind: 'node',
      script: join(d, 'node_modules', 'tool', 'bin', 'cli.mjs'),
    });

    // Parent directory traversal: %~dp0..\node_modules\...
    const sub = join(d, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, 'tool-parent.cmd'),
      '@echo off\r\n"%~dp0..\\node_modules\\tool\\bin\\cli.mjs" %*\r\n',
    );
    expect(resolveShimTarget(join(sub, 'tool-parent.cmd'))).toEqual({
      kind: 'node',
      script: join(d, 'node_modules', 'tool', 'bin', 'cli.mjs'),
    });

    // Shim without separator after %~dp0: "%~dp0node_modules\..."
    writeFileSync(
      join(d, 'tool-nosep.cmd'),
      '@echo off\r\n"%~dp0node_modules\\tool\\bin\\cli.mjs" %*\r\n',
    );
    expect(resolveShimTarget(join(d, 'tool-nosep.cmd'))).toEqual({
      kind: 'node',
      script: join(d, 'node_modules', 'tool', 'bin', 'cli.mjs'),
    });
  });

  it('names the argument cmd.exe would reinterpret', () => {
    expect(findUnsafeCmdArgument(['-p', 'plain prompt with spaces'])).toBeNull();
    expect(findUnsafeCmdArgument(['-p', 'run this & del *'])?.char).toBe('&');
    expect(findUnsafeCmdArgument(['-p', 'run this & del *'])?.index).toBe(1);
    expect(findUnsafeCmdArgument(['--x', '%USERPROFILE%'])?.char).toBe('%');
    expect(findUnsafeCmdArgument(['say "hi"'])?.char).toBe('"');
    expect(findUnsafeCmdArgument(['pipe | bad'])?.char).toBe('|');
    expect(findUnsafeCmdArgument(['redirect < in'])?.char).toBe('<');
    expect(findUnsafeCmdArgument(['redirect > out'])?.char).toBe('>');
    expect(findUnsafeCmdArgument(['caret ^ test'])?.char).toBe('^');
    expect(findUnsafeCmdArgument(['exclamation ! test'])?.char).toBe('!');
    expect(findUnsafeCmdArgument(['parenthesis (bad)'])?.char).toBe('(');
    expect(findUnsafeCmdArgument(['line1\r\nline2'])?.char).toBe('\r');
  });

  it('escapes arguments following Windows CommandLineToArgvW standards', () => {
    expect(escapeCmdArg('')).toBe('""');
    expect(escapeCmdArg('simple')).toBe('"simple"');
    expect(escapeCmdArg('with spaces')).toBe('"with spaces"');
    expect(escapeCmdArg('trailing\\')).toBe('"trailing\\\\"');
    expect(escapeCmdArg('trailing two\\\\')).toBe('"trailing two\\\\\\\\"');
    expect(escapeCmdArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(escapeCmdArg('back\\slash"quote\\')).toBe('"back\\slash\\"quote\\\\"');
  });
});

describe('P1-2: process tree cleanup on launcher exit and orphan reaping', () => {
  it('killProcessTree handles already-exited child process without throwing', () => {
    const fakeChild = { pid: 9999999, kill: () => true } as unknown as import('node:child_process').ChildProcess;
    expect(() => killProcessTree(fakeChild)).not.toThrow();
  });

  it('reapWindowsOrphans runs cleanly without throwing', () => {
    expect(() => reapWindowsOrphans(9999999)).not.toThrow();
  });

  it.skipIf(process.platform !== 'win32')(
    'reapWindowsOrphans kills a tracked intermediate that is passed as an extra seed',
    async () => {
      // A known live descendant with no children of its own: before round 3 the seed loop
      // only expanded seeds, so this process was never put on the kill list.
      const child = spawn('ping.exe', ['-n', '30', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
      await new Promise((r) => setTimeout(r, 300));
      expect(child.exitCode).toBeNull();
      reapWindowsOrphans(9999999, [child.pid!]);
      await new Promise<void>((r) => {
        if (child.exitCode !== null) return r();
        child.once('exit', () => r());
        setTimeout(r, 4000);
      });
      expect(child.exitCode).not.toBeNull();
    },
  );

  it('reapWindowsOrphans handles invalid or non-existent pid gracefully', () => {
    expect(() => reapWindowsOrphans(0)).not.toThrow();
    expect(() => reapWindowsOrphans(-1)).not.toThrow();
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

  it('writeFileAtomic succeeds when destination file already contains identical content', () => {
    const d = tmp();
    const target = join(d, 'atomic.txt');
    writeFileSync(target, 'same content');
    writeFileAtomic(target, 'same content', 0o644);
    expect(readFileSync(target, 'utf8')).toBe('same content');
  });

  it('a cert whose key on disk belongs to another CA is replaced, not loaded', () => {
    const a = tmp();
    const b = tmp();
    const caA = CertificateAuthority.loadOrCreate(a);
    const originalCertA = readFileSync(caA.certPath, 'utf8');
    CertificateAuthority.loadOrCreate(b);
    // Interleave: A's cert with B's key — what two racing writers produced before.
    writeFileSync(join(a, 'warp-ca-key.pem'), readFileSync(join(b, 'warp-ca-key.pem')));
    const reloaded = CertificateAuthority.loadOrCreate(a);
    const cert = new X509Certificate(readFileSync(reloaded.certPath, 'utf8'));
    const key = createPrivateKey(readFileSync(join(a, 'warp-ca-key.pem'), 'utf8'));
    expect(cert.checkPrivateKey(key)).toBe(true);
    expect(readFileSync(reloaded.certPath, 'utf8')).not.toBe(originalCertA);
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

  it('stale lock with dead PID in owner.json is reclaimed and released safely', () => {
    const d = tmp();
    const lock = join(d, 'lock');
    mkdirSync(lock);
    writeFileSync(
      join(lock, 'owner.json'),
      JSON.stringify({ pid: 9999999, uuid: 'dead-uuid', createdAt: Date.now() - 10_000 }),
    );
    expect(withDirectoryLock(lock, () => 'reclaimed', 30_000, 500)).toBe('reclaimed');
    expect(readdir(d)).not.toContain('lock');
  });

  it('owner verification in finally prevents deleting a lock owned by another process', () => {
    const d = tmp();
    const lock = join(d, 'lock');
    let ran = false;
    withDirectoryLock(lock, () => {
      // Overwrite owner.json with a foreign uuid as if taken over by another process
      writeFileSync(
        join(lock, 'owner.json'),
        JSON.stringify({ pid: process.pid, uuid: 'foreign-uuid', createdAt: Date.now() }),
      );
      ran = true;
    });
    expect(ran).toBe(true);
    // Because owner uuid did not match, finally block safely preserved the lock directory!
    expect(readdir(d)).toContain('lock');
  });

  it('writeBundle avoids re-writing bundle when disk content already matches', () => {
    const d = tmp();
    const ca = CertificateAuthority.loadOrCreate(d);
    const bundlePath = ca.bundlePath;
    const initialMtime = statSync(bundlePath).mtimeMs;
    // Calling loadOrCreate again should find the existing CA and bundle without modifying mtime
    const ca2 = CertificateAuthority.loadOrCreate(d);
    expect(ca2.certPath).toBe(ca.certPath);
    expect(statSync(bundlePath).mtimeMs).toBe(initialMtime);
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

  it('isolates authorities across multiple concurrent CONNECT tunnels', async () => {
    const upstream1 = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`served-1 ${req.headers.host}`);
    });
    const upstream2 = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`served-2 ${req.headers.host}`);
    });
    const port1 = await listen(upstream1);
    const port2 = await listen(upstream2);

    const dir = tmp();
    const ca = CertificateAuthority.loadOrCreate(dir);
    const caPem = readFileSync(ca.certPath, 'utf8');
    const routes = [
      parseRoute(`host1.test/*=http://127.0.0.1:${port1}`),
      parseRoute(`host2.test/*=http://127.0.0.1:${port2}`),
    ];
    const handlers = createWarpHandlers({ routes, ca });
    const proxy = createHttpServer(handlers.handleAbsoluteForm);
    proxy.on('connect', handlers.handleConnect);
    const proxyPort = await listen(proxy);

    // Open two concurrent tunnels to different destinations
    const t1 = await connectThrough(proxyPort, 'host1.test', 'host1.test', caPem);
    const t2 = await connectThrough(proxyPort, 'host2.test', 'host2.test', caPem);

    t1.write('GET /a HTTP/1.1\r\nHost: host1.test\r\nConnection: close\r\n\r\n');
    t2.write('GET /b HTTP/1.1\r\nHost: host2.test\r\nConnection: close\r\n\r\n');

    const [reply1, reply2] = await Promise.all([readAll(t1), readAll(t2)]);
    expect(reply1).toContain('served-1 host1.test');
    expect(reply2).toContain('served-2 host2.test');
  });
});

describe('P2-13: refusal diagnostics redact argument contents from stderr', () => {
  it('logs argument index and metacharacter without printing secret argument text', () => {
    const secretArg = 'sk-ant-api03-SECRET_TOKEN_VALUE_1234567890!bad';
    const unsafe = findUnsafeCmdArgument(['run', secretArg]);
    expect(unsafe).not.toBeNull();
    expect(unsafe?.char).toBe('!');
    expect(unsafe?.index).toBe(1);
    // Refusal diagnostic formats index and char only
    const logged = `argument at index ${unsafe?.index} contains forbidden shell metacharacter (${JSON.stringify(unsafe?.char)})`;
    expect(logged).toContain('index 1');
    expect(logged).toContain('"!"');
    expect(logged).not.toContain('SECRET_TOKEN_VALUE');
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

describe('P1-1 round 3: a shim is recognised as a whole template, not by substring', () => {
  it('refuses a shim that carries any command besides the template lines', () => {
    const d = tmp();
    mkdirSync(join(d, 'node_modules', 'tool', 'bin'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'tool', 'bin', 'cli.js'), '');
    writeFileSync(
      join(d, 'extra.cmd'),
      '@echo off\r\ndel /q "%USERPROFILE%\\secrets"\r\n"%dp0%\\node_modules\\tool\\bin\\cli.js" %*\r\n',
    );
    expect(resolveShimTarget(join(d, 'extra.cmd'))).toBeNull();
    writeFileSync(
      join(d, 'redirect.cmd'),
      '@echo off\r\n"%dp0%\\node_modules\\tool\\bin\\cli.js" %* > "%TEMP%\\out.txt"\r\n',
    );
    expect(resolveShimTarget(join(d, 'redirect.cmd'))).toBeNull();
    writeFileSync(
      join(d, 'twice.cmd'),
      '@echo off\r\n"%dp0%\\node_modules\\tool\\bin\\cli.js" %*\r\n"%dp0%\\node_modules\\tool\\bin\\cli.js" %*\r\n',
    );
    expect(resolveShimTarget(join(d, 'twice.cmd'))).toBeNull();
  });

  it('refuses a %* that is not the invocation and a flag smuggled before the script', () => {
    const d = tmp();
    mkdirSync(join(d, 'node_modules', 'tool', 'bin'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'tool', 'bin', 'cli.js'), '');
    writeFileSync(join(d, 'echo.cmd'), '@echo off\r\necho %*\r\n');
    expect(resolveShimTarget(join(d, 'echo.cmd'))).toBeNull();
    writeFileSync(
      join(d, 'flag.cmd'),
      '@echo off\r\nnode --require "%dp0%\\evil.js" "%dp0%\\node_modules\\tool\\bin\\cli.js" %*\r\n',
    );
    expect(resolveShimTarget(join(d, 'flag.cmd'))).toBeNull();
  });

  it('still accepts the full npm cmd-shim template including the PATHEXT branch', () => {
    const d = tmp();
    mkdirSync(join(d, 'node_modules', 'tool', 'bin'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'tool', 'bin', 'cli.js'), '');
    writeFileSync(
      join(d, 'tool.cmd'),
      '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\bin\\cli.js" %*\r\n',
    );
    expect(resolveShimTarget(join(d, 'tool.cmd'))).toEqual({
      kind: 'node',
      script: join(d, 'node_modules', 'tool', 'bin', 'cli.js'),
    });
  });
});
