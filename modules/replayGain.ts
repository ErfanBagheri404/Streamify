/********************************************************************
 *  replayGain.ts — ReplayGain normalization for local/cached files
 *
 *  Reads the tag block (first 64 KB) of a local audio file and
 *  extracts REPLAYGAIN_TRACK_GAIN / ALBUM (ID3v2 TXXX and Vorbis
 *  comments both surface as plain ASCII in that window) or the Opus
 *  R128_TRACK_GAIN variant, then converts dB to a linear gain factor.
 *
 *  The factor is applied by FadeService on top of the user's volume,
 *  so it costs zero extra native calls in steady state.
 *
 *  No full container parsing on purpose: both tag schemes put the
 *  gain string in the first 64 KB, and a substring scan over latin1
 *  text covers MP3 / M4A / FLAC / OGG / OPUS in one code path.
 *******************************************************************/
import * as FileSystem from "expo-file-system/legacy";
import { toByteArray } from "base64-js";

const TAG_WINDOW_BYTES = 65536;
/** Safety clamp: never amplify more than +10 dB or attenuate below -20 dB. */
export const GAIN_FLOOR = 0.1;
export const GAIN_CEIL = 3.16;

export interface ReplayGainInfo {
  trackGainDb: number | null;
  albumGainDb: number | null;
}

/** dB → linear, clamped to the safety window. */
export function dbToFactor(db: number | null): number | null {
  if (db === null || !Number.isFinite(db)) {
    return null;
  }
  const raw = Math.pow(10, db / 20);
  return Math.min(GAIN_CEIL, Math.max(GAIN_FLOOR, raw));
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  // chunked String.fromCharCode keeps the call stack small
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(
      null as any,
      Array.from(bytes.subarray(i, i + CHUNK)) as any,
    );
  }
  return out;
}

/** Scan a latin1 tag block for REPLAYGAIN_* values (dB). */
function scanReplayGain(text: string): ReplayGainInfo {
  // ID3v2 TXXX: "REPLAYGAIN_TRACK_GAIN\x00<enc>-6.48 dB" — the regex allows
  // any single control/separator char between the key and the number.
  // Vorbis: "REPLAYGAIN_TRACK_GAIN=-6.48 dB".
  const track = matchGainDb(text, "REPLAYGAIN_TRACK_GAIN");
  const album = matchGainDb(text, "REPLAYGAIN_ALBUM_GAIN");
  return { trackGainDb: track, albumGainDb: album };
}

function matchGainDb(text: string, key: string): number | null {
  const re = new RegExp(
    key + String.raw`[\x00=\t ]{1,4}([+-]?\d+(?:\.\d+)?)\s*dB`,
    "i",
  );
  const m = text.match(re);
  if (!m) {
    return null;
  }
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** Opus R128_TRACK_GAIN is Q7.8 fixed point in 256ths of a dB. */
function scanR128(text: string): number | null {
  const m = text.match(/R128_TRACK_GAIN=([+-]?\d+)/);
  if (!m) {
    return null;
  }
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) ? v / 256 : null;
}

/**
 * Parse replay gain info from a local file:// or content:// URI.
 * Returns nulls when the file carries no gain tags.
 */
export async function readReplayGainInfo(
  fileUri: string,
): Promise<ReplayGainInfo> {
  const empty: ReplayGainInfo = { trackGainDb: null, albumGainDb: null };
  if (!fileUri) {
    return empty;
  }
  try {
    let uri = fileUri;
    if (!uri.startsWith("file://") && !uri.startsWith("content://")) {
      uri = `file://${uri}`;
    }
    // content:// URIs can't be read positionally by expo-file-system; only
    // file paths are scanned. content:// falls through to no-gain.
    if (uri.startsWith("content://")) {
      return empty;
    }
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: TAG_WINDOW_BYTES,
    });
    if (!b64) {
      return empty;
    }
    const bytes = toByteArray(b64);
    const text = latin1(bytes);

    const info = scanReplayGain(text);
    if (info.trackGainDb === null && info.albumGainDb === null) {
      const r128 = scanR128(text);
      if (r128 !== null) {
        return { trackGainDb: r128, albumGainDb: null };
      }
    }
    return info;
  } catch (error) {
    console.log("[replayGain] read failed:", error);
    return empty;
  }
}

/** Resolved linear gain factor for a track; 1 when disabled/absent. */
export async function computeTrackGainFactor(
  fileUri: string | null,
  preferAlbum: boolean,
): Promise<number> {
  if (!fileUri) {
    return 1;
  }
  const info = await readReplayGainInfo(fileUri);
  const db =
    (preferAlbum ? info.albumGainDb ?? info.trackGainDb : info.trackGainDb) ??
    null;
  const factor = dbToFactor(db);
  return factor ?? 1;
}

let localPathIndex: Promise<Record<string, string>> | null = null;

/**
 * Resolve a scannable file path for a track id.
 * - `local-<id>` → MediaStore DATA path (works with READ_MEDIA_AUDIO).
 * - otherwise    → fully-cached file:// path, if the download finished.
 */
export async function resolveGainSourcePath(
  trackId: string,
): Promise<string | null> {
  if (!trackId) {
    return null;
  }
  if (trackId.startsWith("local-")) {
    if (!localPathIndex) {
      localPathIndex = (async () => {
        try {
          const { scanLocalTracks } = await import("./localMedia");
          const tracks = await scanLocalTracks(500);
          const map: Record<string, string> = {};
          for (const t of tracks) {
            if (t.filePath) {
              map[t.id] = t.filePath;
            }
          }
          return map;
        } catch {
          return {};
        }
      })();
    }
    const map = await localPathIndex;
    return map[trackId.slice(6)] ?? null;
  }
  const { getFullyCachedAudioUrl } = await import("./audioStreaming");
  return getFullyCachedAudioUrl(trackId);
}
