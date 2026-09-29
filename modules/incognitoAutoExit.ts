import { AppState } from "react-native";
import TrackPlayer, { Event } from "react-native-track-player";

import type { IncognitoAutoExit } from "../lib/app-settings";

/**
 * Auto-exit for Private Listening (issue #44).
 *
 * The toggle itself lives in app settings; this only owns the two automatic
 * ways of switching it back off, so the PlayerProvider does not have to grow
 * another set of TrackPlayer listeners.
 *
 * - "queueEnd": turns itself off when the queue runs out.
 * - "dayEnd": turns itself off at the first minute of the next local day
 *   (or immediately on next open if midnight already passed while closed).
 * - "manual": nothing to do here.
 *
 * `setIncognitoEnabled` must be passed every run: the arming is an effect of
 * the current setting, and re-arming is how a mode change takes effect
 * (manual -> queueEnd must subscribe, queueEnd -> manual must unsubscribe).
 */
export function subscribeIncognitoAutoExit(options: {
  mode: IncognitoAutoExit;
  /** Turns the setting off. */
  disable: () => void;
  /** Lets an already-past day boundary fire on the next app open. */
  dayBoundary: number | null;
}): () => void {
  const { mode, disable, dayBoundary } = options;

  if (mode === "manual") {
    return () => {};
  }

  if (mode === "queueEnd") {
    const sub = TrackPlayer.addEventListener(
      Event.PlaybackQueueEnded,
      () => disable(),
    );
    return () => sub.remove();
  }

  // dayEnd: schedule to the next local midnight, and re-check on foreground
  // so an app left open past midnight (or closed for the night) still exits.
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let appStateSub: { remove: () => void } | null = null;
  let cancelled = false;

  const scheduleNextDay = () => {
    if (cancelled) {
      return;
    }

    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 1, 0);
    // setTimeout saturates above ~24.8 days; a same-day timeout never does.
    const delay = Math.max(1_000, nextMidnight.getTime() - now.getTime());

    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      disable();
      scheduleNextDay();
    }, delay);
  };

  // If midnight already passed while the app was closed, exit now rather than
  // waiting out another full day.
  if (dayBoundary !== null && Date.now() >= dayBoundary) {
    disable();
    return () => {};
  }

  scheduleNextDay();

  const onAppState = (next: string) => {
    if (next === "active" && dayBoundary !== null && Date.now() >= dayBoundary) {
      disable();
    }
  };
  appStateSub = AppState.addEventListener("change", onAppState);

  return () => {
    cancelled = true;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    appStateSub?.remove();
    appStateSub = null;
  };
}

/** The next local-day boundary after `from` — captured when incognito turns
 * on, so "end of day" always means the midnight following enable. */
export function nextDayEndMillis(from: number = Date.now()): number {
  // 00:01 rather than 00:00: some regions shift clocks across midnight, and
  // the next-day 00:00 slot can be skipped entirely (DST spring-forward).
  const next = new Date(from);
  next.setHours(24, 0, 1, 0);
  return next.getTime();
}
