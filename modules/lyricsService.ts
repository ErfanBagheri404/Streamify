import { StorageService } from "../utils/storage";
import { Track } from "../contexts/PlayerContext";

interface LyricsResponse {
  data:
    | {
        artistName: string;
        trackName: string;
        trackId: string;
        searchEngine: "Musixmatch" | "YouTube";
        artworkUrl: string;
        lyrics: string;
      }
    | {
        message: string;
        respone: string;
      };
  metadata: {
    apiVersion: string;
  };
}

interface MusixmatchMetadataTrack {
  trackId: string;
  trackName: string;
  artistName: string;
  albumCoverArt: string;
  platform: string;
}

interface MusixmatchMetadataResponse {
  data: MusixmatchMetadataTrack[];
  metadata: {
    apiVersion: string;
  };
}

export interface CachedLyrics {
  lyrics: string;
  artistName: string;
  trackName: string;
  trackId: string;
  searchEngine: string;
  artworkUrl: string;
  cachedAt: number;
}

const LYRICS_CACHE_KEY = "lyrics_cache";
const CACHE_EXPIRY_DAYS = 30;

export class LyricsService {
  private static instance: LyricsService;
  private cache: Map<string, CachedLyrics> = new Map();
  private isCacheLoaded = false;

  private constructor() {}

  public static getInstance(): LyricsService {
    if (!LyricsService.instance) {
      LyricsService.instance = new LyricsService();
    }
    return LyricsService.instance;
  }

  private async loadCache(): Promise<void> {
    if (this.isCacheLoaded) return;

    try {
      const cachedData = await StorageService.getItem(LYRICS_CACHE_KEY);
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        this.cache = new Map(parsedCache);
        console.log(`[Lyrics] Loaded ${this.cache.size} cached lyrics`);
      }
    } catch (error) {
      console.error("[Lyrics] Failed to load cache:", error);
    }
    this.isCacheLoaded = true;
  }

  private async saveCache(): Promise<void> {
    try {
      const cacheArray = Array.from(this.cache.entries());
      await StorageService.setItem(
        LYRICS_CACHE_KEY,
        JSON.stringify(cacheArray)
      );
      console.log(`[Lyrics] Saved ${this.cache.size} cached lyrics`);
    } catch (error) {
      console.error("[Lyrics] Failed to save cache:", error);
    }
  }

  private isCacheExpired(cachedAt: number): boolean {
    const expiryTime = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - cachedAt > expiryTime;
  }

  private getCacheKey(track: Track): string {
    return `${track.source}_${track.id}`;
  }

  private cleanTitle(title: string): string {
    if (!title) return "";

    let cleaned = title
      // 1. Extract song title from "Artist - Song" format
      .replace(/^[^-]+-\s*(.+)$/i, "$1")
      // 2. Anything in brackets / parentheses (except year)
      .replace(/\s*[\[\(\{][^\]\)\}]*[\]\)\}]\s*/gi, " ")
      // 3. “Official”, “Lyrics”, “Video”, “HD”, “4K”, “Remastered”, etc.
      .replace(
        /\b(official|lyrics?|video|audio|hd|4k|remaster|re-master|remix|cover|acoustic|live|clean|explicit|amv|pmv)\b/gi,
        " "
      )
      // 4. YouTube suffixes “- Topic”, “VEVO”, auto-generated
      .replace(/\s*-\s*topic\s*/gi, " ")
      .replace(/\s*vevo\s*/gi, " ")
      // 5. SoundCloud “⬆” / “↗” arrows, emoji, hashtags
      .replace(/[#⬆↗▶️🔔©®™\p{Emoji_Presentation}]/gu, " ")
      // 6. Multiple spaces → single
      .replace(/\s{2,}/g, " ")
      .trim();

    console.log(`[Lyrics] Cleaned title: "${title}" → "${cleaned}"`);
    return cleaned;
  }

  private extractArtistFromTitle(title: string): string {
    if (!title) return "";

    // Extract artist from "Artist - Song" format
    const match = title.match(/^([^-]+)-/i);
    if (match) {
      return match[1].trim();
    }

    return "";
  }

  private cleanArtist(artist: string): string {
    if (!artist) return "";

    return artist
      .replace(/\s*-\s*topic/gi, "") // “Travis Scott - Topic”
      .replace(/\s*vevo/gi, "") // “TravisScottVEVO”
      .replace(/[#⬆↗\p{Emoji_Presentation}]/gu, " ")
      .replace(/\s*\(feat\.?\s+[^)]+\)/gi, "") // (feat. Kylie Jenner)
      .replace(/\s*ft\.?\s+[^\s]+/gi, "") // ft. Kylie Jenner
      .replace(/\s+-.*$/i, "") // ← NEW: strip everything after “ -”
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  private buildLyricsOvhUrl(track: Track): string {
    const cleanTitle = this.cleanTitle(track.title);
    let cleanArtist = this.cleanArtist(track.artist || "");

    if (!cleanArtist && track.title.includes(" - ")) {
      cleanArtist = this.extractArtistFromTitle(track.title);
      console.log(
        `[Lyrics] Extracted artist from title for lyrics.ovh: "${cleanArtist}"`
      );
    }

    if (!cleanTitle || !cleanArtist) {
      throw new Error(
        "[Lyrics] Insufficient track information to fetch lyrics from lyrics.ovh (need both title and artist)"
      );
    }

    const encodedArtist = encodeURIComponent(cleanArtist);
    const encodedTitle = encodeURIComponent(cleanTitle);
    const url = `https://api.lyrics.ovh/v1/${encodedArtist}/${encodedTitle}`;

    console.log("[Lyrics] Built lyrics.ovh URL:", {
      url,
      originalTitle: track.title,
      originalArtist: track.artist,
      cleanTitle,
      cleanArtist,
    });

    return url;
  }

  private async fetchLyricsFromLyricsOvh(
    track: Track,
    cacheKey: string
  ): Promise<CachedLyrics | null> {
    try {
      const url = this.buildLyricsOvhUrl(track);
      console.log(`[Lyrics] Fetching lyrics from lyrics.ovh: ${url}`);

      const response = await fetch(url);

      if (!response.ok) {
        console.log(
          `[Lyrics] lyrics.ovh request failed: HTTP ${response.status}`
        );
        return null;
      }

      const data = await response.json();

      if (!data || typeof data.lyrics !== "string") {
        console.log(
          "[Lyrics] lyrics.ovh response does not contain valid lyrics"
        );
        return null;
      }

      const lyrics = String(data.lyrics).trim();

      if (!lyrics) {
        console.log("[Lyrics] lyrics.ovh returned empty lyrics");
        return null;
      }

      const cachedLyrics: CachedLyrics = {
        lyrics,
        artistName: track.artist || "",
        trackName: track.title,
        trackId: track.id,
        searchEngine: "lyrics.ovh",
        artworkUrl: track.thumbnail || "",
        cachedAt: Date.now(),
      };

      this.cache.set(cacheKey, cachedLyrics);
      await this.saveCache();

      console.log(
        `[Lyrics] Successfully fetched and cached lyrics from lyrics.ovh for ${track.title}`
      );

      return cachedLyrics;
    } catch (error) {
      console.log("[Lyrics] lyrics.ovh request error:", error);
      return null;
    }
  }

  private selectBestMetadataMatch(
    track: Track,
    candidates: MusixmatchMetadataTrack[]
  ): MusixmatchMetadataTrack | null {
    if (!candidates.length) {
      return null;
    }

    const trackArtist = (track.artist || "").toLowerCase().trim();
    const trackTitle = this.cleanTitle(track.title).toLowerCase();

    let best = candidates[0];
    let bestScore = -1;

    for (const candidate of candidates) {
      let score = 0;
      const candidateArtist = (candidate.artistName || "").toLowerCase().trim();
      const candidateTitle = (candidate.trackName || "").toLowerCase().trim();

      if (trackArtist && candidateArtist) {
        if (candidateArtist === trackArtist) {
          score += 5;
        } else if (
          candidateArtist.includes(trackArtist) ||
          trackArtist.includes(candidateArtist)
        ) {
          score += 3;
        }
      }

      if (trackTitle && candidateTitle) {
        if (candidateTitle === trackTitle) {
          score += 2;
        } else if (
          candidateTitle.includes(trackTitle) ||
          trackTitle.includes(candidateTitle)
        ) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    if (bestScore < 0) {
      return candidates[0];
    }

    return best;
  }

  private async fetchMusixmatchMetadata(
    track: Track
  ): Promise<MusixmatchMetadataTrack | null> {
    // OLD API - Commented out due to country restrictions
    // const baseUrl = "https://lyrics.lewdhutao.my.eu.org/v2";

    console.log(
      "[Lyrics] Musixmatch metadata fallback is disabled (old API commented out)"
    );
    return null;
  }

  /*
    const cleanTitle = this.cleanTitle(track.title);
    const cleanArtist = this.cleanArtist(track.artist);

    if (!cleanTitle) {
      console.log(
        `[Lyrics] Musixmatch metadata fallback skipped: empty title for ${track.title}`
      );
      return null;
    }

    let url = `${baseUrl}/musixmatch/metadata?title=${encodeURIComponent(
      cleanTitle
    )}`;
    if (cleanArtist) {
      url += `&artist=${encodeURIComponent(cleanArtist)}`;
    }

    console.log(`[Lyrics] Fetching Musixmatch metadata: ${url}`);

    try {
      const response = await this.fetchWithRetry(url, "musixmatch_metadata", 1);

      if (!response) {
        console.log(
          `[Lyrics] Musixmatch metadata request failed: no response for ${track.title}`
        );
        return null;
      }

      if (!response.ok) {
        console.log(
          `[Lyrics] Musixmatch metadata request failed: HTTP ${response.status}`
        );
        return null;
      }

      const data: MusixmatchMetadataResponse = await response.json();

      if (!data || !Array.isArray(data.data) || data.data.length === 0) {
        console.log(
          `[Lyrics] Musixmatch metadata returned no candidates for ${track.title}`
        );
        return null;
      }

      const bestMatch = this.selectBestMetadataMatch(track, data.data);

      if (!bestMatch) {
        console.log(
          `[Lyrics] Musixmatch metadata could not find a suitable match for ${track.title}`
        );
        return null;
      }

      console.log(
        `[Lyrics] Musixmatch metadata selected "${bestMatch.trackName}" by "${bestMatch.artistName}" (trackId=${bestMatch.trackId})`
      );

      return bestMatch;
    } catch (error) {
      console.log("[Lyrics] Musixmatch metadata error:", error);
      return null;
    }
  }
  */

  /*
  private determineLyricsProviders(track: Track): ("musixmatch" | "youtube")[] {
    // Always try both providers for all sources
    // This gives us the best chance of finding lyrics
    return ["musixmatch", "youtube"];
  }

  private buildLyricsUrl(
    provider: "musixmatch" | "youtube",
    track: Track,
    musixmatchTrackId?: string
  ): string[] {
    const baseUrl = "https://lyrics.lewdhutao.my.eu.org/v2";

    // Clean both title and artist using comprehensive cleaning logic
    const cleanTitle = this.cleanTitle(track.title);
    let cleanArtist = this.cleanArtist(track.artist);

    // If artist is empty or same as what's in title, extract from title
    if (!cleanArtist && track.title.includes(" - ")) {
      cleanArtist = this.extractArtistFromTitle(track.title);
      console.log(`[Lyrics] Extracted artist from title: "${cleanArtist}"`);
    }

    // Log track info for debugging
    console.log(`[Lyrics] Building URL for track:`, {
      id: track.id,
      originalTitle: track.title,
      originalArtist: track.artist,
      cleanTitle: cleanTitle,
      cleanArtist: cleanArtist,
      source: track.source,
      provider: provider,
    });

    const approaches = [];

    if (provider === "musixmatch" && musixmatchTrackId) {
      const trackId = encodeURIComponent(musixmatchTrackId);
      approaches.push(`${baseUrl}/musixmatch/lyrics?trackId=${trackId}`);
      console.log(
        `[Lyrics] Added Musixmatch trackId approach: "${musixmatchTrackId}"`
      );
    }

    if (provider === "youtube" && track.source === "youtube" && track.id) {
      approaches.push(`${baseUrl}/youtube/lyrics?videoId=${track.id}`);
      console.log(
        `[Lyrics] Added video ID approach for YouTube track: "${track.id}"`
      );
    }

    if (cleanTitle && cleanArtist) {
      const title = encodeURIComponent(cleanTitle);
      const artist = encodeURIComponent(cleanArtist);
      const url = `${baseUrl}/${provider}/lyrics?title=${title}&artist=${artist}`;
      approaches.push(url);
      console.log(`[Lyrics] Added full approach: ${url}`);
    }

    // THIRD PRIORITY: Fallback - if we have a title, try title-only approach
    if (cleanTitle) {
      const title = encodeURIComponent(cleanTitle);
      const url = `${baseUrl}/${provider}/lyrics?title=${title}`;
      approaches.push(url);
      console.log(`[Lyrics] Added title-only fallback: ${url}`);
    }

    if (approaches.length === 0) {
      throw new Error(
        "[Lyrics] Insufficient track information to fetch lyrics (need both title and artist)"
      );
    }

    return approaches;
  }

  private async fetchWithRetry(
    url: string,
    provider: string,
    attempt: number
  ): Promise<any | null> {
    const maxRetries = 1; // Reduced from 2 to 1 for faster fallback

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        console.log(
          `[Lyrics] Using PowerShell HTTP client for ${provider} attempt ${attempt}, retry ${retry + 1}`
        );

        const response = await platformHttpClient.get(url, {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        });

        console.log(`[Lyrics] PowerShell response status: ${response.status}`);

        // Enhanced error reporting based on HTTP status codes
        if (response.status === 404) {
          console.log(
            `[Lyrics] ${provider} API returned 404: Lyrics not found`
          );
          return {
            status: response.status,
            data: null,
            error: "Lyrics not found",
          };
        } else if (response.status === 500) {
          console.log(`[Lyrics] ${provider} API returned 500: Server error`);
          return { status: response.status, data: null, error: "Server error" };
        } else if (response.status === 429) {
          console.log(
            `[Lyrics] ${provider} API returned 429: Rate limit exceeded`
          );
          return {
            status: response.status,
            data: null,
            error: "Rate limit exceeded",
          };
        } else if (response.status >= 400 && response.status < 500) {
          console.log(
            `[Lyrics] ${provider} API returned ${response.status}: Client error`
          );
          return {
            status: response.status,
            data: null,
            error: `Client error ${response.status}`,
          };
        } else if (response.status >= 500) {
          console.log(
            `[Lyrics] ${provider} API returned ${response.status}: Server error`
          );
          return {
            status: response.status,
            data: null,
            error: `Server error ${response.status}`,
          };
        }

        return { status: response.status, data: response.data };
      } catch (error) {
        console.log(
          `[Lyrics] ${provider} attempt ${attempt}, retry ${retry + 1} failed:`,
          // @ts-ignore
          error.message || error
        );
        if (retry === maxRetries - 1) return null;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
      }
    }
    return null;
  }

  private async fetchFromProviders(
    track: Track,
    providers: ("musixmatch" | "youtube")[],
    cacheKey: string,
    musixmatchTrackId?: string
  ): Promise<CachedLyrics | null> {
    console.log(
      `[Lyrics] Attempting providers: ${providers.join(", ")} for ${
        track.title
      }`
    );

    for (const provider of providers) {
      const approaches = this.buildLyricsUrl(
        provider,
        track,
        musixmatchTrackId
      );
      console.log(
        `[Lyrics] Provider ${provider}: ${approaches.length} approaches`
      );

      for (let i = 0; i < approaches.length; i++) {
        const url = approaches[i];
        console.log(`[Lyrics] Trying ${provider} approach ${i + 1}: ${url}`);

        try {
          console.log(
            `[Lyrics] Starting fetch for ${provider} approach ${i + 1}`
          );
          const response = await this.fetchWithRetry(url, provider, i + 1);

          if (!response) {
            console.log(
              `[Lyrics] ${provider} approach ${i + 1} failed: No response after retries`
            );
            continue;
          }

          if (response.status !== 200) {
            console.log(
              `[Lyrics] ${provider} approach ${i + 1} failed: HTTP ${response.status}${response.error ? ` - ${response.error}` : ""}`
            );

            // Enhanced error reporting based on status codes
            if (response.status === 404) {
              console.log(
                `[Lyrics] ${provider} API indicates lyrics not found for this track`
              );
            } else if (response.status === 500) {
              console.log(
                `[Lyrics] ${provider} API server error - service may be temporarily unavailable`
              );
            } else if (response.status === 429) {
              console.log(
                `[Lyrics] ${provider} API rate limit exceeded - consider reducing request frequency`
              );
            } else if (response.status >= 400 && response.status < 500) {
              console.log(
                `[Lyrics] ${provider} API client error - request may be malformed`
              );
            } else if (response.status >= 500) {
              console.log(
                `[Lyrics] ${provider} API server error - service may be down`
              );
            }

            continue;
          }

          const raw = response.data;
          console.log(
            `[Lyrics] Received response for ${provider} approach ${i + 1}:`,
            JSON.stringify(raw).substring(0, 200)
          );
          console.log(`[Lyrics] Response data structure:`, {
            hasData: !!raw.data,
            hasLyrics: !!raw.lyrics,
            isArray: Array.isArray(raw),
            keys: Object.keys(raw),
            dataKeys: raw.data ? Object.keys(raw.data) : "no data",
          });
          const payload = this.extractLyricsPayload(raw, track);

          if (!payload) {
            console.log(
              `[Lyrics] ${provider} approach ${i + 1} failed: No valid lyrics payload`
            );
            continue;
          }

          const cachedLyrics: CachedLyrics = {
            lyrics: payload.lyrics,
            artistName: payload.artistName,
            trackName: payload.trackName,
            trackId: payload.trackId,
            searchEngine: payload.searchEngine,
            artworkUrl: payload.artworkUrl,
            cachedAt: Date.now(),
          };

          this.cache.set(cacheKey, cachedLyrics);
          await this.saveCache();

          console.log(
            `[Lyrics] Successfully cached lyrics for ${track.title} using ${provider} approach ${i + 1}`
          );
          return cachedLyrics;
        } catch (error) {
          console.log(`[Lyrics] ${provider} approach ${i + 1} error:`, error);
          continue;
        }
      }
    }

    return null;
  }
  */

  public async getLyrics(track: Track): Promise<CachedLyrics | null> {
    await this.loadCache();

    const cacheKey = this.getCacheKey(track);
    const cached = this.cache.get(cacheKey);

    if (cached && !this.isCacheExpired(cached.cachedAt)) {
      console.log(`[Lyrics] Cache hit for ${track.title} by ${track.artist}`);
      return cached;
    }

    if (cached) {
      console.log(`[Lyrics] Removing expired cache for ${track.title}`);
      this.cache.delete(cacheKey);
    }

    const result = await this.fetchLyricsFromLyricsOvh(track, cacheKey);

    if (result) {
      return result;
    }

    console.log(
      `[Lyrics] lyrics.ovh did not return lyrics for ${track.title} by ${track.artist}`
    );
    console.log(
      `[Lyrics] Final result: No lyrics found for ${track.title} by ${track.artist}`
    );
    return null;
  }

  public async clearCache(): Promise<void> {
    this.cache.clear();
    await StorageService.removeItem(LYRICS_CACHE_KEY);
    console.log("[Lyrics] Cache cleared");
  }

  public getCacheSize(): number {
    return this.cache.size;
  }
}

export const lyricsService = LyricsService.getInstance();
