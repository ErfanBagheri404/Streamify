/**
 * Podcast feed fetching and Track adaptation (#30).
 *
 * The network half. Parsing lives in `podcastFeed.ts` (pure, Node-tested);
 * persistence in `utils/storage.ts`. This file only fetches and maps.
 */

import {
  parsePodcastFeed,
  podcastShowId,
  type PodcastEpisode,
  type PodcastShow,
} from "./podcastFeed";
import type { Track } from "../contexts/PlayerContext";

/** 15s: feeds are static documents, and a hung socket must not wedge a screen. */
const FEED_TIMEOUT_MS = 15_000;
/** Guards a hostile feed from exhausting memory during parse. */
const MAX_FEED_BYTES = 8 * 1024 * 1024;
/** An episode list this long is a feed bug, not a library. */
const MAX_EPISODES_PER_SHOW = 500;

export type FeedFetchResult =
  | { ok: true; show: PodcastShow; episodes: PodcastEpisode[]; skippedItems: number }
  | { ok: false; error: string };

/** True for URLs we can fetch as a feed (http/https only). */
export function isFetchableFeedUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function friendlyFetchError(status?: number): string {
  if (status === 404) return "Feed not found (404)";
  if (status === 401 || status === 403) return "Feed refused access";
  if (status === 429) return "Feed rate-limited, try again later";
  if (status && status >= 500) return `Feed server error (${status})`;
  return "Could not reach that feed";
}

/**
 * Fetches and parses a feed. Returns a typed failure rather than throwing so
 * the subscribe sheet can show the reason inline.
 */
export async function fetchPodcastFeed(feedUrl: string): Promise<FeedFetchResult> {
  if (!isFetchableFeedUrl(feedUrl)) {
    return { ok: false, error: "Enter a valid http(s) feed URL" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!response.ok) {
      return { ok: false, error: friendlyFetchError(response.status) };
    }
    const xml = await response.text();
    if (xml.length > MAX_FEED_BYTES) {
      return { ok: false, error: "Feed is too large to parse" };
    }

    const parsed = parsePodcastFeed(feedUrl, xml);
    if (parsed.episodes.length === 0) {
      return {
        ok: false,
        error: "No playable episodes found in that feed",
      };
    }
    return {
      ok: true,
      show: parsed.show,
      episodes: parsed.episodes.slice(0, MAX_EPISODES_PER_SHOW),
      skippedItems: parsed.skippedItems,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { ok: false, error: "Feed timed out" };
    }
    return { ok: false, error: friendlyFetchError() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Maps an episode onto a Track. The enclosure URL is authoritative, so the
 * track is flagged direct-play: it is never handed to a remote resolver and
 * never auto-downloaded.
 */
export function podcastEpisodeToTrack(
  episode: PodcastEpisode,
  show?: PodcastShow,
): Track {
  return {
    id: episode.id,
    title: episode.title,
    artist: show?.title,
    duration: episode.durationSeconds,
    thumbnail: episode.artworkUrl || show?.artworkUrl,
    audioUrl: episode.audioUrl,
    url: episode.audioUrl,
    source: "podcast",
    _isPodcast: true,
    // A finished episode has no resume point; a fresh one starts at 0.
    _resumeAtSeconds: episode.played ? undefined : episode.positionSeconds,
  };
}

export const episodePlayableLabel = (episode: PodcastEpisode): string => {
  if (episode.played) return "Played";
  if (!episode.positionSeconds) return "Unplayed";
  const minutes = Math.floor(episode.positionSeconds / 60);
  if (minutes < 1) return "In progress";
  return `${minutes} min in`;
};

export { podcastShowId };
