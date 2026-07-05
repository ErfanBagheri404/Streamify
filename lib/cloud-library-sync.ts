import { fetchWithRetry } from "../components/core/api";
import { pickBestImageUrl, sanitizeImageUrl } from "../components/core/image";
import type { Track } from "../contexts/PlayerContext";
import {
  buildProviderUrlCandidates,
  getProviderEndpoints,
} from "./provider-endpoints";
import { searchAPI } from "../modules/searchAPI";
import { StorageService, type Playlist } from "../utils/storage";
import { getSupabaseClient } from "./supabase/client";

const LAST_SYNCED_CLOUD_LIBRARY_SNAPSHOT_STORAGE_KEY =
  "@last_synced_cloud_library_snapshot";

type TrackRef = {
  id: string;
  source: string;
};

type PlaylistSnapshot = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  songs: TrackRef[];
};

export type CloudLibrarySnapshot = {
  playlists: PlaylistSnapshot[];
  likedSongs: TrackRef[];
};

export type LocalLibrarySyncSource = {
  playlists: Playlist[];
  likedSongs: Track[];
  snapshot: CloudLibrarySnapshot;
};

export type RestoreCloudLibraryOptions = {
  deferTrackMetadataRefresh?: boolean;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeBareMediaId(value: string, expectedId?: string): boolean {
  const normalized = normalizeString(value);
  if (!normalized) {
    return true;
  }

  if (
    expectedId &&
    normalized.toLowerCase() === normalizeString(expectedId).toLowerCase()
  ) {
    return true;
  }

  return (
    !/\s/.test(normalized) &&
    /^[A-Za-z0-9_-]{10,}$/.test(normalized) &&
    normalized.length <= 64
  );
}

function isPlaceholderTrackTitle(value: string): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return (
    !normalized ||
    normalized === "unknown track" ||
    normalized === "unknown title" ||
    normalized === "untitled"
  );
}

function pickTrackTitle(
  candidates: unknown[],
  expectedId?: string,
  fallback = "Unknown Track"
): string {
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (
      isPlaceholderTrackTitle(normalized) ||
      looksLikeBareMediaId(normalized, expectedId)
    ) {
      continue;
    }

    return normalized;
  }

  return fallback;
}

function isPlaceholderArtistName(value: string): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return (
    !normalized ||
    normalized === "unknown artist" ||
    normalized === "youtube" ||
    normalized === "jiosaavn" ||
    normalized === "soundcloud"
  );
}

function pickTrackArtist(
  candidates: unknown[],
  fallback = "Unknown Artist"
): string {
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (isPlaceholderArtistName(normalized)) {
      continue;
    }

    return normalized;
  }

  return fallback;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getTrackSource(track: Partial<Track>): string {
  if (typeof track.source === "string" && track.source.trim()) {
    return track.source.trim().toLowerCase();
  }
  if (track._isJioSaavn) {
    return "jiosaavn";
  }
  if (track._isSoundCloud) {
    return "soundcloud";
  }
  return "youtube";
}

function getTrackRefKey(ref: TrackRef): string {
  return `${ref.source}:${ref.id}`;
}

function getTrackKey(track: Partial<Track>): string {
  return `${getTrackSource(track)}:${normalizeString(track.id)}`;
}

function createTrackRef(track: Partial<Track>): TrackRef | null {
  const id = normalizeString(track.id);
  const source = getTrackSource(track);
  if (!id || !source) {
    return null;
  }
  return { id, source };
}

function dedupeTrackRefs(trackRefs: TrackRef[]): TrackRef[] {
  const seen = new Set<string>();
  const output: TrackRef[] = [];

  for (const trackRef of trackRefs) {
    const normalized = createTrackRef(trackRef);
    if (!normalized) {
      continue;
    }
    const key = getTrackRefKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function hasSnapshotData(snapshot: CloudLibrarySnapshot): boolean {
  return snapshot.playlists.length > 0 || snapshot.likedSongs.length > 0;
}

function normalizeTrack(track: Partial<Track>): Track {
  const source = getTrackSource(track);
  const normalizedId = normalizeString(track.id);
  return {
    id: normalizedId,
    title: pickTrackTitle([track.title], normalizedId),
    artist: pickTrackArtist([track.artist], source || "Unknown Artist"),
    artistId: normalizeString(track.artistId) || undefined,
    artistImage: normalizeString(track.artistImage) || undefined,
    artistSource: normalizeString(track.artistSource) || undefined,
    duration: normalizeNumber(track.duration) ?? undefined,
    thumbnail: sanitizeImageUrl(normalizeString(track.thumbnail)) || undefined,
    audioUrl: normalizeString(track.audioUrl) || undefined,
    url: normalizeString(track.url) || undefined,
    source,
    _isSoundCloud: source === "soundcloud" ? true : undefined,
    _isJioSaavn: source === "jiosaavn" ? true : undefined,
  };
}

function hasPlaceholderTrackMetadata(track: Partial<Track>): boolean {
  const title = normalizeString(track.title);
  const artist = normalizeString(track.artist);
  const source = getTrackSource(track);
  const id = normalizeString(track.id);

  return Boolean(
    !title ||
    title.toLowerCase() === "unknown track" ||
    looksLikeBareMediaId(title, id) ||
    !artist ||
    artist.toLowerCase() === "unknown artist" ||
    artist.toLowerCase() === source.toLowerCase()
  );
}

function createPlaceholderTrack(ref: TrackRef): Track {
  return normalizeTrack({
    id: ref.id,
    source: ref.source,
    title: ref.id,
    artist: ref.source,
  });
}

function createRestoredTrackSnapshot(
  ref: TrackRef,
  knownTrack?: Track | null
): Track {
  const placeholder = createPlaceholderTrack(ref);
  return knownTrack ? mergeTrack(placeholder, knownTrack) : placeholder;
}

function mergeTrack(
  primary: Partial<Track>,
  secondary?: Partial<Track> | null
): Track {
  const primaryTrack = normalizeTrack(primary);
  const secondaryTrack = secondary ? normalizeTrack(secondary) : null;

  return normalizeTrack({
    ...secondaryTrack,
    ...primaryTrack,
    title: pickTrackTitle(
      [primaryTrack.title, secondaryTrack?.title],
      primaryTrack.id || secondaryTrack?.id
    ),
    artist: pickTrackArtist(
      [primaryTrack.artist, secondaryTrack?.artist],
      getTrackSource(primaryTrack)
    ),
    artistId:
      normalizeString(primaryTrack.artistId) ||
      normalizeString(secondaryTrack?.artistId),
    artistImage:
      normalizeString(primaryTrack.artistImage) ||
      normalizeString(secondaryTrack?.artistImage),
    artistSource:
      normalizeString(primaryTrack.artistSource) ||
      normalizeString(secondaryTrack?.artistSource),
    thumbnail:
      normalizeString(primaryTrack.thumbnail) ||
      normalizeString(secondaryTrack?.thumbnail),
    audioUrl:
      normalizeString(primaryTrack.audioUrl) ||
      normalizeString(secondaryTrack?.audioUrl),
    url:
      normalizeString(primaryTrack.url) || normalizeString(secondaryTrack?.url),
    duration: primaryTrack.duration ?? secondaryTrack?.duration,
  });
}

function mergeTracks(
  primaryTracks: Track[],
  secondaryTracks: Track[]
): Track[] {
  const secondaryByKey = new Map<string, Track>();
  for (const track of secondaryTracks) {
    if (!normalizeString(track.id)) {
      continue;
    }
    secondaryByKey.set(getTrackKey(track), normalizeTrack(track));
  }

  const merged: Track[] = [];
  const seen = new Set<string>();

  for (const track of primaryTracks) {
    const key = getTrackKey(track);
    if (!normalizeString(track.id) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(mergeTrack(track, secondaryByKey.get(key)));
    secondaryByKey.delete(key);
  }

  for (const track of secondaryByKey.values()) {
    const key = getTrackKey(track);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalizeTrack(track));
  }

  return merged;
}

function mergePlaylist(
  primary: Playlist,
  secondary?: Playlist | null
): Playlist {
  const mergedTracks = mergeTracks(
    primary.tracks || [],
    secondary?.tracks || []
  );
  return {
    id: normalizeString(primary.id),
    name:
      normalizeString(primary.name) ||
      normalizeString(secondary?.name) ||
      normalizeString(primary.id),
    description:
      normalizeString(primary.description) ||
      normalizeString(secondary?.description),
    createdAt:
      normalizeString(primary.createdAt) ||
      normalizeString(secondary?.createdAt) ||
      new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    thumbnail:
      normalizeString(primary.thumbnail) ||
      normalizeString(secondary?.thumbnail) ||
      normalizeString(mergedTracks[0]?.thumbnail),
    tracks: mergedTracks,
  };
}

function mergePlaylists(
  primaryPlaylists: Playlist[],
  secondaryPlaylists: Playlist[]
): Playlist[] {
  const secondaryById = new Map<string, Playlist>();
  for (const playlist of secondaryPlaylists) {
    secondaryById.set(normalizeString(playlist.id), playlist);
  }

  const merged: Playlist[] = [];
  const seen = new Set<string>();

  for (const playlist of primaryPlaylists) {
    const id = normalizeString(playlist.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(mergePlaylist(playlist, secondaryById.get(id)));
    secondaryById.delete(id);
  }

  for (const playlist of secondaryById.values()) {
    const id = normalizeString(playlist.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(mergePlaylist(playlist));
  }

  return merged;
}

function createCloudLibrarySnapshot(
  playlists: Playlist[],
  likedSongs: Track[]
): CloudLibrarySnapshot {
  return {
    playlists: playlists.map((playlist) => ({
      id: normalizeString(playlist.id),
      name: normalizeString(playlist.name),
      description: normalizeString(playlist.description),
      createdAt:
        normalizeNumber(Date.parse(normalizeString(playlist.createdAt))) ??
        Date.now(),
      songs: dedupeTrackRefs(
        (playlist.tracks || [])
          .map((track) => createTrackRef(track))
          .filter((track): track is TrackRef => Boolean(track))
      ),
    })),
    likedSongs: dedupeTrackRefs(
      likedSongs
        .map((track) => createTrackRef(track))
        .filter((track): track is TrackRef => Boolean(track))
    ),
  };
}

export function mergeCloudLibrarySnapshots(
  primarySnapshot: CloudLibrarySnapshot,
  secondarySnapshot: CloudLibrarySnapshot
): CloudLibrarySnapshot {
  const secondaryPlaylistsById = new Map<string, PlaylistSnapshot>();
  for (const playlist of secondarySnapshot.playlists || []) {
    const id = normalizeString(playlist.id);
    if (id) {
      secondaryPlaylistsById.set(id, playlist);
    }
  }

  const mergedPlaylists: PlaylistSnapshot[] = [];
  const seen = new Set<string>();

  for (const playlist of primarySnapshot.playlists || []) {
    const id = normalizeString(playlist.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const secondary = secondaryPlaylistsById.get(id);
    mergedPlaylists.push({
      id,
      name:
        normalizeString(playlist.name) ||
        normalizeString(secondary?.name) ||
        id,
      description:
        normalizeString(playlist.description) ||
        normalizeString(secondary?.description),
      createdAt:
        normalizeNumber(playlist.createdAt) ??
        normalizeNumber(secondary?.createdAt) ??
        Date.now(),
      songs: dedupeTrackRefs([
        ...(playlist.songs || []),
        ...(secondary?.songs || []),
      ]),
    });
    secondaryPlaylistsById.delete(id);
  }

  for (const playlist of secondaryPlaylistsById.values()) {
    const id = normalizeString(playlist.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    mergedPlaylists.push({
      id,
      name: normalizeString(playlist.name) || id,
      description: normalizeString(playlist.description),
      createdAt: normalizeNumber(playlist.createdAt) ?? Date.now(),
      songs: dedupeTrackRefs(playlist.songs || []),
    });
  }

  return {
    playlists: mergedPlaylists,
    likedSongs: dedupeTrackRefs([
      ...(primarySnapshot.likedSongs || []),
      ...(secondarySnapshot.likedSongs || []),
    ]),
  };
}

function normalizeTrackRef(value: unknown): TrackRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const source = normalizeString(record.source).toLowerCase();
  if (!id || !source) {
    return null;
  }

  return { id, source };
}

function normalizeTrackRefs(value: unknown): TrackRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeTrackRefs(
    value
      .map((entry) => normalizeTrackRef(entry))
      .filter((entry): entry is TrackRef => Boolean(entry))
  );
}

function normalizePlaylistSnapshot(value: unknown): PlaylistSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const name = normalizeString(record.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: normalizeString(record.description),
    createdAt: normalizeNumber(record.createdAt) ?? Date.now(),
    songs: normalizeTrackRefs(record.songs),
  };
}

function normalizeCloudLibrarySnapshot(
  snapshot: unknown
): CloudLibrarySnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { playlists: [], likedSongs: [] };
  }

  const record = snapshot as Record<string, unknown>;
  return {
    playlists: Array.isArray(record.playlists)
      ? record.playlists
          .map((playlist) => normalizePlaylistSnapshot(playlist))
          .filter((playlist): playlist is PlaylistSnapshot => Boolean(playlist))
      : [],
    likedSongs: normalizeTrackRefs(record.likedSongs),
  };
}

function choosePresence(
  base: boolean,
  local: boolean,
  remote: boolean
): boolean {
  if (local === remote) {
    return local;
  }
  if (local !== base && remote === base) {
    return local;
  }
  if (remote !== base && local === base) {
    return remote;
  }
  return local;
}

function chooseScalarValue<T>(base: T, local: T, remote: T): T {
  if (Object.is(local, remote)) {
    return local;
  }
  if (!Object.is(local, base) && Object.is(remote, base)) {
    return local;
  }
  if (!Object.is(remote, base) && Object.is(local, base)) {
    return remote;
  }
  return local;
}

function buildOrderedTrackKeys(
  baseRefs: TrackRef[],
  localRefs: TrackRef[],
  remoteRefs: TrackRef[]
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const ref of [...localRefs, ...remoteRefs, ...baseRefs]) {
    const key = getTrackRefKey(ref);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

function mergeTrackRefsWithBase(
  baseRefs: TrackRef[],
  localRefs: TrackRef[],
  remoteRefs: TrackRef[]
): TrackRef[] {
  const baseByKey = new Map(baseRefs.map((ref) => [getTrackRefKey(ref), ref]));
  const localByKey = new Map(
    localRefs.map((ref) => [getTrackRefKey(ref), ref])
  );
  const remoteByKey = new Map(
    remoteRefs.map((ref) => [getTrackRefKey(ref), ref])
  );

  const merged: TrackRef[] = [];
  for (const key of buildOrderedTrackKeys(baseRefs, localRefs, remoteRefs)) {
    const shouldKeep = choosePresence(
      baseByKey.has(key),
      localByKey.has(key),
      remoteByKey.has(key)
    );

    if (!shouldKeep) {
      continue;
    }

    const ref =
      localByKey.get(key) || remoteByKey.get(key) || baseByKey.get(key);
    if (ref) {
      merged.push(ref);
    }
  }

  return merged;
}

function mergePlaylistSnapshotWithBase(
  basePlaylist: PlaylistSnapshot | undefined,
  localPlaylist: PlaylistSnapshot | undefined,
  remotePlaylist: PlaylistSnapshot | undefined
): PlaylistSnapshot | null {
  const shouldKeep = choosePresence(
    Boolean(basePlaylist),
    Boolean(localPlaylist),
    Boolean(remotePlaylist)
  );

  if (!shouldKeep) {
    return null;
  }

  if (!localPlaylist && !remotePlaylist) {
    return basePlaylist || null;
  }

  if (!localPlaylist) {
    return remotePlaylist || basePlaylist || null;
  }

  if (!remotePlaylist) {
    return localPlaylist || basePlaylist || null;
  }

  return {
    id: localPlaylist.id,
    name: chooseScalarValue(
      basePlaylist?.name || "",
      localPlaylist.name,
      remotePlaylist.name
    ),
    description: chooseScalarValue(
      basePlaylist?.description || "",
      localPlaylist.description,
      remotePlaylist.description
    ),
    createdAt: chooseScalarValue(
      basePlaylist?.createdAt || localPlaylist.createdAt,
      localPlaylist.createdAt,
      remotePlaylist.createdAt
    ),
    songs: mergeTrackRefsWithBase(
      basePlaylist?.songs || [],
      localPlaylist.songs,
      remotePlaylist.songs
    ),
  };
}

function mergeCloudLibrarySnapshotsWithBase(
  baseSnapshot: CloudLibrarySnapshot,
  localSnapshot: CloudLibrarySnapshot,
  remoteSnapshot: CloudLibrarySnapshot
): CloudLibrarySnapshot {
  const base = normalizeCloudLibrarySnapshot(baseSnapshot);
  const local = normalizeCloudLibrarySnapshot(localSnapshot);
  const remote = normalizeCloudLibrarySnapshot(remoteSnapshot);

  const basePlaylistsById = new Map(
    base.playlists.map((playlist) => [playlist.id, playlist])
  );
  const localPlaylistsById = new Map(
    local.playlists.map((playlist) => [playlist.id, playlist])
  );
  const remotePlaylistsById = new Map(
    remote.playlists.map((playlist) => [playlist.id, playlist])
  );

  const playlistIds: string[] = [];
  const seenPlaylistIds = new Set<string>();
  for (const playlist of [
    ...local.playlists,
    ...remote.playlists,
    ...base.playlists,
  ]) {
    if (seenPlaylistIds.has(playlist.id)) {
      continue;
    }
    seenPlaylistIds.add(playlist.id);
    playlistIds.push(playlist.id);
  }

  return {
    playlists: playlistIds
      .map((playlistId) =>
        mergePlaylistSnapshotWithBase(
          basePlaylistsById.get(playlistId),
          localPlaylistsById.get(playlistId),
          remotePlaylistsById.get(playlistId)
        )
      )
      .filter((playlist): playlist is PlaylistSnapshot => Boolean(playlist)),
    likedSongs: mergeTrackRefsWithBase(
      base.likedSongs,
      local.likedSongs,
      remote.likedSongs
    ),
  };
}

async function getAuthenticatedSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Cloud sync is unavailable until Supabase environment variables are configured."
    );
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }
  if (!user) {
    throw new Error("Sign in to sync your library.");
  }

  return { supabase, user };
}

export async function pullCloudLibrarySnapshot(): Promise<CloudLibrarySnapshot> {
  const { supabase, user } = await getAuthenticatedSupabase();

  const { data: playlists, error: playlistsError } = await supabase
    .from("playlists")
    .select("id, client_playlist_id, name, description, created_at_client")
    .eq("user_id", user.id)
    .order("created_at_client", { ascending: false });

  if (playlistsError) {
    throw new Error(playlistsError.message);
  }

  const playlistIds = (playlists || [])
    .map((playlist) =>
      normalizeString((playlist as Record<string, unknown>).id)
    )
    .filter(Boolean);

  const { data: playlistTracks, error: playlistTracksError } =
    playlistIds.length > 0
      ? await supabase
          .from("playlist_tracks")
          .select("playlist_id, track_id, source")
          .in("playlist_id", playlistIds)
      : { data: [], error: null };

  if (playlistTracksError) {
    throw new Error(playlistTracksError.message);
  }

  const { data: likedTracks, error: likedTracksError } = await supabase
    .from("liked_tracks")
    .select("track_id, source")
    .eq("user_id", user.id);

  if (likedTracksError) {
    throw new Error(likedTracksError.message);
  }

  const tracksByPlaylistId = new Map<string, TrackRef[]>();
  for (const entry of playlistTracks || []) {
    const record = entry as Record<string, unknown>;
    const playlistId = normalizeString(record.playlist_id);
    const trackId = normalizeString(record.track_id);
    const source = normalizeString(record.source).toLowerCase();
    if (!playlistId || !trackId || !source) {
      continue;
    }
    const next = tracksByPlaylistId.get(playlistId) || [];
    next.push({ id: trackId, source });
    tracksByPlaylistId.set(playlistId, next);
  }

  return {
    playlists: (playlists || []).map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        id: normalizeString(record.client_playlist_id),
        name: normalizeString(record.name),
        description: normalizeString(record.description),
        createdAt:
          normalizeNumber(
            normalizeString(record.created_at_client)
              ? Date.parse(normalizeString(record.created_at_client))
              : null
          ) ?? Date.now(),
        songs: dedupeTrackRefs(
          tracksByPlaylistId.get(normalizeString(record.id)) || []
        ),
      };
    }),
    likedSongs: dedupeTrackRefs(
      (likedTracks || []).map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          id: normalizeString(record.track_id),
          source: normalizeString(record.source).toLowerCase(),
        };
      })
    ),
  };
}

export async function readLastSyncedCloudLibrarySnapshot(): Promise<CloudLibrarySnapshot | null> {
  try {
    const raw = await StorageService.getItem(
      LAST_SYNCED_CLOUD_LIBRARY_SNAPSHOT_STORAGE_KEY
    );
    if (!raw) {
      return null;
    }
    return normalizeCloudLibrarySnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveLastSyncedCloudLibrarySnapshot(
  snapshot: CloudLibrarySnapshot
): Promise<void> {
  try {
    await StorageService.setItem(
      LAST_SYNCED_CLOUD_LIBRARY_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(normalizeCloudLibrarySnapshot(snapshot))
    );
  } catch {}
}

export async function clearLastSyncedCloudLibrarySnapshot(): Promise<void> {
  try {
    await StorageService.removeItem(
      LAST_SYNCED_CLOUD_LIBRARY_SNAPSHOT_STORAGE_KEY
    );
  } catch {}
}

function pickBestImage(value: unknown): string | undefined {
  return pickBestImageUrl(value) || undefined;
}

function getJioSaavnRecords(payload: unknown): Record<string, any>[] {
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();
  const records: Record<string, any>[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, any>;
    if (Object.keys(record).length > 0) {
      records.push(record);
    }

    queue.push(
      record.data,
      record.song,
      record.songs,
      record.results,
      record.more_info
    );
  }

  return records;
}

function pickJioSaavnTrackRecord(
  records: Record<string, any>[],
  ref: TrackRef
): Record<string, any> | null {
  const expectedId = normalizeString(ref.id);

  for (const record of records) {
    const candidateId = normalizeString(
      record.id || record.songId || record.songid || record.identifier
    );
    if (candidateId && candidateId === expectedId) {
      return record;
    }
  }

  for (const record of records) {
    if (
      normalizeString(record.name) ||
      normalizeString(record.title) ||
      normalizeString(record.song)
    ) {
      return record;
    }
  }

  return records[0] || null;
}

function scoreJioSaavnQuality(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.match(/(\d+)/);
    if (match) {
      return Number(match[1]);
    }
  }

  return 0;
}

function pickJioSaavnAudioUrl(
  record: Record<string, any> | null,
  knownTrack?: Track | null
): string | undefined {
  if (!record) {
    return normalizeString(knownTrack?.audioUrl) || undefined;
  }

  const downloadCandidates = [
    record.downloadUrl,
    record.download_url,
    record.downloadLinks,
    record.more_info?.downloadUrl,
    record.more_info?.download_url,
  ].find((value) => Array.isArray(value));

  if (Array.isArray(downloadCandidates)) {
    const best = [...downloadCandidates]
      .map((entry) => (entry && typeof entry === "object" ? entry : {}))
      .sort(
        (left: any, right: any) =>
          scoreJioSaavnQuality(right.quality || right.bitrate || right.kbps) -
          scoreJioSaavnQuality(left.quality || left.bitrate || left.kbps)
      )
      .map(
        (entry: any) =>
          entry.url || entry.link || entry.downloadUrl || entry.download_url
      )
      .find(Boolean);

    if (best) {
      return normalizeString(best).replace(/^http:/i, "https:") || undefined;
    }
  }

  return (
    normalizeString(
      record.media_url ||
        record.mediaUrl ||
        record.vlink ||
        record.preview_url ||
        record.url
    ) ||
    normalizeString(knownTrack?.audioUrl) ||
    undefined
  );
}

function pickJioSaavnArtistName(
  record: Record<string, any> | null,
  knownTrack?: Track | null
): string {
  if (!record) {
    return normalizeString(knownTrack?.artist) || "JioSaavn";
  }

  return (
    normalizeString(
      record.artists?.primary
        ?.map?.((artist: any) => artist?.name)
        ?.filter(Boolean)
        ?.join(", ")
    ) ||
    normalizeString(record.primaryArtists) ||
    normalizeString(record.primary_artists) ||
    normalizeString(record.singers) ||
    normalizeString(record.artist) ||
    normalizeString(knownTrack?.artist) ||
    "JioSaavn"
  );
}

async function fetchJioSaavnPayload(
  ref: TrackRef,
  knownTrack?: Track | null
): Promise<any | null> {
  const providerEndpoints = await getProviderEndpoints();
  const apiBase = normalizeString(providerEndpoints.providers.jiosaavn.apiBase);
  if (!apiBase) {
    return null;
  }

  const candidates = new Set<string>();
  const addIdCandidates = (value: string) => {
    buildProviderUrlCandidates(apiBase, [
      `/api/songs/${encodeURIComponent(value)}`,
      `/songs/${encodeURIComponent(value)}`,
    ]).forEach((candidate) => candidates.add(candidate));
    buildProviderUrlCandidates(apiBase, ["/api/songs", "/songs"], {
      ids: value,
    }).forEach((candidate) => candidates.add(candidate));
  };
  const addLinkCandidates = (value: string) => {
    buildProviderUrlCandidates(apiBase, ["/api/songs", "/songs"], {
      link: value,
    }).forEach((candidate) => candidates.add(candidate));
  };

  const id = normalizeString(ref.id);
  const urlHint = normalizeString(knownTrack?.url);
  if (id) {
    addIdCandidates(id);
  }
  if (urlHint) {
    addLinkCandidates(urlHint);
    try {
      const parsed = new URL(urlHint);
      const token = parsed.pathname.split("/").filter(Boolean).pop();
      if (token) {
        addIdCandidates(token);
      }
    } catch {
      addIdCandidates(urlHint);
    }
  }

  for (const endpoint of candidates) {
    try {
      return await fetchWithRetry<any>(
        endpoint,
        {
          headers: {
            Accept: "application/json",
          },
        },
        2,
        600
      );
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveJioSaavnTrack(
  ref: TrackRef,
  knownTrack?: Track | null
): Promise<Track> {
  try {
    const payload = await fetchJioSaavnPayload(ref, knownTrack);
    if (!payload) {
      throw new Error("Unable to fetch JioSaavn track payload");
    }

    const record = pickJioSaavnTrackRecord(getJioSaavnRecords(payload), ref);
    const primaryArtist = record?.artists?.primary?.[0];
    const image =
      pickBestImage(record?.image) ||
      pickBestImage(record?.images) ||
      pickBestImage(record?.more_info?.image) ||
      pickBestImage(primaryArtist?.image) ||
      knownTrack?.thumbnail;
    const audioUrl = pickJioSaavnAudioUrl(record, knownTrack);

    return mergeTrack(
      {
        id: ref.id,
        source: "jiosaavn",
        title: pickTrackTitle(
          [
            record?.name,
            record?.title,
            record?.song,
            record?.label,
            knownTrack?.title,
          ],
          ref.id
        ),
        artist: pickJioSaavnArtistName(record, knownTrack),
        artistId:
          normalizeString(primaryArtist?.id) ||
          normalizeString(knownTrack?.artistId) ||
          undefined,
        artistImage:
          pickBestImage(primaryArtist?.image) || knownTrack?.artistImage,
        artistSource: "jiosaavn",
        duration:
          normalizeNumber(record?.duration) ??
          normalizeNumber(record?.more_info?.duration) ??
          knownTrack?.duration,
        thumbnail: image,
        audioUrl: normalizeString(audioUrl) || undefined,
        url:
          normalizeString(record?.url) ||
          normalizeString(record?.permalink_url) ||
          normalizeString(knownTrack?.url) ||
          undefined,
      },
      knownTrack
    );
  } catch {
    return mergeTrack(
      {
        id: ref.id,
        source: "jiosaavn",
        title: knownTrack?.title || ref.id,
        artist: knownTrack?.artist || "JioSaavn",
      },
      knownTrack
    );
  }
}

async function resolveYouTubeTrack(
  ref: TrackRef,
  knownTrack?: Track | null
): Promise<Track> {
  try {
    const result = await searchAPI.getYouTubeVideoInfoWithFallback(ref.id);
    const data = (result?.data || null) as Record<string, unknown> | null;

    return mergeTrack(
      {
        id:
          normalizeString(data?.videoId) || normalizeString(data?.id) || ref.id,
        source: ref.source,
        title: pickTrackTitle([data?.title, knownTrack?.title], ref.id),
        artist:
          normalizeString(data?.author) ||
          normalizeString(data?.uploader) ||
          knownTrack?.artist,
        duration:
          normalizeNumber(data?.duration) ??
          normalizeNumber(data?.lengthSeconds) ??
          knownTrack?.duration,
        thumbnail:
          sanitizeImageUrl(normalizeString(data?.thumbnailUrl)) ||
          pickBestImage(data?.videoThumbnails) ||
          knownTrack?.thumbnail,
        url:
          normalizeString(data?.url) ||
          knownTrack?.url ||
          `https://www.youtube.com/watch?v=${encodeURIComponent(ref.id)}`,
      },
      knownTrack
    );
  } catch {
    return mergeTrack(
      {
        id: ref.id,
        source: ref.source,
        title: pickTrackTitle([knownTrack?.title], ref.id),
        artist: knownTrack?.artist || "YouTube",
      },
      knownTrack
    );
  }
}

async function resolveCloudTrackRef(
  ref: TrackRef,
  knownTrack?: Track | null
): Promise<Track> {
  if (ref.source === "jiosaavn") {
    return resolveJioSaavnTrack(ref, knownTrack);
  }

  if (ref.source === "youtube" || ref.source === "youtubemusic") {
    return resolveYouTubeTrack(ref, knownTrack);
  }

  return mergeTrack(
    {
      id: ref.id,
      source: ref.source,
      title: pickTrackTitle([knownTrack?.title], ref.id),
      artist: knownTrack?.artist || ref.source,
    },
    knownTrack
  );
}

function buildKnownTrackMap(tracks: Track[]): Map<string, Track> {
  const knownTracks = new Map<string, Track>();

  for (const track of tracks) {
    if (normalizeString(track.id)) {
      knownTracks.set(getTrackKey(track), normalizeTrack(track));
    }
  }

  return knownTracks;
}

export async function buildCurrentLocalLibrarySyncSource(): Promise<LocalLibrarySyncSource> {
  const [playlists, likedSongs] = await Promise.all([
    StorageService.loadPlaylists(),
    StorageService.loadLikedSongs(),
  ]);

  return {
    playlists,
    likedSongs,
    snapshot: createCloudLibrarySnapshot(playlists, likedSongs),
  };
}

export async function pushCloudLibrarySnapshot(
  snapshot: CloudLibrarySnapshot,
  options: { mergeWithRemote?: boolean } = {}
) {
  const { supabase, user } = await getAuthenticatedSupabase();
  let mergedSnapshot = snapshot;

  if (options.mergeWithRemote !== false) {
    try {
      const remoteSnapshot = await pullCloudLibrarySnapshot();
      mergedSnapshot = mergeCloudLibrarySnapshots(snapshot, remoteSnapshot);
    } catch {}
  }

  const { error: deletePlaylistsError } = await supabase
    .from("playlists")
    .delete()
    .eq("user_id", user.id);

  if (deletePlaylistsError) {
    throw new Error(deletePlaylistsError.message);
  }

  if (mergedSnapshot.playlists.length > 0) {
    const playlistRows = mergedSnapshot.playlists.map((playlist) => ({
      user_id: user.id,
      client_playlist_id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      created_at_client: new Date(playlist.createdAt).toISOString(),
    }));
    const { error: insertPlaylistsError } = await supabase
      .from("playlists")
      .insert(playlistRows as any);

    if (insertPlaylistsError) {
      throw new Error(insertPlaylistsError.message);
    }

    const { data: storedPlaylists, error: storedPlaylistsError } =
      await supabase
        .from("playlists")
        .select("id, client_playlist_id")
        .eq("user_id", user.id);

    if (storedPlaylistsError) {
      throw new Error(storedPlaylistsError.message);
    }

    const playlistIdByClientId = new Map<string, string>();
    for (const entry of storedPlaylists || []) {
      const record = entry as Record<string, unknown>;
      const clientPlaylistId = normalizeString(record.client_playlist_id);
      const storedPlaylistId = normalizeString(record.id);
      if (clientPlaylistId && storedPlaylistId) {
        playlistIdByClientId.set(clientPlaylistId, storedPlaylistId);
      }
    }

    const playlistTracks = mergedSnapshot.playlists.flatMap((playlist) => {
      const playlistId = playlistIdByClientId.get(playlist.id);
      if (!playlistId) {
        return [];
      }

      return playlist.songs.map((song) => ({
        playlist_id: playlistId,
        user_id: user.id,
        track_id: song.id,
        source: song.source,
      }));
    });

    if (playlistTracks.length > 0) {
      const { error: insertPlaylistTracksError } = await supabase
        .from("playlist_tracks")
        .insert(playlistTracks as any);

      if (insertPlaylistTracksError) {
        throw new Error(insertPlaylistTracksError.message);
      }
    }
  }

  const { error: deleteLikedTracksError } = await supabase
    .from("liked_tracks")
    .delete()
    .eq("user_id", user.id);

  if (deleteLikedTracksError) {
    throw new Error(deleteLikedTracksError.message);
  }

  if (mergedSnapshot.likedSongs.length > 0) {
    const likedTrackRows = mergedSnapshot.likedSongs.map((song) => ({
      user_id: user.id,
      track_id: song.id,
      source: song.source,
    }));
    const { error: insertLikedTracksError } = await supabase
      .from("liked_tracks")
      .insert(likedTrackRows as any);

    if (insertLikedTracksError) {
      throw new Error(insertLikedTracksError.message);
    }
  }

  return {
    syncedPlaylists: mergedSnapshot.playlists.length,
    syncedLikes: mergedSnapshot.likedSongs.length,
  };
}

async function refreshStoredLibraryMetadata() {
  const [playlists, likedSongs, knownLocalTracks] = await Promise.all([
    StorageService.loadPlaylists(),
    StorageService.loadLikedSongs(),
    StorageService.loadKnownLibraryTracks(),
  ]);

  const knownTracks = buildKnownTrackMap([
    ...knownLocalTracks,
    ...likedSongs,
    ...playlists.flatMap((playlist) => playlist.tracks || []),
  ]);

  const trackRefsToRefresh = dedupeTrackRefs([
    ...likedSongs
      .filter((track) => hasPlaceholderTrackMetadata(track))
      .map((track) => createTrackRef(track))
      .filter((track): track is TrackRef => Boolean(track)),
    ...playlists.flatMap((playlist) =>
      (playlist.tracks || [])
        .filter((track) => hasPlaceholderTrackMetadata(track))
        .map((track) => createTrackRef(track))
        .filter((track): track is TrackRef => Boolean(track))
    ),
  ]);

  if (trackRefsToRefresh.length === 0) {
    return { refreshed: 0 };
  }

  const resolvedEntries = await Promise.all(
    trackRefsToRefresh.map(
      async (trackRef) =>
        [
          getTrackRefKey(trackRef),
          await resolveCloudTrackRef(
            trackRef,
            knownTracks.get(getTrackRefKey(trackRef)) || null
          ),
        ] as const
    )
  );

  const resolvedByKey = new Map<string, Track>(resolvedEntries);
  if (resolvedByKey.size === 0) {
    return { refreshed: 0 };
  }

  const nextPlaylists = playlists.map((playlist) => ({
    ...playlist,
    tracks: (playlist.tracks || []).map((track) => {
      const resolved = resolvedByKey.get(getTrackKey(track));
      return resolved ? mergeTrack(resolved, track) : track;
    }),
    updatedAt: new Date().toISOString(),
  }));
  const nextLikedSongs = likedSongs.map((track) => {
    const resolved = resolvedByKey.get(getTrackKey(track));
    return resolved ? mergeTrack(resolved, track) : track;
  });

  await Promise.all([
    StorageService.savePlaylists(nextPlaylists),
    StorageService.saveLikedSongs(nextLikedSongs),
  ]);

  return { refreshed: resolvedByKey.size };
}

export async function restoreCloudLibrary(
  snapshot?: CloudLibrarySnapshot,
  options: RestoreCloudLibraryOptions = {}
) {
  const remoteSnapshot = snapshot || (await pullCloudLibrarySnapshot());
  const knownLocalTracks = await StorageService.loadKnownLibraryTracks();

  if (!hasSnapshotData(remoteSnapshot)) {
    return { restoredPlaylists: 0, restoredLikes: 0 };
  }

  const knownTracks = buildKnownTrackMap([...knownLocalTracks]);

  if (options.deferTrackMetadataRefresh) {
    const restoredPlaylists = remoteSnapshot.playlists.map((playlist) => {
      const tracks = playlist.songs.map((trackRef) =>
        createRestoredTrackSnapshot(
          trackRef,
          knownTracks.get(getTrackRefKey(trackRef)) || null
        )
      );

      return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        createdAt: new Date(playlist.createdAt).toISOString(),
        updatedAt: new Date().toISOString(),
        thumbnail: tracks[0]?.thumbnail,
        tracks,
      } satisfies Playlist;
    });

    const restoredLikedSongs = remoteSnapshot.likedSongs.map((trackRef) =>
      createRestoredTrackSnapshot(
        trackRef,
        knownTracks.get(getTrackRefKey(trackRef)) || null
      )
    );

    await Promise.all([
      StorageService.savePlaylists(restoredPlaylists),
      StorageService.saveLikedSongs(restoredLikedSongs),
    ]);

    void refreshStoredLibraryMetadata().catch(() => {});

    return {
      restoredPlaylists: restoredPlaylists.length,
      restoredLikes: restoredLikedSongs.length,
    };
  }

  const restoredPlaylists = await Promise.all(
    remoteSnapshot.playlists.map(async (playlist) => {
      const tracks = await Promise.all(
        playlist.songs.map((trackRef) =>
          resolveCloudTrackRef(
            trackRef,
            knownTracks.get(getTrackRefKey(trackRef)) || null
          )
        )
      );

      return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        createdAt: new Date(playlist.createdAt).toISOString(),
        updatedAt: new Date().toISOString(),
        thumbnail: tracks[0]?.thumbnail,
        tracks,
      } satisfies Playlist;
    })
  );

  const restoredLikedSongs = await Promise.all(
    remoteSnapshot.likedSongs.map((trackRef) =>
      resolveCloudTrackRef(
        trackRef,
        knownTracks.get(getTrackRefKey(trackRef)) || null
      )
    )
  );

  await Promise.all([
    StorageService.savePlaylists(restoredPlaylists),
    StorageService.saveLikedSongs(restoredLikedSongs),
  ]);

  return {
    restoredPlaylists: restoredPlaylists.length,
    restoredLikes: restoredLikedSongs.length,
  };
}

export async function syncCloudLibrarySnapshot() {
  const localSource = await buildCurrentLocalLibrarySyncSource();
  const remoteSnapshot = await pullCloudLibrarySnapshot();
  const lastSyncedSnapshot = await readLastSyncedCloudLibrarySnapshot();

  if (
    hasSnapshotData(remoteSnapshot) &&
    hasSnapshotData(localSource.snapshot)
  ) {
    const mergedSnapshot = lastSyncedSnapshot
      ? mergeCloudLibrarySnapshotsWithBase(
          lastSyncedSnapshot,
          localSource.snapshot,
          remoteSnapshot
        )
      : mergeCloudLibrarySnapshots(localSource.snapshot, remoteSnapshot);

    await restoreCloudLibrary(mergedSnapshot, {
      deferTrackMetadataRefresh: true,
    });

    const uploadResult = await pushCloudLibrarySnapshot(mergedSnapshot, {
      mergeWithRemote: false,
    });
    await saveLastSyncedCloudLibrarySnapshot(mergedSnapshot);

    return {
      syncedPlaylists: uploadResult.syncedPlaylists,
      syncedLikes: uploadResult.syncedLikes,
      source: "merged" as const,
    };
  }

  if (hasSnapshotData(remoteSnapshot)) {
    await restoreCloudLibrary(remoteSnapshot, {
      deferTrackMetadataRefresh: true,
    });
    await saveLastSyncedCloudLibrarySnapshot(remoteSnapshot);

    return {
      syncedPlaylists: remoteSnapshot.playlists.length,
      syncedLikes: remoteSnapshot.likedSongs.length,
      source: "cloud" as const,
    };
  }

  if (!hasSnapshotData(localSource.snapshot)) {
    await saveLastSyncedCloudLibrarySnapshot(localSource.snapshot);
    return {
      syncedPlaylists: 0,
      syncedLikes: 0,
      source: "empty" as const,
    };
  }

  const uploadResult = await pushCloudLibrarySnapshot(localSource.snapshot);
  await saveLastSyncedCloudLibrarySnapshot(localSource.snapshot);

  return {
    syncedPlaylists: uploadResult.syncedPlaylists,
    syncedLikes: uploadResult.syncedLikes,
    source: "local" as const,
  };
}
