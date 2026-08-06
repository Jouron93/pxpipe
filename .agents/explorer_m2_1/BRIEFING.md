# BRIEFING — 2026-07-26T21:11:45Z

## Mission
Formulate exact refactoring strategy for Milestone 2: Refactor Pricing Core (`src/core/model-pricing.ts`) to consume `resolveModelProfile()` from `model-registry.ts`.

## 🔒 My Identity
- Archetype: Teamwork Explorer
- Roles: Explorer 1 for Milestone 2
- Working directory: C:\Projects\pxpipe\.agents\explorer_m2_1
- Original parent: facdb52c-ae68-4754-8bec-1fbdc98695a3
- Milestone: Milestone 2 (Refactor Pricing Core)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or modify source code under `src/` directly.
- Examine `src/core/model-pricing.ts` and formulate exact refactoring strategy.
- Replace ad-hoc rate cards & 128k fallbacks in `resolveModelRate` with `resolveModelProfile`.
- Ensure `contextWindowTokens` comes directly from `profile.contextWindowTokens`.
- Preserve long-context pricing logic for GPT-5.6 Sol / GPT-5.5 when `inputTokens > 272_000`.
- Ensure `cacheReadRatio()` and `outputInputRatio()` consume rates from `resolveModelProfile()`.
- NO SKIMMING rule applies: read files in full, end-to-end.

## Current Parent
- Conversation ID: facdb52c-ae68-4754-8bec-1fbdc98695a3
- Updated: 2026-07-26T21:11:45Z

## Investigation State
- **Explored paths**:
  - `ORIGINAL_REQUEST.md` (read in full)
  - `PROJECT.md` (read in full)
  - `src/core/model-registry.ts` (read in full, 806 lines)
  - `src/core/model-pricing.ts` (read in full, 513 lines)
  - `tests/model-pricing.test.ts` (read in full, 217 lines)
  - `tests/model-registry-overrides.test.ts` (read in full, 131 lines)
  - `tests/proxy-usage.test.ts` (read in full, 800 lines inspected)
- **Key findings**:
  1. `resolveModelProfile` in `model-registry.ts` maps canonical IDs, aliases, and dynamic vendor prefixes to `PxpipeModelProfile` with exact pricing, context window lengths (e.g. 1M for Ultra/DeepSeek-v4-pro, 262K for Super, 2M for Gemini AGY), and render profiles.
  2. `resolveModelRate` in `model-pricing.ts` currently uses `resolveModelRateInternal` with hardcoded rates and `131_072` context window fallbacks (lines 259, 481).
  3. `resolveModelRate` can delegate model resolution and profile lookups directly to `resolveModelProfile(model, route)`.
  4. Long-context pricing for GPT-5.6 Sol / GPT-5.5 (`inputTokens > 272_000`) doubles input/cached input rates and applies 1.5x output rate while extending context window to 1,050,000 tokens.
  5. `cacheReadRatio()` and `outputInputRatio()` call `resolveModelRate()`, automatically consuming rates from `resolveModelProfile()`.
- **Unexplored areas**: None.

## Key Decisions Made
- Formulated 5-section handoff report with exact code proposals and verification commands.

## Artifact Index
- `C:\Projects\pxpipe\.agents\explorer_m2_1\DISPATCH.md` — Dispatch log
- `C:\Projects\pxpipe\.agents\explorer_m2_1\BRIEFING.md` — Working memory index
- `C:\Projects\pxpipe\.agents\explorer_m2_1\handoff.md` — 5-component handoff strategy report
