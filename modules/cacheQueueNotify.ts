/**
 * Pure decision layer for the cache-queue system notification (issue #94).
 *
 * The expensive parts (expo-notifications, AsyncStorage) live in
 * `cacheQueueNotifier.ts`. This module holds only the logic that decides
 * *what* the notification should say and *whether* it should be posted,
 * so it can be exercised under Node like the rest of `tests/*-regression.cjs`.
 *
 * Two rules drive the design:
 *
 * 1. Counting must stay cheap. `getAudioCacheInfo` reloads the whole cache
 *    index on every call (modules/audioStreaming.ts documents this), so the
 *    notification never scans every liked song to render a number. The queue
 *    already knows how many tracks it finished, so the counters are derived
 *    from totals the caller owns, plus one snapshot recomputed only when the
 *    queue reports a finished track.
 * 2. Posting is throttled. A cache run touches `cacheQueueVersion` once per
 *    track and percentage changes many times per second, so a notification
 *    is only posted when the rendered text would actually change, and never
 *    more often than `NOTIFY_MIN_INTERVAL_MS`.
 */

/** Stable identifier so updates replace the same notification instead of
 * stacking a new one per track. */
export const CACHE_NOTIFICATION_ID = "streamify-cache-queue";

/** Floor between two posts. Below this a run posts at most a handful of
 * updates regardless of how many tracks finish. */
export const NOTIFY_MIN_INTERVAL_MS = 15_000;

/** Text the notification shows. `remaining` counts liked songs not yet
 * fully cached; `cooldownSeconds` is the queue's batch cooldown, shown in
 * place of the count while it is running. */
export interface CacheQueueNotifyState {
  /** Liked songs total. */
  total: number;
  /** Liked songs still waiting to be cached. */
  remaining: number;
  /** Seconds left in the batch cooldown, or 0 when not cooling down. */
  cooldownSeconds: number;
  /** Locale used to render the copy. */
  language: "en" | "fa";
}

/**
 * Copy for the notification. Kept here (not in a locale file) because the
 * notification is posted from a non-React module; the strings must be
 * available without a component tree. Both languages are real translations,
 * not English passthrough.
 */
export function cacheQueueNotifyCopy(state: CacheQueueNotifyState): {
  title: string;
  body: string;
} {
  if (state.language === "fa") {
    return {
      title: "در حال ذخیره‌سازی آهنگ‌های لایک‌شده",
      body: formatBody(
        state,
        (left, total) => `${left} از ${total} آهنگ باقی مانده`,
        (left) => `${left} ثانیه تا ادامه (استراحت بین دسته‌ها)`,
      ),
    };
  }
  return {
    title: "Caching liked songs",
    body: formatBody(
      state,
      (left, total) => `${left} of ${total} remaining`,
      (left) => `Resuming in ${left} (batch cooldown)`,
    ),
  };
}

function formatBody(
  state: CacheQueueNotifyState,
  remainingText: (left: number, total: number) => string,
  /** Receives the already-formatted duration, e.g. "3m" / "45s". */
  cooldownText: (duration: string) => string,
): string {
  // A cooldown means the queue is deliberately idle, not out of work.
  if (state.cooldownSeconds > 0) {
    return cooldownText(formatCooldown(state.cooldownSeconds));
  }
  // Nothing left to do: the notification is about to be dismissed anyway,
  // but the copy must never claim progress that does not exist.
  const left = Math.max(0, Math.floor(state.remaining));
  if (left === 0) {
    return state.language === "fa" ? "همه آهنگ‌ها ذخیره شدند" : "All songs cached";
  }
  return remainingText(left, Math.max(0, Math.floor(state.total)));
}

/** Cooldown is shown as a compact duration; seconds under a minute stay in
 * seconds so a countdown does not jump to "0m" and read as finished. */
export function formatCooldown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (rest === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${rest}s`;
}

/**
 * Whether a post is warranted. Returns true only when the rendered copy
 * changed AND (the caller marked it urgent OR the throttle window elapsed).
 * Progress that renders identically must never post, or a run would emit a
 * notification per track for a number that did not move.
 *
 * `force` exists for state transitions — entering a cooldown sits ~8s after
 * the previous track's post (the inter-track delay), so the plain throttle
 * would swallow it. A transition is not progress spam; it must land.
 */
export function shouldPostCacheNotification(input: {
  /** Copy that would be rendered now. */
  next: string;
  /** Copy rendered by the previous post, or null if nothing is posted yet. */
  last: string | null;
  /** Timestamp of the previous post, or null on the first one. */
  lastPostedAt: number | null;
  now: number;
  /** Skip the time window (still requires the copy to differ). */
  force?: boolean;
}): boolean {
  if (input.next === input.last) {
    return false;
  }
  if (input.force || input.lastPostedAt === null) {
    return true;
  }
  return input.now - input.lastPostedAt >= NOTIFY_MIN_INTERVAL_MS;
}

/**
 * Counters for the notification, derived without touching the cache index.
 *
 * `finishedInRun` is the number of tracks the queue has completed this run —
 * it only ever grows while the queue runs, which is what the notification
 * reports as progress. `alreadyCachedBeforeRun` seeds it on a resumed run so
 * the first post does not claim everything is outstanding.
 */
export function cacheQueueCounters(input: {
  total: number;
  finishedInRun: number;
  alreadyCachedBeforeRun: number;
}): { total: number; remaining: number } {
  const total = Math.max(0, Math.floor(input.total) || 0);
  const done = Math.max(0, Math.floor(input.alreadyCachedBeforeRun) || 0) +
    Math.max(0, Math.floor(input.finishedInRun) || 0);
  const remaining = Math.max(0, total - done);
  return { total, remaining };
}
