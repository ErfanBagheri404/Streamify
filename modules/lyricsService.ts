import { Track } from "../contexts/PlayerContext";
import {
  buildProviderUrlCandidates,
  getProviderEndpoints,
} from "../lib/provider-endpoints";
import { StorageService } from "../utils/storage";
import {
  buildLyricsCandidates,
  getTrackCacheKey,
  hasTimestampedLyrics,
  type LyricsCacheEntry,
  type LyricsCandidate,
} from "./lyricsShared";

type LrcLibResponse = {
  syncedLyrics?: unknown;
  plainLyrics?: unknown;
  trackName?: unknown;
  artistName?: unknown;
};

/**
 * Tracks whether any lyrics upstream was actually reached (HTTP response
 * received, any status code). A "miss" only counts when we asked and got an
 * answer — a network-level failure must not poison the miss cache, or one
 * offline moment suppresses lyrics lookups for 6 hours.
 */
type UpstreamReachContext = {
  reachedUpstream: boolean;
};

export type CachedLyrics = LyricsCacheEntry;

export interface LyricsSearchResult {
  id?: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  lyrics: string;
  isSynced: boolean;
}

const LYRICS_CACHE_KEY = "lyrics_cache";
const CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_CACHE_EXPIRY_MS = 6 * 60 * 60 * 1000;
const LYRICS_UPSTREAM_TIMEOUT_MS = 8000;
const MAX_LRCLIB_CANDIDATES = 3;
const MAX_LYRICS_OVH_CANDIDATES = 1;

function normalizeCacheEntry(entry: CachedLyrics): CachedLyrics {
  return {
    ...entry,
    isSynced: entry.isSynced ?? hasTimestampedLyrics(entry.lyrics),
  };
}

function selectLookupCandidates(
  candidates: LyricsCandidate[],
  maxCandidates: number,
): LyricsCandidate[] {
  const selected = candidates.slice(0, maxCandidates);
  const finalFallback =
    candidates.length > 0 ? candidates[candidates.length - 1] : undefined;

  if (
    finalFallback &&
    !selected.some(
      (candidate) =>
        candidate.artist.toLowerCase() === finalFallback.artist.toLowerCase() &&
        candidate.title.toLowerCase() === finalFallback.title.toLowerCase(),
    )
  ) {
    selected.push(finalFallback);
  }

  return selected;
}

export class LyricsService {
  private static instance: LyricsService;
  private cache = new Map<string, CachedLyrics>();
  private missCache = new Map<string, number>();
  private pendingRequests = new Map<string, Promise<CachedLyrics | null>>();
  private isCacheLoaded = false;

  private constructor() {}

  public static getInstance(): LyricsService {
    if (!LyricsService.instance) {
      LyricsService.instance = new LyricsService();
    }
    return LyricsService.instance;
  }

  private async loadCache(): Promise<void> {
    if (this.isCacheLoaded) {
      return;
    }

    try {
      const cachedData = await StorageService.getItem(LYRICS_CACHE_KEY);
      if (!cachedData) {
        this.isCacheLoaded = true;
        return;
      }

      const parsed = JSON.parse(cachedData) as Array<[string, CachedLyrics]>;
      const nextCache = new Map<string, CachedLyrics>();
      for (const [key, value] of parsed || []) {
        if (!key || !value?.lyrics) {
          continue;
        }
        nextCache.set(key, normalizeCacheEntry(value));
      }
      this.cache = nextCache;
      console.log(`[Lyrics] Loaded ${this.cache.size} cached lyrics`);
    } catch (error) {
      console.error("[Lyrics] Failed to load cache:", error);
    } finally {
      this.isCacheLoaded = true;
    }
  }

  private async saveCache(): Promise<void> {
    try {
      await StorageService.setItem(
        LYRICS_CACHE_KEY,
        JSON.stringify(Array.from(this.cache.entries())),
      );
    } catch (error) {
      console.error("[Lyrics] Failed to save cache:", error);
    }
  }

  private isCacheExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > CACHE_EXPIRY_MS;
  }

  private async fetchWithTimeout(
    url: string,
  ): Promise<{ response: Response; reachable: true } | { reachable: false }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      LYRICS_UPSTREAM_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        // lrclib rejects okhttp user-agents with HTTP 520, and RN's Android
        // fetch defaults to "okhttp/x.x.x". Send an explicit app UA instead.
        headers: { "User-Agent": "Streamify/20.32 (lyrics lookup)" },
      });
      return { response, reachable: true };
    } catch {
      // Network-level failure (offline, DNS, TLS, abort): the upstream was
      // never reached, so the caller must NOT treat this as "lyrics don't
      // exist" — only as "couldn't check right now".
      return { reachable: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchFirstSuccessfulResponse(
    urls: string[],
    reachContext: UpstreamReachContext,
  ): Promise<{ response: Response; url: string } | null> {
    for (const url of urls) {
      const result = await this.fetchWithTimeout(url);
      if (!result.reachable) {
        continue;
      }
      if (result.response.ok || result.response.status === 404) {
        // Only a successful answer or a definitive "not found" counts as the
        // upstream having spoken. 429/5xx are retryable — keep trying and
        // never let them mark the upstream as reached.
        reachContext.reachedUpstream = true;
      }
      if (result.response.ok) {
        return { response: result.response, url };
      }
    }

    return null;
  }

  private async fetchLrcLibLyrics(
    candidate: LyricsCandidate,
    durationSeconds: number | undefined,
    reachContext: UpstreamReachContext,
  ): Promise<CachedLyrics | null> {
    const providerEndpoints = await getProviderEndpoints();
    const requestVariants = [
      buildProviderUrlCandidates(
        providerEndpoints.providers.lyrics.lrclibBase,
        ["/get", "/api/get"],
        {
          artist_name: candidate.artist,
          track_name: candidate.title,
          duration:
            durationSeconds &&
            Number.isFinite(durationSeconds) &&
            durationSeconds > 0
              ? Math.round(durationSeconds)
              : undefined,
        },
      ),
      buildProviderUrlCandidates(
        providerEndpoints.providers.lyrics.lrclibBase,
        ["/get", "/api/get"],
        {
          artist_name: candidate.artist,
          track_name: candidate.title,
        },
      ),
    ];

    for (const urls of requestVariants) {
      const result = await this.fetchFirstSuccessfulResponse(urls, reachContext);
      if (!result) {
        continue;
      }

      const json = (await result.response.json()) as LrcLibResponse;
      const syncedLyrics =
        typeof json.syncedLyrics === "string" ? json.syncedLyrics.trim() : "";
      const plainLyrics =
        typeof json.plainLyrics === "string" ? json.plainLyrics.trim() : "";
      const lyrics =
        syncedLyrics && hasTimestampedLyrics(syncedLyrics)
          ? syncedLyrics
          : plainLyrics;

      if (!lyrics) {
        continue;
      }

      return normalizeCacheEntry({
        lyrics,
        artistName:
          typeof json.artistName === "string" && json.artistName.trim()
            ? json.artistName.trim()
            : candidate.artist,
        trackName:
          typeof json.trackName === "string" && json.trackName.trim()
            ? json.trackName.trim()
            : candidate.title,
        trackId: "",
        searchEngine: "lrclib",
        isSynced: lyrics === syncedLyrics && hasTimestampedLyrics(syncedLyrics),
        cachedAt: Date.now(),
        requestUrl: result.url,
      });
    }

    return null;
  }

  private async fetchLyricsOvhLyrics(
    candidate: LyricsCandidate,
    reachContext: UpstreamReachContext,
  ): Promise<CachedLyrics | null> {
    const providerEndpoints = await getProviderEndpoints();
    const encodedPath = `/${encodeURIComponent(
      candidate.artist,
    )}/${encodeURIComponent(candidate.title)}`;
    const urls = buildProviderUrlCandidates(
      providerEndpoints.providers.lyrics.lyricsOvhBase,
      [`/v1${encodedPath}`, encodedPath],
    );

    const result = await this.fetchFirstSuccessfulResponse(urls, reachContext);
    if (!result) {
      return null;
    }

    const json = (await result.response.json()) as { lyrics?: unknown };
    const lyrics = typeof json.lyrics === "string" ? json.lyrics.trim() : "";
    if (!lyrics) {
      return null;
    }

    return normalizeCacheEntry({
      lyrics,
      artistName: candidate.artist,
      trackName: candidate.title,
      trackId: "",
      searchEngine: "lyrics.ovh",
      isSynced: false,
      cachedAt: Date.now(),
      requestUrl: result.url,
    });
  }

  public async getLyrics(
    track: Track,
    options?: { force?: boolean },
  ): Promise<CachedLyrics | null> {
    await this.loadCache();

    const cacheKey = getTrackCacheKey(track);
    const cached = this.cache.get(cacheKey);
    if (cached && !options?.force && !this.isCacheExpired(cached.cachedAt)) {
      return normalizeCacheEntry(cached);
    }

    if (cached && this.isCacheExpired(cached.cachedAt)) {
      this.cache.delete(cacheKey);
      await this.saveCache();
    }

    const missedAt = this.missCache.get(cacheKey);
    if (
      !options?.force &&
      missedAt &&
      Date.now() - missedAt <= MISS_CACHE_EXPIRY_MS
    ) {
      console.log(
        "[Lyrics] Miss cache short-circuit for:",
        track.title || "(untitled)",
      );
      return null;
    }

    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    const request = (async () => {
      const reachContext: UpstreamReachContext = { reachedUpstream: false };
      try {
        const candidates = buildLyricsCandidates(track);
        if (!candidates.length) {
          // No usable artist/title pair — nothing to query upstream. Do NOT
          // poison the miss cache here: metadata can arrive late (track
          // object still hydrating), and a cached miss would suppress every
          // retry for 6h. Just report the miss for this call.
          console.log(
            "[Lyrics] No lookup candidates for:",
            track.title || "(untitled)",
          );
          return null;
        }

        const lrclibCandidates = selectLookupCandidates(
          candidates,
          MAX_LRCLIB_CANDIDATES,
        );
        for (const candidate of lrclibCandidates) {
          const payload = await this.fetchLrcLibLyrics(
            candidate,
            track.duration,
            reachContext,
          );
          if (!payload) {
            continue;
          }

          const resolvedPayload = normalizeCacheEntry({
            ...payload,
            trackId: track.id,
          });
          this.cache.set(cacheKey, resolvedPayload);
          this.missCache.delete(cacheKey);
          await this.saveCache();
          console.log(
            "[Lyrics] Found via lrclib:",
            payload.trackName || candidate.title,
          );
          return resolvedPayload;
        }

        const lyricsOvhCandidates = selectLookupCandidates(
          candidates,
          MAX_LYRICS_OVH_CANDIDATES,
        );
        for (const candidate of lyricsOvhCandidates) {
          const payload = await this.fetchLyricsOvhLyrics(
            candidate,
            reachContext,
          );
          if (!payload) {
            continue;
          }

          const resolvedPayload = normalizeCacheEntry({
            ...payload,
            trackId: track.id,
          });
          this.cache.set(cacheKey, resolvedPayload);
          this.missCache.delete(cacheKey);
          await this.saveCache();
          console.log(
            "[Lyrics] Found via lyrics.ovh:",
            payload.trackName || candidate.title,
          );
          return resolvedPayload;
        }

        if (reachContext.reachedUpstream) {
          // Upstreams answered and genuinely have nothing for this track —
          // safe to remember the miss for a while.
          this.missCache.set(cacheKey, Date.now());
          console.log("[Lyrics] No lyrics upstream for:", track.title || "(untitled)");
        } else {
          // Never got through to any upstream (offline / DNS / timeout).
          // Don't cache the miss — retry on the next lyrics open.
          console.log(
            "[Lyrics] Upstreams unreachable for:",
            track.title || "(untitled)",
          );
        }
        return null;
      } finally {
        this.pendingRequests.delete(cacheKey);
      }
    })();

    this.pendingRequests.set(cacheKey, request);
    return request;
  }

  public async clearCache(): Promise<void> {
    this.cache.clear();
    this.missCache.clear();
    this.pendingRequests.clear();
    await StorageService.removeItem(LYRICS_CACHE_KEY);
    console.log("[Lyrics] Cache cleared");
  }

  /**
   * Ranked lyrics lookup via LRCLIB /search (fuzzy, unlike /get which is an
   * exact triplet match). Used by the manual "Search lyrics" UI so a track
   * whose stored title/artist doesn't match exactly can still be found.
   * Never throws — returns [] on any failure.
   */
  public async searchLyrics(query: string, limit = 10): Promise<LyricsSearchResult[]> {
    const trimmed = (query || "").trim();
    if (!trimmed) {
      return [];
    }

    const providerEndpoints = await getProviderEndpoints();
    const urls = buildProviderUrlCandidates(
      providerEndpoints.providers.lyrics.lrclibBase,
      ["/search", "/api/search"],
      { q: trimmed },
    );

    const reachContext: UpstreamReachContext = { reachedUpstream: false };
    const result = await this.fetchFirstSuccessfulResponse(urls, reachContext);
    if (!result) {
      console.log("[Lyrics] Search found no upstream response for:", trimmed);
      return [];
    }

    try {
      const json = await result.response.json();
      const list = Array.isArray(json) ? json : [];
      return list
        .map((entry: any): LyricsSearchResult | null => {
          const trackName = typeof entry?.trackName === "string" ? entry.trackName : "";
          const artistName = typeof entry?.artistName === "string" ? entry.artistName : "";
          if (!trackName && !artistName) {
            return null;
          }
          const syncedLyrics =
            typeof entry?.syncedLyrics === "string" ? entry.syncedLyrics : "";
          const plainLyrics = typeof entry?.plainLyrics === "string" ? entry.plainLyrics : "";
          const lyrics = syncedLyrics || plainLyrics;
          if (!lyrics) {
            return null;
          }
          return {
            id: entry?.id,
            trackName,
            artistName,
            albumName: typeof entry?.albumName === "string" ? entry.albumName : undefined,
            duration:
              typeof entry?.duration === "number" && Number.isFinite(entry.duration)
                ? entry.duration
                : undefined,
            lyrics,
            isSynced: Boolean(syncedLyrics),
          };
        })
        .filter((entry: LyricsSearchResult | null): entry is LyricsSearchResult => Boolean(entry))
        .sort((a, b) => Number(b.isSynced) - Number(a.isSynced))
        .slice(0, limit);
    } catch (error) {
      console.log("[Lyrics] Search parse failed:", error);
      return [];
    }
  }

  /**
   * Apply a user-picked search result to a track: stores it in the normal
   * lyrics cache (so it survives track changes) and remembers the choice so
   * future automatic lookups for this track prefer it.
   */
  public async applyLyricsSearchResult(
    track: Track,
    result: LyricsSearchResult,
  ): Promise<CachedLyrics> {
    // Merge into the persisted cache first — saving on a fresh instance
    // without this would overwrite every previously cached lyric.
    await this.loadCache();
    const cacheKey = getTrackCacheKey(track);
    const payload = normalizeCacheEntry({
      lyrics: result.lyrics,
      isSynced: result.isSynced,
      trackId: track.id,
      trackName: result.trackName,
      artistName: result.artistName,
      searchEngine: "lrclib/search",
      cachedAt: Date.now(),
    });

    this.cache.set(cacheKey, payload);
    this.missCache.delete(cacheKey);
    await this.saveCache();
    console.log("[Lyrics] Applied manual match for:", track.title || "(untitled)");
    return payload;
  }

  public getCacheSize(): number {
    return this.cache.size;
  }
}

export const lyricsService = LyricsService.getInstance();
