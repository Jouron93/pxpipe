# Comprehensive Survey & Specification Report for PXPipe Unified Model Registry

**Target Module**: `src/core/model-registry.ts`
**Survey Date**: 2026-07-26
**Author**: Explorer 1

---

## 1. Executive Summary

PXPipe currently manages model capabilities, rate cards, rendering geometries, applicability gates, and UI toggle chips across multiple fragmented files using ad-hoc `if`/`switch` blocks and regular expressions.

Specifically:
- Pricing rate cards are defined in `src/core/model-pricing.ts`.
- Imaged-reading validation and applicability defaults are defined in `src/core/applicability.ts`.
- Render geometries and vision token costs are defined in `src/core/gpt-model-profiles.ts`.
- Payload transformations and history collapse check model names in `src/core/transform.ts` and `src/core/proxy.ts`.
- Dashboard UI chips are manually listed arrays in `src/dashboard/fragments.ts`.
- External configuration loading is handled partially via `src/node.ts` (reading `~/.config/pxpipe/config.json`) and `src/core/gpt-model-profiles.ts` (reading `PXPIPE_GPT_PROFILES`).

This report provides an exhaustive inventory of all existing hardcoded checks, data structures, and config loading logic, and defines the complete interface design and integration plan for `src/core/model-registry.ts`.

---

## 2. Audit of Existing Model Handling Across Core Files

### 2.1 `src/core/model-pricing.ts`
- **Purpose**: Resolves provider-aware API list-price equivalents (`ModelRateCard`) for token telemetry and cost accounting.
- **Model Normalization**:
  - `normalizeModelName(model: string)`:
    - Strips provider prefixes: `openai`, `anthropic`, `google`, `x-ai`, `xai`, `moonshot`, `zhipu`, `kimi`, `nvidia`.
    - Strips context/effort markers: `[1m]`, `(thinking|high|medium|med|low)`.
    - Strips suffixes: `-(thinking|high|medium|med|low|fast|stable|low-context|long-context|reason|nonreason|reasoning|reasoner|effort|thought|extended-thinking|extended|high-effort|medium-effort|low-effort|high-thinking|medium-thinking|low-thinking)`.
- **Hardcoded Checks & Rates**:
  - `resolveModelRateInternal()`:
    - `opus` -> mapped to `claude-opus-5` (Line 271).
    - `sonnet` -> mapped to `claude-sonnet-5` (Line 272).
    - `gpt-5.6-sol` / `gpt-5.6`: $5 input / $0.50 cached / $30 output ($10/$1/$45 if input > 272k). 1,050,000 context, 128,000 max output.
    - `gpt-5.6-terra`: $2.50 / $0.25 / $15.
    - `gpt-5.6-luna`: $1 / $0.10 / $6.
    - `gpt-5.4`: $2.50 / $0.25 / $15.
    - `gpt-5.5`: $5 / $0.50 / $30.
    - `claude-fable-5` / `claude-mythos-5`: $10 / $1 / $50. 1M context.
    - `claude-opus-5`: $5 / $0.50 / $25. 1M context.
    - `/claude-opus-4[.-](6|7|8)/`: $5 / $0.50 / $25. 1M context.
    - `claude-sonnet-5`: $2 / $0.20 / $10. 1M context.
    - `claude-sonnet-4.6`: $3 / $0.30 / $15. 1M context.
    - `claude-haiku-4-5`: $1 / $0.10 / $5.
    - `gemini-3.5-pro`: $3.00 / $0.30 / $15. 2M context.
    - `gemini-3.1-pro`: $2 / $0.20 / $12 ($4/$0.40/$18 > 200k). 1M context.
    - `gemini-3.5-flash` / `gemini-3.1-flash`: $1.50 / $0.15 / $9. 1M context.
    - `gemini-3.1-flash-lite`: $0.25 / $0.025 / $1.50. 1M context.
    - `grok-4.5` / `grok-4`: $2 / $0.50 / $6. 500k context.
    - `grok-4.3` / `grok-4.20`: $1.25 / $0.20 / $2.50. 1M context.
    - `deepseek-v4-flash` / `deepseek-chat` / `deepseek-reasoner`: $0.14 / $0.0028 / $0.28. 1M context, 384k max output.
    - `deepseek-v4-pro`: $0.435 / $0.003625 / $0.87. 1M context, 384k max output.
    - Moonshot (`moonshot-v1-8k|32k|128k`, `kimi-k2.7-code`, `kimi-k2.6`).
    - Zhipu (`glm-4.7-flash`, `glm-4.5-air`, `glm-4-32b-0414-128k`).
    - Open-weight / local / NVIDIA NIM handling (`gpt-oss`, `nemotron`, `llama`, `qwen`).

### 2.2 `src/core/applicability.ts`
- **Purpose**: Manages production-safe model scope and imaged-reading validation.
- **Key Logic**:
  - `DEFAULT_MODEL_BASES`: `['claude-fable-5']` (Default active scope).
  - `READER_VALIDATION`: Hardcoded table mapping model base string to `{ status: 'validated' | 'degraded' | 'unvalidated', note: string }`:
    - `claude-fable-5`: `validated`
    - `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `gpt-5.6`, `gpt-5.4`, `grok-4`, `gemini-3.5-flash`, `gemini-3.1-pro`, `gemini-3.1-flash-lite`, `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-reasoner`: `unvalidated`
    - `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `gpt-5.6-sol`, `gpt-5.5`, `grok-4.5`: `degraded`
  - `baseModelId()`: Normalizes model names by stripping prefixes (`openai`, `anthropic`, `google`, `xai`, `agy`, `codex`, `moonshot`, `zhipu`, `kimi`, `nvidia`, `hermes`, `deepseek`) and reasoning/effort suffixes.
  - `isAllowed(model)`: Checks whether `baseModelId(model)` matches an allowed base or base prefix.

### 2.3 `src/core/gpt-model-profiles.ts`
- **Purpose**: Defines GPT/Grok/Claude rasterization profiles (font, column width, maxHeightPx, vision pricing model).
- **Hardcoded Rules (`BUILTIN_RULES`)**:
  - Nano/mini patch models (`gpt-5-mini`, `o4-mini`, etc.).
  - `gpt-5.6-sol`: Spleen 5x8 font, 152 stripCols, 1932 maxHeightPx, patch vision (multiplier 1, cap 10,000).
  - Flagship `gpt-5.x`: patch vision.
  - `o1` / `o3`: tile vision (base 75, perTile 150).
  - `claude` / `anthropic` on Responses path: Anthropic slab cols (312), Anthropic max height (1568).
  - `grok-`: 152 cols, 512 maxHeightPx.
- **Config Override (`PXPIPE_GPT_PROFILES`)**: Parses JSON string from env var mapping model prefix to partial `GptModelProfile`.

### 2.4 `src/core/transform.ts` & `src/core/proxy.ts`
- `transform.ts` consumes `envStyleOverride(model)` from `gpt-model-profiles.ts` to adjust font/cell dimensions per model (e.g. `claude-opus-4-8` Legibility tuning vs `claude-fable-5` production 5x8).
- `proxy.ts` uses `isClaudeModel(model)`, `isPxpipeSupportedModel(model)`, and `isPxpipeSupportedGptModel(model)` to decide routing and eligibility.

### 2.5 `src/node.ts` & Config Loaders
- `applyConfigFileDefaults()` reads `PXPIPE_CONFIG` or `~/.config/pxpipe/config.json`.
- Extracts `models` property (array or CSV string) and sets `process.env.PXPIPE_MODELS`.
- Extracts subscription USD and billing lanes.

### 2.6 `src/dashboard/fragments.ts`
- Contains hardcoded array definitions: `MODEL_CATALOG`, `GPT_MODEL_CATALOG`, `GROK_MODEL_CATALOG`, `GEMINI_MODEL_CATALOG`, `DEEPSEEK_MODEL_CATALOG`.
- Combines these hardcoded lists into HTML toggle chip sections for the operator dashboard.

---

## 3. Specifications for Unified `src/core/model-registry.ts`

### 3.1 Profile Data Structure (`PxpipeModelProfile`)

```typescript
import type { CostStatus, ModelRateCard } from './model-pricing.js';
import type { GptModelProfile, GptRenderStyle, GptVisionCost } from './gpt-model-profiles.js';
import type { PxpipeReaderValidation } from './applicability.js';

export type ModelFamily = 'claude' | 'openai' | 'grok' | 'gemini' | 'agy' | 'nvidia' | 'deepseek' | 'moonshot' | 'zhipu' | 'local' | 'unknown';
export type ValidationStatus = 'validated' | 'degraded' | 'unvalidated';

export interface ModelPricingProfile {
  inputPerMtok?: number;
  cachedInputPerMtok?: number;
  cacheWrite5mPerMtok?: number;
  cacheWrite1hPerMtok?: number;
  outputPerMtok?: number;
  provider: ModelRateCard['provider'];
  source: string;
  costStatus?: CostStatus;
  note?: string;
}

export interface PxpipeModelProfile {
  /** Unique primary identifier (e.g. 'claude-opus-5', 'gpt-5.6-terra') */
  readonly canonicalId: string;
  /** Human-readable display label for dashboard & telemetry */
  readonly displayName: string;
  /** Model family group */
  readonly family: ModelFamily;
  /** Imaged-reading benchmark status */
  readonly status: ValidationStatus;
  /** Imaged-reading benchmark notes or findings */
  readonly validationNote?: string;
  /** Default active status if PXPIPE_MODELS is unset */
  readonly enabledByDefault: boolean;
  /** Rate card economics */
  readonly pricing: ModelPricingProfile;
  /** Rasterization and visual rendering profile */
  readonly renderProfile: GptModelProfile;
  /** Upstream context token limit */
  readonly contextWindowTokens: number;
  /** Upstream max output token limit */
  readonly maxOutputTokens?: number;
  /** Whether factsheet precision token extraction is enabled */
  readonly factsheetEnabled: boolean;
  /** Match rules (exact strings or regexes) for incoming model identifiers */
  readonly aliases: readonly (string | RegExp)[];
}
```

### 3.2 Target Model Catalog Coverage (Across All Active Families)

1. **Claude Family**:
   - `claude-fable-5`: Canonical, 1M context, 128k max output, status `validated`. Enabled by default.
   - `claude-opus-5`: Canonical, 1M context, 128k max output, status `unvalidated`. Aliases: `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`, `/claude-opus-4[.-](6|7|8)/`.
   - `claude-sonnet-5`: Canonical, 1M context, 128k max output, status `unvalidated`. Alias: `sonnet`.
   - `claude-haiku-4-5`: Canonical, status `unvalidated`. Alias: `claude-haiku-4.5`.

2. **OpenAI / Codex Family**:
   - `gpt-5.6-sol`: Canonical, status `degraded`, Spleen 5x8 font, patch vision.
   - `gpt-5.6-terra`: Canonical, status `unvalidated`.
   - `gpt-5.6-luna`: Canonical, status `unvalidated`.
   - `gpt-5.5`: Canonical, status `degraded`.
   - `gpt-5.4`: Canonical, status `unvalidated`.
   - `gpt-5.3-codex`: Canonical, status `unvalidated`.

3. **Grok Family**:
   - `grok-4.5`: Canonical, status `degraded`, 500k context.
   - `grok-4.3`: Canonical, status `unvalidated`, 1M context.
   - `grok-4`: Canonical, status `unvalidated`, 500k context.

4. **AGY Proxy Family**:
   - `agy-gemini-3.6-flash-high`: Canonical, 2M context, status `unvalidated`.
   - `agy-gemini-3.6-flash-medium`: Canonical, status `unvalidated`.
   - `agy-gemini-3.6-flash-low`: Canonical, status `unvalidated`.
   - `agy-gemini-3.5-flash-high`: Canonical, status `unvalidated`.
   - `agy-gemini-3.1-pro-high`: Canonical, status `unvalidated`.
   - `agy-claude-opus-4.6-thinking`: Canonical, status `unvalidated`.
   - `agy-claude-sonnet-4.6-thinking`: Canonical, status `unvalidated`.
   - `agy-gpt-oss-120b-medium`: Canonical, status `unvalidated`.

5. **Gemini / Google Family**:
   - `gemini-3.6-flash`: Canonical, 1M context, status `unvalidated`.
   - `gemini-3.5-flash`: Canonical, 1M context, status `unvalidated`.
   - `gemini-3.1-pro`: Canonical, 1M context, status `unvalidated`.
   - `gemini-3.1-flash-lite`: Canonical, 1M context, status `unvalidated`.

6. **NVIDIA NIM Family**:
   - `nvidia/nemotron-3-super-120b-a12b`: Canonical, status `unvalidated`.
   - `meta/llama-3.3-70b-instruct`: Canonical, status `unvalidated`.
   - `openai/gpt-oss-120b`: Canonical, status `unvalidated`.
   - `qwen/qwen3.5-397b-a17b`: Canonical, status `unvalidated`.
   - `z-ai/glm-5.2`: Canonical, status `unvalidated`.

7. **DeepSeek Family**:
   - `deepseek-v4-pro`: Canonical, 1M context, 384k max output, status `unvalidated`.
   - `deepseek-v4-flash`: Canonical, 1M context, 384k max output, status `unvalidated`. Aliases: `deepseek-chat`.
   - `deepseek-reasoner`: Canonical, 1M context, 384k max output, status `unvalidated`.

---

## 4. Integration Plan with Core Modules

1. **`src/core/model-registry.ts`**:
   - Exports `getModelProfile(modelId: string): PxpipeModelProfile`
   - Exports `getAllProfiles(): readonly PxpipeModelProfile[]`
   - Exports `getProfilesByFamily(family: ModelFamily): readonly PxpipeModelProfile[]`
   - Handles resolution of raw request model strings (`claude-opus-4-8` -> returns `claude-opus-5` profile with appropriate canonical mapping).

2. **Refactoring Existing Modules**:
   - **`model-pricing.ts`**: `resolveModelRate` queries `model-registry.ts` for rates and metadata instead of evaluating nested `if` statements.
   - **`applicability.ts`**: `readerValidation` and allowed model checks query `model-registry.ts`.
   - **`gpt-model-profiles.ts`**: `resolveGptProfile` delegates to `model-registry.ts`.
   - **`dashboard/fragments.ts`**: Dynamically generates family toggle sections by iterating over `getProfilesByFamily()`.

3. **JSON Configuration Overrides (`PXPIPE_CONFIG` / `config.json`)**:
   - `applyConfigFileDefaults()` in `src/node.ts` (or `model-registry.ts` directly) parses custom profile overrides in `config.json`:
     ```json
     {
       "models": "claude-fable-5,gpt-5.6-sol",
       "model_profiles": {
         "claude-opus-5": {
           "pricing": { "inputPerMtok": 4.5 },
           "contextWindowTokens": 1200000
         }
       }
     }
     ```
   - Configuration overrides are layered on top of the built-in model registry dynamically at runtime.
