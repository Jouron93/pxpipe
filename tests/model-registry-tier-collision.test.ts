import { describe, expect, it } from 'vitest';
import {
  applyRuntimeConfigOverrides,
  getAllModelProfiles,
  resolveModelProfile,
} from '../src/core/model-registry.js';

// Reproduces the 2026-09-04 collapse. Three COMPLETE config profiles whose ids differ only
// by a reasoning-tier suffix were registered as ONE entry: normalizeModelId() strips
// `-high|-medium|-low`, so every key normalized to the same base; the first to register
// also claimed aliasMap[base], and the next two resolved to it through that alias, took the
// merge branch, and never created their own entries. The live symptom was one registry
// entry keyed `...-medium` wearing the `(High)` displayName, and only that id advertised.
//
// A complete profile carries its own canonicalId. It must be looked up by that exact id,
// never through the normalized alias — the alias path exists for PARTIAL overrides.
// Ids here are synthetic so this file can never collide with a builtin.
const BASE = 'agy-tiercheck-9.9-flash';
const CASES = (['high', 'medium', 'low'] as const).map((tier) => ({ tier, id: `${BASE}-${tier}` }));
const IDS = CASES.map((c) => c.id);

function completeProfile(id: string, tier: string) {
  return {
    canonicalId: id,
    displayName: `Tier Check 9.9 Flash (${tier})`,
    family: 'agy',
    status: 'validated',
    enabledByDefault: false,
    pricing: { inputPerMtok: 0.75, cacheWritePerMtok: 0.9375, cacheReadPerMtok: 0.075, outputPerMtok: 3.75 },
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    factsheetEnabled: false,
    aliases: [`agy/${BASE}-${tier}`],
  };
}

describe('applyProfileMap: complete profiles that differ only by a tier suffix', () => {
  it('registers one entry per complete profile instead of collapsing them onto the first', () => {
    applyRuntimeConfigOverrides({
      modelProfiles: Object.fromEntries(
        CASES.map(({ id, tier }) => [id, completeProfile(id, tier)]),
      ),
    });

    const registered = getAllModelProfiles()
      .map((p) => p.canonicalId)
      .filter((c) => c.startsWith(`${BASE}-`))
      .sort();
    expect(registered).toEqual([...IDS].sort());

    for (const { id, tier } of CASES) {
      const profile = resolveModelProfile(id);
      expect(profile.canonicalId).toBe(id);
      expect(profile.displayName).toBe(`Tier Check 9.9 Flash (${tier})`);
    }
  });

  it('still routes a PARTIAL override to its profile through a declared alias', () => {
    // No canonicalId => this is an override, not a definition. `gemini-3.6-flash` is a
    // declared alias of the 3.6 high tier and a tier-less key must still land on it.
    applyRuntimeConfigOverrides({
      modelProfiles: { 'gemini-3.6-flash': { enabledByDefault: true } },
    });
    expect(resolveModelProfile('agy-gemini-3.6-flash-high').enabledByDefault).toBe(true);
  });
});
