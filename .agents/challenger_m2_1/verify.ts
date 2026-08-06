import { resolveModelRate } from '../../src/core/model-pricing.js';
import { resolveModelProfile, applyRuntimeConfigOverrides, getAllModelProfiles } from '../../src/core/model-registry.js';

console.log('=== Empirical Verification & Stress Testing for Milestone 2 ===\n');

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, description: string, details?: string) {
  if (condition) {
    console.log(`[PASS] ${description}${details ? ` -> ${details}` : ''}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${description}${details ? ` -> ${details}` : ''}`);
    failCount++;
  }
}

// 1. Mandatory 5 Verification Items
console.log('--- 1. Mandatory 5 Verification Items ---');

const r1 = resolveModelRate('nvidia/nemotron-3-ultra-550b-a55b');
assert(r1.contextWindowTokens === 1_048_576, 'nvidia/nemotron-3-ultra-550b-a55b contextWindowTokens is 1,048,576', `got ${r1.contextWindowTokens}`);

const r2 = resolveModelRate('deepseek-ai/deepseek-v4-pro');
assert(r2.contextWindowTokens === 1_048_576, 'deepseek-ai/deepseek-v4-pro contextWindowTokens is 1,048,576', `got ${r2.contextWindowTokens}`);

const r3 = resolveModelRate('nvidia/nemotron-3-super-120b-a12b');
assert(r3.contextWindowTokens === 262_144, 'nvidia/nemotron-3-super-120b-a12b contextWindowTokens is 262,144', `got ${r3.contextWindowTokens}`);

const r4 = resolveModelRate('agy-gemini-3.6-flash-high');
assert(r4.contextWindowTokens === 2_097_152, 'agy-gemini-3.6-flash-high contextWindowTokens is 2,097_152', `got ${r4.contextWindowTokens}`);

const r5 = resolveModelRate('claude-opus-4-8');
assert(
  r5.canonicalModel === 'claude-opus-5' &&
  r5.inputPerMtok === 5 &&
  r5.cachedInputPerMtok === 0.5 &&
  r5.outputPerMtok === 25,
  'claude-opus-4-8 maps to claude-opus-5 ($5/$0.50/$25)',
  `canonicalModel: ${r5.canonicalModel}, input: $${r5.inputPerMtok}, cachedInput: $${r5.cachedInputPerMtok}, output: $${r5.outputPerMtok}`
);

// 2. Stress Testing Claude Alias Variations
console.log('\n--- 2. Claude Family Aliases & Pricing ---');
const opusAliases = ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'opus', 'claude-opus-4.8', 'claude-opus-4.7', 'claude-opus-4.6'];
for (const alias of opusAliases) {
  const r = resolveModelRate(alias);
  assert(r.canonicalModel === 'claude-opus-5' && r.inputPerMtok === 5, `Alias '${alias}' maps to claude-opus-5`, `canonicalModel: ${r.canonicalModel}`);
}

// 3. Stress Testing NVIDIA NIM Family & Dynamic Prefix Resolution
console.log('\n--- 3. NVIDIA NIM Catalog & Dynamic Prefix Resolution ---');
const nimCases = [
  { model: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', expectedContext: 262_144 },
  { model: 'nvidia/nemotron-4-340b-instruct', expectedContext: 1_048_576 },
  { model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', expectedContext: 131_072 },
  { model: 'deepseek-ai/deepseek-v4-flash', expectedContext: 128_000 },
  { model: 'meta/llama-3.3-70b-instruct', expectedContext: 131_072 },
  { model: 'mistralai/mistral-large-2-instruct', expectedContext: 128_000 },
  { model: 'qwen/qwen3.5-397b-a17b', expectedContext: 262_144 },
  { model: 'openai/gpt-oss-120b', expectedContext: 128_000 },
  { model: 'bigcode/starcoder2-15b', expectedContext: 128_000 },
  // Unknown dynamic NIM models:
  { model: 'nvidia/custom-ultra-model-999b', expectedContext: 1_048_576 }, // matches ultra
  { model: 'nvidia/custom-super-model-88b', expectedContext: 262_144 },  // matches super
  { model: 'meta/custom-llama-base-7b', expectedContext: 131_072 },     // default NIM context
];

for (const tc of nimCases) {
  const r = resolveModelRate(tc.model);
  assert(r.contextWindowTokens === tc.expectedContext, `Model '${tc.model}' contextWindowTokens is ${tc.expectedContext}`, `got ${r.contextWindowTokens}`);
}

// 4. Stress Testing AGY Models & Subscription Billing Lanes
console.log('\n--- 4. AGY Models & Billing Lanes ---');
const agyCases = [
  { model: 'agy-gemini-3.6-flash-high', expectedContext: 2_097_152, status: 'quota_only' },
  { model: 'agy-gemini-3.6-flash-medium', expectedContext: 2_097_152, status: 'quota_only' },
  { model: 'agy-gemini-3.5-flash-high', expectedContext: 2_097_152, status: 'quota_only' },
  { model: 'agy-claude-opus-4.6-thinking', expectedContext: 1_000_000, status: 'quota_only' },
  { model: 'agy-gpt-oss-120b-medium', expectedContext: 128_000, status: 'quota_only' },
];

for (const tc of agyCases) {
  const r = resolveModelRate(tc.model);
  assert(
    r.contextWindowTokens === tc.expectedContext && r.status === tc.status,
    `AGY model '${tc.model}' has context ${tc.expectedContext} and status '${tc.status}'`,
    `got context=${r.contextWindowTokens}, status=${r.status}`
  );
}

// Subscription route override test
const subRoute = resolveModelRate('claude-opus-5', 0, { billingLane: 'claude_max_subscription' });
assert(subRoute.status === 'quota_only', 'Subscription billing lane forces status to quota_only', `got ${subRoute.status}`);

// 5. Stress Testing Runtime Configuration Overrides
console.log('\n--- 5. Runtime Config Overrides ---');
applyRuntimeConfigOverrides({
  modelProfiles: {
    'deepseek-ai/deepseek-v4-pro': {
      contextWindowTokens: 2_000_000,
    }
  }
});
const rOverride = resolveModelRate('deepseek-ai/deepseek-v4-pro');
assert(rOverride.contextWindowTokens === 2_000_000, 'Runtime config override updates contextWindowTokens to 2,000,000', `got ${rOverride.contextWindowTokens}`);

console.log(`\n=== STRESS TEST SUMMARY ===`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
