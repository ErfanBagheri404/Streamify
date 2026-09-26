/********************************************************************
 *  audioEqualizer.ts - JS side of StreamifyEqualizerModule (issue #28)
 *
 *  Android-only hardware equalizer on AudioEffect.EFFECT_TYPE_EQUALIZER,
 *  attached to the global output mix (session 0) because neither
 *  kotlin-audio nor track-player exposes a sessionId to JS.
 *
 *  Web/iOS get a clean "unsupported" surface so call sites never need
 *  platform checks. Nothing here can throw into a playback path.
 *******************************************************************/
import { NativeModules, Platform } from "react-native";

export interface EqualizerInfo {
  supported: boolean;
  numberOfBands: number;
  minMillibel: number;
  maxMillibel: number;
  levels: number[];
  centerFreqHz: number[];
}

type EqualizerNative = {
  getInfo(): Promise<EqualizerInfo>;
  setBandLevel(band: number, millibel: number): Promise<number>;
  setEnabled(enabled: boolean): Promise<boolean>;
};

const native = (NativeModules as any).StreamifyEqualizerModule as
  | EqualizerNative
  | undefined;

/** Surfaced when the Android binary was built without the config plugin. */
export const EQUALIZER_LINK_ERROR =
  "StreamifyEqualizerModule is not linked. Run `npx expo prebuild --clean` and rebuild the Android app.";

const UNSUPPORTED: EqualizerInfo = {
  supported: false,
  numberOfBands: 0,
  minMillibel: 0,
  maxMillibel: 0,
  levels: [],
  centerFreqHz: [],
};

export const isEqualizerSupported = Platform.OS === "android" && Boolean(native);

let linkErrorLogged = false;

export async function getEqualizerInfo(): Promise<EqualizerInfo> {
  if (Platform.OS !== "android") {
    return UNSUPPORTED;
  }
  if (!native) {
    if (!linkErrorLogged) {
      linkErrorLogged = true;
      console.warn(EQUALIZER_LINK_ERROR);
    }
    return UNSUPPORTED;
  }
  try {
    return await native.getInfo();
  } catch {
    return UNSUPPORTED;
  }
}

/** Resolves the millibel actually applied (native clamps), or null if absent. */
export async function setEqualizerBandLevel(
  band: number,
  millibel: number,
): Promise<number | null> {
  if (!native || Platform.OS !== "android") {
    return null;
  }
  try {
    return await native.setBandLevel(band, millibel);
  } catch {
    return null;
  }
}

export async function setEqualizerEnabled(enabled: boolean): Promise<boolean> {
  if (!native || Platform.OS !== "android") {
    return false;
  }
  try {
    return await native.setEnabled(enabled);
  } catch {
    return false;
  }
}
