# Milestone M1 Analysis & Complete Code Design for `src/core/model-registry.ts`

**Target File**: `src/core/model-registry.ts`  
**Milestone**: M1 (Core Model Registry)  
**Author**: Explorer agent `explorer_m1_1`  
**Date**: 2026-07-26  

---

## 1. Executive Summary

This document defines the complete, concrete code design for `src/core/model-registry.ts`, establishing a single source of truth for model profiles across all 7 model families in PXPipe (`claude`, `openai`, `grok`, `gemini`, `agy`, `nvidia`, `deepseek`).

The design replaces fragmented model checks scattered across `model-pricing.ts`, `applicability.ts`, `gpt-model-profiles.ts`, `transform.ts`, and `fragments.ts` with a unified registry API.

---

## 2. Interface Specifications

### 2.1 Types & Interfaces

```typescript
export type ModelFamily =
  | 'claude'
  | 'openai'
  | 'grok'
  | 'gemini'
  | 'agy'
  | 'nvidia'
  | 'deepseek';

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
  validationNote?: string;
  enabledByDefault: boolean;
  pricing: ModelPricing;
  renderProfile: ModelRenderProfile;
  contextWindowTokens: number;
  maxOutputTokens: number;
  factsheetEnabled: boolean;
  aliases: (string | RegExp)[];
}
```

---

## 3. Complete Model Catalog Definitions

The registry contains 33 canonical model profiles covering all active families.

### 3.1 Claude Family (4 models)
1. `claude-fable-5`
   - `displayName`: "Claude 5 Fable"
   - `family`: `'claude'`
   - `status`: `'validated'`
   - `enabledByDefault`: `true`
   - `pricing`: `{ inputPerMtok: 10.0, cacheWritePerMtok: 12.5, cacheReadPerMtok: 1.0, outputPerMtok: 50.0, cacheWrite5mPerMtok: 12.5, cacheWrite1hPerMtok: 20.0 }`
   - `renderProfile`: `{ stripCols: 312, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1568, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `true`
   - `aliases`: `['claude-fable-5', 'fable-5']`

2. `claude-opus-5`
   - `displayName`: "Claude 5 Opus"
   - `family`: `'claude'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 5.0, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 25.0, cacheWrite5mPerMtok: 6.25, cacheWrite1hPerMtok: 10.0 }`
   - `renderProfile`: `{ stripCols: 312, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1568, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `true`
   - `aliases`: `['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'opus', /claude-opus-4[.-](6|7|8)/]`

3. `claude-sonnet-5`
   - `displayName`: "Claude 5 Sonnet"
   - `family`: `'claude'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 2.0, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10.0, cacheWrite5mPerMtok: 2.5, cacheWrite1hPerMtok: 4.0 }`
   - `renderProfile`: `{ stripCols: 312, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1568, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `true`
   - `aliases`: `['claude-sonnet-5', 'sonnet']`

4. `claude-haiku-4-5`
   - `displayName`: "Claude 4.5 Haiku"
   - `family`: `'claude'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 1.0, cacheWritePerMtok: 1.25, cacheReadPerMtok: 0.1, outputPerMtok: 5.0, cacheWrite5mPerMtok: 1.25, cacheWrite1hPerMtok: 2.0 }`
   - `renderProfile`: `{ stripCols: 312, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1568, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `64_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['claude-haiku-4-5', 'claude-haiku-4.5', 'haiku']`

---

### 3.2 OpenAI / Codex Family (6 models)
1. `gpt-5.6-sol`
   - `displayName`: "GPT 5.6 Sol"
   - `family`: `'openai'`
   - `status`: `'degraded'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 5.0, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 30.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1932, style: 'box-drawing' }`
   - `contextWindowTokens`: `1_050_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `true`
   - `aliases`: `['gpt-5.6-sol', 'sol']`

2. `gpt-5.6-terra`
   - `displayName`: "GPT 5.6 Terra"
   - `family`: `'openai'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 2.5, cacheWritePerMtok: 3.125, cacheReadPerMtok: 0.25, outputPerMtok: 15.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1932, style: 'box-drawing' }`
   - `contextWindowTokens`: `1_050_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `true`
   - `aliases`: `['gpt-5.6-terra', 'terra']`

3. `gpt-5.6-luna`
   - `displayName`: "GPT 5.6 Luna"
   - `family`: `'openai'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 1.0, cacheWritePerMtok: 1.25, cacheReadPerMtok: 0.1, outputPerMtok: 6.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1932, style: 'box-drawing' }`
   - `contextWindowTokens`: `1_050_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['gpt-5.6-luna', 'luna']`

4. `gpt-5.5`
   - `displayName`: "GPT 5.5"
   - `family`: `'openai'`
   - `status`: `'degraded'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 5.0, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 30.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1932, style: 'box-drawing' }`
   - `contextWindowTokens`: `1_050_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `true`
   - `aliases`: `['gpt-5.5']`

5. `gpt-5.4`
   - `displayName`: "GPT 5.4"
   - `family`: `'openai'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 2.5, cacheWritePerMtok: 3.125, cacheReadPerMtok: 0.25, outputPerMtok: 15.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1932, style: 'box-drawing' }`
   - `contextWindowTokens`: `1_050_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['gpt-5.4']`

6. `gpt-5.3-codex`
   - `displayName`: "GPT 5.3 Codex"
   - `family`: `'openai'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 2.5, cacheWritePerMtok: 3.125, cacheReadPerMtok: 0.25, outputPerMtok: 15.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1932, style: 'box-drawing' }`
   - `contextWindowTokens`: `1_050_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['gpt-5.3-codex', 'codex-5.3']`

---

### 3.3 Grok Family (3 models)
1. `grok-4.5`
   - `displayName`: "Grok 4.5"
   - `family`: `'grok'`
   - `status`: `'degraded'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 2.0, cacheWritePerMtok: 2.0, cacheReadPerMtok: 0.5, outputPerMtok: 6.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 512, style: 'rounded' }`
   - `contextWindowTokens`: `500_000`
   - `maxOutputTokens`: `64_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['grok-4.5']`

2. `grok-4.3`
   - `displayName`: "Grok 4.3"
   - `family`: `'grok'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 1.25, cacheWritePerMtok: 1.25, cacheReadPerMtok: 0.2, outputPerMtok: 2.5 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 512, style: 'rounded' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `64_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['grok-4.3', 'grok-4.20']`

3. `grok-4`
   - `displayName`: "Grok 4"
   - `family`: `'grok'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 2.0, cacheWritePerMtok: 2.0, cacheReadPerMtok: 0.5, outputPerMtok: 6.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 512, style: 'rounded' }`
   - `contextWindowTokens`: `500_000`
   - `maxOutputTokens`: `64_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['grok-4']`

---

### 3.4 AGY Proxy & Gemini Family (12 models)
1. `agy-gemini-3.6-flash-high`
   - `displayName`: "AGY Gemini 3.6 Flash (High)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0.15, cacheWritePerMtok: 0.15, cacheReadPerMtok: 0.0375, outputPerMtok: 0.60 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `2_000_000`
   - `maxOutputTokens`: `65_536`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-gemini-3.6-flash-high', 'agy/gemini-3.6-flash-high']`

2. `agy-gemini-3.6-flash-medium`
   - `displayName`: "AGY Gemini 3.6 Flash (Medium)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0.15, cacheWritePerMtok: 0.15, cacheReadPerMtok: 0.0375, outputPerMtok: 0.60 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `2_000_000`
   - `maxOutputTokens`: `65_536`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-gemini-3.6-flash-medium', 'agy/gemini-3.6-flash-medium']`

3. `agy-gemini-3.6-flash-low`
   - `displayName`: "AGY Gemini 3.6 Flash (Low)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0.15, cacheWritePerMtok: 0.15, cacheReadPerMtok: 0.0375, outputPerMtok: 0.60 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `2_000_000`
   - `maxOutputTokens`: `65_536`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-gemini-3.6-flash-low', 'agy/gemini-3.6-flash-low']`

4. `agy-gemini-3.5-flash-high`
   - `displayName`: "AGY Gemini 3.5 Flash (High)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0.15, cacheWritePerMtok: 0.15, cacheReadPerMtok: 0.0375, outputPerMtok: 0.60 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `2_000_000`
   - `maxOutputTokens`: `65_536`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-gemini-3.5-flash-high', 'agy/gemini-3.5-flash-high']`

5. `agy-gemini-3.1-pro-high`
   - `displayName`: "AGY Gemini 3.1 Pro (High)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 2.0, cacheWritePerMtok: 2.0, cacheReadPerMtok: 0.20, outputPerMtok: 12.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `65_536`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-gemini-3.1-pro-high', 'agy/gemini-3.1-pro-high']`

6. `agy-claude-opus-4.6-thinking`
   - `displayName`: "AGY Claude Opus 4.6 (Thinking)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 5.0, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.50, outputPerMtok: 25.0 }`
   - `renderProfile`: `{ stripCols: 312, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1568, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-claude-opus-4.6-thinking', 'agy/claude-opus-4.6-thinking']`

7. `agy-claude-sonnet-4.6-thinking`
   - `displayName`: "AGY Claude Sonnet 4.6 (Thinking)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 3.0, cacheWritePerMtok: 3.75, cacheReadPerMtok: 0.30, outputPerMtok: 15.0 }`
   - `renderProfile`: `{ stripCols: 312, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1568, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `64_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-claude-sonnet-4.6-thinking', 'agy/claude-sonnet-4.6-thinking']`

8. `agy-gpt-oss-120b-medium`
   - `displayName`: "AGY GPT-OSS 120B (Medium)"
   - `family`: `'agy'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `128_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['agy-gpt-oss-120b-medium', 'agy/gpt-oss-120b-medium']`

9. `gemini-3.6-flash`
   - `displayName`: "Gemini 3.6 Flash"
   - `family`: `'gemini'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 1.5, cacheWritePerMtok: 1.5, cacheReadPerMtok: 0.15, outputPerMtok: 9.0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `65_536`
   - `factsheetEnabled`: `false`
   - `aliases`: `['gemini-3.6-flash']`

10. `gemini-3.5-flash`
    - `displayName`: "Gemini 3.5 Flash"
    - `family`: `'gemini'`
    - `status`: `'unvalidated'`
    - `enabledByDefault`: `false`
    - `pricing`: `{ inputPerMtok: 1.5, cacheWritePerMtok: 1.5, cacheReadPerMtok: 0.15, outputPerMtok: 9.0 }`
    - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
    - `contextWindowTokens`: `1_000_000`
    - `maxOutputTokens`: `65_536`
    - `factsheetEnabled`: `false`
    - `aliases`: `['gemini-3.5-flash']`

11. `gemini-3.1-pro`
    - `displayName`: "Gemini 3.1 Pro"
    - `family`: `'gemini'`
    - `status`: `'unvalidated'`
    - `enabledByDefault`: `false`
    - `pricing`: `{ inputPerMtok: 2.0, cacheWritePerMtok: 2.0, cacheReadPerMtok: 0.20, outputPerMtok: 12.0 }`
    - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
    - `contextWindowTokens`: `1_000_000`
    - `maxOutputTokens`: `65_536`
    - `factsheetEnabled`: `false`
    - `aliases`: `['gemini-3.1-pro', 'gemini-3.1-pro-preview']`

12. `gemini-3.1-flash-lite`
    - `displayName`: "Gemini 3.1 Flash Lite"
    - `family`: `'gemini'`
    - `status`: `'unvalidated'`
    - `enabledByDefault`: `false`
    - `pricing`: `{ inputPerMtok: 0.25, cacheWritePerMtok: 0.25, cacheReadPerMtok: 0.025, outputPerMtok: 1.5 }`
    - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
    - `contextWindowTokens`: `1_000_000`
    - `maxOutputTokens`: `65_536`
    - `factsheetEnabled`: `false`
    - `aliases`: `['gemini-3.1-flash-lite']`

---

### 3.5 NVIDIA NIM Family (5 models)
1. `nvidia/nemotron-3-super-120b-a12b`
   - `displayName`: "NVIDIA Nemotron 3 Super 120B"
   - `family`: `'nvidia'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'ascii' }`
   - `contextWindowTokens`: `131_072`
   - `maxOutputTokens`: `32_768`
   - `factsheetEnabled`: `false`
   - `aliases`: `['nvidia/nemotron-3-super-120b-a12b', 'nemotron-3-super-120b-a12b']`

2. `meta/llama-3.3-70b-instruct`
   - `displayName`: "Meta Llama 3.3 70B Instruct"
   - `family`: `'nvidia'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'ascii' }`
   - `contextWindowTokens`: `131_072`
   - `maxOutputTokens`: `32_768`
   - `factsheetEnabled`: `false`
   - `aliases`: `['meta/llama-3.3-70b-instruct', 'llama-3.3-70b-instruct']`

3. `openai/gpt-oss-120b`
   - `displayName`: "OpenAI GPT-OSS 120B"
   - `family`: `'nvidia'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'ascii' }`
   - `contextWindowTokens`: `131_072`
   - `maxOutputTokens`: `32_768`
   - `factsheetEnabled`: `false`
   - `aliases`: `['openai/gpt-oss-120b', 'gpt-oss-120b']`

4. `qwen/qwen3.5-397b-a17b`
   - `displayName`: "Qwen 3.5 397B A17B"
   - `family`: `'nvidia'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'ascii' }`
   - `contextWindowTokens`: `131_072`
   - `maxOutputTokens`: `32_768`
   - `factsheetEnabled`: `false`
   - `aliases`: `['qwen/qwen3.5-397b-a17b', 'qwen3.5-397b-a17b']`

5. `z-ai/glm-5.2`
   - `displayName`: "Z-AI GLM 5.2"
   - `family`: `'nvidia'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'ascii' }`
   - `contextWindowTokens`: `131_072`
   - `maxOutputTokens`: `32_768`
   - `factsheetEnabled`: `false`
   - `aliases`: `['z-ai/glm-5.2', 'glm-5.2']`

---

### 3.6 DeepSeek Family (3 models)
1. `deepseek-v4-pro`
   - `displayName`: "DeepSeek V4 Pro"
   - `family`: `'deepseek'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0.435, cacheWritePerMtok: 0.435, cacheReadPerMtok: 0.003625, outputPerMtok: 0.87 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `384_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['deepseek-v4-pro']`

2. `deepseek-v4-flash`
   - `displayName`: "DeepSeek V4 Flash"
   - `family`: `'deepseek'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0.14, cacheWritePerMtok: 0.14, cacheReadPerMtok: 0.0028, outputPerMtok: 0.28 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `384_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['deepseek-v4-flash', 'deepseek-chat']`

3. `deepseek-reasoner`
   - `displayName`: "DeepSeek Reasoner"
   - `family`: `'deepseek'`
   - `status`: `'unvalidated'`
   - `enabledByDefault`: `false`
   - `pricing`: `{ inputPerMtok: 0.14, cacheWritePerMtok: 0.14, cacheReadPerMtok: 0.0028, outputPerMtok: 0.28 }`
   - `renderProfile`: `{ stripCols: 152, cellWBonus: 0, cellHBonus: 0, maxHeightPx: 1024, style: 'compact' }`
   - `contextWindowTokens`: `1_000_000`
   - `maxOutputTokens`: `384_000`
   - `factsheetEnabled`: `false`
   - `aliases`: `['deepseek-reasoner', 'deepseek-r1']`

---

## 4. Complete Code Implementation for `src/core/model-registry.ts`

```typescript
/**
 * src/core/model-registry.ts
 * Unified Per-Model Configuration Registry for PXPipe proxy.
 */

export type ModelFamily =
  | 'claude'
  | 'openai'
  | 'grok'
  | 'gemini'
  | 'agy'
  | 'nvidia'
  | 'deepseek';

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
  validationNote?: string;
  enabledByDefault: boolean;
  pricing: ModelPricing;
  renderProfile: ModelRenderProfile;
  contextWindowTokens: number;
  maxOutputTokens: number;
  factsheetEnabled: boolean;
  aliases: (string | RegExp)[];
}

const BUILTIN_PROFILES: PxpipeModelProfile[] = [
  // --- Claude Family ---
  {
    canonicalId: 'claude-fable-5',
    displayName: 'Claude 5 Fable',
    family: 'claude',
    status: 'validated',
    validationNote: '100/100 novel arithmetic, 13/15 verbatim, 98/98 gist parity',
    enabledByDefault: true,
    pricing: {
      inputPerMtok: 10.0,
      cacheWritePerMtok: 12.5,
      cacheReadPerMtok: 1.0,
      outputPerMtok: 50.0,
      cacheWrite5mPerMtok: 12.5,
      cacheWrite1hPerMtok: 20.0,
    },
    renderProfile: {
      stripCols: 312,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1568,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['claude-fable-5', 'fable-5'],
  },
  {
    canonicalId: 'claude-opus-5',
    displayName: 'Claude 5 Opus',
    family: 'claude',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 5.0,
      cacheWritePerMtok: 6.25,
      cacheReadPerMtok: 0.5,
      outputPerMtok: 25.0,
      cacheWrite5mPerMtok: 6.25,
      cacheWrite1hPerMtok: 10.0,
    },
    renderProfile: {
      stripCols: 312,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1568,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'opus',
      /claude-opus-4[.-](6|7|8)/,
    ],
  },
  {
    canonicalId: 'claude-sonnet-5',
    displayName: 'Claude 5 Sonnet',
    family: 'claude',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.0,
      cacheWritePerMtok: 2.5,
      cacheReadPerMtok: 0.2,
      outputPerMtok: 10.0,
      cacheWrite5mPerMtok: 2.5,
      cacheWrite1hPerMtok: 4.0,
    },
    renderProfile: {
      stripCols: 312,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1568,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['claude-sonnet-5', 'sonnet'],
  },
  {
    canonicalId: 'claude-haiku-4-5',
    displayName: 'Claude 4.5 Haiku',
    family: 'claude',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 1.0,
      cacheWritePerMtok: 1.25,
      cacheReadPerMtok: 0.1,
      outputPerMtok: 5.0,
      cacheWrite5mPerMtok: 1.25,
      cacheWrite1hPerMtok: 2.0,
    },
    renderProfile: {
      stripCols: 312,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1568,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['claude-haiku-4-5', 'claude-haiku-4.5', 'haiku'],
  },

  // --- OpenAI / Codex Family ---
  {
    canonicalId: 'gpt-5.6-sol',
    displayName: 'GPT 5.6 Sol',
    family: 'openai',
    status: 'degraded',
    validationNote: '98/100 arithmetic but 0/15 dense-hex',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 5.0,
      cacheWritePerMtok: 6.25,
      cacheReadPerMtok: 0.5,
      outputPerMtok: 30.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1932,
      style: 'box-drawing',
    },
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.6-sol', 'sol'],
  },
  {
    canonicalId: 'gpt-5.6-terra',
    displayName: 'GPT 5.6 Terra',
    family: 'openai',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.5,
      cacheWritePerMtok: 3.125,
      cacheReadPerMtok: 0.25,
      outputPerMtok: 15.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1932,
      style: 'box-drawing',
    },
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.6-terra', 'terra'],
  },
  {
    canonicalId: 'gpt-5.6-luna',
    displayName: 'GPT 5.6 Luna',
    family: 'openai',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 1.0,
      cacheWritePerMtok: 1.25,
      cacheReadPerMtok: 0.1,
      outputPerMtok: 6.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1932,
      style: 'box-drawing',
    },
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: ['gpt-5.6-luna', 'luna'],
  },
  {
    canonicalId: 'gpt-5.5',
    displayName: 'GPT 5.5',
    family: 'openai',
    status: 'degraded',
    validationNote: 'degrades on imaged history/context',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 5.0,
      cacheWritePerMtok: 6.25,
      cacheReadPerMtok: 0.5,
      outputPerMtok: 30.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1932,
      style: 'box-drawing',
    },
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.5'],
  },
  {
    canonicalId: 'gpt-5.4',
    displayName: 'GPT 5.4',
    family: 'openai',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.5,
      cacheWritePerMtok: 3.125,
      cacheReadPerMtok: 0.25,
      outputPerMtok: 15.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1932,
      style: 'box-drawing',
    },
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: ['gpt-5.4'],
  },
  {
    canonicalId: 'gpt-5.3-codex',
    displayName: 'GPT 5.3 Codex',
    family: 'openai',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.5,
      cacheWritePerMtok: 3.125,
      cacheReadPerMtok: 0.25,
      outputPerMtok: 15.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1932,
      style: 'box-drawing',
    },
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: ['gpt-5.3-codex', 'codex-5.3'],
  },

  // --- Grok Family ---
  {
    canonicalId: 'grok-4.5',
    displayName: 'Grok 4.5',
    family: 'grok',
    status: 'degraded',
    validationNote: '82/100 arithmetic, 83/98 gist',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.0,
      cacheWritePerMtok: 2.0,
      cacheReadPerMtok: 0.5,
      outputPerMtok: 6.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 512,
      style: 'rounded',
    },
    contextWindowTokens: 500_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['grok-4.5'],
  },
  {
    canonicalId: 'grok-4.3',
    displayName: 'Grok 4.3',
    family: 'grok',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 1.25,
      cacheWritePerMtok: 1.25,
      cacheReadPerMtok: 0.2,
      outputPerMtok: 2.5,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 512,
      style: 'rounded',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['grok-4.3', 'grok-4.20'],
  },
  {
    canonicalId: 'grok-4',
    displayName: 'Grok 4',
    family: 'grok',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.0,
      cacheWritePerMtok: 2.0,
      cacheReadPerMtok: 0.5,
      outputPerMtok: 6.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 512,
      style: 'rounded',
    },
    contextWindowTokens: 500_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['grok-4'],
  },

  // --- AGY Proxy & Gemini Family ---
  {
    canonicalId: 'agy-gemini-3.6-flash-high',
    displayName: 'AGY Gemini 3.6 Flash (High)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.15,
      cacheWritePerMtok: 0.15,
      cacheReadPerMtok: 0.0375,
      outputPerMtok: 0.6,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 2_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy-gemini-3.6-flash-high', 'agy/gemini-3.6-flash-high'],
  },
  {
    canonicalId: 'agy-gemini-3.6-flash-medium',
    displayName: 'AGY Gemini 3.6 Flash (Medium)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.15,
      cacheWritePerMtok: 0.15,
      cacheReadPerMtok: 0.0375,
      outputPerMtok: 0.6,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 2_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy-gemini-3.6-flash-medium', 'agy/gemini-3.6-flash-medium'],
  },
  {
    canonicalId: 'agy-gemini-3.6-flash-low',
    displayName: 'AGY Gemini 3.6 Flash (Low)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.15,
      cacheWritePerMtok: 0.15,
      cacheReadPerMtok: 0.0375,
      outputPerMtok: 0.6,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 2_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy-gemini-3.6-flash-low', 'agy/gemini-3.6-flash-low'],
  },
  {
    canonicalId: 'agy-gemini-3.5-flash-high',
    displayName: 'AGY Gemini 3.5 Flash (High)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.15,
      cacheWritePerMtok: 0.15,
      cacheReadPerMtok: 0.0375,
      outputPerMtok: 0.6,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 2_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy-gemini-3.5-flash-high', 'agy/gemini-3.5-flash-high'],
  },
  {
    canonicalId: 'agy-gemini-3.1-pro-high',
    displayName: 'AGY Gemini 3.1 Pro (High)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.0,
      cacheWritePerMtok: 2.0,
      cacheReadPerMtok: 0.2,
      outputPerMtok: 12.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy-gemini-3.1-pro-high', 'agy/gemini-3.1-pro-high'],
  },
  {
    canonicalId: 'agy-claude-opus-4.6-thinking',
    displayName: 'AGY Claude Opus 4.6 (Thinking)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 5.0,
      cacheWritePerMtok: 6.25,
      cacheReadPerMtok: 0.5,
      outputPerMtok: 25.0,
    },
    renderProfile: {
      stripCols: 312,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1568,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: [
      'agy-claude-opus-4.6-thinking',
      'agy/claude-opus-4.6-thinking',
    ],
  },
  {
    canonicalId: 'agy-claude-sonnet-4.6-thinking',
    displayName: 'AGY Claude Sonnet 4.6 (Thinking)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 3.0,
      cacheWritePerMtok: 3.75,
      cacheReadPerMtok: 0.3,
      outputPerMtok: 15.0,
    },
    renderProfile: {
      stripCols: 312,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1568,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: [
      'agy-claude-sonnet-4.6-thinking',
      'agy/claude-sonnet-4.6-thinking',
    ],
  },
  {
    canonicalId: 'agy-gpt-oss-120b-medium',
    displayName: 'AGY GPT-OSS 120B (Medium)',
    family: 'agy',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0,
      cacheWritePerMtok: 0,
      cacheReadPerMtok: 0,
      outputPerMtok: 0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: ['agy-gpt-oss-120b-medium', 'agy/gpt-oss-120b-medium'],
  },
  {
    canonicalId: 'gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash',
    family: 'gemini',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 1.5,
      cacheWritePerMtok: 1.5,
      cacheReadPerMtok: 0.15,
      outputPerMtok: 9.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['gemini-3.6-flash'],
  },
  {
    canonicalId: 'gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    family: 'gemini',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 1.5,
      cacheWritePerMtok: 1.5,
      cacheReadPerMtok: 0.15,
      outputPerMtok: 9.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['gemini-3.5-flash'],
  },
  {
    canonicalId: 'gemini-3.1-pro',
    displayName: 'Gemini 3.1 Pro',
    family: 'gemini',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 2.0,
      cacheWritePerMtok: 2.0,
      cacheReadPerMtok: 0.2,
      outputPerMtok: 12.0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['gemini-3.1-pro', 'gemini-3.1-pro-preview'],
  },
  {
    canonicalId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    family: 'gemini',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.25,
      cacheWritePerMtok: 0.25,
      cacheReadPerMtok: 0.025,
      outputPerMtok: 1.5,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['gemini-3.1-flash-lite'],
  },

  // --- NVIDIA NIM Family ---
  {
    canonicalId: 'nvidia/nemotron-3-super-120b-a12b',
    displayName: 'NVIDIA Nemotron 3 Super 120B',
    family: 'nvidia',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0,
      cacheWritePerMtok: 0,
      cacheReadPerMtok: 0,
      outputPerMtok: 0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'ascii',
    },
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: [
      'nvidia/nemotron-3-super-120b-a12b',
      'nemotron-3-super-120b-a12b',
    ],
  },
  {
    canonicalId: 'meta/llama-3.3-70b-instruct',
    displayName: 'Meta Llama 3.3 70B Instruct',
    family: 'nvidia',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0,
      cacheWritePerMtok: 0,
      cacheReadPerMtok: 0,
      outputPerMtok: 0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'ascii',
    },
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['meta/llama-3.3-70b-instruct', 'llama-3.3-70b-instruct'],
  },
  {
    canonicalId: 'openai/gpt-oss-120b',
    displayName: 'OpenAI GPT-OSS 120B',
    family: 'nvidia',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0,
      cacheWritePerMtok: 0,
      cacheReadPerMtok: 0,
      outputPerMtok: 0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'ascii',
    },
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['openai/gpt-oss-120b', 'gpt-oss-120b'],
  },
  {
    canonicalId: 'qwen/qwen3.5-397b-a17b',
    displayName: 'Qwen 3.5 397B A17B',
    family: 'nvidia',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0,
      cacheWritePerMtok: 0,
      cacheReadPerMtok: 0,
      outputPerMtok: 0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'ascii',
    },
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['qwen/qwen3.5-397b-a17b', 'qwen3.5-397b-a17b'],
  },
  {
    canonicalId: 'z-ai/glm-5.2',
    displayName: 'Z-AI GLM 5.2',
    family: 'nvidia',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0,
      cacheWritePerMtok: 0,
      cacheReadPerMtok: 0,
      outputPerMtok: 0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'ascii',
    },
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['z-ai/glm-5.2', 'glm-5.2'],
  },

  // --- DeepSeek Family ---
  {
    canonicalId: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.435,
      cacheWritePerMtok: 0.435,
      cacheReadPerMtok: 0.003625,
      outputPerMtok: 0.87,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    factsheetEnabled: false,
    aliases: ['deepseek-v4-pro'],
  },
  {
    canonicalId: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.14,
      cacheWritePerMtok: 0.14,
      cacheReadPerMtok: 0.0028,
      outputPerMtok: 0.28,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    factsheetEnabled: false,
    aliases: ['deepseek-v4-flash', 'deepseek-chat'],
  },
  {
    canonicalId: 'deepseek-reasoner',
    displayName: 'DeepSeek Reasoner',
    family: 'deepseek',
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0.14,
      cacheWritePerMtok: 0.14,
      cacheReadPerMtok: 0.0028,
      outputPerMtok: 0.28,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    factsheetEnabled: false,
    aliases: ['deepseek-reasoner', 'deepseek-r1'],
  },
];

let overridesMap = new Map<string, Partial<PxpipeModelProfile>>();

function normalizeModelKey(rawKey: string | undefined): string {
  if (!rawKey) return '';
  return rawKey
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((thinking|high|medium|med|low)\)/g, '')
    .replace(/^(openai|anthropic|google|x-ai|xai|agy|codex)[/:-]/, '')
    .replace(/^(moonshot|zhipu|kimi|nvidia|hermes|deepseek)[/:]/, '')
    .replace(/[ _]+/g, '-')
    .replace(/-(thinking|high|medium|med|low|fast|stable|low-context|long-context|reason|nonreason|reasoning|reasoner|effort|thought|extended-thinking|extended|high-effort|medium-effort|low-effort|high-thinking|medium-thinking|low-thinking)$/, '')
    .replace(/^-|-$/g, '');
}

function mergeProfile(base: PxpipeModelProfile): PxpipeModelProfile {
  const override = overridesMap.get(base.canonicalId);
  if (!override) return base;
  return {
    ...base,
    ...override,
    pricing: {
      ...base.pricing,
      ...(override.pricing || {}),
    },
    renderProfile: {
      ...base.renderProfile,
      ...(override.renderProfile || {}),
    },
  };
}

export function loadModelRegistryOverrides(
  overrides?: Record<string, Partial<PxpipeModelProfile>>,
): void {
  if (!overrides) return;
  for (const [key, val] of Object.entries(overrides)) {
    if (val && typeof val === 'object') {
      overridesMap.set(key, val);
    }
  }
}

export function resetModelRegistryOverrides(): void {
  overridesMap.clear();
}

export function getAllModelProfiles(): PxpipeModelProfile[] {
  return BUILTIN_PROFILES.map((p) => mergeProfile(p));
}

export function getModelProfilesByFamily(family: ModelFamily): PxpipeModelProfile[] {
  return getAllModelProfiles().filter((p) => p.family === family);
}

export function resolveModelProfile(
  modelIdOrAlias: string | undefined,
): PxpipeModelProfile {
  if (!modelIdOrAlias) {
    return mergeProfile(BUILTIN_PROFILES[0]); // default to claude-fable-5
  }

  const raw = modelIdOrAlias.trim().toLowerCase();
  const normalized = normalizeModelKey(modelIdOrAlias);

  // 1. Direct canonical ID match (raw or normalized)
  const allProfiles = getAllModelProfiles();
  for (const p of allProfiles) {
    if (p.canonicalId === raw || p.canonicalId === normalized) {
      return p;
    }
  }

  // 2. Alias match
  for (const p of allProfiles) {
    for (const alias of p.aliases) {
      if (typeof alias === 'string') {
        const normAlias = normalizeModelKey(alias);
        if (alias === raw || normAlias === normalized || raw === normAlias) {
          return p;
        }
      } else if (alias instanceof RegExp) {
        if (alias.test(raw) || alias.test(normalized)) {
          return p;
        }
      }
    }
  }

  // 3. Fallback heuristics for prefix matches
  if (normalized.startsWith('claude-opus-') || normalized === 'opus') {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'claude-opus-5')!);
  }
  if (normalized.startsWith('claude-sonnet-') || normalized === 'sonnet') {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'claude-sonnet-5')!);
  }
  if (normalized.startsWith('claude-haiku-') || normalized === 'haiku') {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'claude-haiku-4-5')!);
  }
  if (normalized.startsWith('gpt-5.6-sol')) {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'gpt-5.6-sol')!);
  }
  if (normalized.startsWith('gpt-5.6-terra')) {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'gpt-5.6-terra')!);
  }
  if (normalized.startsWith('grok-4.5')) {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'grok-4.5')!);
  }
  if (normalized.startsWith('deepseek-v4-pro')) {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'deepseek-v4-pro')!);
  }
  if (normalized.startsWith('deepseek-v4-flash') || normalized === 'deepseek-chat') {
    return mergeProfile(allProfiles.find((p) => p.canonicalId === 'deepseek-v4-flash')!);
  }
  if (normalized.startsWith('nvidia/')) {
    return mergeProfile(allProfiles.find((p) => p.family === 'nvidia')!);
  }

  // 4. Safe fallback for unknown model
  const family: ModelFamily = normalized.startsWith('claude')
    ? 'claude'
    : normalized.startsWith('gpt') || normalized.startsWith('o1') || normalized.startsWith('o3')
    ? 'openai'
    : normalized.startsWith('grok')
    ? 'grok'
    : normalized.startsWith('gemini')
    ? 'gemini'
    : normalized.startsWith('agy')
    ? 'agy'
    : normalized.startsWith('nvidia')
    ? 'nvidia'
    : normalized.startsWith('deepseek')
    ? 'deepseek'
    : 'claude';

  return {
    canonicalId: normalized || 'unknown-model',
    displayName: modelIdOrAlias,
    family,
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: {
      inputPerMtok: 0,
      cacheWritePerMtok: 0,
      cacheReadPerMtok: 0,
      outputPerMtok: 0,
    },
    renderProfile: {
      stripCols: 152,
      cellWBonus: 0,
      cellHBonus: 0,
      maxHeightPx: 1024,
      style: 'compact',
    },
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    factsheetEnabled: false,
    aliases: [modelIdOrAlias],
  };
}
```

---

## 5. Verification Plan & Test Strategy

To verify this design in M4:
1. `resolveModelProfile('claude-opus-4-8')` -> returns `claude-opus-5` profile.
2. `resolveModelProfile('gpt-5.6-terra')` -> returns `gpt-5.6-terra` profile.
3. `resolveModelProfile('agy-gemini-3.6-flash-high')` -> returns `agy-gemini-3.6-flash-high` profile.
4. `resolveModelProfile('nvidia/nemotron-3-super-120b-a12b')` -> returns `nvidia/nemotron-3-super-120b-a12b` profile.
5. `loadModelRegistryOverrides()` -> verifies pricing or context token override dynamically.
6. `getAllModelProfiles()` -> returns array of 33 profiles.
7. `getModelProfilesByFamily(family)` -> filters profiles cleanly by family.
