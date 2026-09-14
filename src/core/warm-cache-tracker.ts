/**
 * Warm Cache Tracker
 *
 * Tracks prompt cache warmth per (provider, endpoint, canonicalModel, identity)
 * based on observed response usage (cached_tokens > 0).
 *
 * Cache identities (x-grok-conv-id for Chat, prompt_cache_key for Responses)
 * indicate routing affinity, not guaranteed cache hits.
 * Only observed positive cached_tokens indicates a warm cache state.
 */

export interface CacheTrackerEntry {
  lastSeenMs: number;
  warm: boolean;
}

export interface WarmCacheTrackerOptions {
  ttlMs?: number; // default 10 minutes (600,000 ms)
  maxEntries?: number; // default 1000
}

export class WarmCacheTracker {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheTrackerEntry>();

  constructor(options?: WarmCacheTrackerOptions) {
    this.ttlMs = options?.ttlMs ?? 10 * 60 * 1000;
    this.maxEntries = options?.maxEntries ?? 1000;
  }

  public buildKey(
    provider: string,
    endpoint: 'chat' | 'responses' | string,
    model: string,
    identity: string,
  ): string {
    const p = provider.trim().toLowerCase();
    const ep = endpoint.trim().toLowerCase();
    const m = model.trim().toLowerCase();
    const id = identity.trim();
    return `${p}:${ep}:${m}:${id}`;
  }

  public isWarm(key: string): boolean {
    if (!key) return false;
    const entry = this.entries.get(key);
    if (!entry) return false;
    const now = Date.now();
    if (now - entry.lastSeenMs > this.ttlMs) {
      this.entries.delete(key);
      return false;
    }
    // Update LRU position on access
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.warm;
  }

  public recordUsage(key: string, cachedTokens: number): void {
    if (!key) return;
    const now = Date.now();
    const warm = cachedTokens > 0;

    // Evict oldest if capacity exceeded
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.delete(key);
    this.entries.set(key, { lastSeenMs: now, warm });
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}

export const warmCacheTracker = new WarmCacheTracker();
