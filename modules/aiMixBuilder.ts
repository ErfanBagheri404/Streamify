/********************************************************************
 *  aiMixBuilder.ts — pure AI Mix playlist builder (#49)
 *
 *  On-device, no LLM and no backend. The mix is built from the all-time
 *  replay summary (top artists / tracks / albums) blended with the existing
 *  smart-queue scorer in aiPlaylistService.ts:
 *
 *    - up to 60%: tracks similar to the most-played ones (via buildSmartQueue
 *      anchored on each top track)
 *    - up to 20%: deep cuts from top artists (library tracks by a top artist
 *      that were NOT top tracks themselves)
 *    - up to 10% discovery: same-artist tracks fall through naturally only
 *      when the library offers nothing else — there is no cross-library
 *      catalogue, so discovery here means unheard library tracks
 *
 *  Pure: inputs are plain data, outputs are plain picks. The caller supplies
 *  play counts (read from AsyncStorage there, not here), so the builder has
 *  no storage, React or native dependency and the regression suite can drive
 *  it in Node.
 *******************************************************************/
import { buildSmartQueue } from "./aiPlaylistService";
import type { Track } from "../contexts/PlayerContext";
import type { ReplaySummary } from "../utils/listeningStats";

export const AI_MIX_PLAYLIST_ID = "ai-mix-history";
export const AI_MIX_DEFAULT_SIZE = 25;

export interface AiMixInput {
  summary: ReplaySummary;
  library: Track[];
  /** trackId -> play count, from the all-time replay summary. */
  playCounts?: Map<string, number>;
  size?: number;
}

export interface AiMixPick {
  track: Track;
  /** Why this pick exists — shown in the description, not just code. */
  source: "anchor" | "similar" | "deep-cut";
}

const normalizeArtist = (value: string): string =>
  (value || "").toLowerCase().trim();

const trackKey = (t: { id?: unknown; title?: unknown; artist?: unknown }): string =>
  `${String(t.id ?? "")}|${String(t.title ?? "").toLowerCase()}|${normalizeArtist(
    String(t.artist ?? (t as { author?: unknown }).author ?? ""),
  )}`;

const artistOf = (t: Track): string =>
  normalizeArtist(String(t.artist ?? (t as { author?: unknown }).author ?? ""));

/**
 * Build the AI Mix picks from replay history + library.
 *
 * Anchors are the most-played tracks, resolved to real Track objects in the
 * library when possible. Similar tracks come from buildSmartQueue around each
 * anchor; deep cuts are library tracks by a top artist that are not
 * themselves top tracks. The same normalized key dedupes everywhere, so no
 * song appears twice under two sources.
 */
export function buildAiMixPicks({
  summary,
  library,
  playCounts = new Map<string, number>(),
  size = AI_MIX_DEFAULT_SIZE,
}: AiMixInput): AiMixPick[] {
  if (!Array.isArray(library) || library.length === 0 || size <= 0) {
    return [];
  }

  const libById = new Map<string, Track>();
  for (const t of library) {
    if (t?.id) libById.set(String(t.id), t);
  }

  const topTrackIds = new Set(summary.topTracks.map((t) => String(t.id)));
  const topArtists = new Set(summary.topArtists.map((a) => String(a.name).toLowerCase()));
  const topAlbums = new Set(
    summary.topAlbums.map((a) => String(a.name).toLowerCase()),
  );

  const picked: AiMixPick[] = [];
  const seen = new Set<string>();
  const take = (track: Track, source: AiMixPick["source"]): boolean => {
    if (!track?.id || picked.length >= size) return false;
    const key = trackKey(track);
    if (seen.has(key)) return false;
    seen.add(key);
    picked.push({ track, source });
    return true;
  };

  // Anchors: top tracks resolved to real library Tracks when present. Using
  // the library object keeps artwork/metadata/playability intact instead of
  // manufacturing a Track from a stats row.
  const anchors: Track[] = [];
  for (const tt of summary.topTracks) {
    const lib = libById.get(String(tt.id));
    if (lib) {
      if (take(lib, "anchor")) anchors.push(lib);
    } else {
      // A stats row with no library entry (deleted song, source switch):
      // it can still anchor similarity, but cannot itself play.
      anchors.push({
        id: tt.id,
        title: tt.title,
        artist: tt.artist ?? "",
        thumbnail: tt.thumbnail,
      } as Track);
    }
    if (anchors.length >= Math.ceil(size * 0.3)) break;
    if (picked.length >= size) break;
  }

  // Similar: score the library around each anchor with the proven scorer.
  const anchorBudget = Math.max(0, Math.floor(size * 0.6) - anchors.length);
  if (anchorBudget > 0 && anchors.length > 0) {
    const perAnchor = Math.max(1, Math.ceil(anchorBudget / anchors.length));
    for (const anchor of anchors) {
      if (picked.length >= size) break;
      const similar = buildSmartQueue({
        seed: anchor,
        library,
        size: perAnchor,
        playCounts,
      });
      for (const s of similar) {
        if (picked.length >= size) break;
        // Skip stats-only stubs: similars must be playable library tracks.
        if (!libById.has(String(s.id))) continue;
        take(s, "similar");
      }
    }
  }

  // Deep cuts: library tracks from a top artist (or top album) that are NOT
  // themselves top tracks — the songs the user loves the maker of but hasn't
  // worn out. Lowest play count first: unheard library songs surface before
  // mid-rotation ones.
  if (picked.length < size && topArtists.size > 0) {
    const deepCuts = library
      .filter((t) => {
        if (!t?.id || topTrackIds.has(String(t.id))) return false;
        const a = artistOf(t);
        if (topArtists.has(a)) return true;
        const album = String(
          (t as { albumName?: unknown; album?: unknown }).albumName ??
            (t as { album?: unknown }).album ??
            "",
        ).toLowerCase();
        return album !== "" && topAlbums.has(album);
      })
      .sort(
        (a, b) =>
          (playCounts.get(String(a.id)) ?? 0) - (playCounts.get(String(b.id)) ?? 0),
      );
    const deepBudget = Math.max(0, Math.floor(size * 0.2));
    let taken = 0;
    for (const cut of deepCuts) {
      if (picked.length >= size || taken >= deepBudget) break;
      if (take(cut, "deep-cut")) taken += 1;
    }
  }

  // Fill: anything left in the library by play count, so the mix always
  // reaches its size when the library allows. Never reaches across sources
  // or the network — a partial mix of real songs beats a full one of ghosts.
  if (picked.length < size) {
    const rest = [...library].sort(
      (a, b) =>
        (playCounts.get(String(b.id)) ?? 0) - (playCounts.get(String(a.id)) ?? 0),
    );
    for (const t of rest) {
      if (picked.length >= size) break;
      take(t, "similar");
    }
  }

  return picked.slice(0, size);
}
