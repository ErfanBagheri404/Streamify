// lib/searchAPI.ts
import {
  API,
  DYNAMIC_INVIDIOUS_INSTANCES,
  fetchStreamFromPipedWithFallback,
  fetchStreamFromInvidiousWithFallback,
  getBeatseekApiBase,
  getJioSaavnSearchEndpoint,
  getJioSaavnSongEndpoint,
  getJioSaavnArtistEndpoint,
  getJioSaavnPlaylistEndpoint,
  getSoundCloudSearchProxyBase,
  fetchWithRetry,
  idFromURL,
  convertSStoHHMMSS,
  numFormatter,
  fetchYouTubeMix,
} from "../components/core/api";
import {
  buildProviderUrlCandidates,
  getProviderEndpoints,
} from "../lib/provider-endpoints";
import { getRuntimeServiceConfig } from "../lib/runtime-services";
import {
  absolutizeImageUrl,
  buildProxiedYouTubeThumbnailUrl,
  pickBestImageUrl,
  sanitizeImageUrl,
  upgradeSoundCloudImage,
} from "../components/core/image";
import { fetchBackendRoute } from "../lib/backend-api";

export interface SearchResult {
  id: string;
  title: string;
  author?: string;
  artistId?: string;
  artistImage?: string;
  artistSource?: "youtube" | "soundcloud" | "jiosaavn" | "youtubemusic";
  duration: string;
  href?: string;
  uploaded?: string;
  channelUrl?: string;
  views?: string;
  videoCount?: string; // For playlists - number of videos
  img?: string;
  thumbnailUrl?: string;
  source?:
    | "youtube"
    | "soundcloud"
    | "jiosaavn"
    | "youtubemusic"
    | "itunes"
    | "deezer";
  playbackSource?: "youtube" | "soundcloud" | "jiosaavn" | "youtubemusic";
  providerHint?: "itunes" | "deezer";
  type?: "song" | "album" | "artist" | "playlist" | "unknown";
  albumId?: string | null;
  albumName?: string | null;
  albumUrl?: string | null;
  albumYear?: string | null;
  description?: string; // For channels - channel description
  verified?: boolean; // For channels - verified badge
}

// --- CONSTANTS ---
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Use centralized API configuration
export const PIPED_INSTANCES = API.piped;

type BackendSearchSource =
  | "mixed"
  | "youtube"
  | "youtubemusic"
  | "soundcloud"
  | "jiosaavn"
  | "itunes"
  | "deezer";

type BackendSearchResponse = {
  items: any[];
  nextpage?: string | null;
};

// Use dynamic Invidious instances directly from centralized config

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
    return "";
  }
  let n = Number(stamp);
  if (Number.isNaN(n) || n <= 0) {
    return "";
  }
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  const secDiff = (Date.now() - ms) / 1000;
  if (secDiff < 0) {
    return "just now";
  }
  if (secDiff > 1_600_000_000) {
    return "";
  }
  for (const u of units) {
    const val = Math.floor(secDiff / u.d);
    if (val >= 1) {
      return `${val} ${u.l}${val > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}

function normalizeSearchItemType(item: Record<string, unknown>): string {
  const rawType =
    typeof item.type === "string" ? item.type.trim().toLowerCase() : "";

  if (rawType === "stream") {
    return "song";
  }

  if (rawType === "channel") {
    return "artist";
  }

  if (rawType) {
    return rawType;
  }

  if (item.duration != null || item.lengthSeconds != null) {
    return "song";
  }

  return "unknown";
}

function extractYouTubeChannelId(item: Record<string, unknown>): string {
  const directCandidates = [
    item.channelId,
    item.authorId,
    item.uploaderId,
    item.authorBrowseId,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const urlCandidates = [
    item.authorUrl,
    item.channelUrl,
    item.uploaderUrl,
    item.authorEndpointUrl,
  ];

  for (const candidate of urlCandidates) {
    if (typeof candidate !== "string" || !candidate.trim()) {
      continue;
    }

    const match = candidate.match(/\/channel\/([^/?#]+)/i);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return "";
}

function resolveSearchArtistImage(item: Record<string, unknown>): string {
  return (
    pickBestImageUrl(item.authorThumbnails) ||
    pickBestImageUrl(item.authorAvatars) ||
    sanitizeImageUrl(
      absolutizeImageUrl(
        String(item.authorThumbnail || item.uploaderAvatar || ""),
        "",
      ),
    ) ||
    ""
  );
}

function interleaveSearchLists<T>(lists: T[][]): T[] {
  const output: T[] = [];
  const maxLength = Math.max(0, ...lists.map((list) => list.length));

  for (let index = 0; index < maxLength; index += 1) {
    for (const list of lists) {
      if (list[index]) {
        output.push(list[index]);
      }
    }
  }

  return output;
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();

  return results.filter((item) => {
    const key = `${item.source || "unknown"}:${item.id || item.href || item.title}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getRawSearchItemType(item: Record<string, any>): SearchResult["type"] {
  const rawType =
    typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
  const rawUrl = typeof item.url === "string" ? item.url : "";

  if (
    rawType === "channel" ||
    rawUrl.includes("/channel/") ||
    typeof item.channelId === "string"
  ) {
    return "artist";
  }

  if (
    rawType === "playlist" ||
    rawUrl.includes("/playlist?list=") ||
    rawUrl.includes("/mix?list=") ||
    typeof item.playlistId === "string"
  ) {
    return "playlist";
  }

  if (
    rawType === "video" ||
    rawType === "stream" ||
    item.duration != null ||
    item.lengthSeconds != null ||
    typeof item.videoId === "string"
  ) {
    return "song";
  }

  if (rawType === "artist") {
    return "artist";
  }

  if (rawType === "album") {
    return "album";
  }

  return "unknown";
}

function filterYouTubeMusicItems(items: any[], filter: string): any[] {
  const normalizedFilter = (filter || "songs").toLowerCase();
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  if (!normalizedFilter || normalizedFilter === "all") {
    return items;
  }

  return items.filter((item) => {
    const itemType = getRawSearchItemType(item || {});

    switch (normalizedFilter) {
      case "songs":
      case "videos":
        return itemType === "song";
      case "playlists":
        return itemType === "playlist";
      case "channels":
      case "artists":
        return itemType === "artist";
      case "albums":
        return itemType === "album";
      default:
        return true;
    }
  });
}

function pickJioSaavnArray(...candidates: any[]): any[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function getPreferredPipedInstances(): string[] {
  return [...new Set(PIPED_INSTANCES.filter(Boolean))];
}

function extractJioSaavnSections(payload: any) {
  const root = payload?.data || payload || {};
  const topQuery = pickJioSaavnArray(
    root.topQuery?.results,
    root.topQuery?.data,
    root.topQuery,
  );
  const songs = pickJioSaavnArray(
    root.songs?.results,
    root.songs?.data,
    root.results,
    root.songs,
  );
  const albums = pickJioSaavnArray(
    root.albums?.results,
    root.albums?.data,
    root.albums,
  );
  const artists = pickJioSaavnArray(
    root.artists?.results,
    root.artists?.data,
    root.artists,
  );
  const playlists = pickJioSaavnArray(
    root.playlists?.results,
    root.playlists?.data,
    root.playlists,
  );

  return { topQuery, songs, albums, artists, playlists };
}

function mergeJioSaavnSectionItems(existing: any[], incoming: any[]): any[] {
  const merged = [...existing];
  const seen = new Set(
    existing.map((item) => String(item?.id || item?.url || item?.title || "")),
  );

  for (const item of incoming) {
    const key = String(item?.id || item?.url || item?.title || "");
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function pickJioSaavnImageUrl(item: any): string {
  return pickBestImageUrl(item?.image);
}

function looksLikeBareMediaId(value: string, expectedId?: string): boolean {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return true;
  }

  if (
    expectedId &&
    normalizedValue.toLowerCase() === String(expectedId).trim().toLowerCase()
  ) {
    return true;
  }

  return (
    !/\s/.test(normalizedValue) &&
    /^[A-Za-z0-9_-]{10,}$/.test(normalizedValue) &&
    normalizedValue.length <= 64
  );
}

function pickBestTrackTitle(item: any, expectedId?: string): string {
  const candidates = [
    item?.title,
    item?.name,
    item?.trackName,
    item?.song,
    item?.videoTitle,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (!normalized || looksLikeBareMediaId(normalized, expectedId)) {
      continue;
    }

    return normalized;
  }

  return "Unknown Title";
}

function pickBestArtistName(item: any, fallback = "Unknown Artist"): string {
  const candidates = [
    item?.artist,
    item?.author,
    item?.uploaderName,
    item?.uploader,
    item?.artistName,
    item?.channel?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallback;
}

function pickBestYouTubeThumbnail(item: any, base?: string): string {
  return (
    pickBestImageUrl(item?.videoThumbnails, base) ||
    pickBestImageUrl(item?.thumbnails, base) ||
    pickBestImageUrl(item, base) ||
    buildProxiedYouTubeThumbnailUrl({
      videoId:
        typeof item?.videoId === "string"
          ? item.videoId
          : typeof item?.id === "string"
            ? item.id
            : undefined,
      url: typeof item?.url === "string" ? item.url : undefined,
    }) ||
    ""
  );
}

function filterJioSaavnSearchResults(
  items: SearchResult[],
  filter?: string,
): SearchResult[] {
  const normalizedFilter = (filter || "all").toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all") {
    return items;
  }

  return items.filter((item) => {
    switch (normalizedFilter) {
      case "songs":
      case "tracks":
      case "videos":
        return item.type === "song";
      case "albums":
        return item.type === "album";
      case "artists":
      case "channels":
        return item.type === "artist";
      case "playlists":
        return item.type === "playlist";
      default:
        return true;
    }
  });
}

async function searchViaBackend(options: {
  query: string;
  source: BackendSearchSource;
  filter?: string;
  page?: number;
  limit?: number;
  nextpage?: string;
}): Promise<BackendSearchResponse | null> {
  try {
    const response = await fetchBackendRoute("/search", {
      searchParams: {
        q: options.query,
        source: options.source,
        filter: options.filter,
        page: options.page,
        limit: options.limit,
        nextpage: options.nextpage,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      items?: unknown[];
      nextpage?: string | null;
    };

    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      nextpage:
        typeof payload.nextpage === "string"
          ? payload.nextpage
          : (payload.nextpage ?? null),
    };
  } catch (error) {
    console.warn("[API] Backend search failed:", error);
    return null;
  }
}

function inferBackendItemType(item: Record<string, any>): SearchResult["type"] {
  const rawType =
    typeof item.type === "string" ? item.type.trim().toLowerCase() : "";

  if (rawType === "stream" || rawType === "video" || rawType === "song") {
    return "song";
  }
  if (rawType === "album") {
    return "album";
  }
  if (rawType === "playlist") {
    return "playlist";
  }
  if (rawType === "artist" || rawType === "channel") {
    return "artist";
  }
  if (
    typeof item.videoId === "string" ||
    item.duration != null ||
    item.lengthSeconds != null
  ) {
    return "song";
  }

  return "unknown";
}

function pickBackendCatalogAuthor(item: Record<string, any>): string {
  return (
    item.primaryArtists ||
    item.primary_artists ||
    item.singers ||
    item.artist ||
    item.author ||
    item.description ||
    "Unknown Artist"
  );
}

function normalizeBackendCatalogItem(
  item: Record<string, any>,
  requestedSource: BackendSearchSource,
): SearchResult | null {
  const providerHint =
    item.providerHint === "itunes" || item.providerHint === "deezer"
      ? item.providerHint
      : undefined;
  const displaySource =
    requestedSource === "itunes" || requestedSource === "deezer"
      ? requestedSource
      : providerHint || "jiosaavn";
  const imageUrl =
    pickBestImageUrl(item.image) ||
    sanitizeImageUrl(
      item.thumbnailUrl || item.thumbnail || item.coverUrl || "",
    );
  const rawAlbum =
    item.album && typeof item.album === "object" ? item.album : null;
  const id = String(item.id || item.url || "");

  if (!id) {
    return null;
  }

  return {
    id,
    title: item.name || item.title || item.song || "Unknown Title",
    author: pickBackendCatalogAuthor(item),
    duration:
      item.duration != null && item.duration !== ""
        ? String(item.duration)
        : "0",
    thumbnailUrl: imageUrl,
    img: imageUrl,
    href: item.url || "",
    source: displaySource,
    playbackSource: "jiosaavn",
    providerHint,
    type: inferBackendItemType(item),
    albumId: rawAlbum?.id || null,
    albumName: rawAlbum?.name || item.album || null,
    albumUrl: rawAlbum?.url || null,
    albumYear: item.year || item.albumYear || null,
  };
}

function normalizeBackendSoundCloudItem(
  item: Record<string, any>,
): SearchResult | null {
  const id = String(item.id || item.url || item.href || "");
  if (!id) {
    return null;
  }

  const imageUrl = sanitizeImageUrl(
    item.thumbnailUrl || item.img || item.artwork || item.artworkUrl || "",
  );

  return {
    id,
    title: item.title || "Unknown Title",
    author: item.author || item.artist || "Unknown Artist",
    duration:
      item.duration != null && item.duration !== ""
        ? String(item.duration)
        : "0",
    views: item.views != null ? String(item.views) : undefined,
    videoCount: item.videoCount != null ? String(item.videoCount) : undefined,
    uploaded: item.uploaded,
    thumbnailUrl: imageUrl,
    img: imageUrl,
    href: item.href || item.url || "",
    source: "soundcloud",
    type: inferBackendItemType(item),
  };
}

function normalizeBackendSearchResults(
  items: any[],
  requestedSource: BackendSearchSource,
): SearchResult[] {
  const normalized = items
    .map((entry) => {
      const item =
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, any>)
          : null;
      if (!item) {
        return null;
      }

      const source =
        typeof item.source === "string" ? item.source : requestedSource;
      const providerHint =
        item.providerHint === "itunes" || item.providerHint === "deezer"
          ? item.providerHint
          : undefined;

      if (
        source === "jiosaavn" ||
        requestedSource === "jiosaavn" ||
        requestedSource === "itunes" ||
        requestedSource === "deezer" ||
        providerHint
      ) {
        return normalizeBackendCatalogItem(item, requestedSource);
      }

      if (source === "soundcloud" || requestedSource === "soundcloud") {
        return normalizeBackendSoundCloudItem(item);
      }

      const formatted = searchAPI.formatSearchResults([
        {
          ...item,
          source,
        },
      ]);
      return formatted[0] || null;
    })
    .filter((entry): entry is SearchResult => Boolean(entry));

  return dedupeSearchResults(normalized);
}

function buildMixedSearchResults(
  resultGroups: SearchResult[][],
): SearchResult[] {
  const topResults: SearchResult[][] = [];
  const artists: SearchResult[][] = [];
  const playlists: SearchResult[][] = [];
  const albums: SearchResult[][] = [];
  const songs: SearchResult[][] = [];
  const others: SearchResult[][] = [];

  for (const items of resultGroups) {
    const providerTop: SearchResult[] = [];
    const providerArtists: SearchResult[] = [];
    const providerPlaylists: SearchResult[] = [];
    const providerAlbums: SearchResult[] = [];
    const providerSongs: SearchResult[] = [];
    const providerOthers: SearchResult[] = [];

    for (const item of items) {
      const itemType = normalizeSearchItemType(
        item as unknown as Record<string, unknown>,
      );

      if (itemType === "unknown" || itemType === "hashtag") {
        providerTop.push(item);
      } else if (itemType === "artist") {
        providerArtists.push(item);
      } else if (itemType === "playlist") {
        providerPlaylists.push(item);
      } else if (itemType === "album") {
        providerAlbums.push(item);
      } else if (itemType === "song" || itemType === "video") {
        providerSongs.push(item);
      } else {
        providerOthers.push(item);
      }
    }

    topResults.push(providerTop);
    artists.push(providerArtists);
    playlists.push(providerPlaylists);
    albums.push(providerAlbums);
    songs.push(providerSongs);
    others.push(providerOthers);
  }

  return dedupeSearchResults([
    ...interleaveSearchLists(topResults),
    ...interleaveSearchLists(artists),
    ...interleaveSearchLists(playlists),
    ...interleaveSearchLists(albums),
    ...interleaveSearchLists(songs),
    ...interleaveSearchLists(others),
  ]);
}

// Helper functions are now imported from centralized API configuration

// Robust fetcher for Piped/Invidious
const fetchWithFallbacks = async (
  instances: string[],
  endpoint: string,
): Promise<any> => {
  console.log(
    `[API] fetchWithFallbacks called with ${instances.length} instances for endpoint: ${endpoint}`,
  );
  for (const baseUrl of instances) {
    const startTime = Date.now();
    try {
      console.log(`[API] 🟡 Attempting: ${baseUrl} ...`);
      const url = `${baseUrl}${endpoint}`;
      console.log(`[API] Full URL: ${url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(timeoutId);
      console.log(`[API] Response status: ${response.status}`);
      if (response.ok) {
        const text = await response.text();
        console.log(`[API] Response text length: ${text.length}`);
        try {
          if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
            const parsed = JSON.parse(text);
            console.log(`[API] ✅ Successfully parsed JSON from ${baseUrl}`);
            return parsed;
          } else {
            console.log("[API] Response doesn't start with JSON");
          }
        } catch (e) {
          console.log(`[API] Failed to parse JSON from ${baseUrl}:`, e.message);
        }
      } else {
        console.log(`[API] Response not OK: ${response.status}`);
      }
    } catch (error) {
      console.log(`[API] Network error for ${baseUrl}:`, error.message);
    }
  }
  console.log(`[API] ❌ All instances failed for endpoint: ${endpoint}`);
  return null;
};

/* ---------- MAIN API ---------- */
export const searchAPI = {
  getSuggestions: async (
    query: string,
    source:
      | "mixed"
      | "itunes"
      | "deezer"
      | "youtube"
      | "youtubemusic"
      | "soundcloud"
      | "spotify"
      | "jiosaavn" = "youtube",
  ): Promise<string[]> => {
    if (!query.trim()) {
      return [];
    }

    // Enhanced multilingual support for suggestions
    const isMultilingual = /[^\u0000-\u007F]/.test(query);
    if (isMultilingual) {
      console.log(
        `[API] Detected multilingual query for suggestions: "${query}"`,
      );
    }

    if (source === "soundcloud") {
      return await searchAPI.getSoundCloudSuggestions(query);
    }
    if (source === "jiosaavn") {
      // For JioSaavn, return simple suggestions based on the query
      const terms = ["song", "remix", "live", "official"];
      return [query, ...terms.map((term) => `${query} ${term}`)].slice(0, 5);
    }
    if (source === "itunes" || source === "deezer") {
      const terms = ["song", "album", "live", "remix"];
      return [query, ...terms.map((term) => `${query} ${term}`)].slice(0, 5);
    }
    if (source === "spotify") {
      return await searchAPI.getSpotifySuggestions(query);
    }

    const endpoint = `/suggestions?query=${encodeURIComponent(query)}`;
    const data = await fetchWithFallbacks([...PIPED_INSTANCES], endpoint);
    let suggestions: string[] = [];

    if (Array.isArray(data)) {
      if (data.length > 1 && Array.isArray(data[1])) {
        suggestions = (data[1] as any[]).filter(
          (v): v is string => typeof v === "string",
        );
      } else {
        suggestions = (data as any[]).filter(
          (v): v is string => typeof v === "string",
        );
      }
    } else if (data && Array.isArray((data as any).suggestions)) {
      suggestions = (data as any).suggestions.filter(
        (v: any) => typeof v === "string",
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

    const fallbackTerms = ["mix", "remix", "live", "instrumental", "extended"];

    return [query, ...fallbackTerms.map((term) => `${query} ${term}`)].slice(
      0,
      5,
    );
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

  // --- JIOSAAVN SEARCH ---
  searchWithJioSaavn: async (
    query: string,
    filter?: string,
    page?: number,
    limit?: number,
  ) => {
    console.log(`[API] Starting JioSaavn search for: "${query}"`);

    const backendResult = await searchViaBackend({
      query,
      source: "jiosaavn",
      filter,
      page,
      limit,
    });
    if (backendResult) {
      return filterJioSaavnSearchResults(
        normalizeBackendSearchResults(backendResult.items, "jiosaavn"),
        filter,
      );
    }

    try {
      const providerEndpoints = await getProviderEndpoints();
      const runtimeServices = await getRuntimeServiceConfig();
      const candidateUrls = [
        ...buildProviderUrlCandidates(
          providerEndpoints.providers.jiosaavn.apiBase,
          ["/api/search", "/search"],
          { query },
        ),
        ...buildProviderUrlCandidates(
          runtimeServices.search.jiosaavnSearchFallbackUrl,
          [],
          { query },
        ),
        ...buildProviderUrlCandidates(
          providerEndpoints.providers.jiosaavn.fallbackSearchBase,
          [
            "/search/all",
            "/api/search/all",
            "/search/songs",
            "/api/search/songs",
            "/search",
            "/api/search",
          ],
          { query },
        ),
        ...buildProviderUrlCandidates(
          providerEndpoints.providers.jiosaavn.apiBase,
          ["/search", "/api/search", "/search/all", "/api/search/all"],
          { query },
        ),
        getJioSaavnSearchEndpoint(query),
      ];

      let topQuery: any[] = [];
      let songs: any[] = [];
      let albums: any[] = [];
      let artists: any[] = [];
      let playlists: any[] = [];
      const endpointErrors: string[] = [];

      for (const searchUrl of [...new Set(candidateUrls.filter(Boolean))]) {
        try {
          const data = await fetchWithRetry<any>(
            searchUrl,
            {
              headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/json",
              },
            },
            1,
            200,
          );

          const sections = extractJioSaavnSections(data);
          topQuery = mergeJioSaavnSectionItems(topQuery, sections.topQuery);
          songs = mergeJioSaavnSectionItems(songs, sections.songs);
          albums = mergeJioSaavnSectionItems(albums, sections.albums);
          artists = mergeJioSaavnSectionItems(artists, sections.artists);
          playlists = mergeJioSaavnSectionItems(playlists, sections.playlists);

          if (
            topQuery.length > 0 &&
            songs.length > 0 &&
            albums.length > 0 &&
            artists.length > 0 &&
            playlists.length > 0
          ) {
            break;
          }
        } catch (error) {
          endpointErrors.push(
            `${searchUrl}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (
        topQuery.length === 0 &&
        songs.length === 0 &&
        albums.length === 0 &&
        artists.length === 0 &&
        playlists.length === 0
      ) {
        throw new Error(
          endpointErrors.join(" | ") || "Invalid JioSaavn response format",
        );
      }

      console.log(
        `[API] 🟢 JioSaavn Success: Found ${songs.length} songs, ${albums.length} albums, ${artists.length} artists, ${playlists.length} playlists, ${topQuery.length} top queries`,
      );

      const topQueryResults: SearchResult[] = [];
      const songsResults: SearchResult[] = [];
      const albumsResults: SearchResult[] = [];
      const artistsResults: SearchResult[] = [];
      const playlistResults: SearchResult[] = [];

      topQuery.forEach((item: any) => {
        topQueryResults.push({
          id: String(item.id || item.url || ""),
          title: item.title || "Unknown Title",
          author: item.description || "Unknown",
          duration: "0",
          thumbnailUrl: pickJioSaavnImageUrl(item),
          img: pickJioSaavnImageUrl(item),
          href: item.url || "",
          source: "jiosaavn",
          type: item.type || "unknown",
        });
      });

      songs.forEach((song: any) => {
        songsResults.push({
          id: String(song.id || song.url || ""),
          title: song.name || song.title || song.song || "Unknown Title",
          author: song.primaryArtists || song.singers || "Unknown Artist",
          duration: song.duration ? String(song.duration) : "0",
          thumbnailUrl: pickJioSaavnImageUrl(song),
          img: pickJioSaavnImageUrl(song),
          href: song.url || "",
          source: "jiosaavn",
          type: "song",
          albumId: song.album?.id || null,
          albumName: song.album?.name || null,
          albumUrl: song.album?.url || null,
        });
      });

      albums.forEach((album: any) => {
        albumsResults.push({
          id: String(album.id || album.url || ""),
          title: album.title || "Unknown Album",
          author: album.artist || "Unknown Artist",
          duration: "0",
          uploaded: album.year || "",
          thumbnailUrl: pickJioSaavnImageUrl(album),
          img: pickJioSaavnImageUrl(album),
          href: album.url || "",
          source: "jiosaavn",
          type: "album",
          albumYear: album.year || null,
        });
      });

      artists.forEach((artist: any) => {
        artistsResults.push({
          id: String(artist.id || artist.url || ""),
          title: artist.title || "Unknown Artist",
          author: artist.description || "Artist",
          duration: "0",
          thumbnailUrl: pickJioSaavnImageUrl(artist),
          img: pickJioSaavnImageUrl(artist),
          href: artist.url || "",
          source: "jiosaavn",
          type: "artist",
        });
      });

      playlists.forEach((playlist: any) => {
        playlistResults.push({
          id: String(playlist.id || playlist.url || ""),
          title: playlist.title || "Unknown Playlist",
          author: playlist.description || "Playlist",
          duration: "0",
          thumbnailUrl: pickJioSaavnImageUrl(playlist),
          img: pickJioSaavnImageUrl(playlist),
          href: playlist.url || "",
          source: "jiosaavn",
          type: "playlist",
        });
      });

      const filteredResults = filterJioSaavnSearchResults(
        [
          ...topQueryResults,
          ...songsResults,
          ...albumsResults,
          ...artistsResults,
          ...playlistResults,
        ],
        filter,
      );

      console.log(
        `[API] Final JioSaavn results: ${filteredResults.length} total (filter: ${(filter || "all").toLowerCase()})`,
      );
      return dedupeSearchResults(filteredResults);
    } catch (e: any) {
      console.warn(`[API] 🔴 JioSaavn Error: ${e.message}`);
      return [];
    }
  },

  searchWithItunes: async (query: string, page?: number, limit?: number) => {
    const backendResult = await searchViaBackend({
      query,
      source: "itunes",
      page,
      limit,
    });

    return backendResult
      ? normalizeBackendSearchResults(backendResult.items, "itunes")
      : [];
  },

  searchWithDeezer: async (query: string, page?: number, limit?: number) => {
    const backendResult = await searchViaBackend({
      query,
      source: "deezer",
      page,
      limit,
    });

    return backendResult
      ? normalizeBackendSearchResults(backendResult.items, "deezer")
      : [];
  },

  // COMMENTED OUT: JioSaavn song details disabled to focus on YouTube
  /*
  // --- JIOSAAVN SONG DETAILS ---
  getJioSaavnSongDetails: async (songId: string) => {
    console.log(`[API] Fetching JioSaavn song details for: "${songId}"`);

    try {
      const detailsUrl = getJioSaavnSongEndpoint(songId);
      const data = await fetchWithRetry<any>(
        detailsUrl,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        },
        3,
        1000
      );

      if (
        !data ||
        !data.success ||
        !data.data ||
        !Array.isArray(data.data) ||
        data.data.length === 0
      ) {
        throw new Error("Invalid response format");
      }

      const song = data.data[0];

      console.log(`[API] 🟢 JioSaavn Song Details Success: ${song.name}`);

      // Get the best quality audio URL (prefer 320kbps, fallback to lower quality)
      const audioUrl =
        song.downloadUrl?.find((dl: any) => dl.quality === "320kbps")?.url ||
        song.downloadUrl?.find((dl: any) => dl.quality === "160kbps")?.url ||
        song.downloadUrl?.find((dl: any) => dl.quality === "96kbps")?.url ||
        song.downloadUrl?.[0]?.url ||
        "";

      // Get the best quality thumbnail
      const thumbnailUrl =
        song.image?.find((img: any) => img.quality === "500x500")?.url ||
        song.image?.find((img: any) => img.quality === "150x150")?.url ||
        song.image?.[0]?.url ||
        "";

      return {
        id: String(song.id),
        title: song.name || song.title || song.song || "Unknown Title",
        artist:
          song.artists?.primary
            ?.map((artist: any) => artist.name?.replace(/\s*-\s*Topic$/i, ""))
            .join(", ") || "Unknown Artist",
        duration: song.duration || 0,
        thumbnail: thumbnailUrl,
        audioUrl: audioUrl,
        album: song.album?.name || "",
        year: song.year || "",
        language: song.language || "",
        hasLyrics: song.hasLyrics || false,
        explicitContent: song.explicitContent || false,
      };
    } catch (e: any) {
      console.warn(`[API] 🔴 JioSaavn Song Details Error: ${e.message}`);
      return null;
    }
  },
  */

  // --- JIOSAAVN ALBUM DETAILS ---
  getJioSaavnAlbumDetails: async (albumId: string, albumName: string) => {
    console.log(
      `[API] Fetching JioSaavn album details for: "${albumName}" (ID: ${albumId})`,
    );

    try {
      const providerEndpoints = await getProviderEndpoints();
      const jioSaavnApiBase =
        providerEndpoints.providers.jiosaavn.apiBase || API.jiosaavn.base;
      const jioSaavnFallbackSearchBase =
        providerEndpoints.providers.jiosaavn.fallbackSearchBase;
      const headers = {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      };
      const directAlbumEndpoints = [
        ...buildProviderUrlCandidates(
          jioSaavnApiBase,
          ["/api/albums", "/albums"],
          {
            id: albumId,
          },
        ),
        ...buildProviderUrlCandidates(jioSaavnApiBase, [
          `/api/albums/${encodeURIComponent(albumId)}`,
          `/albums/${encodeURIComponent(albumId)}`,
        ]),
      ];

      // Strategy 1: Try direct album endpoints first.
      for (const albumUrl of [
        ...new Set(directAlbumEndpoints.filter(Boolean)),
      ]) {
        try {
          const albumData = await fetchWithRetry<any>(
            albumUrl,
            { headers },
            2,
            600,
          );
          const albumRoot =
            albumData?.data && typeof albumData.data === "object"
              ? albumData.data
              : albumData;
          const songs = Array.isArray(albumRoot?.songs) ? albumRoot.songs : [];

          if (songs.length > 0) {
            console.log(
              `[API] 🟢 JioSaavn Album Details Success (Direct): Found ${songs.length} songs for "${albumName}" via ${albumUrl}`,
            );

            return {
              id: albumId,
              name: albumName,
              year: albumRoot.year || songs[0]?.year || "",
              image: albumRoot.image || songs[0]?.image || [],
              songs,
              artists:
                albumRoot.artists ||
                songs[0]?.artists?.primary
                  ?.map((artist: any) =>
                    artist.name?.replace(/\s*-\s*Topic$/i, ""),
                  )
                  .join(", ") ||
                "",
              language: albumRoot.language || songs[0]?.language || "",
            };
          }
        } catch (albumError) {
          console.log(
            `[API] Direct album endpoint failed for ${albumUrl}:`,
            albumError,
          );
        }
      }

      // Strategy 2: Fallback to search approach with multiple attempts
      const searchQueries = [
        albumName,
        `${albumName} album`,
        `${albumName} full album`,
      ];

      for (const query of searchQueries) {
        const searchEndpoints = [
          ...buildProviderUrlCandidates(
            jioSaavnApiBase,
            ["/api/search", "/search"],
            {
              query,
            },
          ),
          ...buildProviderUrlCandidates(
            jioSaavnFallbackSearchBase,
            ["/search", "/api/search"],
            { query },
          ),
          getJioSaavnSearchEndpoint(query),
        ];

        for (const searchUrl of [...new Set(searchEndpoints.filter(Boolean))]) {
          try {
            const controller = new AbortController();
            const data = await fetchWithRetry<any>(
              searchUrl,
              {
                signal: controller.signal,
                headers,
              },
              2,
              600,
            );

            const root = data?.data || data || {};
            const results = Array.isArray(root.results)
              ? root.results
              : Array.isArray(root.songs?.results)
                ? root.songs.results
                : [];

            if (results.length === 0) {
              continue;
            }

            // Filter songs that belong to the specified album
            let albumSongs = results.filter(
              (song: any) => song.album && song.album.id === albumId,
            );

            // If no exact album ID match, try fuzzy matching by album name
            if (albumSongs.length === 0) {
              albumSongs = results.filter(
                (song: any) =>
                  song.album &&
                  song.album.name &&
                  song.album.name
                    .toLowerCase()
                    .includes(albumName.toLowerCase()),
              );
            }

            if (albumSongs.length > 0) {
              console.log(
                `[API] 🟢 JioSaavn Album Details Success (Search): Found ${albumSongs.length} songs for "${albumName}" using query "${query}" via ${searchUrl}`,
              );

              return {
                id: albumId,
                name: albumName,
                year: albumSongs[0].year || "",
                image: albumSongs[0].image || [],
                songs: albumSongs,
                artists:
                  albumSongs[0].artists?.primary
                    ?.map((artist: any) =>
                      artist.name?.replace(/\s*-\s*Topic$/i, ""),
                    )
                    .join(", ") || "",
                language: albumSongs[0].language || "",
              };
            }
          } catch (searchError) {
            console.log(
              `[API] Search attempt with query "${query}" failed for ${searchUrl}:`,
              searchError,
            );
          }
        }
      }

      throw new Error("No songs found for this album after multiple attempts");
    } catch (e: any) {
      console.warn(`[API] 🔴 JioSaavn Album Details Error: ${e.message}`);
      return null;
    }
  },

  // --- YOUTUBE PLAYLIST DETAILS ---
  getYouTubePlaylistDetails: async (playlistId: string) => {
    console.log(
      `[API] Fetching YouTube playlist details for ID: ${playlistId}`,
    );

    let actualPlaylistId = playlistId;
    if (
      playlistId.includes("/playlist?list=") ||
      playlistId.includes("/mix?list=")
    ) {
      actualPlaylistId = playlistId.split("list=")[1] || playlistId;
      console.log(
        `[API] Extracted playlist/mix ID from URL: ${actualPlaylistId}`,
      );
    }
    actualPlaylistId = actualPlaylistId.split("&")[0];

    const isMix = actualPlaylistId.startsWith("RD");
    if (isMix) {
      try {
        const mixData = await fetchYouTubeMix(actualPlaylistId);
        const mixVideosSource =
          (mixData?.videos && Array.isArray(mixData.videos)
            ? mixData.videos
            : null) ||
          (mixData?.items && Array.isArray(mixData.items)
            ? mixData.items
            : null) ||
          (mixData?.relatedStreams && Array.isArray(mixData.relatedStreams)
            ? mixData.relatedStreams
            : null) ||
          [];
        const validVideos = mixVideosSource
          .map((video: any) => {
            const videoId =
              video.videoId ||
              video.id ||
              (video.url && typeof video.url === "string"
                ? video.url.split("v=")[1] || video.url
                : "");
            if (!videoId) {
              return null;
            }
            const thumbnails = Array.isArray(video.videoThumbnails)
              ? video.videoThumbnails
              : [];
            const thumbnail =
              pickBestYouTubeThumbnail(video) ||
              sanitizeImageUrl(thumbnails[thumbnails.length - 1]?.url || "") ||
              sanitizeImageUrl(video.thumbnail || video.thumbnailUrl || "");
            return {
              id: String(videoId),
              title: pickBestTrackTitle(video, String(videoId)),
              artist: pickBestArtistName(video),
              duration: video.lengthSeconds || video.duration || 0,
              thumbnail,
              views: String(video.views || video.viewCount || 0),
              uploaded:
                video.published || video.uploaded || video.publishedText || "",
            };
          })
          .filter((video: any) => !!video);
        if (validVideos.length > 0) {
          const mixThumbnail = validVideos[0]?.thumbnail || "";
          return {
            id: actualPlaylistId,
            name: mixData?.title || "Mix",
            description: "",
            thumbnail: mixThumbnail,
            videos: validVideos,
          };
        }
        return null;
      } catch (e: any) {
        console.warn(`[API] 🔴 YouTube Mix Details Error: ${e.message}`);
        return null;
      }
    }

    try {
      const endpoint = `/playlists/${actualPlaylistId}`;
      console.log(
        `[API] Calling fetchWithFallbacks with endpoint: ${endpoint}`,
      );
      const data = await fetchWithFallbacks([...PIPED_INSTANCES], endpoint);
      console.log(
        "[API] fetchWithFallbacks returned:",
        data ? "data object" : "null",
      );

      // If no data returned from any instance, return null (no fallback)
      if (!data) {
        console.warn("[API] No data returned from any Piped instance");
        return null;
      }

      // Enhanced debugging for response structure
      console.log("[API] Response data keys:", Object.keys(data));
      console.log("[API] Response data type:", typeof data);

      // Check for different possible response structures
      if (data.error) {
        console.warn("[API] API returned error:", data.error);
        return null;
      }

      // Handle different response formats from different Piped instances
      let videos = null;
      let playlistName = data.name || data.title || "Unknown Playlist";
      let playlistDescription = data.description || "";
      let playlistThumbnail =
        pickBestYouTubeThumbnail(data) ||
        sanitizeImageUrl(data.thumbnailUrl || data.thumbnail || "");

      // Check for videos in various possible fields
      if (data.videos && Array.isArray(data.videos) && data.videos.length > 0) {
        videos = data.videos;
        console.log(`[API] Using 'videos' field with ${videos.length} videos`);
      } else if (
        data.relatedStreams &&
        Array.isArray(data.relatedStreams) &&
        data.relatedStreams.length > 0
      ) {
        videos = data.relatedStreams;
        console.log(
          `[API] Using 'relatedStreams' field with ${videos.length} videos`,
        );
      } else if (
        data.items &&
        Array.isArray(data.items) &&
        data.items.length > 0
      ) {
        videos = data.items;
        console.log(`[API] Using 'items' field with ${videos.length} videos`);
      } else if (
        data.content &&
        Array.isArray(data.content) &&
        data.content.length > 0
      ) {
        videos = data.content;
        console.log(`[API] Using 'content' field with ${videos.length} videos`);
      }

      // If we found videos, validate they have the required fields
      if (videos && videos.length > 0) {
        console.log(
          "[API] First video structure:",
          JSON.stringify(videos[0], null, 2),
        );

        // Filter out invalid videos and map to standard format
        const validVideos = videos
          .filter((video: any) => {
            // Check if video has at least a title or URL
            const hasTitle = video.title && typeof video.title === "string";
            const hasUrl = video.url || video.videoId || video.id;
            const isValid = hasTitle || hasUrl;
            if (!isValid) {
              console.warn("[API] Skipping invalid video:", video);
            }
            return isValid;
          })
          .map((video: any) => {
            // Extract video ID from various possible formats
            let videoId = "";
            if (video.videoId) {
              videoId = String(video.videoId);
            } else if (video.id) {
              videoId = String(video.id);
            } else if (video.url && typeof video.url === "string") {
              // Try to extract video ID from YouTube URL
              const match = video.url.match(/[?&]v=([^&]+)/);
              videoId = match ? match[1] : video.url;
            }

            return {
              id: videoId,
              title: pickBestTrackTitle(video, videoId),
              artist: pickBestArtistName(video),
              duration: video.duration || video.lengthSeconds || 0,
              thumbnail:
                pickBestYouTubeThumbnail(video) ||
                sanitizeImageUrl(video.thumbnail || video.thumbnailUrl || ""),
              views: String(video.views || video.viewCount || 0),
              uploaded:
                video.uploadedDate || video.uploaded || video.published || "",
            };
          });

        if (validVideos.length > 0) {
          console.log(
            `[API] 🟢 YouTube Playlist Success: Found ${validVideos.length} valid videos`,
          );

          // Use first valid video's thumbnail if playlist thumbnail is not available
          if (!playlistThumbnail && validVideos[0].thumbnail) {
            playlistThumbnail = validVideos[0].thumbnail;
          }

          const result = {
            id: playlistId,
            name: playlistName,
            description: playlistDescription,
            thumbnail: playlistThumbnail,
            videos: validVideos,
          };

          console.log(
            `[API] Returning playlist with ${result.videos.length} videos`,
          );
          return result;
        } else {
          console.warn("[API] No valid videos found after filtering");
        }
      } else {
        console.warn("[API] No videos found in any field");
      }

      // If we reach here, we have data but no valid videos
      console.warn("[API] Invalid playlist response format");
      console.warn("[API] Available data keys:", Object.keys(data));
      console.warn(
        "[API] Data structure preview:",
        JSON.stringify(data).substring(0, 500),
      );
      return null;
    } catch (e: any) {
      console.warn(`[API] 🔴 YouTube Playlist Details Error: ${e.message}`);
      return null;
    }
  },

  searchWithPiped: async (
    query: string,
    filter: string,
    page?: number,
    limit?: number,
    nextpage?: string,
  ) => {
    console.log(
      `[API] Searching Piped: "${query}", page: ${page}, nextpage: ${nextpage ? "present" : "none"}`,
    );

    // Enhanced multilingual search - preserve original query but also try transliterated version
    const searchQueries = [query];

    // Check if query contains non-Latin characters and add transliterated version
    if (/[^\u0000-\u007F]/.test(query)) {
      // For now, just use the original query as-is since Piped/YouTube handles multilingual search well
      // In future, we could add transliteration libraries here
      console.log(`[API] Detected non-Latin characters in query: "${query}"`);
    }

    const filterParam = filter === "" ? "all" : filter;

    // Use nextpage endpoint if we have a nextpage token (for pagination)
    let endpoint: string;
    if (nextpage) {
      console.log(
        `[API] Using nextpage endpoint with token: ${nextpage.substring(0, 50)}...`,
      );
      endpoint = `/nextpage/search?nextpage=${encodeURIComponent(nextpage)}`;
    } else {
      // Initial search
      endpoint = `/search?q=${encodeURIComponent(query)}&filter=${filterParam}`;
    }

    const preferredPipedInstances = getPreferredPipedInstances();
    const data = await fetchWithFallbacks(preferredPipedInstances, endpoint);

    // If no results and we have multilingual query, try with relaxed search terms (only for initial search)
    if (
      (!data || !Array.isArray(data.items) || data.items.length === 0) &&
      /[^\u0000-\u007F]/.test(query) &&
      !nextpage
    ) {
      console.log(
        "[API] No results for multilingual query, trying broader search",
      );
      const broadEndpoint = `/search?q=${encodeURIComponent(query)}&filter=all`;
      const broadData = await fetchWithFallbacks(
        preferredPipedInstances,
        broadEndpoint,
      );
      return {
        items:
          broadData && Array.isArray(broadData.items) ? broadData.items : [],
        nextpage: broadData?.nextpage || null,
      };
    }

    // If no results with specific filter (like "channels"), try with "all" filter as fallback (only for initial search)
    if (
      (!data || !Array.isArray(data.items) || data.items.length === 0) &&
      filterParam !== "all" &&
      !nextpage
    ) {
      console.log(
        `[API] No results with filter "${filterParam}", trying with "all" filter`,
      );
      const fallbackEndpoint = `/search?q=${encodeURIComponent(query)}&filter=all`;
      const fallbackData = await fetchWithFallbacks(
        preferredPipedInstances,
        fallbackEndpoint,
      );
      return {
        items:
          fallbackData && Array.isArray(fallbackData.items)
            ? fallbackData.items
            : [],
        nextpage: fallbackData?.nextpage || null,
      };
    }

    // Return both items and nextpage token for proper pagination
    return {
      items: data && Array.isArray(data.items) ? data.items : [],
      nextpage: data?.nextpage || null,
    };
  },

  searchWithInvidious: async (
    query: string,
    sortType: string,
    page?: number,
    limit?: number,
  ) => {
    console.log(`[API] Searching Invidious: "${query}", page: ${page || 1}`);
    const sortParam = sortType === "date" ? "upload_date" : "view_count";
    const pageParam = page && page > 1 ? `&page=${page}` : "";
    const endpoint = `/search?q=${encodeURIComponent(
      query,
    )}&sort_by=${sortParam}${pageParam}`;
    const invidiousInstances =
      DYNAMIC_INVIDIOUS_INSTANCES.length > 0
        ? DYNAMIC_INVIDIOUS_INSTANCES
        : [...API.invidious];
    const data = await fetchWithFallbacks(invidiousInstances, endpoint);
    return Array.isArray(data) ? data : [];
  },

  // --- SOUNDCLOUD SEARCH WITH PROXY API ---
  searchWithSoundCloud: async (
    query: string,
    filter?: string,
    page?: number,
    limit?: number,
  ) => {
    const backendResult = await searchViaBackend({
      query,
      source: "soundcloud",
      filter,
      page,
      limit,
    });
    if (backendResult) {
      return normalizeBackendSearchResults(backendResult.items, "soundcloud");
    }

    try {
      const f = (filter || "").toLowerCase();
      if (f === "playlists" || f === "albums") {
        const type = f === "playlists" ? "playlists" : "albums";
        const collections = await searchAPI.scrapeSoundCloudCollections(
          query,
          type,
          page,
          limit,
        );
        if (!Array.isArray(collections)) {
          return [];
        }
        return collections.map((c: any) => {
          const thumb =
            c.thumbnail ||
            c.artwork ||
            c.artworkUrl ||
            c.image ||
            c.thumbnailUrl ||
            c.img ||
            "";
          return {
            id: c.url || c.id || "",
            title: c.title || c.name || "Unknown",
            author: c.artist || c.author || c.uploader || c.user || "Unknown",
            duration: undefined,
            views: undefined,
            videoCount: c.trackCount || c.tracks || undefined,
            uploaded: undefined,
            thumbnailUrl: thumb,
            img: thumb,
            href: c.url || "",
            source: "soundcloud",
            type: type === "playlists" ? "playlist" : "album",
          };
        });
      }

      const tracks = await searchAPI.scrapeSoundCloudSearch(query, page, limit);
      if (!Array.isArray(tracks)) {
        return [];
      }
      const seenIds = new Set<string>();
      return tracks
        .filter((track) => track && track._isSoundCloud)
        .filter((track) => {
          const trackId = String(track.id);
          if (seenIds.has(trackId)) {
            return false;
          }
          seenIds.add(trackId);
          return true;
        })
        .filter((track) => track.duration && track.duration >= 10000)
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
            type: "song",
          };
        });
    } catch (error) {
      return [];
    }
  },

  searchWithYouTubeMusic: async (
    query: string,
    filter: string,
    page?: number,
    limit?: number,
    nextpage?: string,
  ) => {
    const backendResult = await searchViaBackend({
      query,
      source: "youtubemusic",
      filter,
      page,
      limit,
      nextpage,
    });
    if (backendResult) {
      return {
        items: backendResult.items || [],
        nextpage: backendResult.nextpage ?? null,
      };
    }

    // Map YouTube Music filter names to Piped music filter names
    const musicFilterMap: Record<string, string> = {
      songs: "music_songs",
      videos: "music_videos",
      albums: "music_albums",
      playlists: "music_playlists",
      channels: "music_artists", // UI uses "channels" for artists
      artists: "music_artists",
      all: "music_songs", // Default to songs for "all" in YouTube Music
      "": "music_songs", // Default to songs when no filter is specified
    };

    // Convert the filter to the appropriate YouTube Music filter
    const musicFilter = musicFilterMap[filter] || filter;

    console.log(
      `[API] YouTube Music search: "${query}", filter: "${filter}" -> "${musicFilter}"`,
    );

    let result = await searchAPI.searchWithPiped(
      query,
      musicFilter,
      page,
      limit,
      nextpage,
    );

    if ((!result.items || result.items.length === 0) && !nextpage) {
      const genericFallbackMap: Record<string, string> = {
        songs: "all",
        all: "all",
        "": "all",
        videos: "videos",
        playlists: "playlists",
        channels: "channels",
        artists: "channels",
        albums: "playlists",
      };
      const fallbackFilter = genericFallbackMap[filter] || "all";

      console.log(
        `[API] YouTube Music search empty with "${musicFilter}", retrying with web-style fallback "${fallbackFilter}"`,
      );

      result = await searchAPI.searchYouTubeWithFallback(
        query,
        fallbackFilter,
        page,
        limit,
      );
    }

    return {
      ...result,
      items: Array.isArray(result.items)
        ? filterYouTubeMusicItems(result.items, filter).map((item) => ({
            ...item,
            source: "youtubemusic",
          }))
        : [],
    };
  },

  searchMixed: async (
    query: string,
    filter: string = "all",
    page: number = 1,
    limit: number = 20,
  ) => {
    const backendResult = await searchViaBackend({
      query,
      source: "mixed",
      filter,
      page,
      limit,
    });
    if (backendResult) {
      return normalizeBackendSearchResults(backendResult.items, "mixed").slice(
        0,
        Math.max(limit * 3, 40),
      );
    }

    const normalizedFilter = (filter || "all").toLowerCase();
    const youtubeFilter =
      normalizedFilter === "playlists" ? "playlists" : "all";
    const youtubeMusicFilter =
      normalizedFilter === "playlists" ? "playlists" : "all";
    const soundCloudTasks =
      normalizedFilter === "playlists"
        ? [searchAPI.searchWithSoundCloud(query, "playlists", page, limit)]
        : [
            searchAPI.searchWithSoundCloud(query, "tracks", page, limit),
            searchAPI.searchWithSoundCloud(
              query,
              "playlists",
              page,
              Math.max(8, Math.floor(limit / 2)),
            ),
            searchAPI.searchWithSoundCloud(
              query,
              "albums",
              page,
              Math.max(8, Math.floor(limit / 2)),
            ),
          ];

    const [
      youtubeResult,
      youtubeMusicResult,
      jioSaavnResult,
      ...soundCloudResults
    ] = await Promise.all([
      searchAPI.searchYouTubeWithFallback(query, youtubeFilter, page, limit),
      searchAPI.searchWithYouTubeMusic(query, youtubeMusicFilter, page, limit),
      searchAPI.searchWithJioSaavn(query, normalizedFilter, page, limit),
      ...soundCloudTasks,
    ]);

    const youtubeItems = searchAPI.formatSearchResults(
      (youtubeResult.items || []).map((item) => ({
        ...item,
        source: "youtube" as const,
      })),
    );
    const youtubeMusicItems = searchAPI.formatSearchResults(
      (youtubeMusicResult.items || []).map((item) => ({
        ...item,
        source: "youtubemusic" as const,
      })),
    );
    const soundCloudItems = soundCloudResults as SearchResult[][];
    const jioSaavnItems = jioSaavnResult as SearchResult[];

    return buildMixedSearchResults([
      youtubeItems,
      youtubeMusicItems,
      ...soundCloudItems,
      jioSaavnItems,
    ]).slice(0, Math.max(limit * 3, 40));
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
        // Only classify explicit SoundCloud-shaped results here.
        if (
          item._isSoundCloud ||
          item.source === "soundcloud" ||
          (typeof item.permalink_url === "string" &&
            item.permalink_url.includes("soundcloud.com"))
        ) {
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
        const normalizedSource =
          item.source === "youtubemusic" ? "youtubemusic" : "youtube";

        // Handle different ID types (videos, channels, playlists)
        let id = "";
        if (item.url && item.url.includes("/channel/")) {
          // Channel ID
          id = item.url.split("/channel/")[1] || item.channelId || "";
        } else if (
          item.url &&
          (item.url.includes("/playlist?list=") ||
            item.url.includes("/mix?list="))
        ) {
          // Playlist ID or Mix ID
          id = item.url.split("list=")[1] || item.playlistId || "";
        } else if (isPiped) {
          // Video ID
          id = item.url.split("v=")[1] || "";
        } else {
          // Fallback to videoId
          id = item.videoId || "";
        }
        const thumbnailUrl = pickBestYouTubeThumbnail(item);

        // Determine item type based on available data
        let itemType: "song" | "album" | "artist" | "playlist" | "unknown" =
          "unknown";

        // Channel detection - previous format
        if (
          item.channelId ||
          item.type === "channel" ||
          (item.url && item.url.includes("/channel/"))
        ) {
          itemType = "artist"; // Channel/artist
        } else if (item.type === "album") {
          itemType = "album"; // YouTube Music album result
        } else if (
          item.playlistId ||
          item.type === "playlist" ||
          (item.url &&
            (item.url.includes("/playlist?list=") ||
              item.url.includes("/mix?list=")))
        ) {
          itemType = "playlist"; // Playlist or Mix
        } else if (
          item.duration ||
          item.lengthSeconds ||
          item.videoId ||
          item.type === "video"
        ) {
          itemType = "song"; // Video/song
        }

        // Handle channel/artist items - JioSaavn style format
        if (itemType === "artist") {
          const artistId = extractYouTubeChannelId(item) || id;
          const artistImage = resolveSearchArtistImage(item) || thumbnailUrl;
          const result: SearchResult = {
            id,
            title:
              item.name || item.title || item.uploaderName || "Unknown Channel",
            author: item.uploaderName || item.author || "Unknown Artist",
            artistId,
            artistImage,
            artistSource: normalizedSource,
            duration: String(item.duration || item.lengthSeconds || "0"),
            views: String(item.views || item.viewCount || "0"),
            videoCount: undefined, // Channels don't have video count
            uploaded: fmtTimeAgo(
              Number(item.published || item.uploaded || Date.now()),
            ),
            thumbnailUrl,
            img: thumbnailUrl,
            href:
              item.url ||
              (item.channelId ? `/channel/${id}` : `/channel/${id}`),
            source: normalizedSource,
            type: itemType,
            description: item.description || "", // Add channel description
            verified: item.verified || false, // Add verified badge
          };
          return result;
        }

        // Handle playlist and album items
        if (itemType === "playlist" || itemType === "album") {
          const result: SearchResult = {
            id,
            title:
              item.title ||
              item.name ||
              (itemType === "album" ? "Unknown Album" : "Unknown Playlist"),
            author:
              item.uploaderName ||
              item.author ||
              (itemType === "album" ? "Unknown Artist" : "Unknown Creator"),
            duration: String(item.duration || item.lengthSeconds || "0"),
            views: String(item.views || item.viewCount || "0"),
            videoCount: String(
              item.videoCount && item.videoCount > 0
                ? item.videoCount
                : item.videos && item.videos > 0
                  ? item.videos
                  : "",
            ), // Keep for visual layers but hide badge
            uploaded: fmtTimeAgo(
              Number(item.published || item.uploaded || Date.now()),
            ),
            thumbnailUrl,
            img: thumbnailUrl,
            href:
              item.url ||
              (item.playlistId
                ? `/playlist?list=${id}`
                : `/playlist?list=${id}`),
            source: normalizedSource,
            type: itemType,
          };
          return result;
        }

        // Handle video/song items (default)
        const result: SearchResult = {
          id,
          title: pickBestTrackTitle(item, id),
          author: item.uploaderName || item.author || "Unknown Artist",
          artistId: extractYouTubeChannelId(item) || undefined,
          artistImage: resolveSearchArtistImage(item) || thumbnailUrl,
          artistSource: normalizedSource,
          duration: String(item.duration || item.lengthSeconds || "0"),
          views: String(item.views || item.viewCount || "0"),
          videoCount: undefined,
          uploaded: fmtTimeAgo(
            Number(item.published || item.uploaded || Date.now()),
          ),
          thumbnailUrl,
          img: thumbnailUrl,
          href: item.url || `/watch?v=${id}`,
          source: normalizedSource,
          type: itemType,
        };
        return result;
      })
      .filter((item): item is SearchResult => {
        if (item === null || item.id === "") {
          return false;
        }

        // Filter out items with video count of -2
        if (item.videoCount === "-2") {
          return false;
        }

        return true;
      });
  },

  scrapeSoundCloudSearch: async (
    query: string,
    page?: number,
    limit?: number,
  ) => {
    try {
      const soundCloudSearchProxyBase = getSoundCloudSearchProxyBase();
      if (!soundCloudSearchProxyBase) {
        return [];
      }
      const pageSize = limit && limit > 0 ? limit : 20;
      const offset = page && page > 1 ? (page - 1) * pageSize : 0;
      const url = `${soundCloudSearchProxyBase}/tracks?q=${encodeURIComponent(
        query,
      )}&limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      const collection = Array.isArray(data?.collection) ? data.collection : [];
      return collection
        .filter((item: any) => item && item.kind === "track")
        .map((item: any) => ({
          _isSoundCloud: true,
          kind: "track",
          id: item.id,
          title: item.title,
          duration: item.duration,
          playback_count: item.playback_count,
          created_at: item.created_at,
          permalink_url: item.permalink_url,
          artwork_url: item.artwork_url,
          user: {
            username: item.user?.username,
            avatar_url: item.user?.avatar_url,
          },
        }));
    } catch {
      return [];
    }
  },

  scrapeSoundCloudCollections: async (
    query: string,
    type: "playlists" | "albums",
    page?: number,
    limit?: number,
  ) => {
    try {
      const beatseekApiBase = getBeatseekApiBase();
      const soundCloudSearchProxyBase = getSoundCloudSearchProxyBase();
      if (!soundCloudSearchProxyBase) {
        return [];
      }
      const pageSize = limit && limit > 0 ? limit : 20;
      const offset = page && page > 1 ? (page - 1) * pageSize : 0;
      const parseItems = (data: any) =>
        Array.isArray(data?.results)
          ? data.results
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.collection)
              ? data.collection
              : Array.isArray(data?.data?.results)
                ? data.data.results
                : Array.isArray(data?.data)
                  ? data.data
                  : Array.isArray(data)
                    ? data
                    : [];
      const fetchCollections = async (url: string) => {
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          return [];
        }
        const data = await res.json();
        return parseItems(data);
      };
      const beatseekParams = new URLSearchParams({
        query,
        platform: "soundcloud",
        type,
        sort: "both",
        limit: String(pageSize),
      });
      if (page && page > 1) {
        beatseekParams.set("page", String(page));
      }
      let items =
        beatseekApiBase.length > 0
          ? await fetchCollections(
              `${beatseekApiBase}/search?${beatseekParams.toString()}`,
            )
          : [];
      const baseUrl = `${soundCloudSearchProxyBase}/${type}`;
      if (items.length === 0) {
        items = await fetchCollections(
          `${baseUrl}?q=${encodeURIComponent(query)}&limit=${pageSize}&offset=${offset}`,
        );
      }
      if (items.length === 0) {
        items = await fetchCollections(
          `${baseUrl}?query=${encodeURIComponent(query)}&limit=${pageSize}&offset=${offset}`,
        );
      }
      return items.map((item: any) => ({
        url: item.permalink_url || item.url || item.permalink || "",
        title: item.title || item.name || "",
        artist: item.artist || item.user?.username || "",
        author:
          item.author ||
          item.artist ||
          item.uploader ||
          item.user?.username ||
          item.creator ||
          "",
        artwork:
          item.artwork_url ||
          item.artwork ||
          item.artworkUrl ||
          item.thumbnail ||
          item.image ||
          item.cover ||
          item.img ||
          item.user?.avatar_url ||
          "",
        trackCount:
          item.track_count ||
          item.trackCount ||
          item.tracksCount ||
          item.tracks?.length ||
          undefined,
      }));
    } catch {
      return [];
    }
  },

  // --- YOUTUBE FALLBACK FUNCTIONS ---

  /**
   * Fallback YouTube search using both Piped and Invidious instances
   * Tries Piped first, then falls back to Invidious if Piped fails
   */
  searchYouTubeWithFallback: async (
    query: string,
    filter: string = "all",
    page?: number,
    limit?: number,
    nextpage?: string,
  ) => {
    console.log(
      `[API] YouTube fallback search: "${query}", filter: "${filter}"`,
    );

    const backendResult = await searchViaBackend({
      query,
      source: "youtube",
      filter,
      page,
      limit,
      nextpage,
    });
    if (backendResult) {
      return {
        items: backendResult.items || [],
        nextpage: backendResult.nextpage ?? null,
      };
    }

    // Try Piped first
    try {
      console.log(`[API] Attempting Piped search with filter: "${filter}"...`);
      const pipedResults = await searchAPI.searchWithPiped(
        query,
        filter,
        page,
        limit,
        nextpage,
      );
      if (
        pipedResults &&
        Array.isArray(pipedResults.items) &&
        pipedResults.items.length > 0
      ) {
        console.log(
          `[API] Piped search successful, found ${pipedResults.items.length} results`,
        );
        return pipedResults;
      }
      console.log(
        `[API] Piped search returned ${pipedResults?.items?.length || 0} results, trying Invidious...`,
      );
    } catch (error) {
      console.log("[API] ❌ Piped search failed:", error.message);
      console.log("[API] Trying Invidious search...");
    }

    // Fallback to Invidious
    try {
      // Map filter to Invidious sort parameter
      const invidiousSort =
        filter === "date"
          ? "upload_date"
          : filter === "views"
            ? "view_count"
            : "relevance";
      const invidiousResults = await searchAPI.searchWithInvidious(
        query,
        invidiousSort,
        page,
        limit,
      );
      if (invidiousResults && invidiousResults.length > 0) {
        console.log(
          `[API] Invidious search successful, found ${invidiousResults.length} results`,
        );
        return {
          items: invidiousResults,
          nextpage: null,
        };
      }
      console.log("[API] Invidious search also returned no results");
    } catch (error) {
      console.log("[API] Invidious search also failed:", error.message);
    }

    console.log("[API] Both Piped and Invidious searches failed");
    return {
      items: [],
      nextpage: null,
    };
  },

  /**
   * Fallback YouTube video info/playback using both Piped and Invidious instances
   * Tries Piped first, then falls back to Invidious if Piped fails
   */
  getYouTubeVideoInfoWithFallback: async (videoId: string) => {
    console.log(`[API] YouTube fallback video info: "${videoId}"`);

    // Use the centralized fallback function
    try {
      const result = await fetchStreamFromPipedWithFallback(videoId);
      console.log("[API] Piped video info successful");
      return {
        success: true,
        source: "piped",
        data: result,
      };
    } catch (pipedError) {
      console.log("[API] Piped video info failed, trying Invidious...");

      try {
        const result = await fetchStreamFromInvidiousWithFallback(videoId);
        console.log("[API] Invidious video info successful");
        return {
          success: true,
          source: "invidious",
          data: result,
        };
      } catch (invidiousError) {
        console.log("[API] Both Piped and Invidious video info failed");
        return {
          success: false,
          source: null,
          data: null,
        };
      }
    }
  },
};
