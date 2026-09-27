/********************************************************************
 *  playlistImport.ts - paste a playlist link, get a Streamify playlist
 *
 *  Every adapter answers the same shape so one shared step turns the
 *  result into a local Playlist:
 *    { source, sourceId, sourceUrl, name, owner, thumbnail, tracks[] }
 *  and every track is `{ id, title, artist, duration, thumbnail, url }`
 *  — the Streamify Track minus the streaming concerns, which the
 *  existing resolver chain owns.
 *
 *  Sources (issue #65 phase 1):
 *    - YouTube / YouTube Music  — youtubei browse (WEB_REMIX), same
 *      client family modules/innertube.ts already talks to.
 *    - SoundCloud               — beatseek /playlist, the same route
 *      components/screens/AlbumPlaylistScreen.tsx already reads.
 *
 *  Subsonic/Navidrome (.m3u, Deezer, ListenBrainz) is not wired yet;
 *  parsePlaylistUrl reports them as unsupported rather than guessing.
 *******************************************************************/
import { getBeatseekApiBase } from "../components/core/api";
import { sanitizeImageUrl } from "../components/core/image";
import { subsonicService, type SubsonicTrack } from "./subsonicService";
import type { Track } from "../contexts/PlayerContext";
import { StorageService, type Playlist } from "../utils/storage";

export type PlaylistImportSource =
  | "youtube"
  | "youtubemusic"
  | "soundcloud"
  | "subsonic";

export interface ImportedTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  /** Canonical permalink on the origin service. */
  url: string;
  /** Playback source for the resulting Streamify Track. */
  source: string;
  _isSoundCloud?: boolean;
  /** Self-hosted server stream: playable as-is, no resolver needed. */
  _isSubsonic?: boolean;
  audioUrl?: string;
}

export interface PlaylistImportResult {
  source: PlaylistImportSource;
  sourceId: string;
  sourceUrl: string;
  name: string;
  owner: string;
  thumbnail: string;
  tracks: ImportedTrack[];
  /** Tracks the origin service listed but that carry no playable id. */
  skipped: string[];
}

export interface ParsedPlaylistUrl {
  kind: "youtube" | "youtubemusic" | "soundcloud" | "subsonic" | "m3u";
  playlistId: string;
  url: string;
}

// ---- client / request constants -------------------------------------------

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const YTM_CLIENT = {
  name: "WEB_REMIX",
  version: "1.20250908.01.00",
  clientNameHeader: "67",
  origin: "https://music.youtube.com",
};

const YT_CLIENT = {
  name: "WEB",
  version: "2.20250915.01.00",
  clientNameHeader: "1",
  origin: "https://www.youtube.com",
};

/** Every request in the chain needs its own deadline (see innertube.ts). */
const BROWSE_TIMEOUT_MS = 20000;
const MAX_PAGES = 20;
/** Innertube hands out 100 items per browse page. */
const PAGE_SIZE = 100;

function warn(message: string, error?: unknown) {
  console.warn(`[PlaylistImport] ${message}`, error ?? "");
}

// ---- URL parsing (pure) ----------------------------------------------------

const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{2,}$/;

/** Path segment at `index`, or "". */
function segments0(pathname: string, index: number): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments[index] || "";
}

/**
 * Classify a pasted link. YouTube Music keeps its own source so imported
 * playlists are tagged the way the user framed them; a music.youtube.com
 * link for a plain YouTube playlist resolves to the same VLPL browse id.
 */
export function parsePlaylistUrl(
  raw: string,
): ParsedPlaylistUrl | { unsupported: string } {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { unsupported: "empty" };
  }

  const withScheme = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { unsupported: "invalid" };
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const isMusic = host === "music.youtube.com" || host === "music.youtube";
  const isYouTube =
    isMusic ||
    host === "youtube.com" ||
    host === "youtu.be" ||
    host === "m.youtube.com" ||
    host.endsWith("youtube.com");

  if (isYouTube) {
    const listId = parsed.searchParams.get("list") || "";
    if (listId && PLAYLIST_ID_RE.test(listId)) {
      return {
        kind: isMusic ? "youtubemusic" : "youtube",
        playlistId: listId,
        url: `${YTM_CLIENT.origin}/playlist?list=${listId}`,
      };
    }
    return { unsupported: "youtube-no-playlist" };
  }

  if (host === "soundcloud.com" || host === "m.soundcloud.com" || host.endsWith(".soundcloud.com")) {
    // Public sets are /<user>/sets/<slug>; the id the resolver needs is the
    // permalink itself, which Beatseek accepts verbatim.
    const segments = parsed.pathname.split("/").filter(Boolean);
    const setsIndex = segments.indexOf("sets");
    if (setsIndex >= 0 && segments.length > setsIndex + 1) {
      return {
        kind: "soundcloud",
        playlistId: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ""),
        url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ""),
      };
    }
    return { unsupported: "soundcloud-no-set" };
  }

  if (/\.m3u8?($|\?)/i.test(parsed.pathname)) {
    return { kind: "m3u", playlistId: withScheme, url: withScheme };
  }

  if (parsed.pathname.includes("/rest/") || parsed.pathname.includes("subsonic")) {
    // A Subsonic playlist is identified by its server-side id, not by the
    // server URL, so the link has to name one.
    const id = parsed.searchParams.get("id") || segments0(parsed.pathname, 1);
    if (id) {
      return {
        kind: "subsonic",
        playlistId: id,
        url: `${parsed.origin}${parsed.pathname}`,
      };
    }
    return { unsupported: "subsonic-no-playlist-id" };
  }

  return { unsupported: "unknown-host" };
}

// ---- Innertube browse (pure parsing halves exported for the suite) ---------

interface YoutubeClient {
  name: string;
  version: string;
  clientNameHeader: string;
  origin: string;
}

/** Playlists live under the VLPL prefix on both YouTube and YouTube Music. */
function toBrowseId(playlistId: string): string {
  return playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`;
}

function findFirst(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = findFirst(entry, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (key in record) return record[key];
    for (const entry of Object.values(record)) {
      const hit = findFirst(entry, key);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function collectByKey(value: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectByKey(entry, key, out);
    return out;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (key in record) {
      out.push(record[key]);
      return out;
    }
    for (const entry of Object.values(record)) collectByKey(entry, key, out);
  }
  return out;
}

function runsToText(runs: unknown): string {
  if (!Array.isArray(runs)) return "";
  return runs
    .map((run) => (run && typeof run === "object" ? String((run as any).text ?? "") : ""))
    .join("")
    .trim();
}

function thumbnailUrlOf(thumbnail: unknown): string {
  const thumbs = findFirst(thumbnail, "thumbnails");
  if (!Array.isArray(thumbs) || !thumbs.length) return "";
  const first = thumbs[0] as Record<string, unknown>;
  return typeof first?.url === "string" ? first.url : "";
}

/** "3:55" -> 235. Returns 0 for live/unknown entries. */
export function parseClockDuration(value: string): number {
  const trimmed = (value || "").trim();
  if (!trimmed || !/^\d+(:\d{1,2})+$/.test(trimmed)) return 0;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export interface ParsedYoutubeItem {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

/**
 * Read one musicResponsiveListItemRenderer. The video id is not a sibling
 * field — it is the watchEndpoint on the title's run, or (for podcast /
 * auto-generated rows whose title links elsewhere) on the play button.
 */
export function parseYoutubeListItem(
  item: unknown,
): ParsedYoutubeItem | null {
  if (!item || typeof item !== "object") return null;
  const renderer = item as Record<string, any>;

  let videoId = "";
  let title = "";
  let artist = "";
  let duration = 0;
  let columnIndex = 0;

  for (const column of renderer.flexColumns || []) {
    const columnRenderer = column?.musicResponsiveListItemFlexColumnRenderer;
    const text = runsToText(columnRenderer?.text?.runs);
    if (text) {
      if (columnIndex === 0) title = text;
      else if (!artist) artist = text;
    }
    columnIndex += 1;
    for (const run of columnRenderer?.text?.runs || []) {
      const endpointVideoId = run?.navigationEndpoint?.watchEndpoint?.videoId;
      if (!videoId && typeof endpointVideoId === "string") {
        videoId = endpointVideoId;
      }
    }
  }

  if (!videoId) {
    // Podcast / auto-generated rows link the title elsewhere and carry the
    // video id only on the play button's watchEndpoint.
    const overlayVideoId = findFirst(renderer.overlay, "videoId");
    if (typeof overlayVideoId === "string") videoId = overlayVideoId;
  }

  for (const column of renderer.fixedColumns || []) {
    const text = runsToText(column?.musicResponsiveListItemFixedColumnRenderer?.text?.runs);
    const seconds = parseClockDuration(text);
    if (seconds > 0) {
      duration = seconds;
      break;
    }
  }

  if (!videoId || !title) return null;

  return {
    videoId,
    title,
    artist,
    duration,
    thumbnail: thumbnailUrlOf(renderer.thumbnail),
  };
}

export interface ParsedYoutubePage {
  items: ParsedYoutubeItem[];
  continuation: string;
  name: string;
  owner: string;
  thumbnail: string;
}

/**
 * Read a whole browse response: the shelf items, the next-page token, and
 * whatever the header said about the playlist (title/art/owner).
 */
export function parseYoutubeBrowseResponse(payload: unknown): ParsedYoutubePage {
  const items: ParsedYoutubeItem[] = [];
  for (const rawItem of collectByKey(payload, "musicResponsiveListItemRenderer")) {
    const parsed = parseYoutubeListItem(rawItem);
    if (parsed) items.push(parsed);
  }

  const continuationCommand = findFirst(payload, "continuationCommand");
  const continuation =
    continuationCommand && typeof continuationCommand === "object"
      ? String((continuationCommand as Record<string, unknown>).token ?? "")
      : "";

  const header = findFirst(payload, "musicResponsiveHeaderRenderer") as
    | Record<string, any>
    | undefined;
  const name = header ? runsToText(header.title?.runs) : "";
  // Subtitle runs mix the kind and the year ("Playlist • 2026"); keep the
  // pieces that carry text and are not the bullet separators.
  const owner = header
    ? (header.subtitle?.runs ?? [])
        .map((run: any) => String(run?.text ?? "").trim())
        .filter((text: string) => text && text !== "\u2022")
        .join(" ")
        .trim()
    : "";

  return {
    items,
    continuation,
    name,
    owner,
    thumbnail: header ? thumbnailUrlOf(header.thumbnail) : "",
  };
}

// ---- SoundCloud (pure parsing halves) -------------------------------------

export interface ParsedSoundCloudPage {
  name: string;
  owner: string;
  tracks: ImportedTrack[];
  skipped: string[];
}

/**
 * Beatseek's /playlist payload. Each track's `url` is the permalink the
 * app's existing SoundCloud extractor already resolves by id, so the permalink
 * doubles as the track id.
 */
export function parseSoundCloudPlaylistPayload(
  payload: unknown,
): ParsedSoundCloudPage {
  const data = (payload || {}) as Record<string, any>;
  const rawTracks = Array.isArray(data.tracks) ? data.tracks : [];
  const tracks: ImportedTrack[] = [];
  const skipped: string[] = [];

  for (const raw of rawTracks) {
    const title = String(raw?.title ?? "").trim();
    const url = String(raw?.url ?? "").trim();
    if (!title || !url) {
      skipped.push(title || url || "unknown track");
      continue;
    }
    const durationMs = Number(raw?.duration);
    const artwork = String(raw?.artwork_url ?? "").trim();
    tracks.push({
      id: url,
      title,
      artist: String(raw?.user?.username ?? "").trim(),
      duration: Number.isFinite(durationMs) ? Math.round(durationMs / 1000) : 0,
      // sanitizeImageUrl already upgrades sndcdn artwork to the 500px variant.
      thumbnail: sanitizeImageUrl(artwork),
      url,
      source: "soundcloud",
      _isSoundCloud: true,
    });
  }

  const name = String(data.playlistTitle ?? "").trim();
  const owner = String(rawTracks[0]?.user?.username ?? "").trim();
  return { name, owner, tracks, skipped };
}

// ---- subsonic ---------------------------------------------------------------

function subsonicTrackToImported(track: SubsonicTrack): ImportedTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist ?? "",
    duration: track.durationSec ?? 0,
    thumbnail: "",
    url: track.streamUrl,
    source: "subsonic",
    _isSubsonic: true,
    // The server URL is authoritative — playback must not resolve it.
    audioUrl: track.streamUrl,
  };
}

// ---- fetch halves -----------------------------------------------------------

async function postYoutubeBrowse(
  client: YoutubeClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${client.origin}/youtubei/v1/browse?prettyPrint=false`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": WEB_UA,
          "X-YouTube-Client-Name": client.clientNameHeader,
          "X-YouTube-Client-Version": client.version,
          Origin: client.origin,
          Referer: `${client.origin}/`,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: client.name,
              clientVersion: client.version,
              hl: "en",
              gl: "US",
            },
            ...body,
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Page through a YouTube / YouTube Music playlist. */
export async function fetchYoutubePlaylist(
  playlistId: string,
  kind: "youtube" | "youtubemusic",
  onProgress?: (loaded: number) => void,
): Promise<PlaylistImportResult> {
  const client = kind === "youtubemusic" ? YTM_CLIENT : YT_CLIENT;
  const browseId = toBrowseId(playlistId);
  const tracks: ImportedTrack[] = [];
  const skipped: string[] = [];
  let name = "";
  let owner = "";
  let thumbnail = "";
  let continuation = "";
  let pages = 0;

  do {
    if (pages >= MAX_PAGES) {
      warn(`stopped after ${MAX_PAGES} pages; playlist may be longer`);
      break;
    }
    const payload = await postYoutubeBrowse(
      client,
      continuation
        ? { continuation }
        : { browseId },
    );
    const page = parseYoutubeBrowseResponse(payload);
    if (!name) {
      name = page.name;
      owner = page.owner;
      thumbnail = page.thumbnail;
    }
    for (const item of page.items) {
      const title = item.title.trim();
      if (!item.videoId || !title) {
        skipped.push(title || item.videoId || "unknown track");
        continue;
      }
      tracks.push({
        id: item.videoId,
        title,
        artist: item.artist,
        duration: item.duration,
        thumbnail: sanitizeImageUrl(item.thumbnail),
        url: `${client.origin}/watch?v=${item.videoId}&list=${playlistId}`,
        source: kind,
      });
    }
    continuation = page.continuation;
    pages += 1;
    onProgress?.(tracks.length);
  } while (continuation);

  return {
    source: kind,
    sourceId: playlistId,
    sourceUrl: `${client.origin}/playlist?list=${playlistId}`,
    name,
    owner,
    thumbnail: sanitizeImageUrl(thumbnail),
    tracks,
    skipped,
  };
}

/** Public SoundCloud set via the beatseek route the album screen already uses. */
export async function fetchSoundCloudPlaylist(
  setUrl: string,
): Promise<PlaylistImportResult> {
  const beatseekApiBase = getBeatseekApiBase();
  if (!beatseekApiBase) {
    throw new Error("Beatseek API base is not configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSE_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${beatseekApiBase}/playlist?url=${encodeURIComponent(setUrl)}`,
      { headers: { Accept: "application/json" }, signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const page = parseSoundCloudPlaylistPayload(await response.json());
    return {
      source: "soundcloud",
      sourceId: setUrl,
      sourceUrl: setUrl,
      name: page.name,
      owner: page.owner,
      thumbnail: page.tracks[0]?.thumbnail ?? "",
      tracks: page.tracks,
      skipped: page.skipped,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Playlist(s) from the configured Subsonic/Navidrome server. */
export async function fetchSubsonicPlaylist(
  playlistId: string,
): Promise<PlaylistImportResult> {
  const tracks = await subsonicService.getPlaylist(playlistId);
  return {
    source: "subsonic",
    sourceId: playlistId,
    sourceUrl: playlistId,
    name: tracks.name,
    owner: "Subsonic",
    thumbnail: tracks.coverArtUrl ?? "",
    tracks: tracks.tracks.map(subsonicTrackToImported),
    skipped: [],
  };
}

// ---- entry point ------------------------------------------------------------

/** Resolve any supported pasted link to a common import payload. */
export async function resolvePlaylistImport(
  raw: string,
  onProgress?: (loaded: number) => void,
): Promise<PlaylistImportResult> {
  const parsed = parsePlaylistUrl(raw);
  if ("unsupported" in parsed) {
    throw new Error(`Unsupported playlist link (${parsed.unsupported})`);
  }

  if (parsed.kind === "youtube" || parsed.kind === "youtubemusic") {
    return fetchYoutubePlaylist(parsed.playlistId, parsed.kind, onProgress);
  }
  if (parsed.kind === "soundcloud") {
    return fetchSoundCloudPlaylist(parsed.playlistId);
  }
  if (parsed.kind === "subsonic") {
    return fetchSubsonicPlaylist(parsed.playlistId);
  }
  // .m3u / .m3u8 needs a file picker plus a media-index build step; it is
  // not wired, so refuse it loudly rather than half-importing it.
  if (parsed.kind === "m3u") {
    throw new Error("Unsupported playlist link (m3u)");
  }
  throw new Error("Unsupported playlist link (unknown)");
}

export function toImportedTracks(
  tracks: ImportedTrack[],
): Track[] {
  return tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnail: track.thumbnail,
    url: track.url,
    source: track.source,
    ...(track._isSoundCloud ? { _isSoundCloud: true } : {}),
    ...(track._isSubsonic
      ? { _isSubsonic: true, audioUrl: track.audioUrl }
      : {}),
  }));
}

/**
 * Write the resolved payload as a normal local playlist. Goes through
 * StorageService so normalization/dedupe runs exactly as it does for
 * hand-built playlists.
 */
export async function importPlaylistAsLocalPlaylist(
  result: PlaylistImportResult,
): Promise<Playlist> {
  const tracks = toImportedTracks(result.tracks);
  const now = new Date().toISOString();
  const playlist: Playlist = {
    // Namespace by origin so a re-import replaces nothing but reads clearly.
    id: `${result.source}:${result.sourceId}:${Date.now()}`,
    name: result.name || result.sourceId,
    description: result.sourceUrl,
    tracks,
    createdAt: now,
    updatedAt: now,
    thumbnail: result.thumbnail || tracks[0]?.thumbnail,
  };
  await StorageService.addPlaylist(playlist);
  return playlist;
}
