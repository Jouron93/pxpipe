/**
 * GET /build-info carries the model scope the process actually loaded.
 *
 * The TraderBot supervisor used to check runtime scope drift with an
 * unauthenticated GET /v1/models. That path is forwarded upstream, so it got a
 * 401 from Anthropic every 5 minutes (1,659 ticks logged by 2026-09-26) and
 * could never see drift. /build-info is served locally with no credential.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeBuildInfo } from '../src/core/build-provenance.js';
import { setAllowedModelBases } from '../src/core/applicability.js';

describe('getRuntimeBuildInfo', () => {
  const ambient = process.env.PXPIPE_MODELS;
  afterEach(() => {
    setAllowedModelBases(null);
    if (ambient === undefined) delete process.env.PXPIPE_MODELS;
    else process.env.PXPIPE_MODELS = ambient;
  });

  it('reports the configured PXPIPE_MODELS scope alongside provenance', () => {
    process.env.PXPIPE_MODELS = 'claude-fable-5, claude-opus-5-5';
    const info = getRuntimeBuildInfo();
    expect(info.schema_version).toBe(1);
    expect(info.runtime_model_scope).toEqual(['claude-fable-5', 'claude-opus-5-5']);
    expect(info.configured_model_scope).toEqual(['claude-fable-5', 'claude-opus-5-5']);
  });

  it('runtime scope follows the dashboard override; configured scope does not', () => {
    process.env.PXPIPE_MODELS = 'claude-fable-5,claude-haiku-4-5';
    setAllowedModelBases(['claude-fable-5']);
    const info = getRuntimeBuildInfo();
    expect(info.runtime_model_scope).toEqual(['claude-fable-5']);
    expect(info.configured_model_scope).toEqual(['claude-fable-5', 'claude-haiku-4-5']);
  });

  it('an explicit off scope reports empty, not the default', () => {
    process.env.PXPIPE_MODELS = 'off';
    expect(getRuntimeBuildInfo().runtime_model_scope).toEqual([]);
  });
});
