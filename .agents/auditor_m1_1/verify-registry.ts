import { resolveModelProfile, applyRuntimeConfigOverrides, getAllModelProfiles } from '../../src/core/model-registry.js';

console.log('--- AUDIT EMPIRICAL VERIFICATION ---');

const testCases = [
  { input: 'claude-opus-4-8', expectedCanonical: 'claude-opus-5', expectedContext: 1_048_576 },
  { input: 'agy-gemini-3.6-flash-high', expectedCanonical: 'agy-gemini-3.6-flash-high', expectedContext: 2_097_152 },
  { input: 'nvidia/nemotron-3-ultra-550b-a55b', expectedCanonical: 'nvidia/nemotron-3-ultra-550b-a55b', expectedContext: 1_048_576 },
  { input: 'meta/llama-3.3-70b-instruct', expectedCanonical: 'meta/llama-3.3-70b-instruct', expectedContext: 131_072 },
  { input: 'deepseek-ai/deepseek-v4-pro', expectedCanonical: 'deepseek-ai/deepseek-v4-pro', expectedContext: 1_048_576 },
  { input: 'nvidia/nemotron-3-super-120b-a12b', expectedCanonical: 'nvidia/nemotron-3-super-120b-a12b', expectedContext: 262_144 },
  { input: 'nvidia/unknown-custom-ultra-model', expectedFamily: 'nvidia', expectedContext: 1_048_576 },
  { input: 'deepseek-ai/unknown-flash-model', expectedFamily: 'nvidia', expectedContext: 128_000 },
];

let failed = false;
for (const tc of testCases) {
  const profile = resolveModelProfile(tc.input);
  console.log(`Input: "${tc.input}" -> Canonical: "${profile.canonicalId}", Family: "${profile.family}", ContextTokens: ${profile.contextWindowTokens}`);
  if (tc.expectedCanonical && profile.canonicalId !== tc.expectedCanonical) {
    console.error(`  FAIL: expected canonical ${tc.expectedCanonical}, got ${profile.canonicalId}`);
    failed = true;
  }
  if (tc.expectedContext && profile.contextWindowTokens !== tc.expectedContext) {
    console.error(`  FAIL: expected context ${tc.expectedContext}, got ${profile.contextWindowTokens}`);
    failed = true;
  }
  if (tc.expectedFamily && profile.family !== tc.expectedFamily) {
    console.error(`  FAIL: expected family ${tc.expectedFamily}, got ${profile.family}`);
    failed = true;
  }
}

// Test Runtime Config Override
applyRuntimeConfigOverrides({
  modelProfiles: {
    'claude-opus-5': {
      contextWindowTokens: 2_000_000,
    }
  }
});
const overridden = resolveModelProfile('claude-opus-4-8');
console.log(`Overridden 'claude-opus-4-8' -> ContextTokens: ${overridden.contextWindowTokens}`);
if (overridden.contextWindowTokens !== 2_000_000) {
  console.error(`  FAIL: override failed, expected 2000000, got ${overridden.contextWindowTokens}`);
  failed = true;
}

if (failed) {
  process.exit(1);
} else {
  console.log('ALL EMPIRICAL TESTS PASSED CLEANLY!');
}
