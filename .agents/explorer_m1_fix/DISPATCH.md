## 2026-07-26T21:04:22Z

<USER_REQUEST>
You are Explorer Fix for Milestone 1: Model Registry Core (`src/core/model-registry.ts`).
Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md`, `C:\Projects\pxpipe\.agents\orchestrator\GATE_STATUS.md`, and `C:\Projects\pxpipe\.agents\challenger_m1_1\handoff.md`.

Problem Statement:
`normalizeModelId('agy-gemini-3.6-flash-high')` strips the suffix `-high`, turning it into `'agy-gemini-3.6-flash'`.
When `aliasMap` is populated in `initCatalog()`, `aliasMap.set('agy-gemini-3.6-flash-high', 'agy-gemini-3.6-flash-high')` stores key `'agy-gemini-3.6-flash-high'`.
When `resolveModelProfile('agy-gemini-3.6-flash-high')` runs, it calls `normalizeModelId`, getting `'agy-gemini-3.6-flash'`, which fails to find `'agy-gemini-3.6-flash-high'` in `aliasMap`, causing a fallback to a zero-priced dynamic profile.

Your task:
Analyze and formulate the exact fix strategy in `src/core/model-registry.ts`:
1. In `initCatalog()`, populate `aliasMap` and `profileRegistry` using both `normalizeModelId(profile.canonicalId)` and exact canonical IDs (and normalized aliases).
2. Ensure that querying any canonical ID or alias in `BUILTIN_CATALOG` (including all AGY models like `agy-gemini-3.6-flash-high`) resolves directly to its catalog `PxpipeModelProfile` with full pricing metadata.

Working directory: `C:\Projects\pxpipe\.agents\explorer_m1_fix`
Write your strategy to `C:\Projects\pxpipe\.agents\explorer_m1_fix\handoff.md`. Notify parent when done.
</USER_REQUEST>
