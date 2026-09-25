/** Local playback identity survives storage snapshots that omit _isLocal. */
interface LocalPlaybackTrack {
  source?: string;
  _isLocal?: boolean;
  _isSubsonic?: boolean;
  _isPodcast?: boolean;
  audioUrl?: string;
  url?: string;
}

export function isLocalPlaybackUri(value: unknown): value is string {
  return typeof value === "string" && /^(?:file|content):\/\//i.test(value);
}

export function getLocalPlaybackUri(track: LocalPlaybackTrack): string | undefined {
  if (isLocalPlaybackUri(track.audioUrl)) return track.audioUrl;
  if (isLocalPlaybackUri(track.url)) return track.url;
  return undefined;
}

/** Includes downloaded remote tracks; none need network refresh/downloads. */
export function isLocalPlaybackTrack(track: LocalPlaybackTrack): boolean {
  return track._isLocal === true || track.source === "local" ||
    getLocalPlaybackUri(track) !== undefined;
}

export function normalizeLocalPlaybackTrack<T extends LocalPlaybackTrack>(track: T): T {
  if (!isLocalPlaybackTrack(track)) return track;
  const audioUrl = getLocalPlaybackUri(track);
  // Missing device URIs fail closed rather than reusing a stale remote URL.
  return track.audioUrl === audioUrl ? track : { ...track, audioUrl };
}

/** Self-hosted server track (Subsonic/Navidrome/gonic). Its URL is authoritative. */
export function isSubsonicTrack(track: LocalPlaybackTrack): boolean {
  return track._isSubsonic === true || track.source === "subsonic";
}

/** Podcast episode (RSS enclosure). Its audioUrl is authoritative, like server streams. */
export function isPodcastTrack(track: LocalPlaybackTrack): boolean {
  return track._isPodcast === true || track.source === "podcast";
}

/**
 * Tracks that play straight from a URL we already hold: device files,
 * self-hosted server streams, and podcast enclosures. None of them may be
 * handed to a remote resolver, queued for download, or blocked behind a
 * cache-conflict prompt.
 */
export function isDirectPlayTrack(track: LocalPlaybackTrack): boolean {
  return isLocalPlaybackTrack(track) || isSubsonicTrack(track) || isPodcastTrack(track);
}

/** Resolved URL for a direct-play track, or undefined when it has none. */
export function getDirectPlayUri(track: LocalPlaybackTrack): string | undefined {
  if (isLocalPlaybackTrack(track)) return getLocalPlaybackUri(track);
  if (isSubsonicTrack(track)) {
    if (typeof track.audioUrl === "string" && track.audioUrl) return track.audioUrl;
    return track.url || undefined;
  }
  if (isPodcastTrack(track)) {
    if (typeof track.audioUrl === "string" && track.audioUrl) return track.audioUrl;
    return track.url || undefined;
  }
  return undefined;
}
