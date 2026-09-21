/**
 * SSL_CERT_FILE / CURL_CA_BUNDLE / REQUESTS_CA_BUNDLE replace the trust store
 * rather than extend it. A warp CA file holding only our root made every
 * non-pxpipe HTTPS client in the child fail verification (#245). The bundle
 * handed to those variables must carry the system roots after our CA.
 *
 * Run just this file:  pnpm vitest run tests/warp-ca-bundle.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CertificateAuthority, findSystemRootBundle } from '../src/warp/ca.js';

const CERT_RE = /-----BEGIN CERTIFICATE-----/g;
const count = (pem: string): number => (pem.match(CERT_RE) ?? []).length;

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, existsSync: vi.fn(fs.existsSync) };
});

describe('warp CA bundle (#245)', () => {
  const dirs: string[] = [];
  const savedEnv = process.env.SSL_CERT_FILE;
  afterEach(() => {
    vi.mocked(existsSync).mockReset();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.SSL_CERT_FILE;
    else process.env.SSL_CERT_FILE = savedEnv;
  });
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'pxpipe-warp-ca-'));
    dirs.push(d);
    return d;
  };

  it('keeps warp-ca.pem CA-only and writes a separate bundle', () => {
    delete process.env.SSL_CERT_FILE;
    const ca = CertificateAuthority.loadOrCreate(tmp());
    expect(count(readFileSync(ca.certPath, 'utf8'))).toBe(1);
    expect(ca.bundlePath).not.toBe(ca.certPath);
    const bundle = readFileSync(ca.bundlePath, 'utf8');
    // Our CA comes first so a client that stops at the first match still trusts us.
    expect(bundle.startsWith(readFileSync(ca.certPath, 'utf8'))).toBe(true);
    if (ca.systemRootsPath) {
      expect(count(bundle)).toBeGreaterThan(1);
      expect(count(bundle)).toBe(1 + count(readFileSync(ca.systemRootsPath, 'utf8')));
    } else {
      expect(count(bundle)).toBe(1 + rootCertificates.length);
    }
  });

  it('prefers an operator-supplied SSL_CERT_FILE over the platform guess', () => {
    const d = tmp();
    const fake = join(d, 'corp-roots.pem');
    const ca0 = CertificateAuthority.loadOrCreate(tmp());
    const oneCert = readFileSync(ca0.certPath, 'utf8');
    writeFileSync(fake, oneCert + oneCert + oneCert);
    process.env.SSL_CERT_FILE = fake;
    expect(findSystemRootBundle()).toBe(fake);
    const ca = CertificateAuthority.loadOrCreate(d);
    expect(ca.systemRootsPath).toBe(fake);
    expect(count(readFileSync(ca.bundlePath, 'utf8'))).toBe(4);
  });

  it('does not nest its own bundle when SSL_CERT_FILE already points at it (warp restart)', () => {
    const d = tmp();
    delete process.env.SSL_CERT_FILE;
    const first = CertificateAuthority.loadOrCreate(d);
    const n = count(readFileSync(first.bundlePath, 'utf8'));
    process.env.SSL_CERT_FILE = first.bundlePath;
    const second = CertificateAuthority.loadOrCreate(d);
    expect(count(readFileSync(second.bundlePath, 'utf8'))).toBe(n);
  });

  it('falls back to Node public roots when no system bundle exists', () => {
    delete process.env.SSL_CERT_FILE;
    vi.mocked(existsSync).mockReturnValue(false);
    expect(findSystemRootBundle(['/nonexistent/a.pem', '/nonexistent/b.pem'])).toBeNull();
    const ca = CertificateAuthority.loadOrCreate(tmp());
    expect(ca.systemRootsPath).toBeNull();
    const cert = readFileSync(ca.certPath, 'utf8');
    const bundle = readFileSync(ca.bundlePath, 'utf8');
    expect(count(cert)).toBe(1);
    expect(count(bundle)).toBe(1 + rootCertificates.length);
    expect(bundle).toBe(cert + rootCertificates.join('\n') + '\n');
  });
});
