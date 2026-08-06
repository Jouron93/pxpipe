## 2026-07-26T20:06:16Z

You are Worker 1 for Milestone M1 (Core Model Registry).
Your working directory is: C:\Projects\pxpipe\.agents\worker_m1_1
You MUST read:
1. C:\Projects\pxpipe\.agents\ORIGINAL_REQUEST.md
2. C:\Projects\pxpipe\PROJECT.md

OBJECTIVE:
Create `src/core/model-registry.ts` in `C:\Projects\pxpipe` defining the unified per-model configuration registry.

REQUIREMENTS FOR `src/core/model-registry.ts`:
1. Types & Interfaces:
   - `export type ModelFamily = 'claude' | 'openai' | 'grok' | 'gemini' | 'agy' | 'nvidia' | 'deepseek';`
   - `export type ModelStatus = 'validated' | 'degraded' | 'unvalidated';`
   - `export interface ModelPricing { inputPerMtok: number; cacheWritePerMtok: number; cacheReadPerMtok: number; outputPerMtok: number; cacheWrite5mPerMtok?: number; cacheWrite1hPerMtok?: number; }`
   - `export interface ModelRenderProfile { stripCols: number; cellWBonus: number; cellHBonus: number; maxHeightPx: number; style: 'box-drawing' | 'rounded' | 'ascii' | 'compact'; }`
   - `export interface PxpipeModelProfile { canonicalId: string; displayName: string; family: ModelFamily; status: ModelStatus; enabledByDefault: boolean; pricing: ModelPricing; renderProfile: ModelRenderProfile; contextWindowTokens: number; maxOutputTokens: number; factsheetEnabled: boolean; aliases: (string | RegExp)[]; reasoningEnabled?: boolean; defaultReasoningEffort?: string; }`

2. Catalog of Model Profiles across all required families:
   - **Claude Family**:
     - `claude-fable-5`: Fable 5, pricing $3/$0.30/$15, 1M context, max 128k output, aliases `['fable']`.
     - `claude-opus-5`: Opus 5, pricing $5/$0.50/$25 (cacheWrite5m 6.25, cacheWrite1h 10), 1M context, max 128k output, aliases `['opus', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', /^claude-opus-4[.-][678]$/]`.
     - `claude-sonnet-5`: Sonnet 5, pricing $3/$0.30/$15, 1M context, max 128k output, aliases `['sonnet', 'claude-sonnet-4-6', /^claude-sonnet-4/ ]`.
     - `claude-haiku-4-5`: Haiku 4.5, pricing $0.80/$0.08/$4, 200k context, max 8192 output, aliases `['haiku', 'claude-haiku']`.
   - **OpenAI / Codex Family**:
     - `gpt-5.6-sol`: Sol 5.6, pricing $3/$0.30/$15, 1M context, max 128k output, aliases `['sol']`.
     - `gpt-5.6-terra`: Terra 5.6, pricing $2.50/$0.25/$12.50, 1M context, max 128k output, aliases `['terra']`.
     - `gpt-5.6-luna`: Luna 5.6, pricing $1.50/$0.15/$7.50, 500k context, max 64k output, aliases `['luna']`.
     - `gpt-5.5`: GPT-5.5, pricing $2/$0.20/$10, 500k context, max 64k output, aliases `['gpt-5.5-codex']`.
     - `gpt-5.4`: GPT-5.4, pricing $1.50/$0.15/$7.50, 250k context, max 32k output.
     - `gpt-5.3-codex`: GPT-5.3 Codex, pricing $1.50/$0.15/$7.50, 250k context, max 32k output.
   - **Grok Family**:
     - `grok-4.5`: Grok 4.5, pricing $2/$0.20/$10, 500k context, max 64k output.
     - `grok-4.3`: Grok 4.3, pricing $1.50/$0.15/$7.50, 250k context, max 32k output.
     - `grok-4`: Grok 4, pricing $1/$0.10/$5, 128k context, max 16k output.
   - **AGY / Gemini Family**:
     - `agy-gemini-3.6-flash-high`: AGY Gemini 3.6 Flash High, pricing $0.15/$0.0375/$0.60, 2M context, max 64k output.
     - `agy-gemini-3.6-flash-medium`: AGY Gemini 3.6 Flash Med, pricing $0.15/$0.0375/$0.60, 2M context, max 64k output.
     - `agy-gemini-3.6-flash-low`: AGY Gemini 3.6 Flash Low, pricing $0.15/$0.0375/$0.60, 2M context, max 64k output.
     - `agy-gemini-3.5-flash-high`: AGY Gemini 3.5 Flash High, pricing $0.15/$0.0375/$0.60, 1M context, max 32k output.
     - `agy-gemini-3.1-pro-high`: AGY Gemini 3.1 Pro High, pricing $1.25/$0.3125/$5, 2M context, max 32k output.
     - `agy-claude-opus-4.6-thinking`: AGY Opus 4.6 Thinking, pricing $5/$0.50/$25, 1M context, max 128k output.
     - `agy-claude-sonnet-4.6-thinking`: AGY Sonnet 4.6 Thinking, pricing $3/$0.30/$15, 1M context, max 128k output.
     - `agy-gpt-oss-120b-medium`: AGY GPT OSS 120B Med, pricing $0.50/$0.10/$2, 500k context, max 32k output.
     - `gemini-3.6-flash`: Gemini 3.6 Flash, pricing $0.15/$0.0375/$0.60, 2M context, max 64k output.
     - `gemini-3.5-flash`: Gemini 3.5 Flash, pricing $0.15/$0.0375/$0.60, 1M context, max 32k output.
     - `gemini-3.1-pro`: Gemini 3.1 Pro, pricing $1.25/$0.3125/$5, 2M context, max 32k output.
     - `gemini-3.1-flash-lite`: Gemini 3.1 Flash Lite, pricing $0.075/$0.01875/$0.30, 1M context, max 16k output.
   - **NVIDIA NIM Family**:
     - `nvidia/nemotron-3-super-120b-a12b`: Nemotron 3 Super 120B, pricing $0.50/$0.10/$2, 256k context, max 32k output.
     - `meta/llama-3.3-70b-instruct`: Llama 3.3 70B, pricing $0.40/$0.08/$1.60, 128k context, max 16k output.
     - `openai/gpt-oss-120b`: GPT OSS 120B, pricing $0.50/$0.10/$2, 256k context, max 32k output.
     - `qwen/qwen3.5-397b-a17b`: Qwen 3.5 397B, pricing $0.80/$0.16/$3.20, 256k context, max 32k output.
     - `z-ai/glm-5.2`: GLM 5.2, pricing $0.50/$0.10/$2, 128k context, max 16k output.
   - **DeepSeek Family**:
     - `deepseek-v4-pro`: DeepSeek V4 Pro, pricing $0.50/$0.10/$2, 256k context, max 32k output.
     - `deepseek-v4-flash`: DeepSeek V4 Flash, pricing $0.15/$0.03/$0.60, 128k context, max 16k output.
     - `deepseek-reasoner`: DeepSeek Reasoner, pricing $0.55/$0.14/$2.19, 128k context, max 16k output.

3. Exported Functions:
   - `resolveModelProfile(modelIdOrAlias: string | undefined): PxpipeModelProfile`
     - Strip vendor prefixes (`anthropic/`, `openai/`, `google/`, `models/`, `x-ai/`, `xai/`, etc.) and normalization tags (`(thinking)`, `-high`, etc.).
     - Match canonicalId directly or via aliases (exact match or RegExp test).
     - Fall back to a default profile if unknown while maintaining the input canonicalId.
   - `getAllModelProfiles(): PxpipeModelProfile[]`
   - `getModelProfilesByFamily(family: ModelFamily): PxpipeModelProfile[]`
   - `loadModelRegistryOverrides(overrides?: Record<string, Partial<PxpipeModelProfile>>): void`
   - `resetModelRegistryOverrides(): void`

4. Run `npx tsc --noEmit` to verify type safety.
