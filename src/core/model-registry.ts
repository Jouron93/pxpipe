/**
 * Unified Per-Model Configuration Registry for PXPipe (`src/core/model-registry.ts`).
 *
 * Central source of truth for model profiles across Claude Code, Codex, Grok, AGY Proxy,
 * Gemini, and the complete NVIDIA NIM catalog (102+ models).
 */

import type { GptRenderStyle } from './gpt-model-profiles.js';
import {
  ANTHROPIC_SLAB_COLS as ANTHROPIC_STRIP_COLS,
  MAX_HEIGHT_PX as ANTHROPIC_MAX_HEIGHT_PX,
  DEFAULT_RENDER_FONT,
} from './render.js';

export type ModelFamily = 'claude' | 'openai' | 'grok' | 'gemini' | 'agy' | 'nvidia';

export type ReaderValidationStatus = 'validated' | 'degraded' | 'unvalidated';

export interface ModelPricing {
  inputPerMtok: number;
  cacheWritePerMtok?: number;
  cacheReadPerMtok?: number;
  outputPerMtok: number;
}

export interface ModelRenderProfile {
  stripCols: number;
  cellWBonus: number;
  cellHBonus: number;
  maxHeightPx: number;
  style: GptRenderStyle;
}

export type RenderProfile = ModelRenderProfile;

export type CompressionStrategy = 'ocr_slab' | 'ast_reflow' | 'multimodal_direct' | 'json_fold';

export interface PxpipeModelProfile {
  canonicalId: string;
  displayName: string;
  family: ModelFamily;
  status: ReaderValidationStatus;
  enabledByDefault: boolean;
  pricing: ModelPricing;
  renderProfile: ModelRenderProfile;
  compressionStrategy?: CompressionStrategy;
  contextWindowTokens: number;
  maxOutputTokens: number;
  factsheetEnabled: boolean;
  aliases: string[];
}

export interface PricingRouteOverride {
  billingLane?: string;
  billingLaneSource?: string;
  actualModel?: string;
}

const DEFAULT_STYLE: GptRenderStyle = {
  font: DEFAULT_RENDER_FONT,
  cellWBonus: 0,
  cellHBonus: 0,
  aa: true,
  grid: false,
  gridCols: 0,
  colorCycle: false,
  markerScale: 1,
  markerRed: false,
  inkDilate: 0,
};

const DEFAULT_GPT_RENDER: ModelRenderProfile = {
  stripCols: 152,
  cellWBonus: 0,
  cellHBonus: 0,
  maxHeightPx: 1932,
  style: DEFAULT_STYLE,
};

const DEFAULT_CLAUDE_RENDER: ModelRenderProfile = {
  stripCols: ANTHROPIC_STRIP_COLS,
  cellWBonus: 0,
  cellHBonus: 0,
  maxHeightPx: ANTHROPIC_MAX_HEIGHT_PX,
  style: DEFAULT_STYLE,
};

/** Opus reads imaged content correctly only at 9x12 cells (cellWBonus/cellHBonus=4).
 *  At the 5x8 default it degrades into confident confabulation -- 0/15 haystack,
 *  6/15 dense-hex (FINDINGS.md 2026-06-12/16), which is why the whole Opus family
 *  was previously marked 'degraded'. 9x12 was verified end-to-end (15/15 needle
 *  fields; ~48-59% input savings), so the safe density is intrinsic here rather
 *  than depending on a PXPIPE_GPT_PROFILES env override being present. */
const OPUS_CLAUDE_RENDER: ModelRenderProfile = {
  stripCols: ANTHROPIC_STRIP_COLS,
  cellWBonus: 4,
  cellHBonus: 4,
  maxHeightPx: ANTHROPIC_MAX_HEIGHT_PX,
  style: DEFAULT_STYLE,
};

const DEFAULT_GROK_RENDER: ModelRenderProfile = {
  stripCols: 152,
  cellWBonus: 0,
  cellHBonus: 0,
  maxHeightPx: 512,
  style: DEFAULT_STYLE,
};

/** Built-in Per-Model Profiles Catalog */
export const BUILTIN_CATALOG: PxpipeModelProfile[] = [
  // --- CLAUDE FAMILY ---
  {
    canonicalId: 'claude-fable-5',
    displayName: 'Claude 5 Fable',
    family: 'claude',
    status: 'validated',
    enabledByDefault: true,
    pricing: { inputPerMtok: 10, cacheWritePerMtok: 12.5, cacheReadPerMtok: 1, outputPerMtok: 50 },
    renderProfile: DEFAULT_CLAUDE_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['claude-fable-5-20260601', 'fable-5', 'claude-mythos-5'],
  },
  {
    canonicalId: 'claude-opus-5',
    displayName: 'Claude 5 Opus',
    family: 'claude',
    status: 'validated',
    enabledByDefault: true,
    pricing: { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 25 },
    renderProfile: OPUS_CLAUDE_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'opus', 'claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4.6'],
  },
  {
    canonicalId: 'claude-sonnet-5',
    displayName: 'Claude 5 Sonnet',
    family: 'claude',
    status: 'validated',
    enabledByDefault: true,
    pricing: { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10 },
    renderProfile: DEFAULT_CLAUDE_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['sonnet', 'claude-sonnet-5-promo', 'claude-sonnet-4-6', 'claude-sonnet-4.6'],
  },
  {
    canonicalId: 'claude-3-7-sonnet',
    displayName: 'Claude 3.7 Sonnet',
    family: 'claude',
    status: 'validated',
    enabledByDefault: true,
    pricing: { inputPerMtok: 3, cacheWritePerMtok: 3.75, cacheReadPerMtok: 0.3, outputPerMtok: 15 },
    renderProfile: DEFAULT_CLAUDE_RENDER,
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: true,
    aliases: ['claude-3-7-sonnet-20250219', 'claude-3.7-sonnet', 'claude-3-7-sonnet-thought'],
  },
  {
    canonicalId: 'claude-3-5-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    family: 'claude',
    status: 'validated',
    enabledByDefault: true,
    pricing: { inputPerMtok: 3, cacheWritePerMtok: 3.75, cacheReadPerMtok: 0.3, outputPerMtok: 15 },
    renderProfile: DEFAULT_CLAUDE_RENDER,
    contextWindowTokens: 200_000,
    maxOutputTokens: 8_192,
    factsheetEnabled: true,
    aliases: ['claude-3-5-sonnet-20241022', 'claude-3.5-sonnet', 'claude-3-5-sonnet-20240620'],
  },
  {
    canonicalId: 'claude-haiku-4-5',
    displayName: 'Claude 4.5 Haiku',
    family: 'claude',
    status: 'validated',
    enabledByDefault: true,
    pricing: { inputPerMtok: 1, cacheWritePerMtok: 1.25, cacheReadPerMtok: 0.1, outputPerMtok: 5 },
    renderProfile: DEFAULT_CLAUDE_RENDER,
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['claude-haiku-4.5', 'haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022'],
  },

  // --- OPENAI / CODEX FAMILY ---
  {
    canonicalId: 'gpt-5.6-sol',
    displayName: 'GPT 5.6 Sol',
    family: 'openai',
    status: 'degraded',
    enabledByDefault: false,
    pricing: { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 30 },
    renderProfile: { ...DEFAULT_GPT_RENDER, style: { ...DEFAULT_STYLE, font: 'spleen-5x8' } },
    contextWindowTokens: 262_144,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.6-sol-2026-06-01', 'gpt-5.6'],
  },
  {
    canonicalId: 'gpt-5.6-terra',
    displayName: 'GPT 5.6 Terra',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2.5, cacheWritePerMtok: 3.125, cacheReadPerMtok: 0.25, outputPerMtok: 15 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.6-terra-2026-06-01'],
  },
  {
    canonicalId: 'gpt-5.6-luna',
    displayName: 'GPT 5.6 Luna',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 1, cacheWritePerMtok: 1.25, cacheReadPerMtok: 0.1, outputPerMtok: 6 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: ['gpt-5.6-luna-2026-06-01'],
  },
  {
    canonicalId: 'gpt-5.5',
    displayName: 'GPT 5.5',
    family: 'openai',
    status: 'degraded',
    enabledByDefault: false,
    pricing: { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 30 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.5-2026-04-23'],
  },
  {
    canonicalId: 'gpt-5.4',
    displayName: 'GPT 5.4',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2.5, cacheWritePerMtok: 3.125, cacheReadPerMtok: 0.25, outputPerMtok: 15 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.4-2026-01-15'],
  },
  {
    canonicalId: 'gpt-5.3-codex',
    displayName: 'GPT 5.3 Codex Spark',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 262_144,
    maxOutputTokens: 64_000,
    factsheetEnabled: true,
    aliases: ['gpt-5.3-codex-spark', 'codex-5.3', 'codex-spark'],
  },
  {
    canonicalId: 'gpt-6-astra',
    displayName: 'GPT-6 Astra',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 10, cacheWritePerMtok: 12.5, cacheReadPerMtok: 1, outputPerMtok: 50 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['gpt-6-astra-2026-06-01', 'codex-astra', 'astra', 'gpt-6'],
  },

  // --- GROK FAMILY ---
  {
    canonicalId: 'grok-4.6',
    displayName: 'Grok 4.6',
    family: 'grok',
    status: 'validated',
    enabledByDefault: true,
    pricing: { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.5, outputPerMtok: 6 },
    renderProfile: DEFAULT_GROK_RENDER,
    contextWindowTokens: 500_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['grok-4.6-latest', 'grok-latest'],
  },
  {
    canonicalId: 'grok-4.5',
    displayName: 'Grok 4.5',
    family: 'grok',
    status: 'degraded',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.3, outputPerMtok: 6 },
    renderProfile: DEFAULT_GROK_RENDER,
    contextWindowTokens: 524_288,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['grok-4.5-thinking', 'grok-4.5-latest', 'grok-build-latest'],
  },
  {
    canonicalId: 'grok-4.3',
    displayName: 'Grok 4.3',
    family: 'grok',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 1.25, cacheWritePerMtok: 1.5, cacheReadPerMtok: 0.2, outputPerMtok: 2.5 },
    renderProfile: DEFAULT_GROK_RENDER,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: ['grok-4.3-20260401'],
  },
  {
    canonicalId: 'grok-4',
    displayName: 'Grok 4',
    family: 'grok',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.5, outputPerMtok: 6 },
    renderProfile: DEFAULT_GROK_RENDER,
    contextWindowTokens: 500_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['grok-4-0709'],
  },

  // --- AGY PROXY FAMILY ---
  // Gemini Flash 3.5-3.8 pricing/context sourced 2026-09-05 (Google Cloud pricing page,
  // DeepMind model cards): 3.6/3.7/3.8 share the $0.75/$3.75 introductory rate through
  // 2026-12-31 ($1.50/$7.50 after), cached $0.075; all four are 1,048,576 ctx / 65,536 out.
  // The 0.15/0.60 + 2,097,152 that 3.6/3.7 carried before were Gemini 2.x Flash numbers.
  // 3.8 tiers are defined HERE rather than via config `modelProfiles` on purpose.
  // applyProfileMap() resolves a config key through normalizeModelId(), which
  // strips the trailing `-high|-medium|-low`, so all three tiers normalize to the
  // same `agy-gemini-3.8-flash`: the first one processed registers, and the other
  // two find it via aliasMap and MERGE INTO it instead of creating their own
  // entries. Measured 2026-09-04 — adding all three by config yielded exactly one
  // registry entry (`...-medium`) wearing the `(high)` displayName. Builtin
  // entries bypass that collision entirely, which is why 3.5/3.6/3.7 are here too.
  // Pricing = Google's published introductory rate ($0.75/$3.75, cached $0.075)
  // which runs to 2026-12-31 and then rises to $1.50/$7.50 — revisit on that date.
  {
    canonicalId: 'agy-gemini-3.8-flash-high',
    displayName: 'AGY Gemini 3.8 Flash (High)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.8-flash-high', 'gemini-3.8-flash-high', 'gemini-3.8-flash'],
  },
  {
    canonicalId: 'agy-gemini-3.8-flash-medium',
    displayName: 'AGY Gemini 3.8 Flash (Medium)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.8-flash-medium', 'gemini-3.8-flash-medium'],
  },
  {
    canonicalId: 'agy-gemini-3.8-flash-low',
    displayName: 'AGY Gemini 3.8 Flash (Low)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.8-flash-low', 'gemini-3.8-flash-low'],
  },
  {
    canonicalId: 'agy-gemini-3.7-flash-high',
    displayName: 'AGY Gemini 3.7 Flash (High)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.7-flash-high', 'gemini-3.7-flash-high', 'gemini-3.7-flash'],
  },
  {
    canonicalId: 'agy-gemini-3.7-flash-medium',
    displayName: 'AGY Gemini 3.7 Flash (Medium)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.7-flash-medium', 'gemini-3.7-flash-medium'],
  },
  {
    canonicalId: 'agy-gemini-3.7-flash-low',
    displayName: 'AGY Gemini 3.7 Flash (Low)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.7-flash-low', 'gemini-3.7-flash-low'],
  },
  {
    canonicalId: 'agy-gemini-3.6-flash-high',
    displayName: 'AGY Gemini 3.6 Flash (High)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.6-flash-high', 'gemini-3.6-flash-high', 'gemini-3.6-flash'],
  },
  {
    canonicalId: 'agy-gemini-3.6-flash-medium',
    displayName: 'AGY Gemini 3.6 Flash (Medium)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.6-flash-medium', 'gemini-3.6-flash-medium'],
  },
  {
    canonicalId: 'agy-gemini-3.6-flash-low',
    displayName: 'AGY Gemini 3.6 Flash (Low)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.6-flash-low', 'gemini-3.6-flash-low'],
  },
  {
    canonicalId: 'agy-gemini-3.5-flash-high',
    displayName: 'AGY Gemini 3.5 Flash (High)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 1.5, cacheWritePerMtok: 1.875, cacheReadPerMtok: 0.15, outputPerMtok: 9 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.5-flash-high', 'gemini-3.5-flash-high'],
  },
  {
    canonicalId: 'agy-gemini-3.5-flash-medium',
    displayName: 'AGY Gemini 3.5 Flash (Medium)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 1.5, cacheWritePerMtok: 1.875, cacheReadPerMtok: 0.15, outputPerMtok: 9 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.5-flash-medium', 'gemini-3.5-flash-medium'],
  },
  {
    canonicalId: 'agy-gemini-3.5-flash-low',
    displayName: 'AGY Gemini 3.5 Flash (Low)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 1.5, cacheWritePerMtok: 1.875, cacheReadPerMtok: 0.15, outputPerMtok: 9 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.5-flash-low', 'gemini-3.5-flash-low'],
  },
  {
    canonicalId: 'agy-gemini-3.1-pro-high',
    displayName: 'AGY Gemini 3.1 Pro (High)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2.0, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 12.0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 2_097_152,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.1-pro-high', 'gemini-3.1-pro-high', 'gemini-3.1-pro'],
  },
  {
    canonicalId: 'agy-gemini-3.1-pro-low',
    displayName: 'AGY Gemini 3.1 Pro (Low)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2.0, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 12.0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 2_097_152,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: ['agy/gemini-3.1-pro-low', 'gemini-3.1-pro-low'],
  },
  {
    canonicalId: 'agy-claude-opus-4.6-thinking',
    displayName: 'AGY Claude Opus 4.6 Thinking',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 25 },
    renderProfile: OPUS_CLAUDE_RENDER,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['agy/claude-opus-4.6-thinking', 'claude-opus-4.6-thinking'],
  },
  {
    canonicalId: 'agy-claude-sonnet-4.6-thinking',
    displayName: 'AGY Claude Sonnet 4.6 Thinking',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 3, cacheWritePerMtok: 3.75, cacheReadPerMtok: 0.3, outputPerMtok: 15 },
    renderProfile: DEFAULT_CLAUDE_RENDER,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['agy/claude-sonnet-4.6-thinking', 'claude-sonnet-4.6-thinking'],
  },
  {
    canonicalId: 'agy-gpt-oss-120b-medium',
    displayName: 'AGY GPT-OSS 120B (Medium)',
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128_000,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['agy/gpt-oss-120b-medium', 'gpt-oss-120b-medium', 'gpt-oss-120b'],
  },

  // --- NVIDIA NIM FAMILY FLAGSHIPS & CATALOG ---
  {
    canonicalId: 'nvidia/nemotron-3-ultra-550b-a55b',
    displayName: 'Nemotron 3 Ultra 550B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['nemotron-3-ultra-550b', 'nemotron-550b', 'nvidia/nemotron-3-ultra-550b'],
  },
  {
    canonicalId: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    displayName: 'Llama 3.1 Nemotron Ultra 253B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 262_144,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['nemotron-ultra-253b', 'llama-3.1-nemotron-253b'],
  },
  {
    canonicalId: 'nvidia/nemotron-3-super-120b-a12b',
    displayName: 'Nemotron 3 Super 120B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 262_144,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['nemotron-3-super-120b', 'nemotron-120b'],
  },
  {
    canonicalId: 'nvidia/nemotron-4-340b-instruct',
    displayName: 'Nemotron 4 340B Instruct',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 128_000,
    factsheetEnabled: true,
    aliases: ['nemotron-4-340b', 'nemotron-340b'],
  },
  {
    canonicalId: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    displayName: 'Llama 3.3 Nemotron Super 49B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['nemotron-super-49b', 'llama-3.3-nemotron-49b'],
  },
  {
    canonicalId: 'deepseek-ai/deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.435, cacheWritePerMtok: 0.543, cacheReadPerMtok: 0.003625, outputPerMtok: 0.87 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 384_000,
    factsheetEnabled: true,
    aliases: ['deepseek-v4-pro', 'deepseek-v4-pro-instruct'],
  },
  {
    canonicalId: 'deepseek-ai/deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.14, cacheWritePerMtok: 0.175, cacheReadPerMtok: 0.0028, outputPerMtok: 0.28 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128_000,
    maxOutputTokens: 128_000,
    factsheetEnabled: false,
    aliases: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    canonicalId: 'deepseek-ai/deepseek-coder-6.7b-instruct',
    displayName: 'DeepSeek Coder 6.7B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128_000,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['deepseek-coder-6.7b'],
  },
  {
    canonicalId: 'meta/llama-3.3-70b-instruct',
    displayName: 'Meta Llama 3.3 70B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['llama-3.3-70b', 'meta/llama-3.3-70b'],
  },
  {
    canonicalId: 'meta/llama-3.1-405b-instruct',
    displayName: 'Meta Llama 3.1 405B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 131_072,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['llama-3.1-405b', 'meta/llama-3.1-405b'],
  },
  {
    canonicalId: 'mistralai/mistral-large-2-instruct',
    displayName: 'Mistral Large 2',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128_000,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['mistral-large-2', 'mistralai/mistral-large-2'],
  },
  {
    canonicalId: 'qwen/qwen3.5-397b-a17b',
    displayName: 'Qwen 3.5 397B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 262_144,
    maxOutputTokens: 64_000,
    factsheetEnabled: false,
    aliases: ['qwen-3.5-397b', 'qwen/qwen3.5-397b'],
  },
  {
    canonicalId: 'openai/gpt-oss-120b',
    displayName: 'GPT-OSS 120B (NVIDIA NIM)',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128_000,
    maxOutputTokens: 32_768,
    factsheetEnabled: false,
    aliases: ['openai/gpt-oss-120b-instruct'],
  },
  {
    canonicalId: 'bigcode/starcoder2-15b',
    displayName: 'StarCoder2 15B',
    family: 'nvidia',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128_000,
    maxOutputTokens: 16_384,
    factsheetEnabled: false,
    aliases: ['starcoder2-15b', 'bigcode/starcoder2-15b-instruct'],
  },

  // --- KIMI (MOONSHOT AI) FAMILY ---
  {
    canonicalId: 'moonshot-v1-8k',
    displayName: 'Moonshot v1 8k',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.20, outputPerMtok: 2.00 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 8192,
    maxOutputTokens: 4096,
    factsheetEnabled: false,
    aliases: [],
  },
  {
    canonicalId: 'moonshot-v1-32k',
    displayName: 'Moonshot v1 32k',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 1.00, outputPerMtok: 3.00 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 32768,
    maxOutputTokens: 8192,
    factsheetEnabled: false,
    aliases: [],
  },
  {
    canonicalId: 'moonshot-v1-128k',
    displayName: 'Moonshot v1 128k',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 2.00, outputPerMtok: 5.00 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 131072,
    maxOutputTokens: 16384,
    factsheetEnabled: false,
    aliases: [],
  },
  {
    canonicalId: 'kimi-k2.7-code',
    displayName: 'Kimi K2.7 Code',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.95, cacheReadPerMtok: 0.19, outputPerMtok: 4.00 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 262144,
    maxOutputTokens: 64000,
    factsheetEnabled: false,
    aliases: [],
  },
  {
    canonicalId: 'kimi-k2.6',
    displayName: 'Kimi K2.6',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.95, cacheReadPerMtok: 0.16, outputPerMtok: 4.00 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 262144,
    maxOutputTokens: 64000,
    factsheetEnabled: false,
    aliases: [],
  },

  // --- GLM (ZHIPU AI) FAMILY ---
  {
    canonicalId: 'glm-4.5-flash',
    displayName: 'GLM 4.5 Flash',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    factsheetEnabled: false,
    aliases: [],
  },
  {
    canonicalId: 'glm-4.7-flash',
    displayName: 'GLM 4.7 Flash',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    factsheetEnabled: false,
    aliases: [],
  },
  {
    canonicalId: 'glm-4.5-air',
    displayName: 'GLM 4.5 Air',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.20, cacheReadPerMtok: 0.03, outputPerMtok: 1.10 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    factsheetEnabled: false,
    aliases: [],
  },
  {
    canonicalId: 'glm-4-32b-0414-128k',
    displayName: 'GLM 4 32B',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.10, outputPerMtok: 0.10 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    factsheetEnabled: false,
    aliases: [],
  },

  // --- LOCAL / OTHER MODELS ---
  {
    canonicalId: 'ornith-1.0-9b',
    displayName: 'Ornith 1.0 9B',
    family: 'openai',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, outputPerMtok: 0 },
    renderProfile: DEFAULT_GPT_RENDER,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    factsheetEnabled: false,
    aliases: [],
  },
];

// Runtime overrides store
const profileRegistry = new Map<string, PxpipeModelProfile>();
const aliasMap = new Map<string, string>();

function initCatalog(): void {
  profileRegistry.clear();
  aliasMap.clear();
  for (const profile of BUILTIN_CATALOG) {
    const lowerCanonical = profile.canonicalId.toLowerCase();
    const normCanonical = normalizeModelId(profile.canonicalId);

    profileRegistry.set(lowerCanonical, { ...profile });

    // 1. Map exact canonical ID (highest priority)
    aliasMap.set(lowerCanonical, profile.canonicalId);

    // 2. Map normalized canonical ID if not already claimed by a prior exact entry
    if (normCanonical && !aliasMap.has(normCanonical)) {
      aliasMap.set(normCanonical, profile.canonicalId);
    }

    // 3. Map aliases (exact and normalized)
    for (const alias of profile.aliases) {
      const lowerAlias = alias.toLowerCase();
      const normAlias = normalizeModelId(alias);

      if (!aliasMap.has(lowerAlias)) {
        aliasMap.set(lowerAlias, profile.canonicalId);
      }
      if (normAlias && !aliasMap.has(normAlias)) {
        aliasMap.set(normAlias, profile.canonicalId);
      }
    }
  }
}

initCatalog();

/** Normalize model string for lookup */
export function normalizeModelId(modelId: string | undefined): string {
  if (!modelId) return '';
  return modelId
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((thinking|xhigh|high|medium|med|low|max)\)/g, '')
    .replace(/[ _]+/g, '-')
    .replace(/-(thinking|xhigh|high|medium|med|low|max|xhigh-thinking|high-thinking|medium-thinking|low-thinking)$/, '');
}

/** Providers publish dated snapshot IDs alongside the short alias
 * (`claude-haiku-4-5-20251001`, `gpt-5.4-2026-01-15`). A snapshot is billed at
 * the rate of the alias it snapshots, so a dated ID must resolve to the same
 * profile instead of falling through to the zero-priced dynamic fallback.
 * Matches `-YYYYMMDD` and `-YYYY-MM-DD` for years 2000-2099 only, so version
 * fragments like `-120b` or `-8k` are never mistaken for a date. */
const DATED_SNAPSHOT_SUFFIX = /-(?:20\d{2}-\d{2}-\d{2}|20\d{6})$/;

function cloneProfile(profile: PxpipeModelProfile): PxpipeModelProfile {
  return {
    ...profile,
    pricing: { ...profile.pricing },
    renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } },
    aliases: [...profile.aliases],
  };
}

/** Dynamic fallback resolver for unrecognized vendor models */
function createDynamicFallbackProfile(modelId: string, norm: string): PxpipeModelProfile {
  let family: ModelFamily = 'nvidia';
  if (norm.includes('moonshot') || norm.includes('kimi')) {
    family = 'openai';
  } else if (norm.includes('zhipu') || norm.includes('glm')) {
    family = 'openai';
  } else if (norm.includes('ornith') || norm.includes('lmstudio') || norm.includes('ollama')) {
    family = 'openai';
  } else if (norm.startsWith('openai/') || norm.startsWith('gpt-') || norm.startsWith('gpt') || norm.startsWith('codex')) {
    family = 'openai';
  } else if (norm.startsWith('claude') || norm.startsWith('anthropic/')) {
    family = 'claude';
  } else if (norm.startsWith('grok') || norm.startsWith('xai/')) {
    family = 'grok';
  } else if (norm.startsWith('gemini') || norm.startsWith('google/')) {
    family = 'gemini';
  } else if (norm.startsWith('agy') || norm.includes('agy')) {
    family = 'agy';
  }

  let contextWindowTokens = 131_072;
  if (norm.match(/ultra|550b|340b|deepseek-v4-pro|1m/i)) {
    contextWindowTokens = 1_048_576;
  } else if (norm.match(/super|253b|120b|qwen|262k/i)) {
    contextWindowTokens = 262_144;
  } else if (family === 'agy' && norm.includes('gemini')) {
    contextWindowTokens = 2_097_152;
  }

  const maxOutputTokens = contextWindowTokens >= 1_000_000
    ? (norm.includes('deepseek-v4-pro') ? 384_000 : 128_000)
    : (contextWindowTokens >= 260_000 ? 64_000 : 32_768);

  return {
    canonicalId: modelId,
    displayName: modelId,
    family,
    status: 'unvalidated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0 },
    renderProfile: family === 'claude' ? DEFAULT_CLAUDE_RENDER : (family === 'grok' ? DEFAULT_GROK_RENDER : DEFAULT_GPT_RENDER),
    contextWindowTokens,
    maxOutputTokens,
    factsheetEnabled: false,
    aliases: [],
  };
}

/** Resolve an incoming model string (and optional route) to its PxpipeModelProfile */
export function resolveModelProfile(modelId: string, _route?: PricingRouteOverride): PxpipeModelProfile {
  const rawLower = (modelId || '').trim().toLowerCase();
  const norm = normalizeModelId(modelId);

  // 1. Direct canonical or alias match (try exact lowercase first, then normalized key)
  const canonicalTarget = aliasMap.get(rawLower) || aliasMap.get(norm);
  if (canonicalTarget) {
    const profile = profileRegistry.get(canonicalTarget.toLowerCase());
    if (profile) {
      return {
        ...profile,
        pricing: { ...profile.pricing },
        renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } },
        aliases: [...profile.aliases],
      };
    }
  }

  // 1b. Anthropic dated snapshot ID -> the profile of the alias it snapshots, so
  //     the NEXT dated Claude release resolves without a registry edit.
  //     Deliberately scoped to family 'claude': other vendors (moonshot, zhipu)
  //     must NOT inherit the undated rate — an unconfirmed snapshot stays
  //     'unavailable' rather than being billed at a guessed rate.
  const undated = norm.replace(DATED_SNAPSHOT_SUFFIX, '');
  if (undated !== norm) {
    const undatedTarget = aliasMap.get(undated) || undated;
    const undatedProfile = profileRegistry.get(undatedTarget.toLowerCase());
    if (undatedProfile && undatedProfile.family === 'claude') {
      return cloneProfile(undatedProfile);
    }
  }

  // 2. Base model alias match (e.g. claude-opus-4-8 -> claude-opus-5)
  if (norm.startsWith('grok-4.5') || norm.startsWith('grok-4-5') || norm === 'grok-build-latest') {
    const profile = profileRegistry.get('grok-4.5');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('grok-4.6') || norm.startsWith('grok-4-6') || norm === 'grok' || norm === 'grok-latest') {
    const profile = profileRegistry.get('grok-4.6');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('grok-4.3') || norm.startsWith('grok-4-3')) {
    const profile = profileRegistry.get('grok-4.3');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('grok-4') || norm.startsWith('grok-4-0')) {
    const profile = profileRegistry.get('grok-4');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('gpt-5.6-sol') || norm.startsWith('gpt-5-6-sol')) {
    const profile = profileRegistry.get('gpt-5.6-sol');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('gpt-5.6-terra') || norm.startsWith('gpt-5-6-terra')) {
    const profile = profileRegistry.get('gpt-5.6-terra');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('gpt-5.6-luna') || norm.startsWith('gpt-5-6-luna')) {
    const profile = profileRegistry.get('gpt-5.6-luna');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('gpt-6-astra') || norm.startsWith('gpt-6') || norm === 'astra' || norm.startsWith('codex-astra')) {
    const profile = profileRegistry.get('gpt-6-astra');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('gpt-5.5') || norm.startsWith('gpt-5-5')) {
    const profile = profileRegistry.get('gpt-5.5');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.startsWith('gpt-5.4') || norm.startsWith('gpt-5-4')) {
    const profile = profileRegistry.get('gpt-5.4');
    if (profile) return { ...profile, pricing: { ...profile.pricing }, renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } }, aliases: [...profile.aliases] };
  }
  if (norm.includes('opus-4-8') || norm.includes('opus-4-7') || norm.includes('opus-4-6') || norm === 'opus' || norm === 'claude-opus') {
    const profile = profileRegistry.get('claude-opus-5');
    if (profile) {
      return {
        ...profile,
        pricing: { ...profile.pricing },
        renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } },
        aliases: [...profile.aliases],
      };
    }
  }
  if (norm.includes('fable-5') || norm.includes('mythos-5')) {
    const profile = profileRegistry.get('claude-fable-5');
    if (profile) {
      return {
        ...profile,
        pricing: { ...profile.pricing },
        renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } },
        aliases: [...profile.aliases],
      };
    }
  }
  if (norm.includes('sonnet-5') || norm.includes('sonnet-4-6') || norm === 'sonnet') {
    const profile = profileRegistry.get('claude-sonnet-5');
    if (profile) {
      return {
        ...profile,
        pricing: { ...profile.pricing },
        renderProfile: { ...profile.renderProfile, style: { ...profile.renderProfile.style } },
        aliases: [...profile.aliases],
      };
    }
  }

  // 3. Dynamic Prefix Fallback Resolver for unknown models
  return createDynamicFallbackProfile(modelId, norm);
}

/** Get all registered model profiles */
export function getAllModelProfiles(): PxpipeModelProfile[] {
  return Array.from(profileRegistry.values()).map(p => ({
    ...p,
    pricing: { ...p.pricing },
    renderProfile: { ...p.renderProfile, style: { ...p.renderProfile.style } },
    aliases: [...p.aliases],
  }));
}

/** Apply runtime JSON configuration overrides (`PXPIPE_CONFIG` / `config.json`) */
export function applyRuntimeConfigOverrides(config: Record<string, any>): void {
  if (!config || typeof config !== 'object') return;

  const profilesConfig = config.modelProfiles || config.models || config.PXPIPE_MODELS_CONFIG;
  if (profilesConfig && typeof profilesConfig === 'object' && !Array.isArray(profilesConfig)) {
    applyProfileMap(profilesConfig as Record<string, unknown>);
  }

  const imaging = config.imaging_profiles;
  if (imaging && typeof imaging === 'object' && !Array.isArray(imaging)) {
    for (const [key, raw] of Object.entries(imaging as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as { style?: Record<string, unknown>; cellWBonus?: number; cellHBonus?: number; stripCols?: number; maxHeightPx?: number };
      const style = rec.style && typeof rec.style === 'object' ? rec.style : rec;
      const renderProfile: Partial<ModelRenderProfile> = { style: style as unknown as GptRenderStyle };
      const cellWBonus = rec.cellWBonus ?? (style as { cellWBonus?: number }).cellWBonus;
      if (cellWBonus !== undefined) renderProfile.cellWBonus = cellWBonus;
      const cellHBonus = rec.cellHBonus ?? (style as { cellHBonus?: number }).cellHBonus;
      if (cellHBonus !== undefined) renderProfile.cellHBonus = cellHBonus;
      if (rec.stripCols !== undefined) renderProfile.stripCols = rec.stripCols;
      if (rec.maxHeightPx !== undefined) renderProfile.maxHeightPx = rec.maxHeightPx;
      applyProfileMap({
        [key]: {
          renderProfile,
        },
      });
    }
  }
}

function applyProfileMap(profilesConfig: Record<string, unknown>): void {
  for (const [key, rawOverride] of Object.entries(profilesConfig)) {
    if (!rawOverride || typeof rawOverride !== 'object') continue;

    const override = rawOverride as Partial<PxpipeModelProfile>;
    const rawKey = key.trim().toLowerCase();
    const normKey = normalizeModelId(key);

    // A COMPLETE profile (own canonicalId + family) names its own identity and is looked
    // up by that exact id. Only a PARTIAL override may resolve through the normalized
    // alias. normalizeModelId() strips `-high|-medium|-low|...`, so routing complete
    // profiles through it collapses every tier of a new model onto whichever registered
    // first: the rest resolve to it via aliasMap, take the merge branch below, and never
    // get entries of their own. Measured 2026-09-04 with agy-gemini-3.8-flash-{high,
    // medium,low} from config: ONE registry entry, keyed `-medium`, displayName `(High)`.
    // Pinned by tests/model-registry-tier-collision.test.ts.
    const isCompleteProfile = Boolean(override.canonicalId && override.family);
    const targetCanonical = isCompleteProfile
      ? (override.canonicalId as string).trim().toLowerCase()
      : aliasMap.get(rawKey) || aliasMap.get(normKey) || rawKey;
    const existingProfile = profileRegistry.get(targetCanonical.toLowerCase());

    if (!existingProfile) {
      if (override.canonicalId && override.family) {
        const newProfile = createDynamicFallbackProfile(override.canonicalId, normalizeModelId(override.canonicalId));
        Object.assign(newProfile, override);
        const lowerCan = newProfile.canonicalId.toLowerCase();
        const normCan = normalizeModelId(newProfile.canonicalId);
        profileRegistry.set(lowerCan, newProfile);
        aliasMap.set(lowerCan, newProfile.canonicalId);
        if (normCan && !aliasMap.has(normCan)) {
          aliasMap.set(normCan, newProfile.canonicalId);
        }
        if (Array.isArray(newProfile.aliases)) {
          for (const alias of newProfile.aliases) {
            const lowerAlias = alias.toLowerCase();
            const normAlias = normalizeModelId(alias);
            if (!aliasMap.has(lowerAlias)) aliasMap.set(lowerAlias, newProfile.canonicalId);
            if (normAlias && !aliasMap.has(normAlias)) aliasMap.set(normAlias, newProfile.canonicalId);
          }
        }
      }
      continue;
    }

    if (override.displayName !== undefined) existingProfile.displayName = override.displayName;
    if (override.status !== undefined) existingProfile.status = override.status;
    if (override.enabledByDefault !== undefined) existingProfile.enabledByDefault = override.enabledByDefault;
    if (override.contextWindowTokens !== undefined) existingProfile.contextWindowTokens = override.contextWindowTokens;
    if (override.maxOutputTokens !== undefined) existingProfile.maxOutputTokens = override.maxOutputTokens;
    if (override.factsheetEnabled !== undefined) existingProfile.factsheetEnabled = override.factsheetEnabled;

    if (override.pricing && typeof override.pricing === 'object') {
      existingProfile.pricing = {
        ...existingProfile.pricing,
        ...override.pricing,
      };
    }

    if (override.renderProfile && typeof override.renderProfile === 'object') {
      existingProfile.renderProfile = {
        cellWBonus: override.renderProfile.cellWBonus ?? existingProfile.renderProfile.cellWBonus,
        cellHBonus: override.renderProfile.cellHBonus ?? existingProfile.renderProfile.cellHBonus,
        stripCols: override.renderProfile.stripCols ?? existingProfile.renderProfile.stripCols,
        maxHeightPx: override.renderProfile.maxHeightPx ?? existingProfile.renderProfile.maxHeightPx,
        style: {
          ...existingProfile.renderProfile.style,
          ...(override.renderProfile.style || {}),
        },
      };
    }

    if (Array.isArray(override.aliases)) {
      for (const alias of override.aliases) {
        const lowerAlias = alias.toLowerCase();
        const normAlias = normalizeModelId(alias);
        if (!aliasMap.has(lowerAlias)) {
          aliasMap.set(lowerAlias, existingProfile.canonicalId);
          existingProfile.aliases.push(alias);
        }
        if (normAlias && !aliasMap.has(normAlias)) {
          aliasMap.set(normAlias, existingProfile.canonicalId);
        }
      }
    }
  }
}
