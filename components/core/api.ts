import { Track } from "../../contexts/PlayerContext";
import {
  getProviderEndpoints,
  type ProviderEndpoints,
} from "../../lib/provider-endpoints";

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

function replaceList(target: string[], nextValues: readonly string[]) {
  target.splice(0, target.length, ...nextValues);
}

// Centralized API Configuration
export const API = {
  piped: [] as string[],
  invidious: [] as string[],

  // JioSaavn API endpoints
  jiosaavn: {
    base: "",
    search: "/search",
    songs: "/songs",
    albums: "/albums",
    artists: "/artists",
    playlists: "/search/playlists",
  },
};

// Type definitions for better compatibility
export type APIConfig = typeof API;
export type InvidiousInstance = string;
export type PipedInstance = string;

// Dynamic Invidious instances array (mutable)
export let DYNAMIC_INVIDIOUS_INSTANCES: string[] = [];

const EMPTY_PROVIDER_ENDPOINTS: ProviderEndpoints = {
  instances: {
    piped: [],
    invidious: [],
    server: {
      localProxyBase: "",
      localExpressApiUrl: "",
      localAllowedClientOrigin: "",
    },
  },
  providers: {
    search: {
      ytifyInstance: "",
      searchBackendUrl: "",
      soundcloudSearchProxyBase: "",
    },
    jiosaavn: {
      apiBase: "",
      fallbackSearchBase: "",
      webOrigin: "",
    },
    beatseek: {
      apiBase: "",
    },
    lyrics: {
      lrclibBase: "",
      lyricsOvhBase: "",
    },
    soundcloud: {
      origin: "",
      mobileOrigin: "",
      apiBase: "",
      apiV2Base: "",
      widgetBase: "",
      licenseBase: "",
      oembedBase: "",
    },
    youtube: {
      webBase: "",
      musicBase: "",
      oembedBase: "",
      imageBase: "",
    },
  },
  headers: {
    origins: {
      soundcloud: "",
      youtube: "",
      jiosaavn: "",
    },
    referers: {
      soundcloud: "",
      youtube: "",
      jiosaavn: "",
    },
  },
};

let CURRENT_PROVIDER_ENDPOINTS: ProviderEndpoints = EMPTY_PROVIDER_ENDPOINTS;

function setPipedInstances(instances: readonly string[]) {
  const uniqueInstances = [
    ...new Set(instances.map((instance) => normalizeUrl(instance))),
  ];
  replaceList(API.piped, uniqueInstances);
  return API.piped;
}

function setJioSaavnBase(baseUrl?: string) {
  API.jiosaavn.base = normalizeUrl(baseUrl || "");
  return API.jiosaavn.base;
}

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
  replaceList(API.invidious, uniqueInstances);
  return uniqueInstances;
}
export function setInvidiousInstances(instances: readonly string[]) {
  DYNAMIC_INVIDIOUS_INSTANCES = [
    ...new Set(
      instances.map((instance) => normalizeInvidiousInstance(instance))
    ),
  ];
  replaceList(API.invidious, DYNAMIC_INVIDIOUS_INSTANCES);
  return DYNAMIC_INVIDIOUS_INSTANCES;
}
export function normalizeInvidiousInstance(instance: string): string {
  const trimmed = normalizeUrl(instance);
  const withoutApi = trimmed.replace(/\/api\/v1\/?$/i, "");
  return withoutApi.replace(/\/+$/g, "");
}

export function getPrimaryPipedInstance() {
  return API.piped[0] || "";
}

export function getPrimaryInvidiousInstance(preferredHost?: string) {
  if (preferredHost) {
    const preferred =
      DYNAMIC_INVIDIOUS_INSTANCES.find((url) => url.includes(preferredHost)) ||
      API.invidious.find((url) => url.includes(preferredHost));
    if (preferred) {
      return preferred;
    }
  }

  return DYNAMIC_INVIDIOUS_INSTANCES[0] || API.invidious[0] || "";
}

export function getProviderEndpointsSnapshot() {
  return CURRENT_PROVIDER_ENDPOINTS;
}

export function getSearchProviderBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.search.searchBackendUrl;
}

export function getLocalProxyBase() {
  return CURRENT_PROVIDER_ENDPOINTS.instances.server.localProxyBase;
}

export function getLocalExpressApiUrl() {
  return CURRENT_PROVIDER_ENDPOINTS.instances.server.localExpressApiUrl;
}

export function getLocalAllowedClientOrigin() {
  return CURRENT_PROVIDER_ENDPOINTS.instances.server.localAllowedClientOrigin;
}

export function getYtifyInstance() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.search.ytifyInstance;
}

export function getSoundCloudSearchProxyBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.search.soundcloudSearchProxyBase;
}

export function getBeatseekApiBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.beatseek.apiBase;
}

export function getJioSaavnFallbackSearchBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.jiosaavn.fallbackSearchBase;
}

export function getLyricsOvhBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.lyrics.lyricsOvhBase;
}

export function getLrcLibBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.lyrics.lrclibBase;
}

export function getSoundCloudApiBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.soundcloud.apiBase;
}

export function getSoundCloudApiV2Base() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.soundcloud.apiV2Base;
}

export function getSoundCloudWidgetBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.soundcloud.widgetBase;
}

export function getSoundCloudOrigin() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.soundcloud.origin;
}

export function getSoundCloudMobileOrigin() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.soundcloud.mobileOrigin;
}

export function getSoundCloudOEmbedBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.soundcloud.oembedBase;
}

export function getYouTubeWebBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.youtube.webBase;
}

export function getYouTubeMusicBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.youtube.musicBase;
}

export function getYouTubeImageBase() {
  return CURRENT_PROVIDER_ENDPOINTS.providers.youtube.imageBase;
}

export function getProviderOrigin(
  provider: "soundcloud" | "youtube" | "jiosaavn"
) {
  return CURRENT_PROVIDER_ENDPOINTS.headers.origins[provider];
}

export function getProviderReferer(
  provider: "soundcloud" | "youtube" | "jiosaavn"
) {
  return CURRENT_PROVIDER_ENDPOINTS.headers.referers[provider];
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
      console.log(`🟡 [API] Piped instance try: ${baseUrl}`);
      const data = await fetchStreamFromPiped(id, baseUrl);
      console.log(`🟢 [API] Piped instance ok: ${baseUrl}`);
      return data;
    } catch (error) {
      console.log(
        `🔴 [API] Piped instance failed: ${baseUrl} (${
          (error as Error).message
        })`
      );
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
      console.log(`🟡 [API] Invidious instance try: ${baseUrl}`);
      const data = await fetchStreamFromInvidious(id, baseUrl);
      console.log(`🟢 [API] Invidious instance ok: ${baseUrl}`);
      return data;
    } catch (error) {
      console.log(
        `🔴 [API] Invidious instance failed: ${baseUrl} (${
          (error as Error).message
        })`
      );
      errors.push(`${baseUrl}: ${(error as Error).message}`);
      continue;
    }
  }

  throw new Error(`All Invidious instances failed: ${errors.join(", ")}`);
}

async function applyProviderEndpoints(revalidate = false): Promise<void> {
  const endpoints = await getProviderEndpoints({ revalidate });
  CURRENT_PROVIDER_ENDPOINTS = endpoints;

  const normalizedInvidious = endpoints.instances.invidious.map((instance) =>
    normalizeInvidiousInstance(instance)
  );
  const pipedInstances = endpoints.instances.piped.map((instance) =>
    normalizeUrl(instance)
  );

  const [healthyPiped, healthyInvidious] = await Promise.all([
    pipedInstances.length > 0 ? getHealthyInstances(pipedInstances) : [],
    normalizedInvidious.length > 0
      ? getHealthyInvidiousInstancesSorted(normalizedInvidious)
      : [],
  ]);

  const prioritizedPiped = [
    ...healthyPiped,
    ...pipedInstances.filter((instance) => !healthyPiped.includes(instance)),
  ];

  setPipedInstances(prioritizedPiped);
  setJioSaavnBase(endpoints.providers.jiosaavn.apiBase);

  if (normalizedInvidious.length === 0) {
    setInvidiousInstances([]);
    console.log("[API] Runtime config returned no Invidious instances");
    return;
  }

  setInvidiousInstances(
    healthyInvidious.length > 0 ? healthyInvidious : normalizedInvidious
  );

  console.log(
    `[API] Runtime config ready. Piped: ${API.piped.length} (${healthyPiped.length} healthy), Invidious: ${DYNAMIC_INVIDIOUS_INSTANCES.length} (${healthyInvidious.length} healthy)`
  );
}

export async function initializeDynamicInstances(): Promise<void> {
  try {
    console.log("[API] Fetching provider instances from runtime config...");
    await applyProviderEndpoints(false);
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
  const baseUrl = getPrimaryInvidiousInstance();
  if (!baseUrl) {
    throw new Error("No Invidious instance available for YouTube mixes");
  }
  const suffix = continuation
    ? `?continuation=${encodeURIComponent(continuation)}`
    : "";
  const url = `${baseUrl}/api/v1/mixes/${encodeURIComponent(normalizedId)}${suffix}`;
  return await fetchWithRetry<any>(url, {}, 2, 300);
}

// JioSaavn API functions for suggestions
export async function fetchJioSaavnSuggestions(songId: string) {
  try {
    const response = await fetch(
      `${getJioSaavnSongEndpoint(songId)}/suggestions`
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
