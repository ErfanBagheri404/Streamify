/**
 * Haptics - semantic touch feedback.
 *
 * A screen says WHAT a touch meant (Tick, Select, SkipNext...), this file
 * decides how it feels on the hardware. Patterns stay brief: a haptic that
 * outlasts the finger stops reading as a response and starts reading as the
 * phone ringing.
 */
import * as Haptics from "expo-haptics";

/**
 * Master switch, kept in sync with the hapticsEnabled app setting by
 * SettingsContext. Defaults on; playHaptic is a no-op while false so a single
 * gate covers every call site instead of each screen re-checking the setting.
 */
let hapticsEnabled = true;

export function setHapticsEnabled(enabled: boolean) {
  hapticsEnabled = enabled;
}

export enum Haptic {
  /** Lightest beat. For something repeating while a finger is down. */
  Tick = "tick",
  /** Plain button press with no state behind it: More, Menu. */
  Tap = "tap",
  /** A discrete choice landing: a tab, a filter pill, end of a scrub. */
  Select = "select",
  /** Switching something on. */
  ToggleOn = "toggleOn",
  /** Switching something off. */
  ToggleOff = "toggleOff",
  /** Forward through the queue. */
  SkipNext = "skipNext",
  /** Backward through the queue. */
  SkipPrevious = "skipPrevious",
  /** Playback starting. */
  Resume = "resume",
  /** Playback stopping. */
  Pause = "pause",
  /** Something growing to fill the screen: mini player opening. */
  Expand = "expand",
}

/**
 * Play a haptic. Fire-and-forget, safe to call from any press handler.
 * Failures (no vibrator, system toggle off) are swallowed silently.
 */
export function playHaptic(pattern: Haptic) {
  if (!hapticsEnabled) {
    return;
  }
  void (async () => {
    try {
      switch (pattern) {
        case Haptic.Tick:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case Haptic.Tap:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;
        case Haptic.Select:
        case Haptic.Expand:
          // A discrete landing: notification-style gives the crisp two-stage
          // feel without a long buzz.
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
          break;
        case Haptic.ToggleOn:
        case Haptic.Resume:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;
        case Haptic.ToggleOff:
        case Haptic.Pause:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case Haptic.SkipNext:
        case Haptic.SkipPrevious:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          break;
      }
    } catch {
      // Haptics unavailable on this device - never fatal.
    }
  })();
}
