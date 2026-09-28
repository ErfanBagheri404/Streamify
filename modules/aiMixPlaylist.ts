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
function candidatePool(liked: Track[], recent: Track[], topTracks: Track[]): Track[] {
  const seen = new Set<string>();
  const pool: Track[] = [];
  for (const track of [...liked, ...recent, ...topTracks]) {
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

  // Most-played tracks from the replay summary, resolved back to Track
  // objects. The summary stores ids, so match them against the pools we have.
  const topIds = [...playCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const byId = new Map<string, Track>();
  for (const track of [...liked, ...recent]) {
    byId.set(track.id, track);
  }
  const topTracks = topIds
    .map((id) => byId.get(id))
    .filter((t): t is Track => Boolean(t));

  const seed = await pickSeed(liked, recent);
  if (!seed) {
    return null;
  }

  const pool = candidatePool(liked, recent, topTracks);
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
  const existing = (await StorageService.loadPlaylists()).find(
    (p) => p.id === AI_MIX_ID,
  );
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

  if (existing) {
    const rest = (await StorageService.loadPlaylists()).filter(
      (p) => p.id !== AI_MIX_ID,
    );
    await StorageService.savePlaylists([playlist, ...rest]);
  } else {
    await StorageService.addPlaylist(playlist);
  }
  return playlist;
}
