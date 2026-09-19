/********************************************************************
 *  radioService.ts - Build a "radio" queue from a seed track
 *
 *  Powers "Go to song radio" (FullPlayerModal) and "Play more like this"
 *  (queue rows). It reuses the mixed multi-source search (backend /search/all
 *  first, then YT+YTM+JioSaavn+SoundCloud fan-out), filters out non-playable
 *  results (artists/albums/playlists/channels), dedupes by id and title, and
 *  returns a fresh playlist starting with the seed.
 *
 *  The result is meant to be handed to PlayerContext.playTrack(seed, queue, 0)
 *  — the exact same proven path SearchScreen uses. No TrackPlayer queue
 *  surgery, no index-map risk.
 *******************************************************************/
import { searchAPI } from "./searchAPI";
import type { Track } from "../contexts/PlayerContext";

export const RADIO_QUEUE_SIZE = 15;

const normalizeTitleKey = (value: string): string =>
  (value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*\[.*?\]\s*/g, " ")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .trim();

/** Mirror of SearchScreen's playability check for search results. */
const isPlayableResult = (item: any): boolean => {
  const rawType = String(item?.type || "").toLowerCase();
  if (rawType === "artist" || rawType === "album" || rawType === "playlist") {
    return false;
  }
  if (rawType === "stream" || rawType === "video" || rawType === "song") {
    return true;
  }
  // Unknown type but has a duration → treat as a track (same as SearchScreen).
  return Boolean(item?.duration && item.duration !== "0");
};

const toRadioTrack = (item: any): Track | null => {
  if (!item?.id) {
    return null;
  }
  return {
    id: String(item.id),
    title: item.title || "Unknown Title",
    artist: item.author,
    artistId: item.artistId,
    artistImage: item.artistImage || item.thumbnailUrl || item.img,
    artistSource: item.artistSource || item.playbackSource || item.source || "youtube",
    duration: parseInt(item.duration, 10) || 0,
    thumbnail: item.thumbnailUrl || item.img,
    audioUrl: undefined,
    url: item.href,
    source: item.playbackSource || item.source || "youtube",
    providerHint: item.providerHint,
    _isSoundCloud: item.source === "soundcloud",
    _isJioSaavn: item.playbackSource === "jiosaavn" || item.source === "jiosaavn",
  } as Track;
};

/**
 * Build a radio queue seeded on the given track. Always returns at least the
 * seed itself; never throws (returns [seed] on search failure).
 */
export async function buildRadioQueue(seed: Track): Promise<Track[]> {
  const seedTrack: Track = { ...seed, audioUrl: undefined } as Track;
  const query = [seed.artist, seed.title].filter(Boolean).join(" ").trim();

  if (!query) {
    return [seedTrack];
  }

  let results: any[] = [];
  try {
    results = await searchAPI.searchMixed(query, "all", 1, 25);
  } catch (error) {
    console.log("[Radio] Search failed:", error);
    return [seedTrack];
  }

  const seenIds = new Set<string>([String(seed.id)]);
  const seenTitles = new Set<string>();
  const titleKey = normalizeTitleKey(seed.title || "");
  if (titleKey) {
    seenTitles.add(titleKey);
  }

  const picked: Track[] = [];
  for (const item of results) {
    if (picked.length >= RADIO_QUEUE_SIZE - 1) {
      break;
    }
    if (!isPlayableResult(item)) {
      continue;
    }
    const track = toRadioTrack(item);
    if (!track) {
      continue;
    }
    if (seenIds.has(track.id)) {
      continue;
    }
    const key = normalizeTitleKey(`${track.title} ${track.artist || ""}`);
    if (key && seenTitles.has(key)) {
      continue;
    }
    seenIds.add(track.id);
    if (key) {
      seenTitles.add(key);
    }
    picked.push(track);
  }

  console.log(`[Radio] Built queue of ${picked.length + 1} for seed:`, seed.title);
  return [seedTrack, ...picked];
}
