import {
  BUILTIN_CATALOG,
  resolveModelProfile,
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  normalizeModelId
} from '../../src/core/model-registry.js';

console.log("=== CATALOG ALIAS & RESOLUTION AUDIT ===");

const suffixModels = [
  'agy-gemini-3.6-flash-high',
  'agy-gemini-3.6-flash-medium',
  'agy-gemini-3.6-flash-low',
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'agy/gemini-3.6-flash-high',
  'agy/gemini-3.6-flash-medium',
  'agy/gemini-3.6-flash-low',
  'agy-gemini-3.1-pro-high',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'agy-claude-opus-4.6-thinking',
  'claude-opus-4.6-thinking',
  'grok-4.5-thinking',
];

console.log("\n1. Direct Profile Resolution for Suffix Models:");
for (const m of suffixModels) {
  const p = resolveModelProfile(m);
  console.log(`Model query: "${m}" -> canonicalId: "${p.canonicalId}", displayName: "${p.displayName}"`);
}

console.log("\n2. Testing applyRuntimeConfigOverrides with suffix keys:");
// Reset catalog state or test override behavior
applyRuntimeConfigOverrides({
  modelProfiles: {
    'gemini-3.6-flash-medium': {
      contextWindowTokens: 777_777,
      displayName: 'OVERRIDDEN MEDIUM'
    }
  }
});

const highAfter = resolveModelProfile('agy-gemini-3.6-flash-high');
const medAfter = resolveModelProfile('agy-gemini-3.6-flash-medium');

console.log(`After override for 'gemini-3.6-flash-medium':`);
console.log(`- agy-gemini-3.6-flash-high: displayName="${highAfter.displayName}", ctx=${highAfter.contextWindowTokens}`);
console.log(`- agy-gemini-3.6-flash-medium: displayName="${medAfter.displayName}", ctx=${medAfter.contextWindowTokens}`);
