/**
 * Per-track lyric sync offset (issue #37).
 *
 * Some LRC files are authored a second or two early/late; the only fix is a
 * manual nudge, and it has to survive an app restart. The map is kept small
 * (one entry per nudged track) and persisted through the existing
 * AsyncStorage-backed settings channel so no new dependency is needed.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// Local, not a shared util: every file in this repo defines its own one-liner
// clamp, and a shared math module would be a second place to maintain it.
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const STORAGE_KEY = "@lyrics_sync_offsets";
/** Beyond +/-10s a "fix" is really a broken file; refuse to store it. */
export const MAX_LYRICS_OFFSET_SECONDS = 10;
const MAX_TRACKED_OFFSETS = 500;

function readStored(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, number> = {};
    for (const [trackId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!trackId || typeof value !== "number" || !Number.isFinite(value)) continue;
      const clamped = clamp(value, -MAX_LYRICS_OFFSET_SECONDS, MAX_LYRICS_OFFSET_SECONDS);
      if (clamped !== 0) result[trackId] = clamped;
    }
    return result;
  } catch {
    return {};
  }
}

let cache: Record<string, number> | null = null;
let inflight: Promise<Record<string, number>> | null = null;

async function load(): Promise<Record<string, number>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        cache = readStored(raw);
        return cache;
      })
      .catch((error) => {
        console.warn("[LyricsOffset] Failed to read offsets:", error);
        cache = {};
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Offset in seconds for a track. 0 means "no correction stored". */
export async function getLyricsOffset(trackId: string): Promise<number> {
  if (!trackId) return 0;
  const map = await load();
  return map[trackId] ?? 0;
}

export async function setLyricsOffset(
  trackId: string,
  seconds: number,
): Promise<number> {
  if (!trackId) return 0;
  const map = { ...(await load()) };
  const clamped = clamp(
    Math.round(seconds * 10) / 10,
    -MAX_LYRICS_OFFSET_SECONDS,
    MAX_LYRICS_OFFSET_SECONDS,
  );

  if (clamped === 0) {
    delete map[trackId];
  } else {
    map[trackId] = clamped;
  }

  // Bound the map: an unbounded per-track table is a slow leak on a phone.
  const keys = Object.keys(map);
  if (keys.length > MAX_TRACKED_OFFSETS) {
    keys
      .slice(0, keys.length - MAX_TRACKED_OFFSETS)
      .forEach((key) => delete map[key]);
  }

  cache = map;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  return clamped;
}

export async function clearLyricsOffset(trackId: string): Promise<void> {
  if (!trackId) return;
  await setLyricsOffset(trackId, 0);
}

/**
 * Apply a stored offset to a playback position before it is compared against
 * lyric timestamps. A positive offset means the file runs late, so we look
 * further ahead in the timeline.
 */
export function applyLyricsOffset(
  positionSeconds: number,
  offsetSeconds: number,
): number {
  return positionSeconds + offsetSeconds;
}

/** Test seam: drops the in-memory cache so a fresh read hits storage. */
export function __resetLyricsOffsetCache(): void {
  cache = null;
  inflight = null;
}
