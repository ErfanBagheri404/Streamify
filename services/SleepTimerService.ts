/********************************************************************
 *  SleepTimerService.ts - Pause playback after a delay or at track end
 *
 *  Design notes (performance contract):
 *  - No always-on intervals. When armed with minutes, exactly ONE
 *    setTimeout exists. When armed end-of-track, ONE event subscription.
 *  - UI countdown display re-derives remaining time from `endsAt`;
 *    a ticking interval lives only inside the open sheet (disposed on close).
 *  - No PlayerContext state is touched; UI reads this zustand store.
 *******************************************************************/
import TrackPlayer, { Event } from "../utils/safeTrackPlayer";
import { create } from "zustand";

export type SleepTimerMode = "minutes" | "endOfTrack";

export interface SleepTimerStoreState {
  active: boolean;
  mode: SleepTimerMode | null;
  /** epoch ms when the timer fires (mode "minutes") */
  endsAt: number | null;
  /** bump counter so open sheets can re-render on arm/clear */
  revision: number;
}

interface SleepTimerActions {
  _set: (partial: Partial<SleepTimerStoreState>) => void;
}

export const useSleepTimerStore = create<SleepTimerStoreState & SleepTimerActions>()(
  (set) => ({
    active: false,
    mode: null,
    endsAt: null,
    revision: 0,
    _set: (partial) => set((state) => ({ ...partial, revision: state.revision + 1 })),
  }),
);

const internal = {
  timeoutId: null as ReturnType<typeof setTimeout> | null,
  endOfTrackSub: null as { remove: () => void } | null,
  /** Fires once when the minutes countdown reaches zero. */
  firePause: () => {
    sleepTimerService.clear();
    TrackPlayer.pause().catch(() => {});
  },
};

export const SLEEP_TIMER_PRESET_MINUTES = [5, 10, 15, 30, 45, 60] as const;

export const sleepTimerService = {
  /** Arm a countdown of N minutes. */
  startMinutes(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    this.clear();

    const endsAt = Date.now() + minutes * 60_000;
    useSleepTimerStore.getState()._set({ active: true, mode: "minutes", endsAt });

    internal.timeoutId = setTimeout(internal.firePause, minutes * 60_000);
  },

  /**
   * Pause when the current track finishes naturally.
   * RNTP fires PlaybackQueueEnded when the last queue item ends, but the
   * app's auto-next handler may consume that path; safer signals are:
   *  - PlaybackActiveTrackChanged (queue advanced to the next item)
   *  - PlaybackState === Stopped (queue ended)
   * Either means "current track is over" for this mode.
   */
  startEndOfTrack(): void {
    this.clear();
    useSleepTimerStore.getState()._set({ active: true, mode: "endOfTrack", endsAt: null });

    const onEvent = () => {
      sleepTimerService.clear();
      TrackPlayer.pause().catch(() => {});
    };

    const activeTrackChanged = (Event as any).PlaybackActiveTrackChanged;
    if (activeTrackChanged) {
      internal.endOfTrackSub = TrackPlayer.addEventListener(activeTrackChanged, () => {
        // Only stop when playback actually moved to another item, not a
        // removal/reorder of the queue.
        TrackPlayer.getActiveTrackIndex()
          .then((index) => {
            if (index != null && index >= 0) {
              onEvent();
            }
          })
          .catch(() => onEvent());
      });
    } else {
      // Legacy fallback: queue ended = track over.
      internal.endOfTrackSub = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, onEvent);
    }
  },

  /** Disarm and reset. Safe to call any number of times. */
  clear(): void {
    if (internal.timeoutId !== null) {
      clearTimeout(internal.timeoutId);
      internal.timeoutId = null;
    }
    if (internal.endOfTrackSub) {
      internal.endOfTrackSub.remove();
      internal.endOfTrackSub = null;
    }
    useSleepTimerStore.getState()._set({ active: false, mode: null, endsAt: null });
  },

  /** Remaining ms for display; null when not armed in minutes mode. */
  getRemainingMs(): number | null {
    const { active, mode, endsAt } = useSleepTimerStore.getState();
    if (!active || mode !== "minutes" || !endsAt) {
      return null;
    }
    return Math.max(0, endsAt - Date.now());
  },
};
