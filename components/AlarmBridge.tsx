/********************************************************************
 *  AlarmBridge.tsx - Wire wake-radio alarms to app lifecycle + notification taps
 *
 *  Two jobs, both of which must live outside the player/queue code:
 *  1. Re-arm stored alarms on launch. Scheduled notification triggers are
 *     dropped by Android on app upgrade and on reinstall, so without a
 *     resync the stored alarm list silently lies about what will ring.
 *  2. Start playback when the user taps the alarm notification. The
 *     notification carries only the alarm id, so the music is resolved
 *     here at tap time.
 *
 *  Rendered as a null component inside PlayerProvider (it needs the player
 *  context to raise the full-screen player when the alarm starts).
 *******************************************************************/
import React, { useEffect } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { usePlayer } from "../contexts/PlayerContext";
import { alarmService } from "../services/AlarmService";

export const AlarmBridge: React.FC = () => {
  const { setShowFullPlayer } = usePlayer();

  useEffect(() => {
    // Notification presentation is global for the app: a wake radio must
    // still make sound and show heads-up while the app is in the
    // background, so the foreground handler is deliberately permissive.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    // syncAll is idempotent (it cancels before scheduling), so running it
    // again on every foreground is safe and repairs alarms that Android
    // dropped while the app was killed.
    let cancelled = false;
    const sync = () => {
      if (cancelled) {
        return;
      }
      void alarmService.syncAll().catch(() => {});
    };

    sync();

    // A tap that launched the app is delivered before this listener is
    // attached, so getLastNotificationResponseAsync is the only way to see
    // it. Deduplicated so a cold-start tap and a live tap cannot both
    // start the alarm.
    const lastHandledRef = { current: null as string | null };
    const handleResponse = (response: {
      notification: {
        request: { content: { data?: unknown } };
        date: number;
      };
    } | null) => {
      if (!response) {
        return;
      }
      const alarmId = alarmService.readAlarmId(
        response.notification.request.content.data,
      );
      if (!alarmId) {
        return;
      }
      const key = `${alarmId}:${response.notification.date}`;
      if (lastHandledRef.current === key) {
        return;
      }
      lastHandledRef.current = key;
      void startAlarm(alarmId, setShowFullPlayer);
    };

    void Notifications.getLastNotificationResponseAsync()
      .then(handleResponse)
      .catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleResponse,
    );

    const appStateSubscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        sync();
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [setShowFullPlayer]);

  return null;
};

/**
 * Resolve the tapped alarm and start it. Errors are swallowed on purpose:
 * this runs from a notification tap, where there is no UI to report to and
 * a rejection would be an unhandled promise.
 */
async function startAlarm(
  alarmId: string,
  setShowFullPlayer: (show: boolean) => void,
): Promise<void> {
  try {
    const alarms = await alarmService.load();
    const alarm = alarms.find((a) => a.id === alarmId);
    if (!alarm) {
      return;
    }
    await alarmService.start(alarm);
    setShowFullPlayer(true);
  } catch {
    // An alarm that cannot start is a silent miss, not a crash.
  }
}

export default AlarmBridge;
