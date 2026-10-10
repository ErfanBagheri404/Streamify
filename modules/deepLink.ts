/**
 * Launcher shortcut deep-link bridge (issue #34).
 *
 * The native side (res/xml/shortcuts.xml + the dynamic shortcuts pushed from
 * JS) fires plain ACTION_VIEW intents on the `streamify://` scheme that
 * MainActivity already declares. React Native's Linking delivers those as
 * `getInitialURL()` on a cold start and as a `url` event on a warm start
 * (singleTask + onNewIntent), so no native code beyond the shortcuts XML is
 * needed.
 *
 * Everything below is module state on purpose. The handlers close over
 * `likedSongs` / `playTrack`, so they change on every render; a per-component
 * subscription would either stack a new `Linking` listener per render or
 * capture a stale action set. One listener plus one swappable handler map has
 * neither problem.
 */
import * as Linking from "expo-linking";

/** Shortest sensible gap between two identical deliveries of one intent. */
const COMMAND_DEBOUNCE_MS = 1200;

/**
 * A widget playlist slot carries the playlist name in the URL. The
 * name is the key the user sees (and the only identifier the widget
 * store keeps), so matching is exact.
 */
export interface PlaylistOpenRequest {
  playlistName: string;
}

export interface TrackOpenRequest {
  trackId: string;
}

export type DeepLinkAction =
  | "resume"
  | "shuffle-liked"
  | "smart-queue"
  | "search"
  | "open-playlist"
  | "track";

type Handlers = Record<
  Exclude<DeepLinkAction, "open-playlist" | "track">,
  () => void | Promise<void>
> & {
  "open-playlist": (request: PlaylistOpenRequest) => void | Promise<void>;
  "track": (request: TrackOpenRequest) => void | Promise<void>;
};

/** No-op until the app registers real implementations. */
const ACTIONS: Handlers = {
  resume: () => {},
  "shuffle-liked": () => {},
  "smart-queue": () => {},
  search: () => {},
  "open-playlist": () => {},
  track: () => {},
};

let installed = false;
/** True once real handlers have been registered. */
let ready = false;
/** Commands that arrived before the app was ready to act on them. */
let pending: { url: string }[] = [];

/**
 * A launcher intent that re-delivers the same URL (some launchers re-send the
 * same intent rather than a fresh one) must not replay the action. In-memory is
 * enough: both deliveries land in the same JS session.
 */
let lastCommand: { action: string; key: string; at: number } | null = null;

function isDuplicate(action: string, key: string): boolean {
  return (
    lastCommand?.action === action &&
    lastCommand.key === key &&
    Date.now() - lastCommand.at < COMMAND_DEBOUNCE_MS
  );
}

/**
 * Parse a `streamify://<action>` URL. Returns null for anything else so an
 * unrelated deep link (share targets, community links) is ignored rather than
 * misinterpreted.
 */
/**
 * Parse a `streamify://<action>` URL. `open-playlist` and `track`
 * additionally carry their target in the next path segment. Returns
 * null for anything else so an unrelated deep link (share targets,
 * community links) is ignored rather than misinterpreted.
 */
export function parseDeepLink(
  url: string | null,
): { action: DeepLinkAction; playlistName?: string; trackId?: string } | null {
  if (!url || !url.startsWith("streamify://")) return null;
  const parts = url.slice("streamify://".length).split(/[/?#]/);
  const action = parts[0];
  if (
    action === "resume" ||
    action === "shuffle-liked" ||
    action === "smart-queue" ||
    action === "search"
  ) {
    return { action };
  }
  if (action === "open-playlist") {
    const name = decodeURIComponent(parts[1] ?? "").trim();
    if (!name) return null;
    return { action, playlistName: name };
  }
  if (action === "track") {
    const trackId = decodeURIComponent(parts[1] ?? "").trim();
    if (!trackId) return null;
    return { action, trackId };
  }
  return null;
}

/** Run one action. Never throws into the caller. */
export async function handleDeepLink(url: string | null): Promise<boolean> {
  const parsed = parseDeepLink(url);
  if (!parsed) return false;
  const { action, playlistName, trackId } = parsed;
  const key = playlistName ?? trackId ?? "";
  if (isDuplicate(action, key)) return false;
  lastCommand = { action, key, at: Date.now() };
  try {
    const handler = (ACTIONS as Record<string, (arg?: unknown) => void | Promise<void>>)[action];
    if (playlistName) await handler({ playlistName });
    else if (trackId) await handler({ trackId });
    else await handler();
  } catch (error) {
    console.log("[deepLink] Shortcut action failed:", action, error);
  }
  return true;
}

async function dispatch(url: string | null) {
  if (!ready) {
    const parsed = parseDeepLink(url);
    if (parsed) pending.push({ url });
    return;
  }
  await handleDeepLink(url);
}

/**
 * Register the action implementations and install the single Linking listener
 * (idempotent). Safe to call on every render: the handlers close over the
 * current `likedSongs` / `playTrack`, so swapping them keeps the one listener
 * correct without re-subscribing.
 *
 * A command that arrived before the first ready call is replayed here, because
 * a cold-start URL resolves before the player context has hydrated.
 */
export function setDeepLinkHandlers(handlers: Handlers) {
  Object.assign(ACTIONS, handlers);
  if (!installed) {
    installed = true;
    Linking.addEventListener("url", ({ url }) => {
      void dispatch(url);
    });
    // Cold start: the URL that launched us may already be gone by the time
    // this subscribes, so read it once up front.
    void Linking.getInitialURL().then((url) => dispatch(url)).catch(() => {});
  }
  if (ready) return;
  ready = true;
  const queued = pending;
  pending = [];
  for (const entry of queued) {
    void handleDeepLink(entry.url);
  }
}

/**
 * Reset module state. Test-only seam: Jest loads one module registry per test
 * file, so this exists for contract tests that fake Linking.
 */
export function __resetDeepLinkForTests() {
  installed = false;
  ready = false;
  pending = [];
  lastCommand = null;
  Object.assign(ACTIONS, {
    resume: () => {},
    "shuffle-liked": () => {},
    "smart-queue": () => {},
    search: () => {},
    "open-playlist": () => {},
    track: () => {},
  });
}
