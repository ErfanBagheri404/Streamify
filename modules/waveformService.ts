/********************************************************************
 *  waveformService.ts — peak-envelope waveforms for the seek bar
 *
 *  Delegates actual PCM decode to LocalMediaModule (MediaExtractor +
 *  MediaCodec on Android). Falls back to flat bars when native decode
 *  is unavailable (web/iOS), so the UI never blocks on this.
 *
 *  Waveforms are cached per trackId in AsyncStorage; cache is capped
 *  so old entries rotate out.
 *******************************************************************/
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFullyCachedAudioUrl } from "./audioStreaming";
import { isLocalMediaSupported, LocalTrack } from "./localMedia";
import { NativeModules, Platform } from "react-native";

const CACHE_KEY = "streamify.waveform.peaks.v1";
const MAX_CACHED = 80;
const WAVEFORM_BUCKETS = 56;

// Minimal peak set used when no real waveform exists.
const FLAT_PEAKS = new Array(WAVEFORM_BUCKETS).fill(0.35);

const native = (NativeModules as any).LocalMediaModule as
  | {
      getWaveformPeaks(
        source: string,
        buckets: number,
        coverage: number,
      ): Promise<number[]>;
    }
  | undefined;

export interface WaveformRequest {
  trackId: string;
  /** content:// or file:// URI of the actual audio the player is using. */
  source: string;
}

let peakCache: Record<string, number[]> | null = null;
const inflight = new Map<string, Promise<number[] | null>>();

async function loadPeakCache(): Promise<Record<string, number[]>> {
  if (peakCache) {
    return peakCache;
  }
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    peakCache = raw ? JSON.parse(raw) : {};
  } catch {
    peakCache = {};
  }
  return peakCache!;
}

async function persistPeakCache(cache: Record<string, number[]>): Promise<void> {
  // cap the cache: oldest entries (first inserted) drop out first
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHED) {
    for (const k of keys.slice(0, keys.length - MAX_CACHED)) {
      delete cache[k];
    }
  }
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full — non-fatal, waveform will just recompute next time
  }
}

/**
 * Compute peaks for a track. Returns null if a real waveform cannot be
 * produced (remote, not cached, platform without native decode).
 */
export async function getWaveformPeaks(
  trackId: string,
): Promise<number[] | null> {
  if (!trackId) {
    return null;
  }

  const cache = await loadPeakCache();
  const hit = cache[trackId];
  if (hit && hit.length) {
    return hit;
  }

  if (inflight.has(trackId)) {
    return inflight.get(trackId)!;
  }

  const task = (async (): Promise<number[] | null> => {
    // 1. Local MediaStore track → play its content URI directly.
    //    (`_isLocal` tracks have a content:// audioUrl already)
    const source = await resolveSourceForTrack(trackId);
    if (!source) {
      return null;
    }

    if (!native || Platform.OS !== "android") {
      return null;
    }

    try {
      const peaks = await native.getWaveformPeaks(source, WAVEFORM_BUCKETS, 1.0);
      if (!peaks || !peaks.length) {
        return null;
      }
      cache[trackId] = peaks;
      await persistPeakCache(cache);
      return peaks;
    } catch (error) {
      console.log("[waveform] decode failed:", error);
      return null;
    }
  })();

  inflight.set(trackId, task);
  try {
    return await task;
  } finally {
    inflight.delete(trackId);
  }
}

let localTracksIndex: Promise<LocalTrack[]> | null = null;

/** Find the content:// URI of a local MediaStore track by id. */
async function resolveSourceForTrack(trackId: string): Promise<string | null> {
  // Local tracks use their MediaStore id as trackId prefix "local-".
  if (trackId.startsWith("local-")) {
    if (!localTracksIndex) {
      const scan = (await import("./localMedia")).scanLocalTracks;
      localTracksIndex = scan(500);
    }
    const tracks = await localTracksIndex;
    const match = tracks.find((t) => t.id === trackId.slice(6));
    return match?.contentUri ?? null;
  }
  return getFullyCachedAudioUrl(trackId);
}

/** Placeholder bars for UI while no waveform exists. */
export function getFallbackPeaks(): number[] {
  return FLAT_PEAKS.slice();
}

export const WAVEFORM_BUCKET_COUNT = WAVEFORM_BUCKETS;
export const waveformSupported = Platform.OS === "android" && Boolean(native);
