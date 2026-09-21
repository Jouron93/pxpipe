import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

describe.skipIf(process.platform !== 'win32')('Windows warp launch', () => {
  it('resolves a cmd shim without bash, preserves arguments and scopes proxy env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxpipe warp '));
    try {
      const probe = join(dir, 'probe.cjs');
      writeFileSync(probe, `console.log(JSON.stringify({args:process.argv.slice(2),base:process.env.ANTHROPIC_BASE_URL,proxy:process.env.HTTPS_PROXY}));process.exit(7);`);
      writeFileSync(join(dir, 'warp-probe.cmd'), `@echo off\r\n"${process.execPath}" "${probe}" %*\r\n`);
      const args = ['hello world', 'a&b', 'a"b', ''];
      const env = { ...process.env, SHELL: '/usr/bin/bash', ANTHROPIC_BASE_URL: 'https://example.invalid', HTTPS_PROXY: 'http://parent.invalid', USERPROFILE: dir };
      const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path')!;
      env[pathKey] = `${dir};${env[pathKey]}`;
      const source = pathToFileURL(resolve('src/warp/index.ts')).href;
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
        `import {createWarpRuntime} from ${JSON.stringify(source)};createWarpRuntime({port:47821}).launch(${JSON.stringify(['warp-probe', ...args])});`],
        { env, encoding: 'utf8', timeout: 20000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(7);
      const output = JSON.parse(result.stdout.trim());
      expect(output.args).toEqual(args);
      expect(output.base).toBeUndefined();
      expect(output.proxy).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(env.HTTPS_PROXY).toBe('http://parent.invalid');
      expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid');
      expect(result.stderr).not.toContain('interactive shell fallback');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
