/**
 * Resolving the configured model roster into PXPIPE_MODELS.
 *
 * Extracted from node.ts so it can be tested directly: node.ts calls `main()`
 * at import time, so a test that imported it would start the proxy. The logic
 * here decides whether a banned model can re-enter transform scope, so it needs
 * a test that crosses the real predicate rather than a re-implementation.
 */

/** Config roster (array or CSV string) -> PXPIPE_MODELS value. An explicitly
 *  empty roster means `off`, never "fall through to defaults". */
export function normalizeModelsConfig(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const models = value.map((v) => String(v).trim()).filter(Boolean);
    return models.length > 0 ? models.join(',') : 'off';
  }
  if (typeof value === 'string') return value.trim() || 'off';
  return undefined;
}

/**
 * Fill PXPIPE_MODELS from config when the env does not already pin a scope.
 *
 * A set-but-EMPTY value counts as absent. The guard used to be
 * `process.env.PXPIPE_MODELS === undefined`, so `PXPIPE_MODELS=""` (or
 * whitespace) skipped the fill; scope then resolved through applicability's
 * blank-env branch to the built-in default roster, which contains
 * `claude-fable-5`. Measured 2026-08-16 against the shipped build:
 *
 *   env undefined + config -> 8 bases from cfg.models, fable absent
 *   env ""        + config -> 9 bases, claude-fable-5 PRESENT
 *   env "   "     + config -> 9 bases, claude-fable-5 PRESENT
 *
 * A launcher that exports scope from an unset shell variable produces exactly
 * `""`, so this was reachable from an ordinary restart, not hand-editing.
 *
 * `model_scope` is accepted as a fallback because only `models` was ever read:
 * editing `model_scope` alone changed nothing, and the two arrays could
 * disagree silently with no diagnostic.
 *
 * A non-blank env is never overwritten — explicit scope still wins over config.
 */
export function applyModelScopeFromConfig(
  cfg: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.PXPIPE_MODELS?.trim()) return;
  const models =
    normalizeModelsConfig(cfg.models) ?? normalizeModelsConfig(cfg.model_scope);
  if (models !== undefined) env.PXPIPE_MODELS = models;
}
