/**
 * Music-video resolution for issue #27 (YouTube-sourced only).
 *
 * ONE-SHOT RULE (see modules/innertube.ts): a googlevideo media URL dies on
 * its second fetch. This module therefore NEVER fetches a media URL. It hands
 * the resolved Innertube URL straight to the player; the player's own first
 * fetch is the verification. Probing here would burn the URL and 403 the
 * real playback.
 *
 * Live path goes through resolveInnertubeStream — no client walk, visitor-id
 * minting, or header construction is duplicated here. The pure format helpers
 * below exist only for offline tests against the captured player fixture
 * (MuxedOnlyNote: react-native-video v6 takes a single source map, so only
 * muxed progressive video+audio formats are playable — DASH video-only
 * adaptive streams cannot be paired with an audio track).
 *
 * Scope note: YouTube only. There is no JioSaavn video resolver in this repo
 * and JioSaavn's video endpoint is undocumented and geo-fenced, so JioSaavn
 * video is out of scope (issue #27).
 */
import { resolveInnertubeVideo } from "./innertube";

export interface MusicVideoSource {
  videoId: string;
  /** react-native-video `source` prop. */
  source: { uri: string; type: "mp4"; headers: Record<string, string> };
  /** Headers the media fetch must repeat (googlevideo compares them to the URL). */
  headers: Record<string, string>;
  /** Kept for logging/tests. NEVER fetched from this module. */
  videoUrl: string;
  height: number;
  bitrate: number;
  itag: number;
}

export type MusicVideoFailureReason = "unsupported-track" | "unavailable";

export type MusicVideoResult =
  | { ok: true; video: MusicVideoSource }
  | { ok: false; reason: MusicVideoFailureReason };

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * YouTube videoId for a track, or null. A track id is a YouTube id when it is
 * 11 URL-safe chars; otherwise look inside the track URL (watch?v=, youtu.be,
 * /embed/, /shorts/).
 */
export function extractYouTubeVideoId(track: {
  id?: string;
  url?: string;
}): string | null {
  const id = (track.id ?? "").trim();
  if (VIDEO_ID_RE.test(id)) return id;
  const url = track.url ?? "";
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ??
    url.match(/\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Plain-url muxed progressive video+audio. DASH video-only is NOT usable: */
function isPlayable(f: any): boolean {
  const mime = String(f?.mimeType ?? "");
  // react-native-video v6 takes a SINGLE source map (setSrc(ReadableMap)), so a
  // DASH video-only stream cannot be paired with an audio track. Only accept a
  // muxed progressive format. In the player response, `audioQuality` is
  // present ONLY on muxed formats — video-only adaptive formats omit it, so an
  // absent audioQuality means there is no audio track in this stream.
  if (!mime.startsWith("video/")) return false;
  if (!mime.includes('codecs="avc1')) return false; // ExoPlayer: avc1/h264 is the safe bet
  if (typeof f?.audioQuality !== "string" || f.audioQuality === "AUDIO_QUALITY_NONE") return false;
  // Ciphered / po-gated formats have no plain url — nothing to hand over.
  return typeof f?.url === "string" && f.url.length > 0;
}

export function formatHeight(f: any): number {
  if (typeof f?.height === "number") return f.height;
  const m = String(f?.qualityLabel ?? "").match(/(\d+)p/);
  return m ? Number(m[1]) : 0;
}

/**
 * Muxed video+audio candidates for the innertube resolver. Returns the whole
 * playable SET, not one winner: tryClient filters for plain URLs and takes
 * the max bitrate, which has to happen after ciphered formats are dropped.
 */
export function pickVideoFormat(formats: any[]): any[] {
  return (formats ?? []).filter(isPlayable);
}

/**
 * The winner among playable formats, used by the offline fixture tests.
 */
export function pickBestVideoFormat(formats: any[]): any | null {
  const usable = pickVideoFormat(formats);
  if (!usable.length) return null;
  return usable.sort((a, b) => {
    const h = formatHeight(b) - formatHeight(a);
    return h !== 0 ? h : (b.bitrate ?? 0) - (a.bitrate ?? 0);
  })[0];
}

/**
 * Resolve the music video for a track. Live path delegates to
 * modules/innertube.ts resolveInnertubeStream: it mints the visitor id, walks
 * the clients, handles bot-accusation retry, and honours the one-shot rule.
 * This module never re-implements the client walk and never probes a URL.
 */
export async function resolveMusicVideo(track: {
  id?: string;
  url?: string;
}): Promise<MusicVideoResult> {
  const videoId = extractYouTubeVideoId(track);
  if (!videoId) return { ok: false, reason: "unsupported-track" };

  const stream = await resolveInnertubeVideo(videoId, pickVideoFormat);
  if (!stream) return { ok: false, reason: "unavailable" };

  console.log(
    `[MusicVideo] ${videoId} via ${stream.clientName} itag=${stream.itag} (${stream.bitrate}bps)`,
  );
  return {
    ok: true,
    video: {
      videoId,
      source: {
        uri: stream.url,
        type: "mp4",
        headers: stream.mediaHeaders,
      },
      headers: stream.mediaHeaders,
      videoUrl: stream.url,
      // The real muxed height, not a placeholder: the player uses this to
      // size the surface, and 0 made every video render as audio-only.
      height: formatHeight(stream),
      bitrate: stream.bitrate,
      itag: stream.itag,
    },
  };
}
