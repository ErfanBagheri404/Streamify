import { buildSmartQueue, loadPlayCounts } from "./aiPlaylistService";
import { buildRadioQueue } from "./radioService";
import type { Track } from "../contexts/PlayerContext";

/**
 * Seeded queue builder shared by the full-player "Smart queue from library"
 * action and the launcher shortcut (issue #34).
 *
 * Preference order: local liked-library similarity, then a remote radio built
 * from the seed. Returns at least the seed so the caller always has a queue
 * to start.
 */
export async function buildSeededQueue(
  seed: Track,
  library: Track[],
  size = 20,
): Promise<Track[]> {
  try {
    const playCounts = await loadPlayCounts();
    const smartQueue = buildSmartQueue({ seed, library, size, playCounts });
    // Empty result = library too small to say anything — fall through to the
    // remote radio path so the user still gets a queue.
    if (smartQueue.length > 0) {
      return [seed, ...smartQueue];
    }
    return await buildRadioQueue(seed);
  } catch (error) {
    console.log("[seededQueue] Smart queue failed:", error);
    return [seed];
  }
}

/** Fisher-Yates on a copy. */
export function shuffleTracks<T>(tracks: T[]): T[] {
  const out = [...tracks];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
