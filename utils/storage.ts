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
import {
  podcastShowId,
  type PodcastEpisode,
  type PodcastShow,
} from "../modules/podcastFeed";

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
  if (normalized.startsWith("file://") || normalized.startsWith("content://")) {
    return normalized;
  }
  return undefined;
}

function chooseTrackTitle(
  primary: Partial<Track>,
  secondary?: Partial<Track> | null,
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
  secondary?: Partial<Track> | null,
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
  secondary?: Partial<Track> | null,
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
      secondaryTrack?.artistId,
    ),
    artistImage: chooseNonEmptyString(
      primaryTrack?.artistImage,
      secondaryTrack?.artistImage,
    ),
    artistSource: chooseNonEmptyString(
      primaryTrack?.artistSource,
      secondaryTrack?.artistSource,
    ),
    duration:
      normalizeNumber(primaryTrack?.duration) ??
      normalizeNumber(secondaryTrack?.duration),
    thumbnail: chooseNonEmptyString(
      primaryTrack?.thumbnail,
      secondaryTrack?.thumbnail,
    ),
    audioUrl: chooseNonEmptyString(
      primaryTrack?.audioUrl,
      secondaryTrack?.audioUrl,
    ),
    url: chooseNonEmptyString(primaryTrack?.url, secondaryTrack?.url),
    source,
    _isSoundCloud: source === "soundcloud" ? true : undefined,
    _isJioSaavn: source === "jiosaavn" ? true : undefined,
  };
}

function mergeTrackLists(
  primaryTracks: Track[],
  secondaryTracks: Track[],
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
      secondaryByKey.get(key),
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
      [],
    ),
    createdAt: normalizeString(playlist.createdAt) || new Date().toISOString(),
    updatedAt: normalizeString(playlist.updatedAt) || new Date().toISOString(),
    thumbnail:
      chooseNonEmptyString(
        playlist.thumbnail,
        Array.isArray(playlist.tracks)
          ? playlist.tracks[0]?.thumbnail
          : undefined,
      ) || undefined,
  };
}

export function subscribeToLibraryUpdates(listener: () => void) {
  const subscription = DeviceEventEmitter.addListener(
    LIBRARY_UPDATED_EVENT,
    listener,
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
        JSON.stringify(cache),
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
        [],
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
          : [],
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
          : [],
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
        JSON.stringify(settings),
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
        JSON.stringify(normalizedSearchState),
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
        normalizedPlaylists.flatMap((playlist) => playlist.tracks || []),
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
              .filter((track): track is Track => Boolean(track)),
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

  // Reorder tracks within a playlist (drag-and-drop support)
  async reorderPlaylistTracks(
    playlistId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<void> {
    try {
      const playlists = await this.loadPlaylists();
      const index = playlists.findIndex((p) => p.id === playlistId);
      if (index === -1) return;

      const playlist = playlists[index];
      const tracks = [...(playlist.tracks || [])];
      if (
        fromIndex < 0 ||
        fromIndex >= tracks.length ||
        toIndex < 0 ||
        toIndex >= tracks.length ||
        fromIndex === toIndex
      ) {
        return;
      }

      const [moved] = tracks.splice(fromIndex, 1);
      tracks.splice(toIndex, 0, moved);

      playlists[index] = {
        ...playlist,
        tracks,
        updatedAt: new Date().toISOString(),
      };
      await this.savePlaylists(playlists);
      emitLibraryUpdated();
    } catch (error) {
      console.error("Error reordering playlist tracks:", error);
      throw error;
    }
  },

  // Add a song to a playlist (deduplicated by storage key)
  async addSongToPlaylist(
    playlistId: string,
    track: Track,
    avoidDuplicate = true,
  ): Promise<boolean> {
    try {
      const playlists = await this.loadPlaylists();
      const index = playlists.findIndex((p) => p.id === playlistId);
      if (index === -1) return false;

      const playlist = playlists[index];
      const tracks = [...(playlist.tracks || [])];

      if (avoidDuplicate) {
        const key = getTrackStorageKey(track);
        const exists = tracks.some((t) => getTrackStorageKey(t) === key);
        if (exists) return false;
      }

      tracks.push(track);
      playlists[index] = {
        ...playlist,
        tracks,
        thumbnail: playlist.thumbnail || track.thumbnail,
        updatedAt: new Date().toISOString(),
      };
      await this.savePlaylists(playlists);
      emitLibraryUpdated();
      return true;
    } catch (error) {
      console.error("Error adding song to playlist:", error);
      throw error;
    }
  },
};

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
const ONBOARDING_COMPLETED_KEY = "@streamify_onboarding_completed";

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

export async function markOnboardingCompleted(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
  } catch {
    // silent
  }
}

// ---------------------------------------------------------------------------
// Podcast subscriptions (#30)
// ---------------------------------------------------------------------------
const PODCAST_SHOWS_KEY = "@podcast_shows";
const PODCAST_EPISODES_KEY = "@podcast_episodes";
const PODCAST_POSITIONS_KEY = "@podcast_episode_positions";

/**
 * Normalizes a persisted show. A feed can disappear between refreshes, so
 * every field is re-derived rather than trusted.
 */
function normalizePodcastShow(raw: unknown): PodcastShow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const feedUrl = normalizeString(record.feedUrl);
  if (!feedUrl) return null;
  const title = normalizeString(record.title);
  return {
    id: normalizeString(record.id) || podcastShowId(feedUrl),
    feedUrl,
    // A feed that lost its <title> is still subscribable; show the URL.
    title: title || feedUrl,
    author: normalizeString(record.author) || undefined,
    description: normalizeString(record.description) || undefined,
    artworkUrl: normalizeString(record.artworkUrl) || undefined,
    lastFetchedAt:
      typeof record.lastFetchedAt === "number" ? record.lastFetchedAt : undefined,
    unplayedCount:
      typeof record.unplayedCount === "number" && record.unplayedCount >= 0
        ? record.unplayedCount
        : undefined,
  };
}

function normalizePodcastEpisode(raw: unknown): PodcastEpisode | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = normalizeString(record.id);
  const showId = normalizeString(record.showId);
  const audioUrl = normalizeString(record.audioUrl);
  // Without an id or a media URL the episode is unplayable and unidentifiable.
  if (!id || !showId || !audioUrl) return null;
  return {
    id,
    showId,
    title: normalizeString(record.title) || audioUrl,
    audioUrl,
    publishedAt:
      typeof record.publishedAt === "number" ? record.publishedAt : undefined,
    durationSeconds:
      typeof record.durationSeconds === "number" && record.durationSeconds > 0
        ? record.durationSeconds
        : undefined,
    artworkUrl: normalizeString(record.artworkUrl) || undefined,
    description: normalizeString(record.description) || undefined,
    positionSeconds:
      typeof record.positionSeconds === "number" && record.positionSeconds > 0
        ? record.positionSeconds
        : undefined,
    played: record.played === true,
  };
}

export async function loadPodcastShows(): Promise<PodcastShow[]> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_SHOWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePodcastShow)
      .filter((show): show is PodcastShow => show !== null);
  } catch {
    return [];
  }
}

export async function loadPodcastEpisodes(): Promise<PodcastEpisode[]> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_EPISODES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePodcastEpisode)
      .filter((episode): episode is PodcastEpisode => episode !== null);
  } catch {
    return [];
  }
}

export async function loadPodcastPositions(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(PODCAST_POSITIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        result[id] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Subscribe to a feed, replacing any previous snapshot of its episodes.
 * `feed` is the already-parsed result of `parsePodcastFeed`, so this stays
 * storage-only and testable without the network.
 */
export async function subscribeToPodcast(
  feed: { show: PodcastShow; episodes: PodcastEpisode[] },
): Promise<PodcastShow[]> {
  const shows = await loadPodcastShows();
  const episodes = await loadPodcastEpisodes();
  const positions = await loadPodcastPositions();

  const nextShow: PodcastShow = {
    ...feed.show,
    lastFetchedAt: Date.now(),
    unplayedCount: feed.episodes.length,
  };

  const nextShows = [
    ...shows.filter((show) => show.id !== nextShow.id),
    nextShow,
  ];

  // Drop old episodes of this show, but carry their resume points forward:
  // a re-fetch that re-lists an episode must not lose where the user stopped.
  const kept = episodes.filter((episode) => episode.showId !== nextShow.id);
  const nextEpisodes = [
    ...kept,
    ...feed.episodes.map((episode) => {
      const positionSeconds = positions[episode.id] ?? episode.positionSeconds;
      return {
        ...episode,
        positionSeconds,
        played: positionSeconds !== undefined,
      };
    }),
  ];

  const nextPositions: Record<string, number> = {};
  for (const episode of nextEpisodes) {
    if (episode.positionSeconds) nextPositions[episode.id] = episode.positionSeconds;
  }

  await AsyncStorage.setItem(PODCAST_SHOWS_KEY, JSON.stringify(nextShows));
  await AsyncStorage.setItem(PODCAST_EPISODES_KEY, JSON.stringify(nextEpisodes));
  await AsyncStorage.setItem(PODCAST_POSITIONS_KEY, JSON.stringify(nextPositions));
  emitLibraryUpdated();
  return nextShows;
}

/**
 * Persist a resume point. Writing the episode and a compact position map
 * together is what lets a cold start restore without re-reading the feed.
 */
export async function savePodcastEpisodePosition(
  episodeId: string,
  positionSeconds: number,
): Promise<void> {
  if (!episodeId || !Number.isFinite(positionSeconds) || positionSeconds < 0) return;
  const safe = Math.max(0, Math.floor(positionSeconds));
  const positions = await loadPodcastPositions();
  positions[episodeId] = safe;

  const episodes = await loadPodcastEpisodes();
  const index = episodes.findIndex((episode) => episode.id === episodeId);
  if (index !== -1) {
    // 95% counts as finished: a podcast is not worth resuming from the end.
    const played = durationOf(episodes[index]) * 0.95 > 0
      ? safe >= durationOf(episodes[index]) * 0.95
      : false;
    episodes[index] = { ...episodes[index], positionSeconds: safe, played };
    await AsyncStorage.setItem(PODCAST_EPISODES_KEY, JSON.stringify(episodes));
  }
  await AsyncStorage.setItem(PODCAST_POSITIONS_KEY, JSON.stringify(positions));
}

/**
 * Mark an episode finished. A separate entry point rather than a sentinel
 * position: "played to the end" and "stopped at 40%" are different states,
 * and -1 would have to be special-cased in every reader.
 */
export async function markPodcastEpisodeFinished(episodeId: string): Promise<void> {
  if (!episodeId) return;
  const episodes = await loadPodcastEpisodes();
  const index = episodes.findIndex((episode) => episode.id === episodeId);
  if (index === -1) return;
  const duration = durationOf(episodes[index]);
  episodes[index] = {
    ...episodes[index],
    played: true,
    // Keep the position at the end so a manual replay starts from the top.
    positionSeconds: duration || episodes[index].positionSeconds,
  };
  await AsyncStorage.setItem(PODCAST_EPISODES_KEY, JSON.stringify(episodes));

  const positions = await loadPodcastPositions();
  if (episodes[index].positionSeconds) {
    positions[episodeId] = episodes[index].positionSeconds as number;
    await AsyncStorage.setItem(PODCAST_POSITIONS_KEY, JSON.stringify(positions));
  }
}

const durationOf = (episode: PodcastEpisode): number => episode.durationSeconds ?? 0;

export async function unsubscribeFromPodcast(showId: string): Promise<PodcastShow[]> {
  const shows = await loadPodcastShows();
  const nextShows = shows.filter((show) => show.id !== showId);
  if (nextShows.length === shows.length) return shows;

  const episodes = await loadPodcastEpisodes();
  const removedIds = new Set(
    episodes.filter((episode) => episode.showId === showId).map((episode) => episode.id),
  );
  const nextEpisodes = episodes.filter((episode) => episode.showId !== showId);
  const positions = await loadPodcastPositions();
  for (const id of removedIds) delete positions[id];

  await AsyncStorage.setItem(PODCAST_SHOWS_KEY, JSON.stringify(nextShows));
  await AsyncStorage.setItem(PODCAST_EPISODES_KEY, JSON.stringify(nextEpisodes));
  await AsyncStorage.setItem(PODCAST_POSITIONS_KEY, JSON.stringify(positions));
  emitLibraryUpdated();
  return nextShows;
}

