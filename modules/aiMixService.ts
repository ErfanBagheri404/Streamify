/********************************************************************
 *  aiMixService.ts — the "AI Mix" playlist for issue #49
 *
 *  Owns the side effects the pure builder in aiMixBuilder.ts must not:
 *  reading listening stats, persisting the mix as a stable pinned playlist,
 *  and never throwing into the player UI.
 *
 *  No LLM and no backend: the mix is a transparent, on-device score over
 *  the user's own listening history and library. The app is built for
 *  environments where connectivity is unreliable and listening history
 *  should not leave the device.
 *******************************************************************/
import { StorageService, type Playlist } from "../utils/storage";
import { loadReplaySummary } from "../utils/listeningStats";
import { loadPlayCounts } from "./aiPlaylistService";
import {
  AI_MIX_DEFAULT_SIZE,
  AI_MIX_PLAYLIST_ID,
  buildAiMixPicks,
  type AiMixPick,
} from "./aiMixBuilder";
import type { Track } from "../contexts/PlayerContext";

/**
 * The overflow-menu option key for the AI Mix trigger. Shared between the
 * menu entry and its handler — a literal in two places already drifted once.
 */
export const AI_MIX_OPTION_KEY = "AI Mix from my listening";

/** Cover art for the mix, taken from whatever it is seeded with. */
function coverFor(picks: AiMixPick[]): string | undefined {
  for (const pick of picks) {
    if (pick.track?.thumbnail) return pick.track.thumbnail;
  }
  return undefined;
}

/** How the mix is described in the UI; mirrors the pick composition. */
function describeMix(picks: AiMixPick[]): string {
  const counts = picks.reduce<Record<string, number>>((acc, p) => {
    acc[p.source] = (acc[p.source] ?? 0) + 1;
    return acc;
  }, {});
  const parts: string[] = [];
  if (counts.anchor) parts.push(`${counts.anchor} from your top tracks`);
  if (counts.similar) parts.push(`${counts.similar} similar`);
  if (counts["deep-cut"]) parts.push(`${counts["deep-cut"]} deep cuts`);
  return parts.length ? parts.join(" - ") : "Built from your listening history";
}

/**
 * Generate (or regenerate) the AI Mix and persist it under a stable id, so
 * the Library entry is replaced in place rather than piling up duplicates
 * every time the user taps the sparkle icon.
 *
 * Returns the saved playlist, or null when there is nothing to build from
 * (empty library / no history) or the write failed. Callers treat null as
 * "show nothing happened" rather than an error.
 */
export async function generateAiMix(
  library: Track[],
  size: number = AI_MIX_DEFAULT_SIZE,
): Promise<Playlist | null> {
  if (!Array.isArray(library) || library.length === 0) {
    return null;
  }
  try {
    const [summary, playCounts] = await Promise.all([
      loadReplaySummary("alltime"),
      loadPlayCounts().catch(() => new Map<string, number>()),
    ]);
    const picks = buildAiMixPicks({ summary, library, playCounts, size });
    if (!picks.length) {
      return null;
    }
    const now = new Date().toISOString();
    // Existing entry keeps its createdAt so the Library row does not jump to
    // the top every regeneration.
    const existing = (await StorageService.loadPlaylists()).find(
      (p) => p.id === AI_MIX_PLAYLIST_ID,
    );
    const playlist: Playlist = {
      id: AI_MIX_PLAYLIST_ID,
      name: "AI Mix",
      description: describeMix(picks),
      tracks: picks.map((p) => ({ ...p.track, audioUrl: undefined }) as Track),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      thumbnail: coverFor(picks),
    };
    if (existing) {
      await StorageService.updatePlaylist(playlist);
    } else {
      await StorageService.addPlaylist(playlist);
    }
    return playlist;
  } catch (error) {
    // A failed generation is a missed mix, never a crash in the player.
    console.warn("[aiMix] generation failed:", error);
    return null;
  }
}
