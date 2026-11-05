/**
 * System notification for the liked-songs cache queue (issue #94).
 *
 * A caching run can take many minutes (batches of 2, a 3-minute cooldown
 * between batches, 8s between tracks), so the user needs to see that work is
 * happening from the notification shade — in the app, backgrounded, or with
 * the app closed to the shade.
 *
 * Design notes:
 * - One ongoing notification, replaced in place via a stable identifier, so a
 *   run never stacks notifications.
 * - Posting is throttled and text-diffed by `cacheQueueNotify` so the
 *   notification does not repost per track or per percentage tick.
 * - Every call is best-effort: notification permission can be denied, the
 *   module can be missing on a dev client, or the app can be backgrounded
 *   mid-post. None of that may interrupt caching, so failures are swallowed
 *   after a single log line.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  CACHE_NOTIFICATION_ID,
  cacheQueueNotifyCopy,
  type CacheQueueNotifyState,
  shouldPostCacheNotification,
} from "./cacheQueueNotify";

const ANDROID_CHANNEL_ID = "cache-queue";

let handlerInstalled = false;
let permissionChecked = false;
let permissionGranted = false;
let lastPostedText: string | null = null;
let lastPostedAt: number | null = null;
let channelReady = false;
let shown = false;

/**
 * Foreground presentation. Without this the OS drops the notification while
 * the app is focused, which is exactly the "caching is running" case the
 * issue asks to surface. Android needs a channel to render at all.
 */
export function installCacheNotificationHandler(): void {
  if (handlerInstalled) {
    return;
  }
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Android 13+ requires a runtime permission. Asked once per app run, and a
 * denial is respected permanently for the session — re-prompting on every
 * queue start would be a nag, and caching works without the notification.
 */
export async function ensureCacheNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }
  if (permissionChecked) {
    return permissionGranted;
  }
  permissionChecked = true;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) {
      permissionGranted = true;
      return true;
    }
    if (!existing.canAskAgain) {
      permissionGranted = false;
      return false;
    }
    const asked = await Notifications.requestPermissionsAsync();
    permissionGranted = !!asked.granted;
  } catch (error) {
    console.warn("[CacheNotify] permission request failed:", error);
    permissionGranted = false;
  }
  return permissionGranted;
}

async function ensureAndroidChannel(): Promise<void> {
  if (channelReady || Platform.OS !== "android") {
    return;
  }
  channelReady = true;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Caching liked songs",
      // LOW: a multi-minute run must not buzz as a heads-up on every update.
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
    });
  } catch (error) {
    console.warn("[CacheNotify] channel setup failed:", error);
  }
}

/**
 * Post or refresh the run notification. Safe to call on every meaningful
 * queue event: unchanged text and posts inside the throttle window are
 * dropped by `shouldPostCacheNotification`.
 */
export async function updateCacheNotification(
  state: CacheQueueNotifyState,
  options?: { force?: boolean },
): Promise<void> {
  installCacheNotificationHandler();
  const { title, body } = cacheQueueNotifyCopy(state);
  const text = `${title}\n${body}`;
  const now = Date.now();
  if (
    !shouldPostCacheNotification({
      next: text,
      last: lastPostedText,
      lastPostedAt,
      now,
      force: options?.force,
    })
  ) {
    return;
  }
  lastPostedText = text;
  lastPostedAt = now;

  if (!(await ensureCacheNotificationPermission())) {
    return;
  }
  await ensureAndroidChannel();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: CACHE_NOTIFICATION_ID,
      content: {
        title,
        body,
        // Ongoing: the user must not be able to swipe away a notification
        // that is still describing live work.
        sticky: true,
        autoDismiss: false,
      },
      // Channel-aware trigger object: on Android this delivers immediately
      // into ANDROID_CHANNEL_ID; on iOS/web the channel key is stripped and
      // the trigger resolves to the "deliver now" default.
      trigger: { channelId: ANDROID_CHANNEL_ID },
    });
    shown = true;
  } catch (error) {
    console.warn("[CacheNotify] post failed:", error);
  }
}

/** Remove the notification. Called on drain, abort, and settings-off so a
 * finished run never leaves an orphaned "caching" notice in the shade. */
export async function dismissCacheNotification(): Promise<void> {
  lastPostedText = null;
  lastPostedAt = null;
  if (!shown) {
    return;
  }
  shown = false;
  try {
    await Notifications.dismissNotificationAsync(CACHE_NOTIFICATION_ID);
    await Notifications.cancelScheduledNotificationAsync(CACHE_NOTIFICATION_ID);
  } catch (error) {
    console.warn("[CacheNotify] dismiss failed:", error);
  }
}

/** Test seam: reset module-level throttle/permission state. */
export function __resetCacheNotificationState(): void {
  handlerInstalled = false;
  permissionChecked = false;
  permissionGranted = false;
  lastPostedText = null;
  lastPostedAt = null;
  channelReady = false;
  shown = false;
}
