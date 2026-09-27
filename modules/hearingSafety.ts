/********************************************************************
 *  hearingSafety.ts — native limiter bridge + exposure meter.
 *
 *  Native side: StreamifyHearingLimitModule, an AudioEffect
 *  (DynamicsProcessing) limiter on the global output mix. No npm
 *  dependency; the Kotlin ships through plugins/withHearingSafety.js
 *  because the repo gitignores /android and prebuilds clean.
 *
 *  Exposure: estimated dB-hours accumulated while audio is actually
 *  playing (never paused or muted), stored per day and summed over a
 *  7-day window for the WHO 40 dB-hour budget. The estimate comes
 *  from the volume setting plus a per-device max-SPL profile — it is
 *  an ESTIMATE, not a measured SPL, and the UI says so.
 *******************************************************************/
import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  HEARING_CEILING_DEFAULT,
  HEARING_CEILING_RANGE,
  HEARING_DEVICE_PROFILES,
  type HearingDeviceProfile,
  WHO_WEEKLY_BUDGET_DB_HOURS,
} from "../lib/app-settings";

const native = (NativeModules as any).StreamifyHearingLimitModule as
  | {
      getState(): Promise<HearingNativeState>;
      isSupported(): Promise<boolean>;
      getCeiling(): Promise<number>;
      setCeiling(ceiling: number): Promise<number>;
      setEnabled(enabled: boolean): Promise<boolean>;
      /** System media volume 0..1; 0 means muted. */
      getOutputVolume(): Promise<number>;
    }
  | undefined;

export const HEARING_NATIVE_AVAILABLE = Platform.OS === "android" && Boolean(native);

const REBUILD_ERROR =
  "StreamifyHearingLimitModule is missing — rebuild the Android app (the hearing limiter ships as a native module).";

export interface HearingNativeState {
  supported: boolean;
  enabled: boolean;
  /** Applied ceiling in dB(A) after the device clamp. */
  ceiling: number;
  minCeiling: number;
  maxCeiling: number;
  /** Device-reported hard limit, or 0 when the ROM reports none. */
  deviceMax: number;
}

const UNSUPPORTED_STATE: HearingNativeState = {
  supported: false,
  enabled: false,
  ceiling: HEARING_CEILING_DEFAULT,
  minCeiling: HEARING_CEILING_RANGE.min,
  maxCeiling: HEARING_CEILING_RANGE.max,
  deviceMax: 0,
};

function requireNative() {
  if (!native) {
    throw new Error(REBUILD_ERROR);
  }
  return native;
}

/** Never throws: a missing/unsupported limiter is a state, not an error. */
export async function getHearingLimiterState(): Promise<HearingNativeState> {
  if (!HEARING_NATIVE_AVAILABLE) {
    return UNSUPPORTED_STATE;
  }
  try {
    return await requireNative().getState();
  } catch {
    return UNSUPPORTED_STATE;
  }
}

export async function isHearingLimiterSupported(): Promise<boolean> {
  return (await getHearingLimiterState()).supported;
}

export async function getHearingDeviceMax(): Promise<number> {
  return (await getHearingLimiterState()).deviceMax;
}

/** Resolves the clamped ceiling the device actually applied. */
export async function setHearingCeiling(ceiling: number): Promise<number> {
  if (!HEARING_NATIVE_AVAILABLE) {
    return clampCeiling(ceiling);
  }
  try {
    return await requireNative().setCeiling(ceiling);
  } catch {
    return clampCeiling(ceiling);
  }
}

export async function setHearingLimiterEnabled(enabled: boolean): Promise<boolean> {
  if (!HEARING_NATIVE_AVAILABLE) {
    return false;
  }
  try {
    return await requireNative().setEnabled(enabled);
  } catch {
    return false;
  }
}

/**
 * System media volume 0..1, or null when it cannot be read. 0 means muted:
 * the caller must treat that as "not listening" and stop accumulating.
 */
export async function getOutputVolume(): Promise<number | null> {
  if (!HEARING_NATIVE_AVAILABLE) {
    return null;
  }
  try {
    const value = await requireNative().getOutputVolume();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function clampCeiling(ceiling: number): number {
  if (!Number.isFinite(ceiling)) {
    return HEARING_CEILING_DEFAULT;
  }
  return Math.min(
    HEARING_CEILING_RANGE.max,
    Math.max(HEARING_CEILING_RANGE.min, Math.round(ceiling)),
  );
}

/* ------------------------------------------------------------------ */
/* Exposure meter                                                      */
/* ------------------------------------------------------------------ */

export const HEARING_EXPOSURE_STORAGE_KEY = "@hearing_exposure";

/** One row per calendar day: accumulated dB-hours plus a day stamp. */
export interface ExposureDay {
  /** UTC yyyy-mm-dd. */
  day: string;
  dbHours: number;
  /** Average estimated dB(A) over the day, for the UI label. */
  avgDbA: number;
  seconds: number;
}

function emptyDay(day: string): ExposureDay {
  return { day, dbHours: 0, avgDbA: 0, seconds: 0 };
}

export function dayStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Days strictly older than today are dropped on write. */
function prune(days: ExposureDay[], today: string): ExposureDay[] {
  return days.filter((entry) => entry.day <= today);
}

export function isExposureDayStale(entry: ExposureDay, today: string): boolean {
  return entry.day !== today;
}

export function loadExposureFromRaw(raw: string | null, today: string): ExposureDay[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is ExposureDay =>
          !!entry &&
          typeof entry.day === "string" &&
          typeof entry.dbHours === "number" &&
          Number.isFinite(entry.dbHours),
      )
      .map((entry) => ({ ...emptyDay(entry.day), ...entry }));
  } catch {
    return [];
  }
}

/**
 * Estimated dB(A) for a volume 0..1 on a given device profile, or null when
 * the profile is unknown (the test plan: prompt for a profile instead of
 * mis-estimating).
 */
export function estimateDbA(
  volume: number,
  profile: HearingDeviceProfile,
): number | null {
  const entry = HEARING_DEVICE_PROFILES.find((p) => p.id === profile);
  if (!entry || entry.maxDbA <= 0) {
    return null;
  }
  const v = Math.min(1, Math.max(0, volume));
  if (v <= 0) {
    return null;
  }
  // Most phone volume curves are roughly logarithmic: a 20 dB swing across
  // the slider is a common approximation.
  return Math.round(entry.maxDbA - 20 * (1 - v));
}

/**
 * Fold a listening interval into the day list. Pure and self-contained so
 * the regression suite can drive it directly. Paused or muted playback
 * contributes nothing — `elapsedSeconds <= 0` is the single gate.
 */
export function accumulateExposure(
  days: ExposureDay[],
  options: {
    dbA: number | null;
    elapsedSeconds: number;
    today?: string;
  },
): ExposureDay[] {
  const today = options.today ?? dayStamp();
  const base = prune(days, today);
  if (!options.dbA || options.elapsedSeconds <= 0) {
    return base.map((entry) => ({ ...entry }));
  }
  const hours = options.elapsedSeconds / 3600;
  const contribution = options.dbA * hours;
  const index = base.findIndex((entry) => entry.day === today);
  if (index === -1) {
    return [
      ...base,
      {
        day: today,
        dbHours: contribution,
        avgDbA: options.dbA,
        seconds: options.elapsedSeconds,
      },
    ];
  }
  const entry = base[index];
  const next: ExposureDay = {
    day: entry.day,
    dbHours: entry.dbHours + contribution,
    avgDbA:
      (entry.avgDbA * entry.seconds + options.dbA * options.elapsedSeconds) /
      (entry.seconds + options.elapsedSeconds),
    seconds: entry.seconds + options.elapsedSeconds,
  };
  return base.map((item, i) => (i === index ? next : { ...item }));
}

export interface ExposureSummary {
  todayDbHours: number;
  weeklyDbHours: number;
  budgetDbHours: number;
  /** 0..1 of the weekly budget; may exceed 1. */
  weeklyRatio: number;
  /** 7 daily rows, oldest first, so the UI can draw a simple bar row. */
  days: ExposureDay[];
}

export function summarizeExposure(
  days: ExposureDay[],
  today: string = dayStamp(),
): ExposureSummary {
  const live = days.filter((entry) => entry.day <= today);
  const todayEntry = live.find((entry) => entry.day === today);
  // Weekly = the last 7 calendar days including today. The list is pruned on
  // write, so summing it never under-counts a display cap.
  const weeklyDbHours = live
    .filter((entry) => entry.day >= shiftDay(today, -6))
    .reduce((total, entry) => total + entry.dbHours, 0);
  return {
    todayDbHours: todayEntry?.dbHours ?? 0,
    weeklyDbHours,
    budgetDbHours: WHO_WEEKLY_BUDGET_DB_HOURS,
    weeklyRatio:
      WHO_WEEKLY_BUDGET_DB_HOURS > 0
        ? weeklyDbHours / WHO_WEEKLY_BUDGET_DB_HOURS
        : 0,
    days: live.sort((a, b) => a.day.localeCompare(b.day)).slice(-7),
  };
}

function shiftDay(day: string, deltaDays: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return dayStamp(date);
}

export async function readExposureDays(): Promise<ExposureDay[]> {
  try {
    const raw = await AsyncStorage.getItem(HEARING_EXPOSURE_STORAGE_KEY);
    return loadExposureFromRaw(raw, dayStamp());
  } catch {
    return [];
  }
}

export async function writeExposureDays(days: ExposureDay[]): Promise<void> {
  try {
    await AsyncStorage.setItem(HEARING_EXPOSURE_STORAGE_KEY, JSON.stringify(days));
  } catch {
    // Storage full or unavailable: the meter is a report, losing it is not fatal.
  }
}

export interface ExposureTick {
  dbA: number | null;
  elapsedSeconds: number;
  today?: string;
}

/** Load, fold one playing interval, persist. Returns the new list. */
export async function recordExposure(tick: ExposureTick): Promise<ExposureDay[]> {
  const today = tick.today ?? dayStamp();
  const days = loadExposureFromRaw(
    await AsyncStorage.getItem(HEARING_EXPOSURE_STORAGE_KEY).catch(() => null),
    today,
  );
  const next = accumulateExposure(days, { ...tick, today });
  await writeExposureDays(next);
  return next;
}

export async function clearExposure(): Promise<void> {
  await writeExposureDays([]);
}
