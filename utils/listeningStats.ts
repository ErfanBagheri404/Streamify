/**
 * ListeningStats — what this device has listened to, kept on this device.
 *
 * Aggregates, not an event log: a track's total is a counter that goes up
 * while it plays. Reading the summary is a merge of a handful of already
 * finished sums rather than a pass over history.
 *
 * One bucket per calendar month (device timezone), stored as a single
 * AsyncStorage entry per month. Only the bucket being written to is held
 * in memory; the rest are read, merged, released.
 *
 * Nothing leaves the device — no upload, no account, no id.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type StatsTrack = {
  id: string;
  title: string;
  artist?: string;
  albumName?: string;
  thumbnail?: string;
  artistId?: string;
  albumId?: string;
};

type TrackEntry = {
  id: string;
  title: string;
  artist?: string;
  album?: string | null;
  albumId?: string | null;
  artistId?: string | null;
  art?: string | null;
  /** Total ms played. */
  ms: number;
  /** Whole listens (>= PLAY_THRESHOLD_MS). */
  plays: number;
  last: number;
};

type NameEntry = {
  name: string;
  sub?: string | null;
  id?: string | null;
  art?: string | null;
  ms: number;
  plays: number;
};

type StoredBucket = {
  month: string; // YYYY-MM
  tracks: TrackEntry[];
  artists: NameEntry[];
  albums: NameEntry[];
  /** 24 slots: ms listened per hour of day. */
  hours: number[];
  /** day-of-month -> ms. */
  days: Record<string, number>;
};

export type ReplayPeriod = "month" | "year" | "alltime";

export type ReplaySummary = {
  period: ReplayPeriod;
  totalMs: number;
  totalPlays: number;
  topTracks: Array<StatsTrack & { ms: number; plays: number }>;
  topArtists: Array<{ name: string; ms: number; plays: number; art?: string | null }>;
  topAlbums: Array<{ name: string; sub?: string | null; ms: number; plays: number; art?: string | null }>;
  /** 24 slots, ms per hour of day. */
  hours: number[];
  biggestDay?: { date: string; ms: number };
  earliestMonth?: string;
};

const PREFIX = "@listening_stats_";
/** How long a listen must be to count as a play. */
const PLAY_THRESHOLD_MS = 30_000;
/** Buckets kept on disk. */
const KEEP_MONTHS = 24;
/** Entry caps per bucket — what survives is what was actually listened to. */
const MAX_TRACKS = 500;
const MAX_NAMES = 300;
/** Flush at most this often; the numbers are worth losing a few seconds of. */
const FLUSH_INTERVAL_MS = 30_000;

let openBucket: StoredBucket | null = null;
let dirty = false;
let lastFlush = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function emptyBucket(month: string): StoredBucket {
  return { month, tracks: [], artists: [], albums: [], hours: new Array(24).fill(0), days: {} };
}

/** The lead artist, not the credit as a string. */
function primaryArtist(credit?: string): string | null {
  if (!credit) return null;
  const trimmed = credit.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s*(?:,|&|×|feat\.?|ft\.|with)\s*/i)[0]?.trim() || trimmed;
}

/** Album rows merge on album AND artist — "Greatest Hits" is not one release. */
function albumKey(name: string, artist?: string): string {
  return `${primaryArtist(artist) ?? "unknown"}::${name.toLowerCase()}`;
}

async function readBucket(key: string): Promise<StoredBucket | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBucket;
    if (!parsed || parsed.month !== key) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeBucket(bucket: StoredBucket): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + bucket.month, JSON.stringify(bucket));
  } catch (e) {
    console.warn("[ListeningStats] write failed:", e);
  }
}

async function ensureOpenBucket(): Promise<StoredBucket> {
  const key = monthKey();
  if (openBucket && openBucket.month === key) return openBucket;
  // Month rolled over mid-session: persist what the last one held.
  if (openBucket) await writeBucket(openBucket);
  openBucket = (await readBucket(key)) ?? emptyBucket(key);
  dirty = true;
  void pruneOldMonths();
  return openBucket;
}

async function pruneOldMonths() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const monthKeys = keys
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length))
      .sort();
    const excess = monthKeys.slice(0, Math.max(0, monthKeys.length - KEEP_MONTHS));
    if (excess.length > 0) {
      await AsyncStorage.multiRemove(excess.map((k) => PREFIX + k));
    }
  } catch {
    // Housekeeping is best-effort.
  }
}

function trimMaps(bucket: StoredBucket) {
  const byMs = (a: { ms: number }, b: { ms: number }) => b.ms - a.ms;
  if (bucket.tracks.length > MAX_TRACKS) {
    bucket.tracks.sort(byMs);
    bucket.tracks = bucket.tracks.slice(0, MAX_TRACKS);
  }
  if (bucket.artists.length > MAX_NAMES) {
    bucket.artists.sort(byMs);
    bucket.artists = bucket.artists.slice(0, MAX_NAMES);
  }
  if (bucket.albums.length > MAX_NAMES) {
    bucket.albums.sort(byMs);
    bucket.albums = bucket.albums.slice(0, MAX_NAMES);
  }
}

/**
 * Add `playedMs` of `track` to the current month.
 *
 * `countsAsPlay` separates the two things a listener means by "played":
 * minutes accrue on every sample; a *play* is a whole listen, counted once
 * by whoever is watching the track.
 */
export async function recordListening(
  track: StatsTrack,
  playedMs: number,
  countsAsPlay: boolean,
): Promise<void> {
  if (playedMs <= 0 && !countsAsPlay) return;
  if (!track.id) return;
  try {
    const bucket = await ensureOpenBucket();
    const now = Date.now();
    const at = new Date(now);

    let entry = bucket.tracks.find((t) => t.id === track.id);
    if (!entry) {
      entry = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.albumName ?? null,
        albumId: null,
        artistId: null,
        art: track.thumbnail ?? null,
        ms: 0,
        plays: 0,
        last: now,
      };
      bucket.tracks.push(entry);
    }
    entry.ms += playedMs;
    entry.last = now;
    if (countsAsPlay) entry.plays += 1;
    // Filled in as it becomes known: a track queued from search reaches the
    // player with no album.
    if (!entry.album && track.albumName) entry.album = track.albumName;
    if (!entry.artistId && track.artistId) entry.artistId = track.artistId;
    if (!entry.art && track.thumbnail) entry.art = track.thumbnail;

    const lead = primaryArtist(track.artist);
    if (lead) {
      let artist = bucket.artists.find((a) => a.name.toLowerCase() === lead.toLowerCase());
      if (!artist) {
        artist = { name: lead, art: track.thumbnail ?? null, ms: 0, plays: 0 };
        bucket.artists.push(artist);
      }
      artist.ms += playedMs;
      if (countsAsPlay) artist.plays += 1;
      if (!artist.art && track.thumbnail) artist.art = track.thumbnail;
      if (!artist.id && track.artistId) artist.id = track.artistId;
    }

    if (track.albumName?.trim()) {
      const key = albumKey(track.albumName, track.artist);
      let album = bucket.albums.find((a) => albumKey(a.name, a.sub ?? undefined) === key);
      if (!album) {
        album = {
          name: track.albumName,
          sub: track.artist ?? null,
          art: track.thumbnail ?? null,
          ms: 0,
          plays: 0,
        };
        bucket.albums.push(album);
      }
      album.ms += playedMs;
      if (countsAsPlay) album.plays += 1;
    }

    bucket.hours[at.getHours()] += playedMs;
    const day = String(at.getDate());
    bucket.days[day] = (bucket.days[day] ?? 0) + playedMs;

    dirty = true;
    scheduleFlush();
  } catch (e) {
    console.warn("[ListeningStats] record failed:", e);
  }
}

function scheduleFlush() {
  const now = Date.now();
  if (now - lastFlush < FLUSH_INTERVAL_MS) {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushListeningStats();
      }, FLUSH_INTERVAL_MS - (now - lastFlush));
    }
    return;
  }
  void flushListeningStats();
}

/** Write the open month out, if anything has changed. */
export async function flushListeningStats(): Promise<void> {
  lastFlush = Date.now();
  if (!dirty || !openBucket) return;
  dirty = false;
  trimMaps(openBucket);
  await writeBucket(openBucket);
}

/** Flush + persist immediately (call on app backgrounding). */
export function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return flushListeningStats();
}

async function listMonths(): Promise<string[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length))
      .sort();
  } catch {
    return [];
  }
}

function periodCovers(month: string, period: ReplayPeriod): boolean {
  if (period === "alltime") return true;
  const now = new Date();
  const [y, m] = month.split("-").map(Number);
  if (period === "year") return y === now.getFullYear();
  if (period === "month") return y === now.getFullYear() && m === now.getMonth() + 1;
  return false;
}

/**
 * The summary for a period, merged off disk. The open bucket is flushed
 * first so the page agrees with what has just been playing.
 */
export async function loadReplaySummary(period: ReplayPeriod): Promise<ReplaySummary> {
  await flushListeningStats();
  const months = await listMonths();
  const relevant = months.filter((m) => periodCovers(m, period));

  const totalMs = { v: 0 };
  const totalPlays = { v: 0 };
  const tracks = new Map<string, TrackEntry>();
  const artists = new Map<string, NameEntry>();
  const albums = new Map<string, NameEntry>();
  const hours = new Array(24).fill(0);
  const days = new Map<string, number>();

  for (const month of relevant) {
    const bucket = (await readBucket(month)) ?? emptyBucket(month);
    for (const t of bucket.tracks) {
      const cur = tracks.get(t.id);
      if (cur) {
        cur.ms += t.ms;
        cur.plays += t.plays;
      } else {
        tracks.set(t.id, { ...t });
      }
    }
    for (const a of bucket.artists) {
      const lead = primaryArtist(a.name) ?? a.name;
      const key = lead.toLowerCase();
      const cur = artists.get(key);
      if (cur) {
        cur.ms += a.ms;
        cur.plays += a.plays;
      } else {
        artists.set(key, { ...a, name: lead });
      }
    }
    for (const al of bucket.albums) {
      const key = albumKey(al.name, al.sub ?? undefined);
      const cur = albums.get(key);
      if (cur) {
        cur.ms += al.ms;
        cur.plays += al.plays;
      } else {
        albums.set(key, { ...al });
      }
    }
    for (let h = 0; h < 24; h++) hours[h] += bucket.hours[h] ?? 0;
    for (const [d, ms] of Object.entries(bucket.days)) {
      const date = `${month}-${d.padStart(2, "0")}`;
      days.set(date, (days.get(date) ?? 0) + ms);
    }
    totalMs.v += bucket.tracks.reduce((sum, t) => sum + t.ms, 0);
    totalPlays.v += bucket.tracks.reduce((sum, t) => sum + t.plays, 0);
  }

  let biggestDay: ReplaySummary["biggestDay"];
  for (const [date, ms] of days) {
    if (!biggestDay || ms > biggestDay.ms) biggestDay = { date, ms };
  }

  const topTracks = [...tracks.values()]
    .sort((a, b) => b.ms - a.ms || b.plays - a.plays)
    .slice(0, 25)
    .map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist ?? undefined,
      albumName: t.album ?? undefined,
      thumbnail: t.art ?? undefined,
      artistId: t.artistId ?? undefined,
      albumId: t.albumId ?? undefined,
      ms: t.ms,
      plays: t.plays,
    }));

  const topArtists = [...artists.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 25);

  const topAlbums = [...albums.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 25);

  return {
    period,
    totalMs: totalMs.v,
    totalPlays: totalPlays.v,
    topTracks,
    topArtists,
    topAlbums,
    hours,
    biggestDay,
    earliestMonth: relevant[0],
  };
}

/**
 * Every bucket on disk, for callers that need whole-month history rather than
 * a display summary. Same read path as `loadReplaySummary` minus the flush:
 * memories are read on screen mount, and forcing a flush there would write on
 * a screen the user may only be passing through.
 */
export async function loadMemoryMonths(): Promise<
  Array<{
    month: string;
    tracks: Array<{
      id: string;
      title: string;
      artist?: string;
      art?: string | null;
      ms: number;
      plays: number;
    }>;
    artists: Array<{ name: string; art?: string | null; ms: number; plays: number }>;
    days: Record<string, number>;
  }>
> {
  const months = await listMonths();
  const out: Array<{
    month: string;
    tracks: Array<{
      id: string;
      title: string;
      artist?: string;
      art?: string | null;
      ms: number;
      plays: number;
    }>;
    artists: Array<{ name: string; art?: string | null; ms: number; plays: number }>;
    days: Record<string, number>;
  }> = [];
  for (const month of months) {
    const bucket = (await readBucket(month)) ?? emptyBucket(month);
    out.push({
      month: bucket.month,
      tracks: bucket.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        art: track.art,
        ms: track.ms,
        plays: track.plays,
      })),
      artists: bucket.artists.map((artist) => ({
        name: artist.name,
        art: artist.art,
        ms: artist.ms,
        plays: artist.plays,
      })),
      days: bucket.days ?? {},
    });
  }
  return out;
}

/** The play-count threshold a caller watching a track should use. */
export const PLAY_COUNT_THRESHOLD_MS = PLAY_THRESHOLD_MS;
