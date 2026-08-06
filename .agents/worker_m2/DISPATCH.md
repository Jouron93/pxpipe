## 2026-07-26T21:14:00Z

<USER_REQUEST>
You are Worker 1 for Milestone 2: Core Engines Refactoring (`model-pricing.ts`, `applicability.ts`, `gpt-model-profiles.ts`, `transform.ts`, `openai.ts`, `node.ts`).

Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md`, `C:\Projects\pxpipe\.agents\orchestrator\PROJECT.md`, and the Explorer handoff reports at:
- `C:\Projects\pxpipe\.agents\explorer_m2_1\handoff.md`
- `C:\Projects\pxpipe\.agents\explorer_m2_2\handoff.md`
- `C:\Projects\pxpipe\.agents\explorer_m2_3\handoff.md`

Your task:
Refactor the core engines to consume `src/core/model-registry.ts`:
1. `src/core/model-pricing.ts`: Delegate rate card generation and context window sizes in `resolveModelRate` to `resolveModelProfile(model, route)`. Eliminate hardcoded 128k/131k fallbacks for NIM models so Ultra models report 1M and Super models report 262K. Preserve long-context pricing logic for `inputTokens > 272_000`.
2. `src/core/applicability.ts`: Replace static `READER_VALIDATION` record with `resolveModelProfile(base).status`. Compute `DEFAULT_MODEL_BASES` dynamically from catalog `enabledByDefault`. Update `isAllowed` and `canEnableFromDashboard`.
3. `src/core/gpt-model-profiles.ts`: Refactor `resolveGptProfile(model)` to return `resolveModelProfile(model).renderProfile` (preserving `vision` property).
4. `src/core/transform.ts` & `src/core/openai.ts`: Update transform logic to query `resolveModelProfile(model)` for context window lengths and model metadata.
5. `src/node.ts`: Update `applyConfigFileDefaults()` to invoke `applyRuntimeConfigOverrides(cfg)` from `src/core/model-registry.js` whenever `PXPIPE_CONFIG` or `~/.config/pxpipe/config.json` contains model overrides.

Verification Requirements:
After refactoring, run `npx tsc --noEmit` and `pnpm test`. Confirm 0 type errors and 0 test failures. Document output and exit code.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Working Directory: `C:\Projects\pxpipe\.agents\worker_m2`
Write your completion report to `C:\Projects\pxpipe\.agents\worker_m2\handoff.md`. Notify parent when done.
</USER_REQUEST>
