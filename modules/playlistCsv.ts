/**
 * CSV import for playlist transfer (issue #40).
 *
 * Split out from `playlistTransfer` so the quoting rules live in one place:
 * the export (`toCsv`) writes quoted fields and embedded newlines, and the
 * import has to read back exactly what it writes. Without a matching parser,
 * re-importing a CSV the app produced yields one garbage track per line.
 *
 * Pure — no React Native, no storage, no network.
 */
import type { ParsedEntry } from "./playlistTransfer";

/**
 * Split one CSV record into cells, honouring quoted fields, escaped quotes
 * (`""`), and embedded newlines — `toCsv` emits all three.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Join quoted cells back into whole records, so an embedded newline survives. */
function joinCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      // Inside a quoted field "" is a literal quote; outside it opens a field.
      if (quoted && text[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (current.trim()) records.push(current);
      current = "";
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) records.push(current);
  return records;
}

const TITLE_HEADERS = new Set(["title", "name", "track"]);
const ARTIST_HEADERS = new Set(["artist", "albumartist", "performer"]);
const ALBUM_HEADERS = new Set(["album", "albumtitle"]);

/**
 * True when the first record is the `Title,Artist,Album` header this app
 * writes, or an equivalent header pair.
 *
 * Field-count matching was tried and rejected: a PLS or M3U line whose URL
 * carries query commas (`?a=1,b=2`) matches any "same field count" heuristic,
 * which silently rerouted valid playlists to the CSV parser. A real header is
 * unambiguous — a track is not literally named "title,artist,album".
 */
export function looksLikeCsv(text: string): boolean {
  const records = joinCsvRecords(text);
  if (!records.length) return false;

  const cells = splitCsvLine(records[0]).map((c) => c.trim().toLowerCase());
  if (cells.length < 2) return false;
  if (!TITLE_HEADERS.has(cells[0])) return false;
  // "Title,Artist" is enough; a third column is optional.
  return ARTIST_HEADERS.has(cells[1]) ||
    (cells.length >= 3 && ALBUM_HEADERS.has(cells[2]));
}

/**
 * Parse `Title,Artist,Album` CSV (the shape `toCsv` writes). The header row is
 * detected by name, so a headerless file imports as data rather than as a
 * track called "Title". A CSV row carries no playable URL — entries are
 * matched against the library by title.
 */
export function parseCsv(text: string): ParsedEntry[] {
  const records = joinCsvRecords(text);
  const entries: ParsedEntry[] = [];
  let first = true;

  for (const record of records) {
    const cells = splitCsvLine(record);
    const title = (cells[0] ?? "").trim();

    if (first) {
      first = false;
      if (TITLE_HEADERS.has(title.toLowerCase())) continue;
    }
    if (!title && cells.every((c) => !c.trim())) continue;

    const entry: ParsedEntry = { title };
    const artist = (cells[1] ?? "").trim();
    if (artist) entry.artist = artist;
    entries.push(entry);
  }
  return entries;
}
