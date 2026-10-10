/**
 * Playlist transfer — M3U/PLS parsing and CSV export (issue #40).
 *
 * Everything here is pure: no React Native imports, no storage, no network.
 * That is deliberate — a parser that only runs on-device can never be tested
 * here, so the format handling lives in one file the regression suite can
 * transpile and drive directly. CSV import lives beside it in `./playlistCsv`.
 */
import { looksLikeCsv, parseCsv } from "./playlistCsv";

export type ParsedEntry = {
  /** Title as written. Doubles as the match key. */
  title: string;
  /** Artist if the line carried one (M3U `#EXTINF:123,Artist - Title`). */
  artist?: string;
  /** Full URI when the line had one. */
  uri?: string;
  /** Duration in seconds if the entry declared one. */
  durationSeconds?: number;
};

/** One line of a plain M3U export, without an #EXTINF header. */
const EXTINF_PATTERN = /^#EXTINF:\s*(-?\d+)\s*(?:,\s*)?(.*)$/i;
/** `#EXTALB:`, `#EXTART:` and friends — headers, not entries. */
const HEADER_PATTERN = /^#/;

function secondsOrNull(raw: string): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/**
 * A malformed percent-escape must not abort a whole playlist: one bad
 * filename (`.../100%.mp3`) must not discard every valid line around it.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Last path segment with its extension removed — the usual display name. */
function titleFromUri(uri: string): string {
  const lastSegment = uri.split("/").pop() ?? uri;
  return safeDecode(lastSegment).replace(/\.[a-z0-9]{1,5}$/i, "");
}

/**
 * Split an `Artist - Title` display string. ` - ` only: a single hyphen is a
 * legitimate part of a song name ("Bohemian Rhapsody - Remastered" is one
 * title, not an artist pair), and guessing otherwise corrupts every export
 * that contains a hyphen.
 */
function splitArtistTitle(value: string): { title: string; artist?: string } {
  const separator = " - ";
  const index = value.indexOf(separator);
  if (index <= 0 || index + separator.length >= value.length) {
    return { title: value.trim() };
  }
  return {
    title: value.slice(index + separator.length).trim(),
    artist: value.slice(0, index).trim(),
  };
}

/**
 * Parse M3U/M3U8 text or a plain list of URIs (one per line).
 *
 * Handles the two real-world shapes: a full export with `#EXTINF` headers, and
 * a bare list of media URLs. Lines that are neither a header nor an absolute
 * URI are kept as titles, because several players emit bare song names.
 */
export function parseM3u(text: string): ParsedEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: ParsedEntry[] = [];

  // Pending #EXTINF header, applied to the next non-header line.
  let pending: { durationSeconds?: number; label: string } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const extinf = line.match(EXTINF_PATTERN);
    if (extinf) {
      pending = {
        durationSeconds: secondsOrNull(extinf[1]),
        label: (extinf[2] ?? "").trim(),
      };
      continue;
    }

    if (HEADER_PATTERN.test(line)) {
      continue;
    }

    const isUri = /^[a-z][a-z0-9+.-]*:\/\//i.test(line);
    const label = pending?.label ?? "";
    const durationSeconds = pending?.durationSeconds;
    pending = null;

    const entry: ParsedEntry = { title: isUri ? line : line };

    if (label) {
      const parsedLabel = splitArtistTitle(label);
      entry.title = parsedLabel.title;
      if (parsedLabel.artist) entry.artist = parsedLabel.artist;
    }

    if (isUri) {
      entry.uri = line;
      if (!label) {
        // A bare URL with no #EXTINF carries no title — fall back to the last
        // path segment minus its extension, which is what most files use as
        // their filename ("My Song.mp3" -> "My Song").
        entry.title = titleFromUri(line);
      }
    }

    if (durationSeconds !== undefined) {
      entry.durationSeconds = durationSeconds;
    }
    entries.push(entry);
  }

  return entries;
}

/** Parse PLS (`[playlist]` / `File1=` / `Title1=` / `Length1=`). */
export function parsePls(text: string): ParsedEntry[] {
  const files = new Map<number, string>();
  const titles = new Map<number, string>();
  const lengths = new Map<number, number>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("[")) continue;

    const equals = line.indexOf("=");
    if (equals <= 0) continue;

    const key = line.slice(0, equals).trim().toLowerCase();
    const value = line.slice(equals + 1).trim();

    const match = key.match(/^(file|title|length)(\d+)$/);
    if (!match) continue;

    const index = Number(match[2]);
    if (match[1] === "file") {
      files.set(index, value);
    } else if (match[1] === "title") {
      titles.set(index, value);
    } else {
      const length = secondsOrNull(value);
      if (length !== undefined) lengths.set(index, length);
    }
  }

  const entries: ParsedEntry[] = [];
  for (const [index, uri] of [...files.entries()].sort((a, b) => a[0] - b[0])) {
    // A present-but-empty Title1= means "no title" — fall back to the URI.
    // An absent Title1= key means the same thing. Both take the URI path.
    const hasTitle = titles.has(index);
    const title = hasTitle ? titles.get(index)!.trim() : "";
    const entry: ParsedEntry = { title: title || titleFromUri(uri) };
    entry.uri = uri;
    const length = lengths.get(index);
    if (length !== undefined && length >= 0) entry.durationSeconds = length;
    entries.push(entry);
  }
  return entries;
}

/** Dispatch on content, not extension — users paste raw text. */
export function parsePlaylistText(text: string): ParsedEntry[] {
  // Strip the BOM toCsv writes so every parser sees clean text.
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];

  // CSV first: a CSV row can contain "file2=" inside a URL, and the PLS
  // signature below would otherwise hijack a perfectly valid CSV import.
  if (looksLikeCsv(trimmed)) return parseCsv(trimmed);

  // Line-anchored PLS signature, so a query string like "?file2=1" on a URL
  // inside an M3U cannot reroute the whole file to the PLS parser.
  if (/^\[playlist\]\s*$/im.test(trimmed) || /^file\d+\s*=/im.test(trimmed)) {
    return parsePls(trimmed);
  }
  return parseM3u(trimmed);
}

/**
 * CSV with a UTF-8 BOM so Excel opens Persian titles correctly instead of
 * rendering mojibake — the single most common complaint about CSV export.
 */
const CSV_BOM = "\uFEFF";

function csvCell(value: string): string {
  // Excel treats a leading =, +, - or @ as a formula — prefix with a quote
  // so an artist named "=Kesha" cannot execute anything in a spreadsheet.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export type CsvRow = { title: string; artist?: string; album?: string };

export function toCsv(rows: CsvRow[]): string {
  const header = ["Title", "Artist", "Album"].map(csvCell).join(",");
  const lines = rows.map((row) =>
    [row.title ?? "", row.artist ?? "", row.album ?? ""]
      .map(csvCell)
      .join(","),
  );
  return `${CSV_BOM}${[header, ...lines].join("\r\n")}\r\n`;
}

export type M3uTrack = {
  title: string;
  artist?: string;
  uri?: string;
  durationSeconds?: number;
};

/**
 * Standard M3U8 export readable by VLC, MPV and desktop players. Lines are
 * CRLF-terminated; #EXTM3U header included.
 */
export function toM3u(tracks: M3uTrack[]): string {
  const lines = ["#EXTM3U"];
  for (const t of tracks) {
    const sec =
      typeof t.durationSeconds === "number" && t.durationSeconds > 0
        ? Math.floor(t.durationSeconds)
        : -1;
    const label = [t.artist, t.title].filter(Boolean).join(" - ");
    lines.push(`#EXTINF:${sec},${label || "Unknown"}`);
    lines.push(t.uri || t.title);
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Basename + M3U8 extension, sanitised so a playlist name cannot escape. */
export function playlistFileName(name: string, extension = "m3u8"): string {
  const safe =
    (name || "playlist")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "playlist";
  return `${safe}.${extension}`;
}

/**
 * Normalise a search key for matching: lowercase, strip punctuation, collapse
 * whitespace. Both sides of every comparison run through this, so an imported
 * `"Shape of You (Lyric)"` and a library `"Shape of You"` compare equal.
 */
export function normalizeMatchKey(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True when the two strings share enough normalized tokens to be one song. */
export function isLikelyMatch(a: string, b: string): boolean {
  const left = normalizeMatchKey(a);
  const right = normalizeMatchKey(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  // One side being a token-subset of the other is the version-suffix case:
  // "Bohemian Rhapsody - Remastered 2011" is the same song as "Bohemian
  // Rhapsody". Jaccard alone scores that 0.5 and rejects it. Requiring at
  // least two tokens on the short side stops a single stray word ("It") from
  // matching any sentence containing it.
  const shorter = Math.min(leftTokens.size, rightTokens.size);
  if (shorter >= 2 && shared === shorter) {
    return true;
  }

  return union > 0 && shared / union >= 0.75;
}
