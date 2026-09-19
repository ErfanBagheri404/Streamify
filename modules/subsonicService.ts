/********************************************************************
 *  subsonicService.ts - Subsonic / Navidrome / Jellyfin-Subsonic connector
 *
 *  Talks to the Subsonic REST API (the same protocol Navidrome, Airsonic,
 *  gonic, and Jellyfin's Subsonic bridge all implement). Users supply their
 *  server URL + credentials; searches run on THEIR library, streams come
 *  straight from THEIR server. Nothing is proxied through us.
 *
 *  Auth: Subsonic's "token" scheme — salt + md5(password + salt) — so no
 *  plaintext password rides on every request. md5 is provided by utils/md5.ts
 *  (pure JS, no native dependency).
 *
 *  Perf contract:
 *  - Credentials persist in AsyncStorage; requests are on-demand only.
 *  - search() is a single REST call.
 *  - Disabled entirely until the user configures a server (isConfigured()).
 *******************************************************************/
import AsyncStorage from "@react-native-async-storage/async-storage";
import { md5 } from "../utils/md5";

const STORAGE_KEY = "subsonic_config";
const API_VERSION = "1.16.1";
const CLIENT_NAME = "Streamify";

export interface SubsonicConfig {
  baseUrl: string;
  username: string;
  /** Stored locally on the device only; never sent in plaintext. */
  password: string;
}

export interface SubsonicTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  coverArtId?: string;
  /** Full stream URL, ready for RNTP. */
  streamUrl: string;
  source: "subsonic";
}

let cachedConfig: SubsonicConfig | null | undefined; // undefined = not loaded yet

function debug(...args: unknown[]) {
  if (__DEV__) console.log("[Subsonic]", ...args);
}

function randomSalt(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/** Subsonic auth params, appended to every request. */
function authParams(config: SubsonicConfig): Record<string, string> {
  const salt = randomSalt();
  return {
    u: config.username,
    t: md5(config.password + salt),
    s: salt,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: "json",
  };
}

async function request<T = any>(
  config: SubsonicConfig,
  endpoint: string,
  params: Record<string, string | number> = {},
): Promise<T | null> {
  const url = new URL(`/rest/${endpoint}.view`, config.baseUrl);
  for (const [k, v] of Object.entries({ ...authParams(config), ...params })) {
    url.searchParams.set(k, String(v));
  }
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      debug(endpoint, "HTTP", res.status);
      return null;
    }
    const data = await res.json();
    const payload = data?.["subsonic-response"];
    const status = payload?.status;
    if (status !== "ok") {
      debug(endpoint, "error:", payload?.error?.message || status);
      return null;
    }
    return payload;
  } catch (e) {
    debug(endpoint, "network error:", e);
    return null;
  }
}

function normalizeSongs(raw: any[]): SubsonicTrack[] {
  return (raw || [])
    .filter((s) => s && s.isDir !== true && s.title)
    .map((s) => ({
      id: String(s.id),
      title: s.title,
      artist: s.artist,
      album: s.album,
      durationSec: s.duration,
      coverArtId: s.coverArt,
      streamUrl: buildStreamUrl(String(s.id)),
      source: "subsonic" as const,
    }));
}

function buildStreamUrl(trackId: string): string {
  const config = cachedConfig;
  if (!config) return "";
  const url = new URL("/rest/stream.view", config.baseUrl);
  for (const [k, v] of Object.entries({ ...authParams(config), id: trackId })) {
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export const subsonicService = {
  async loadConfig(): Promise<SubsonicConfig | null> {
    if (cachedConfig !== undefined) {
      return cachedConfig;
    }
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      cachedConfig = raw ? (JSON.parse(raw) as SubsonicConfig) : null;
    } catch (e) {
      cachedConfig = null;
    }
    return cachedConfig;
  },

  /** Validate with ping.test then persist. Throws with a human-readable reason. */
  async saveConfig(config: SubsonicConfig): Promise<void> {
    const trimmed: SubsonicConfig = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      username: config.username.trim(),
      password: config.password,
    };
    if (!/^https?:\/\//.test(trimmed.baseUrl)) {
      throw new Error("Server URL must start with http:// or https://");
    }
    // Plain http:// sends the auth token in cleartext — warn but allow
    // (self-hosted LAN servers commonly run on http). Surface a hint to the
    // user instead of silently rejecting.
    if (!trimmed.baseUrl.startsWith("https://")) {
      debug("WARNING: credentials sent over plain http —", trimmed.baseUrl);
    }
    // Validate the candidate BEFORE touching the cached config, so a failed
    // reconfiguration never clobbers a previously working one.
    const ok = await request(trimmed, "ping");
    if (!ok) {
      throw new Error("Could not connect. Check the URL, username, and password.");
    }
    cachedConfig = trimmed;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    debug("Configured for", trimmed.baseUrl);
  },

  async clearConfig(): Promise<void> {
    cachedConfig = null;
    await AsyncStorage.removeItem(STORAGE_KEY);
  },

  /** SearchMusic3 across the user's whole server library. */
  async search(query: string, count = 25): Promise<SubsonicTrack[]> {
    const config = await this.loadConfig();
    if (!config) {
      return [];
    }
    const res = await request(
      config,
      "search3",
      { query, songCount: count, artistCount: 0, albumCount: 0 },
    );
    const songs = (res as any)?.searchResult3?.song || [];
    return normalizeSongs(songs);
  },

  /** Latest albums added — drives the "browse" surface later. */
  async getAlbumList(type: "newest" | "random" | "frequent" = "newest", size = 12) {
    const config = await this.loadConfig();
    if (!config) {
      return [];
    }
    const res = await request(config, "getAlbumList2", { type, size });
    return (res as any)?.albumList2?.album || [];
  },

  /** Cover art URL (returns null until configured). */
  getCoverArtUrl(coverArtId?: string): string | null {
    const config = cachedConfig;
    if (!config || !coverArtId) {
      return null;
    }
    const url = new URL("/rest/getCoverArt.view", config.baseUrl);
    for (const [k, v] of Object.entries({ ...authParams(config), id: coverArtId, size: 400 })) {
      url.searchParams.set(k, String(v));
    }
    return url.toString();
  },
};
