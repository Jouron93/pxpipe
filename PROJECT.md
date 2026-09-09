# Project: PXPipe Unified Per-Model Configuration Registry

## Architecture
PXPipe acts as an intelligent proxy layer (port 47821) handling requests across Claude Code CLI, OpenAI/Codex, Grok, AGY Proxy, Gemini, DeepSeek, and NVIDIA NIM.
The Unified Model Registry (`src/core/model-registry.ts`) serves as the single source of truth for all model profiles, alias resolution, pricing cards, render profiles, context token limits, and applicability status.

Core Modules consuming `model-registry.ts`:
- `src/core/model-pricing.ts`: Pricing lookup (`resolveModelRate`). Delegates model resolution to `resolveModelProfile`.
- `src/core/applicability.ts`: Model applicability check (`isPxpipeSupportedModel`, `baseModelId`). Uses `resolveModelProfile` to determine status and enabled features.
- `src/core/gpt-model-profiles.ts`: Model render profile lookup (`getGptRenderProfile`). Returns `profile.renderProfile`.
- `src/core/transform.ts`: Body rewrite & normalization. Rewrites request body `model` field to `canonicalId` (e.g. `claude-opus-4-8` -> `claude-opus-5`).
- `src/core/config.ts`: Loads runtime configuration overrides from `PXPIPE_CONFIG` env var or `~/.config/pxpipe/config.json` and updates the model registry.
- `src/dashboard/fragments.ts`: Dashboard UI rendering per-family sections with individual model toggle chips.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Unified Model Registry | `src/core/model-registry.ts` defining `PxpipeModelProfile` for all 6 families + NIM/AGY models, alias resolution (`resolveModelProfile`), and runtime override capability | M1 | R1 |
| 2 | Model Pricing Refactor | Refactor `src/core/model-pricing.ts` to consume `model-registry.ts` for all rate lookups | M2 | R2 |
| 3 | Model Applicability Refactor | Refactor `src/core/applicability.ts` to consume `model-registry.ts` for model support and capability checks | M2 | R2 |
| 4 | GPT/Model Profiles Refactor | Refactor `src/core/gpt-model-profiles.ts` to consume `model-registry.ts` for render profile settings | M2 | R2 |
| 5 | Request Transform & Upstream Rewriting | Refactor `src/core/transform.ts` to normalize and rewrite incoming model fields to `canonicalId` via `model-registry.ts` | M2 | R2 |
| 6 | Runtime Configuration Overrides | Support overriding per-model profiles via `PXPIPE_CONFIG` / `~/.config/pxpipe/config.json` | M2 | R2 |
| 7 | Dashboard UI Per-Model Toggles | Refactor `src/dashboard/fragments.ts` to render per-family sections with individual model toggle chips | M3 | R3 |
| 8 | Test Suite Updates | Update unit tests (`tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/transform.ts`, etc.) for all 6 families and alias mappings | M4 | R4 |
| 9 | Verification & Daemon Reload | Verify `npx tsc --noEmit` (exit 0), `pnpm test` (exit 0), `pnpm run build` (`dist/node.js`), restart `TraderBotPxpipeProxy` (port 47821), HTTP verification | M4 | R4 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Model Registry | Implement `src/core/model-registry.ts` with `PxpipeModelProfile` definitions, alias resolution, and export helpers | none | DONE |
| M2 | Core Engines Refactoring | Refactor `model-pricing.ts`, `applicability.ts`, `gpt-model-profiles.ts`, `transform.ts`, and `config.ts` to use `model-registry.ts` | M1 | DONE |
| M3 | Dashboard UI Per-Model Toggles | Refactor `src/dashboard/fragments.ts` to render per-family sections with per-model toggle chips | M1, M2 | DONE |
| M4 | Test Suite & Live Proxy Reload Verification | Update unit tests, run `pnpm test` & `npx tsc --noEmit`, build `dist/node.js`, reload daemon on 47821, verify HTTP requests | M1, M2, M3 | PLANNED |

## Interface Contracts
### `src/core/model-registry.ts`
```ts
export type ModelFamily = 'claude' | 'openai' | 'grok' | 'gemini' | 'agy' | 'nvidia' | 'deepseek';

export type ModelStatus = 'validated' | 'degraded' | 'unvalidated';

export interface ModelPricing {
  inputPerMtok: number;
  cacheWritePerMtok: number;
  cacheReadPerMtok: number;
  outputPerMtok: number;
  cacheWrite5mPerMtok?: number;
  cacheWrite1hPerMtok?: number;
}

export interface ModelRenderProfile {
  stripCols: number;
  cellWBonus: number;
  cellHBonus: number;
  maxHeightPx: number;
  style: 'box-drawing' | 'rounded' | 'ascii' | 'compact';
}

export interface PxpipeModelProfile {
  canonicalId: string;
  displayName: string;
  family: ModelFamily;
  status: ModelStatus;
  enabledByDefault: boolean;
  pricing: ModelPricing;
  renderProfile: ModelRenderProfile;
  contextWindowTokens: number;
  maxOutputTokens: number;
  factsheetEnabled: boolean;
  aliases: (string | RegExp)[];
}

export function resolveModelProfile(modelIdOrAlias: string | undefined): PxpipeModelProfile;
export function getAllModelProfiles(): PxpipeModelProfile[];
export function getModelProfilesByFamily(family: ModelFamily): PxpipeModelProfile[];
export function loadModelRegistryOverrides(overrides?: Record<string, Partial<PxpipeModelProfile>>): void;
```

## Code Layout
- `src/core/model-registry.ts`: Single source of truth for model profiles.
- `src/core/model-pricing.ts`: Rates & pricing cards.
- `src/core/applicability.ts`: Model support check & compression eligibility.
- `src/core/gpt-model-profiles.ts`: Render profiles.
- `src/core/transform.ts`: Body parsing & model field rewriting.
- `src/core/config.ts`: Runtime configuration loader.
- `src/dashboard/fragments.ts`: Dashboard UI HTML/fragment rendering.
- `tests/`: Vitest test suites.
- `dist/node.js`: Compiled distribution bundle.
