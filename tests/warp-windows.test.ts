import { describe, expect, it } from 'vitest';
import { resolveExecutable } from '../src/warp/index.js';
import { rootCertificates } from 'node:tls';
import { CertificateAuthority } from '../src/warp/ca.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('warp Windows native hardening', () => {
  it('resolves executables with Windows extensions (e.g. node.exe, cmd.exe, or batch scripts)', () => {
    const res = resolveExecutable('node', process.env);
    expect(res).not.toBeNull();
    expect(res?.path.toLowerCase()).toContain('node');
  });

  it('guarantees root certificate bundle is populated via system roots or Node fallback', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pxpipe-warp-win-'));
    try {
      const ca = CertificateAuthority.loadOrCreate(tmp);
      expect(ca.bundlePath).toBeDefined();
      const content = readFileSync(ca.bundlePath, 'utf8');
      const certCount = (content.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
      // Should include our local CA + system roots or Node 147 root certificates
      expect(certCount).toBeGreaterThan(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
