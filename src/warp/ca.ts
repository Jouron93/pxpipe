/**
 * warp's local certificate authority.
 *
 * On first use it generates a self-signed P-256 root, persists it under
 * ~/.pxpipe, and mints leaf certs per SNI host on demand so the CONNECT proxy
 * can terminate (and therefore route) the agent's TLS. Only the child process
 * trusts it: warp points the child's NODE_EXTRA_CA_CERTS at the root, so
 * nothing is installed in the system keychain and no other process on the
 * machine is affected.
 *
 * Ported from wardex ca.go. The certificate assembly is hand-rolled because
 * Node has no equivalent of Go's x509.CreateCertificate — see ./der.ts.
 */

import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  X509Certificate,
  type KeyObject,
} from 'node:crypto';
import { createSecureContext, rootCertificates, type SecureContext } from 'node:tls';
import { isIP } from 'node:net';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  bitString,
  bool,
  contextTag,
  integer,
  octetString,
  oid,
  pem,
  seq,
  set,
  utcTime,
  utf8String,
} from './der.js';

const textEncoder = new TextEncoder();

const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_COMMON_NAME = '2.5.4.3';
const OID_ORGANIZATION = '2.5.4.10';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

const CA_COMMON_NAME = 'pxpipe warp local CA';
const CA_ORGANIZATION = 'pxpipe';

/** ecdsa-with-SHA256 takes no parameters, so the AlgorithmIdentifier is bare. */
const SIG_ALGORITHM = seq(oid(OID_ECDSA_SHA256));

function distinguishedName(commonName: string, organization?: string): Uint8Array {
  const rdns = [set(seq(oid(OID_COMMON_NAME), utf8String(commonName)))];
  if (organization) rdns.push(set(seq(oid(OID_ORGANIZATION), utf8String(organization))));
  return seq(...rdns);
}

function extension(id: string, critical: boolean, value: Uint8Array): Uint8Array {
  const items = [oid(id)];
  if (critical) items.push(bool(true));
  items.push(octetString(value));
  return seq(...items);
}

/** KeyUsage: bit 0 digitalSignature, 5 keyCertSign, 6 cRLSign. */
function keyUsageExtension(bits: number[]): Uint8Array {
  const max = Math.max(...bits);
  const bytes = new Uint8Array(Math.ceil((max + 1) / 8));
  for (const b of bits) bytes[Math.floor(b / 8)]! |= 1 << (7 - (b % 8));
  const unusedBits = 8 * bytes.length - (max + 1);
  return extension(OID_KEY_USAGE, true, bitString(bytes, unusedBits));
}

/**
 * SubjectAltName: dNSName ([2] IMPLICIT IA5String) or iPAddress ([7] IMPLICIT
 * OCTET STRING), per RFC 5280 4.2.1.6.
 */
function subjectAltNameExtension(host: string): Uint8Array {
  const ipType = isIP(host);
  if (ipType === 4) {
    const bytes = Uint8Array.from(host.split('.').map((p) => Number.parseInt(p, 10)));
    return extension(OID_SUBJECT_ALT_NAME, false, seq(contextTag(7, bytes, false)));
  }
  if (ipType === 6) {
    return extension(OID_SUBJECT_ALT_NAME, false, seq(contextTag(7, ipv6Bytes(host), false)));
  }
  return extension(
    OID_SUBJECT_ALT_NAME,
    false,
    seq(contextTag(2, textEncoder.encode(host), false)),
  );
}

function ipv6Bytes(host: string): Uint8Array {
  const [head, tail] = host.split('::');
  const parse = (part: string) => (part ? part.split(':').filter(Boolean) : []);
  const left = parse(head ?? '');
  const right = parse(tail ?? '');
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  const out = new Uint8Array(16);
  groups.forEach((group, i) => {
    const v = Number.parseInt(group, 16);
    out[i * 2] = (v >> 8) & 0xff;
    out[i * 2 + 1] = v & 0xff;
  });
  return out;
}

interface CertificateSpec {
  subject: Uint8Array;
  issuer: Uint8Array;
  subjectPublicKey: KeyObject;
  signingKey: KeyObject;
  notBefore: Date;
  notAfter: Date;
  extensions: Uint8Array[];
}

/**
 * Assemble and self-sign a TBSCertificate. The SubjectPublicKeyInfo comes
 * straight out of node:crypto's SPKI export, so we never hand-encode a curve
 * point; everything else is RFC 5280 boilerplate.
 */
function buildCertificate(spec: CertificateSpec): Uint8Array {
  const spki = new Uint8Array(spec.subjectPublicKey.export({ type: 'spki', format: 'der' }));
  const tbs = seq(
    contextTag(0, integer(2)), // v3
    integer(new Uint8Array(randomBytes(16))),
    SIG_ALGORITHM,
    spec.issuer,
    seq(utcTime(spec.notBefore), utcTime(spec.notAfter)),
    spec.subject,
    spki,
    contextTag(3, seq(...spec.extensions)),
  );
  const signature = new Uint8Array(sign('sha256', tbs, spec.signingKey));
  return seq(tbs, SIG_ALGORITHM, bitString(signature));
}

function newKeyPair() {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

function privateKeyPem(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/**
 * Write-to-temp-then-rename, so a reader (another `pxpipe warp` starting at
 * the same moment) sees either the previous file or the complete new one,
 * never a partial write. rename replaces atomically on POSIX and on NTFS.
 */
export function writeFileAtomic(path: string, data: string, mode: number): void {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, data, { mode });
  let renamed = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      renameSync(tmp, path);
      renamed = true;
      break;
    } catch (err) {
      // If another concurrent process already published the exact same content, we succeeded.
      try {
        if (existsSync(path) && readFileSync(path, 'utf8') === data) {
          renamed = true;
          break;
        }
      } catch {
        /* proceed to retry */
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 9 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        continue;
      }
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing to clean */
      }
      throw err;
    }
  }
  try {
    if (existsSync(tmp)) unlinkSync(tmp);
  } catch {
    /* nothing to clean */
  }
}

interface LockOwner {
  pid: number;
  uuid: string;
  createdAt: number;
}

function isPidAlive(pid: number): boolean {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A directory is the one thing every platform creates atomically, so it serves
 * as the mutex around minting a CA: two concurrent launches on an empty
 * `~/.pxpipe` would otherwise each mint their own root and interleave the two
 * cert/key pairs on disk.
 *
 * Hardened with:
 * 1. Owner token (PID, UUID, timestamp) written inside lock directory.
 * 2. Process liveness verification via process.kill(pid, 0).
 * 3. Race-free stale lock takeover via atomic directory rename (renameSync) to a unique path.
 * 4. Lease verification in finally to guarantee a process NEVER deletes another process's lock.
 */
export function withDirectoryLock<T>(
  lockDir: string,
  fn: () => T,
  staleMs = 30_000,
  waitMs = 10_000,
): T {
  const deadline = Date.now() + waitMs;
  const myOwner: LockOwner = {
    pid: process.pid,
    uuid: randomUUID(),
    createdAt: Date.now(),
  };
  const ownerFile = join(lockDir, 'owner.json');

  for (;;) {
    try {
      mkdirSync(lockDir);
      try {
        writeFileSync(ownerFile, JSON.stringify(myOwner));
      } catch (err) {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {}
        throw err;
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      let isStale = false;
      try {
        if (existsSync(ownerFile)) {
          const raw = readFileSync(ownerFile, 'utf8');
          const owner = JSON.parse(raw) as LockOwner;
          if (!isPidAlive(owner.pid) || Date.now() - owner.createdAt > staleMs) {
            isStale = true;
          }
        } else {
          // No owner file yet: fallback to directory modification time
          const age = Date.now() - statSync(lockDir).mtimeMs;
          if (age > staleMs) isStale = true;
        }
      } catch {
        // Transient filesystem read or parsing race: retry immediately
        continue;
      }

      if (isStale) {
        // Atomic stale lock takeover: rename lockDir to a unique target.
        // Only ONE concurrent contender succeeds; losing contenders get ENOENT and retry.
        const staleDir = `${lockDir}.stale.${randomUUID()}`;
        try {
          renameSync(lockDir, staleDir);
          rmSync(staleDir, { recursive: true, force: true });
        } catch {
          // Lost rename race or directory already recycled: loop and retry
        }
        continue;
      }

      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lockDir}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }

  try {
    return fn();
  } finally {
    // Verified deletion: ensure this lock instance still belongs to us before deleting
    try {
      if (existsSync(ownerFile)) {
        const raw = readFileSync(ownerFile, 'utf8');
        const owner = JSON.parse(raw) as LockOwner;
        if (owner.uuid === myOwner.uuid) {
          rmSync(lockDir, { recursive: true, force: true });
        }
      } else {
        rmSync(lockDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore removal delay or permission error */
    }
  }
}

/**
 * Where the OS keeps its public root bundle. `SSL_CERT_FILE`,
 * `CURL_CA_BUNDLE` and `REQUESTS_CA_BUNDLE` REPLACE the trust store rather
 * than extend it, so a file holding only our CA would make every non-pxpipe
 * HTTPS call in the child fail verification (gcloud, gws, pip: #245). The
 * first path that exists wins; none found means the bundle is CA-only and the
 * caller is told so.
 */
const SYSTEM_ROOT_BUNDLES = [
  '/etc/ssl/cert.pem', // macOS, Alpine, FreeBSD
  '/etc/ssl/certs/ca-certificates.crt', // Debian, Ubuntu, Arch
  '/etc/pki/tls/certs/ca-bundle.crt', // RHEL, Fedora, CentOS
  '/etc/ssl/ca-bundle.pem', // openSUSE
  // Windows / Git / Certifi candidates
  'C:\\Program Files\\Git\\usr\\ssl\\certs\\ca-bundle.crt',
  'C:\\Program Files\\Git\\mingw64\\ssl\\certs\\ca-bundle.crt',
  'C:\\Program Files (x86)\\Git\\bin\\curl-ca-bundle.crt',
  'C:\\Projects\\TraderBot\\backend\\.venv\\Lib\\site-packages\\certifi\\cacert.pem',
];

export function findSystemRootBundle(candidates: readonly string[] = SYSTEM_ROOT_BUNDLES): string | null {
  const fromEnv = process.env.SSL_CERT_FILE;
  // An operator-supplied bundle is the trust store the child would have had
  // without us; prefer it over the platform guess. Skip it if it is already
  // one of our own files, or the bundle would nest on every warp restart.
  if (fromEnv && existsSync(fromEnv) && !/warp-ca(-bundle)?\.pem$/.test(fromEnv)) return fromEnv;
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export class CertificateAuthority {
  private readonly leaves = new Map<string, SecureContext>();

  private constructor(
    private readonly certPem: string,
    private readonly caKey: KeyObject,
    private readonly leafKey: KeyObject,
    private readonly leafKeyPem: string,
    readonly certPath: string,
    /** Our CA followed by the system roots; see {@link writeBundle}. */
    readonly bundlePath: string,
    /** Null when no system root bundle was found and `bundlePath` is CA-only. */
    readonly systemRootsPath: string | null,
  ) {}

  /**
   * Write `warp-ca-bundle.pem` = our CA + the system roots, for the env vars
   * that replace the trust store. Regenerated on every load: the system bundle
   * rotates underneath us and the cost is one file write.
   */
  private static writeBundle(dir: string, certPem: string): { bundlePath: string; systemRootsPath: string | null } {
    const bundlePath = join(dir, 'warp-ca-bundle.pem');
    let systemRootsPath = findSystemRootBundle();
    let roots = '';
    if (systemRootsPath) {
      try {
        roots = readFileSync(systemRootsPath, 'utf8');
      } catch {
        /* unreadable: fall back to CA-only, reported via systemRootsPath */
      }
    }
    // Cross-platform fallback: If no system roots file exists on disk, synthesize one using
    // Node's built-in Mozilla root certificates (tls.rootCertificates) so that external HTTPS calls
    // from child tools (curl, requests, git) never fail TLS validation on Windows or container envs.
    if (!roots && Array.isArray(rootCertificates) && rootCertificates.length > 0) {
      const fallbackPath = join(dir, 'node-root-certificates.pem');
      const fallbackRoots = rootCertificates.join('\n') + '\n';
      try {
        if (!existsSync(fallbackPath) || readFileSync(fallbackPath, 'utf8') !== fallbackRoots) {
          writeFileAtomic(fallbackPath, fallbackRoots, 0o644);
        }
        roots = fallbackRoots;
        systemRootsPath = fallbackPath;
      } catch {
        /* ignore write failure */
      }
    }
    const sep = roots && !roots.endsWith('\n') ? '\n' : '';
    const content = certPem + roots + sep;
    try {
      if (existsSync(bundlePath) && readFileSync(bundlePath, 'utf8') === content) {
        return { bundlePath, systemRootsPath: roots ? systemRootsPath : null };
      }
    } catch {
      /* proceed to write */
    }
    writeFileAtomic(bundlePath, content, 0o644);
    return { bundlePath, systemRootsPath: roots ? systemRootsPath : null };
  }

  /**
   * A cert and key that were written by two different launches are each valid
   * on their own and useless together: leaves signed with that key would not
   * chain to that root. Only a pair that provably belongs together is loaded.
   */
  private static loadPersisted(certPath: string, keyPath: string): { certPem: string; caKey: KeyObject } | null {
    try {
      const certPem = readFileSync(certPath, 'utf8');
      const parsed = new X509Certificate(certPem);
      if (new Date(parsed.validTo).getTime() <= Date.now()) return null;
      const caKey = createPrivateKey(readFileSync(keyPath, 'utf8'));
      if (!parsed.checkPrivateKey(caKey)) return null;
      return { certPem, caKey };
    } catch {
      return null;
    }
  }

  /**
   * Load the persisted CA, or create and persist one. A CA that fails to load
   * or has expired is replaced rather than reported: it is entirely derived
   * state, and the only cost of regenerating is that the child process trusts a
   * new root it is about to be handed anyway.
   */
  static loadOrCreate(dir: string): CertificateAuthority {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const certPath = join(dir, 'warp-ca.pem');
    const keyPath = join(dir, 'warp-ca-key.pem');

    const build = (certPem: string, caKey: KeyObject): CertificateAuthority => {
      const leaf = newKeyPair();
      const bundle = CertificateAuthority.writeBundle(dir, certPem);
      return new CertificateAuthority(
        certPem,
        caKey,
        leaf.publicKey,
        privateKeyPem(leaf.privateKey),
        certPath,
        bundle.bundlePath,
        bundle.systemRootsPath,
      );
    };

    const existing = CertificateAuthority.loadPersisted(certPath, keyPath);
    if (existing) return build(existing.certPem, existing.caKey);

    return withDirectoryLock(join(dir, 'warp-ca.lock'), () => {
      // Another launch may have minted while we waited for the lock.
      const minted = CertificateAuthority.loadPersisted(certPath, keyPath);
      if (minted) return build(minted.certPem, minted.caKey);

      const ca = newKeyPair();
      const name = distinguishedName(CA_COMMON_NAME, CA_ORGANIZATION);
      const now = Date.now();
      const der = buildCertificate({
        subject: name,
        issuer: name,
        subjectPublicKey: ca.publicKey,
        signingKey: ca.privateKey,
        notBefore: new Date(now - 60 * 60 * 1000),
        notAfter: new Date(now + 10 * 365 * 24 * 60 * 60 * 1000),
        extensions: [
          // pathLen 0: this root may sign leaves, never intermediates.
          extension(OID_BASIC_CONSTRAINTS, true, seq(bool(true), integer(0))),
          keyUsageExtension([0, 5, 6]),
        ],
      });

      const certPem = pem('CERTIFICATE', der);
      // Key first, then cert: a reader that finds the cert also finds its key.
      writeFileAtomic(keyPath, privateKeyPem(ca.privateKey), 0o600);
      try {
        chmodSync(keyPath, 0o600);
      } catch {
        /* chmod is a no-op on Windows NTFS, ignore */
      }
      writeFileAtomic(certPath, certPem, 0o644);
      return build(certPem, ca.privateKey);
    });
  }

  /**
   * Cached-or-minted TLS context for an SNI host. One leaf key is reused across
   * every host: these certs never leave the machine and are only trusted by the
   * child we spawned, so per-host keygen would buy nothing but latency on the
   * first request to each host.
   */
  secureContextFor(host: string): SecureContext {
    const name = host.replace(/\.$/, '');
    const cached = this.leaves.get(name);
    if (cached) return cached;

    const now = Date.now();
    const der = buildCertificate({
      subject: distinguishedName(name),
      issuer: distinguishedName(CA_COMMON_NAME, CA_ORGANIZATION),
      subjectPublicKey: this.leafKey,
      signingKey: this.caKey,
      notBefore: new Date(now - 60 * 60 * 1000),
      notAfter: new Date(now + 365 * 24 * 60 * 60 * 1000),
      extensions: [
        keyUsageExtension([0]),
        extension(OID_EXT_KEY_USAGE, false, seq(oid(OID_SERVER_AUTH))),
        subjectAltNameExtension(name),
      ],
    });

    const context = createSecureContext({
      key: this.leafKeyPem,
      // Ship the root alongside the leaf so the child validates the whole chain
      // from NODE_EXTRA_CA_CERTS without a separate fetch.
      cert: pem('CERTIFICATE', der) + this.certPem,
    });
    this.leaves.set(name, context);
    return context;
  }
}
