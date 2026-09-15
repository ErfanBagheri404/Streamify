/********************************************************************
 *  ScrobblerService.ts - Last.fm + ListenBrainz scrobbling
 *
 *  Design (zero-always-on-threads):
 *  - Credentials live in AsyncStorage (per-provider token).
 *  - ListenBrainz needs only a user token — fully functional out of the box.
 *  - Last.fm additionally needs an API key (app-level constant) AND a
 *    session key obtained via web auth; until the API key is provided at
 *    build time, Last.fm calls are skipped (provider disabled) rather than
 *    failing with 4xx noise.
 *  - A track must be listened for ≥30s (or half its duration) before it is
 *    scrobbled. The scrobble fires when the track changes or playback stops.
 *  - Network failures are logged and dropped — scrobbling must never
 *    interrupt listening.
 *******************************************************************/
import AsyncStorage from "@react-native-async-storage/async-storage";

const LASTFM_API = "https://ws.audioscrobbler.com/2.0/";
const LISTENBRAINZ_API = "https://api.listenbrainz.org";

// Injected per build. An empty string disables the Last.fm provider.
const LASTFM_API_KEY = "";
const LASTFM_SHARED_SECRET = "";

const SETTINGS_KEY_LASTFM_SK = "scrobble_lastfm_session_key";
const SETTINGS_KEY_LBZ = "scrobble_listenbrainz_token";
const SCROBBLE_LOG_KEY = "scrobbler_log";
const MAX_LOG_ENTRIES = 100;

const PLAY_THRESHOLD_MS = 30_000;
const FLUSH_INTERVAL_MS = 30_000;

interface ScrobbleEntry {
  artist: string;
  track: string;
  album?: string;
  durationMs: number;
  timestamp: number; // ms epoch, when the listen started
  providers: string[];
}

type ScrobbleProvider = "lastfm" | "listenbrainz";

const internal = {
  lastfmSessionKey: null as string | null,
  listenbrainzToken: null as string | null,
  flushTimer: null as ReturnType<typeof setInterval> | null,
  pending: [] as ScrobbleEntry[],
  active: null as ScrobbleEntry | null,
  activeStartedAt: 0,
  activeElapsedMs: 0,
  activeDurationMs: 0,
  initialized: false,
};

function debug(...args: unknown[]) {
  console.log("[Scrobbler]", ...args);
}

// --- Last.fm (needs api_key + session key + signature) -----------------------

const lastfmEnabled = (): boolean =>
  Boolean(LASTFM_API_KEY && internal.lastfmSessionKey);

async function lastfmSignedCall(method: string, params: Record<string, string>): Promise<boolean> {
  if (!lastfmEnabled()) {
    return false;
  }
  // MD5 signature: sorted params + shared secret. Without a shared secret we
  // can only call methods that need no signature; scrobbling needs one.
  try {
    const body = new URLSearchParams({
      method,
      format: "json",
      api_key: LASTFM_API_KEY,
      sk: internal.lastfmSessionKey || "",
      ...params,
    });
    const res = await fetch(LASTFM_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return res.ok;
  } catch {
    debug("Last.fm", method, "network error");
    return false;
  }
}

// --- ListenBrainz (token auth only — works with zero app registration) -------

async function lbzSubmit(
  listenType: "playing_now" | "single",
  entry: ScrobbleEntry,
): Promise<boolean> {
  if (!internal.listenbrainzToken) {
    return false;
  }
  const payload: Record<string, unknown> = {
    listen_type: listenType,
    payload: [
      listenType === "single"
        ? {
            listened_at: Math.floor(entry.timestamp / 1000),
            track_metadata: metadataOf(entry),
          }
        : { track_metadata: metadataOf(entry) },
    ],
  };
  try {
    const res = await fetch(`${LISTENBRAINZ_API}/1/submit-listens`, {
      method: "POST",
      headers: {
        Authorization: `Token ${internal.listenbrainzToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    debug("ListenBrainz", listenType, "network error");
    return false;
  }
}

function metadataOf(entry: ScrobbleEntry): Record<string, string> {
  return {
    track_name: entry.track,
    artist_name: entry.artist,
    ...(entry.album ? { release_name: entry.album } : {}),
    ...(entry.durationMs
      ? { additional_info: JSON.stringify({ duration_ms: entry.durationMs }) }
      : {}),
  };
}

// --- Flush -------------------------------------------------------------------

async function flushPending(): Promise<void> {
  if (internal.pending.length === 0) {
    return;
  }
  const batch = internal.pending;
  internal.pending = [];

  let logDelta: ScrobbleEntry[] = [];
  for (const entry of batch) {
    const providers: string[] = [];
    if (lbzEnabled()) {
      if (await lbzSubmit("single", entry)) {
        providers.push("listenbrainz");
        debug("ListenBrainz scrobbled:", entry.track, "—", entry.artist);
      }
    }
    if (lastfmEnabled()) {
      if (
        await lastfmSignedCall("track.scrobble", {
          artist: entry.artist,
          track: entry.track,
          timestamp: String(Math.floor(entry.timestamp / 1000)),
          ...(entry.album ? { album: entry.album } : {}),
        })
      ) {
        providers.push("lastfm");
      }
    }
    if (providers.length > 0) {
      logDelta.push({ ...entry, providers });
    }
  }

  if (logDelta.length > 0) {
    try {
      const raw = await AsyncStorage.getItem(SCROBBLE_LOG_KEY);
      const existing: ScrobbleEntry[] = raw ? JSON.parse(raw) : [];
      await AsyncStorage.setItem(
        SCROBBLE_LOG_KEY,
        JSON.stringify([...existing, ...logDelta].slice(-MAX_LOG_ENTRIES)),
      );
    } catch (e) {
      debug("Failed to persist scrobble log:", e);
    }
  }
}

const lbzEnabled = (): boolean => Boolean(internal.listenbrainzToken);

// --- Public API --------------------------------------------------------------

export const scrobblerService = {
  /** Load stored tokens. Safe to call more than once. */
  async initialize(): Promise<void> {
    if (internal.initialized) {
      return;
    }
    internal.initialized = true;
    try {
      const [sk, lbz] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEY_LASTFM_SK),
        AsyncStorage.getItem(SETTINGS_KEY_LBZ),
      ]);
      internal.lastfmSessionKey = sk || null;
      internal.listenbrainzToken = lbz || null;
      debug("Credentials loaded:", {
        lastfm: lastfmEnabled(),
        listenbrainz: lbzEnabled(),
      });
    } catch (e) {
      debug("Credential load failed:", e);
    }
    if (!internal.flushTimer) {
      // No point running a 30s interval when the user has not connected any
      // provider. The timer starts on the first setToken() instead.
      if (lbzEnabled() || lastfmEnabled()) {
        this.startFlushTimer();
      }
    }
  },

  startFlushTimer(): void {
    if (internal.flushTimer) {
      return;
    }
    internal.flushTimer = setInterval(() => {
      void flushPending();
    }, FLUSH_INTERVAL_MS);
  },

  async setListenBrainzToken(token: string | null): Promise<void> {
    internal.listenbrainzToken = token || null;
    if (token) {
      await AsyncStorage.setItem(SETTINGS_KEY_LBZ, token);
    } else {
      await AsyncStorage.removeItem(SETTINGS_KEY_LBZ);
    }
    this.startFlushTimer();
    debug("ListenBrainz token", token ? "set" : "cleared");
  },

  async setLastFmSessionKey(sk: string | null): Promise<void> {
    internal.lastfmSessionKey = sk || null;
    if (sk) {
      await AsyncStorage.setItem(SETTINGS_KEY_LASTFM_SK, sk);
    } else {
      await AsyncStorage.removeItem(SETTINGS_KEY_LASTFM_SK);
    }
    this.startFlushTimer();
    debug("Last.fm session key", sk ? "set" : "cleared");
  },

  /**
   * Called by the listening-stats sampler with the real played delta in ms.
   * That path only advances while audio is actually moving forward (not
   * paused, not buffering), so it is the accurate scrobble signal — pausing
   * cannot inflate it the way a wall-clock timer would.
   */
  recordProgress(deltaMs: number): void {
    if (!internal.active) {
      return;
    }
    if (!lbzEnabled() && !lastfmEnabled()) {
      return;
    }
    internal.activeElapsedMs += deltaMs;
    // Once eligible, no need to keep accumulating.
    // Skip the clamp when duration is unknown (0): a track without metadata
    // should not be capped at 5s, which would prevent scrobbling when
    // PlayerContext later discovers the real duration.
    if (
      internal.activeDurationMs > 0 &&
      internal.activeElapsedMs > internal.activeDurationMs + 5000
    ) {
      internal.activeElapsedMs = internal.activeDurationMs + 5000;
    }
  },

  /**
   * PlaybackActiveTrackChanged handler: scrobbles the outgoing track (if it
   * passed the threshold) and starts tracking the incoming one.
   */
  async onTrackChange(track: {
    id: string;
    title: string;
    artist?: string;
    album?: string;
    duration?: number;
  }): Promise<void> {
    // 1) Scrobble the outgoing track.
    const outgoing = internal.active;
    const elapsedMs = internal.activeElapsedMs;
    const durationMs = internal.activeDurationMs;
    internal.active = null;
    internal.activeElapsedMs = 0;
    internal.activeDurationMs = 0;

    const providersActive = lbzEnabled() || lastfmEnabled();
    // Last.fm rule: >30s played OR >50% of the track, whichever comes first.
    const threshold = durationMs
      ? Math.min(PLAY_THRESHOLD_MS, durationMs / 2)
      : PLAY_THRESHOLD_MS;

    if (outgoing && providersActive && elapsedMs >= threshold) {
      internal.pending.push({ ...outgoing, timestamp: outgoing.timestamp });
      debug(
        "Queued scrobble:",
        outgoing.track,
        "—",
        outgoing.artist,
        `(${Math.round(elapsedMs / 1000)}s played)`,
      );
    }

    // 2) Remember the incoming track.
    internal.active = {
      artist: track.artist || "Unknown Artist",
      track: track.title,
      album: track.album,
      durationMs: (track.duration || 0) * 1000,
      timestamp: Date.now(),
      providers: [],
    };
    internal.activeDurationMs = (track.duration || 0) * 1000;

    // 3) Now-playing submissions are fire-and-forget.
    if (!providersActive) {
      return;
    }
    if (lbzEnabled()) {
      void lbzSubmit("playing_now", internal.active);
    }
    if (lastfmEnabled()) {
      void lastfmSignedCall("track.updateNowPlaying", {
        artist: internal.active.artist,
        track: internal.active.track,
      });
    }
  },

  /** Drain the pending queue without finalizing the in-progress track.
   *  Used when the app is backgrounded but playback keeps running. */
  async flushPendingOnly(): Promise<void> {
    await flushPending();
  },

  /** Playback stopped or app backgrounded — flush what we have. */
  async flushNow(): Promise<void> {
    const outgoing = internal.active;
    const elapsedMs = internal.activeElapsedMs;
    const durationMs = internal.activeDurationMs;
    if (outgoing) {
      const threshold = durationMs
        ? Math.min(PLAY_THRESHOLD_MS, durationMs / 2)
        : PLAY_THRESHOLD_MS;
      if (elapsedMs >= threshold && (lbzEnabled() || lastfmEnabled())) {
        internal.pending.push({ ...outgoing });
      }
      internal.active = null;
      internal.activeElapsedMs = 0;
      internal.activeDurationMs = 0;
    }
    await flushPending();
  },

  async getEnabledProviders(): Promise<{ lastfm: boolean; listenbrainz: boolean }> {
    return { lastfm: lastfmEnabled(), listenbrainz: lbzEnabled() };
  },
};
