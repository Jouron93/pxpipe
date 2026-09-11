/**
 * A blank PXPIPE_MODELS must not silently resurrect the built-in default roster.
 *
 * Measured 2026-08-16 against the shipped build, mimicking node.ts loadConfig order:
 *   env undefined + config loads -> 8 bases from cfg.models, fable ABSENT (fine)
 *   env ""        + config loads -> 9 bases, claude-fable-5 PRESENT   (the bug)
 *   env "   "     + config loads -> 9 bases, claude-fable-5 PRESENT   (the bug)
 *
 * Cause: the config-fill guard in applyConfigFileDefaults was
 * `process.env.PXPIPE_MODELS === undefined`, so a set-but-empty value skipped
 * the fill; applicability then treats a blank env as "no scope given" and falls
 * through to the built-in default, which contains claude-fable-5. A launcher
 * that exports scope from an unset shell variable produces exactly `""`, so this
 * was reachable from an ordinary restart.
 *
 * These are guard-sensitive: restore `=== undefined` and the blank cases fail.
 *
 * Deliberately NOT asserted here: the no-config-file case still resolves to the
 * built-in default. That is the package's documented upstream behaviour and
 * changing it breaks 12 existing tests; deployments pin scope via config or env.
 *
 * Run just this file:  pnpm vitest run tests/scope-blank-env.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyModelScopeFromConfig,
  normalizeModelsConfig,
} from '../src/core/model-scope-config.js';

const ROSTER = [
  'claude-sonnet-5',
  'claude-opus-5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'grok-4.5',
  'grok-4.3',
  'grok-4.20-0309-reasoning',
];

let savedModels: string | undefined;
let savedConfig: string | undefined;

/** Exercises the REAL guard, not a copy of it. */
function applyFill(cfg: Record<string, unknown>): void {
  applyModelScopeFromConfig(cfg);
}

beforeEach(() => {
  savedModels = process.env.PXPIPE_MODELS;
  savedConfig = process.env.PXPIPE_CONFIG;
});

afterEach(() => {
  if (savedModels === undefined) delete process.env.PXPIPE_MODELS;
  else process.env.PXPIPE_MODELS = savedModels;
  if (savedConfig === undefined) delete process.env.PXPIPE_CONFIG;
  else process.env.PXPIPE_CONFIG = savedConfig;
});

function cfgWith(extra: Record<string, unknown>): Record<string, unknown> {
  return { min_body_bytes: 25000, ...extra };
}

describe('blank PXPIPE_MODELS is treated as absent', () => {
  it('empty string is filled from cfg.models', () => {
    process.env.PXPIPE_MODELS = '';
    applyFill(cfgWith({ models: ROSTER }));
    expect(process.env.PXPIPE_MODELS).toBe(ROSTER.join(','));
  });

  it('whitespace-only is filled from cfg.models', () => {
    process.env.PXPIPE_MODELS = '   ';
    applyFill(cfgWith({ models: ROSTER }));
    expect(process.env.PXPIPE_MODELS).toBe(ROSTER.join(','));
  });

  it('undefined is still filled (unchanged behaviour)', () => {
    delete process.env.PXPIPE_MODELS;
    applyFill(cfgWith({ models: ROSTER }));
    expect(process.env.PXPIPE_MODELS).toBe(ROSTER.join(','));
  });

  it('a blank env never leaves a banned model in the resolved roster', () => {
    for (const blank of ['', '   ', '\t']) {
      process.env.PXPIPE_MODELS = blank;
      applyFill(cfgWith({ models: ROSTER }));
      const resolved = (process.env.PXPIPE_MODELS ?? '').toLowerCase();
      expect(resolved).not.toContain('fable');
      expect(resolved.split(',').filter(Boolean)).toHaveLength(ROSTER.length);
    }
  });
});

describe('explicit scope is still authoritative', () => {
  it('a non-blank env is never overwritten by config', () => {
    process.env.PXPIPE_MODELS = 'gpt-5.6-sol';
    applyFill(cfgWith({ models: ROSTER }));
    expect(process.env.PXPIPE_MODELS).toBe('gpt-5.6-sol');
  });

  it('an explicit off survives config fill', () => {
    process.env.PXPIPE_MODELS = 'off';
    applyFill(cfgWith({ models: ROSTER }));
    expect(process.env.PXPIPE_MODELS).toBe('off');
  });
});

describe('model_scope is no longer inert', () => {
  it('fills from model_scope when models is absent', () => {
    process.env.PXPIPE_MODELS = '';
    applyFill(cfgWith({ model_scope: ROSTER }));
    expect(process.env.PXPIPE_MODELS).toBe(ROSTER.join(','));
  });

  it('prefers models when both are present', () => {
    process.env.PXPIPE_MODELS = '';
    applyFill(cfgWith({ models: ['grok-4.3'], model_scope: ROSTER }));
    expect(process.env.PXPIPE_MODELS).toBe('grok-4.3');
  });

  it('an empty roster array means off, not fall-through to defaults', () => {
    process.env.PXPIPE_MODELS = '';
    applyFill(cfgWith({ models: [] }));
    expect(process.env.PXPIPE_MODELS).toBe('off');
  });
});
