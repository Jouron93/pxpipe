import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { rootCertificates } from 'node:tls';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

describe.skipIf(process.platform !== 'win32')('Windows warp launch', () => {
  it('resolves a cmd shim without bash, preserves arguments and scopes proxy env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxpipe warp '));
    try {
      const probe = join(dir, 'probe.cjs');
      writeFileSync(probe, `
        const fs = require('node:fs');
        const cert = fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8');
        const bundle = fs.readFileSync(process.env.SSL_CERT_FILE, 'utf8');
        const count = pem => pem.split('-----BEGIN CERTIFICATE-----').length - 1;
        console.log(JSON.stringify({args:process.argv.slice(2),base:process.env.ANTHROPIC_BASE_URL,
          proxy:process.env.HTTPS_PROXY,extraCa:process.env.NODE_EXTRA_CA_CERTS,
          sslCert:process.env.SSL_CERT_FILE,curlCa:process.env.CURL_CA_BUNDLE,
          requestsCa:process.env.REQUESTS_CA_BUNDLE,certCount:count(cert),bundleCount:count(bundle),
          bundleStartsWithCa:bundle.startsWith(cert),
          bundleHasParentRoot:bundle.includes(require('node:tls').rootCertificates[0])}));
        process.exit(7);
      `);
      writeFileSync(join(dir, 'warp-probe.cmd'), `@echo off\r\n"${process.execPath}" "${probe}" %*\r\n`);
      const args = ['hello world', 'a&b', 'a"b', ''];
      const parentCa = join(dir, 'parent-roots.pem');
      writeFileSync(parentCa, rootCertificates[0] + '\n');
      const env = { ...process.env, SHELL: '/usr/bin/bash', ANTHROPIC_BASE_URL: 'https://example.invalid', HTTPS_PROXY: 'http://parent.invalid', USERPROFILE: dir,
        NODE_EXTRA_CA_CERTS: parentCa, SSL_CERT_FILE: parentCa, CURL_CA_BUNDLE: parentCa, REQUESTS_CA_BUNDLE: parentCa };
      const scopedKeys = ['HTTPS_PROXY', 'ANTHROPIC_BASE_URL', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE'];
      const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path')!;
      env[pathKey] = `${dir};${env[pathKey]}`;
      const source = pathToFileURL(resolve('src/warp/index.ts')).href;
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
        `import {createWarpRuntime} from ${JSON.stringify(source)};
          process.on('exit', () => console.error('PARENT_ENV=' + JSON.stringify(Object.fromEntries(${JSON.stringify(scopedKeys)}.map(k => [k, process.env[k]])))));
          createWarpRuntime({port:47821}).launch(${JSON.stringify(['warp-probe', ...args])});`],
        { env, encoding: 'utf8', timeout: 20000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(7);
      const output = JSON.parse(result.stdout.trim());
      expect(output.args).toEqual(args);
      expect(output.base).toBeUndefined();
      expect(output.proxy).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(isAbsolute(output.extraCa)).toBe(true);
      expect(isAbsolute(output.sslCert)).toBe(true);
      expect(output.extraCa).toMatch(/[\\/]warp-ca\.pem$/);
      expect(output.sslCert).toMatch(/[\\/]warp-ca-bundle\.pem$/);
      expect(output.extraCa).not.toBe(output.sslCert);
      expect(output.curlCa).toBe(output.sslCert);
      expect(output.requestsCa).toBe(output.sslCert);
      expect(output.certCount).toBe(1);
      expect(output.bundleCount).toBe(2);
      expect(output.bundleStartsWithCa).toBe(true);
      expect(output.bundleHasParentRoot).toBe(true);
      const parentLine = result.stderr.split(/\r?\n/).find(line => line.startsWith('PARENT_ENV='));
      expect(parentLine).toBeDefined();
      expect(JSON.parse(parentLine!.slice('PARENT_ENV='.length))).toEqual(
        Object.fromEntries(scopedKeys.map(key => [key, env[key]])),
      );
      expect(env.HTTPS_PROXY).toBe('http://parent.invalid');
      expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid');
      expect(result.stderr).not.toContain('interactive shell fallback');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
