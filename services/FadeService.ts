/********************************************************************
 *  FadeService.ts - Fade in / Fade out (single-decoder volume ramp)
 *
 *  True crossfade (overlap two decoders) is not implemented — that doubles
 *  buffering and battery cost for every listener. This service provides a
 *  single-decoder alternative: a volume ramp-in at the start of a track and
 *  a volume ramp-out over the last seconds, so transitions are no longer
 *  hard cuts. Settings label "Crossfade" reflects the UX intent; the
 *  implementation is best described as fade in/out.
 *
 *  Perf contract:
 *  - Zero subscriptions. It is driven by the progress event PlayerContext
 *    already receives (4 ticks/second).
 *  - setVolume() is called ONLY when the rounded target changes. Outside the
 *    fade windows the target is exactly 1, and after the one call that resets
 *    it we do nothing at all — steady-state playback issues zero native
 *    volume calls.
 *  - No timers, no state stored on the JS heap beyond three primitives.
 *******************************************************************/
import TrackPlayer from "../utils/safeTrackPlayer";

const internal = {
  enabled: false,
  seconds: 4,
  /** Last volume we told the native player, rounded to 2 decimals. */
  lastApplied: null as number | null,
  /** Volume the user/UI requested; fades are applied relative to this. */
  baseVolume: 1,
  /** ReplayGain linear factor (1 = none). Multiplies baseVolume. */
  trackGain: 1,
  /** ReplayGain master toggle. */
  gainEnabled: false,
  /** Wake-radio ramp: wall-clock volume climb, independent of crossfade. */
  ramp: null as { startAt: number; durationMs: number } | null,
};

/** Effective reference level: user volume × track gain (when enabled). */
function refLevel(): number {
  return internal.gainEnabled
    ? Math.max(0, Math.min(1, internal.baseVolume * internal.trackGain))
    : internal.baseVolume;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Ramp almost — but not fully — to silence. At 0.02 the tail of the
 * fade-out is inaudible, so the decoder hand-off between tracks never
 * produces a volume jump; the incoming track's fade-in carries the ear
 * from near-silence back to full level. (A single decoder cannot truly
 * overlap two tracks; this is the closest legal smooth transition.) */
const FADE_FLOOR = 0.02;

async function applyVolume(target: number): Promise<void> {
  const rounded = round2(target);
  if (internal.lastApplied === rounded) {
    return; // unchanged — skip the native round-trip entirely
  }
  internal.lastApplied = rounded;
  try {
    await TrackPlayer.setVolume(rounded);
  } catch {
    // Volume is cosmetic; a failed call must never surface as a playback error.
  }
}

export const fadeService = {
  /** Sync the enabled state / window from settings. Cheap, call on change. */
  configure(enabled: boolean, seconds: number, baseVolume = internal.baseVolume): void {
    internal.enabled = enabled;
    internal.seconds = Math.max(1, Math.min(12, seconds || 4));
    internal.baseVolume = baseVolume;
    // When turning off, hand control back to the player's own volume once.
    if (!enabled && internal.lastApplied !== round2(refLevel())) {
      void applyVolume(refLevel());
    }
  },

  setBaseVolume(volume: number): void {
    internal.baseVolume = Math.max(0, Math.min(1, volume));
    // A manual volume change is the user taking control — drop the ramp.
    internal.ramp = null;
    // Outside a fade the base volume is what should be audible right now.
    if (!internal.enabled) {
      void applyVolume(refLevel());
    }
  },

  /** ReplayGain support (feature f12). gain = linear factor, 1 = none. */
  setTrackGain(gain: number, enabled: boolean): void {
    internal.trackGain = Math.max(0.1, Math.min(3.16, gain || 1));
    internal.gainEnabled = enabled;
    // Re-assert immediately so the change is audible without waiting for a tick.
    if (!internal.enabled) {
      void applyVolume(refLevel());
    }
  },

  /**
   * Called from the existing PlaybackProgressUpdated handler.
   * position/duration in seconds.
   */
  onProgress(position: number, duration: number): void {
    // Wake-radio ramp wins over crossfade while active: the alarm's 1-3
    // minute climb is a wall-clock ramp, not a track-position ramp, and it
    // must survive track changes (position resets) and the crossfade-off
    // fast path.
    const rampFraction = internal.ramp ? fadeService.rampFraction() : null;
    if (rampFraction !== null) {
      const target = refLevel() * rampFraction;
      if (rampFraction === 1) {
        // Ramp just completed: hand back to normal fade logic from the
        // next tick; this tick settles on full level.
        void applyVolume(target);
        return;
      }
      void applyVolume(target);
      return;
    }

    if (!internal.enabled) {
      if (internal.lastApplied !== round2(refLevel())) {
        void applyVolume(refLevel());
      }
      return;
    }

    // Track length unknown (live streams) — hold at base volume.
    if (!duration || duration <= 0) {
      if (internal.lastApplied !== round2(refLevel())) {
        void applyVolume(refLevel());
      }
      return;
    }

    const window = Math.min(internal.seconds, duration / 3);
    const remaining = duration - position;

    let target: number;
    if (position < window) {
      // Fade in over the first `window` seconds.
      target = refLevel() * Math.max(FADE_FLOOR, position / window);
    } else if (remaining <= window) {
      // remaining can hit exactly 0 at the final progress tick — stay on the
      // fade-out branch so the else never restores full volume for one frame.
      // Fade out over the last `window` seconds, stopping above silence so
      // the hand-off to the next track never bottoms out into dead air.
      target = refLevel() * Math.max(FADE_FLOOR, remaining / window);
    } else {
      target = refLevel();
    }

    void applyVolume(target);
  },

  /**
   * Hand volume back at track change / pause.
   *
   * When fading is enabled the next track's fade-in owns the ramp, so we
   * must NOT jump to full base volume here — the old track ended at the
   * 0.25 floor and a 0.25 -> 1.0 -> 0.25 spike reads as a hard cut. Drop
   * to the floor instead and let the fade-in ramp up smoothly. Disabled
   * fades still reset to base immediately.
   */
  reset(): void {
    if (internal.enabled) {
      void applyVolume(refLevel() * FADE_FLOOR);
      return;
    }
    void applyVolume(refLevel());
  },

  /**
   * Start a wake-radio ramp: the volume climbs from the floor to the user's
   * level over `durationMs` of wall-clock time, regardless of track
   * position. Crossfade stays untouched — this is for alarms, not for
   * track transitions. Any explicit setBaseVolume call (user touched the
   * slider) cancels the ramp: manual control always wins over automation.
   */
  startRamp(durationMs: number): void {
    internal.ramp = {
      startAt: Date.now(),
      durationMs: Math.max(30_000, Math.min(180_000, durationMs || 120_000)),
    };
    void applyVolume(refLevel() * FADE_FLOOR);
  },

  /** True while a ramp is still climbing. */
  isRamping(): boolean {
    return internal.ramp !== null;
  },

  /**
   * Ramp fraction [0,1] applied inside onProgress. Null when no ramp is
   * active — callers treat that as full volume.
   */
  rampFraction(now: number = Date.now()): number | null {
    const ramp = internal.ramp;
    if (!ramp) {
      return null;
    }
    const elapsed = now - ramp.startAt;
    if (elapsed >= ramp.durationMs) {
      internal.ramp = null;
      return 1;
    }
    // Elapsed can go negative when the clock jumps backwards; clamp.
    return Math.max(FADE_FLOOR, elapsed / ramp.durationMs);
  },
};
