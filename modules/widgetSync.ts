import { NativeModules, Platform } from "react-native";
import TrackPlayer, { Event, State } from "react-native-track-player";

/**
 * Home-screen widget sync (issue #29).
 *
 * The widget is a mirror of state the JS player already tracks, not a second
 * player: JS pushes a compact snapshot into SharedPreferences through
 * StreamifyWidgetModule, and the native provider renders it.
 *
 * ponytail: one snapshot per state change plus a 1s progress tick. A
 * MediaSession-backed widget could poll natively with no JS, but RNTP exposes
 * no stable session, and the JS process is alive anyway during playback.
 * Upgrade to a native poll if the app is ever made to play with JS detached.
 */

type WidgetNativeModule = {
  updateState: (
    title: string | null,
    artist: string | null,
    artworkUrl: string | null,
    isPlaying: boolean,
    positionMs: number,
    durationMs: number,
  ) => void;
  setPlaylistSlots: (names: string[]) => void;
};

const native = (
  Platform.OS === "android" ? (NativeModules as any).StreamifyWidgetModule : undefined
) as WidgetNativeModule | undefined;

export const isWidgetSyncAvailable = native != null;

/** Coalesce bursts (seek storm, cache events) into one bridge call. */
let pendingSnapshot: {
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
} | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const snapshot = pendingSnapshot;
  pendingSnapshot = null;
  if (!snapshot || !native) return;
  try {
    native.updateState(
      snapshot.title,
      snapshot.artist,
      snapshot.artworkUrl,
      snapshot.isPlaying,
      snapshot.positionMs,
      snapshot.durationMs,
    );
  } catch {
    // Launcher unavailable; the widget is best-effort, never fail playback.
  }
}

export function pushWidgetState(
  track: {
    title?: string | null;
    artist?: string | null;
    thumbnail?: string | null;
  } | null,
  isPlaying: boolean,
  positionMs: number,
  durationMs: number,
) {
  if (!native) return;
  pendingSnapshot = {
    title: track?.title ?? null,
    artist: track?.artist ?? null,
    artworkUrl: track?.thumbnail ?? null,
    isPlaying,
    positionMs,
    durationMs,
  };
  if (flushTimer == null) {
    flushTimer = setTimeout(flush, 250);
  }
}

export function pushWidgetPlaylistSlots(names: string[]) {
  if (!native) return;
  try {
    native.setPlaylistSlots(names.slice(0, 4));
  } catch {
    // Same best-effort contract as pushWidgetState.
  }
}

let started = false;
let progressSub: { remove?: () => void } | null = null;
let stateSub: { remove?: () => void } | null = null;
let trackSub: { remove?: () => void } | null = null;

/**
 * Start mirroring playback into the widget. Idempotent: safe to call from a
 * provider that remounts. Returns a disposer so tests and hot reload don't
 * leak listeners.
 */
export function startWidgetSync(getSnapshot: () => {
  track: { title?: string | null; artist?: string | null; thumbnail?: string | null } | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
}) {
  if (!native || started) return () => {};
  started = true;

  const push = () => {
    const { track, isPlaying, positionMs, durationMs } = getSnapshot();
    pushWidgetState(track, isPlaying, positionMs, durationMs);
  };

  // Progress events already fire ~1/s while playing, so they double as the
  // heartbeat that keeps widget transport keys pointed at our session.
  progressSub = TrackPlayer.addEventListener(
    Event.PlaybackProgressUpdated,
    (event: any) => {
      const { track, isPlaying } = getSnapshot();
      pushWidgetState(
        track,
        isPlaying,
        Math.max(0, Math.round(event?.position ?? 0)),
        Math.max(0, Math.round(event?.duration ?? 0)),
      );
    },
  );

  stateSub = TrackPlayer.addEventListener(Event.PlaybackState, (event: any) => {
    const resolved = event?.state ?? event;
    const snap = getSnapshot();
    const stillPlaying =
      resolved === State.Playing || resolved === State.Buffering || resolved === State.Connecting;
    // Paused/ended emits no more progress events, so stop refreshing the
    // heartbeat: transport keys must then open the app instead of firing a
    // media key at whatever else is playing.
    pushWidgetState(snap.track, stillPlaying, snap.positionMs, snap.durationMs);
  });

  trackSub = TrackPlayer.addEventListener(
    Event.PlaybackActiveTrackChanged as any,
    () => push(),
  );

  push();

  return () => {
    progressSub?.remove?.();
    stateSub?.remove?.();
    trackSub?.remove?.();
    progressSub = null;
    stateSub = null;
    trackSub = null;
    started = false;
  };
}
