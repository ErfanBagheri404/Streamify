import {
  getCachedRuntimeConfigSnapshot,
  getRuntimeConfig,
  type StreamifyRuntimeConfig,
} from "./runtime-config";

export type SearchCategoryPlaylist = {
  category: string;
  imageFileName: string;
  playlistTitle: string;
  playlistUrl?: string;
  playlistId?: string;
  source?: "youtube" | "youtubemusic" | "soundcloud";
};

const VALID_SOURCES = new Set(["youtube", "youtubemusic", "soundcloud"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(
  source: Record<string, unknown> | null,
  key: string
): string {
  const value = source?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCategoryPlaylist(
  value: unknown
): SearchCategoryPlaylist | null {
  const item = asRecord(value);
  const category = readString(item, "category");
  const imageFileName = readString(item, "imageFileName");
  const playlistTitle = readString(item, "playlistTitle");
  const playlistUrl = readString(item, "playlistUrl");
  const playlistId = readString(item, "playlistId");
  const source = readString(item, "source");

  if (!category || !imageFileName || !playlistTitle) {
    return null;
  }

  const normalizedSource = VALID_SOURCES.has(source) ? source : "youtube";

  return {
    category,
    imageFileName,
    playlistTitle,
    playlistUrl: playlistUrl || undefined,
    playlistId: playlistId || undefined,
    source: normalizedSource as SearchCategoryPlaylist["source"],
  };
}

function normalizeCategoryPlaylists(
  runtimeConfig: StreamifyRuntimeConfig | null
): SearchCategoryPlaylist[] {
  const curated = asRecord(runtimeConfig?.curated);
  const rawPlaylists = curated?.categoryPlaylists;

  if (!Array.isArray(rawPlaylists)) {
    return [];
  }

  return rawPlaylists
    .map((item) => normalizeCategoryPlaylist(item))
    .filter((item): item is SearchCategoryPlaylist => Boolean(item));
}

export async function getCachedSearchCategoryPlaylistsSnapshot() {
  return normalizeCategoryPlaylists(await getCachedRuntimeConfigSnapshot());
}

export async function getSearchCategoryPlaylists(options?: {
  revalidate?: boolean;
}) {
  try {
    return normalizeCategoryPlaylists(await getRuntimeConfig(options));
  } catch {
    return getCachedSearchCategoryPlaylistsSnapshot();
  }
}

export function getSearchCategoryPlaylistId(
  playlist: SearchCategoryPlaylist
): string {
  const source = playlist.source || "youtube";

  if (source === "soundcloud") {
    return playlist.playlistId?.trim() || playlist.playlistUrl?.trim() || "";
  }

  return playlist.playlistId?.trim() || "";
}
