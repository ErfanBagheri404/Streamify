/********************************************************************
 *  useHearingSafety.ts — wires settings to the native limiter and
 *  drives the exposure meter.
 *
 *  Two jobs, both driven from one effect so the meter can never keep
 *  counting against a limiter the user turned off:
 *  1. Push the saved limiter state to the native module. The toggle
 *     gates everything: off means `setEnabled(false)`, never a
 *     `setEnabled(true)`.
 *  2. Accumulate estimated dB-hours while audio is actually playing.
 *     Paused or muted contributes nothing — see the gate below.
 *
 *  Mounted once, from App.tsx next to PlayerProvider.
 *******************************************************************/
import { useEffect, useRef } from "react";

import { useAppSettings } from "./useAppSettings";
import {
  dayStamp,
  estimateDbA,
  getHearingLimiterState,
  getOutputVolume,
  isExposureDayStale,
  readExposureDays,
  recordExposure,
  setHearingCeiling,
  setHearingLimiterEnabled,
  writeExposureDays,
  type HearingNativeState,
} from "../modules/hearingSafety";
import type { HearingDeviceProfile } from "../lib/app-settings";

/** How often the meter folds elapsed time into the day total. */
const TICK_MS = 30_000;

export interface UseHearingSafetyOptions {
  isPlaying: boolean;
  deviceProfile: HearingDeviceProfile;
  onState?: (state: HearingNativeState) => void;
}

export function useHearingSafety({
  isPlaying,
  deviceProfile,
  onState,
}: UseHearingSafetyOptions): void {
  const { settings } = useAppSettings();
  const { hearingLimiterEnabled, hearingCeiling } = settings;
  const lastTickRef = useRef<number>(0);

  // 1. Settings -> native limiter. The toggle is the gate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await getHearingLimiterState();
      if (!cancelled) onState?.(state);
      if (!state.supported) {
        await setHearingLimiterEnabled(false);
        return;
      }
      if (hearingLimiterEnabled) {
        await setHearingCeiling(hearingCeiling);
        await setHearingLimiterEnabled(true);
      } else {
        await setHearingLimiterEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hearingLimiterEnabled, hearingCeiling, onState]);

  // 2. Exposure ticker. A day change resets the stored list, so the
  //    meter resets daily without a background job.
  useEffect(() => {
    let cancelled = false;

    const resetIfNewDay = async () => {
      const today = dayStamp();
      const days = await readExposureDays();
      if (days.length === 0) return;
      if (days.some((entry) => isExposureDayStale(entry, today))) {
        const stale = days.some((entry) => entry.day !== today);
        if (stale) {
          await writeExposureDays(days.filter((entry) => entry.day === today));
        }
      }
    };

    const tick = async () => {
      const now = Date.now();
      const last = lastTickRef.current;
      lastTickRef.current = now;
      // Paused or muted: nothing is being heard, so nothing accrues.
      if (!isPlaying) return;
      if (last === 0) {
        await resetIfNewDay();
        return;
      }
      const elapsedSeconds = Math.min((now - last) / 1000, 120);
      if (elapsedSeconds <= 0) return;
      const volume = await getOutputVolume();
      // Volume 0 is the mute case; null means the ROM would not report it.
      if (volume === null || volume <= 0) return;
      const dbA = estimateDbA(volume, deviceProfile);
      if (dbA === null) return;
      await recordExposure({ dbA, elapsedSeconds, today: dayStamp() });
    };

    void resetIfNewDay();
    const timer = setInterval(() => {
      if (cancelled) return;
      void tick();
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isPlaying, deviceProfile]);
}
