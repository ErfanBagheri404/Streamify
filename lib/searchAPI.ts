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
}

// Updated list from TeamPiped documentation
const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks", // Official
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi-libre.kavin.rocks", // Official Libre
  "https://piped-api.privacy.com.de",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
  "https://pipedapi.drgns.space",
  "https://pipedapi.owo.si",
  "https://pipedapi.ducks.party",
  "https://piped-api.codespace.cz",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.darkness.services",
  "https://pipedapi.orangenet.cc",
];

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net/api/v1",
  "https://vid.puffyan.us/api/v1",
  "https://yewtu.be/api/v1",
];

/* ---------- helper ---------- */
const units = [
  { l: "year", d: 31_536_000 },
  { l: "month", d: 2_592_000 },
  { l: "week", d: 604_800 },
  { l: "day", d: 86_400 },
  { l: "hour", d: 3_600 },
  { l: "minute", d: 60 },
];

function fmtTimeAgo(stamp: number | string | undefined): string {
  if (!stamp) return "unknown date";

  let n = Number(stamp);
  if (Number.isNaN(n)) return "unknown date";

  // >= 1e12 → milliseconds (2001-09-09 03:46:40 UTC)
  // 1e9–1e12 → seconds (2001-09-09 – 33658-09-27)
  const ms = n > 1_000_000_000_000 ? n : n * 1000;

  const secDiff = (Date.now() - ms) / 1000;

  // guard against future or very old stamps
  if (secDiff < 0) return "just now";
  if (secDiff > 1_600_000_000) return "long ago"; // ~50 y

  const units = [
    { l: "year", d: 31_536_000 },
    { l: "month", d: 2_592_000 },
    { l: "week", d: 604_800 },
    { l: "day", d: 86_400 },
    { l: "hour", d: 3_600 },
    { l: "minute", d: 60 },
  ];
  for (const u of units) {
    const val = Math.floor(secDiff / u.d);
    if (val >= 1) return `${val} ${u.l}${val > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

// Helper function to handle failover logic with Logging
const fetchWithFallbacks = async (
  instances: string[],
  endpoint: string
): Promise<any> => {
  for (const baseUrl of instances) {
    const startTime = Date.now();
    try {
      console.log(`[API] 🟡 Attempting: ${baseUrl} ...`);

      const url = `${baseUrl}${endpoint}`;

      // Add a timeout to skip slow servers quickly (e.g., 3 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        // Read text first to prevent JSON parse crashes
        const text = await response.text();

        try {
          const trimmed = text.trim();
          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            const json = JSON.parse(text);
            const duration = Date.now() - startTime;
            console.log(
              `[API] 🟢 Success: ${baseUrl} answered in ${duration}ms`
            );
            return json;
          } else {
            console.warn(
              `[API] 🔴 Failed: ${baseUrl} returned invalid format (HTML?).`
            );
          }
        } catch (e) {
          console.warn(`[API] 🔴 Failed: ${baseUrl} JSON Parse Error.`);
        }
      } else {
        console.warn(
          `[API] 🔴 Failed: ${baseUrl} returned status ${response.status}`
        );
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      if (error.name === "AbortError") {
        console.warn(`[API] 🔴 Timeout: ${baseUrl} took too long (>3000ms).`);
      } else {
        console.warn(`[API] 🔴 Network Error: ${baseUrl} (${duration}ms)`);
      }
    }
  }
  console.error("[API] ❌ All instances failed.");
  return null;
};

export const searchAPI = {
  getSuggestions: async (query: string): Promise<string[]> => {
    if (!query.trim()) return [];
    // Suggestions are usually fast, let's just log the attempt
    console.log(`[API] Fetching suggestions for: "${query}"`);
    const endpoint = `/suggestions?query=${encodeURIComponent(query)}`;
    const data = await fetchWithFallbacks(PIPED_INSTANCES, endpoint);
    if (Array.isArray(data)) return data;
    return [];
  },

  searchWithPiped: async (query: string, filter: string) => {
    console.log(`[API] Starting Search (Piped) for: "${query}"`);
    const filterParam = filter === "" ? "all" : filter;
    const endpoint = `/search?q=${encodeURIComponent(
      query
    )}&filter=${filterParam}`;

    const data = await fetchWithFallbacks(PIPED_INSTANCES, endpoint);

    if (data && Array.isArray(data.items)) {
      return data.items;
    }
    return [];
  },

  searchWithInvidious: async (query: string, sortType: string) => {
    console.log(`[API] Starting Search (Invidious) for: "${query}"`);
    const sortParam = sortType === "date" ? "upload_date" : "view_count";
    const endpoint = `/search?q=${encodeURIComponent(
      query
    )}&sort_by=${sortParam}`;

    const data = await fetchWithFallbacks(INVIDIOUS_INSTANCES, endpoint);

    if (Array.isArray(data)) {
      return data;
    }
    return [];
  },

  formatSearchResults: (results: any[]): SearchResult[] => {
    if (!Array.isArray(results)) return [];

    return results
      .map((item) => {
        if (!item) return null;

        const isPiped =
          item.url &&
          typeof item.url === "string" &&
          item.url.startsWith("/watch");

        let id = "";
        if (isPiped) {
          const parts = item.url.split("v=");
          id = parts.length > 1 ? parts[1] : "";
        } else {
          id = item.videoId || "";
        }

        let duration = "0";
        if (item.duration !== undefined) {
          duration = String(item.duration);
        } else if (item.lengthSeconds !== undefined) {
          duration = String(item.lengthSeconds);
        }

        let thumbnailUrl = "";
        if (item.thumbnail) {
          thumbnailUrl = item.thumbnail;
        } else if (
          Array.isArray(item.videoThumbnails) &&
          item.videoThumbnails.length > 0
        ) {
          thumbnailUrl = item.videoThumbnails[0].url;
        }

        let views = "0";
        if (item.views !== undefined) {
          views = String(item.views);
        } else if (item.viewCount !== undefined) {
          views = String(item.viewCount);
        }

        let uploadedText: string | undefined;
        if (item.published !== undefined) {
          uploadedText = fmtTimeAgo(Number(item.published));
        } else if (item.uploaded !== undefined) {
          uploadedText = fmtTimeAgo(Number(item.uploaded));
        }

        const result: SearchResult = {
          id: id,
          title: item.title || "Unknown Title",
          author: item.uploaderName || item.author || "Unknown Artist",
          duration: duration,
          views: views,
          uploaded: uploadedText,
          thumbnailUrl: thumbnailUrl,
          img: thumbnailUrl,
          href: isPiped ? item.url : `/watch?v=${id}`,
        };

        return result;
      })
      .filter((item): item is SearchResult => item !== null && item.id !== "");
  },
};
