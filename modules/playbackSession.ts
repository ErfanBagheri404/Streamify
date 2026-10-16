import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Structural subset of the PlayerContext `Track` interface — kept local here
 * to avoid a circular import (PlayerContext imports this module). Mirrors the
 * real field requirements so `Track` is assignable in both directions.
 */
export interface SessionTrack {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  thumbnail?: string;
  audioUrl?: string;
  url?: string;
}

/**
 * Persisted playback-session context.
 *
 * The native TrackPlayer queue is not a reliable source of truth for
 * "what playlist was I listening from":
 *  - it is empty after the OS kills the app, and
 *  - addTracks() skips tracks whose audioUrl has not resolved yet, so a long
 *    playlist restores as a truncated queue (or nothing at all).
 *
 * We therefore snapshot the *logical* playlist whenever it changes and use it
 * to rebuild the context on cold start. Resolved audio URLs are stripped —
 * they expire, and playback re-resolves them on demand.
 */

const SESSION_KEY = "@streamify_playback_session";

export const MAX_RESTORED_PLAYLIST = 200;

export interface PlaybackSession<T extends SessionTrack = SessionTrack> {
  playlist: T[];
  index: number;
  updatedAt: number;
}

/** Drop volatile fields that must never be trusted across launches. */
function stripVolatile<T extends SessionTrack>(track: T): T {
  const copy = { ...track } as Record<string, unknown>;
  delete copy.audioUrl;
  delete copy.url;
  return copy as T;
}

export async function savePlaybackSession<T extends SessionTrack>(
  playlist: T[],
  index: number,
): Promise<void> {
  try {
    if (playlist.length === 0) {
      await AsyncStorage.removeItem(SESSION_KEY);
      return;
    }
    const session: PlaybackSession<T> = {
      playlist: playlist.slice(0, MAX_RESTORED_PLAYLIST).map(stripVolatile),
      index: Math.max(0, Math.min(index, playlist.length - 1)),
      updatedAt: Date.now(),
    };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn("[playbackSession] save failed:", error);
  }
}

export async function loadPlaybackSession<
  T extends SessionTrack = SessionTrack,
>(): Promise<PlaybackSession<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaybackSession<T>;
    if (!Array.isArray(parsed.playlist) || parsed.playlist.length === 0) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("[playbackSession] load failed:", error);
    return null;
  }
}

export async function clearPlaybackSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn("[playbackSession] clear failed:", error);
  }
}

/**
 * Decide the playlist + index to restore on cold start. Pure so tests can
 * execute it directly.
 *
 *  - `session`           persisted logical playlist + saved index (or null).
 *  - `nativeIds`         ids currently in the TrackPlayer queue (empty after
 *                        the process was killed).
 *  - `nativeActiveIndex` TrackPlayer.getCurrentTrack() into nativeIds.
 *
 * Rules:
 *  - No persisted session      -> null (nothing to do).
 *  - Empty native queue        -> restore the persisted playlist at its index.
 *  - Native queue is a strict subset of the snapshot and the active native
 *    track exists in the snapshot -> restore the FULL snapshot mapped to the
 *    active track's ORIGINAL position, so next/prev and "Up Next" see the
 *    whole playlist instead of the truncated queue.
 *  - Otherwise (queue agrees with or exceeds the snapshot) -> trust native;
 *    return null so the existing native rehydration path runs untouched.
 */
export function resolveRestoredSession<T extends SessionTrack>(
  session: PlaybackSession<T> | null,
  nativeIds: string[],
  nativeActiveIndex: number,
): { playlist: T[]; index: number } | null {
  if (!session || session.playlist.length === 0) {
    return null;
  }
  const snapshotIds = session.playlist.map((t) => String(t.id));

  if (nativeIds.length === 0) {
    return {
      playlist: session.playlist,
      index: Math.max(0, Math.min(session.index, snapshotIds.length - 1)),
    };
  }

  const safeActive = Math.max(
    0,
    Math.min(nativeActiveIndex, nativeIds.length - 1),
  );
  const activeId = String(nativeIds[safeActive]);
  const fullIndex = snapshotIds.indexOf(activeId);

  if (
    fullIndex >= 0 &&
    session.playlist.length > nativeIds.length &&
    nativeIds.every((id) => snapshotIds.includes(String(id)))
  ) {
    return { playlist: session.playlist, index: fullIndex };
  }
  return null;
}
