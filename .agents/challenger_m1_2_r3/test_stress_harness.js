import {
  BUILTIN_CATALOG,
  resolveModelProfile,
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  normalizeModelId
} from '../../src/core/model-registry.js';

console.log("=== ADVERSARIAL STRESS HARNESS — CHALLENGER 2 ===");

let failedChecks = 0;

// 1. Edge-Case Formatting (lowercase, uppercase, whitespace, agy prefix)
console.log("\n1. Testing Formatting & Case Handling:");
const EDGE_CASES = [
  { raw: '  GEMINI-3.6-FLASH-MEDIUM  ', expected: 'agy-gemini-3.6-flash-medium' },
  { raw: 'gemini-3.6-flash-low', expected: 'agy-gemini-3.6-flash-low' },
  { raw: '  CLAUDE-OPUS-4.6-THINKING  ', expected: 'agy-claude-opus-4.6-thinking' },
  { raw: '  AGY/CLAUDE-SONNET-4.6-THINKING  ', expected: 'agy-claude-sonnet-4.6-thinking' },
  { raw: 'gpt-oss-120b-medium', expected: 'agy-gpt-oss-120b-medium' },
];

for (const ec of EDGE_CASES) {
  const res = resolveModelProfile(ec.raw);
  if (res.canonicalId === ec.expected) {
    console.log(`[PASS] Input '${ec.raw}' -> '${res.canonicalId}'`);
  } else {
    console.error(`[FAIL] Input '${ec.raw}' -> got '${res.canonicalId}', expected '${ec.expected}'`);
    failedChecks++;
  }
}

// 2. Accurate Context Lengths for Target & Catalog Models
console.log("\n2. Testing Accurate Context Windows in Model Registry:");
const CONTEXT_CHECKS = [
  { model: 'gemini-3.6-flash-medium', expectedContext: 2_097_152 },
  { model: 'gemini-3.6-flash-low', expectedContext: 2_097_152 },
  { model: 'gemini-3.5-flash-high', expectedContext: 2_097_152 },
  { model: 'gemini-3.1-pro-high', expectedContext: 2_097_152 },
  { model: 'claude-opus-4.6-thinking', expectedContext: 1_000_000 },
  { model: 'claude-sonnet-4.6-thinking', expectedContext: 1_000_000 },
  { model: 'gpt-oss-120b-medium', expectedContext: 128_000 },
  { model: 'nvidia/nemotron-3-ultra-550b-a55b', expectedContext: 1_048_576 },
  { model: 'deepseek-ai/deepseek-v4-pro', expectedContext: 1_048_576 },
  { model: 'nvidia/nemotron-3-super-120b-a12b', expectedContext: 262_144 },
  { model: 'meta/llama-3.3-70b-instruct', expectedContext: 131_072 }
];

for (const item of CONTEXT_CHECKS) {
  const prof = resolveModelProfile(item.model);
  if (prof.contextWindowTokens === item.expectedContext) {
    console.log(`[PASS] resolveModelProfile('${item.model}') contextWindowTokens = ${prof.contextWindowTokens}`);
  } else {
    console.error(`[FAIL] resolveModelProfile('${item.model}') contextWindowTokens mismatch: got ${prof.contextWindowTokens}, expected ${item.expectedContext}`);
    failedChecks++;
  }
}

// 3. Dynamic Fallback Resolution for Unregistered NIM models
console.log("\n3. Testing Dynamic Fallback Resolution for Unregistered NIM models:");
const UNKNOWN_NIM = [
  { model: 'nvidia/nemotron-unknown-ultra-550b', expectedContext: 1_048_576 },
  { model: 'deepseek-ai/deepseek-v4-pro-custom', expectedContext: 1_048_576 },
  { model: 'nvidia/nemotron-super-120b-variant', expectedContext: 262_144 },
  { model: 'meta/llama-3.1-8b-custom', expectedContext: 128_000 },
];

for (const nim of UNKNOWN_NIM) {
  const prof = resolveModelProfile(nim.model);
  if (prof.family === 'nvidia' && prof.contextWindowTokens === nim.expectedContext) {
    console.log(`[PASS] Dynamic NIM '${nim.model}' resolved with family '${prof.family}', contextWindowTokens = ${prof.contextWindowTokens}`);
  } else {
    console.error(`[FAIL] Dynamic NIM '${nim.model}' unexpected profile:`, prof);
    failedChecks++;
  }
}

if (failedChecks > 0) {
  console.error(`\nFAILED ${failedChecks} checks in test_stress_harness.js`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All adversarial stress harness checks passed cleanly.");
}
