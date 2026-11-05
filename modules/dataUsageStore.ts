import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Monthly streamed-bytes accounting (issue #35).
 *
 * Streamed audio is not interceptable at the RN layer, so the byte estimate is
 * derived from the actual playback bitrate x verified played time, which the
 * listening-stats sampler already tracks (paused/buffering time excluded).
 * That keeps the counter honest without a byte-level proxy.
 */

export const DATA_USAGE_KEY = "@streamify_data_usage_v1";

export type SourceUsage = {
  /** Estimated bytes streamed this month, per source id. */
  bytesBySource: Record<string, number>;
  /** Month key, "YYYY-MM". A change resets the counters. */
  month: string;
};

export type MonthlyUsage = {
  totalBytes: number;
  bytesBySource: Record<string, number>;
  month: string;
};

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function emptyUsage(month: string): SourceUsage {
  return { bytesBySource: {}, month };
}

export function sanitizeUsage(value: unknown, month: string): SourceUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyUsage(month);
  }
  const record = value as Partial<SourceUsage>;
  if (record.month !== month) {
    return emptyUsage(month);
  }
  const bytesBySource: Record<string, number> = {};
  const raw = record.bytesBySource;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, val] of Object.entries(raw)) {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) {
        bytesBySource[key] = val;
      }
    }
  }
  return { bytesBySource, month };
}

/** Bytes for `playedMs` at `bitrateKbps`. Pure, so it is unit-testable. */
export function estimateBytes(
  bitrateKbps: number,
  playedMs: number,
): number {
  if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) {
    return 0;
  }
  if (!Number.isFinite(playedMs) || playedMs <= 0) {
    return 0;
  }
  // kbps -> bytes/s = *1000/8; a small overhead allowance covers container
  // and TLS framing so the estimate does not systematically undershoot.
  const bytesPerMs = (bitrateKbps * 1000) / 8 / 1000;
  return Math.round(bytesPerMs * playedMs * 1.03);
}

let cached: SourceUsage | null = null;

async function loadUsage(month: string): Promise<SourceUsage> {
  if (cached && cached.month === month) {
    return cached;
  }
  try {
    const raw = await AsyncStorage.getItem(DATA_USAGE_KEY);
    cached = sanitizeUsage(raw ? JSON.parse(raw) : null, month);
  } catch {
    cached = emptyUsage(month);
  }
  return cached;
}

/** Accumulate streamed bytes for one source. Fire-and-forget friendly. */
export async function recordDataUsage(
  source: string,
  bitrateKbps: number,
  playedMs: number,
  now: Date = new Date(),
): Promise<void> {
  const bytes = estimateBytes(bitrateKbps, playedMs);
  if (bytes <= 0) {
    return;
  }
  const month = currentMonthKey(now);
  const usage = await loadUsage(month);
  const key = source || "unknown";
  usage.bytesBySource[key] = (usage.bytesBySource[key] || 0) + bytes;
  cached = usage;
  try {
    await AsyncStorage.setItem(DATA_USAGE_KEY, JSON.stringify(usage));
  } catch {}
}

export async function getMonthlyUsage(
  now: Date = new Date(),
): Promise<MonthlyUsage> {
  const month = currentMonthKey(now);
  const usage = await loadUsage(month);
  const totalBytes = Object.values(usage.bytesBySource).reduce(
    (sum, value) => sum + value,
    0,
  );
  return { totalBytes, bytesBySource: { ...usage.bytesBySource }, month };
}

export async function resetMonthlyUsage(
  now: Date = new Date(),
): Promise<void> {
  cached = emptyUsage(currentMonthKey(now));
  try {
    await AsyncStorage.setItem(DATA_USAGE_KEY, JSON.stringify(cached));
  } catch {}
}

/** Human-readable size, e.g. "1.4 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) {
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}
