# Original User Request

## 2026-07-26T20:16:49Z

<USER_REQUEST>
Implement a unified, per-model configuration registry in PXPipe (`src/core/model-registry.ts`) where EVERY model across Claude Code, Codex, Grok, AGY Proxy, Gemini, and the complete 102-model NVIDIA NIM catalog has its own isolated profile with distinct pricing, render profile, applicability status, reasoning/effort settings, and dynamic prefix/alias matches. Inbound requests from any CLI resolve to their dedicated model profile without hardcoded cross-model leaking.

Working directory: C:\Projects\pxpipe
Integrity mode: development

## Requirements

### R1. Unified Per-Model Configuration Registry with Dynamic Prefix Resolver
Create `src/core/model-registry.ts` defining `PxpipeModelProfile` for every model across all active model families:
1. **Claude Family**: `claude-fable-5` (1M), `claude-opus-5` (1M), `claude-sonnet-5` (1M), `claude-haiku-4-5`, plus alias mappings (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus` -> `claude-opus-5`).
2. **OpenAI / Codex Family**: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`.
3. **Grok Family**: `grok-4.5`, `grok-4.3`, `grok-4`.
4. **AGY Proxy Family**: `agy-gemini-3.6-flash-high`, `agy-gemini-3.6-flash-medium`, `agy-gemini-3.6-flash-low`, `agy-gemini-3.5-flash-high`, `agy-gemini-3.1-pro-high`, `agy-claude-opus-4.6-thinking`, `agy-claude-sonnet-4.6-thinking`, `agy-gpt-oss-120b-medium`.
5. **NVIDIA NIM Family (Dynamic `nvidia/*`, `deepseek-ai/*`, `meta/*`, `mistralai/*`, `openai/gpt-oss-*`)**:
   - High-tier flagship models: `nvidia/nemotron-3-ultra-550b-a55b` (550B), `nvidia/llama-3.1-nemotron-ultra-253b-v1` (253B), `nvidia/nemotron-3-super-120b-a12b` (120B), `nvidia/nemotron-4-340b-instruct` (340B), `nvidia/llama-3.3-nemotron-super-49b-v1.5`, `deepseek-ai/deepseek-v4-pro`, `deepseek-ai/deepseek-v4-flash`, `meta/llama-3.3-70b-instruct`, `mistralai/mistral-large-2-instruct`, `openai/gpt-oss-120b`, `bigcode/starcoder2-15b`.
   - Include dynamic prefix matching (`nvidia/*`, `deepseek-ai/*`, `mistralai/*`) so all 102 NIM catalog models resolve automatically.

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
Render per-family sections (Claude, OpenAI/Codex, Grok, AGY Proxy, NVIDIA NIM Flagships) with individual toggle chips for every model. Allow the operator to enable/disable compression on any model independently.

### R4. Test Suite Verification & Daemon Reload
- Update existing test files (`tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/transform.ts`) to test per-model profile resolution across all model families.
- Ensure `pnpm test` and `npx tsc --noEmit` exit code 0.
- Build `dist/node.js` (`pnpm run build`), restart `TraderBotPxpipeProxy` (port 47821), and run integration verification tests.

## Acceptance Criteria

### Registry & Model Resolution
- [ ] `resolveModelProfile('claude-opus-4-8')` -> returns `claude-opus-5` profile ($5/$0.50/$25, 1M context, Opus render profile).
- [ ] `resolveModelProfile('agy-gemini-3.6-flash-high')` -> returns `agy-gemini-3.6-flash-high` profile ($0.15/$0.0375/$0.60, 2M context).
- [ ] `resolveModelProfile('nvidia/nemotron-3-ultra-550b-a55b')` -> returns 550B Nemotron NIM profile.
- [ ] `resolveModelProfile('meta/llama-3.3-70b-instruct')` -> returns Llama 3.3 NIM profile.

### Build & Tests
- [ ] `npx tsc --noEmit` passes with 0 errors.
- [ ] `pnpm test` passes all unit tests.
- [ ] `pnpm run build` generates `dist/node.js`.

### Dashboard & Proxy Integration
- [ ] `http://127.0.0.1:47821/fragments/models` renders per-model toggles for all families (Claude, OpenAI, Grok, AGY, NVIDIA NIM).
- [ ] PXPipe proxy restarted and verified healthy on port 47821.
</USER_REQUEST>

## 2026-07-26T20:27:55Z

<USER_REQUEST>
Implement a unified, per-model configuration registry in PXPipe (`src/core/model-registry.ts`) where EVERY model across Claude Code, Codex, Grok, AGY Proxy, Gemini, and the complete 102-model NVIDIA NIM catalog has its own isolated profile with distinct pricing, render profile, applicability status, reasoning/effort settings, AND ACCURATE CONTEXT WINDOW LENGTHS (eliminating hardcoded 128k errors).

Working directory: C:\Projects\pxpipe
Integrity mode: development

## Requirements

### R1. Unified Per-Model Configuration Registry with Dynamic Prefix & Accurate Context Lengths
Create `src/core/model-registry.ts` defining `PxpipeModelProfile` for every model across all active model families:
1. **Claude Family**: `claude-fable-5` (1M / 1,048,576), `claude-opus-5` (1M / 1,048,576), `claude-sonnet-5` (1M), `claude-haiku-4-5`, plus alias mappings (`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `opus` -> `claude-opus-5`).
2. **OpenAI / Codex Family**: `gpt-5.6-sol` (262,144 / 1,050,000 long), `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` (1,050,000), `gpt-5.4`, `gpt-5.3-codex`.
3. **Grok Family**: `grok-4.5` (524,288), `grok-4.3`, `grok-4`.
4. **AGY Proxy Family**: `agy-gemini-3.6-flash-high` (2,097,152 / 2M), `agy-gemini-3.5-flash-high` (2M), `agy-gemini-3.1-pro-high` (2M), `agy-claude-opus-4.6-thinking` (1M), `agy-claude-sonnet-4.6-thinking` (1M), `agy-gpt-oss-120b-medium` (128,000).
5. **NVIDIA NIM Family (Accurate Model-Specific Context Windows)**:
   - Flagship Ultra/Super models: `nvidia/nemotron-3-ultra-550b-a55b` (1,048,576 / 1M), `nvidia/llama-3.1-nemotron-ultra-253b-v1` (262,144 / 262K), `nvidia/nemotron-3-super-120b-a12b` (262,144 / 262K), `nvidia/nemotron-4-340b-instruct` (1,048,576 / 1M), `nvidia/llama-3.3-nemotron-super-49b-v1.5` (131,072 / 128K).
   - DeepSeek NIM models: `deepseek-ai/deepseek-v4-pro` (1,048,576 / 1M), `deepseek-ai/deepseek-v4-flash` (128,000), `deepseek-ai/deepseek-coder-6.7b-instruct` (128,000).
   - Llama/Mistral/Qwen/Starcoder: `meta/llama-3.3-70b-instruct` (131,072 / 128K), `mistralai/mistral-large-2-instruct` (128,000), `qwen/qwen3.5-397b-a17b` (262,144), `openai/gpt-oss-120b` (128,000), `bigcode/starcoder2-15b` (128,000).
   - Dynamic fallback resolver for `nvidia/*`, `deepseek-ai/*`, `mistralai/*`, `meta/*`: lookup explicit profile if known, else apply model-family default context length (e.g. 1M for DeepSeek/Ultra, 262K for Nemotron Super/Qwen, 128K for base Llama).

Each profile MUST store:
- `canonicalId`: string
- `displayName`: string
- `family`: `'claude' | 'openai' | 'grok' | 'gemini' | 'agy' | 'nvidia'`
- `status`: `'validated' | 'degraded' | 'unvalidated'`
- `enabledByDefault`: boolean
- `pricing`: `{ inputPerMtok, cacheWritePerMtok, cacheReadPerMtok, outputPerMtok }`
- `renderProfile`: `{ stripCols, cellWBonus, cellHBonus, maxHeightPx, style }`
- `contextWindowTokens`: number (ACCURATE per model)
- `maxOutputTokens`: number (ACCURATE per model)
- `factsheetEnabled`: boolean
- `aliases`: string[] / RegExp[]

### R2. Refactor Pricing, Applicability, & Transform Engine
Refactor `src/core/model-pricing.ts`, `src/core/applicability.ts`, `src/core/gpt-model-profiles.ts`, and `src/core/transform.ts` to consume `src/core/model-registry.ts`:
- Replace ad-hoc checks with model-registry lookup.
- Ensure contextWindowTokens returned in `resolveModelRate` matches the exact model profile.
- Ensure JSON configuration (`PXPIPE_CONFIG` / `~/.config/pxpipe/config.json`) can override individual per-model profiles at runtime.

### R3. Dashboard UI Per-Model Toggle Chips & Context Length Display
In `src/dashboard/fragments.ts`:
Render per-family sections with individual toggle chips and context length badges (e.g. `1M`, `2M`, `262K`, `128K`).

### R4. Test Suite Verification & Daemon Reload
- Update test files (`tests/model-pricing.test.ts`, `tests/proxy-usage.test.ts`, `tests/transform.ts`) to verify accurate context lengths for NIM, AGY, Gemini, Codex, Grok, and Claude models.
- Ensure `pnpm test` and `npx tsc --noEmit` exit code 0.
- Build `dist/node.js` (`pnpm run build`), restart `TraderBotPxpipeProxy` (port 47821), and run integration verification tests.

## Acceptance Criteria

### Registry & Model Resolution
- [ ] `resolveModelProfile('nvidia/nemotron-3-ultra-550b-a55b')` -> returns contextWindowTokens = 1,048,576 (1M).
- [ ] `resolveModelProfile('deepseek-ai/deepseek-v4-pro')` -> returns contextWindowTokens = 1,048,576 (1M).
- [ ] `resolveModelProfile('nvidia/nemotron-3-super-120b-a12b')` -> returns contextWindowTokens = 262,144 (262K).
- [ ] `resolveModelProfile('agy-gemini-3.6-flash-high')` -> returns contextWindowTokens = 2,097,152 (2M).

### Build & Tests
- [ ] `npx tsc --noEmit` passes with 0 errors.
- [ ] `pnpm test` passes all unit tests.
- [ ] `pnpm run build` generates `dist/node.js`.

### Dashboard & Proxy Integration
- [ ] `http://127.0.0.1:47821/fragments/models` renders accurate context length badges per model.
- [ ] PXPipe proxy restarted and verified healthy on port 47821.
</USER_REQUEST>
