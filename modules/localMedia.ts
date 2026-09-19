/********************************************************************
 *  localMedia.ts - JS side of LocalMediaModule (MediaStore scan)
 *
 *  Android-only. Web/iOS get a clean "unsupported" surface so call
 *  sites never need platform checks.
 *******************************************************************/
import { NativeModules, PermissionsAndroid, Platform } from "react-native";

export interface LocalTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  sizeBytes: number;
  filePath: string;
  contentUri: string;
  streamUrl: string;
  artworkUri: string | null;
}

type LocalMediaNative = {
  hasPermission(): Promise<boolean>;
  getLocalTracks(limit: number): Promise<LocalTrack[]>;
  getWaveformPeaks(source: string, buckets: number, coverage: number): Promise<number[]>;
};

const native = (NativeModules as any).LocalMediaModule as
  | LocalMediaNative
  | undefined;

export const isLocalMediaSupported = Platform.OS === "android" && Boolean(native);

export async function requestStoragePermission(): Promise<boolean> {
  if (!native || Platform.OS !== "android") {
    return false;
  }
  try {
    if (await native.hasPermission()) {
      return true;
    }
    const permission =
      Number(Platform.Version) >= 33
        ? "android.permission.READ_MEDIA_AUDIO"
        : "android.permission.READ_EXTERNAL_STORAGE";
    const result = await PermissionsAndroid.request(permission as any, {
      title: "Play your local music",
      message:
        "Streamify needs access to audio files on this device to list and play your downloaded music.",
      buttonPositive: "Allow",
      buttonNegative: "Not now",
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.log("[localMedia] Permission request failed:", error);
    return false;
  }
}

export async function scanLocalTracks(limit = 500): Promise<LocalTrack[]> {
  if (!native) {
    return [];
  }
  try {
    if (!(await native.hasPermission())) {
      return [];
    }
    return await native.getLocalTracks(limit);
  } catch (error) {
    console.log("[localMedia] Scan failed:", error);
    return [];
  }
}
