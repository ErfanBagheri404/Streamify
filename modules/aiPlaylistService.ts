/********************************************************************
 *  aiPlaylistService.ts — on-device "smart queue" generation
 *
 *  No LLM and no backend endpoint exists for this, and adding either
 *  would make the feature fail offline (this app is built for Iran
 *  where connectivity is flaky) and leak listening history to a third
 *  party. Instead we score the user's own library with a transparent
 *  content-based model:
 *
 *    score = w_seed   * artist/album overlap with the seed track
 *          + w_play   * play count (listeningStats)
 *          + w_fav    * liked-song membership
 *          + w_fresh  * recent-add bonus
 *
 *  The same normalized text keys used by radioService dedupe the result,
 *  so a generated queue never repeats the same song under two sources.
 *******************************************************************/
import type { Track } from "../contexts/PlayerContext";
import { loadReplaySummary } from "../utils/listeningStats";

export interface SmartQueueOptions {
  seed: Track;
  /** Library (liked songs) to draw candidates from. */
  library: Track[];
  /** How many tracks to return (seed excluded). */
  size?: number;
  /** trackId -> play count; omit to score purely on content. */
  playCounts?: Map<string, number>;
}

/** Load play counts for scoring from the all-time replay summary. */
export async function loadPlayCounts(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const summary = await loadReplaySummary("alltime");
    for (const t of summary.topTracks || []) {
      map.set(String(t.id), t.plays);
    }
  } catch {
    // stats unavailable — content-only scoring still works
  }
  return map;
}

const DEFAULT_SIZE = 20;
const W_ARTIST = 6;
const W_ALBUM = 2.5;
const W_TITLE_TOKEN = 1.2;
const W_PLAY = 1.0;
const W_LIKED = 3;

const normalizeKey = (value: string): string =>
  (value || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*\[.*?\]\s*/g, " ")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .trim();

const tokenize = (value: string): Set<string> =>
  new Set(normalizeKey(value).split(" ").filter((t) => t.length > 2));

function artistMatch(a: string, b: string): number {
  const ka = normalizeKey(a);
  const kb = normalizeKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  if (ka.includes(kb) || kb.includes(ka)) return 0.8;
  const ta = tokenize(a);
  const tb = tokenize(b);
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  const union = new Set([...ta, ...tb]).size || 1;
  return hits / union;
}

function titleTokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits++;
  return hits / Math.max(ta.size, tb.size);
}

/**
 * Build a personalized queue from the user's library, biased toward the
 * seed track. Returns [] when the library is too small to say anything
 * useful — the caller decides the fallback (e.g. remote radio).
 */
export function buildSmartQueue(options: SmartQueueOptions): Track[] {
  const { seed, library, size = DEFAULT_SIZE, playCounts } = options;
  if (!seed || !Array.isArray(library) || library.length < 5) {
    return [];
  }

  const seedId = String(seed.id);
  const seedArtist = seed.artist || (seed as any).author || "";
  const seedAlbum = (seed as any).albumName || (seed as any).album || "";
  const seen = new Set<string>([seedId]);
  const seenTitleKeys = new Set<string>();
  const seedTitleKey = normalizeKey(`${seed.title} ${seedArtist}`);
  if (seedTitleKey) seenTitleKeys.add(seedTitleKey);

  type Scored = { track: Track; score: number };
  const scored: Scored[] = [];

  for (const candidate of library) {
    if (!candidate?.id || !candidate.title) continue;
    const cid = String(candidate.id);
    if (cid === seedId) continue;
    const titleKey = normalizeKey(
      `${candidate.title} ${candidate.artist || (candidate as any).author || ""}`,
    );
    if (titleKey && seenTitleKeys.has(titleKey)) continue;

    const candArtist = candidate.artist || (candidate as any).author || "";
    const candAlbum =
      (candidate as any).albumName || (candidate as any).album || "";

    let score = 0;
    score += artistMatch(seedArtist, candArtist) * W_ARTIST;
    if (seedAlbum && candAlbum && normalizeKey(seedAlbum) === normalizeKey(candAlbum)) {
      score += W_ALBUM;
    }
    score += titleTokenOverlap(seed.title || "", candidate.title || "") * W_TITLE_TOKEN;

    const plays = playCounts?.get(cid) ?? 0;
    if (plays > 0) score += Math.min(5, Math.log1p(plays)) * W_PLAY;

    // Liked library entries get a baseline boost; unliked seeds rarely matter.
    score += W_LIKED;

    if (score <= 0) continue;
    scored.push({ track: candidate, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const picked: Track[] = [];
  for (const { track } of scored) {
    if (picked.length >= size) break;
    const cid = String(track.id);
    if (seen.has(cid)) continue;
    const titleKey = normalizeKey(
      `${track.title} ${track.artist || (track as any).author || ""}`,
    );
    if (titleKey && seenTitleKeys.has(titleKey)) continue;
    seen.add(cid);
    if (titleKey) seenTitleKeys.add(titleKey);
    // Drop stale resolved URLs; playTrack re-resolves streams on demand.
    picked.push({ ...track, audioUrl: undefined } as Track);
  }

  console.log(
    `[aiPlaylist] Scored ${scored.length} library candidates, picked ${picked.length}`,
  );
  return picked;
}
