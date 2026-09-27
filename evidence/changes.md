# PXPipe Evidence-First Modernization — Comprehensive Change Log (`changes.md`)

**Document Status**: Authoritative Change Log & Architectural Deliverable  
**Phase**: Phase 5 — Integration, Config Modernization & Deliverables  
**Integration Specialist**: `worker_phase4_5_integration`  
**Workspace**: `C:\Projects\pxpipe`  
**Configuration File**: `C:\Users\auron\.traderbot\pxpipe\config.json`  
**Timestamp**: 2026-09-24T11:10:00Z  

---

## 1. Executive Summary

This document provides a comprehensive, file-by-file and symbol-by-symbol record of all changes implemented across the PXPipe system during the Evidence-First Modernization campaign (Phases 0 through 5).

Every change was driven by reproducible defect identification, empirical offline benchmark measurements, or authoritative vendor specification retrieval. Zero paid live frontier API tokens were burned during testing or validation.

---

## 2. Global Architecture & Configuration Changes

### 2.1 Canonical Runtime Configuration (`C:\Users\auron\.traderbot\pxpipe\config.json`)

#### Sibling Backup Provenance:
- **Backup File**: `C:\Users\auron\.traderbot\pxpipe\config.json.bak-20260924T100310Z`
- **Backup Size**: 257,209 bytes
- **Backup SHA-256**: `a903403782d78383bb83165a0240509910765f604b22b3eb8e8af4214f778b0d`
- **Validation**: Parsed and byte-verified via Python 3.12 prior to modification.

#### Modified Sections:
1. **`modelProfiles`**:
   - Integrated verified model entries from `candidate_profiles.json` across 5 families:
     - **OpenAI Gen 6**: `gpt-6-astra` (1.05M ctx, $10/$50), `gpt-6-sol` (1.05M ctx, $2/$10), `gpt-6-luna` (1.05M ctx, $0.50/$2).
     - **OpenAI Gen 5.6 & 5.5**: `gpt-5.6-sol` (1.05M ctx, $2/$10), `gpt-5.6-terra` (1.05M ctx, $1/$4), `gpt-5.6-luna` (1.05M ctx, $0.50/$2), `gpt-5.5` (1.05M ctx, $2.50/$10).
     - **Anthropic**: `claude-opus-5-5` (1M ctx, $4/$20), `claude-sonnet-5` (1M ctx, $3/$15), `claude-fable-5-1` (1M ctx, $10/$50), `claude-haiku-4-5` (200k ctx, $0.25/$1.25).
     - **Google DeepMind**: `gemini-3.8-flash` (1M ctx, $0.75/$3.75), `gemini-3.5-flash` (1M ctx, $0.50/$2.50).
     - **xAI**: `grok-4.7` (500k ctx, $2/$6), `grok-4.6` (500k ctx, $2/$6), `grok-code-fast-1` (256k ctx, $0.20/$1.00).
     - **Local & Open Weights**: `qwen3.8:27b-obliterated` (128k ctx, $0.00/$0.00), `qwen2.5-7b-instruct` (32k ctx, $0.00/$0.00), `nemotron-nano-4b` (32k ctx, $0.00/$0.00).
   - **Gap Report Enforcement**: Candidate models `gemini-3.8-live` (non-existent upstream slug) and `gemini-omni-1.1-flash` (video-generation output model) are explicitly set to `"enabledByDefault": false` and `"status": "gap_report_unsupported"`.
2. **`imaging_profiles`**:
   - Updated geometry profiles to match empirical benchmark findings from `render-benchmark.md § 7`:
     - `gpt-6-astra`, `gpt-6-sol`, `gpt-5.6-sol`: 84 cols × 1954 px height (`stripCols: 84, maxHeightPx: 1954, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - `gpt-6-luna`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`: 152 cols × 1932 px height (`stripCols: 152, maxHeightPx: 1932, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - `claude-opus-5-5`: 172 cols × 728 px height (`stripCols: 172, maxHeightPx: 728, style: {cellWBonus: 4, cellHBonus: 4, aa: true, grid: false}`).
     - `claude-sonnet-5`, `claude-fable-5-1`: 312 cols × 728 px height (`stripCols: 312, maxHeightPx: 728, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - `claude-haiku-4-5`: 172 cols × 728 px height (`stripCols: 172, maxHeightPx: 728, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - `gemini-3.8-flash`, `gemini-3.5-flash`: 312 cols × 728 px height (`stripCols: 312, maxHeightPx: 728, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - `grok-4.7`: 84 cols × 512 px height (`stripCols: 84, maxHeightPx: 512, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - `grok-4.6`, `grok-code-fast-1`: 152 cols × 512 px height (`stripCols: 152, maxHeightPx: 512, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - `qwen3.8:27b-obliterated`: 84 cols × 512 px height (`stripCols: 84, maxHeightPx: 512, style: {cellWBonus: 0, cellHBonus: 0, aa: true, grid: false}`).
     - Maintained required `claude-opus-5` profile (`style: {cellWBonus: 4, cellHBonus: 4, aa: true, grid: false}`).
     - Excluded text-only models (`qwen2.5-7b-instruct`, `nemotron-nano-4b`) and gap report models from `imaging_profiles`.
3. **`rendering` (Recommended Architecture Snippet)**:
   - Added top-level `"rendering"` schema block establishing the global Pareto default (`spleen-5x8`, 312 cols × 728 px, `maxImageBytes: 18874368`, `maxImagesPerRequest: 100`) and family overrides (`anthropic-precise`, `openai-gen6`, `xai-grok`).
4. **`model_scope`**:
   - Stripped gap report models `gemini-3.8-live` and `gemini-omni-1.1-flash`, ensuring they cannot be activated.

---

## 3. Codebase File-by-File & Symbol-by-Symbol Changes

### 3.1 `src/node.ts` (Runtime Configuration Parser & Server Setup)
- **Symbol Added / Exported**:
  - `export interface RuntimeConfig`: Made interface public to support external tooling and typing.
  - `minBodyBytes?: number`: Added field to `RuntimeConfig`.
- **Logic Repaired**:
  - Previously, `min_body_bytes` in `config.json` was parsed only via the environment variable `PXPIPE_MIN_BODY_BYTES`, ignoring configuration file settings.
  - Modified `parseRuntimeConfig(raw: Record<string, unknown>)`:
    ```typescript
    const configMinBodyBytes = typeof raw.min_body_bytes === 'number' && Number.isFinite(raw.min_body_bytes) && raw.min_body_bytes >= 0
      ? raw.min_body_bytes
      : undefined;
    const envMinBodyBytes = parsePositiveInt(env.PXPIPE_MIN_BODY_BYTES);
    const minBodyBytes = envMinBodyBytes ?? configMinBodyBytes;
    ```
  - Threaded `minBodyBytes` into `createNodeApp({ ...config, minBodyBytes })` and `ProxyConfig`.

### 3.2 `src/core/proxy.ts` (Proxy Request Pipeline & Body Size Gate)
- **Symbol Added**:
  - `ProxyConfig.minBodyBytes?: number`: Added to configuration interface.
- **Logic Repaired**:
  - In `handleProxyRequest()`:
    ```typescript
    const minBodyBytes = config.minBodyBytes ?? 0;
    const bodyOk = minBodyBytes <= 0 || bodyIn.byteLength >= minBodyBytes;
    const effectiveOpts = (modelOk && bodyOk)
      ? transformOpts
      : { ...transformOpts, compress: false };
    ```
  - When request body is smaller than `minBodyBytes`, PXPipe cleanly skips image transformation without error and logs `skip(compress=false)`.

### 3.3 `src/core/render.ts` (Strict Image Budget Constants)
- **Symbols Added**:
  - `export const ANTHROPIC_MAX_IMAGES_WIRE = 100`: Upstream wire limit for images per request.
  - `export const MAX_DECODED_IMAGE_PAYLOAD_SOFT_BYTES = 18 * 1024 * 1024` (18 MiB).
  - `export const MAX_DECODED_IMAGE_PAYLOAD_HARD_BYTES = 20 * 1024 * 1024` (20 MiB).
- **Rationale**:
  - Prevents upstream HTTP 400 rejection on Anthropic routes when large transcripts or multiple tools are processed.

### 3.4 `src/core/transform.ts` (Dynamic Profitability Gate Overloads & Image Budgets)
- **Symbols Added**:
  - `export interface CompressionProfitabilityOptions`:
    - `textTokens: number`
    - `imageTokens: number`
    - `priorWarmTokens?: number`
    - `priorWarmImageTokens?: number`
  - `isCompressionProfitable(opts: CompressionProfitabilityOptions): boolean`: Overloaded function signature supporting precomputed token counts without string re-encoding.
- **Rationale**:
  - Enables caller pipelines to evaluate symmetric cache burn gates and multi-turn amortization without string re-tokenization.

### 3.5 `src/core/gpt-model-profiles.ts` (OpenAI Gen 6 Roster & Grok / Local Routing)
- **Symbols Added / Modified**:
  - `GptModelProfile.contextWindow?: number`
  - `GptModelProfile.outputLimit?: number`
  - `GPT6_ASTRA_PROFILE`: 1,050,000 context, 128,000 output limit, 84 cols × 1954 px, JetBrains Mono 14px.
  - `GPT6_SOL_PROFILE`: 1,050,000 context, 128,000 output limit, 84 cols × 1954 px, JetBrains Mono 14px.
  - `GPT6_LUNA_PROFILE`: 1,050,000 context, 128,000 output limit, 152 cols × 1932 px, Spleen 5x8.
  - `BUILTIN_RULES`: Placed `^gpt-6` patterns at index 0..2 before Gen 5 rules to prevent down-rewriting.

### 3.6 `src/core/claude-model-profiles.ts` (Anthropic Opus 5.5 / Sonnet 5 / Fable 5.1 & Bracket Stripping)
- **Symbols Modified**:
  - `CLAUDE_LEGACY_PROFILE`: Added `contextWindow: 200_000`, `outputLimit: 4_096`.
  - Added support for `claude-opus-5-5`, `claude-sonnet-5`, and bracketed context suffixes (`[1m]`, `[200k]`, `[fast]`) ensuring `isPre47Claude` returns `false` and models receive 1568×728 px high-res treatment.

### 3.7 `src/core/gemini-model-profiles.ts` (Gemini 3.8 Flash & 3.5 Flash Profiles)
- **Symbols Added**:
  - `GEMINI_3_5_FLASH_PROFILE`: 1,048,576 ctx, 65,536 output, 32 image cap, 312 cols × 728 px.
  - `GEMINI_3_8_LIVE_PROFILE`: Retained as unsupported stub.
  - `GEMINI_OMNI_1_1_FLASH_PROFILE`: Retained as unsupported video model stub.

### 3.8 `src/core/usage-accounting.ts` (Provider Cache Usage Extraction)
- **New Module**: `src/core/usage-accounting.ts`
- **Symbols Exported**:
  - `extractUsageTokens(provider: string, usage: Record<string, unknown>): ParsedUsageTokens`
  - Normalized parsing for Anthropic (`cache_read_input_tokens`, `cache_creation_input_tokens`), OpenAI (`prompt_tokens_details.cached_tokens`), Google (`cachedContentTokenCount`), xAI (`cached_tokens`), and DeepSeek (`prompt_cache_hit_tokens`).

### 3.9 `src/core/index.ts` (Re-exports)
- Re-exported `extractUsageTokens` and `ParsedUsageTokens` from `./usage-accounting.js`.

---

## 4. Test Suite Additions & Regression Protections

| Test Suite File | Test Count | Status | Purpose / Coverage Area |
|---|:---:|:---:|---|
| `tests/min-body-bytes.test.ts` | 11 | PASS | Verifies configuration parser and request pipeline enforcement of `min_body_bytes`. |
| `tests/image-budget.test.ts` | 10 | PASS | Verifies Anthropic 100-image wire limit, 18 MiB payload headroom, atomic group admission, and graceful fallback to text. |
| `tests/provider-cache-alignment.test.ts` | 11 | PASS | Verifies cache usage extraction across Anthropic, OpenAI, Gemini, Grok, and DeepSeek responses. |
| `tests/model-catalog.test.ts` | 44 | PASS | Validates candidate roster resolution, exact slug precedence, alias mapping, and pricing consistency. |
| `tests/gpt6-profiles.test.ts` | 4 | PASS | Verifies GPT-6 Astra, Sol, and Luna profile resolution, 14px geometry, and 1.05M context. |
| `tests/challenger-adversarial.test.ts` | 11 | PASS | Adversarial stress testing for bracketed suffix stripping (`[1m]`), Gen 6 down-rewrite prevention, cache marker conservation, and image headroom. |

**Full Vitest Verification**: 87 test files, 1,322 tests passing in 8.71s with zero failures.  
**TypeScript Verification**: `npx tsc --noEmit` exits 0 with zero typing errors.  
**Config Audit Verification**: `unify_pxpipe.py` exits 0 with `[PXPIPE AUDIT OK]`.
