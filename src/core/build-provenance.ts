import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

export interface BuildProvenance {
  schema_version: number;
  repository: string;
  source_sha: string;
  source_ref: string;
  dirty: boolean;
  package_version: string;
  node_executable: string;
  node_version: string;
  built_at_utc: string;
  entry_sha256: string;
  runtime_node_executable?: string;
  runtime_node_version?: string;
  runtime_pid?: number;
  runtime_entry_sha256?: string;
  bundle_verified?: boolean;
}

let cachedProvenance: BuildProvenance | null = null;

/**
 * Loads and returns the immutable build provenance manifest for this process.
 * Once loaded, the provenance record is frozen and cached in process memory so
 * subsequent disk mutations or file replacements cannot alter the runtime identity.
 */
export function getBuildProvenance(): BuildProvenance {
  if (cachedProvenance) return cachedProvenance;

  const candidates: string[] = [];

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // 1. Next to executing bundle (e.g. dist/build-provenance.json when running dist/node.js)
    candidates.push(path.join(currentDir, 'build-provenance.json'));
    // 2. Relative to src/core (during vitest running from source)
    candidates.push(path.resolve(currentDir, '..', '..', 'dist', 'build-provenance.json'));
  } catch {
    // import.meta.url might be undefined in synthetic contexts
  }

  // 3. Fallback: cwd relative
  candidates.push(path.resolve(process.cwd(), 'dist', 'build-provenance.json'));

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        const raw = readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw) as BuildProvenance;
        if (
          parsed &&
          parsed.schema_version === 1 &&
          typeof parsed.source_sha === 'string' &&
          typeof parsed.entry_sha256 === 'string'
        ) {
          let runtimeEntrySha256: string | undefined;
          let bundleVerified = false;
          try {
            const candidateDir = path.dirname(candidate);
            const bundlePath = path.join(candidateDir, 'node.js');
            if (existsSync(bundlePath)) {
              const bundleBytes = readFileSync(bundlePath);
              runtimeEntrySha256 = createHash('sha256').update(bundleBytes).digest('hex');
              bundleVerified = runtimeEntrySha256 === parsed.entry_sha256;
            }
          } catch {
            // Bundle verification failed
          }

          cachedProvenance = Object.freeze({
            ...parsed,
            runtime_node_executable: process.execPath,
            runtime_node_version: process.version,
            runtime_pid: process.pid,
            runtime_entry_sha256: runtimeEntrySha256,
            bundle_verified: bundleVerified,
          });
          return cachedProvenance;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  // Fallback for unbuilt dev / test environments
  cachedProvenance = Object.freeze({
    schema_version: 1,
    repository: 'Jouron93/pxpipe',
    source_sha: 'unbuilt',
    source_ref: 'dev',
    dirty: true,
    package_version: '0.8.0',
    node_executable: process.execPath,
    node_version: process.version,
    built_at_utc: new Date(0).toISOString(),
    entry_sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  });
  return cachedProvenance;
}

/** Testing helper to inject or clear cached build provenance. */
export function _setMockBuildProvenance(p: BuildProvenance | null): void {
  cachedProvenance = p ? Object.freeze({ ...p }) : null;
}
