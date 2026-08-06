## 2026-07-26T21:10:33Z
You are Explorer 1 for Milestone 2: Refactor Pricing Core (`src/core/model-pricing.ts`).
Read `C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md`, `C:\Projects\pxpipe\.agents\orchestrator\PROJECT.md`, and `C:\Projects\pxpipe\src\core\model-registry.ts`.

Your task:
Examine `src/core/model-pricing.ts` and formulate the exact refactoring strategy:
1. Replace ad-hoc model rate cards and hardcoded 128k fallbacks in `resolveModelRate(model, inputTokens, route)` with calls to `resolveModelProfile(model, route)`.
2. Ensure `resolveModelRate` returns `contextWindowTokens` directly from `profile.contextWindowTokens` (eliminating hardcoded `131_072` fallbacks for NIM Ultra/Super models).
3. Preserve long-context pricing logic for GPT-5.6 Sol / GPT-5.5 when `inputTokens > 272_000`.
4. Ensure `cacheReadRatio()` and `outputInputRatio()` consume rates from `resolveModelProfile()`.

Working directory: `C:\Projects\pxpipe\.agents\explorer_m2_1`
Write your strategy to `C:\Projects\pxpipe\.agents\explorer_m2_1\handoff.md`. Notify parent when done.
