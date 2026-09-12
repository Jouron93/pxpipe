import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getBuildProvenance,
  _setMockBuildProvenance,
  type BuildProvenance,
} from '../src/core/build-provenance.js';

describe('BuildProvenance', () => {
  let initialProvenance: BuildProvenance;

  beforeEach(() => {
    _setMockBuildProvenance(null);
    initialProvenance = getBuildProvenance();
  });

  afterEach(() => {
    _setMockBuildProvenance(null);
  });

  it('conforms to schema_version 1', () => {
    expect(initialProvenance.schema_version).toBe(1);
    expect(typeof initialProvenance.repository).toBe('string');
    expect(typeof initialProvenance.source_sha).toBe('string');
    expect(typeof initialProvenance.source_ref).toBe('string');
    expect(typeof initialProvenance.dirty).toBe('boolean');
    expect(typeof initialProvenance.package_version).toBe('string');
    expect(typeof initialProvenance.node_executable).toBe('string');
    expect(typeof initialProvenance.node_version).toBe('string');
    expect(typeof initialProvenance.built_at_utc).toBe('string');
    expect(typeof initialProvenance.entry_sha256).toBe('string');
  });

  it('provides a 64-char hex entry_sha256', () => {
    expect(initialProvenance.entry_sha256).toMatch(/^[0-9a-f]{64}$/i);
  });

  it('freezes the provenance object to prevent runtime mutation', () => {
    expect(Object.isFrozen(initialProvenance)).toBe(true);
    expect(() => {
      // @ts-expect-error mutating frozen object
      initialProvenance.source_sha = 'tampered';
    }).toThrow();
  });

  it('returns cached instance on subsequent calls', () => {
    const second = getBuildProvenance();
    expect(second).toBe(initialProvenance);
  });

  it('allows mock provenance injection for testing environments', () => {
    const mock: BuildProvenance = {
      schema_version: 1,
      repository: 'test/repo',
      source_sha: '1111222233334444555566667777888899990000',
      source_ref: 'test-branch',
      dirty: false,
      package_version: '1.0.0',
      node_executable: 'test-node',
      node_version: 'v20.0.0',
      built_at_utc: '2026-01-01T00:00:00.000Z',
      entry_sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    };
    _setMockBuildProvenance(mock);
    const resolved = getBuildProvenance();
    expect(resolved.source_sha).toBe('1111222233334444555566667777888899990000');
    expect(resolved.repository).toBe('test/repo');
    expect(Object.isFrozen(resolved)).toBe(true);
  });
});
