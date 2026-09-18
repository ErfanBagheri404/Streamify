/** Local playback identity survives storage snapshots that omit _isLocal. */
interface LocalPlaybackTrack {
  source?: string;
  _isLocal?: boolean;
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
