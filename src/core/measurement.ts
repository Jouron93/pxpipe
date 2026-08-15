/**
 * Pure body-shaping utilities for the uncompressed count_tokens counterfactual.
 * No fetch, auth, or Node APIs — hosts supply their own transport.
 */

export interface CountTokensBodies {
  /** Full original body, filtered to count_tokens-accepted fields. */
  readonly fullBody: Uint8Array | null;
  /** Original body truncated at the latest cache_control marker; null when none exists. */
  readonly cacheablePrefixBody: Uint8Array | null;
}

/** Fields accepted by /v1/messages/count_tokens. Any other field returns 400 "Unknown parameter". */
const COUNT_TOKENS_FIELDS = new Set([
  'model',
  'messages',
  'system',
  'tools',
  'tool_choice',
  'thinking',
  'mcp_servers',
]);

type BytesLike = Uint8Array | ArrayBuffer | ArrayBufferView;

function toUint8Array(bytes: BytesLike): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function buildCountTokensBodies(bytes: BytesLike): CountTokensBodies {
  const b = toUint8Array(bytes);
  return {
    fullBody: buildBaselineCountTokensBody(b),
    cacheablePrefixBody: buildCacheablePrefixCountTokensBody(b),
  };
}

export function buildBaselineCountTokensBody(bytes: BytesLike): Uint8Array | null {
  const b = toUint8Array(bytes);
  try {
    const obj = JSON.parse(new TextDecoder().decode(b)) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      if (COUNT_TOKENS_FIELDS.has(k)) out[k] = obj[k];
    }
    if (typeof out.model !== 'string' || !Array.isArray(out.messages)) return null;
    clampCacheControlMarkers(out, 4);
    return new TextEncoder().encode(JSON.stringify(out));
  } catch {
    return null;
  }
}

/** True when an object carries a cache_control key (presence only; value ignored). */
function hasCacheControl(x: unknown): boolean {
  return (
    typeof x === 'object'
    && x !== null
    && (x as { cache_control?: unknown }).cache_control != null
  );
}

/** Return tool_use ids with no matching tool_result. count_tokens rejects orphans;
 *  truncating at a cache_control marker commonly creates them (result is in the dropped tail). */
function findOrphanToolUseIds(messages: unknown[]): string[] {
  const uses: string[] = [];
  const results = new Set<string>();
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const blk of content) {
      if (!blk || typeof blk !== 'object') continue;
      const t = (blk as { type?: unknown }).type;
      if (t === 'tool_use') {
        const id = (blk as { id?: unknown }).id;
        if (typeof id === 'string') uses.push(id);
      } else if (t === 'tool_result') {
        const id = (blk as { tool_use_id?: unknown }).tool_use_id;
        if (typeof id === 'string') results.add(id);
      }
    }
  }
  return uses.filter((id) => !results.has(id));
}

/** Append minimal synthetic tool_results for orphan tool_use ids so count_tokens won't reject the body.
 *  Adds only a handful of tokens; keeps estimate within ~1% of truth. */
function appendSyntheticToolResults(
  truncated: Record<string, unknown>,
): Record<string, unknown> {
  const messages = truncated.messages;
  if (!Array.isArray(messages)) return truncated;
  const orphanIds = findOrphanToolUseIds(messages);
  if (orphanIds.length === 0) return truncated;
  const syntheticUserMsg = {
    role: 'user',
    content: orphanIds.map((id) => ({
      type: 'tool_result',
      tool_use_id: id,
      content: 'ok',
    })),
  };
  return { ...truncated, messages: [...messages, syntheticUserMsg] };
}


/** Build a body containing only the longest cacheable prefix (everything up to and including the last
 *  cache_control marker). count_tokens on this body gives cacheable_prefix_tokens.
 *  Walk order (latest-first in cache order): messages → system → tools.
 *  Returns null when no markers exist (cacheable_prefix_tokens = 0). */
export function buildCacheablePrefixCountTokensBody(bytes: BytesLike): Uint8Array | null {
  const b = toUint8Array(bytes);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(new TextDecoder().decode(b)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof obj.model !== 'string') return null;

  const system = obj.system;
  const messages = obj.messages;
  const tools = obj.tools;

  let truncated: Record<string, unknown> | null = null;
  if (Array.isArray(messages)) {
    for (let mi = messages.length - 1; mi >= 0 && truncated == null; mi--) {
      const msg = messages[mi] as { role?: unknown; content?: unknown };
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (let bi = content.length - 1; bi >= 0; bi--) {
          if (hasCacheControl(content[bi])) {
            const truncatedMsg = { ...msg, content: content.slice(0, bi + 1) };
            const truncatedMessages = messages.slice(0, mi).concat([truncatedMsg]);
            truncated = {
              model: obj.model,
              messages: truncatedMessages,
            };
            if (system !== undefined) truncated.system = system;
            if (tools !== undefined) truncated.tools = tools;
            break;
          }
        }
      } else if (hasCacheControl(msg)) {
        truncated = {
          model: obj.model,
          messages: messages.slice(0, mi + 1),
        };
        if (system !== undefined) truncated.system = system;
        if (tools !== undefined) truncated.tools = tools;
      }
    }
  }

  if (truncated == null && Array.isArray(system)) {
    for (let si = system.length - 1; si >= 0; si--) {
      if (hasCacheControl(system[si])) {
        truncated = {
          model: obj.model,
          system: system.slice(0, si + 1),
          messages: [{ role: 'user', content: 'x' }],
        };
        if (tools !== undefined) truncated.tools = tools;
        break;
      }
    }
  }

  if (truncated == null && Array.isArray(tools)) {
    for (let ti = tools.length - 1; ti >= 0; ti--) {
      if (hasCacheControl(tools[ti])) {
        truncated = {
          model: obj.model,
          tools: tools.slice(0, ti + 1),
          messages: [{ role: 'user', content: 'x' }],
        };
        break;
      }
    }
  }

  if (truncated == null) return null;
  truncated = appendSyntheticToolResults(truncated);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(truncated)) {
    if (COUNT_TOKENS_FIELDS.has(k)) out[k] = truncated[k];
  }
  return new TextEncoder().encode(JSON.stringify(out));
}

/** Count cache_control markers anywhere in an Anthropic Messages body. */
export function countCacheControlMarkers(bytes: BytesLike): number {
  const b = toUint8Array(bytes);
  try {
    return countCacheControlValue(JSON.parse(new TextDecoder().decode(b)));
  } catch {
    return 0;
  }
}

function countCacheControlValue(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let n = hasCacheControl(value) ? 1 : 0;
  if (Array.isArray(value)) {
    for (const item of value) n += countCacheControlValue(item);
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      n += countCacheControlValue(item);
    }
  }
  return n;
}

export interface MarkerTarget {
  cache_control?: unknown;
}

/**
 * Enforce Anthropic's hard cap of at most 4 cache_control blocks per request.
 * If > 4 markers are found across tools, system, and messages, prunes lower-priority
 * intermediate markers to guarantee count <= 4 without breaking prefix cache integrity.
 */
export function clampCacheControlMarkers(
  req: { tools?: unknown; system?: unknown; messages?: unknown },
  maxMarkers = 4,
): number {
  if (!req || typeof req !== 'object') return 0;

  interface MarkerRef {
    target: Record<string, unknown>;
    kind: 'tool' | 'system' | 'msg_first' | 'msg_last' | 'msg_mid';
    order: number;
  }

  const refs: MarkerRef[] = [];
  let order = 0;

  // 1. Scan tools
  if (Array.isArray(req.tools)) {
    for (const t of req.tools) {
      if (t && typeof t === 'object' && (t as Record<string, unknown>).cache_control != null) {
        refs.push({ target: t as Record<string, unknown>, kind: 'tool', order: order++ });
      }
    }
  }

  // 2. Scan system
  if (Array.isArray(req.system)) {
    for (const s of req.system) {
      if (s && typeof s === 'object' && (s as Record<string, unknown>).cache_control != null) {
        refs.push({ target: s as Record<string, unknown>, kind: 'system', order: order++ });
      }
    }
  } else if (req.system && typeof req.system === 'object' && (req.system as Record<string, unknown>).cache_control != null) {
    refs.push({ target: req.system as Record<string, unknown>, kind: 'system', order: order++ });
  }

  // 3. Scan messages
  const msgRefs: MarkerRef[] = [];
  if (Array.isArray(req.messages)) {
    for (let i = 0; i < req.messages.length; i++) {
      const m = req.messages[i];
      if (!m || typeof m !== 'object') continue;
      const content = (m as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && typeof b === 'object' && (b as Record<string, unknown>).cache_control != null) {
            msgRefs.push({ target: b as Record<string, unknown>, kind: 'msg_mid', order: order++ });
          }
        }
      } else if (content && typeof content === 'object' && (content as Record<string, unknown>).cache_control != null) {
        msgRefs.push({ target: content as Record<string, unknown>, kind: 'msg_mid', order: order++ });
      }
    }
  }

  // Refine message marker kinds: first vs last vs middle
  if (msgRefs.length > 0) {
    msgRefs[0]!.kind = 'msg_first';
    if (msgRefs.length > 1) {
      msgRefs[msgRefs.length - 1]!.kind = 'msg_last';
    }
  }

  refs.push(...msgRefs);

  if (refs.length <= maxMarkers) {
    return refs.length;
  }

  // Priority: 1. tool, 2. system, 3. msg_last (live turn), 4. msg_first (carry-over chunk), 5. msg_mid
  const priorityOrder = (kind: MarkerRef['kind']): number => {
    switch (kind) {
      case 'tool': return 1;
      case 'system': return 2;
      case 'msg_last': return 3;
      case 'msg_first': return 4;
      case 'msg_mid': return 5;
    }
  };

  const ranked = [...refs].sort((a, b) => {
    const pDiff = priorityOrder(a.kind) - priorityOrder(b.kind);
    if (pDiff !== 0) return pDiff;
    // For msg_mid, drop older middle markers before newer middle markers
    if (a.kind === 'msg_mid' && b.kind === 'msg_mid') return b.order - a.order;
    return a.order - b.order;
  });

  const toDrop = ranked.slice(maxMarkers);
  for (const ref of toDrop) {
    delete ref.target.cache_control;
  }

  return maxMarkers;
}
