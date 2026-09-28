/**
 * Cast metadata + queue transfer (issue #26).
 *
 * The pure half of Chromecast: what the receiver needs to display a track and
 * what a transferred queue looks like. The SDK wiring (session lifecycle,
 * device discovery, the Cast button) needs a real Cast device and is not
 * testable here — this module is the contract that wiring plugs into.
 *
 * Everything is defensive about missing fields: a track with no artist or no
 * artwork must still produce valid receiver metadata, because the receiver
 * renders whatever it is handed.
 */
import type { Track } from "../contexts/PlayerContext";

/** MediaMetadata fields the receiver understands. */
export interface CastMediaMetadata {
  title: string;
  artist: string;
  albumArtist: string;
  /** Absolute URL, or "" when the track has none. */
  imageUrl: string;
  /** Seconds; 0 when unknown. */
  duration: number;
}

/** One item in a transferred queue. */
export interface CastQueueItem {
  mediaId: string;
  title: string;
  artist: string;
  imageUrl: string;
  /** Stream URL the receiver fetches itself. */
  streamUrl: string;
  duration: number;
}

/** A queue ready to hand to the receiver. */
export interface CastQueue {
  items: CastQueueItem[];
  startIndex: number;
}

const UNKNOWN_ARTIST = "Unknown Artist";

function clean(value: string | undefined, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanDuration(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function cleanImageUrl(value: string | undefined): string {
  const url = clean(value);
  if (!url) return "";
  // The receiver fetches this itself, so it must be absolute.
  return /^https?:\/\//i.test(url) ? url : "";
}

/**
 * Receiver metadata for a track. Never throws and never returns null fields:
 * the receiver renders whatever it gets, so a missing artist becomes
 * "Unknown Artist" rather than a blank line.
 */
export function buildCastMetadata(track: Track | null | undefined): CastMediaMetadata {
  if (!track) {
    return {
      title: "Unknown Title",
      artist: UNKNOWN_ARTIST,
      albumArtist: UNKNOWN_ARTIST,
      imageUrl: "",
      duration: 0,
    };
  }
  const artist = clean(track.artist, UNKNOWN_ARTIST);
  return {
    title: clean(track.title, "Unknown Title"),
    artist,
    albumArtist: artist,
    imageUrl: cleanImageUrl(track.thumbnail),
    duration: cleanDuration(track.duration),
  };
}

/**
 * The stream URL the receiver should fetch. Prefers the resolved audioUrl,
 * falls back to the track's own url, and returns "" when neither is absolute —
 * a relative path would 404 on the receiver.
 */
export function castStreamUrl(track: Track | null | undefined): string {
  if (!track) return "";
  return cleanImageUrl(track.audioUrl) || cleanImageUrl(track.url);
}

/**
 * Transfer the current queue to the receiver, starting at the playing track.
 *
 * Tracks without an absolute stream URL are dropped: the receiver cannot play
 * them, and silently skipping is better than handing it a queue that stalls.
 * An empty result means "nothing castable", which the caller surfaces.
 */
export function buildCastQueue(
  tracks: Track[] | null | undefined,
  currentIndex: number,
): CastQueue {
  const list = Array.isArray(tracks) ? tracks : [];
  const items: CastQueueItem[] = [];
  const indexById = new Map<string, number>();

  list.forEach((track, position) => {
    if (!track || typeof track.id !== "string" || !track.id) return;
    const streamUrl = castStreamUrl(track);
    if (!streamUrl) return;
    indexById.set(track.id, items.length);
    items.push({
      mediaId: track.id,
      title: clean(track.title, "Unknown Title"),
      artist: clean(track.artist, UNKNOWN_ARTIST),
      imageUrl: cleanImageUrl(track.thumbnail),
      streamUrl,
      duration: cleanDuration(track.duration),
    });
  });

  const safeIndex =
    Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < list.length
      ? currentIndex
      : 0;
  const startIndex = indexById.get(list[safeIndex]?.id ?? "") ?? 0;

  return { items, startIndex };
}

/** True when the queue has at least one castable item. */
export function isCastable(queue: CastQueue | null | undefined): boolean {
  return !!queue && queue.items.length > 0;
}

/**
 * The next item after `startIndex`, or null at the end. The Cast wiring uses
 * this to advance the receiver queue without re-reading the phone's state.
 */
export function nextCastItem(queue: CastQueue, startIndex: number): CastQueueItem | null {
  const next = startIndex + 1;
  return next >= 0 && next < queue.items.length ? queue.items[next] : null;
}
