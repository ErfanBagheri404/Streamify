/********************************************************************
 *  PlaybackSpeedService.ts - Playback rate (0.5x - 2x)
 *
 *  Perf contract:
 *  - No intervals, no timers. A rate change is a single native call.
 *  - Rate is session-only (not persisted) — matches how music players treat
 *    speed: a transient listening mode, not a library property.
 *  - ExoPlayer resets playback parameters when a new media item loads, so the
 *    cached rate is re-applied on PlaybackActiveTrackChanged.
 *******************************************************************/
import TrackPlayer, { Event } from "../utils/safeTrackPlayer";
import { create } from "zustand";

export const PLAYBACK_SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 3;

interface PlaybackSpeedState {
  rate: number;
  revision: number;
}

export const usePlaybackSpeedStore = create<PlaybackSpeedState>()(() => ({
  rate: 1,
  revision: 0,
}));

const internal = {
  rate: 1,
  trackChangeSub: null as { remove: () => void } | null,
  listenersAttached: false,
};

const clampRate = (rate: number): number => {
  if (!Number.isFinite(rate)) {
    return 1;
  }
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
};

export const playbackSpeedService = {
  /**
   * Attach the once-per-session track-change listener that re-applies the
   * cached rate after ExoPlayer loads a new media item. Idempotent.
   */
  ensureListeners(): void {
    if (internal.listenersAttached) {
      return;
    }
    internal.listenersAttached = true;

    const activeTrackChanged = Event.PlaybackActiveTrackChanged;
    if (!activeTrackChanged) {
      return;
    }
    internal.trackChangeSub = TrackPlayer.addEventListener(activeTrackChanged, () => {
      if (internal.rate === 1) {
        return;
      }
      // Re-apply after the new item is loaded; ignore failures silently.
      setTimeout(() => {
        TrackPlayer.setRate(internal.rate).catch(() => {});
      }, 250);
    });
  },

  /** Current session rate. */
  getRate(): number {
    return internal.rate;
  },

  /** Set and apply a new playback rate. */
  async setRate(rate: number): Promise<void> {
    const next = clampRate(rate);
    internal.rate = next;
    usePlaybackSpeedStore.setState((state) => ({ rate: next, revision: state.revision + 1 }));
    // The re-apply listener only matters while the rate is non-default, so
    // it is attached on first use instead of at app start.
    if (next !== 1) {
      this.ensureListeners();
    }
    try {
      await TrackPlayer.setRate(next);
    } catch (error) {
      console.log("[PlaybackSpeed] Failed to apply rate:", error);
    }
  },

  /** Reset to 1x (used when playback is cleared). */
  reset(): void {
    if (internal.rate === 1) {
      return;
    }
    void this.setRate(1);
  },
};
