# Original User Request

## 2026-07-26T19:42:16Z

<USER_REQUEST>
Audit & fix PXPipe model alias mapping, request transformation, and dashboard chip state for Claude Code `opus` requests.

Working directory: C:\Projects\pxpipe
Integrity mode: development

PXPipe proxy (port 47821) receives HTTP `/v1/messages` requests from Claude Code CLI where the model string is `claude-opus-4-8` (even when the user selects `opus` in the CLI). PXPipe must correctly map all `opus` family variants (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-5`, `opus`) to `claude-opus-5`, update pricing cards, ensure image compression eligibility checks match `claude-opus-5`, and verify end-to-end payload transformation and dashboard telemetry.

## Requirements

### R1. Comprehensive Model Alias & Normalization Fix
In `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/transform.ts`, and `src/dashboard/fragments.ts`:
Ensure all inbound Opus model identifiers (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`, `claude-opus-5`) resolve to `claude-opus-5` as the primary canonical Opus model base. Ensure model name normalization converts `claude-opus-4-8` sent by Claude Code CLI to `claude-opus-5`.

### R2. Request Transformation & Upstream Model Rewriting
In `src/core/transform.ts` and `src/core/proxy.ts`:
When a request passes through `/v1/messages` (or `/v1/responses` for Codex), ensure the model field in the forwarded upstream request body is rewritten to `claude-opus-5` when Opus 5 mapping is active.

### R3. Unit & Integration Test Suite Verification
Update `tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/reflow.test.ts`, and `tests/transform.ts` (or equivalent test files) to test `claude-opus-4-8` -> `claude-opus-5` normalization, pricing calculations, and transform behavior. Ensure `pnpm test` and `npx tsc --noEmit` pass with 0 errors.

### R4. Daemon Reload & End-to-End Verification
Build `dist/node.js` (`pnpm run build`), restart `TraderBotPxpipeProxy` scheduled task / PID, and perform an HTTP integration test verifying that a simulated POST to `http://127.0.0.1:47821/v1/messages` with `{"model": "claude-opus-4-8"}` correctly resolves to `claude-opus-5` pricing and applicability.

## Acceptance Criteria

### Model Resolution & Pricing
- [ ] `resolveModelRate('claude-opus-4-8', ...)` returns canonicalModel `claude-opus-5` with rates $5/$0.50/$25.
- [ ] `resolveModelRate('opus', ...)` returns canonicalModel `claude-opus-5`.

### Test Suite & Build
- [ ] `npx tsc --noEmit` exits code 0 with 0 type errors.
- [ ] `pnpm test` passes all unit tests.
- [ ] `pnpm run build` succeeds and updates `dist/node.js`.

### Live Integration
- [ ] PXPipe daemon process restarted and active on port 47821.
- [ ] Simulated request with `"model": "claude-opus-4-8"` logs `claude-opus-5` in `events.jsonl`.
</USER_REQUEST>

## Follow-up — 2026-07-26T23:59:34Z

<USER_REQUEST>
Implement a unified, per-model configuration registry in PXPipe (`src/core/model-registry.ts`) where EVERY model across Claude Code, Codex, Grok, AGY Proxy, Gemini, and DeepSeek has its own isolated profile with distinct pricing, render profile, applicability status, reasoning settings, and alias matches. Inbound requests from any CLI (Claude Code sending `claude-opus-4-8`, Codex sending `gpt-5.6-sol`, Grok sending `grok-4.5`, AGY sending `agy-gemini-3.6-flash-high`) resolve to their dedicated model profile without hardcoded cross-model leaking.

Working directory: C:\Projects\pxpipe
Integrity mode: development

## Requirements

### R1. Unified Per-Model Configuration Registry
Create `src/core/model-registry.ts` defining `PxpipeModelProfile` for every model across all 6 model families:
1. **Claude Family**: `claude-fable-5` (1M), `claude-opus-5` (1M), `claude-sonnet-5` (1M), `claude-haiku-4-5`, plus aliases (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`).
2. **OpenAI / Codex Family**: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`.
3. **Grok Family**: `grok-4.5`, `grok-4`.
4. **AGY / Gemini Family**: `agy-gemini-3.6-flash-high`, `agy-gemini-3.5-flash-high`, `agy-gemini-3.1-pro-high`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-pro`, `gemini-3.1-flash-lite`.
5. **DeepSeek Family**: `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-reasoner`.

Each profile MUST store:
- `canonicalId`: string
- `displayName`: string
- `family`: `'claude' | 'openai' | 'grok' | 'gemini' | 'deepseek'`
- `status`: `'validated' | 'degraded' | 'unvalidated'`
- `enabledByDefault`: boolean
- `pricing`: `{ inputPerMtok, cacheWritePerMtok, cacheReadPerMtok, outputPerMtok }`
- `renderProfile`: `{ stripCols, cellWBonus, cellHBonus, maxHeightPx, style }`
- `contextWindowTokens`: number
- `maxOutputTokens`: number
- `factsheetEnabled`: boolean
- `aliases`: string[] / RegExp[] (for matching incoming CLI model strings like `claude-opus-4-8` -> `claude-opus-5`)

### R2. Refactor Pricing, Applicability, & Transform Engine
Refactor `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/gpt-model-profiles.ts`, and `src/core/transform.ts` to consume `src/core/model-registry.ts`:
- Replace ad-hoc `if (base === 'opus')` and `/claude-opus-4[.-](6|7|8)/` regex checks with model-registry lookup.
- Ensure incoming model strings (e.g. `claude-opus-4-8` from Claude Code CLI) map to `claude-opus-5` profile while retaining per-model settings.
- Ensure JSON configuration (`PXPIPE_CONFIG` / `~/.config/pxpipe/config.json`) can override individual per-model profiles at runtime.

### R3. Dashboard UI Per-Model Toggle Chips
In `src/dashboard/fragments.ts`:
Render per-family sections (Claude, OpenAI/Codex, Grok, Gemini/AGY, DeepSeek) with individual toggle chips for every model. Allow the operator to enable/disable compression on any model independently.

### R4. Test Suite Verification & Daemon Reload
- Update existing test files (`tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/transform.ts`) to test per-model profile resolution across all 6 model families.
- Ensure `pnpm test` and `npx tsc --noEmit` exit code 0.
- Build `dist/node.js` (`pnpm run build`), restart `TraderBotPxpipeProxy` (port 47821), and run integration verification tests.

## Acceptance Criteria

### Registry & Model Resolution
- [ ] `resolveModelProfile('claude-opus-4-8')` -> returns `claude-opus-5` profile ($5/$0.50/$25, 1M context, Opus render profile).
- [ ] `resolveModelProfile('gpt-5.6-terra')` -> returns `gpt-5.6-terra` profile ($2.50/$0.25/$15).
- [ ] `resolveModelProfile('agy-gemini-3.6-flash-high')` -> returns `agy-gemini-3.6-flash-high` profile ($0.15/$0.0375/$0.60, 2M context).
- [ ] `resolveModelProfile('grok-4.5')` -> returns `grok-4.5` profile.

### Build & Tests
- [ ] `npx tsc --noEmit` passes with 0 errors.
- [ ] `pnpm test` passes all unit tests.
- [ ] `pnpm run build` generates `dist/node.js`.

### Dashboard & Proxy Integration
- [ ] `http://127.0.0.1:47821/fragments/models` renders per-model toggles for all 6 model families.
- [ ] PXPipe proxy restarted and verified healthy on port 47821.
</USER_REQUEST>

## Follow-up — 2026-07-26T20:05:00Z

<USER_REQUEST>
Implement a unified, per-model configuration registry in PXPipe (`src/core/model-registry.ts`) where EVERY model across Claude Code, Codex, Grok, AGY Proxy, Gemini, and NVIDIA NIM has its own isolated profile with distinct pricing, render profile, applicability status, reasoning/effort settings, and alias matches. Inbound requests from any CLI resolve to their dedicated model profile without hardcoded cross-model leaking.

Working directory: C:\Projects\pxpipe
Integrity mode: development

## Requirements

### R1. Unified Per-Model Configuration Registry
Create `src/core/model-registry.ts` defining `PxpipeModelProfile` for every model across all active model families:
1. **Claude Family**: `claude-fable-5` (1M), `claude-opus-5` (1M), `claude-sonnet-5` (1M), `claude-haiku-4-5`, plus alias mappings (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus`).
2. **OpenAI / Codex Family**: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`.
3. **Grok Family**: `grok-4.5`, `grok-4.3`, `grok-4`.
4. **AGY Proxy Family**: `agy-gemini-3.6-flash-high`, `agy-gemini-3.6-flash-medium`, `agy-gemini-3.6-flash-low`, `agy-gemini-3.5-flash-high`, `agy-gemini-3.1-pro-high`, `agy-claude-opus-4.6-thinking`, `agy-claude-sonnet-4.6-thinking`, `agy-gpt-oss-120b-medium`.
5. **NVIDIA NIM Family**: `nvidia/nemotron-3-super-120b-a12b`, `meta/llama-3.3-70b-instruct`, `openai/gpt-oss-120b`, `qwen/qwen3.5-397b-a17b`, `z-ai/glm-5.2`.

Each profile MUST store:
- `canonicalId`: string
- `displayName`: string
- `family`: `'claude' | 'openai' | 'grok' | 'gemini' | 'agy' | 'nvidia'`
- `status`: `'validated' | 'degraded' | 'unvalidated'`
- `enabledByDefault`: boolean
- `pricing`: `{ inputPerMtok, cacheWritePerMtok, cacheReadPerMtok, outputPerMtok }`
- `renderProfile`: `{ stripCols, cellWBonus, cellHBonus, maxHeightPx, style }`
- `contextWindowTokens`: number
- `maxOutputTokens`: number
- `factsheetEnabled`: boolean
- `aliases`: string[] / RegExp[] (for matching incoming CLI model strings like `claude-opus-4-8` -> `claude-opus-5`)

### R2. Refactor Pricing, Applicability, & Transform Engine
Refactor `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/gpt-model-profiles.ts`, and `src/core/transform.ts` to consume `src/core/model-registry.ts`:
- Replace ad-hoc checks with model-registry lookup.
- Ensure incoming model strings (e.g. `claude-opus-4-8` from Claude Code CLI) map to `claude-opus-5` profile while retaining per-model settings.
- Ensure JSON configuration (`PXPIPE_CONFIG` / `~/.config/pxpipe/config.json`) can override individual per-model profiles at runtime.

### R3. Dashboard UI Per-Model Toggle Chips
In `src/dashboard/fragments.ts`:
Render per-family sections (Claude, OpenAI/Codex, Grok, AGY Proxy, NVIDIA NIM) with individual toggle chips for every model. Allow the operator to enable/disable compression on any model independently.

### R4. Test Suite Verification & Daemon Reload
- Update existing test files (`tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/transform.ts`) to test per-model profile resolution across all model families.
- Ensure `pnpm test` and `npx tsc --noEmit` exit code 0.
- Build `dist/node.js` (`pnpm run build`), restart `TraderBotPxpipeProxy` (port 47821), and run integration verification tests.

## Acceptance Criteria

### Registry & Model Resolution
- [ ] `resolveModelProfile('claude-opus-4-8')` -> returns `claude-opus-5` profile ($5/$0.50/$25, 1M context, Opus render profile).
- [ ] `resolveModelProfile('agy-gemini-3.6-flash-high')` -> returns `agy-gemini-3.6-flash-high` profile ($0.15/$0.0375/$0.60, 2M context).
- [ ] `resolveModelProfile('nvidia/nemotron-3-super-120b-a12b')` -> returns NVIDIA NIM profile.

### Build & Tests
- [ ] `npx tsc --noEmit` passes with 0 errors.
- [ ] `pnpm test` passes all unit tests.
- [ ] `pnpm run build` generates `dist/node.js`.

### Dashboard & Proxy Integration
- [ ] `http://127.0.0.1:47821/fragments/models` renders per-model toggles for all families (Claude, OpenAI, Grok, AGY, NVIDIA NIM).
- [ ] PXPipe proxy restarted and verified healthy on port 47821.
</USER_REQUEST>
