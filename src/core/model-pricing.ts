/** Provider-aware API list-price equivalents for telemetry.
 *  Modified by AI agent under coordination with @jules
 *
 * These rates do not claim that OAuth/subscription traffic created a cash
 * charge. They answer the narrower counterfactual: what would the same token
 * usage cost at the model provider's public API list price? Clients and
 * routers (Codex, AGY CLI, Hermes, OpenClaw, Cursor) are deliberately not
 * treated as models.
 */

export type CostStatus =
  | 'api_equivalent'
  | 'quota_only'
  | 'allocation_required'
  | 'free_by_terms'
  | 'unavailable';

export interface ModelRateCard {
  id: string;
  provider: 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'openrouter' | 'nvidia' | 'local' | 'moonshot' | 'zhipu' | 'unknown';
  canonicalModel: string;
  status: CostStatus;
  inputPerMtok?: number;
  cachedInputPerMtok?: number;
  cacheWrite5mPerMtok?: number;
  cacheWrite1hPerMtok?: number;
  outputPerMtok?: number;
  /** Canonical upstream capacity; the gateway may enforce less. */
  contextWindowTokens?: number;
  /** Maximum synchronous API output where the provider publishes one. */
  maxOutputTokens?: number;
  source: string;
  note?: string;
}

const OPENAI_SOURCE = 'https://developers.openai.com/api/docs/models';
const ANTHROPIC_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
const GEMINI_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing';
const XAI_SOURCE = 'https://docs.x.ai/developers/pricing';
const DEEPSEEK_SOURCE = 'https://api-docs.deepseek.com/news/news260424/';
const MOONSHOT_V1_SOURCE = 'https://platform.kimi.ai/docs/pricing/chat-v1';
const KIMI_K27_SOURCE = 'https://platform.kimi.ai/docs/pricing/chat-k27-code';
const KIMI_K26_SOURCE = 'https://platform.kimi.ai/docs/pricing/chat-k26';
const ZHIPU_SOURCE = 'https://docs.z.ai/guides/overview/pricing';
const OPENROUTER_SOURCE = 'https://openrouter.ai/api/v1/models';
const NVIDIA_BUILD_SOURCE = 'https://build.nvidia.com';

/** Optional route/provenance context for pricing. Model name alone is not
 * route provenance; explicit billing-lane configuration takes precedence. */
export interface PricingRoute {
  billingLane?: string;
  billingLaneSource?: string;
  /** Successful upstream model when it differs from the client request. */
  actualModel?: string;
}

const SUBSCRIPTION_LANES = new Set([
  'agy_ultra_subscription',
  'claude_max_subscription',
  'codex_subscription',
  'grok_subscription',
]);

/** Normalize display names, provider prefixes, effort suffixes, and context
 * markers without losing the underlying model identity. */
export function normalizeModelName(model: string | undefined): string {
  return (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/^(openai|anthropic|google|x-ai|xai|moonshot|zhipu|kimi|nvidia)[/:]/, '')
    .replace(/\[1m\]$/g, '')
    .replace(/\((thinking|xhigh|high|medium|med|low|max)\)/g, '')
    .replace(/[ _]+/g, '-')
    .replace(/[^a-z0-9.:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-(thinking|xhigh|high|medium|med|low|max|fast|stable|low-context|long-context|reason|nonreason|reasoning|reasoner|effort|thought|extended-thinking|extended|xhigh-effort|high-effort|medium-effort|low-effort|xhigh-thinking|high-thinking|medium-thinking|low-thinking)$/, '');
}

function priced(
  id: string,
  provider: ModelRateCard['provider'],
  canonicalModel: string,
  inputPerMtok: number,
  cachedInputPerMtok: number | undefined,
  outputPerMtok: number,
  source: string,
  extra: Partial<ModelRateCard> = {},
): ModelRateCard {
  return {
    id,
    provider,
    canonicalModel,
    status: 'api_equivalent',
    inputPerMtok,
    ...(cachedInputPerMtok !== undefined ? { cachedInputPerMtok } : {}),
    outputPerMtok,
    source,
    ...extra,
  };
}

function subscriptionPrefixForLane(lane?: string): 'claude' | 'codex' | 'agy' | 'grok' {
  if (lane === 'claude_max_subscription') return 'claude';
  if (lane === 'codex_subscription') return 'codex';
  if (lane === 'grok_subscription') return 'grok';
  return 'agy';
}

function subscriptionDisplayNameForLane(lane?: string): string {
  if (lane === 'claude_max_subscription') return 'Claude Max';
  if (lane === 'codex_subscription') return 'Codex';
  if (lane === 'grok_subscription') return 'SuperGrok';
  return 'AGY';
}

function applyConfiguredSubscriptionLane(card: ModelRateCard, route?: PricingRoute): ModelRateCard {
  const lane = route?.billingLane;
  if (!lane || !SUBSCRIPTION_LANES.has(lane)) return card;
  if (card.status === 'quota_only') return card;
  const prefix = subscriptionPrefixForLane(lane);
  const prefixRegex = /^(agy|claude|codex):/;
  return {
    ...card,
    id: prefixRegex.test(card.id) ? card.id : `${prefix}:${card.canonicalModel}`,
    status: 'quota_only',
    note: [
      card.note,
      `Configured billing lane ${lane} (source ${route?.billingLaneSource ?? 'configured_route'}); public rates are API-equivalent reference only.`,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

import {
  resolveModelProfile,
  type PxpipeModelProfile,
  type PricingRouteOverride,
} from './model-registry.js';

function getProviderFromProfile(profile: PxpipeModelProfile, rawModel: string): ModelRateCard['provider'] {
  const norm = rawModel.toLowerCase();
  if (norm.includes('moonshot') || norm.includes('kimi')) return 'moonshot';
  if (norm.includes('zhipu') || norm.includes('glm')) return 'zhipu';
  if (norm.includes('ornith') || norm.includes('lmstudio') || norm.includes('ollama')) return 'local';
  switch (profile.family) {
    case 'claude': return 'anthropic';
    case 'openai': return 'openai';
    case 'grok': return 'xai';
    case 'gemini': return 'google';
    case 'nvidia': return 'nvidia';
    case 'agy': {
      const id = profile.canonicalId.toLowerCase();
      if (id.includes('gemini')) return 'google';
      if (id.includes('claude') || id.includes('opus') || id.includes('sonnet') || id.includes('haiku')) return 'anthropic';
      if (id.includes('gpt')) return 'openai';
      return 'openai';
    }
    default: return 'unknown';
  }
}

/** Resolve aliases observed from Codex, AGY CLI, Hermes, OpenClaw, xAI, and
 * OpenAI-compatible proxies. High/Medium/Low are reasoning-effort settings,
 * not distinct price cards.
 *
 * Pricing uses the successful upstream actual model when provided, then falls
 * back to the requested model. Explicit configured billing lanes take
 * precedence over model-name inference. */
export function resolveModelRate(
  model: string | undefined,
  inputTokens = 0,
  route?: PricingRoute,
): ModelRateCard {
  if (route?.billingLane === 'local') {
    return {
      id: `local:${normalizeModelName(route.actualModel || model) || 'unknown'}`,
      provider: 'local',
      canonicalModel: normalizeModelName(route.actualModel || model) || 'local model',
      status: 'allocation_required',
      source: 'configured local route',
      note: 'Configured local route; no commercial provider token rate is inferred.',
    };
  }
  if (route?.billingLane === 'unknown') {
    return {
      id: `unknown:${normalizeModelName(route.actualModel || model) || 'missing'}`,
      provider: 'unknown',
      canonicalModel: normalizeModelName(route.actualModel || model) || 'unreported model',
      status: 'unavailable',
      source: 'unresolved configured route',
      note: 'Billing route is unknown; dollar equivalence is withheld.',
    };
  }

  const requestedRaw = (model || '').trim().toLowerCase();
  const pricingIdentity = (route?.actualModel?.trim() || model || '').trim();
  let raw = pricingIdentity.toLowerCase();

  // Detect subscription (agy) prefix on the model name
  const requestedQuotaOnly =
    requestedRaw.startsWith('agy-') || requestedRaw.startsWith('agy/') || requestedRaw.startsWith('agy:');
  let quotaOnly = requestedQuotaOnly || raw.startsWith('agy-') || raw.startsWith('agy/') || raw.startsWith('agy:');
  if (raw.startsWith('agy-') || raw.startsWith('agy/') || raw.startsWith('agy:')) {
    raw = raw.replace(/^agy[-/:]/, '');
  }
  // Configured subscription lanes also force quota-only treatment
  if (route?.billingLane && SUBSCRIPTION_LANES.has(route.billingLane)) {
    quotaOnly = true;
  }

  // Detect openrouter prefix
  const requestedWithoutAgy = requestedRaw.replace(/^agy[-/:]/, '');
  const actualIsOpenRouter =
    raw.startsWith('openrouter/') || raw.startsWith('openrouter-') || raw.startsWith('openrouter:');
  const isOpenRouter = actualIsOpenRouter
    || requestedWithoutAgy.startsWith('openrouter/')
    || requestedWithoutAgy.startsWith('openrouter-')
    || requestedWithoutAgy.startsWith('openrouter:');
  if (actualIsOpenRouter) {
    raw = raw.replace(/^openrouter[-/:]/, '');
  }

  // Detect nvidia prefix (catalog / NIM router IDs)
  const isNvidiaPrefix =
    raw.startsWith('nvidia/') || raw.startsWith('nvidia:') || raw.startsWith('nvidia-');
  if (isNvidiaPrefix) {
    raw = raw.replace(/^nvidia[-/:]/, '');
  }

  const profile = resolveModelProfile(raw || pricingIdentity, route as PricingRouteOverride);

  if (isOpenRouter) {
    const canonical = profile.canonicalId ? normalizeModelName(profile.canonicalId) : (normalizeModelName(raw) || 'openrouter-model');
    const card: ModelRateCard = {
      id: quotaOnly ? `agy:${canonical}` : `openrouter:${canonical}`,
      provider: 'openrouter',
      canonicalModel: canonical,
      status: quotaOnly ? 'quota_only' : 'allocation_required',
      source: OPENROUTER_SOURCE,
      note: quotaOnly
        ? 'OpenRouter lane on a subscription bridge; route provenance required for cash allocation. Public rates withheld.'
        : 'OpenRouter routes to upstream providers; route provenance required for cost allocation.',
      contextWindowTokens: profile.contextWindowTokens,
      maxOutputTokens: profile.maxOutputTokens,
    };
    return applyConfiguredSubscriptionLane(card, route);
  }

  const isNvidiaCatalog = isNvidiaPrefix || (profile.family === 'nvidia' && (raw.startsWith('nvidia') || raw.startsWith('deepseek') || raw.startsWith('meta/') || raw.startsWith('mistralai/') || raw.startsWith('qwen/') || raw.startsWith('bigcode/') || raw.includes('nemotron') || profile.canonicalId.startsWith('nvidia/')));

  if (isNvidiaCatalog) {
    const canonical = normalizeModelName(profile.canonicalId || raw) || 'nvidia-model';
    const allowFreeCatalog =
      route?.billingLane === 'nvidia_build_free'
      && route.billingLaneSource === 'configured_route';

    if (quotaOnly) {
      const card: ModelRateCard = {
        id: `agy:${canonical}`,
        provider: 'nvidia',
        canonicalModel: canonical,
        status: 'quota_only',
        inputPerMtok: 0,
        cachedInputPerMtok: 0,
        outputPerMtok: 0,
        source: NVIDIA_BUILD_SOURCE,
        note: 'NVIDIA-prefixed model on a subscription lane; zero cash rates. Public rates are API-equivalent reference only when a free Build catalog route is configured.',
        contextWindowTokens: profile.contextWindowTokens,
        maxOutputTokens: profile.maxOutputTokens,
      };
      return applyConfiguredSubscriptionLane(card, route);
    }

    if (allowFreeCatalog) {
      return {
        id: `nvidia:${canonical}`,
        provider: 'nvidia',
        canonicalModel: canonical,
        status: 'free_by_terms',
        inputPerMtok: 0,
        cachedInputPerMtok: 0,
        outputPerMtok: 0,
        source: NVIDIA_BUILD_SOURCE,
        note: 'Configured route marks this NVIDIA catalog endpoint free_by_terms (Developer Program Catalog).',
        contextWindowTokens: profile.contextWindowTokens,
        maxOutputTokens: profile.maxOutputTokens,
      };
    }

    return {
      id: `nvidia:${canonical}`,
      provider: 'nvidia',
      canonicalModel: canonical,
      status: 'allocation_required',
      source: 'https://docs.api.nvidia.com/nim/docs/product',
      note: 'Build API and self-hosted NIM have different economics; configured route provenance is required before assigning free or cash rates.',
      contextWindowTokens: profile.contextWindowTokens,
      maxOutputTokens: profile.maxOutputTokens,
    };
  }

  const provider = getProviderFromProfile(profile, raw || pricingIdentity);

  if (provider === 'local') {
    return {
      id: `local:${normalizeModelName(profile.canonicalId || raw) || 'unknown'}`,
      provider: 'local',
      canonicalModel: normalizeModelName(profile.canonicalId || raw) || 'local model',
      status: 'allocation_required',
      source: 'local runtime',
      note: 'No provider token charge; hardware and power allocation are not inferred.',
    };
  }

  if (provider === 'unknown' || raw === 'not-a-real-model') {
    return {
      id: `unknown:${normalizeModelName(raw) || 'missing'}`,
      provider: 'unknown',
      canonicalModel: normalizeModelName(raw) || 'unreported model',
      status: 'unavailable',
      source: 'no matching authoritative rate card',
      note: 'Token telemetry is retained; dollar equivalence is withheld.',
    };
  }

  if (profile.canonicalId.includes('gpt-oss') || raw.includes('gpt-oss')) {
    if (quotaOnly) {
      return {
        id: 'agy:gpt-oss-120b',
        provider: 'openai',
        canonicalModel: 'gpt-oss-120b',
        status: 'quota_only',
        source: 'AGY CLI subscription bridge',
        note: 'AGY subscription quota only; no authoritative request-level cash rate is exposed.',
      };
    }
    return {
      id: 'openai:gpt-oss',
      provider: 'openai',
      canonicalModel: normalizeModelName(raw) || 'gpt-oss',
      status: 'allocation_required',
      source: OPENAI_SOURCE,
      note: 'Open-weight model; route provenance is required for cost allocation.',
    };
  }

  const isLongContextGpt = inputTokens > 272_000 &&
    (profile.family === 'openai' || profile.canonicalId.startsWith('gpt-')) &&
    /^(gpt-5\.6-sol|gpt-5\.6-terra|gpt-5\.6-luna|gpt-5\.5|gpt-5\.4)$/.test(profile.canonicalId);

  const inputPerMtok = isLongContextGpt ? profile.pricing.inputPerMtok * 2 : profile.pricing.inputPerMtok;
  const cachedInputPerMtok = profile.pricing.cacheReadPerMtok !== undefined
    ? (isLongContextGpt ? profile.pricing.cacheReadPerMtok * 2 : profile.pricing.cacheReadPerMtok)
    : undefined;
  const outputPerMtok = isLongContextGpt ? profile.pricing.outputPerMtok * 1.5 : profile.pricing.outputPerMtok;

  const subPrefix = subscriptionPrefixForLane(route?.billingLane);
  const laneName = subscriptionDisplayNameForLane(route?.billingLane);

  const cardId = quotaOnly
    ? `${subPrefix}:${profile.canonicalId}`
    : (isLongContextGpt
        ? `${provider}:${profile.canonicalId}:long`
        : (profile.canonicalId === 'claude-sonnet-5' && !raw.includes('promo')
            ? `${provider}:${profile.canonicalId}:promo`
            : `${provider}:${profile.canonicalId}`));

  let cardStatus: CostStatus = quotaOnly ? 'quota_only' : 'api_equivalent';
  if (!quotaOnly && profile.pricing.inputPerMtok === 0) {
    if (profile.canonicalId === 'glm-4.5-flash' || profile.canonicalId === 'glm-4.7-flash') {
      cardStatus = 'free_by_terms';
    } else {
      cardStatus = 'unavailable';
    }
  }

  const cardSource = provider === 'openai' ? OPENAI_SOURCE
    : provider === 'anthropic' ? ANTHROPIC_SOURCE
    : provider === 'google' ? GEMINI_SOURCE
    : provider === 'xai' ? XAI_SOURCE
    : provider === 'nvidia' ? 'https://docs.api.nvidia.com/nim/docs/product'
    : provider === 'moonshot' ? (profile.canonicalId.includes('k2.7') ? KIMI_K27_SOURCE : profile.canonicalId.includes('k2.6') ? KIMI_K26_SOURCE : MOONSHOT_V1_SOURCE)
    : provider === 'zhipu' ? ZHIPU_SOURCE
    : 'https://docs.pxpipe.dev';

  let cardNote: string | undefined = undefined;
  if (quotaOnly) {
    cardNote = `${laneName} subscription lane; public rates are API-equivalent only. Upstream capacity is reference metadata because ${laneName} does not expose its effective context limit.`;
  } else if (isLongContextGpt) {
    cardNote = 'Long-context tier: 2x input and 1.5x output.';
  } else if (profile.canonicalId === 'claude-sonnet-5') {
    cardNote = 'Promotional API rate through 2026-08-31.';
  }

  const card: ModelRateCard = {
    id: cardId,
    provider,
    canonicalModel: profile.canonicalId,
    status: cardStatus,
    inputPerMtok,
    cachedInputPerMtok,
    ...(profile.pricing.cacheWritePerMtok !== undefined ? { cacheWrite5mPerMtok: profile.pricing.cacheWritePerMtok } : {}),
    outputPerMtok,
    contextWindowTokens: isLongContextGpt ? 1_050_000 : profile.contextWindowTokens,
    maxOutputTokens: profile.maxOutputTokens,
    source: cardSource,
    ...(cardNote ? { note: cardNote } : {}),
  };

  return applyConfiguredSubscriptionLane(card, route);
}

export function cacheReadRatio(
  model: string | undefined,
  inputTokens = 0,
  route?: PricingRoute,
): number {
  const r = resolveModelRate(model, inputTokens, route);
  if (r.inputPerMtok && r.cachedInputPerMtok !== undefined) {
    return r.cachedInputPerMtok / r.inputPerMtok;
  }
  const norm = normalizeModelName(model);
  if (norm.startsWith('grok-4.5') || norm === 'grok-build-latest') {
    return 0.15;
  }
  if (norm.startsWith('grok-4.3')) {
    return 0.16;
  }
  if (
    norm.startsWith('grok-4.6') ||
    norm.startsWith('grok-4-6') ||
    norm === 'grok' ||
    norm === 'grok-latest' ||
    norm.startsWith('grok-4') ||
    norm.startsWith('grok-4-0')
  ) {
    return 0.25;
  }
  return 1;
}

export function outputInputRatio(
  model: string | undefined,
  inputTokens = 0,
  route?: PricingRoute,
): number {
  const r = resolveModelRate(model, inputTokens, route);
  return r.inputPerMtok && r.outputPerMtok !== undefined
    ? r.outputPerMtok / r.inputPerMtok
    : 1;
}
