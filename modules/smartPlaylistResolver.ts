/**
 * Data layer for smart playlists (issue #39).
 *
 * The rule engine in `./smartPlaylists` is pure; this module is the only part
 * that touches storage. It assembles one pool from the stores the app already
 * has — liked songs, play history, and the known-library metadata cache — and
 * evaluates a definition against it.
 */

import { Track } from "../contexts/PlayerContext";
import {
  StorageService,
  getTrackStorageKey,
  loadTrackAddedDates,
} from "../utils/storage";
import { loadTrackPlayStats } from "../utils/listeningStats";
import {
  type MatchableTrack,
  type SmartPlaylistDefinition,
  type SmartRule,
  type SmartRuleField,
  type SmartRuleOperator,
  daysAgoFrom,
  matchRules,
  resolveSmartPlaylist,
} from "./smartPlaylists";

export interface ResolvedSmartPlaylist {
  tracks: Track[];
  /** Total matches before the definition's limit was applied. */
  totalMatches: number;
}

/**
 * Build the merged candidate pool.
 *
 * Order matters for identity: liked songs are read last so their richer
 * metadata wins the dedupe, and a track that is both liked and in history
 * appears once with `isLiked` true.
 */
export async function buildSmartPool(): Promise<MatchableTrack[]> {
  const [likedSongs, history, knownTracks, playStats, addedDates] =
    await Promise.all([
      StorageService.loadLikedSongs(),
      StorageService.loadPreviouslyPlayedSongs(),
      StorageService.loadKnownLibraryTracks(),
      loadTrackPlayStats(),
      loadTrackAddedDates(),
    ]);

  const likedKeys = new Set(likedSongs.map((track) => getTrackStorageKey(track)));
  const now = Date.now();
  const byKey = new Map<string, MatchableTrack>();

  const consider = (track: Track, liked: boolean) => {
    const key = getTrackStorageKey(track);
    if (!key || key === ":") return;
    const stats = playStats.get(track.id);
    const entry: MatchableTrack = {
      id: track.id,
      title: track.title || "",
      artist: track.artist,
      source: track.source,
      plays: stats?.plays ?? 0,
      lastPlayedDaysAgo: daysAgoFrom(stats?.lastPlayedAt, now),
      addedDaysAgo: daysAgoFrom(addedDates.get(key), now),
      isLiked: liked,
    };
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      return;
    }
    // Merge rather than replace: a track seen in two stores should keep the
    // liked flag and the better (smaller) recency value.
    byKey.set(key, {
      ...existing,
      artist: existing.artist || entry.artist,
      source: existing.source || entry.source,
      plays: Math.max(existing.plays, entry.plays),
      lastPlayedDaysAgo:
        existing.lastPlayedDaysAgo === undefined
          ? entry.lastPlayedDaysAgo
          : entry.lastPlayedDaysAgo === undefined
            ? existing.lastPlayedDaysAgo
            : Math.min(existing.lastPlayedDaysAgo, entry.lastPlayedDaysAgo),
      addedDaysAgo:
        existing.addedDaysAgo === undefined
          ? entry.addedDaysAgo
          : entry.addedDaysAgo === undefined
            ? existing.addedDaysAgo
            : Math.min(existing.addedDaysAgo, entry.addedDaysAgo),
      isLiked: existing.isLiked || liked,
    });
  };

  // Cache first so liked entries (read after) win on identity.
  for (const track of knownTracks) {
    consider(track, likedKeys.has(getTrackStorageKey(track)));
  }
  for (const track of history) {
    consider(track, likedKeys.has(getTrackStorageKey(track)));
  }
  for (const track of likedSongs) {
    consider(track, true);
  }

  return [...byKey.values()];
}

/**
 * Resolve a definition to real `Track` objects for playback.
 *
 * The pool only carries match attributes, so the ranked ids are mapped back to
 * the source list to recover artwork, URLs, and source flags. An id that no
 * longer maps is skipped rather than yielding a half-built track.
 */
export async function resolveSmartPlaylistTracks(
  definition: SmartPlaylistDefinition,
): Promise<ResolvedSmartPlaylist> {
  const [pool, likedSongs, history, knownTracks] = await Promise.all([
    buildSmartPool(),
    StorageService.loadLikedSongs(),
    StorageService.loadPreviouslyPlayedSongs(),
    StorageService.loadKnownLibraryTracks(),
  ]);

  const ranked = resolveSmartPlaylist(definition, pool);
  const totalMatches = pool.filter((entry) =>
    matchRules(entry, definition.rules, definition.chain),
  ).length;

  const trackById = new Map<string, Track>();
  // Liked last so it wins, matching the pool's identity rule.
  for (const track of [...knownTracks, ...history, ...likedSongs]) {
    if (track?.id) trackById.set(track.id, track);
  }

  const tracks: Track[] = [];
  for (const entry of ranked) {
    const track = trackById.get(entry.id);
    if (track) tracks.push(track);
  }

  return { tracks, totalMatches };
}

// ---------------------------------------------------------------------------
// Display labels (kept here so the engine stays free of presentation strings)
// ---------------------------------------------------------------------------

export const SMART_FIELD_LABELS: Record<SmartRuleField, [string, string]> = {
  plays: ["Plays", "پخش"],
  lastPlayedDaysAgo: ["Last played (days ago)", "آخرین پخش (روز پیش)"],
  addedDaysAgo: ["Added (days ago)", "افزوده‌شده (روز پیش)"],
  isLiked: ["Liked", "پسندیده"],
  source: ["Source", "منبع"],
  artist: ["Artist", "هنرمند"],
  title: ["Title", "عنوان"],
};

export const SMART_OPERATOR_LABELS: Record<SmartRuleOperator, [string, string]> =
  {
    gte: ["is at least", "حداقل"],
    lte: ["is at most", "حداکثر"],
    equals: ["is", "برابر است با"],
    contains: ["contains", "شامل"],
    notContains: ["does not contain", "شامل نیست"],
  };

export function smartRuleLabel(
  rule: SmartRule,
  language: string,
): string {
  const index = language === "fa" ? 1 : 0;
  const field = SMART_FIELD_LABELS[rule.field][index];
  if (rule.field === "isLiked") {
    return rule.value === true ? field : `${field} = no`;
  }
  const operator = SMART_OPERATOR_LABELS[rule.operator][index];
  return `${field} ${operator} ${rule.value}`;
}

/** Localized join word used between rules of a definition. */
export function smartChainWord(
  definition: SmartPlaylistDefinition,
  language: string,
): string {
  if (language === "fa") return definition.chain === "or" ? "یا" : "و";
  return definition.chain === "or" ? "OR" : "AND";
}
