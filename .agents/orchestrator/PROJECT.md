# Project: PXPipe Per-Model Configuration Registry

## Architecture
- Centralized model configuration registry: `src/core/model-registry.ts` defining `PxpipeModelProfile`.
- Core engine refactoring: `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/gpt-model-profiles.ts`, `src/core/transform.ts`, `src/core/openai.ts` consume model-registry.
- Dashboard UI refactoring: `src/dashboard/fragments.ts` renders 5 per-family sections with individual toggle chips and context length badges (`1M`, `2M`, `262K`, `128K`).
- Test suite & Proxy daemon verification: `tests/model-registry.test.ts`, `tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/dashboard-api.test.ts`, `npx tsc --noEmit`, `pnpm test`, `pnpm run build` -> `dist/node.js`, restart `TraderBotPxpipeProxy` on port 47821.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | PxpipeModelProfile Schema & Catalog | Define profile interface & full 102+ model catalog across Claude, OpenAI/Codex, Grok, AGY Proxy, NVIDIA NIM | M1 | R1 |
| 2 | Alias Matching | Resolve aliases (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus` -> `claude-opus-5`) | M1 | R1 |
| 3 | Dynamic Prefix & Context Fallback Resolver | Implement fallback resolver for `nvidia/*`, `deepseek-ai/*`, `mistralai/*`, `meta/*`, `qwen/*`, `bigcode/*`, `openai/*`, `agy/*` with accurate context windows | M1 | R1 |
| 4 | Core Engines Refactoring | Refactor `model-pricing.ts`, `applicability.ts`, `gpt-model-profiles.ts`, `transform.ts` to consume model-registry | M2 | R2 |
| 5 | Runtime Config Overrides | Allow `PXPIPE_CONFIG` / `~/.config/pxpipe/config.json` to override per-model profile fields | M2 | R2 |
| 6 | Dashboard UI Per-Family Toggles & Context Badges | Update `src/dashboard/fragments.ts` with 5 per-family sections, per-model toggle chips, and context badges (`1M`, `2M`, `262K`, `128K`) | M3 | R3 |
| 7 | Unit & Integration Test Suite Update | Create `tests/model-registry.test.ts`, update `model-pricing.test.ts`, `proxy-usage.test.ts`, `dashboard-api.test.ts` | M4 | R4 |
| 8 | Build, Proxy Reload & E2E Verification | Ensure `npx tsc --noEmit`, `pnpm test`, `pnpm run build` pass, restart `TraderBotPxpipeProxy` (port 47821), verify HTTP health & models fragment | M4 | R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Model Registry Core (`src/core/model-registry.ts`) | Model profiles, catalog, alias matcher, dynamic prefix resolver, context window length definitions | None | DONE |
| M2 | Core Engines Refactoring (`model-pricing.ts`, `applicability.ts`, `gpt-model-profiles.ts`, `transform.ts`) | Replace ad-hoc checks with registry lookups, context length propagation, runtime config override handling | M1 | DONE |
| M3 | Dashboard UI Model Chips (`src/dashboard/fragments.ts`) | 5 per-family toggle chip sections, context length badges (`1M`, `2M`, `262K`, `128K`), badge CSS styling | M1, M2 | DONE |
| M4 | Test Suite, Build, & Service Reload Verification | `tests/model-registry.test.ts`, update existing tests, `npx tsc --noEmit`, `pnpm test`, `pnpm run build`, kill & restart `TraderBotPxpipeProxy` on port 47821 | M1, M2, M3 | IN_PROGRESS |

## Interface Contracts
### `src/core/model-registry.ts`
- Exports `PxpipeModelProfile`, `ModelFamily`, `ReaderValidationStatus`, `ModelPricing`, `RenderProfile`.
- Exports `resolveModelProfile(modelId: string, route?: string): PxpipeModelProfile`.
- Exports `getAllModelProfiles(): PxpipeModelProfile[]`.
- Exports `applyRuntimeConfigOverrides(config: Record<string, any>): void`.

## Code Layout
- `src/core/model-registry.ts` (DONE - M1)
- `src/core/model-pricing.ts` (DONE - M2)
- `src/core/applicability.ts` (DONE - M2)
- `src/core/gpt-model-profiles.ts` (DONE - M2)
- `src/core/transform.ts` (DONE - M2)
- `src/dashboard/fragments.ts` (DONE - M3)
- `tests/model-registry.test.ts` (NEW - owned by M4)
- `tests/model-pricing.test.ts` (REFACTORED - owned by M4)
- `tests/proxy-usage.test.ts` (REFACTORED - owned by M4)
- `tests/dashboard-api.test.ts` (REFACTORED - owned by M4)
