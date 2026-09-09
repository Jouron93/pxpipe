import {
  BUILTIN_CATALOG,
  resolveModelProfile,
  applyRuntimeConfigOverrides,
  getAllModelProfiles
} from '../../src/core/model-registry.js';

console.log("=== EMPIRICAL RUNTIME OVERRIDE & SIBLING ISOLATION TEST ===");

let failedChecks = 0;

// Test Override Isolation: Override gemini-3.6-flash-medium with custom pricing and context window
const overrideConfig = {
  modelProfiles: {
    'gemini-3.6-flash-medium': {
      displayName: 'Custom Medium Override',
      contextWindowTokens: 500_000,
      pricing: { inputPerMtok: 99.99, outputPerMtok: 199.99 }
    },
    'claude-opus-4.6-thinking': {
      displayName: 'Custom Opus Thinking Override',
      contextWindowTokens: 888_888
    }
  }
};

console.log("\n1. Applying targeted overrides for 'gemini-3.6-flash-medium' and 'claude-opus-4.6-thinking'...");
applyRuntimeConfigOverrides(overrideConfig);

// Verify 'gemini-3.6-flash-medium' was modified correctly
const medProfile = resolveModelProfile('gemini-3.6-flash-medium');
if (medProfile.displayName === 'Custom Medium Override' &&
    medProfile.contextWindowTokens === 500_000 &&
    medProfile.pricing.inputPerMtok === 99.99) {
  console.log("[PASS] 'gemini-3.6-flash-medium' override applied successfully.");
} else {
  console.error("[FAIL] 'gemini-3.6-flash-medium' override failed or incomplete:", medProfile);
  failedChecks++;
}

// Verify sibling 'gemini-3.6-flash-high' was NOT hijacked or corrupted
const highProfile = resolveModelProfile('gemini-3.6-flash-high');
if (highProfile.displayName === 'AGY Gemini 3.6 Flash (High)' &&
    highProfile.contextWindowTokens === 2_097_152 &&
    highProfile.pricing.inputPerMtok === 0.15) {
  console.log("[PASS] Sibling 'gemini-3.6-flash-high' remained uncorrupted.");
} else {
  console.error("[FAIL] Sibling 'gemini-3.6-flash-high' was corrupted by medium override!", highProfile);
  failedChecks++;
}

// Verify sibling 'gemini-3.6-flash-low' was NOT hijacked or corrupted
const lowProfile = resolveModelProfile('gemini-3.6-flash-low');
if (lowProfile.displayName === 'AGY Gemini 3.6 Flash (Low)' &&
    lowProfile.contextWindowTokens === 2_097_152 &&
    lowProfile.pricing.inputPerMtok === 0.15) {
  console.log("[PASS] Sibling 'gemini-3.6-flash-low' remained uncorrupted.");
} else {
  console.error("[FAIL] Sibling 'gemini-3.6-flash-low' was corrupted by medium override!", lowProfile);
  failedChecks++;
}

// Verify 'claude-opus-4.6-thinking' override and native 'claude-opus-5' isolation
const opusThinkingProfile = resolveModelProfile('claude-opus-4.6-thinking');
const nativeOpusProfile = resolveModelProfile('claude-opus-4-8'); // maps to claude-opus-5

if (opusThinkingProfile.displayName === 'Custom Opus Thinking Override' &&
    opusThinkingProfile.contextWindowTokens === 888_888 &&
    opusThinkingProfile.canonicalId === 'agy-claude-opus-4.6-thinking') {
  console.log("[PASS] 'claude-opus-4.6-thinking' override applied to correct AGY profile.");
} else {
  console.error("[FAIL] 'claude-opus-4.6-thinking' override was improperly targeted!", opusThinkingProfile);
  failedChecks++;
}

if (nativeOpusProfile.canonicalId === 'claude-opus-5' &&
    nativeOpusProfile.displayName === 'Claude 5 Opus' &&
    nativeOpusProfile.contextWindowTokens === 1_048_576) {
  console.log("[PASS] Native 'claude-opus-5' profile remained uncorrupted by thinking override.");
} else {
  console.error("[FAIL] Native 'claude-opus-5' profile was corrupted by thinking override!", nativeOpusProfile);
  failedChecks++;
}

if (failedChecks > 0) {
  console.error(`\nFAILED ${failedChecks} checks in test_overrides.js`);
  process.exit(1);
} else {
  console.log("\nSUCCESS: All runtime override isolation checks passed cleanly.");
}
