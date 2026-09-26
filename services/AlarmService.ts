/********************************************************************
 *  AlarmService.ts - Wake radio: scheduled alarms that start playback
 *
 *  Design notes (why notifications and not AlarmManager):
 *  - A wake radio must fire with the screen off, from Doze, and survive a
 *    reboot. On Android an exact-alarm permission prompt is intrusive, and
 *    expo-notifications' WEEKLY trigger is delivered by AlarmManager
 *    underneath, so we get that reliability for free — no new native
 *    module, no `SCHEDULE_EXACT_ALARM` permission dialog, no
 *    `canScheduleExactAlarms` gate to explain to the user.
 *  - WEEKLY, not DAILY. A DAILY trigger at H:M fires *every* day, so a
 *    Mon/Wed/Fri alarm would need three DAILY triggers and still ring on
 *    the other four days. One WEEKLY trigger per selected weekday is the
 *    only shape that actually means "this weekday at this time".
 *  - Weekday numbering differs by API: JS `Date#getDay()` is 0=Sunday,
 *    expo-notifications' WeeklyTriggerInput is 1=Sunday. Store 0=Sunday
 *    (what JS gives us and what the UI chips display) and convert at the
 *    scheduling boundary — see `toTriggerWeekday`.
 *  - The notification payload carries only the alarm id, never the track
 *    list, so an alarm still resolves the right music when the library
 *    changed between schedule time and fire time.
 *******************************************************************/
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { fadeService } from "./FadeService";
import type { Track } from "../contexts/PlayerContext";

const ALARMS_KEY = "@wake_radio_alarms";
export const ALARM_CHANNEL_ID = "wake-radio-alarms";

/** 1-3 minutes, per the issue. Stored in minutes, not seconds. */
export const ALARM_FADE_MINUTES = { min: 1, max: 3, default: 2 } as const;

export interface WakeAlarm {
  id: string;
  /** JS getDay() numbering: 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  hour: number;
  minute: number;
  /** null = queue a smart mix; otherwise play this playlist. */
  playlistId: string | null;
  /** Denormalised so a notification raised hours later still has a title. */
  playlistName: string;
  fadeMinutes: number;
  enabled: boolean;
}

/** Notification identifier for one weekday of one alarm. */
function notificationId(alarmId: string, weekday: number): string {
  return `${alarmId}:${weekday}`;
}

/** expo-notifications WeeklyTriggerInput: 1 = Sunday … 7 = Saturday. */
function toTriggerWeekday(jsWeekday: number): number {
  return jsWeekday + 1;
}

/** WakeAlarm.weekdays: 0 = Sunday … 6 = Saturday. */
function fromTriggerWeekday(triggerWeekday: number): number {
  return triggerWeekday - 1;
}

/**
 * Weekday subset of the existing ones. Every alarm needs at least one
 * weekday, so an empty selection is a caller bug worth surfacing.
 */
export function validateAlarm(alarm: WakeAlarm): void {
  if (!alarm.id) {
    throw new Error("alarm needs an id");
  }
  if (!Number.isInteger(alarm.hour) || alarm.hour < 0 || alarm.hour > 23) {
    throw new Error(`alarm hour out of range: ${alarm.hour}`);
  }
  if (!Number.isInteger(alarm.minute) || alarm.minute < 0 || alarm.minute > 59) {
    throw new Error(`alarm minute out of range: ${alarm.minute}`);
  }
  if (!Array.isArray(alarm.weekdays) || alarm.weekdays.length === 0) {
    throw new Error("alarm needs at least one weekday");
  }
  for (const day of alarm.weekdays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error(`alarm weekday out of range: ${day}`);
    }
  }
  if (new Set(alarm.weekdays).size !== alarm.weekdays.length) {
    throw new Error(`alarm has duplicate weekdays: ${alarm.weekdays.join(",")}`);
  }
  if (
    alarm.fadeMinutes < ALARM_FADE_MINUTES.min ||
    alarm.fadeMinutes > ALARM_FADE_MINUTES.max
  ) {
    throw new Error(`alarm fade out of range: ${alarm.fadeMinutes}`);
  }
}

function isWakeAlarm(value: unknown): value is WakeAlarm {
  if (!value || typeof value !== "object") {
    return false;
  }
  const a = value as Partial<WakeAlarm>;
  return (
    typeof a.id === "string" &&
    a.id.length > 0 &&
    Array.isArray(a.weekdays) &&
    Number.isInteger(a.hour) &&
    Number.isInteger(a.minute)
  );
}

/** Pad + format as H:MM for the notification body. */
function formatTime(alarm: WakeAlarm): string {
  const h = String(alarm.hour).padStart(2, "0");
  const m = String(alarm.minute).padStart(2, "0");
  return `${h}:${m}`;
}

async function persist(alarms: WakeAlarm[]): Promise<void> {
  await AsyncStorage.setItem(ALARMS_KEY, JSON.stringify(alarms));
}

/**
 * MAX importance + heads-up: an alarm that only buzzes behind the lock
 * screen is not an alarm. The channel is created once and then reused.
 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }
  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: "Wake radio",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 600, 300, 600, 300, 600],
    lightColor: "#ffffff",
  });
}

/** True when the OS granted permission to post notifications at all. */
export async function hasNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted";
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export const alarmService = {
  async load(): Promise<WakeAlarm[]> {
    try {
      const raw = await AsyncStorage.getItem(ALARMS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      // Drop malformed rows instead of resurrecting an uneditable alarm
      // into the UI. A corrupt entry must never block the valid ones.
      return parsed.filter(isWakeAlarm);
    } catch {
      // Corrupt JSON is not worth crashing settings over.
      return [];
    }
  },

  async save(alarm: WakeAlarm): Promise<WakeAlarm[]> {
    validateAlarm(alarm);
    const alarms = await this.load();
    const next = alarms.some((a) => a.id === alarm.id)
      ? alarms.map((a) => (a.id === alarm.id ? alarm : a))
      : [...alarms, alarm];
    await persist(next);
    await this.reschedule(alarm);
    return next;
  },

  async remove(id: string): Promise<WakeAlarm[]> {
    const alarms = await this.load();
    const target = alarms.find((a) => a.id === id);
    if (target) {
      await this.cancel(target);
    }
    const next = alarms.filter((a) => a.id !== id);
    await persist(next);
    return next;
  },

  /** Cancel every notification belonging to this alarm, enabled or not. */
  async cancel(alarm: WakeAlarm): Promise<void> {
    const ids = alarm.weekdays.map((day) => notificationId(alarm.id, day));
    await Promise.all(
      ids.map((id) =>
        Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
      ),
    );
  },

  /**
   * Rebuild this alarm's notifications from scratch.
   *
   * Cancel-then-schedule is what makes editing safe: changing the time or
   * the weekday set cannot leave an orphan still firing at the old time.
   */
  async reschedule(alarm: WakeAlarm): Promise<void> {
    await this.cancel(alarm);
    if (!alarm.enabled) {
      return;
    }
    if (!(await hasNotificationPermission())) {
      // Silently keep the stored alarm: the user can grant permission later
      // and syncAll() will arm it. Throwing here would make the save fail
      // for a reason the UI cannot explain.
      return;
    }
    await ensureChannel();
    for (const weekday of alarm.weekdays) {
      await Notifications.scheduleNotificationAsync({
        identifier: notificationId(alarm.id, weekday),
        content: {
          title: alarm.playlistName,
          body: `Alarm ${formatTime(alarm)}`,
          data: { alarmId: alarm.id, weekday },
          sound: true,
          // Lock-screen visibility for a wake radio.
          ...(Platform.OS === "android" ? { sticky: false } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          channelId: ALARM_CHANNEL_ID,
          weekday: toTriggerWeekday(weekday),
          hour: alarm.hour,
          minute: alarm.minute,
        },
      });
    }
  },

  /**
   * Re-arm everything from stored state.
   *
   * Scheduled triggers are dropped by the OS on app upgrade and on
   * uninstall/reinstall, so a resync on launch is what makes the stored
   * list truthful. Idempotent — reschedule cancels before scheduling.
   */
  async syncAll(): Promise<void> {
    const alarms = await this.load();
    for (const alarm of alarms) {
      if (alarm.enabled) {
        await this.reschedule(alarm);
      }
    }
  },

  /**
   * Next occurrence of this alarm, for display.
   *
   * Walks forward day by day rather than doing weekday arithmetic so it
   * stays correct across month boundaries and DST shifts.
   */
  nextFireAt(alarm: WakeAlarm, from: number = Date.now()): number {
    if (!alarm.weekdays.length) {
      return 0;
    }
    const wanted = new Set(alarm.weekdays);
    // 8 covers today + the next 7 days, which is enough for any non-empty
    // weekday set to recur at least once.
    for (let offset = 0; offset <= 7; offset += 1) {
      const day = new Date(from);
      day.setDate(day.getDate() + offset);
      if (!wanted.has(day.getDay())) {
        continue;
      }
      const candidate = new Date(day);
      candidate.setHours(alarm.hour, alarm.minute, 0, 0);
      const time = candidate.getTime();
      if (time > from) {
        return time;
      }
    }
    return 0;
  },

  /** Pull the alarm id out of a notification payload. */
  readAlarmId(data: unknown): string | null {
    if (!data || typeof data !== "object") {
      return null;
    }
    const id = (data as Record<string, unknown>).alarmId;
    return typeof id === "string" && id.length > 0 ? id : null;
  },

  /**
   * Wake the radio: queue the alarm's music, play from the top, and ramp
   * the volume in so the first second is not a jolt.
   */
  async start(alarm: WakeAlarm): Promise<void> {
    const TrackPlayer = (await import("../utils/safeTrackPlayer")).default;
    const tracks = await this.resolveTracks(alarm);
    if (!tracks.length) {
      return;
    }
    await TrackPlayer.reset();
    await TrackPlayer.add(tracks);
    // Hand the ramp to the fade service: it drops to its floor and its
    // progress-driven onProgress carries the level up to the user's volume
    // over the alarm's fade window. No second volume channel, no timers.
    fadeService.startRamp(alarm.fadeMinutes * 60_000);
    await TrackPlayer.play();
  },

  /** The alarm's music: a stored playlist, or a smart mix from history. */
  async resolveTracks(alarm: WakeAlarm): Promise<Track[]> {
    if (alarm.playlistId) {
      const { StorageService } = await import("../utils/storage");
      const playlists = await StorageService.loadPlaylists();
      const playlist = playlists.find((p) => p.id === alarm.playlistId);
      return playlist?.tracks ?? [];
    }
    // Smart mix: buildSmartQueue scores a *seed* against a candidate
    // library, so it needs both. Seed = most recently played track (the
    // closest thing this app has to "what you were listening to"), and the
    // candidate pool is liked songs, falling back to recent history so a
    // fresh account with nothing liked still gets music rather than
    // silence. Called bare it returns [] and the alarm would never sound.
    const { buildSmartQueue, loadPlayCounts } = await import(
      "../modules/aiPlaylistService"
    );
    const { StorageService } = await import("../utils/storage");
    const [liked, recent, playCounts] = await Promise.all([
      StorageService.loadLikedSongs(),
      StorageService.loadPreviouslyPlayedSongs(),
      loadPlayCounts(),
    ]);
    const library = liked.length >= 5 ? liked : [...liked, ...recent];
    const seed = recent[0] ?? library[0];
    if (!seed) {
      return [];
    }
    return buildSmartQueue({ seed, library, playCounts });
  },

  /** Exported for the alarm list UI and for tests. */
  notificationId,
  toTriggerWeekday,
  fromTriggerWeekday,
};
