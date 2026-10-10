/**
 * Wear OS companion payloads (issue #32).
 *
 * The pure half: what the watch renders from a phone state snapshot. The
 * `wearapp/` module itself (media3 on watch, MediaSession transport) needs an
 * emulator and is not testable here — this module is the payload contract.
 *
 * Every formatter is defensive: a watch face renders whatever it is handed,
 * and a missing title or absent duration must not become an ugly blank or a
 * `NaN` on a tiny screen.
 */
import type { Track } from "../contexts/PlayerContext";

/** Now-playing card shown on the wrist. */
export interface WearNowPlaying {
  title: string;
  artist: string;
  /** Absolute art URL, or "" — the watch fetches it itself. */
  artworkUrl: string;
  isPlaying: boolean;
  positionLabel: string;
  durationLabel: string;
  /** "43% / 3:35" progress, or "" when duration is unknown. */
  progressLabel: string;
}

/** One row in the wrist queue list. */
export interface WearQueueItem {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  /** True for the item the phone is playing right now. */
  isCurrent: boolean;
}

/** Watch-face complication line. */
export interface WearComplication {
  /** Short single-line text, truncation-safe for a 2-char complication. */
  label: string;
  /** True when there is nothing meaningful to show. */
  empty: boolean;
}

const UNKNOWN_ARTIST = "Unknown Artist";

function text(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function art(value: string | undefined): string {
  const url = typeof value === "string" ? value.trim() : "";
  return /^https?:\/\//i.test(url) ? url : "";
}

function seconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** `m:ss`, wrapping past an hour — never `NaN`, never a bare `:`. */
export function formatWearTime(value: number | undefined): string {
  const total = Math.floor(seconds(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/**
 * Now-playing card for the wrist. The percentage is capped at 99 and an
 * unknown duration yields an empty progress label, so the watch never
 * renders a negative or overshot value.
 */
export function buildWearNowPlaying(
  track: Track | null | undefined,
  isPlaying: boolean,
  position: number,
  duration: number,
): WearNowPlaying {
  const dur = seconds(duration);
  const pos = Math.min(seconds(position), dur || seconds(position));
  const pct = dur > 0 ? Math.min(99, Math.floor((pos / dur) * 100)) : 0;

  return {
    title: text(track?.title, "Unknown Title"),
    artist: text(track?.artist, UNKNOWN_ARTIST),
    artworkUrl: art(track?.thumbnail),
    isPlaying: !!isPlaying,
    positionLabel: formatWearTime(pos),
    durationLabel: dur > 0 ? formatWearTime(dur) : "",
    progressLabel: dur > 0 ? `${pct}% / ${formatWearTime(dur)}` : "",
  };
}

/**
 * Queue rows for wrist browsing. Tracks are listed in queue order and the row
 * at `currentIndex` is the one marked as playing. The row keeps its position
 * in the incoming list, so dropping an id-less row cannot shift the marker
 * onto a neighbour — and a track listed twice marks exactly one row.
 */
export function buildWearQueue(
  tracks: Track[] | null | undefined,
  currentIndex: number,
): WearQueueItem[] {
  const list = Array.isArray(tracks) ? tracks : [];
  const safeIndex =
    Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < list.length
      ? currentIndex
      : -1;

  return list
    .map((track, index) => ({ track, index }))
    .filter(
      (row): row is { track: Track; index: number } =>
        !!row.track && typeof row.track.id === "string" && !!row.track.id,
    )
    .map(({ track, index }) => ({
      id: track.id,
      title: text(track.title, "Unknown Title"),
      artist: text(track.artist, UNKNOWN_ARTIST),
      artworkUrl: art(track.thumbnail),
      isCurrent: index === safeIndex,
    }));
}

/**
 * The complication line: title, or `"Artist — Title"` when there is room to
 * say who it is, or empty when there is nothing to show.
 */
export function buildWearComplication(
  track: Track | null | undefined,
  isPlaying: boolean,
): WearComplication {
  if (!track) return { label: "", empty: true };
  const title = text(track.title, "");
  if (!title) return { label: "", empty: true };
  if (!isPlaying) return { label: `⏸ ${title}`, empty: false };
  const artist = text(track.artist, "");
  return { label: artist ? `${artist} — ${title}` : title, empty: false };
}
