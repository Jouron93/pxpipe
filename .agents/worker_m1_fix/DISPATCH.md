## 2026-07-26T21:06:23Z

You are Worker Fix for Milestone 1: Model Registry Core (`src/core/model-registry.ts`) in PXPipe (`C:\Projects\pxpipe`).

Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md` and `C:\Projects\pxpipe\.agents\explorer_m1_fix\handoff.md`.

Your task:
Apply the fix to `src/core/model-registry.ts` as specified in `explorer_m1_fix/handoff.md`:
1. In `initCatalog()`, map exact lowercase canonical IDs and aliases in `aliasMap` FIRST, before mapping normalized IDs/aliases.
2. In `resolveModelProfile(modelId, route?)`, lookup `rawLower = (modelId || '').trim().toLowerCase()` in `aliasMap` FIRST, falling back to `aliasMap.get(norm)`.
3. In `applyRuntimeConfigOverrides(config)`, lookup target canonical IDs via `rawKey` first, then `normKey`.
4. Ensure returned profile objects in `resolveModelProfile` are deep-cloned.

Verification Requirements:
After updating `src/core/model-registry.ts`, run `npx tsc --noEmit` and confirm exit code 0.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Working Directory: `C:\Projects\pxpipe\.agents\worker_m1_fix`
Write your completion report to `C:\Projects\pxpipe\.agents\worker_m1_fix\handoff.md`. Notify parent via send_message when done.
