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
    .replace(/\((thinking|high|medium|med|low)\)/g, '')
    .replace(/[ _]+/g, '-')
    .replace(/[^a-z0-9.:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-(thinking|high|medium|med|low|fast|stable|low-context|long-context|reason|nonreason|reasoning|reasoner|effort|thought|extended-thinking|extended|high-effort|medium-effort|low-effort|high-thinking|medium-thinking|low-thinking)$/, '');
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

function applyConfiguredSubscriptionLane(card: ModelRateCard, route?: PricingRoute): ModelRateCard {
  const lane = route?.billingLane;
  if (!lane || !SUBSCRIPTION_LANES.has(lane)) return card;
  if (card.status === 'quota_only') return card;
  return {
    ...card,
    id: card.id.startsWith('agy:') ? card.id : `agy:${card.canonicalModel}`,
    status: 'quota_only',
    note: [
      card.note,
      `Configured billing lane ${lane} (source ${route?.billingLaneSource ?? 'configured_route'}); public rates are API-equivalent reference only.`,
    ]
      .filter(Boolean)
      .join(' '),
  };
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
  const isNvidia =
    raw.startsWith('nvidia/') || raw.startsWith('nvidia:') || raw.startsWith('nvidia-');
  if (isNvidia) {
    raw = raw.replace(/^nvidia[-/:]/, '');
  }

  if (isOpenRouter) {
    // OpenRouter is a router, not a provider rate card. Do not inherit direct
    // provider cash rates from the stripped model name without an authoritative
    // OpenRouter allocation. Fail closed.
    const underlying = resolveModelRateInternal(raw, inputTokens, false);
    const canonical = underlying.canonicalModel || normalizeModelName(raw) || 'openrouter-model';
    const card: ModelRateCard = {
      id: quotaOnly ? `agy:${canonical}` : `openrouter:${canonical}`,
      provider: 'openrouter',
      canonicalModel: canonical,
      status: quotaOnly ? 'quota_only' : 'allocation_required',
      source: OPENROUTER_SOURCE,
      note: quotaOnly
        ? 'OpenRouter lane on a subscription bridge; route provenance required for cash allocation. Public rates withheld.'
        : 'OpenRouter routes to upstream providers; route provenance required for cost allocation.',
      contextWindowTokens: underlying.contextWindowTokens,
      maxOutputTokens: underlying.maxOutputTokens,
    };
    return applyConfiguredSubscriptionLane(card, route);
  }

  if (isNvidia) {
    const underlying = resolveModelRateInternal(raw, inputTokens, false);
    const canonical = underlying.canonicalModel || normalizeModelName(raw) || 'nvidia-model';
    // Free Build catalog claim requires explicit configured_route provenance.
    // Model-name nvidia/ alone cannot distinguish free Build from paid/self-hosted NIM.
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
        contextWindowTokens: underlying.contextWindowTokens,
        maxOutputTokens: underlying.maxOutputTokens,
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
        contextWindowTokens: underlying.contextWindowTokens,
        maxOutputTokens: underlying.maxOutputTokens,
      };
    }

    // Fail closed: bare nvidia/ or unresolved NIM cannot claim free or cash.
    return {
      id: `nvidia:${canonical}`,
      provider: 'nvidia',
      canonicalModel: canonical,
      status: 'allocation_required',
      source: 'https://docs.api.nvidia.com/nim/docs/product',
      note: 'Build API and self-hosted NIM have different economics; configured route provenance is required before assigning free or cash rates.',
      contextWindowTokens: underlying.contextWindowTokens ?? 131_072,
      maxOutputTokens: underlying.maxOutputTokens,
    };
  }

  const card = resolveModelRateInternal(raw, inputTokens, quotaOnly);
  return applyConfiguredSubscriptionLane(card, route);
}

function resolveModelRateInternal(model: string | undefined, inputTokens: number, quotaOnly: boolean): ModelRateCard {
  const m = normalizeModelName(model);
  let base = m;
  if (base === 'opus') base = 'claude-opus-4-8';
  if (base === 'sonnet') base = 'claude-sonnet-5';

  const lane = (card: ModelRateCard): ModelRateCard =>
    quotaOnly
      ? {
          ...card,
          id: `agy:${card.canonicalModel}`,
          status: 'quota_only',
          note: [card.note, 'AGY subscription lane; public rates are API-equivalent only. Upstream capacity is reference metadata because AGY does not expose its effective context limit.']
            .filter(Boolean).join(' '),
        }
      : card;

  if (/^(gpt-5\.6-sol|gpt-5\.6)(?:-\d{4}-\d{2}-\d{2})?$/.test(base)) {
    if (inputTokens > 272_000) {
      return lane(priced('openai:gpt-5.6-sol:long', 'openai', 'gpt-5.6-sol', 10, 1, 45, OPENAI_SOURCE, {
        note: 'Long-context tier: 2x input and 1.5x output.',
        contextWindowTokens: 1_050_000, maxOutputTokens: 128_000,
      }));
    }
    return lane(priced('openai:gpt-5.6-sol', 'openai', 'gpt-5.6-sol', 5, 0.5, 30, OPENAI_SOURCE, {
      cacheWrite5mPerMtok: 6.25,
      contextWindowTokens: 1_050_000, maxOutputTokens: 128_000,
    }));
  }
  for (const [id, input, cached, output] of [
    ['gpt-5.6-terra', 2.5, 0.25, 15], ['gpt-5.6-luna', 1, 0.1, 6], ['gpt-5.4', 2.5, 0.25, 15],
  ] as const) {
    if (base.includes(id)) {
      const long = inputTokens > 272_000;
      return lane(priced(`openai:${id}${long ? ':long' : ''}`, 'openai', id,
        long ? input * 2 : input, long ? cached * 2 : cached, long ? output * 1.5 : output,
        OPENAI_SOURCE, {
          contextWindowTokens: 1_050_000, maxOutputTokens: 128_000,
          ...(long ? { note: 'Long-context tier: 2x input and 1.5x output.' } : {}),
      }));
    }
  }

  if (/^gpt-5\.5(?:-2026-04-23)?$/.test(base)) {
    const long = inputTokens > 272_000;
    return lane(priced(`openai:gpt-5.5${long ? ':long' : ''}`, 'openai', 'gpt-5.5',
      long ? 10 : 5, long ? 1 : 0.5, long ? 45 : 30, OPENAI_SOURCE, {
        contextWindowTokens: 1_050_000,
        maxOutputTokens: 128_000,
        ...(long ? { note: 'Long-context tier: 2x input and 1.5x output.' } : {}),
      }));
  }

  if (base.includes('claude-fable-5') || base.includes('claude-mythos-5')) {
    const id = base.includes('mythos') ? 'claude-mythos-5' : 'claude-fable-5';
    return lane(priced(`anthropic:${id}`, 'anthropic', id, 10, 1, 50, ANTHROPIC_SOURCE, {
      cacheWrite5mPerMtok: 12.5,
      cacheWrite1hPerMtok: 20,
      contextWindowTokens: 1_000_000, maxOutputTokens: 128_000,
    }));
  }
  if (/claude-opus-4[.-](6|7|8)/.test(base)) {
    const canonical = base.match(/claude-opus-4[.-](6|7|8)/)![0].replace('4.', '4-');
    return lane(priced(`anthropic:${canonical}`, 'anthropic', canonical, 5, 0.5, 25, ANTHROPIC_SOURCE, {
      cacheWrite5mPerMtok: 6.25,
      cacheWrite1hPerMtok: 10,
      contextWindowTokens: 1_000_000, maxOutputTokens: 128_000,
    }));
  }
  if (base.includes('claude-sonnet-5')) {
    return lane(priced('anthropic:claude-sonnet-5:promo', 'anthropic', 'claude-sonnet-5', 2, 0.2, 10, ANTHROPIC_SOURCE, {
      cacheWrite5mPerMtok: 2.5,
      cacheWrite1hPerMtok: 4,
      note: 'Promotional API rate through 2026-08-31.',
      contextWindowTokens: 1_000_000, maxOutputTokens: 128_000,
    }));
  }
  if (/claude-sonnet-4[.-]6/.test(base)) {
    return lane(priced('anthropic:claude-sonnet-4.6', 'anthropic', 'claude-sonnet-4.6', 3, 0.3, 15, ANTHROPIC_SOURCE, {
      cacheWrite5mPerMtok: 3.75,
      cacheWrite1hPerMtok: 6,
      contextWindowTokens: 1_000_000, maxOutputTokens: 64_000,
    }));
  }
  if (m.includes('claude-haiku-4.5') || m.includes('claude-haiku-4-5')) {
    const id = 'claude-haiku-4-5';
    return lane(priced(`anthropic:${id}`, 'anthropic', id, 1, 0.1, 5, ANTHROPIC_SOURCE, {
      cacheWrite5mPerMtok: 1.25,
      cacheWrite1hPerMtok: 2,
    }));
  }

  if (base.includes('gemini-3.5-pro')) {
    return lane(priced('google:gemini-3.5-pro', 'google', 'gemini-3.5-pro', 3.0, 0.3, 15, GEMINI_SOURCE, { contextWindowTokens: 2_097_152, maxOutputTokens: 65_536 }));
  }
  if (base.includes('gemini-3-pro') || base.includes('gemini-3.1-pro')) {
    return lane(inputTokens > 200_000
      ? priced('google:gemini-3.1-pro-preview:long', 'google', 'gemini-3.1-pro-preview', 4, 0.4, 18, GEMINI_SOURCE, { contextWindowTokens: 1_048_576, maxOutputTokens: 65_536 })
      : priced('google:gemini-3.1-pro-preview', 'google', 'gemini-3.1-pro-preview', 2, 0.2, 12, GEMINI_SOURCE, { contextWindowTokens: 1_048_576, maxOutputTokens: 65_536 }));
  }
  if (base.includes('gemini-3.5-flash') || base.includes('gemini-3-flash') || base.includes('gemini-3.1-flash')) {
    return lane(priced('google:gemini-3.5-flash', 'google', 'gemini-3.5-flash', 1.5, 0.15, 9, GEMINI_SOURCE, { contextWindowTokens: 1_048_576, maxOutputTokens: 65_536 }));
  }
  if (base.includes('gemini-3.1-flash-lite')) return lane(priced('google:gemini-3.1-flash-lite', 'google', 'gemini-3.1-flash-lite', 0.25, 0.025, 1.5, GEMINI_SOURCE, { contextWindowTokens: 1_048_576, maxOutputTokens: 65_536 }));

  if (m.includes('grok-build-0.1')) return priced('xai:grok-build-0.1', 'xai', 'grok-build-0.1', 1, 0.2, 2, XAI_SOURCE);
  if (base.includes('grok-4.5')) return priced('xai:grok-4.5', 'xai', 'grok-4.5', 2, 0.5, 6, XAI_SOURCE, { contextWindowTokens: 500_000 });
  if (base.includes('grok-4')) return priced('xai:grok-4', 'xai', 'grok-4', 2, 0.5, 6, XAI_SOURCE, { contextWindowTokens: 500_000 });
  if (/grok-4[.-](3|20)/.test(base)) return priced(`xai:${base}`, 'xai', base, 1.25, 0.2, 2.5, XAI_SOURCE, { contextWindowTokens: 1_000_000 });

  if (/deepseek-(v4-flash|chat|reasoner)/.test(base)) {
    return priced('deepseek:deepseek-v4-flash', 'deepseek', 'deepseek-v4-flash', 0.14, 0.0028, 0.28, DEEPSEEK_SOURCE, {
      contextWindowTokens: 1_000_000, maxOutputTokens: 384_000,
      note: base === 'deepseek-v4-flash' ? undefined : 'Temporary alias; use deepseek-v4-flash.',
    });
  }
  if (base.includes('deepseek-v4-pro')) {
    return priced('deepseek:deepseek-v4-pro', 'deepseek', 'deepseek-v4-pro', 0.435, 0.003625, 0.87, DEEPSEEK_SOURCE, {
      contextWindowTokens: 1_000_000, maxOutputTokens: 384_000,
    });
  }

  // Kimi (Moonshot AI) models
  if (/^moonshot-v1-(8k|32k|128k)$/.test(base)) {
    const tokens = base.split('-').pop();
    let input = 0.20;
    let output = 2.00;
    let context = 8192;
    if (tokens === '32k') {
      input = 1.00;
      output = 3.00;
      context = 32768;
    } else if (tokens === '128k') {
      input = 2.00;
      output = 5.00;
      context = 131072;
    }
    return lane(priced(`moonshot:${base}`, 'moonshot', base, input, undefined, output, MOONSHOT_V1_SOURCE, {
      contextWindowTokens: context,
    }));
  }
  if (base === 'kimi-k2.7-code') {
    return lane(priced('moonshot:kimi-k2.7-code', 'moonshot', 'kimi-k2.7-code', 0.95, 0.19, 4.00, KIMI_K27_SOURCE, {
      contextWindowTokens: 262144,
    }));
  }
  if (base === 'kimi-k2.6') {
    return lane(priced('moonshot:kimi-k2.6', 'moonshot', 'kimi-k2.6', 0.95, 0.16, 4.00, KIMI_K26_SOURCE, {
      contextWindowTokens: 262144,
    }));
  }

  // GLM (Zhipu AI) models
  if (base === 'glm-4.7-flash' || base === 'glm-4.5-flash') {
    const canonical = base;
    return lane({
      id: `zhipu:${canonical}`,
      provider: 'zhipu',
      canonicalModel: canonical,
      status: 'free_by_terms',
      inputPerMtok: 0,
      cachedInputPerMtok: 0,
      outputPerMtok: 0,
      contextWindowTokens: 128000,
      source: ZHIPU_SOURCE,
    });
  }
  if (base === 'glm-4.5-air') {
    return lane(priced('zhipu:glm-4.5-air', 'zhipu', 'glm-4.5-air', 0.20, 0.03, 1.10, ZHIPU_SOURCE, {
      contextWindowTokens: 128000,
    }));
  }
  if (base === 'glm-4-32b-0414-128k') {
    return lane(priced('zhipu:glm-4-32b-0414-128k', 'zhipu', 'glm-4-32b-0414-128k', 0.10, undefined, 0.10, ZHIPU_SOURCE, {
      contextWindowTokens: 128000,
    }));
  }

  // GPT-OSS is an open-weight model. AGY/NIM/OpenRouter/local deployments can
  // price the same weights differently, so model name alone cannot assign $.
  if (m.includes('gpt-oss')) {
    if (quotaOnly) {
      return {
        id: 'agy:gpt-oss-120b', provider: 'openai', canonicalModel: 'gpt-oss-120b',
        status: 'quota_only', source: 'AGY CLI subscription bridge',
        note: 'AGY subscription quota only; no authoritative request-level cash rate is exposed.',
      };
    }
    return {
      id: 'openai:gpt-oss', provider: 'openai', canonicalModel: m || 'gpt-oss',
      status: 'allocation_required', source: OPENAI_SOURCE,
      note: 'Open-weight model; route provenance is required for cost allocation.',
    };
  }
  if (/ornith|qwen|devstral|phi-?4|phi3|lmstudio|ollama/.test(m)) {
    return {
      id: `local:${m || 'unknown'}`, provider: 'local', canonicalModel: m || 'local model',
      status: 'allocation_required', source: 'local runtime',
      note: 'No provider token charge; hardware and power allocation are not inferred.',
    };
  }
  if (/nemotron|nvidia|nim/.test(m)) {
    return {
      id: `nvidia:${m || 'unknown'}`, provider: 'nvidia', canonicalModel: m || 'NVIDIA NIM model',
      status: 'allocation_required', source: 'https://docs.api.nvidia.com/nim/docs/product',
      note: 'Build API and self-hosted NIM have different economics; route provenance is required.',
      contextWindowTokens: 131_072,
    };
  }

  return {
    id: `unknown:${m || 'missing'}`, provider: 'unknown', canonicalModel: m || 'unreported model',
    status: 'unavailable', source: 'no matching authoritative rate card',
    note: 'Token telemetry is retained; dollar equivalence is withheld.',
  };
}

export function cacheReadRatio(
  model: string | undefined,
  inputTokens = 0,
  route?: PricingRoute,
): number {
  const r = resolveModelRate(model, inputTokens, route);
  return r.inputPerMtok && r.cachedInputPerMtok !== undefined
    ? r.cachedInputPerMtok / r.inputPerMtok
    : 1;
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
