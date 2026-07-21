export interface LyricsTrack {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
}

export interface LyricsCacheEntry {
  lyrics: string;
  artistName: string;
  trackName: string;
  trackId: string;
  searchEngine: string;
  isSynced?: boolean;
  cachedAt: number;
  requestUrl?: string;
}

export interface TimedLyricLine {
  text: string;
  startTime: number;
  endTime: number;
}

export interface LyricsCandidate {
  artist: string;
  title: string;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s{2,}/g, " ").trim();
}

function stripDecorators(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\s*[\[\(\{][^\]\)\}]*[\]\)\}]\s*/g, " ")
      .replace(
        /\b(official|lyrics?|lyric|video|audio|hd|4k|remaster|re-master|remix|cover|acoustic|live|clean|explicit|amv|pmv)\b/gi,
        " ",
      )
      .replace(/\s*-\s*topic\s*/gi, " ")
      .replace(/\s*vevo\s*/gi, " ")
      .replace(/[#⬆↗▶️🔔©®™]/g, " "),
  );
}

function stripFeatureSegments(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.+$/i, "")
      .replace(/\s*,\s*(?:ft\.?|feat\.?|featuring)\s+.+$/i, "")
      .replace(/\s+\|\s+.+$/i, ""),
  );
}

function sanitizeArtistValue(artist: string): string {
  if (!artist) return "";

  return normalizeWhitespace(
    artist
      .replace(/\s*-\s*topic/gi, "")
      .replace(/\s*vevo/gi, "")
      .replace(/[#⬆↗]/g, " ")
      .replace(/\s*\((?:ft\.?|feat\.?|featuring)\s+[^)]+\)/gi, "")
      .replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.+$/i, "")
      .replace(/\s*[\/|]\s*.+$/i, ""),
  );
}

function extractPrimaryArtist(artist: string): string {
  const sanitizedArtist = sanitizeArtistValue(artist);
  return normalizeWhitespace(
    sanitizedArtist
      .split(/,|&| x | X | and /)
      .map((part) => part.trim())
      .filter(Boolean)[0] || sanitizedArtist,
  );
}

export function cleanArtist(artist: string): string {
  return sanitizeArtistValue(artist);
}

function buildTitleVariants(title: string): string[] {
  const normalizedTitle = normalizeWhitespace(title);
  if (!normalizedTitle) return [];

  const variants = [
    normalizedTitle.replace(/^([^-|–—]+)\s*[-–—|]\s*/, ""),
    normalizedTitle.replace(/^([^-:]+):\s*/, ""),
    normalizedTitle,
  ];

  const unique = new Set<string>();
  return variants
    .map((variant) => stripFeatureSegments(stripDecorators(variant)))
    .filter((variant) => {
      if (!variant) return false;
      const key = variant.toLowerCase();
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    });
}

export function cleanTitle(title: string): string {
  return buildTitleVariants(title)[0] || "";
}

export function extractArtistFromTitle(title: string): string {
  const match = title.match(/^([^-|–—]+)\s*[-–—|]\s*(.+)$/i);
  return cleanArtist(match?.[1]?.trim() || "");
}

export function hasTimestampedLyrics(lyrics: string): boolean {
  return /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics);
}

export function getTrackCacheKey(track: LyricsTrack): string {
  const artistKey =
    cleanArtist(track.artist || "") || extractArtistFromTitle(track.title);
  const titleKey = cleanTitle(track.title);
  return `${track.id}::${artistKey.toLowerCase()}::${titleKey.toLowerCase()}`;
}

export function buildLyricsCandidates(track: LyricsTrack): LyricsCandidate[] {
  const rawTitle = normalizeWhitespace(track.title);
  const extractedArtist = extractArtistFromTitle(rawTitle);
  const titleVariants = buildTitleVariants(rawTitle);
  const artistVariants = [
    extractedArtist,
    extractPrimaryArtist(extractedArtist),
    cleanArtist(track.artist || ""),
    extractPrimaryArtist(track.artist || ""),
  ];

  const uniqueArtists = new Set<string>();
  const normalizedArtists = artistVariants.filter((variant) => {
    const normalizedVariant = normalizeWhitespace(variant);
    if (!normalizedVariant) return false;
    const key = normalizedVariant.toLowerCase();
    if (uniqueArtists.has(key)) return false;
    uniqueArtists.add(key);
    return true;
  });

  const candidates: LyricsCandidate[] = [];
  for (const artist of normalizedArtists) {
    for (const title of titleVariants) {
      candidates.push({ artist, title });
    }
  }

  const uniqueCandidates = new Set<string>();
  return candidates.filter((candidate) => {
    const normalizedCandidate = {
      artist: cleanArtist(candidate.artist),
      title: cleanTitle(candidate.title),
    };
    if (!normalizedCandidate.artist || !normalizedCandidate.title) return false;
    const key = `${normalizedCandidate.artist.toLowerCase()}::${normalizedCandidate.title.toLowerCase()}`;
    if (uniqueCandidates.has(key)) return false;
    uniqueCandidates.add(key);
    return true;
  });
}

function parseTimestampToSeconds(
  minutes: string,
  seconds: string,
  fraction?: string,
): number {
  const parsedMinutes = Number(minutes);
  const parsedSeconds = Number(seconds);
  const parsedFraction = fraction
    ? Number(`0.${fraction.padEnd(3, "0").slice(0, 3)}`)
    : 0;

  return parsedMinutes * 60 + parsedSeconds + parsedFraction;
}

function parseTimestampedLyrics(
  lyrics: string,
  durationSeconds?: number,
): TimedLyricLine[] {
  const timestampPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const entries: Array<{ text: string; startTime: number }> = [];

  for (const rawLine of lyrics.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const matches = [...line.matchAll(timestampPattern)];
    if (!matches.length) continue;

    const text = line.replace(timestampPattern, "").trim();
    if (!text) continue;

    for (const match of matches) {
      entries.push({
        text,
        startTime: parseTimestampToSeconds(match[1], match[2], match[3]),
      });
    }
  }

  if (!entries.length) return [];

  const sortedEntries = entries.sort(
    (left, right) => left.startTime - right.startTime,
  );
  const fallbackDuration = Math.max(
    durationSeconds || 0,
    sortedEntries.length > 0
      ? sortedEntries[sortedEntries.length - 1]?.startTime || 0
      : 0,
  );

  return sortedEntries.map((entry, index) => ({
    text: entry.text,
    startTime: entry.startTime,
    endTime:
      sortedEntries[index + 1]?.startTime ??
      Math.max(fallbackDuration, entry.startTime + 2),
  }));
}

export function buildTimedLyrics(
  lyrics: string,
  durationSeconds?: number,
): TimedLyricLine[] {
  return parseTimestampedLyrics(lyrics, durationSeconds);
}

export function findActiveLyricIndex(
  timedLyrics: TimedLyricLine[],
  currentTime: number,
): number {
  if (!timedLyrics.length) return -1;

  const switchDelaySeconds = 0.1;

  for (let index = 0; index < timedLyrics.length; index += 1) {
    const line = timedLyrics[index];
    const nextLine = timedLyrics[index + 1];
    const effectiveEnd = nextLine
      ? Math.max(line.endTime, nextLine.startTime + switchDelaySeconds)
      : line.endTime + switchDelaySeconds;

    if (currentTime >= line.startTime && currentTime < effectiveEnd) {
      return index;
    }
  }

  if (currentTime < timedLyrics[0].startTime) {
    return 0;
  }

  return timedLyrics.length - 1;
}
