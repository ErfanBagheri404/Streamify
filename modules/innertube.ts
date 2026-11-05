/**
 * Device-side Innertube resolver:
 *   1. Mint visitorData from youtube.com/sw.js_data (service-worker bootstrap)
 *   2. Walk clients with their exact versions/UA/headers
 *   3. Verify any candidate URL with a 1-byte range fetch using that client's
 *      media headers before returning it
 *
 * All requests run on the device network (OkHttp under RN fetch).
 */

import {
  bpsToKbps,
  currentCapKbps,
  notePickedBitrate,
  pickCandidateByCap,
} from "./audioQualityPolicy";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const MUSIC_ORIGIN = "https://music.youtube.com";
const YOUTUBE_ORIGIN = "https://www.youtube.com";

interface ClientCfg {
  name: string;
  base: string;
  cid: string;
  cver: string;
  ua: string;
  ctx: Record<string, unknown>;
  origin?: string;
}

/**
 * Client walk order. The four at the top
 * return plain `url` fields; ANDROID at the bottom returns ciphered formats
 * (not usable without the player-JavaScript signature solver).
 * needsSignatureTimestamp clients are NOT in this list for that reason.
 */
const CLIENTS: ClientCfg[] = [
  {
    name: "ANDROID_MUSIC",
    base: "https://music.youtube.com/youtubei/v1",
    cid: "21",
    cver: "8.39.42",
    ua: "com.google.android.apps.youtube.music/8.39.42 (Linux; U; Android 15; en_US; Pixel 9 Pro; Build/AP4A.250205.002) gzip",
    ctx: { clientName: "ANDROID_MUSIC", clientVersion: "8.39.42", osName: "Android", osVersion: "15", deviceMake: "Google", deviceModel: "Pixel 9 Pro", androidSdkVersion: 35 },
  },
  {
    name: "TVHTML5",
    base: "https://www.youtube.com/youtubei/v1",
    cid: "7",
    cver: "7.20260707.07.00",
    ua: "Mozilla/5.0(SMART-TV; Linux; Tizen 4.0.0.2) AppleWebkit/605.1.15 (KHTML, like Gecko) SamsungBrowser/9.2 TV Safari/605.1.15",
    ctx: { clientName: "TVHTML5", clientVersion: "7.20260707.07.00" },
    origin: YOUTUBE_ORIGIN,
  },
  {
    name: "ANDROID_VR",
    base: "https://www.youtube.com/youtubei/v1",
    cid: "28",
    cver: "1.65.10",
    ua: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    ctx: { clientName: "ANDROID_VR", clientVersion: "1.65.10", osName: "Android", osVersion: "12L", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32 },
  },
  {
    name: "ANDROID_VR_LEGACY",
    base: "https://www.youtube.com/youtubei/v1",
    cid: "28",
    cver: "1.43.32",
    ua: "com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)",
    ctx: { clientName: "ANDROID_VR", clientVersion: "1.43.32", osName: "Android", osVersion: "12", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32 },
  },
  {
    name: "IOS",
    base: "https://www.youtube.com/youtubei/v1",
    cid: "5",
    cver: "21.26.4",
    ua: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    ctx: { clientName: "IOS", clientVersion: "21.26.4", osName: "iPhone", osVersion: "18.3.2.22D82", deviceMake: "Apple", deviceModel: "iPhone16,2" },
  },
  {
    name: "IOS_RECENT",
    base: "https://www.youtube.com/youtubei/v1",
    cid: "5",
    cver: "21.29.1",
    ua: "com.google.ios.youtube/21.29.1 (iPhone16,2; U; CPU iOS 18_5 like Mac OS X;)",
    ctx: { clientName: "IOS", clientVersion: "21.29.1", osName: "iPhone", osVersion: "18.5.22F70", deviceMake: "Apple", deviceModel: "iPhone16,2" },
  },
];

// ---- visitorData -----------------------------------------------------------

/** Protobuf-in-base64; always this shape (VISITOR_DATA regex). */
const VISITOR_DATA_RE = /Cg[A-Za-z0-9_%-]{40,}/;

function findVisitorData(el: any): string | null {
  if (Array.isArray(el)) {
    for (const item of el) {
      const hit = findVisitorData(item);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof el === "string") {
    const m = el.match(VISITOR_DATA_RE);
    return m ? m[0] : null;
  }
  return null;
}

let cachedVisitorData: string | null = null;
let visitorDataAt = 0;
const VISITOR_TTL_MS = 10 * 60 * 1000;

/** Per-video media headers the player must repeat — keyed by videoId. */
const resolvedMediaHeaders = new Map<string, Record<string, string>>();

/**
 * Retrieve the media headers a resolved videoId needs. The player (RNTP /
 * ExoPlayer) must repeat these or googlevideo refuses / throttles.
 */
export function getInnertubeMediaHeaders(videoId: string): Record<string, string> | null {
  return resolvedMediaHeaders.get(videoId) ?? null;
}

/**
 * Mint a visitor id the way the web player's service worker does. Worth
 * refreshing exactly once when a request comes back accusing us of being a
 * bot — an id can burn while the session around it is fine.
 */
async function ensureVisitorData(refresh = false): Promise<string | null> {
  const now = Date.now();
  if (!refresh && cachedVisitorData && now - visitorDataAt < VISITOR_TTL_MS) {
    return cachedVisitorData;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch("https://www.youtube.com/sw.js_data", {
      headers: { "User-Agent": WEB_UA },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await res.text();
    // Anti-hijacking prefix, then plain nested arrays.
    const nl = body.indexOf("\n");
    const payload = nl >= 0 ? body.slice(nl + 1) : body.slice(5);
    const parsed = JSON.parse(payload);
    const vd = findVisitorData(parsed);
    if (vd) {
      cachedVisitorData = vd;
      visitorDataAt = now;
      return vd;
    }
  } catch (e) {
    console.warn(
      "[Innertube] could not mint a visitor id:",
      e instanceof Error ? e.message : e,
    );
  }
  return cachedVisitorData;
}

// ---- player walk -----------------------------------------------------------

export interface InnertubeStream {
  videoId: string;
  url: string;
  itag: number;
  bitrate: number;
  mimeType: string;
  clientName: string;
  visitorDataUsed: boolean;
  /** Headers the *media* fetch must carry (mediaHeaders rule). */
  mediaHeaders: Record<string, string>;
}

const PLAYER_TIMEOUT_MS = 20000;

async function tryClient(
  c: ClientCfg,
  videoId: string,
  visitorData: string | null,
): Promise<InnertubeStream | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAYER_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": c.ua,
      "X-YouTube-Client-Name": c.cid,
      "X-YouTube-Client-Version": c.cver,
    };
    if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;
    if (c.origin) {
      headers["Origin"] = c.origin;
      headers["Referer"] = `${c.origin}/`;
    }
    const ctx: any = { ...c.ctx, hl: "en", gl: "US" };
    if (visitorData) ctx.visitorData = visitorData;

    const res = await fetch(`${c.base}/player?prettyPrint=false`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        context: { client: ctx },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.log(`[Innertube] ${c.name}: HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    const status = data?.playabilityStatus?.status;
    if (status !== "OK") {
      console.log(
        `[Innertube] ${c.name}: ${status} (${data?.playabilityStatus?.reason ?? "no reason"})`,
      );
      return null;
    }
    const formats: any[] = data?.streamingData?.adaptiveFormats ?? [];
    const audio = formats.filter((f) =>
      (f.mimeType ?? "").startsWith("audio/"),
    );
    if (!audio.length) {
      console.log(`[Innertube] ${c.name}: OK but no audio formats`);
      return null;
    }
    // Only plain-URL formats are usable without the signature solver.
    const withUrl = audio.filter((f) => typeof f.url === "string" && f.url);
    if (!withUrl.length) {
      console.log(
        `[Innertube] ${c.name}: ${audio.length} audio formats, none with plain URL (ciphered/po-gated)`,
      );
      return null;
    }
    // #35: honor the per-network cap here (inside the per-client pick), so a
    // lower-bitrate format wins when the cap is on. With no cap this is the
    // same "highest bitrate" reduce as before.
    const capped = withUrl.map((f: any) => ({
      format: f,
      bitrateKbps: bpsToKbps(f.bitrate),
    }));
    const best = pickCandidateByCap(capped, currentCapKbps())?.format;
    if (!best) {
      return null;
    }
    // #35: publish the bitrate actually chosen so the byte counter can price
    // this stream instead of guessing from the cap.
    notePickedBitrate(videoId, bpsToKbps(best.bitrate));
    // Media headers the player must repeat for a URL this client minted —
    // googlevideo bakes the client into the URL and compares it with the
    // headers of the request that comes back for the bytes.
    const mediaHeaders: Record<string, string> = { "User-Agent": c.ua };
    if (c.origin) {
      mediaHeaders["Origin"] = c.origin;
      mediaHeaders["Referer"] = `${c.origin}/`;
    }
    // Key by the resolved URL, not videoId. A refreshed mint for the same
    // videoId produces a different googlevideo URL that may need different
    // client headers; associating them prevents stale 403s on reminted URLs.
    resolvedMediaHeaders.set(best.url, mediaHeaders);
    return {
      videoId,
      url: best.url,
      itag: best.itag,
      bitrate: best.bitrate ?? 0,
      mimeType: best.mimeType ?? "",
      clientName: c.name,
      visitorDataUsed: Boolean(visitorData),
      mediaHeaders,
    };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      console.log(`[Innertube] ${c.name}: timeout after ${PLAYER_TIMEOUT_MS}ms`);
    } else {
      console.log(`[Innertube] ${c.name}: ${e?.message ?? e}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// NOTE: googlevideo media URLs are ONE-SHOT — the first fetch of a minted
// URL succeeds (206) and every later fetch of the same URL gets 403
// (confirmed 5/5 on device). So no URL is ever probed here: the caller's
// single download/playback fetch IS the verification. A pre-verify consumed
// the URL and doomed the real fetch downstream.

/**
 * Resolve a YouTube videoId to a direct googleaudio URL using the on-device
 * client walk. The URL is NOT probed here — googlevideo URLs are one-shot
 * (first fetch wins), so the caller's real fetch is the verification.
 * Returns null when no client yields a plain URL — callers fall through.
 */
export async function resolveInnertubeStream(
  videoId: string,
): Promise<InnertubeStream | null> {
  if (!videoId) return null;
  const visitorData = await ensureVisitorData();
  if (!visitorData) {
    // sw.js_data is the cheapest YouTube endpoint we touch. If even that
    // can't be fetched, every youtubei/googlevideo call will blackhole too —
    // bail out immediately instead of burning a 6-client timeout walk.
    console.log("[Innertube] no visitor id — YouTube unreachable, skipping walk");
    return null;
  }
  // Walk; on a bot-accusation mid-walk, refresh the visitor id once.
  let refreshed = false;
  for (const c of CLIENTS) {
    const stream = await tryClient(c, videoId, visitorData);
    if (!stream) continue;
    // No probe: the first fetch of this URL must be the caller's real one.
    console.log(
      `[Innertube] resolved ${videoId} via ${stream.clientName} itag=${stream.itag} (${stream.bitrate}bps)`,
    );
    return stream;
  }
  // Single retry with a fresh visitor id if nothing worked.
  if (!refreshed) {
    refreshed = true;
    const freshVd = await ensureVisitorData(true);
    if (freshVd && freshVd !== visitorData) {
      for (const c of CLIENTS) {
        const stream = await tryClient(c, videoId, freshVd);
        if (!stream) continue;
        console.log(
          `[Innertube] resolved ${videoId} via ${stream.clientName} (fresh visitor)`,
        );
        return stream;
      }
    }
  }
  console.log(`[Innertube] no client yielded a usable stream for ${videoId}`);
  return null;
}
