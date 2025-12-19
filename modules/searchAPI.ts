// lib/searchAPI.ts

export interface SearchResult {
  id: string;
  title: string;
  author?: string;
  duration: string;
  href?: string;
  uploaded?: string;
  channelUrl?: string;
  views?: string;
  img?: string;
  thumbnailUrl?: string;
  source?: "youtube" | "soundcloud";
}

// --- CONSTANTS ---
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const PIPED_INSTANCES = [

  "https://api.piped.private.coffee",
  
];

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net/api/v1",
  "https://vid.puffyan.us/api/v1",
  "https://yewtu.be/api/v1",
  "https://invidious.drgns.space/api/v1",
];

/* ---------- HELPER FUNCTIONS ---------- */
const units = [
  { l: "year", d: 31_536_000 },
  { l: "month", d: 2_592_000 },
  { l: "week", d: 604_800 },
  { l: "day", d: 86_400 },
  { l: "hour", d: 3_600 },
  { l: "minute", d: 60 },
];

function fmtTimeAgo(stamp: number | string | undefined): string {
  if (!stamp) {
    return "unknown date";
  }
  let n = Number(stamp);
  if (Number.isNaN(n)) {
    return "unknown date";
  }
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  const secDiff = (Date.now() - ms) / 1000;
  if (secDiff < 0) {
    return "just now";
  }
  if (secDiff > 1_600_000_000) {
    return "long ago";
  }
  for (const u of units) {
    const val = Math.floor(secDiff / u.d);
    if (val >= 1) {
      return `${val} ${u.l}${val > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}

// Robust fetcher for Piped/Invidious
const fetchWithFallbacks = async (
  instances: string[],
  endpoint: string
): Promise<any> => {
  for (const baseUrl of instances) {
    const startTime = Date.now();
    try {
      console.log(`[API] 🟡 Attempting: ${baseUrl} ...`);
      const url = `${baseUrl}${endpoint}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const text = await response.text();
        try {
          if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
            return JSON.parse(text);
          }
        } catch (e) {
          /* ignore parse error */
        }
      }
    } catch (error) {
      /* ignore network error */
    }
  }
  return null;
};

/* ---------- MAIN API ---------- */
export const searchAPI = {
  getSuggestions: async (
    query: string,
    source: "youtube" | "soundcloud" | "spotify" = "youtube"
  ): Promise<string[]> => {
    if (!query.trim()) {
      return [];
    }
    if (source === "soundcloud") {
      return await searchAPI.getSoundCloudSuggestions(query);
    }
    if (source === "spotify") {
      return await searchAPI.getSpotifySuggestions(query);
    }
    const endpoint = `/suggestions?query=${encodeURIComponent(query)}`;
    const data = await fetchWithFallbacks(PIPED_INSTANCES, endpoint);
    let suggestions: string[] = [];

    if (Array.isArray(data)) {
      if (data.length > 1 && Array.isArray(data[1])) {
        suggestions = (data[1] as any[]).filter(
          (v): v is string => typeof v === "string"
        );
      } else {
        suggestions = (data as any[]).filter(
          (v): v is string => typeof v === "string"
        );
      }
    } else if (data && Array.isArray((data as any).suggestions)) {
      suggestions = (data as any).suggestions.filter(
        (v: any) => typeof v === "string"
      );
    }

    if (!suggestions.length) {
      const ytTerms = ["official video", "lyrics", "live", "remix", "extended"];
      suggestions = [query, ...ytTerms.map((t) => `${query} ${t}`)];
    }

    return suggestions.slice(0, 5);
  },

  getSoundCloudSuggestions: async (query: string): Promise<string[]> => {
    if (!query.trim()) {
      return [];
    }
    try {
      console.log(
        `[API] Fetching SoundCloud suggestions via proxy for: "${query}"`
      );
      const tracks = await searchAPI.scrapeSoundCloudSearch(query);
      if (!Array.isArray(tracks) || tracks.length === 0) {
        console.log("[API] No SoundCloud tracks returned for suggestions");
        const fallbackTerms = [
          "mix",
          "remix",
          "live",
          "instrumental",
          "extended",
        ];
        return fallbackTerms.map((term) => `${query} ${term}`).slice(0, 5);
      }
      const titles = tracks
        .map((t: any) => t && t.title)
        .filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0
        );
      const uniqueTitles: string[] = [];
      for (const title of titles) {
        if (!uniqueTitles.includes(title)) {
          uniqueTitles.push(title);
        }
        if (uniqueTitles.length >= 5) {
          break;
        }
      }
      if (uniqueTitles.length === 0) {
        const fallbackTerms = [
          "mix",
          "remix",
          "live",
          "instrumental",
          "extended",
        ];
        return fallbackTerms.map((term) => `${query} ${term}`).slice(0, 5);
      }
      console.log(
        `[API] SoundCloud suggestion titles: ${uniqueTitles.length}`,
        uniqueTitles
      );
      return uniqueTitles.slice(0, 5);
    } catch (e) {
      console.warn("[API] SoundCloud suggestions error:", e);
      const fallbackTerms = [
        "mix",
        "remix",
        "live",
        "instrumental",
        "extended",
      ];
      return fallbackTerms.map((term) => `${query} ${term}`).slice(0, 5);
    }
  },

  getSpotifySuggestions: async (query: string): Promise<string[]> => {
    try {
      const spotifyTerms = [
        "official",
        "explicit",
        "clean",
        "radio edit",
        "remix",
        "acoustic version",
      ];
      const suggestions = spotifyTerms.map((term) => `${query} ${term}`);
      suggestions.unshift(query);
      return suggestions.slice(0, 5);
    } catch (e) {
      console.warn("[API] Spotify suggestions error:", e);
      return [query];
    }
  },

  searchWithPiped: async (query: string, filter: string) => {
    console.log(`[API] Searching Piped: "${query}"`);
    const filterParam = filter === "" ? "all" : filter;
    const endpoint = `/search?q=${encodeURIComponent(
      query
    )}&filter=${filterParam}`;
    const data = await fetchWithFallbacks(PIPED_INSTANCES, endpoint);
    return data && Array.isArray(data.items) ? data.items : [];
  },

  searchWithInvidious: async (query: string, sortType: string) => {
    console.log(`[API] Searching Invidious: "${query}"`);
    const sortParam = sortType === "date" ? "upload_date" : "view_count";
    const endpoint = `/search?q=${encodeURIComponent(
      query
    )}&sort_by=${sortParam}`;
    const data = await fetchWithFallbacks(INVIDIOUS_INSTANCES, endpoint);
    return Array.isArray(data) ? data : [];
  },

  // --- SOUNDCLOUD SEARCH WITH PROXY API ---
  searchWithSoundCloud: async (query: string) => {
    console.log(`[API] Starting SoundCloud search for: "${query}"`);

    // Use SoundCloud proxy API
    try {
      const tracks = await searchAPI.scrapeSoundCloudSearch(query);

      // Format the results manually instead of calling formatSearchResults
      if (!Array.isArray(tracks)) {
        return [];
      }

      // Deduplicate tracks by ID to prevent duplicate keys
      const seenIds = new Set<string>();
      return (
        tracks
          .filter((track) => track && track._isSoundCloud)
          .filter((track) => {
            const trackId = String(track.id);
            if (seenIds.has(trackId)) {
              console.log(
                `[API] Skipping duplicate SoundCloud track: ${trackId}`
              );
              return false;
            }
            seenIds.add(trackId);
            return true;
          })
          // Filter out tracks that are likely to be unavailable
          .filter((track) => {
            // Skip tracks with very short duration (likely incomplete)
            if (track.duration && track.duration < 10000) {
              console.log(`[API] Skipping short track: ${track.id}`);
              return false;
            }
            // Skip tracks with no duration info
            if (!track.duration) {
              console.log(`[API] Skipping track with no duration: ${track.id}`);
              return false;
            }
            return true;
          })
          .map((track) => {
            const artwork = track.artwork_url
              ? track.artwork_url.replace("large.jpg", "t500x500.jpg")
              : track.user?.avatar_url;
            return {
              id: String(track.id),
              title: track.title || "Unknown Title",
              author: track.user?.username || "Unknown Artist",
              duration: track.duration
                ? String(Math.floor(track.duration / 1000))
                : "0",
              views: String(track.playback_count || 0),
              uploaded: fmtTimeAgo(new Date(track.created_at).getTime()),
              thumbnailUrl: artwork,
              img: artwork,
              href: track.permalink_url,
              source: "soundcloud",
            };
          })
      );
    } catch (error) {
      console.warn("[API] 🔴 SoundCloud proxy failed:", error);
      return [];
    }
  },

  formatSearchResults: (results: any[]): SearchResult[] => {
    if (!Array.isArray(results)) {
      return [];
    }
    return results
      .map((item) => {
        if (!item) {
          return null;
        }
        // --- SOUNDCLOUD ---
        if (item._isSoundCloud || item.kind === "track") {
          const artwork = item.artwork_url
            ? item.artwork_url.replace("large.jpg", "t500x500.jpg")
            : item.user?.avatar_url;
          return {
            id: String(item.id),
            title: item.title || "Unknown Title",
            author: item.user?.username || "Unknown Artist",
            duration: item.duration
              ? String(Math.floor(item.duration / 1000))
              : "0",
            views: String(item.playback_count || 0),
            uploaded: fmtTimeAgo(new Date(item.created_at).getTime()),
            thumbnailUrl: artwork,
            img: artwork,
            href: item.permalink_url,
            source: "soundcloud",
          } as SearchResult;
        }
        // --- PIPED / INVIDIOUS ---
        const isPiped =
          item.url &&
          typeof item.url === "string" &&
          item.url.startsWith("/watch");
        let id = isPiped ? item.url.split("v=")[1] : item.videoId || "";
        let thumbnailUrl = item.thumbnail || "";
        if (
          !thumbnailUrl &&
          Array.isArray(item.videoThumbnails) &&
          item.videoThumbnails.length > 0
        ) {
          thumbnailUrl = item.videoThumbnails[0].url;
        }
        const result: SearchResult = {
          id,
          title: item.title || "Unknown Title",
          author: item.uploaderName || item.author || "Unknown Artist",
          duration: String(item.duration || item.lengthSeconds || "0"),
          views: String(item.views || item.viewCount || "0"),
          uploaded: fmtTimeAgo(Number(item.published || item.uploaded)),
          thumbnailUrl,
          img: thumbnailUrl,
          href: isPiped ? item.url : `/watch?v=${id}`,
          source: "youtube",
        };
        return result;
      })
      .filter((item): item is SearchResult => item !== null && item.id !== "");
  },

  // --- SOUNDCLOUD PROXY API ---
  scrapeSoundCloudSearch: async (query: string) => {
    console.log(`[API] Using SoundCloud proxy for: "${query}"`);

    try {
      // Use the SoundCloud proxy API
      const searchUrl = `https://proxy.searchsoundcloud.com/tracks?q=${encodeURIComponent(
        query
      )}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || !data.collection || !Array.isArray(data.collection)) {
        throw new Error("Invalid response format");
      }

      // Convert proxy API response to SoundCloud format
      const tracks = data.collection.map((track: any) => ({
        id: String(track.id),
        title: track.title,
        user: { username: track.user?.username || "Unknown Artist" },
        duration: track.duration || 0,
        playback_count: track.playback_count || 0,
        created_at: track.created_at || new Date().toISOString(),
        permalink_url:
          track.permalink_url || `https://soundcloud.com/tracks/${track.id}`,
        artwork_url: track.artwork_url || null,
        _isSoundCloud: true,
      }));

      console.log(
        `[API] 🟢 SoundCloud Proxy Success: Found ${tracks.length} tracks`
      );
      return tracks;
    } catch (e: any) {
      console.warn(`[API] 🔴 SoundCloud Proxy Error: ${e.message}`);
      return [];
    }
  },
};
