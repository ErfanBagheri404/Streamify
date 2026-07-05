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

export type CachedLyrics = LyricsCacheEntry;

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
  maxCandidates: number
): LyricsCandidate[] {
  const selected = candidates.slice(0, maxCandidates);
  const finalFallback =
    candidates.length > 0 ? candidates[candidates.length - 1] : undefined;

  if (
    finalFallback &&
    !selected.some(
      (candidate) =>
        candidate.artist.toLowerCase() === finalFallback.artist.toLowerCase() &&
        candidate.title.toLowerCase() === finalFallback.title.toLowerCase()
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
        JSON.stringify(Array.from(this.cache.entries()))
      );
    } catch (error) {
      console.error("[Lyrics] Failed to save cache:", error);
    }
  }

  private isCacheExpired(cachedAt: number): boolean {
    return Date.now() - cachedAt > CACHE_EXPIRY_MS;
  }

  private async fetchWithTimeout(url: string): Promise<Response | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      LYRICS_UPSTREAM_TIMEOUT_MS
    );

    try {
      return await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchFirstSuccessfulResponse(
    urls: string[]
  ): Promise<{ response: Response; url: string } | null> {
    for (const url of urls) {
      const response = await this.fetchWithTimeout(url);
      if (response?.ok) {
        return { response, url };
      }
    }

    return null;
  }

  private async fetchLrcLibLyrics(
    candidate: LyricsCandidate,
    durationSeconds?: number
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
        }
      ),
      buildProviderUrlCandidates(
        providerEndpoints.providers.lyrics.lrclibBase,
        ["/get", "/api/get"],
        {
          artist_name: candidate.artist,
          track_name: candidate.title,
        }
      ),
    ];

    for (const urls of requestVariants) {
      const result = await this.fetchFirstSuccessfulResponse(urls);
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
    candidate: LyricsCandidate
  ): Promise<CachedLyrics | null> {
    const providerEndpoints = await getProviderEndpoints();
    const encodedPath = `/${encodeURIComponent(
      candidate.artist
    )}/${encodeURIComponent(candidate.title)}`;
    const urls = buildProviderUrlCandidates(
      providerEndpoints.providers.lyrics.lyricsOvhBase,
      [`/v1${encodedPath}`, encodedPath]
    );

    const result = await this.fetchFirstSuccessfulResponse(urls);
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
    options?: { force?: boolean }
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
      return null;
    }

    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

    const request = (async () => {
      try {
        const candidates = buildLyricsCandidates(track);
        if (!candidates.length) {
          this.missCache.set(cacheKey, Date.now());
          return null;
        }

        const lrclibCandidates = selectLookupCandidates(
          candidates,
          MAX_LRCLIB_CANDIDATES
        );
        for (const candidate of lrclibCandidates) {
          const payload = await this.fetchLrcLibLyrics(
            candidate,
            track.duration
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
          return resolvedPayload;
        }

        const lyricsOvhCandidates = selectLookupCandidates(
          candidates,
          MAX_LYRICS_OVH_CANDIDATES
        );
        for (const candidate of lyricsOvhCandidates) {
          const payload = await this.fetchLyricsOvhLyrics(candidate);
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
          return resolvedPayload;
        }

        this.missCache.set(cacheKey, Date.now());
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

  public getCacheSize(): number {
    return this.cache.size;
  }
}

export const lyricsService = LyricsService.getInstance();
