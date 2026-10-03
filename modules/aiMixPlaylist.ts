import type { Track } from "../contexts/PlayerContext";
import { StorageService, type Playlist } from "../utils/storage";
import { buildSmartQueue, loadPlayCounts } from "./aiPlaylistService";

/** Stable id, so regenerating replaces the mix instead of stacking copies. */
export const AI_MIX_ID = "@ai_mix";

const MIX_SIZE = 30;

/** Playlist name in both languages; the id is what the code keys on. */
export function aiMixName(language: "en" | "fa"): string {
  return language === "fa" ? "میکس هوش مصنوعی" : "AI Mix";
}

/**
 * The seed: what the user actually listens to, not just what they liked.
 * Falls back to the most recent track when nothing has been played yet.
 */
async function pickSeed(liked: Track[], recent: Track[]): Promise<Track | null> {
  if (recent.length) {
    return recent[0];
  }
  if (liked.length) {
    return liked[0];
  }
  return null;
}

/**
 * Candidate pool. buildSmartQueue scores a seed against a library, so the
 * pool has to be broader than the liked list: everything the user has
 * touched gives the discovery slice something to reach for.
 */
function candidatePool(liked: Track[], recent: Track[]): Track[] {
  const seen = new Set<string>();
  const pool: Track[] = [];
  for (const track of [...liked, ...recent]) {
    if (!track?.id || seen.has(track.id)) {
      continue;
    }
    seen.add(track.id);
    pool.push(track);
  }
  return pool;
}

/**
 * Build (or rebuild) the pinned AI Mix playlist from listening history.
 * Returns the stored playlist, or null when there is not enough history to
 * say anything — the caller shows that honestly rather than saving an
 * arbitrary list under a name that promises curation.
 */
export async function generateAiMixPlaylist(
  language: "en" | "fa",
): Promise<Playlist | null> {
  const [liked, recent, playCounts] = await Promise.all([
    StorageService.loadLikedSongs(),
    StorageService.loadPreviouslyPlayedSongs(),
    loadPlayCounts(),
  ]);

  // Most-played tracks are not a separate source: playCounts only holds ids
  // that came from liked/recent history, so resolving them back to Track
  // objects would only re-add entries the pool already contains. The counts
  // themselves are still passed to buildSmartQueue for scoring.
  const seed = await pickSeed(liked, recent);
  if (!seed) {
    return null;
  }

  const pool = candidatePool(liked, recent);
  const tracks = buildSmartQueue({
    seed,
    library: pool,
    size: MIX_SIZE,
    playCounts,
  });
  if (!tracks.length) {
    return null;
  }

  const now = new Date().toISOString();
  // Read once, write once. addPlaylist re-reads the list internally, so
  // going through it here would race another writer's change; and reading
  // twice (once for `existing`, once for `rest`) lets the two disagree.
  const stored = await StorageService.loadPlaylists();
  const existing = stored.find((p) => p.id === AI_MIX_ID);
  const playlist: Playlist = {
    id: AI_MIX_ID,
    name: aiMixName(language),
    description: language === "fa" ? "از تاریخچه پخش شما" : "Built from your listening history",
    tracks,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // The top track's art doubles as the cover: a real image beats a
    // placeholder glyph, and it changes as the mix does.
    thumbnail: tracks[0]?.thumbnail,
  };

  // Replace in place, keep every other playlist, and put the mix first so
  // it stays where the user expects it.
  const rest = stored.filter((p) => p.id !== AI_MIX_ID);
  await StorageService.savePlaylists([playlist, ...rest]);
  return playlist;
}
