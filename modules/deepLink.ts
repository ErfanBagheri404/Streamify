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
import { parseShareMomentUrl, type ShareMoment } from "./shareMoment";

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

/**
 * #33: a share-moment link carries its own track id + timestamp, so unlike a
 * launcher action it cannot be replayed from a bare command string — the URL
 * has to be kept verbatim until the handler is registered.
 */
let playMomentHandler: (moment: ShareMoment) => void | Promise<void> = () => {};

let installed = false;
/** True once real handlers have been registered. */
let ready = false;
/** Commands that arrived before the app was ready to act on them. */
let pending: DeepLinkAction[] = [];
/** Share-moment URLs that arrived before the app was ready to act on them. */
let pendingMoments: string[] = [];

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
 * misinterpreted. Share-moment links (`streamify://track/...`) deliberately do
 * not parse as actions — they are handled by `handleShareMoment`.
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

/**
 * Play a shared moment (issue #33). A link for an unknown track still reports
 * success so the caller can show a clean message instead of a crash.
 */
export async function handleShareMoment(url: string | null): Promise<boolean> {
  const moment = parseShareMomentUrl(url);
  if (!moment) return false;
  if (isDuplicate(url as string)) return false;
  lastCommand = { action: url as string, at: Date.now() };
  try {
    await playMomentHandler(moment);
  } catch (error) {
    console.log("[deepLink] Share moment failed:", moment.id, error);
  }
  return true;
}

/** Run one action. Never throws into the caller. */
export async function handleDeepLink(url: string | null): Promise<boolean> {
  if (await handleShareMoment(url)) return true;
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
    if (parseShareMomentUrl(url)) {
      pendingMoments.push(url as string);
    } else {
      const action = parseDeepLink(url);
      if (action) pending.push(action);
    }
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
  const queuedMoments = pendingMoments;
  pendingMoments = [];
  for (const url of queuedMoments) {
    void handleDeepLink(url);
  }
}

/**
 * Register the share-moment handler (#33). Split from the action map because a
 * moment carries a payload the bare action string cannot express.
 */
export function setShareMomentHandler(
  handler: (moment: ShareMoment) => void | Promise<void>,
) {
  playMomentHandler = handler;
}

/**
 * Reset module state. Test-only seam: Jest loads one module registry per test
 * file, so this exists for contract tests that fake Linking.
 */
export function __resetDeepLinkForTests() {
  installed = false;
  ready = false;
  pending = [];
  pendingMoments = [];
  lastCommand = null;
  playMomentHandler = () => {};
  Object.assign(ACTIONS, {
    resume: () => {},
    "shuffle-liked": () => {},
    "smart-queue": () => {},
    search: () => {},
  });
}
