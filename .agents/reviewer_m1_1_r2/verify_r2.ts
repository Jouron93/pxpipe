import {
  resolveModelProfile,
  getAllModelProfiles,
  applyRuntimeConfigOverrides,
  BUILTIN_CATALOG,
} from '../../src/core/model-registry.js';

let errors: string[] = [];

function assert(condition: boolean, msg: string) {
  if (!condition) {
    errors.push(msg);
    console.error(`❌ FAIL: ${msg}`);
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('--- REVIEWER 1 VERIFICATION SUITE ---');

// 1. ALL 8 AGY MODELS VERIFICATION
const agyExpected = [
  { id: 'agy-gemini-3.6-flash-high', inputPrice: 0.15, outputPrice: 0.60, ctx: 2_097_152 },
  { id: 'agy-gemini-3.6-flash-medium', inputPrice: 0.15, outputPrice: 0.60, ctx: 2_097_152 },
  { id: 'agy-gemini-3.6-flash-low', inputPrice: 0.15, outputPrice: 0.60, ctx: 2_097_152 },
  { id: 'agy-gemini-3.5-flash-high', inputPrice: 0.15, outputPrice: 0.60, ctx: 2_097_152 },
  { id: 'agy-gemini-3.1-pro-high', inputPrice: 2.0, outputPrice: 12.0, ctx: 2_097_152 },
  { id: 'agy-claude-opus-4.6-thinking', inputPrice: 5.0, outputPrice: 25.0, ctx: 1_000_000 },
  { id: 'agy-claude-sonnet-4.6-thinking', inputPrice: 3.0, outputPrice: 15.0, ctx: 1_000_000 },
  { id: 'agy-gpt-oss-120b-medium', inputPrice: 0, outputPrice: 0, ctx: 128_000 },
];

for (const target of agyExpected) {
  const prof = resolveModelProfile(target.id);
  assert(
    prof.canonicalId === target.id,
    `AGY model ${target.id} canonicalId match (got '${prof.canonicalId}')`
  );
  assert(
    prof.pricing.inputPerMtok === target.inputPrice,
    `AGY model ${target.id} inputPrice match (${prof.pricing.inputPerMtok} === ${target.inputPrice})`
  );
  assert(
    prof.pricing.outputPerMtok === target.outputPrice,
    `AGY model ${target.id} outputPrice match (${prof.pricing.outputPerMtok} === ${target.outputPrice})`
  );
  assert(
    prof.contextWindowTokens === target.ctx,
    `AGY model ${target.id} contextWindowTokens match (${prof.contextWindowTokens} === ${target.ctx})`
  );
}

// Check AGY alias matching
const agyAliases = [
  { alias: 'agy/gemini-3.6-flash-high', expectedId: 'agy-gemini-3.6-flash-high' },
  { alias: 'gemini-3.6-flash-high', expectedId: 'agy-gemini-3.6-flash-high' },
  { alias: 'agy/claude-opus-4.6-thinking', expectedId: 'agy-claude-opus-4.6-thinking' },
  { alias: 'agy/gemini-3.1-pro-high', expectedId: 'agy-gemini-3.1-pro-high' },
];

for (const { alias, expectedId } of agyAliases) {
  const prof = resolveModelProfile(alias);
  assert(
    prof.canonicalId === expectedId,
    `AGY alias '${alias}' resolved to '${prof.canonicalId}' (expected '${expectedId}')`
  );
}

// 2. ALIAS MATCHING & CONTEXT LENGTHS
// Alias matching (claude-opus-4-8 -> claude-opus-5)
const opus48Prof = resolveModelProfile('claude-opus-4-8');
assert(
  opus48Prof.canonicalId === 'claude-opus-5',
  `'claude-opus-4-8' resolves to 'claude-opus-5'`
);
assert(
  opus48Prof.contextWindowTokens === 1_048_576,
  `Claude Opus 5 context tokens is 1M (1,048,576)`
);
assert(
  opus48Prof.pricing.inputPerMtok === 5 && opus48Prof.pricing.outputPerMtok === 25,
  `Claude Opus 5 pricing is $5/$25`
);

// Other Claude aliases
const sonnetAliasProf = resolveModelProfile('sonnet');
assert(sonnetAliasProf.canonicalId === 'claude-sonnet-5', `'sonnet' resolves to 'claude-sonnet-5'`);

const opusAliasProf = resolveModelProfile('opus');
assert(opusAliasProf.canonicalId === 'claude-opus-5', `'opus' resolves to 'claude-opus-5'`);

// Context lengths verification
const nemotronUltra = resolveModelProfile('nvidia/nemotron-3-ultra-550b-a55b');
assert(
  nemotronUltra.contextWindowTokens === 1_048_576,
  `Nemotron Ultra 550B context length is 1M (${nemotronUltra.contextWindowTokens})`
);

const nemotronSuper = resolveModelProfile('nvidia/nemotron-3-super-120b-a12b');
assert(
  nemotronSuper.contextWindowTokens === 262_144,
  `Nemotron Super 120B context length is 262K (${nemotronSuper.contextWindowTokens})`
);

const llama33 = resolveModelProfile('meta/llama-3.3-70b-instruct');
assert(
  llama33.contextWindowTokens === 131_072,
  `Llama 3.3 70B context length is 128K (${llama33.contextWindowTokens})`
);

const deepseekPro = resolveModelProfile('deepseek-ai/deepseek-v4-pro');
assert(
  deepseekPro.contextWindowTokens === 1_048_576,
  `DeepSeek V4 Pro context length is 1M (${deepseekPro.contextWindowTokens})`
);

// 3. RUNTIME CONFIG OVERRIDES
applyRuntimeConfigOverrides({
  modelProfiles: {
    'claude-opus-5': {
      contextWindowTokens: 2_000_000,
      pricing: { inputPerMtok: 8, outputPerMtok: 35 },
    },
    'new-custom-model': {
      canonicalId: 'new-custom-model',
      family: 'nvidia',
      contextWindowTokens: 500_000,
    },
  },
});

const overriddenOpus = resolveModelProfile('claude-opus-5');
assert(
  overriddenOpus.contextWindowTokens === 2_000_000,
  `Runtime config override updated Opus 5 context window to 2,000,000`
);
assert(
  overriddenOpus.pricing.inputPerMtok === 8 && overriddenOpus.pricing.outputPerMtok === 35,
  `Runtime config override updated Opus 5 pricing to $8/$35`
);

const overriddenAliasOpus = resolveModelProfile('claude-opus-4-8');
assert(
  overriddenAliasOpus.contextWindowTokens === 2_000_000,
  `Alias 'claude-opus-4-8' picks up runtime config override (2,000,000)`
);

const customModel = resolveModelProfile('new-custom-model');
assert(
  customModel.canonicalId === 'new-custom-model',
  `New custom model added via runtime config override resolves correctly`
);

// 4. IMMUTABILITY / DEFENSIVE CLONING CHECK
const prof1 = resolveModelProfile('agy-gemini-3.6-flash-high');
prof1.pricing.inputPerMtok = 999;
prof1.renderProfile.maxHeightPx = 1;
const prof2 = resolveModelProfile('agy-gemini-3.6-flash-high');
assert(
  prof2.pricing.inputPerMtok === 0.15,
  `Defensive clone prevents mutation of internal pricing (got ${prof2.pricing.inputPerMtok})`
);
assert(
  prof2.renderProfile.maxHeightPx !== 1,
  `Defensive clone prevents mutation of internal renderProfile`
);

// 5. CATALOG COMPLETENESS & EDGE CASES
const allProfiles = getAllModelProfiles();
assert(
  allProfiles.length >= 35,
  `getAllModelProfiles returns at least 35 catalog profiles (got ${allProfiles.length})`
);

// Edge cases
const emptyProf = resolveModelProfile('');
assert(emptyProf.family === 'nvidia', `Empty model string falls back to dynamic fallback profile`);

const prefixProf = resolveModelProfile('models/claude-opus-5');
assert(
  prefixProf.canonicalId === 'claude-opus-5',
  `'models/claude-opus-5' prefix stripped correctly`
);

console.log('\n--- FINAL RESULT ---');
if (errors.length === 0) {
  console.log('🎉 ALL VERIFICATION CHECKS PASSED WITH 0 ERRORS!');
  process.exit(0);
} else {
  console.error(`💥 SUITE FAILED WITH ${errors.length} ERRORS!`);
  process.exit(1);
}
