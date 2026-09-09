import {
  BUILTIN_CATALOG,
  resolveModelProfile,
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  normalizeModelId
} from '../../src/core/model-registry.js';

console.log("=== EMPIRICAL VERIFICATION SUITE — CHALLENGER 2 (M1 Iteration 3) ===");

const TARGET_MODELS = [
  { query: 'gemini-3.6-flash-medium', expectedCanonical: 'agy-gemini-3.6-flash-medium' },
  { query: 'gemini-3.6-flash-low', expectedCanonical: 'agy-gemini-3.6-flash-low' },
  { query: 'gemini-3.5-flash-high', expectedCanonical: 'agy-gemini-3.5-flash-high' },
  { query: 'gemini-3.1-pro-high', expectedCanonical: 'agy-gemini-3.1-pro-high' },
  { query: 'claude-opus-4.6-thinking', expectedCanonical: 'agy-claude-opus-4.6-thinking' },
  { query: 'claude-sonnet-4.6-thinking', expectedCanonical: 'agy-claude-sonnet-4.6-thinking' },
  { query: 'gpt-oss-120b-medium', expectedCanonical: 'agy-gpt-oss-120b-medium' },
];

let failedChecks = 0;

// Test 1: Direct Resolution Verification
console.log("\n--- TEST 1: Direct Profile Resolution for Target Models ---");
for (const item of TARGET_MODELS) {
  const profile = resolveModelProfile(item.query);
  const match = profile.canonicalId === item.expectedCanonical;
  if (match) {
    console.log(`[PASS] Query '${item.query}' -> '${profile.canonicalId}' (${profile.displayName})`);
  } else {
    console.error(`[FAIL] Query '${item.query}' -> got '${profile.canonicalId}', expected '${item.expectedCanonical}'`);
    failedChecks++;
  }
}

// Test 1b: Prefixed Variants Verification
console.log("\n--- TEST 1b: Prefixed Variants Resolution ---");
const PREFIXED_VARIANTS = [
  { query: 'agy-gemini-3.6-flash-medium', expectedCanonical: 'agy-gemini-3.6-flash-medium' },
  { query: 'agy/gemini-3.6-flash-medium', expectedCanonical: 'agy-gemini-3.6-flash-medium' },
  { query: 'agy-gemini-3.6-flash-low', expectedCanonical: 'agy-gemini-3.6-flash-low' },
  { query: 'agy/gemini-3.6-flash-low', expectedCanonical: 'agy-gemini-3.6-flash-low' },
  { query: 'agy-gemini-3.5-flash-high', expectedCanonical: 'agy-gemini-3.5-flash-high' },
  { query: 'agy/gemini-3.5-flash-high', expectedCanonical: 'agy-gemini-3.5-flash-high' },
  { query: 'agy-gemini-3.1-pro-high', expectedCanonical: 'agy-gemini-3.1-pro-high' },
  { query: 'agy/gemini-3.1-pro-high', expectedCanonical: 'agy-gemini-3.1-pro-high' },
  { query: 'agy-claude-opus-4.6-thinking', expectedCanonical: 'agy-claude-opus-4.6-thinking' },
  { query: 'agy/claude-opus-4.6-thinking', expectedCanonical: 'agy-claude-opus-4.6-thinking' },
  { query: 'agy-claude-sonnet-4.6-thinking', expectedCanonical: 'agy-claude-sonnet-4.6-thinking' },
  { query: 'agy/claude-sonnet-4.6-thinking', expectedCanonical: 'agy-claude-sonnet-4.6-thinking' },
  { query: 'agy-gpt-oss-120b-medium', expectedCanonical: 'agy-gpt-oss-120b-medium' },
  { query: 'agy/gpt-oss-120b-medium', expectedCanonical: 'agy-gpt-oss-120b-medium' },
];

for (const item of PREFIXED_VARIANTS) {
  const profile = resolveModelProfile(item.query);
  const match = profile.canonicalId === item.expectedCanonical;
  if (match) {
    console.log(`[PASS] Prefixed Query '${item.query}' -> '${profile.canonicalId}'`);
  } else {
    console.error(`[FAIL] Prefixed Query '${item.query}' -> got '${profile.canonicalId}', expected '${item.expectedCanonical}'`);
    failedChecks++;
  }
}

// Test 2: BUILTIN_CATALOG Alias Audit
console.log("\n--- TEST 2: BUILTIN_CATALOG Alias Audit ---");
let missingAliasesCount = 0;
for (const p of BUILTIN_CATALOG) {
  if (p.canonicalId.startsWith('agy-')) {
    const unagy = p.canonicalId.slice(4);
    const hasAlias = p.aliases.includes(unagy);
    if (!hasAlias) {
      console.error(`[FAIL] Catalog entry '${p.canonicalId}' missing alias '${unagy}'`);
      missingAliasesCount++;
      failedChecks++;
    }
  }
}
if (missingAliasesCount === 0) {
  console.log("[PASS] All 8 AGY catalog profiles contain their exact un-prefixed CLI aliases.");
}

if (failedChecks > 0) {
  console.error(`\nFAILED ${failedChecks} checks in test_full_suite.js`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All resolution and alias audit checks passed cleanly.");
}
