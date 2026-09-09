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

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve as resolvePath } from 'node:path';

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
export function defaultRoutes(port: number): Route[] {
  return [
    parseRoute(`api.anthropic.com/v1/messages*=http://127.0.0.1:${port}`),
    parseRoute(`api.openai.com/v1/responses*=http://127.0.0.1:${port}`),
    parseRoute(`api.openai.com/v1/chat/completions*=http://127.0.0.1:${port}`),
    // codex on a ChatGPT login never touches api.openai.com: it speaks to the
    // codex backend on chatgpt.com, where pxpipe serves the same requests under
    // /v1 (OPENAI_UPSTREAM=https://chatgpt.com/backend-api/codex strips the /v1
    // again on the way out). Without this rule that client tunnelled straight
    // past warp as raw TCP and nothing was imaged.
    parseRoute(`chatgpt.com/backend-api/codex/*=http://127.0.0.1:${port}/v1/*`),
    parseRoute(`chatgpt.com/backend-api/codex*=http://127.0.0.1:${port}/v1/*`),
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

/**
 * What an npm-style Windows shim ultimately runs. `claude.cmd` ends in
 * `"%dp0%\node_modules\...\bin\claude.exe" %*` and `codex.cmd` in
 * `"%_prog%" "%dp0%\node_modules\...\bin\codex.js" %*`. Running that target
 * directly, with `shell: false`, keeps every argument intact: handed to
 * cmd.exe via the shim, `&`, `|`, `<`, `>`, `^`, `%VAR%` and `!` inside a prompt
 * are re-parsed as shell syntax.
 */
export function resolveShimTarget(
  shimPath: string,
): { kind: 'node'; script: string } | { kind: 'exe'; path: string } | null {
  let text: string;
  try {
    text = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  const dp0 = dirname(shimPath);
  const found: Array<{ kind: 'node'; script: string } | { kind: 'exe'; path: string }> = [];
  // Match both quoted and unquoted %dp0% or %~dp0 targets with optional leading slash,
  // including relative parent paths (%~dp0..\...) and shims where %~dp0 already has a trailing backslash.
  const re = /(?:"(?:%~dp0%?|%dp0%)[\\/]?([^"]+?\.(js|mjs|cjs|exe))"|(?:%~dp0%?|%dp0%)[\\/]?([^\s\r\n]+?\.(js|mjs|cjs|exe)))/gi;
  for (const m of text.matchAll(re)) {
    const rawRel = m[1] ?? m[3];
    if (!rawRel) continue;
    const cleanRel = rawRel.replace(/^[\\/]+/, '');
    const full = resolvePath(dp0, cleanRel);
    if (!existsSync(full)) continue;
    const ext = (m[2] ?? m[4] ?? '').toLowerCase();
    found.push(ext === 'exe' ? { kind: 'exe', path: full } : { kind: 'node', script: full });
  }
  return found.length > 0 ? found[found.length - 1]! : null;
}

/**
 * Characters cmd.exe interprets even inside double quotes, or that break the
 * quoting itself. An argument carrying one cannot be passed through a batch
 * file safely, so warp refuses rather than let a prompt become shell syntax.
 * Includes () compound command delimiters in addition to shell operators and variables.
 */
const CMD_METACHARACTERS = /[&|<>^%!"\r\n()]/;

export function findUnsafeCmdArgument(args: readonly string[]): string | null {
  for (const arg of args) if (CMD_METACHARACTERS.test(arg)) return arg;
  return null;
}

/**
 * Escapes an argument using Windows CommandLineToArgvW standards:
 * - Empty string becomes '""'
 * - Double quotes are escaped with backslash '\"'
 * - Backslashes immediately preceding a quote are doubled
 * - Trailing backslashes before closing quote are doubled so the quote is not escaped
 */
export function escapeCmdArg(a: string): string {
  if (a.length === 0) return '""';
  return `"${a.replace(/(\\*)(")/g, '$1$1\\$2').replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * Descendants of a Windows process keep its PID as their ParentProcessId after
 * it exits, so they stay enumerable even though `taskkill /T` on the dead PID
 * can no longer walk to them. A breadth-first search sweeps all generations
 * (children, grandchildren) of the process tree with cycle-protection.
 */
export function reapWindowsOrphans(parentPid: number): void {
  if (!parentPid || parentPid <= 0) return;
  const script =
    `$procs = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId; ` +
    `$queue = [System.Collections.Generic.Queue[int]]::new(); ` +
    `$queue.Enqueue(${parentPid}); ` +
    `$visited = [System.Collections.Generic.HashSet[int]]::new(); ` +
    `$null = $visited.Add(${parentPid}); ` +
    `$toKill = [System.Collections.Generic.List[int]]::new(); ` +
    `while ($queue.Count -gt 0) { ` +
      `$cur = $queue.Dequeue(); ` +
      `foreach ($p in $procs) { ` +
        `if ($p.ParentProcessId -eq $cur -and $visited.Add($p.ProcessId)) { ` +
          `$toKill.Add($p.ProcessId); ` +
          `$queue.Enqueue($p.ProcessId); ` +
        `} ` +
      `} ` +
    `} ` +
    `$tk = if (Test-Path "$env:SystemRoot\\System32\\taskkill.exe") { "$env:SystemRoot\\System32\\taskkill.exe" } else { "taskkill.exe" }; ` +
    `foreach ($id in $toKill) { ` +
      `try { & $tk /pid $id /T /F } catch {} ` +
      `try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {} ` +
    `}`;
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const systemPowerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  for (const shell of ['pwsh.exe', systemPowerShell, 'powershell.exe']) {
    const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    });
    if (!r.error) return;
  }
}

/** Reaps a process and its entire child tree on Windows / POSIX. */
export function killProcessTree(child: ChildProcess): void {
  if (!child.pid || child.pid <= 0) return;
  if (isWindows) {
    const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const taskkillExe = join(systemRoot, 'System32', 'taskkill.exe');
    const exe = existsSync(taskkillExe) ? taskkillExe : 'taskkill';
    spawnSync(exe, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    reapWindowsOrphans(child.pid);
  } else {
    try {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * The environment the child runs in. Every provider base URL is removed so the
 * agent talks to its first-party host and warp does the diversion; an
 * inherited OPENAI_BASE_URL pointing at a retired shim port would otherwise
 * send codex somewhere warp never sees. Exported so a test can pin the list.
 */
export function childEnvironment(
  base: NodeJS.ProcessEnv,
  proxyUrl: string,
  ca: { certPath: string; bundlePath: string },
): NodeJS.ProcessEnv {
  const env = { ...base };
  const stripped = new Set([
    'anthropic_base_url',
    'anthropic_unix_socket',
    'openai_base_url',
    'openai_api_base',
    'openai_base_path',
    'codex_base_url',
    'codex_api_base',
    'xai_base_url',
  ]);
  for (const key of Object.keys(env)) {
    if (stripped.has(key.toLowerCase())) {
      delete env[key];
    }
  }
  // Sanitize NO_PROXY / no_proxy: prevent proxy bypass for intercepted AI hosts
  for (const key of ['no_proxy', 'NO_PROXY']) {
    if (env[key]) {
      const val = env[key]!;
      if (val.trim() === '*' || /chatgpt\.com|anthropic\.com|openai\.com|x\.ai/i.test(val)) {
        const filtered = val
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== '*' && !/chatgpt\.com|anthropic\.com|openai\.com|x\.ai/i.test(s))
          .join(',');
        if (filtered) {
          env[key] = filtered;
        } else {
          delete env[key];
        }
      }
    }
  }
  env.HTTP_PROXY = proxyUrl;
  env.http_proxy = proxyUrl;
  env.HTTPS_PROXY = proxyUrl;
  env.https_proxy = proxyUrl;
  env.NODE_EXTRA_CA_CERTS = ca.certPath;
  env.SSL_CERT_FILE = ca.bundlePath;
  env.CURL_CA_BUNDLE = ca.bundlePath;
  env.REQUESTS_CA_BUNDLE = ca.bundlePath;
  return env;
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
    isWindows ? escapeCmdArg(arg) : `'${arg.replaceAll("'", `'\\''`)}'`;

  /**
   * Last resort on Windows: a batch file with no recognisable program inside, or
   * a command that is not on PATH at all. cmd.exe gets ONE pre-quoted command
   * line (windowsVerbatimArguments) instead of the space-joined, unquoted line
   * `shell: true` would build. Arguments that cmd.exe would still interpret are
   * refused unless PXPIPE_WARP_ALLOW_SHELL_ARGS=1 says the caller accepts that.
   */
  const spawnThroughCmd = (
    program: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    direct: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
  ): ChildProcess => {
    const unsafe = findUnsafeCmdArgument([program, ...args]);
    if (unsafe !== null && env.PXPIPE_WARP_ALLOW_SHELL_ARGS !== '1') {
      console.error(
        `[pxpipe] warp: refusing to run ${program} through cmd.exe: an argument contains ` +
          `shell metacharacters (${JSON.stringify(unsafe.slice(0, 40))}). Run the program's ` +
          `.exe/.js directly, or set PXPIPE_WARP_ALLOW_SHELL_ARGS=1 to accept cmd.exe parsing it.`,
      );
      process.exit(2);
    }
    const comspec = env.COMSPEC || 'cmd.exe';
    const line = [program, ...args].map(escapeCmdArg).join(' ');
    return spawn(comspec, ['/d', '/s', '/c', `"${line}"`], {
      ...direct,
      windowsVerbatimArguments: true,
    });
  };

  const spawnResolved = (command: string[], env: NodeJS.ProcessEnv): ChildProcess => {
    const direct = { stdio: 'inherit', env } as const;
    const resolved = resolveExecutable(command[0]!, env);

    const args = command.slice(1);

    if (resolved) {
      if (!resolved.isShellScript) return spawn(resolved.path, args, direct);

      // A .cmd/.bat can only be run by cmd.exe. Prefer the program the shim
      // wraps and run it without any shell at all.
      const target = resolveShimTarget(resolved.path);
      if (target?.kind === 'node') {
        return spawn(process.execPath, [target.script, ...args], direct);
      }
      if (target?.kind === 'exe') {
        return spawn(target.path, args, direct);
      }
      return spawnThroughCmd(resolved.path, args, env, direct);
    }

    if (isWindows) {
      console.error(`[pxpipe] warp: resolving ${command[0]} via Windows command shell fallback`);
      return spawnThroughCmd(command[0]!, args, env, direct);
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
    const env = childEnvironment(process.env, proxyUrl, ca);

    const child = spawnResolved(command, env);
    let reaped = false;
    const cleanupTree = () => {
      if (reaped) return;
      reaped = true;
      killProcessTree(child);
    };

    child.on('exit', () => {
      // The wrapper is gone; anything it left behind is an orphan of a dead
      // PID, and the proxy port it was handed dies with this process.
      cleanupTree();
    });

    process.on('exit', () => {
      // Unconditionally terminate the full process tree idempotently.
      cleanupTree();
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
      process.on('SIGINT', cleanupTree);
      process.on('SIGBREAK', cleanupTree);
    } else {
      const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;
      for (const signal of forwarded) {
        process.on(signal, cleanupTree);
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
    // Arguments are prompts and flags, which may carry tokens; stderr is
    // captured by CI and service logs. Only the program is logged by default.
    if (process.env.PXPIPE_WARP_DEBUG === '1') {
      console.error(`[pxpipe] warp exec → ${command.join(' ')}`);
    } else {
      console.error(
        `[pxpipe] warp exec → ${command[0]} (+${command.length - 1} argument(s); PXPIPE_WARP_DEBUG=1 to log them)`,
      );
    }

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
