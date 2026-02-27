import { Track } from "../../contexts/PlayerContext";

// Centralized API Configuration
export const API = {
  // Piped instances for YouTube content
  piped: ["https://api.piped.private.coffee"],

  // Invidious instances for YouTube content (will be updated dynamically)
  invidious: [
    "https://yt.omada.cafe",
    "https://ytify.pp.ua",
    "https://invidious.f5.si",
    "https://inv-veltrix.zeabur.app",
    "https://inv-veltrix-2.zeabur.app",
    "https://inv-veltrix-3.zeabur.app",
  ],

  // JioSaavn API endpoints
  jiosaavn: {
    base: "https://streamifyjiosaavn.vercel.app/api",
    search: "/search",
    songs: "/songs",
    albums: "/albums",
    artists: "/artists",
    playlists: "/search/playlists",
  },
} as const;

// Type definitions for better compatibility
export type APIConfig = typeof API;
export type InvidiousInstance = (typeof API.invidious)[number];
export type PipedInstance = (typeof API.piped)[number];

// Dynamic Invidious instances array (mutable)
export let DYNAMIC_INVIDIOUS_INSTANCES: string[] = [...API.invidious];

// Update function for dynamic Invidious instances
export function updateInvidiousInstances(newInstances: readonly string[]) {
  const normalizedExisting = DYNAMIC_INVIDIOUS_INSTANCES.map((instance) =>
    normalizeInvidiousInstance(instance)
  );
  const normalizedNew = newInstances.map((instance) =>
    normalizeInvidiousInstance(instance)
  );
  const uniqueInstances = [
    ...new Set([...normalizedExisting, ...normalizedNew]),
  ];
  DYNAMIC_INVIDIOUS_INSTANCES = uniqueInstances;
  return uniqueInstances;
}
export function setInvidiousInstances(instances: readonly string[]) {
  DYNAMIC_INVIDIOUS_INSTANCES = [
    ...new Set(
      instances.map((instance) => normalizeInvidiousInstance(instance))
    ),
  ];
  return DYNAMIC_INVIDIOUS_INSTANCES;
}
export function normalizeInvidiousInstance(instance: string): string {
  const trimmed = instance.trim();
  const withoutApi = trimmed.replace(/\/api\/v1\/?$/i, "");
  return withoutApi.replace(/\/+$/g, "");
}

// Helper functions for instance management
export const idFromURL = (link: string | null) =>
  link?.match(
    /(https?:\/\/)?((www\.)?(youtube(-nocookie)?|youtube.googleapis)\.com.*(v\/|v=|vi=|vi\/|e\/|embed\/|user\/.*\/u\/\d+\/)|youtu\.be\/)([_0-9a-z-]+)/i
  )?.[7];

export const fetchJson = async <T>(
  url: string,
  signal?: AbortSignal
): Promise<T> =>
  fetch(url, { signal }).then((res) => {
    if (!res.ok) {
      throw new Error(`Network response was not ok: ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  });

/**
 * Fetches and decodes Invidious instances from Uma repository
 */
export async function fetchUma(): Promise<string[]> {
  try {
    console.log("[API] Fetching Invidious instances from Uma repository...");
    const response = await fetch(
      "https://raw.githubusercontent.com/n-ce/Uma/main/iv.txt"
    );
    const text = await response.text();

    let decompressedString = text;
    const decodePairs: Record<string, string> = {
      $: "invidious",
      "&": "inv",
      "#": "iv",
      "~": "com",
    };

    for (const code in decodePairs) {
      const safeCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safeCode, "g");
      decompressedString = decompressedString.replace(regex, decodePairs[code]);
    }

    const instances = decompressedString.split(",").map((i) => `https://${i}`);
    console.log(
      `[API] Successfully fetched ${instances.length} instances from Uma`
    );
    return instances;
  } catch (error) {
    console.error("[API] Failed to fetch instances from Uma:", error);
    return [];
  }
}

/**
 * Updates Invidious instances from Uma repository (for app startup)
 */
export async function updateInvidiousInstancesFromUma(): Promise<void> {
  try {
    const umaInstances = await fetchUma();
    if (umaInstances.length > 0) {
      updateInvidiousInstances(
        umaInstances.map((instance) =>
          normalizeInvidiousInstance(instance)
        ) as string[]
      );
      console.log(
        `[API] Updated Invidious instances from Uma. Total: ${DYNAMIC_INVIDIOUS_INSTANCES.length}`
      );
    }
  } catch (error) {
    console.error("[API] Error updating instances from Uma:", error);
  }
}

// Utility functions
export const convertSStoHHMMSS = (seconds: number): string => {
  if (seconds < 0) {
    return "";
  }
  if (seconds === Infinity) {
    return "Emergency Mode";
  }
  const hh = Math.floor(seconds / 3600);
  seconds %= 3600;
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  let mmStr = String(mm);
  let ssStr = String(ss);
  if (mm < 10) {
    mmStr = "0" + mmStr;
  }
  if (ss < 10) {
    ssStr = "0" + ssStr;
  }
  return (hh > 0 ? hh + ":" : "") + `${mmStr}:${ssStr}`;
};

export const numFormatter = (num: number): string =>
  Intl.NumberFormat("en", { notation: "compact" }).format(num);

// JioSaavn API helper functions
export const getJioSaavnEndpoint = (endpoint: string, ...params: string[]) => {
  return `${API.jiosaavn.base}${endpoint}${params.join("/")}`;
};

export const getJioSaavnSearchEndpoint = (query: string) =>
  `${API.jiosaavn.base}${API.jiosaavn.search}?query=${encodeURIComponent(query)}`;

export const getJioSaavnSongEndpoint = (songId: string) =>
  `${API.jiosaavn.base}${API.jiosaavn.songs}/${songId}`;

export const getJioSaavnAlbumEndpoint = (albumId: string) =>
  `${API.jiosaavn.base}${API.jiosaavn.albums}?id=${albumId}`;

export const getJioSaavnArtistEndpoint = (
  artistId: string,
  type: "songs" | "albums" = "songs",
  page: number = 0
) =>
  `${API.jiosaavn.base}${API.jiosaavn.artists}/${artistId}/${type}?page=${page}`;

export const getJioSaavnPlaylistEndpoint = (query: string) =>
  `${API.jiosaavn.base}${API.jiosaavn.playlists}?query=${encodeURIComponent(query)}`;

export const getJioSaavnPlaylistByIdEndpoint = (playlistId: string) =>
  `${API.jiosaavn.base}/playlists?id=${encodeURIComponent(playlistId)}`;

export const getJioSaavnArtistSongsEndpoint = (
  artistId: string,
  page: number = 0
) => getJioSaavnArtistEndpoint(artistId, "songs", page);

export const getJioSaavnArtistAlbumsEndpoint = (
  artistId: string,
  page: number = 0
) => getJioSaavnArtistEndpoint(artistId, "albums", page);

// Generic fetch with retry logic
export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  maxRetries: number = 1,
  delay: number = 200
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error as Error;
      console.log(`[API] Attempt ${attempt + 1} failed: ${lastError.message}`);

      if (attempt < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delay * (attempt + 1))
        );
      }
    }
  }

  throw lastError!;
}

// Instance health check
export async function checkInstanceHealth(
  url: string,
  timeout: number = 5000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      method: "HEAD",
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Get healthy instances from a list
export async function getHealthyInstances(
  instances: string[]
): Promise<string[]> {
  const healthChecks = instances.map(async (instance) => {
    const isHealthy = await checkInstanceHealth(instance);
    return { instance, isHealthy };
  });

  const results = await Promise.all(healthChecks);
  return results
    .filter((result) => result.isHealthy)
    .map((result) => result.instance);
}

async function fastCheckInvidiousInstance(
  baseUrl: string,
  timeoutMs: number = 3000
): Promise<{ instance: string; ok: boolean; latency: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const normalizedBaseUrl = normalizeInvidiousInstance(baseUrl);
    const url = `${normalizedBaseUrl}/api/v1/videos/dQw4w9WgXcQ?local=true`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      return {
        instance: normalizedBaseUrl,
        ok: false,
        latency: Date.now() - start,
      };
    }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      return { instance: baseUrl, ok: false, latency: Date.now() - start };
    }
    const text = await res.text();
    const ok =
      text.includes("adaptiveFormats") ||
      text.includes("formatStreams") ||
      text.includes("lengthSeconds");
    return { instance: normalizedBaseUrl, ok, latency: Date.now() - start };
  } catch {
    return {
      instance: normalizeInvidiousInstance(baseUrl),
      ok: false,
      latency: Date.now() - start,
    };
  }
}

export async function getHealthyInvidiousInstancesSorted(
  instances: string[],
  timeoutMs: number = 3000
): Promise<string[]> {
  const checks = await Promise.all(
    instances.map((i) => fastCheckInvidiousInstance(i, timeoutMs))
  );
  const healthy = checks.filter((c) => c.ok);
  healthy.sort((a, b) => a.latency - b.latency);
  return healthy.map((c) => c.instance);
}

// Original streaming functions
export async function fetchStreamFromPiped(id: string, api: string) {
  const res = await fetch(`${api}/streams/${id}`);
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data as Piped;
}

/**
 * Enhanced fetchStreamFromPiped with fallback support using all Piped instances
 */
export async function fetchStreamFromPipedWithFallback(id: string) {
  const errors: string[] = [];

  for (const baseUrl of API.piped) {
    try {
      return await fetchStreamFromPiped(id, baseUrl);
    } catch (error) {
      errors.push(`${baseUrl}: ${(error as Error).message}`);
      continue;
    }
  }

  throw new Error(`All Piped instances failed: ${errors.join(", ")}`);
}

export async function fetchStreamFromInvidious(id: string, api: string) {
  const res = await fetch(`${api}/api/v1/videos/${id}`);
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data as unknown as Piped;
}

/**
 * Enhanced fetchStreamFromInvidious with fallback support using all Invidious instances
 */
export async function fetchStreamFromInvidiousWithFallback(id: string) {
  const errors: string[] = [];
  const instances =
    DYNAMIC_INVIDIOUS_INSTANCES.length > 0
      ? DYNAMIC_INVIDIOUS_INSTANCES
      : API.invidious;

  for (const baseUrl of instances) {
    try {
      return await fetchStreamFromInvidious(id, baseUrl);
    } catch (error) {
      errors.push(`${baseUrl}: ${(error as Error).message}`);
      continue;
    }
  }

  throw new Error(`All Invidious instances failed: ${errors.join(", ")}`);
}

/**
 * Fetches Invidious instances from Stremion API
 */
export async function fetchStremionInstances(): Promise<string[]> {
  try {
    console.log("[API] Fetching Invidious instances from Stremion...");
    const response = await fetch("https://stremion.zeabur.app/api/instances");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    let instances: string[] = [];

    // Handle different response formats
    if (Array.isArray(data)) {
      instances = data
        .map((instance: any) =>
          typeof instance === "string"
            ? instance
            : instance.url || instance.instance
        )
        .filter(Boolean);
    } else if (data.instances && Array.isArray(data.instances)) {
      instances = data.instances
        .map((instance: any) =>
          typeof instance === "string"
            ? instance
            : instance.url || instance.instance
        )
        .filter(Boolean);
    } else if (data.urls && Array.isArray(data.urls)) {
      instances = data.urls.filter(Boolean);
    }

    // Normalize instances
    instances = instances.map((instance: string) => {
      if (!instance.startsWith("http")) {
        instance = `https://${instance}`;
      }
      return normalizeInvidiousInstance(instance);
    });

    console.log(
      `[API] Successfully fetched ${instances.length} instances from Stremion`
    );
    return instances;
  } catch (error) {
    console.error("[API] Failed to fetch instances from Stremion:", error);
    return [];
  }
}

// Initialize dynamic instances on app startup
export async function initializeDynamicInstances(): Promise<void> {
  try {
    console.log(
      "[API] Fetching dynamic Invidious instances from multiple sources..."
    );

    // Fetch from all sources in parallel
    const [umaInstances, stremionInstances] = await Promise.all([
      fetchUma(),
      fetchStremionInstances(),
    ]);

    // Combine all instances
    const allInstances = [...umaInstances, ...stremionInstances];

    console.log(`[API] Total instances fetched: ${allInstances.length}`);
    console.log(`[API] - Uma: ${umaInstances.length}`);
    console.log(`[API] - Stremion: ${stremionInstances.length}`);

    if (allInstances.length > 0) {
      const formattedInstances = allInstances.map((instance) =>
        normalizeInvidiousInstance(instance)
      ) as string[];

      updateInvidiousInstances(formattedInstances);
      const healthy = await getHealthyInvidiousInstancesSorted(
        DYNAMIC_INVIDIOUS_INSTANCES
      );
      if (healthy.length > 0) {
        setInvidiousInstances(healthy as string[]);
        console.log(
          `[API] Healthy Invidious instances ready: ${healthy.length}`
        );
      } else {
        console.log("[API] No healthy instances detected, keeping defaults");
      }
    } else {
      console.log("[API] No dynamic instances fetched, using defaults");
    }
  } catch (error) {
    console.error("[API] Error initializing dynamic instances:", error);
  }
}

export async function getStreamData(
  id: string,
  prefer: "piped" | "invidious" = "piped"
) {
  try {
    // Try preferred source with enhanced fallback
    if (prefer === "piped") {
      return await fetchStreamFromPipedWithFallback(id);
    } else {
      return await fetchStreamFromInvidiousWithFallback(id);
    }
  } catch (error) {
    console.log(
      `[API] Preferred source (${prefer}) failed, trying fallback...`
    );

    // Fallback to other source
    try {
      const alt = prefer === "piped" ? "invidious" : "piped";
      if (alt === "piped") {
        return await fetchStreamFromPipedWithFallback(id);
      } else {
        return await fetchStreamFromInvidiousWithFallback(id);
      }
    } catch (altError) {
      throw new Error(
        `Both Piped and Invidious sources failed. Original: ${(error as Error).message}, Fallback: ${(altError as Error).message}`
      );
    }
  }
}

export function getBestAudioUrl(piped: Piped) {
  const list = (piped?.audioStreams || []).filter((s: any) => !!s?.url);
  if (!list.length) {
    return undefined;
  }
  const sorted = list.sort(
    (a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)
  );
  const best = sorted[0];
  return {
    url: best.url as string,
    mimeType: best?.mimeType,
    bitrate: best?.bitrate,
  };
}

// Piped API functions for YouTube/YT Music mix functionality
export async function fetchPipedMix(videoId: string) {
  const errors: string[] = [];

  for (const baseUrl of API.piped) {
    try {
      const response = await fetch(`${baseUrl}/playlists/${videoId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      errors.push(`${baseUrl}: ${(error as Error).message}`);
      continue;
    }
  }

  throw new Error(`All Piped instances failed: ${errors.join(", ")}`);
}

export async function fetchYouTubeMix(mixId: string, continuation?: string) {
  const normalizedId = mixId.startsWith("RD") ? mixId : `RD${mixId}`;
  const baseUrl = "https://yt.omada.cafe/api/v1/mixes";
  const suffix = continuation
    ? `?continuation=${encodeURIComponent(continuation)}`
    : "";
  const url = `${baseUrl}/${encodeURIComponent(normalizedId)}${suffix}`;
  return await fetchWithRetry<any>(url, {}, 2, 300);
}

// JioSaavn API functions for suggestions
export async function fetchJioSaavnSuggestions(songId: string) {
  try {
    const response = await fetch(
      `https://streamifyjiosaavn.vercel.app/api/songs/${songId}/suggestions`
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(
      `JioSaavn suggestions API failed: ${(error as Error).message}`
    );
  }
}

// Helper function to extract video ID from different YouTube URL formats
export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/|youtube\.com\/e\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

// Helper function to determine track source
export function getTrackSource(
  track: Track
): "youtube" | "jiosaavn" | "unknown" {
  if (track._isJioSaavn) {
    return "jiosaavn";
  }

  if (track.audioUrl) {
    // Check if it's a YouTube URL
    if (
      track.audioUrl.includes("youtube.com") ||
      track.audioUrl.includes("youtu.be") ||
      track.audioUrl.includes("googlevideo.com")
    ) {
      return "youtube";
    }
  }

  // Check if ID looks like YouTube video ID
  if (track.id && track.id.length === 11 && /^[a-zA-Z0-9_-]+$/.test(track.id)) {
    return "youtube";
  }

  return "unknown";
}
