import {
  normalizeModelId,
  resolveModelProfile,
  getAllModelProfiles,
  applyRuntimeConfigOverrides,
  BUILTIN_CATALOG,
} from '../../src/core/model-registry.js';

console.log('=== Stress-Testing applyRuntimeConfigOverrides ===\n');

let pass = 0;
let fail = 0;

function check(cond: boolean, name: string, detail?: string) {
  if (cond) {
    console.log(`[PASS] ${name}`);
    pass++;
  } else {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`);
    fail++;
  }
}

// 1. Stress test runtime override key matching for model containing -high
applyRuntimeConfigOverrides({
  modelProfiles: {
    'custom-model-high': {
      canonicalId: 'custom-model-high',
      displayName: 'Custom High Model',
      family: 'openai',
      pricing: { inputPerMtok: 15, outputPerMtok: 45 },
    },
  },
});

const resCustomHigh = resolveModelProfile('custom-model-high');
check(
  resCustomHigh.pricing.inputPerMtok === 15,
  'Runtime override for model ending with -high retains pricing',
  `Expected inputPerMtok 15, got ${resCustomHigh.pricing.inputPerMtok} (canonical: ${resCustomHigh.canonicalId})`
);

// 2. Stress test overriding existing built-in profile with aliases containing -thinking
applyRuntimeConfigOverrides({
  models: {
    'claude-sonnet-5': {
      aliases: ['sonnet-5-thinking-alias'],
    },
  },
});

const resThinkingAlias = resolveModelProfile('sonnet-5-thinking-alias');
check(
  resThinkingAlias.canonicalId === 'claude-sonnet-5',
  'Runtime alias ending with -thinking-alias resolves to parent profile',
  `Expected canonical claude-sonnet-5, got ${resThinkingAlias.canonicalId}`
);

// 3. Stress test PXPIPE_MODELS_CONFIG format with partial renderProfile overrides
applyRuntimeConfigOverrides({
  PXPIPE_MODELS_CONFIG: {
    'gpt-5.6-sol': {
      renderProfile: {
        stripCols: 120,
      },
    },
  },
});

const resPartialRender = resolveModelProfile('gpt-5.6-sol');
check(
  resPartialRender.renderProfile.stripCols === 120,
  'Partial renderProfile override sets stripCols',
  `Expected 120, got ${resPartialRender.renderProfile.stripCols}`
);
check(
  resPartialRender.renderProfile.style.font === 'spleen-5x8',
  'Partial renderProfile override preserves existing style.font',
  `Expected spleen-5x8, got ${resPartialRender.renderProfile.style.font}`
);

// 4. Stress test edge cases with null/undefined inputs
try {
  applyRuntimeConfigOverrides(null as any);
  applyRuntimeConfigOverrides(undefined as any);
  applyRuntimeConfigOverrides({ modelProfiles: null });
  applyRuntimeConfigOverrides({ modelProfiles: { 'invalid-entry': null } });
  check(true, 'applyRuntimeConfigOverrides handles null/undefined inputs gracefully');
} catch (e: any) {
  check(false, 'applyRuntimeConfigOverrides handles null/undefined inputs gracefully', e?.message);
}

console.log(`\nRuntime Override Stress Summary: ${pass} PASSED, ${fail} FAILED.`);
