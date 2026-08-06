import { resolveModelProfile, BUILTIN_CATALOG, normalizeModelId } from '../../src/core/model-registry.js';

console.log('--- DETAILED ALIAS & CANONICAL RESOLUTION CHECK ---');

let failedCanonicalLookups = 0;

for (const profile of BUILTIN_CATALOG) {
  const norm = normalizeModelId(profile.canonicalId);
  const resolved = resolveModelProfile(profile.canonicalId);
  
  const isMatch = resolved.canonicalId === profile.canonicalId && resolved.pricing.inputPerMtok === profile.pricing.inputPerMtok;
  
  if (!isMatch) {
    failedCanonicalLookups++;
    console.error(`❌ FAILED CANONICAL LOOKUP for '${profile.canonicalId}':`);
    console.error(`   Normalized string: '${norm}'`);
    console.error(`   Expected canonicalId: '${profile.canonicalId}', got '${resolved.canonicalId}'`);
    console.error(`   Expected pricing.inputPerMtok: ${profile.pricing.inputPerMtok}, got ${resolved.pricing.inputPerMtok}`);
    console.error(`   Was dynamic fallback used?: ${resolved.displayName === profile.canonicalId ? 'YES' : 'NO'}`);
  } else {
    console.log(`✅ Canonical lookup OK: '${profile.canonicalId}' -> '${resolved.canonicalId}'`);
  }
}

console.log(`\nTotal failed canonical lookups: ${failedCanonicalLookups} out of ${BUILTIN_CATALOG.length}`);
