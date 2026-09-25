/**
 * Storage-budget planning for the offline audio cache (#31).
 *
 * Pure: it takes a cache inventory and a budget, and returns what to
 * protect and what to evict. It performs no IO, so every rule here is
 * driven directly by the regression suite.
 *
 * The existing cache index (modules/audioStreaming.ts) already records
 * `sizeBytes` and `lastUsedAt` per entry, so the budget is enforced
 * against real numbers rather than a track count.
 */

/** One cached track as the planner sees it. */
export type CacheBudgetEntry = {
  trackId: string;
  sizeBytes: number;
  /** Last time the cached file was read or written. */
  lastUsedAt: number;
  /** Partial downloads are evicted before complete ones. */
  isFullyCached?: boolean;
  /** In-flight downloads are never a victim: evicting one races the writer. */
  isDownloading?: boolean;
};

export type CacheCapMb = 500 | 2000 | 5000;

export const CACHE_CAP_OPTIONS_MB: readonly CacheCapMb[] = [500, 2000, 5000];

/** Smallest cap we allow; below this a handful of tracks fills the budget. */
export const MIN_CACHE_CAP_MB = 500;

const MB = 1024 * 1024;

export const toBytes = (mb: number): number => Math.max(0, mb) * MB;

export const toMegabytes = (bytes: number): number => Math.max(0, bytes / MB);

/** Normalizes any persisted/inbound value to a supported cap. */
export function sanitizeCacheCapMb(value: unknown): CacheCapMb {
  const mb = typeof value === "number" && Number.isFinite(value) ? value : MIN_CACHE_CAP_MB;
  // Snap to the nearest offered option so a hand-edited or future value
  // can never produce a cap the Settings UI cannot display.
  let best: CacheCapMb = CACHE_CAP_OPTIONS_MB[0];
  for (const option of CACHE_CAP_OPTIONS_MB) {
    if (Math.abs(option - mb) < Math.abs(best - mb)) {
      best = option;
    }
  }
  return best;
}

export type EvictionPlan = {
  /** Entries the user asked to keep, plus everything not selected for eviction. */
  keep: CacheBudgetEntry[];
  /** Oldest-first; the caller evicts in this order until it is back under cap. */
  evict: CacheBudgetEntry[];
  /** Total bytes of `keep` after the plan is applied. */
  projectedBytes: number;
  /** True when something has to go to honor the cap. */
  overBudget: boolean;
};

const usableBytes = (entry: CacheBudgetEntry): number =>
  Math.max(0, entry.sizeBytes || 0);

/**
 * Picks eviction victims until the remaining cache fits the cap.
 *
 * Order, most-ex expendable first:
 *   1. partial downloads (already-wasted bytes, recoverable by re-caching)
 *   2. complete tracks, oldest `lastUsedAt` first
 *
 * Pinned ids are never evicted, which is how a per-playlist "keep offline"
 * toggle (and a currently-playing track) survives a full cache.
 */
export function planCacheEviction(
  entries: CacheBudgetEntry[],
  capMb: number,
  pinnedTrackIds: Iterable<string> = [],
): EvictionPlan {
  const pinned = new Set(pinnedTrackIds);
  const capBytes = toBytes(sanitizeCacheCapMb(capMb));

  const evictable = entries.filter(
    (entry) => !pinned.has(entry.trackId) && !entry.isDownloading,
  );
  const protectedBytes = entries
    .filter((entry) => pinned.has(entry.trackId) || entry.isDownloading)
    .reduce((sum, entry) => sum + usableBytes(entry), 0);

  // Over budget by how much? Negative means there is headroom to spare.
  const excessBytes = protectedBytes + evictable.reduce((s, e) => s + usableBytes(e), 0) - capBytes;

  if (excessBytes <= 0) {
    return {
      keep: entries,
      evict: [],
      projectedBytes: protectedBytes + evictable.reduce((s, e) => s + usableBytes(e), 0),
      overBudget: false,
    };
  }

  // Partial downloads first, then complete tracks oldest-first. Ties break on
  // trackId so the plan is deterministic across runs.
  const ranked = [...evictable].sort((a, b) => {
    // Partials (1) sort BEFORE complete tracks (0).
    const aPartial = a.isFullyCached ? 0 : 1;
    const bPartial = b.isFullyCached ? 0 : 1;
    if (aPartial !== bPartial) return bPartial - aPartial;
    if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt - b.lastUsedAt;
    return a.trackId < b.trackId ? -1 : a.trackId > b.trackId ? 1 : 0;
  });

  const evict: CacheBudgetEntry[] = [];
  let freed = 0;
  for (const entry of ranked) {
    if (freed >= excessBytes) break;
    evict.push(entry);
    freed += usableBytes(entry);
  }

  const keep = entries.filter(
    (entry) => !evict.some((victim) => victim.trackId === entry.trackId),
  );

  return {
    keep,
    evict,
    projectedBytes: protectedBytes + keep
      .filter((entry) => !pinned.has(entry.trackId))
      .reduce((s, e) => s + usableBytes(e), 0),
    overBudget: true,
  };
}

/**
 * Breakdown for the Settings storage row: bytes per cache bucket.
 * `liked` wins over `other` so a track counted twice is not double-counted.
 */
export function summarizeCacheUsage(
  entries: CacheBudgetEntry[],
  likedTrackIds: Iterable<string> = [],
): { likedBytes: number; otherBytes: number; partialBytes: number; totalBytes: number } {
  const liked = new Set(likedTrackIds);
  let likedBytes = 0;
  let otherBytes = 0;
  let partialBytes = 0;

  for (const entry of entries) {
    const bytes = usableBytes(entry);
    if (liked.has(entry.trackId)) likedBytes += bytes;
    else otherBytes += bytes;
    if (!entry.isFullyCached) partialBytes += bytes;
  }

  return {
    likedBytes,
    otherBytes,
    partialBytes,
    totalBytes: likedBytes + otherBytes,
  };
}
