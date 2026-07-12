import AsyncStorage from "@react-native-async-storage/async-storage";
import { DeviceEventEmitter } from "react-native";
import { Track } from "../contexts/PlayerContext";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  LAST_SEARCH_STATE_KEY,
  type AppSettings,
  sanitizeAppSettings,
} from "../lib/app-settings";

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  tracks: Track[];
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
}

const LIKED_SONGS_KEY = "@liked_songs";
const PREVIOUSLY_PLAYED_KEY = "@previously_played_songs";
const PLAYLISTS_KEY = "@playlists";
const SONG_METADATA_CACHE_KEY = "@library_song_metadata_cache";
export const LIBRARY_UPDATED_EVENT = "streamify-library-updated";

export interface SearchState {
  query: string;
  source: string;
  filter: string;
  results?: unknown[];
}

function emitLibraryUpdated() {
  DeviceEventEmitter.emit(LIBRARY_UPDATED_EVENT);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTrackSource(track: Partial<Track>): string {
  const source = normalizeString(track.source).toLowerCase();
  if (source) {
    return source;
  }
  if (track._isJioSaavn) {
    return "jiosaavn";
  }
  if (track._isSoundCloud) {
    return "soundcloud";
  }
  return "youtube";
}

function getTrackStorageKey(track: Partial<Track>): string {
  return `${normalizeTrackSource(track)}:${normalizeString(track.id)}`;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function chooseNonEmptyString(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function sanitizeStoredAudioUrl(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  if (
    normalized.startsWith("file://") ||
    normalized.startsWith("content://")
  ) {
    return normalized;
  }
  return undefined;
}

function chooseTrackTitle(
  primary: Partial<Track>,
  secondary?: Partial<Track> | null
): string {
  const candidates = [
    normalizeString(primary.title),
    normalizeString(secondary?.title),
    normalizeString(primary.id),
    normalizeString(secondary?.id),
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      candidate.toLowerCase() !== "unknown track" &&
      candidate !== normalizeString(primary.id) &&
      candidate !== normalizeString(secondary?.id)
    ) {
      return candidate;
    }
  }

  return (
    normalizeString(primary.id) ||
    normalizeString(secondary?.id) ||
    "Unknown Track"
  );
}

function chooseTrackArtist(
  primary: Partial<Track>,
  secondary?: Partial<Track> | null
): string {
  const primarySource = normalizeTrackSource(primary);
  const secondarySource = secondary ? normalizeTrackSource(secondary) : "";
  const candidates = [
    normalizeString(primary.artist),
    normalizeString(secondary?.artist),
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();
    if (
      candidate &&
      normalizedCandidate !== "unknown artist" &&
      normalizedCandidate !== primarySource &&
      normalizedCandidate !== secondarySource
    ) {
      return candidate;
    }
  }

  return primarySource || secondarySource || "Unknown Artist";
}

function normalizeTrackSnapshot(track: Partial<Track>): Track | null {
  const id = normalizeString(track.id);
  if (!id) {
    return null;
  }

  const source = normalizeTrackSource(track);

  return {
    id,
    title: chooseTrackTitle(track),
    artist: chooseTrackArtist(track),
    artistId: chooseNonEmptyString(track.artistId),
    artistImage: chooseNonEmptyString(track.artistImage),
    artistSource: chooseNonEmptyString(track.artistSource),
    duration: normalizeNumber(track.duration),
    thumbnail: chooseNonEmptyString(track.thumbnail),
    audioUrl: sanitizeStoredAudioUrl(track.audioUrl),
    url: chooseNonEmptyString(track.url),
    source,
    _isSoundCloud: source === "soundcloud" ? true : undefined,
    _isJioSaavn: source === "jiosaavn" ? true : undefined,
  };
}

function mergeTrackSnapshots(
  primary: Partial<Track>,
  secondary?: Partial<Track> | null
): Track | null {
  const primaryTrack = normalizeTrackSnapshot(primary);
  const secondaryTrack = secondary ? normalizeTrackSnapshot(secondary) : null;

  if (!primaryTrack && !secondaryTrack) {
    return null;
  }

  const winner = primaryTrack || secondaryTrack!;
  const source = normalizeTrackSource(primaryTrack || secondaryTrack!);

  return {
    id: chooseNonEmptyString(primaryTrack?.id, secondaryTrack?.id) || "",
    title: chooseTrackTitle(primaryTrack || winner, secondaryTrack),
    artist: chooseTrackArtist(primaryTrack || winner, secondaryTrack),
    artistId: chooseNonEmptyString(
      primaryTrack?.artistId,
      secondaryTrack?.artistId
    ),
    artistImage: chooseNonEmptyString(
      primaryTrack?.artistImage,
      secondaryTrack?.artistImage
    ),
    artistSource: chooseNonEmptyString(
      primaryTrack?.artistSource,
      secondaryTrack?.artistSource
    ),
    duration:
      normalizeNumber(primaryTrack?.duration) ??
      normalizeNumber(secondaryTrack?.duration),
    thumbnail: chooseNonEmptyString(
      primaryTrack?.thumbnail,
      secondaryTrack?.thumbnail
    ),
    audioUrl: chooseNonEmptyString(
      primaryTrack?.audioUrl,
      secondaryTrack?.audioUrl
    ),
    url: chooseNonEmptyString(primaryTrack?.url, secondaryTrack?.url),
    source,
    _isSoundCloud: source === "soundcloud" ? true : undefined,
    _isJioSaavn: source === "jiosaavn" ? true : undefined,
  };
}

function mergeTrackLists(
  primaryTracks: Track[],
  secondaryTracks: Track[]
): Track[] {
  const secondaryByKey = new Map<string, Track>();
  for (const track of secondaryTracks) {
    const normalized = normalizeTrackSnapshot(track);
    if (!normalized) {
      continue;
    }
    secondaryByKey.set(getTrackStorageKey(normalized), normalized);
  }

  const merged: Track[] = [];
  const seen = new Set<string>();

  for (const track of primaryTracks) {
    const normalized = normalizeTrackSnapshot(track);
    if (!normalized) {
      continue;
    }
    const key = getTrackStorageKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const mergedTrack = mergeTrackSnapshots(
      normalized,
      secondaryByKey.get(key)
    );
    if (mergedTrack) {
      merged.push(mergedTrack);
    }
    secondaryByKey.delete(key);
  }

  for (const track of secondaryByKey.values()) {
    const key = getTrackStorageKey(track);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(track);
  }

  return merged;
}

function normalizePlaylistSnapshot(playlist: Playlist): Playlist | null {
  const id = normalizeString(playlist?.id);
  const name = normalizeString(playlist?.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: normalizeString(playlist.description),
    tracks: mergeTrackLists(
      Array.isArray(playlist.tracks) ? playlist.tracks : [],
      []
    ),
    createdAt: normalizeString(playlist.createdAt) || new Date().toISOString(),
    updatedAt: normalizeString(playlist.updatedAt) || new Date().toISOString(),
    thumbnail:
      chooseNonEmptyString(
        playlist.thumbnail,
        Array.isArray(playlist.tracks)
          ? playlist.tracks[0]?.thumbnail
          : undefined
      ) || undefined,
  };
}

export function subscribeToLibraryUpdates(listener: () => void) {
  const subscription = DeviceEventEmitter.addListener(
    LIBRARY_UPDATED_EVENT,
    listener
  );
  return () => {
    const removableSubscription = subscription as unknown as
      | { remove?: () => void }
      | undefined;
    removableSubscription?.remove?.();
  };
}

export const StorageService = {
  async loadSongMetadataCache(): Promise<Record<string, Track>> {
    try {
      const raw = await AsyncStorage.getItem(SONG_METADATA_CACHE_KEY);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw) as Record<string, Partial<Track>>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      const normalizedEntries = Object.entries(parsed)
        .map(([key, value]) => {
          const normalized = normalizeTrackSnapshot(value);
          return normalized ? ([key, normalized] as const) : null;
        })
        .filter((entry): entry is readonly [string, Track] => Boolean(entry));

      return Object.fromEntries(normalizedEntries);
    } catch (error) {
      console.error("Error loading song metadata cache:", error);
      return {};
    }
  },

  async saveSongMetadataCache(cache: Record<string, Track>): Promise<void> {
    try {
      await AsyncStorage.setItem(
        SONG_METADATA_CACHE_KEY,
        JSON.stringify(cache)
      );
    } catch (error) {
      console.error("Error saving song metadata cache:", error);
      throw error;
    }
  },

  async updateSongMetadataCache(tracks: Track[]): Promise<void> {
    if (!tracks.length) {
      return;
    }

    try {
      const cache = await this.loadSongMetadataCache();
      for (const track of tracks) {
        const normalized = normalizeTrackSnapshot(track);
        if (!normalized) {
          continue;
        }
        cache[getTrackStorageKey(normalized)] = normalized;
      }
      await this.saveSongMetadataCache(cache);
    } catch (error) {
      console.error("Error updating song metadata cache:", error);
      throw error;
    }
  },

  async loadKnownLibraryTracks(): Promise<Track[]> {
    try {
      const [cache, likedSongs, previouslyPlayedSongs, playlists] =
        await Promise.all([
          this.loadSongMetadataCache(),
          this.loadLikedSongs(),
          this.loadPreviouslyPlayedSongs(),
          this.loadPlaylists(),
        ]);

      return mergeTrackLists(
        [
          ...Object.values(cache),
          ...likedSongs,
          ...previouslyPlayedSongs,
          ...playlists.flatMap((playlist) => playlist.tracks || []),
        ],
        []
      );
    } catch (error) {
      console.error("Error loading known library tracks:", error);
      return [];
    }
  },

  // Save liked songs to storage
  async saveLikedSongs(songs: Track[]): Promise<void> {
    try {
      const normalizedSongs = mergeTrackLists(songs, []);
      const jsonValue = JSON.stringify(normalizedSongs);
      await AsyncStorage.setItem(LIKED_SONGS_KEY, jsonValue);
      await this.updateSongMetadataCache(normalizedSongs);
      emitLibraryUpdated();
    } catch (error) {
      console.error("Error saving liked songs:", error);
      throw error;
    }
  },

  // Load liked songs from storage
  async loadLikedSongs(): Promise<Track[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(LIKED_SONGS_KEY);
      const parsed =
        jsonValue != null ? (JSON.parse(jsonValue) as Track[]) : [];
      const metadataCache = await this.loadSongMetadataCache();
      return mergeTrackLists(
        Array.isArray(parsed) ? parsed : [],
        Array.isArray(parsed)
          ? parsed
              .map((track) => metadataCache[getTrackStorageKey(track)])
              .filter((track): track is Track => Boolean(track))
          : []
      );
    } catch (error) {
      console.error("Error loading liked songs:", error);
      return [];
    }
  },

  // Clear liked songs
  async clearLikedSongs(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LIKED_SONGS_KEY);
    } catch (error) {
      console.error("Error clearing liked songs:", error);
      throw error;
    }
  },

  // Add a single liked song
  async addLikedSong(song: Track): Promise<void> {
    try {
      const likedSongs = await this.loadLikedSongs();
      const updatedSongs = [...likedSongs, song];
      await this.saveLikedSongs(updatedSongs);
    } catch (error) {
      console.error("Error adding liked song:", error);
      throw error;
    }
  },

  // Remove a liked song
  async removeLikedSong(songId: string): Promise<void> {
    try {
      const likedSongs = await this.loadLikedSongs();
      const updatedSongs = likedSongs.filter((song) => song.id !== songId);
      await this.saveLikedSongs(updatedSongs);
    } catch (error) {
      console.error("Error removing liked song:", error);
      throw error;
    }
  },

  // Save previously played songs to storage
  async savePreviouslyPlayedSongs(songs: Track[]): Promise<void> {
    try {
      const normalizedSongs = mergeTrackLists(songs, []);
      const jsonValue = JSON.stringify(normalizedSongs);
      await AsyncStorage.setItem(PREVIOUSLY_PLAYED_KEY, jsonValue);
      await this.updateSongMetadataCache(normalizedSongs);
      emitLibraryUpdated();
    } catch (error) {
      console.error("Error saving previously played songs:", error);
      throw error;
    }
  },

  // Load previously played songs from storage
  async loadPreviouslyPlayedSongs(): Promise<Track[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(PREVIOUSLY_PLAYED_KEY);
      const parsed =
        jsonValue != null ? (JSON.parse(jsonValue) as Track[]) : [];
      const metadataCache = await this.loadSongMetadataCache();
      return mergeTrackLists(
        Array.isArray(parsed) ? parsed : [],
        Array.isArray(parsed)
          ? parsed
              .map((track) => metadataCache[getTrackStorageKey(track)])
              .filter((track): track is Track => Boolean(track))
          : []
      );
    } catch (error) {
      console.error("Error loading previously played songs:", error);
      return [];
    }
  },

  // Clear previously played songs
  async clearPreviouslyPlayedSongs(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PREVIOUSLY_PLAYED_KEY);
    } catch (error) {
      console.error("Error clearing previously played songs:", error);
      throw error;
    }
  },

  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error("Error getting item from storage:", error);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error("Error setting item in storage:", error);
      throw error;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error("Error removing item from storage:", error);
      throw error;
    }
  },

  async loadAppSettings(): Promise<AppSettings> {
    try {
      const jsonValue = await AsyncStorage.getItem(APP_SETTINGS_STORAGE_KEY);
      return jsonValue != null
        ? sanitizeAppSettings(JSON.parse(jsonValue))
        : DEFAULT_APP_SETTINGS;
    } catch (error) {
      console.error("Error loading app settings:", error);
      return DEFAULT_APP_SETTINGS;
    }
  },

  async saveAppSettings(settings: AppSettings): Promise<void> {
    try {
      await AsyncStorage.setItem(
        APP_SETTINGS_STORAGE_KEY,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.error("Error saving app settings:", error);
      throw error;
    }
  },

  async loadLastSearchState(): Promise<SearchState | null> {
    try {
      const jsonValue = await AsyncStorage.getItem(LAST_SEARCH_STATE_KEY);
      if (!jsonValue) {
        return null;
      }

      const parsed = JSON.parse(jsonValue) as Partial<SearchState>;
      if (
        typeof parsed?.query !== "string" ||
        typeof parsed?.source !== "string" ||
        typeof parsed?.filter !== "string"
      ) {
        return null;
      }

      return {
        query: parsed.query,
        source: parsed.source,
        filter: parsed.filter,
        results: Array.isArray(parsed.results) ? parsed.results : undefined,
      };
    } catch (error) {
      console.error("Error loading last search state:", error);
      return null;
    }
  },

  async saveLastSearchState(searchState: SearchState): Promise<void> {
    try {
      const normalizedSearchState: SearchState = {
        query: searchState.query,
        source: searchState.source,
        filter: searchState.filter,
        results: Array.isArray(searchState.results)
          ? searchState.results.slice(0, 100)
          : undefined,
      };
      await AsyncStorage.setItem(
        LAST_SEARCH_STATE_KEY,
        JSON.stringify(normalizedSearchState)
      );
    } catch (error) {
      console.error("Error saving last search state:", error);
      throw error;
    }
  },

  async clearLastSearchState(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LAST_SEARCH_STATE_KEY);
    } catch (error) {
      console.error("Error clearing last search state:", error);
      throw error;
    }
  },

  // Save playlists to storage
  async savePlaylists(playlists: Playlist[]): Promise<void> {
    try {
      const normalizedPlaylists = playlists
        .map((playlist) => normalizePlaylistSnapshot(playlist))
        .filter((playlist): playlist is Playlist => Boolean(playlist));
      const jsonValue = JSON.stringify(normalizedPlaylists);
      await AsyncStorage.setItem(PLAYLISTS_KEY, jsonValue);
      await this.updateSongMetadataCache(
        normalizedPlaylists.flatMap((playlist) => playlist.tracks || [])
      );
      emitLibraryUpdated();
    } catch (error) {
      console.error("Error saving playlists:", error);
      throw error;
    }
  },

  // Load playlists from storage
  async loadPlaylists(): Promise<Playlist[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(PLAYLISTS_KEY);
      const parsed =
        jsonValue != null ? (JSON.parse(jsonValue) as Playlist[]) : [];
      const metadataCache = await this.loadSongMetadataCache();

      return (Array.isArray(parsed) ? parsed : [])
        .map((playlist) => normalizePlaylistSnapshot(playlist))
        .filter((playlist): playlist is Playlist => Boolean(playlist))
        .map((playlist) => ({
          ...playlist,
          tracks: mergeTrackLists(
            playlist.tracks || [],
            (playlist.tracks || [])
              .map((track) => metadataCache[getTrackStorageKey(track)])
              .filter((track): track is Track => Boolean(track))
          ),
        }));
    } catch (error) {
      console.error("Error loading playlists:", error);
      return [];
    }
  },

  // Add a new playlist
  async addPlaylist(playlist: Playlist): Promise<void> {
    try {
      const playlists = await this.loadPlaylists();
      const updatedPlaylists = [...playlists, playlist];
      await this.savePlaylists(updatedPlaylists);
    } catch (error) {
      console.error("Error adding playlist:", error);
      throw error;
    }
  },

  // Delete a playlist by ID
  async deletePlaylist(playlistId: string): Promise<void> {
    try {
      const playlists = await this.loadPlaylists();
      const updatedPlaylists = playlists.filter((p) => p.id !== playlistId);
      await this.savePlaylists(updatedPlaylists);
    } catch (error) {
      console.error("Error deleting playlist:", error);
      throw error;
    }
  },

  // Update a playlist
  async updatePlaylist(playlist: Playlist): Promise<void> {
    try {
      const playlists = await this.loadPlaylists();
      const index = playlists.findIndex((p) => p.id === playlist.id);
      if (index !== -1) {
        playlists[index] = playlist;
        await this.savePlaylists(playlists);
      }
    } catch (error) {
      console.error("Error updating playlist:", error);
      throw error;
    }
  },
};
