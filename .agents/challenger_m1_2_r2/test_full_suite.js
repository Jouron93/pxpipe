import {
  BUILTIN_CATALOG,
  resolveModelProfile,
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  normalizeModelId
} from '../../src/core/model-registry.js';

console.log("=== COMPREHENSIVE OVERRIDE & ALIAS AUDIT ===");

// 1. Audit catalog aliases completeness
console.log("\n--- Audit 1: Missing Aliases in Builtin Catalog ---");
for (const p of BUILTIN_CATALOG) {
  // Check if suffix models (like -high, -medium, -low, -thinking) have their un-prefixed counterparts
  if (p.canonicalId.startsWith('agy-')) {
    const unagy = p.canonicalId.slice(4); // e.g. gemini-3.6-flash-medium
    const hasUnagy = p.aliases.includes(unagy);
    if (!hasUnagy) {
      console.log(`[MISSING ALIAS] Profile "${p.canonicalId}" is missing alias "${unagy}"`);
    }
  }
}

// 2. Audit override collisions
console.log("\n--- Audit 2: Testing Runtime Config Overrides for Suffix Keys ---");
// Create a test config that attempts to override every builtin profile by its canonical ID and by common aliases
const testOverrides = {};
for (const p of BUILTIN_CATALOG) {
  // Key by un-prefixed string if canonical starts with agy-
  if (p.canonicalId.startsWith('agy-')) {
    const aliasKey = p.canonicalId.slice(4);
    testOverrides[aliasKey] = {
      displayName: `OVERRIDDEN_${p.canonicalId}`
    };
  }
}

console.log("Applying overrides for keys:", Object.keys(testOverrides));
applyRuntimeConfigOverrides({ modelProfiles: testOverrides });

for (const p of BUILTIN_CATALOG) {
  const current = resolveModelProfile(p.canonicalId);
  console.log(`Canonical "${p.canonicalId}": displayName = "${current.displayName}"`);
}
