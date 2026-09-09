/**
 * `pxpipe warp -- <agent-command>`
 *
 * Runs the agent behind a CONNECT proxy that decrypts api.anthropic.com and
 * re-points only /v1/messages at the local pxpipe proxy. The agent never sees a
 * custom ANTHROPIC_BASE_URL, so the client-side "firstParty" checks that hide
 * /remote-control (and disable claude.ai connectors) still pass, while pxpipe
 * gets the one path it transforms.
 *
 * Compare the manual equivalent, which needs two extra tools and a CA trusted
 * process-wide:
 *
 *   mitmdump --map-remote '|^https://api\.anthropic\.com/v1/messages|http://127.0.0.1:47821/v1/messages'
 *   HTTPS_PROXY=http://127.0.0.1:8080 NODE_EXTRA_CA_CERTS=~/.mitmproxy/mitmproxy-ca-cert.pem claude
 */

import { execSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { CertificateAuthority } from './ca.js';
import { createWarpHandlers } from './connect.js';
import { parseRoute, routeDestination, type Route } from './route.js';

export interface WarpRuntimeOptions {
  /** Port the pxpipe proxy is already serving on: where matches are sent. */
  port: number;
  /**
   * Extra PATTERN=TARGET rules, in priority order ahead of the default
   * Anthropic rule. Agents that reach their provider over a base URL rather
   * than api.anthropic.com (codex, opencode) need one rule each.
   */
  routes?: readonly string[];
}

export interface WarpRuntime {
  /** Bind the child's proxy port, then spawn the child. */
  launch: (command: string[]) => void;
}

const isWindows = process.platform === 'win32';

/**
 * Only the inference path is diverted. Everything else on the host — OAuth,
 * telemetry, the control plane — is re-originated untouched, which is what
 * keeps the agent's client-side gates satisfied.
 */
function defaultRoutes(port: number): Route[] {
  return [
    parseRoute(`api.anthropic.com/v1/messages*=http://127.0.0.1:${port}`),
    parseRoute(`api.openai.com/v1/responses*=http://127.0.0.1:${port}`),
    parseRoute(`api.openai.com/v1/chat/completions*=http://127.0.0.1:${port}`),
    parseRoute(`api.x.ai/v1/chat/completions*=http://127.0.0.1:${port}`),
    parseRoute(`api.x.ai/v1/responses*=http://127.0.0.1:${port}`),
    parseRoute(`daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent*=http://127.0.0.1:${port}`),
    parseRoute(`daily-cloudcode-pa.googleapis.com/v1internal:generateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1beta/models/*:streamGenerateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1beta/models/*:generateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1/models/*:streamGenerateContent*=http://127.0.0.1:${port}`),
    parseRoute(`generativelanguage.googleapis.com/v1/models/*:generateContent*=http://127.0.0.1:${port}`),
  ];
}

/** Resolves an executable on PATH across platforms, respecting Windows PATHEXT and script extensions. */
export function resolveExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
): { path: string; isShellScript: boolean } | null {
  const isExplicitPath = name.includes('/') || (isWindows && (name.includes('\\') || name.includes(':')));
  const hasExt = isWindows && (name.includes('.') && !name.endsWith('.'));
  const pathext = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.WSF;.WSH').split(';').map((e) => e.toLowerCase());
  const extensions = isWindows
    ? (hasExt ? ['', ...pathext] : [...pathext, ''])
    : [''];

  if (isExplicitPath) {
    if (existsSync(name)) {
      const lower = name.toLowerCase();
      return { path: name, isShellScript: isWindows && (lower.endsWith('.cmd') || lower.endsWith('.bat')) };
    }
    if (isWindows) {
      for (const ext of extensions) {
        const withExt = name + ext;
        if (existsSync(withExt)) {
          return { path: withExt, isShellScript: ext === '.cmd' || ext === '.bat' };
        }
      }
    }
    return null;
  }

  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      try {
        if (existsSync(candidate)) {
          if (!isWindows) {
            accessSync(candidate, constants.X_OK);
          }
          const lower = candidate.toLowerCase();
          return {
            path: candidate,
            isShellScript: isWindows && (lower.endsWith('.cmd') || lower.endsWith('.bat')),
          };
        }
      } catch {
        /* try next candidate */
      }
    }
  }
  return null;
}

/** Reaps a process and its entire child tree on Windows / POSIX. */
function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (isWindows) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* process may already have terminated */
    }
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

export function createWarpRuntime(options: WarpRuntimeOptions): WarpRuntime {
  const { port } = options;
  const routes = [
    ...(options.routes ?? []).map((spec) => parseRoute(spec)),
    ...defaultRoutes(port),
  ];
  const ca = CertificateAuthority.loadOrCreate(join(homedir(), '.pxpipe'));

  const handlers = createWarpHandlers({
    routes,
    ca,
    onDivert: (host, path, target) => {
      if (!process.stdout.isTTY) console.error(`[pxpipe] warp: ${host}${path} → ${target}`);
    },
  });

  const proxy = createServer(handlers.handleAbsoluteForm);
  proxy.on('connect', handlers.handleConnect);

  const shellAliasTarget = (name: string, shell: string, env: NodeJS.ProcessEnv): string | null => {
    if (name.includes('/') || (isWindows && name.includes('\\'))) return null;
    const probe = spawnSync(shell, ['-ic', `type -- ${name}`], { encoding: 'utf8', env });
    const match = /\bis (?:an alias for|aliased to)\s+(.+)$/m.exec(probe.stdout ?? '');
    if (!match) return null;
    return match[1]?.trim() ?? null;
  };

  const shellQuote = (arg: string): string =>
    isWindows ? `"${arg.replaceAll('"', '""')}"` : `'${arg.replaceAll("'", `'\\''`)}'`;

  const spawnResolved = (command: string[], env: NodeJS.ProcessEnv): ChildProcess => {
    const direct = { stdio: 'inherit', env } as const;
    const resolved = resolveExecutable(command[0]!, env);

    if (resolved) {
      if (resolved.isShellScript) {
        return spawn(resolved.path, command.slice(1), { ...direct, shell: true });
      }
      return spawn(resolved.path, command.slice(1), direct);
    }

    if (isWindows) {
      const comspec = env.COMSPEC || 'cmd.exe';
      console.error(`[pxpipe] warp: resolving ${command[0]} via Windows command shell fallback`);
      return spawn(comspec, ['/d', '/s', '/c', ...command], direct);
    }

    const shell = env.SHELL || '/bin/sh';
    const alias = shellAliasTarget(command[0]!, shell, env);
    const aliasWord = alias?.split(/\s+/)[0] ?? '';
    const aliasUsable = alias !== null && (aliasWord.includes('=') || resolveExecutable(aliasWord, env) !== null);
    if (alias !== null && !aliasUsable) {
      console.error(`[pxpipe] warp: ignoring stale alias ${command[0]} → ${aliasWord} (not executable)`);
    }

    console.error(`[pxpipe] warp: resolving ${command[0]} via interactive shell fallback`);
    const script = [command[0]!, ...command.slice(1).map(shellQuote)].join(' ');
    return spawn(shell, ['-ic', script], direct);
  };

  const spawnChild = (command: string[], proxyUrl: string): void => {
    const env = { ...process.env };
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_UNIX_SOCKET;
    env.HTTP_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.https_proxy = proxyUrl;
    env.NODE_EXTRA_CA_CERTS = ca.certPath;
    env.SSL_CERT_FILE = ca.bundlePath;
    env.CURL_CA_BUNDLE = ca.bundlePath;
    env.REQUESTS_CA_BUNDLE = ca.bundlePath;

    const child = spawnResolved(command, env);
    let childLive = true;
    child.on('exit', () => {
      childLive = false;
    });

    process.on('exit', () => {
      if (childLive) killProcessTree(child);
    });

    const NET_ERRNO = new Set([
      'ECONNRESET',
      'ECONNREFUSED',
      'ECONNABORTED',
      'EPIPE',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ENETDOWN',
      'ENOTCONN',
      'EAI_AGAIN',
      'ERR_STREAM_DESTROYED',
      'ERR_STREAM_WRITE_AFTER_END',
      'ERR_SOCKET_CONNECTION_TIMEOUT',
    ]);
    const die = (err: unknown): void => {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (typeof code === 'string' && NET_ERRNO.has(code)) {
        console.error(`[pxpipe] warp: connection error ${code} (continuing)`);
        return;
      }
      console.error(`[pxpipe] warp: ${err instanceof Error ? err.stack : String(err)}`);
      process.exit(1);
    };
    process.on('uncaughtException', die);
    process.on('unhandledRejection', die);
    child.on('error', (err) => {
      console.error(`[pxpipe] warp: cannot run ${command[0]}: ${err.message}`);
      process.exit(127);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        if (!isWindows) {
          const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;
          for (const s of forwarded) process.removeAllListeners(s);
          try {
            process.kill(process.pid, signal);
          } catch {
            /* ignore */
          }
        }
        process.exit(128 + (code ?? 0));
        return;
      }
      process.exit(code ?? 0);
    });

    if (isWindows) {
      process.on('SIGINT', () => killProcessTree(child));
      process.on('SIGBREAK', () => killProcessTree(child));
    } else {
      const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;
      for (const signal of forwarded) {
        process.on(signal, () => killProcessTree(child));
      }
    }
  };

  const launch = (command: string[]): void => {
    if (command.length === 0) {
      console.error('[pxpipe] warp: nothing to run — usage: pxpipe warp -- <command> [args...]');
      process.exit(2);
    }
    for (const route of routes) {
      console.error(`[pxpipe] warp route → ${route.pattern} → ${routeDestination(route)}`);
    }
    console.error(`[pxpipe] warp CA → ${ca.certPath}`);
    if (ca.systemRootsPath) {
      console.error(`[pxpipe] warp CA bundle → ${ca.bundlePath} (+ system roots from ${ca.systemRootsPath})`);
    } else {
      console.error(
        `[pxpipe] warp CA bundle → ${ca.bundlePath} (no system root bundle found; ` +
          `non-pxpipe HTTPS in the child may fail verification — set SSL_CERT_FILE to your OS bundle before warp)`,
      );
    }
    console.error(`[pxpipe] warp exec → ${command.join(' ')}`);

    proxy.on('error', (err) => {
      console.error(`[pxpipe] warp: proxy listener failed: ${err.message}`);
      process.exit(1);
    });
    proxy.listen(0, '127.0.0.1', () => {
      const address = proxy.address();
      const proxyUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      console.error(`[pxpipe] warp proxy → ${proxyUrl} (child only)`);
      spawnChild(command, proxyUrl);
    });
  };

  return { launch };
}
