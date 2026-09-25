/**
 * Yearly listening throwbacks ("On This Day", issue #38).
 *
 * Reconstructed from the monthly `listeningStats` buckets, which are the only
 * history this device keeps. Their granularity is a constraint worth stating
 * plainly, because it shapes what a "memory" can honestly be:
 *
 * - `days` records **milliseconds listened per calendar day**, not per track.
 *   So the day is exact, and its total listening time is exact.
 * - `tracks` records per-track totals **for the whole month**, with only the
 *   most recent play timestamp (`last`). There is no per-track-per-day record,
 *   so "you had this song on repeat that day" cannot be reconstructed.
 *
 * A memory therefore pairs an exact day and day-total with the month's top
 * tracks as the era's soundtrack, and `exact` vs `approx` fields carry that
 * distinction into the UI rather than blurring it.
 *
 * Pure module: buckets are passed in, nothing is read from storage here.
 */

/** The subset of a stored month bucket this module needs. */
export interface MemoryMonthSource {
  month: string; // YYYY-MM
  tracks: Array<{
    id: string;
    title: string;
    artist?: string;
    art?: string | null;
    ms: number;
    plays: number;
  }>;
  artists?: Array<{ name: string; art?: string | null; ms: number; plays: number }>;
  /** day-of-month -> ms listened that day. */
  days: Record<string, number>;
}

export interface MemoryEntry {
  id: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  /** Whole-month figures, not the day's — see the module note. */
  ms: number;
  plays: number;
}

export interface MemoryArtistEntry {
  name: string;
  ms: number;
  plays: number;
}

export interface YearlyMemory {
  /** Stable across runs for the same date. */
  id: string;
  /** 1 for last year, 2 for the year before, ... */
  yearsAgo: number;
  /** The historic date, `YYYY-MM-DD`. */
  date: string;
  /** `MM-DD`, the key a reminder deep-link can carry. */
  monthDay: string;
  /** Milliseconds listened that day, exact. */
  listenedMs: number;
  /**
   * Milliseconds attributable to the tracks listed — a floor, since the same
   * tracks were also played on other days. Exact only when the month has one
   * tracked day.
   */
  approxTrackMs: number;
  tracks: MemoryEntry[];
  artists: MemoryArtistEntry[];
}

/** How many top tracks/artists a memory carries. */
const MEMORY_TRACK_LIMIT = 10;
const MEMORY_ARTIST_LIMIT = 5;

/** `MM-DD` for a given month key and day-of-month. */
function monthDayKey(month: string, day: number): string {
  return `${month.slice(5, 7)}-${String(day).padStart(2, "0")}`;
}

function dateKey(month: string, day: number): string {
  return `${month.slice(0, 4)}-${monthDayKey(month, day)}`;
}

/** Days in a `YYYY-MM` month; day 0 of the next month is the last of this one. */
function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(index)) return 0;
  return new Date(year, index, 0).getDate();
}

const DAY_MS = 86_400_000;

/** Midnight-anchored day number, so DST shifts cannot produce a 0.96-day diff. */
function dayNumber(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/**
 * Distance in days between two `MM-DD` keys, ignoring the year.
 *
 * The shorter way around the calendar is taken, so 12-31 and 01-01 are one day
 * apart — a New Year's memory must not be missed because the year number
 * changed between the historic date and today.
 */
function monthDayDistance(a: string, b: string): number {
  const dayOfYear = (mmdd: string): number => {
    // A leap year makes every month-day reachable, including 02-29.
    const ref = Date.UTC(2024, Number(mmdd.slice(0, 2)) - 1, Number(mmdd.slice(3, 5)));
    return Math.floor((ref - Date.UTC(2024, 0, 1)) / DAY_MS);
  };
  const span = dayOfYear("12-31") + 1;
  const diff = Math.abs(dayOfYear(a) - dayOfYear(b));
  return Math.min(diff, span - diff);
}

/**
 * Memories for `today`, one per historic year at most.
 *
 * `windowDays` widens the match to +/- that many days: opening the app a day
 * late should not silently skip the anniversary. When several days in a year
 * fall inside the window, the one with the most listening wins — that is the
 * one worth resurfacing.
 */
export function findYearlyMemories(
  months: MemoryMonthSource[],
  today: Date,
  windowDays = 3,
): YearlyMemory[] {
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const todayNumber = dayNumber(todayIso);
  const currentMonthKey = todayIso.slice(0, 7);

  const best = new Map<number, YearlyMemory>();

  for (const bucket of months) {
    if (!bucket || typeof bucket.month !== "string") continue;
    // A year needs 12 months to add up, so a partial current month can never
    // be a "year ago" — skipping it also avoids rating an unfinished year.
    if (bucket.month === currentMonthKey) continue;
    const lastDay = daysInMonth(bucket.month);
    if (lastDay === 0) continue;

    for (let day = 1; day <= lastDay; day += 1) {
      const ms = bucket.days?.[String(day)];
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) continue;

      const iso = dateKey(bucket.month, day);
      const diffDays = todayNumber - dayNumber(iso);
      // Future dates are never memories.
      if (diffDays < 0) continue;
      // Must be at least a full year back. The slack absorbs a 365-day year:
      // an exact anniversary can be one day short of 365.25.
      if (diffDays < 365 - windowDays) continue;

      const yearsAgo = today.getFullYear() - Number(iso.slice(0, 4));
      if (yearsAgo < 1) continue;

      // Proximity to THIS year's anniversary, by month/day. A lower bound on
      // diffDays alone would let a date up to ~6 months past its anniversary
      // keep qualifying, so both tests are needed.
      const anniversaryGap = monthDayDistance(
        iso.slice(5, 10),
        todayIso.slice(5, 10),
      );
      if (anniversaryGap > windowDays) continue;

      const tracks = [...bucket.tracks]
        .filter((track) => track && typeof track.ms === "number" && track.ms > 0)
        .sort((a, b) => b.ms - a.ms || b.plays - a.plays || a.id.localeCompare(b.id))
        .slice(0, MEMORY_TRACK_LIMIT)
        .map<MemoryEntry>((track) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          thumbnail: track.art ?? undefined,
          ms: track.ms,
          plays: track.plays,
        }));

      const artists = [...(bucket.artists ?? [])]
        .sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name))
        .slice(0, MEMORY_ARTIST_LIMIT)
        .map<MemoryArtistEntry>((artist) => ({
          name: artist.name,
          ms: artist.ms,
          plays: artist.plays,
        }));

      const memory: YearlyMemory = {
        id: `memory-${yearsAgo}-${monthDayKey(bucket.month, day)}`,
        yearsAgo,
        date: iso,
        monthDay: monthDayKey(bucket.month, day),
        listenedMs: ms,
        approxTrackMs: tracks.reduce((sum, track) => sum + track.ms, 0),
        tracks,
        artists,
      };

      const existing = best.get(yearsAgo);
      if (!existing || memory.listenedMs > existing.listenedMs) {
        best.set(yearsAgo, memory);
      }
    }
  }

  // Most recent year first (last year is the most evocative), then by size.
  return [...best.values()].sort(
    (a, b) => a.yearsAgo - b.yearsAgo || b.listenedMs - a.listenedMs,
  );
}

/** Earliest month key present, or null — used to decide if a year can exist. */
export function earliestMonthKey(months: MemoryMonthSource[]): string | null {
  let earliest: string | null = null;
  for (const bucket of months) {
    if (!bucket || typeof bucket.month !== "string") continue;
    if (!earliest || bucket.month < earliest) earliest = bucket.month;
  }
  return earliest;
}

/**
 * Whether history is old enough for a "years ago" memory to be possible.
 * Without this the UI would render an empty Memories affordance for a
 * fresh install, which reads as broken rather than empty.
 */
export function historySpansAYear(
  months: MemoryMonthSource[],
  today: Date,
): boolean {
  const earliest = earliestMonthKey(months);
  if (!earliest) return false;
  const monthsOfHistory =
    (today.getFullYear() - Number(earliest.slice(0, 4))) * 12 +
    (today.getMonth() + 1 - Number(earliest.slice(5, 7)));
  return monthsOfHistory >= 12;
}

/** `yearsAgo` as a localized phrase: "1 year ago" / "3 years ago". */
export function yearsAgoLabel(yearsAgo: number, language: string): string {
  if (language === "fa") {
    return yearsAgo === 1 ? "یک سال پیش" : `${yearsAgo} سال پیش`;
  }
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}
