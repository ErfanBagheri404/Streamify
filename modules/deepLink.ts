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

export type DeepLinkAction =
  | "resume"
  | "shuffle-liked"
  | "smart-queue"
  | "search";

type Handlers = Record<DeepLinkAction, () => void | Promise<void>>;

/** No-op until the app registers real implementations. */
const ACTIONS: Handlers = {
  resume: () => {},
  "shuffle-liked": () => {},
  "smart-queue": () => {},
  search: () => {},
};

let installed = false;
/** True once real handlers have been registered. */
let ready = false;
/** Commands that arrived before the app was ready to act on them. */
let pending: DeepLinkAction[] = [];

/**
 * A launcher intent that re-delivers the same URL (some launchers re-send the
 * same intent rather than a fresh one) must not replay the action. In-memory is
 * enough: both deliveries land in the same JS session.
 */
let lastCommand: { action: string; at: number } | null = null;

function isDuplicate(action: string): boolean {
  return (
    lastCommand?.action === action &&
    Date.now() - lastCommand.at < COMMAND_DEBOUNCE_MS
  );
}

/**
 * Parse a `streamify://<action>` URL. Returns null for anything else so an
 * unrelated deep link (share targets, community links) is ignored rather than
 * misinterpreted.
 */
export function parseDeepLink(url: string | null): DeepLinkAction | null {
  if (!url || !url.startsWith("streamify://")) return null;
  const action = url.slice("streamify://".length).split(/[/?#]/)[0];
  if (
    action === "resume" ||
    action === "shuffle-liked" ||
    action === "smart-queue" ||
    action === "search"
  ) {
    return action;
  }
  return null;
}

/** Run one action. Never throws into the caller. */
export async function handleDeepLink(url: string | null): Promise<boolean> {
  const action = parseDeepLink(url);
  if (!action) return false;
  if (isDuplicate(action)) return false;
  lastCommand = { action, at: Date.now() };
  try {
    await ACTIONS[action]();
  } catch (error) {
    console.log("[deepLink] Shortcut action failed:", action, error);
  }
  return true;
}

async function dispatch(url: string | null) {
  if (!ready) {
    const action = parseDeepLink(url);
    if (action) pending.push(action);
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
  for (const action of queued) {
    void handleDeepLink(`streamify://${action}`);
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
  });
}
