/**
 * Share-moment links (issue #33).
 *
 * A share link must survive being opened on a device that has never seen the
 * track: the library is local, so the URL carries enough metadata to rebuild a
 * playable Track (id + source) and the second to resume from.
 *
 * Format: `streamify://track/{id}?t={seconds}&s={source}&n={title}&a={artist}`
 * `t` is plain seconds — `1:23` is a display format, not a wire format, so
 * nothing has to guess whether a value is mm:ss or hh:mm:ss.
 */

export type ShareMoment = {
  id: string;
  /** Resume position in seconds. 0 when the link carries no timestamp. */
  seconds: number;
  source?: string;
  title?: string;
  artist?: string;
};

const PREFIX = "streamify://track/";

/** 83 -> "1:23"; 3723 -> "1:02:03". Used for display and share text. */
export function formatTimestamp(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** Parse "1:23" / "1:02:03" / "83" into seconds. Returns null when unusable. */
export function parseTimestamp(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (!trimmed.includes(":")) {
    const plain = Number(trimmed);
    return Number.isFinite(plain) && plain >= 0 ? Math.floor(plain) : null;
  }

  const parts = trimmed.split(":");
  if (parts.length > 3) return null;

  let total = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) return null;
    total = total * 60 + value;
  }
  return Math.floor(total);
}

/**
 * Build the link for a track at a position. `seconds` is floored, so sharing
 * twice inside the same second produces an identical URL.
 */
export function buildShareMomentUrl(
  track: { id?: string; source?: string; title?: string; artist?: string },
  positionSeconds: number,
): string | null {
  if (!track.id) return null;

  const params = new URLSearchParams();
  const seconds = Math.floor(
    Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : 0,
  );
  if (seconds > 0) params.set("t", String(seconds));
  if (track.source) params.set("s", track.source);
  if (track.title) params.set("n", track.title);
  if (track.artist) params.set("a", track.artist);

  const query = params.toString();
  return `${PREFIX}${encodeURIComponent(track.id)}${query ? `?${query}` : ""}`;
}

/**
 * Parse a share-moment URL. Returns null for anything that is not one, so the
 * launcher-shortcut actions (`streamify://resume`, ...) keep working and an
 * unrelated link is ignored rather than misread as a track.
 */
export function parseShareMomentUrl(url: string | null | undefined): ShareMoment | null {
  if (!url || !url.startsWith(PREFIX)) return null;

  const [rawId, query = ""] = url.slice(PREFIX.length).split("?");
  const id = decodeURIComponent(rawId || "").trim();
  if (!id) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(query);
  } catch {
    params = new URLSearchParams();
  }

  const seconds = parseTimestamp(params.get("t")) ?? 0;
  const moment: ShareMoment = { id, seconds };

  const source = params.get("s");
  const title = params.get("n");
  const artist = params.get("a");
  if (source) moment.source = source;
  if (title) moment.title = title;
  if (artist) moment.artist = artist;

  return moment;
}

/** The human-facing share text: title, artist, then the timestamped link. */
export function buildShareMessage(
  moment: ShareMoment,
  url: string,
): string {
  const heading = [moment.title, moment.artist].filter(Boolean).join(" — ");
  const at = moment.seconds > 0 ? ` (${formatTimestamp(moment.seconds)})` : "";
  return heading ? `${heading}${at}\n${url}` : url;
}
