/********************************************************************
 *  songRecognition.ts — "what's this song?" (issue #36)
 *
 *  Privacy rules encoded here, not in the UI:
 *   - the recorder is bounded (MIN..MAX_SNIPPET_MS) and stops itself,
 *     so the mic is never left open;
 *   - the clip is deleted right after the submit unless the caller
 *     explicitly kept it. There is no "keep everything" default.
 *
 *  The fingerprinting service needs a token the repo does not ship.
 *  The token is read at runtime from app config
 * (expo.extra.auddToken); without it every call returns
 * `not_configured` WITHOUT touching the network. Ship a real token
 * via `expo.extra.auddToken` (or EAS env) to enable recognition.
 *******************************************************************/
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import Constants from "expo-constants";

/** AudD is the only shipped adapter; `provider` on a Match says which. */
export const AUDD_ENDPOINT = "https://api.audd.io/";

/** Hard bounds on the snippet. Never record longer than MAX. */
export const MIN_SNIPPET_MS = 5000;
export const MAX_SNIPPET_MS = 8000;

export type RecognizeFailureReason =
  | "not_configured"
  | "no_match"
  | "permission_denied"
  | "network"
  | "bad_response";

export interface SongMatch {
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  /** 0..1 provider confidence; 0 when the provider does not report one. */
  confidence: number;
  provider: string;
}

export type RecognizeResult =
  | { ok: true; match: SongMatch }
  | { ok: false; reason: RecognizeFailureReason };

export type RecordResult =
  | { ok: true; uri: string; durationMs: number }
  | { ok: false; reason: RecognizeFailureReason };

/** Token from app config. Empty string = not configured. */
export function getRecognitionToken(): string {
  const extra = (Constants as any)?.expoConfig?.extra ?? {};
  const token = extra.auddToken;
  return typeof token === "string" ? token.trim() : "";
}

export function isRecognitionConfigured(): boolean {
  return getRecognitionToken().length > 0;
}

/** Seconds left before the hard stop; used by the UI countdown. */
export function remainingSnippetMs(elapsedMs: number): number {
  return Math.max(0, MAX_SNIPPET_MS - Math.max(0, elapsedMs));
}

/**
 * Record a bounded snippet. Resolves with the clip uri; stops itself at
 * MAX_SNIPPET_MS so the mic can never run long.
 */
export async function recordSnippet(): Promise<RecordResult> {
  let granted = false;
  try {
    const permission = await Audio.requestPermissionsAsync();
    granted = !!permission?.granted;
  } catch {
    granted = false;
  }
  if (!granted) return { ok: false, reason: "permission_denied" };

  try {
    let recorder: any = null;
    let stopping = false;
    const stop = async () => {
      if (stopping || !recorder) return;
      stopping = true;
      try {
        const status = await recorder.getStatusAsync();
        await recorder.stopAndUnloadAsync();
        return status;
      } catch {
        return null;
      }
    };

    const created = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.LOW_QUALITY,
      (status: any) => {
        // Hard max: self-stop the moment the bound is reached.
        if (!stopping && (status?.durationMillis ?? 0) >= MAX_SNIPPET_MS) {
          void stop();
        }
      },
      250,
    );
    recorder = created.recording;
    const status = await stop();
    const uri = status?.uri || created.status?.uri;
    if (!uri) return { ok: false, reason: "bad_response" };
    return {
      ok: true,
      uri: String(uri),
      durationMs: Math.min(
        MAX_SNIPPET_MS,
        Math.max(MIN_SNIPPET_MS, status?.durationMillis ?? MAX_SNIPPET_MS),
      ),
    };
  } catch (error) {
    console.log("[songRecognition] recording failed:", error);
    return { ok: false, reason: "bad_response" };
  }
}

/** Abandon an in-flight snippet without submitting it. */
export async function discardSnippet(uri: string): Promise<boolean> {
  return finalizeSnippet(uri, false);
}

/**
 * Privacy rule: the clip is removed after submit unless `keep` is set.
 * Returns whether the file was actually deleted.
 */
export async function finalizeSnippet(
  uri: string,
  keep: boolean,
): Promise<boolean> {
  if (keep || !uri) return false;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    return true;
  } catch (error) {
    console.log("[songRecognition] clip delete failed:", error);
    return false;
  }
}

function toAudDResult(payload: any): RecognizeResult {
  const result = payload?.result;
  const title = typeof result?.title === "string" ? result.title.trim() : "";
  if (!title) return { ok: false, reason: "no_match" };
  const confidence = Number(result?.songlet?.confidence);
  return {
    ok: true,
    match: {
      title,
      artist: typeof result?.artist === "string" ? result.artist : "",
      album: typeof result?.album === "string" ? result.album : undefined,
      artwork: typeof result?.spotify?.thumbnail === "string"
        ? result.spotify.thumbnail
        : undefined,
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0,
      provider: "audd",
    },
  };
}

/**
 * Fingerprint a recorded clip. `fetchImpl` is injectable so tests (and
 * future providers) never hit the network. A malformed/empty provider
 * answer is a typed failure — never a fabricated match.
 */
export async function recognize(
  clipUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RecognizeResult> {
  const token = getRecognitionToken();
  if (!token) return { ok: false, reason: "not_configured" };
  if (!clipUri) return { ok: false, reason: "bad_response" };

  try {
    const form = new FormData();
    form.append("api_token", token);
    form.append("return", "apple_music,spotify");
    form.append("file", {
      uri: clipUri,
      name: "snippet.m4a",
      type: "audio/m4a",
    } as any);

    const response = await fetchImpl(AUDD_ENDPOINT, { method: "POST", body: form });
    if (!response || !response.ok) {
      return { ok: false, reason: "network" };
    }
    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "bad_response" };
    }
    if (payload.status !== "success") {
      return { ok: false, reason: "bad_response" };
    }
    return toAudDResult(payload);
  } catch (error) {
    console.log("[songRecognition] provider call failed:", error);
    return { ok: false, reason: "network" };
  }
}
