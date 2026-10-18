/**
 * Launcher shortcut + Quick Settings tile contract tests (issue #34).
 *
 * The runtime code (modules/deepLink.ts, modules/seededQueue.ts) is TypeScript
 * and the native surfaces only exist on-device, so this asserts the static
 * contract: the URL scheme matches between the shortcut XML and the JS parser,
 * the tile service is manifest-registered and properly protected, the strings
 * the native side references actually exist, and every shortcut action is
 * both parsed and handled. Device behaviour is verified by the manual
 * long-press / tile pass, not here.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

/** `android/` is gitignored (Expo prebuild output): ENOENT on a fresh clone. */
const tryRead = (...parts) => {
  try {
    return fs.readFileSync(path.join(root, ...parts), "utf8");
  } catch {
    return null;
  }
};
const hasPrebuild = () => Boolean(tryRead("android", "app", "src", "main", "AndroidManifest.xml"));

const deepLink = read("modules", "deepLink.ts");
const seededQueue = read("modules", "seededQueue.ts");
const app = read("App.tsx");
const playerContext = read("contexts", "PlayerContext.tsx");
const shortcuts = read("plugins", "android", "res", "xml", "shortcuts.xml");
const plugin = read("plugins", "withStreamifyWidget.js");
const tile = read("plugins", "android", "StreamifyPlaybackTileService.kt");
const widgetProvider = read("plugins", "android", "StreamifyWidgetProvider.kt");
const launcherShortcuts = read(
  "plugins", "android", "StreamifyLauncherShortcuts.kt",
);
const module_ = read("plugins", "android", "StreamifyWidgetModule.kt");
const manifest = tryRead("android", "app", "src", "main", "AndroidManifest.xml");

const SCHEME = "streamify://";

check("every shortcut id maps to a URL the JS parser accepts", () => {
  const ids = [...shortcuts.matchAll(/android:shortcutId="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 4, `expected at least 4 shortcuts, found ${ids.length}`);
  for (const id of ids) {
    const data = shortcuts.match(new RegExp(`shortcutId="${id}"[\\s\\S]*?android:data="([^"]+)"`));
    assert.ok(data, `shortcut ${id} has no android:data URL`);
    const url = data[1];
    assert.ok(url.startsWith(SCHEME), `shortcut ${id} URL ${url} is off-scheme`);
    const action = url.slice(SCHEME.length).split(/[/?#]/)[0];
    assert.ok(
      deepLink.includes(`"${action}"`),
      `deepLink.ts does not know the action "${action}" used by shortcut ${id}`,
    );
  }
});

check("shortcut URLs use the id-derived action, not an arbitrary one", () => {
  // e.g. shortcutId="smart_queue" must not point at streamify://search
  const map = { resume: "resume", shuffle_liked: "shuffle-liked", smart_queue: "smart-queue", search: "search" };
  for (const [id, expected] of Object.entries(map)) {
    const data = shortcuts.match(new RegExp(`shortcutId="${id}"[\\s\\S]*?android:data="([^"]+)"`));
    assert.ok(data, `shortcut ${id} missing`);
    assert.strictEqual(data[1], `${SCHEME}${expected}`, `shortcut ${id} points at ${data[1]}`);
  }
});

check("static shortcuts declare no targetPackage (breaks the .local variant)", () => {
  assert.ok(
    !shortcuts.includes("android:targetPackage"),
    "targetPackage hardcodes one applicationId",
  );
});

check("every parsed action has a handler registered in App.tsx", () => {
  for (const action of [
    "resume",
    "shuffle-liked",
    "smart-queue",
    "search",
    "open-playlist",
    "track",
  ]) {
    const key = action.includes("-") ? `"${action}"` : action;
    assert.ok(app.includes(`${key}:`), `App.tsx has no handler for ${action}`);
  }
  assert.ok(app.includes("setDeepLinkHandlers(actions)"));
  // Exact wiring: the payload-bearing actions must be the registered
  // handler, not merely a same-named token somewhere in the file.
  assert.ok(
    app.includes('"open-playlist": openPlaylist'),
    "open-playlist is not wired to its lookup handler",
  );
  assert.ok(app.includes('"track": playFromShortcut'), "track not wired to its handler");
  assert.ok(app.includes("const openPlaylist ="), "openPlaylist handler missing");
  assert.ok(app.includes("const playFromShortcut ="), "playFromShortcut missing");
});

check("no native-published streamify:// URL is left unhandled", () => {
  // Static shortcuts live in XML; dynamic ones are built in Kotlin from
  // `streamify://track/<id>`, and widget playlist slots open
  // `streamify://open-playlist/<name>`. Every URL any native surface can
  // publish must resolve to a parsed action AND a registered handler.
  const published = new Set();
  for (const src of [shortcuts, launcherShortcuts, widgetProvider]) {
    for (const m of src.matchAll(/streamify:\/\/([a-z-]+)/g)) published.add(m[1]);
  }
  assert.ok(published.size > 0, "no native streamify:// URLs found to audit");
  for (const action of published) {
    assert.ok(
      deepLink.includes(`"${action}"`),
      `deepLink.ts does not parse the action "${action}" a native surface publishes`,
    );
    const key = action.includes("-") ? `"${action}"` : action;
    assert.ok(app.includes(`${key}:`), `App.tsx has no handler for "${action}"`);
  }
});

check("widget playlist slots deep-link to an action JS resolves", () => {
  // The slot must not carry the name as an unhandled Intent extra: an
  // extra never crosses into JS, so the tap opened the plain app.
  assert.ok(
    !widgetProvider.includes("EXTRA_OPEN_PLAYLIST"),
    "widget slot still passes the playlist via an Intent extra",
  );
  assert.ok(
    widgetProvider.includes('Uri.parse("streamify://open-playlist/'),
    "widget slot must open the playlist through the streamify:// URL",
  );
  // And JS must actually resolve that name to a playlist and navigate.
  assert.ok(app.includes("StorageService.loadPlaylists()"), "playlist lookup missing");
  assert.ok(
    app.includes("p.name === playlistName"),
    "playlist lookup does not match the parsed name",
  );
  assert.ok(
    app.includes('navigationRef.current?.navigate?.("AlbumPlaylist"'),
    "open-playlist does not navigate to the playlist",
  );
  assert.ok(app.includes('source: "user-playlist"'));
  assert.ok(app.includes("playlist.tracks.length"));
});

check("a dynamic track shortcut resolves to a track and plays it", () => {
  // streamify://track/<id> is published by updateRecentTracks. Without a
  // handler the launcher opens the app to the home screen.
  // The Intent call itself, not the doc comment.
  assert.ok(
    launcherShortcuts.includes('Uri.parse("streamify://track/'),
    "dynamic shortcuts no longer publish a track URL",
  );
  assert.ok(app.includes("previouslyPlayedSongs.find("), "track lookup missing");
  assert.ok(
    app.includes("await playTrack(track, previouslyPlayedSongs, 0)"),
    "the resolved track is not played",
  );
});

check("deep-link debounce keys on the target, not just the action", () => {
  // Two playlist taps 100ms apart are two different requests; keying only
  // on the action drops the second one.
  assert.ok(deepLink.includes("lastCommand.key"), "debounce does not key on target");
  assert.ok(/function isDuplicate\(action: string, key: string\)/.test(deepLink));
  // The queued entry must be the whole URL: a reconstructed
  // `streamify://<action>` would strip the name/id the action needs.
  assert.ok(
    deepLink.includes("pending.push({ url });"),
    "pending must queue the full URL, so a queued open-playlist keeps its name",
  );
  assert.ok(
    deepLink.includes("void handleDeepLink(entry.url)"),
    "replay must hand back the queued URL verbatim",
  );
});

check("open-playlist URL parsing rejects an empty or missing name", () => {
  const parse = deepLink.slice(deepLink.indexOf("export function parseDeepLink"));
  const body = parse.slice(0, parse.indexOf("\n}\n"));
  assert.ok(body.includes('if (!name) return null;'), "empty playlist name accepted");
  assert.ok(body.includes('if (!trackId) return null;'), "empty track id accepted");
  // Percent-decoded: a name with a space must survive Uri.encode on the
  // Kotlin side. Exact form, so swapping in the raw segment fails.
  assert.ok(
    body.includes('const name = decodeURIComponent(parts[1] ?? "").trim();'),
    "playlist name is not percent-decoded",
  );
  assert.ok(
    body.includes('const trackId = decodeURIComponent(parts[1] ?? "").trim();'),
    "track id is not percent-decoded",
  );
});

check("deep-link bridge registers exactly one Linking listener per process", () => {
  const calls = (deepLink.match(/Linking\.addEventListener\(/g) || []).length;
  assert.strictEqual(calls, 1, `expected 1 listener registration, found ${calls}`);
  assert.ok(deepLink.includes("installed = true"), "listener guard missing");
  assert.ok(deepLink.includes("Linking.getInitialURL()"), "cold start URL not read");
});

check("bridge is exported once and wired into App.tsx once", () => {
  const calls = (app.match(/setDeepLinkHandlers\(/g) || []).length;
  assert.strictEqual(calls, 1, `expected 1 call site, found ${calls}`);
  assert.ok(app.includes("<DeepLinkBridge />"), "bridge component not rendered");
});

check("handlers wait for settings hydration", () => {
  assert.ok(
    /if \(!hasHydratedSettings\) return;/.test(app),
    "DeepLinkBridge must not act before settings hydrate",
  );
});

check("the DeepLinkAction union covers every action the parser can return", () => {
  // Type-level completeness: dropping an action from the union while the
  // parser still returns it is a compile error, but this suite runs
  // without tsc, so assert the union directly.
  const union = deepLink.slice(
    deepLink.indexOf("export type DeepLinkAction"),
    deepLink.indexOf(";", deepLink.indexOf("export type DeepLinkAction")),
  );
  for (const action of [
    "resume",
    "shuffle-liked",
    "smart-queue",
    "search",
    "open-playlist",
    "track",
  ]) {
    assert.ok(
      union.includes(`"${action}"`),
      `DeepLinkAction is missing "${action}"`,
    );
  }
});

check("unknown schemes and actions are ignored, not dispatched", () => {
  assert.ok(deepLink.includes(`!url.startsWith("streamify://")`));
  assert.ok(/return null;/.test(deepLink));
  // The parser must not fall back to a default action for unrecognised input.
  assert.ok(
    !/return\s+"(resume|search)";\s*$/m.test(deepLink),
    "parser must not default to an action",
  );
});

check("shuffle-liked seeds from the liked library and keeps every track", () => {
  assert.ok(app.includes("shuffleTracks(likedSongs.slice(1))"));
  assert.ok(
    app.includes("await playTrack(first, [first, ...rest], 0)"),
    "shuffle queue must start with the first liked track at index 0",
  );
});

check("smart-queue reuses the shared seeded-queue helper", () => {
  assert.ok(app.includes("buildSeededQueue(seed, likedSongs)"));
  // buildSeededQueue must delegate to the same scoring the full player uses.
  assert.ok(seededQueue.includes("buildSmartQueue({ seed, library, size, playCounts })"));
  assert.ok(seededQueue.includes("await loadPlayCounts()"));
  assert.ok(seededQueue.includes("await buildRadioQueue(seed)"));
});

check("shortcut actions never read a stale library snapshot", () => {
  // Publishing from inside the setState updater reads the current list.
  assert.ok(
    /setPreviouslyPlayedSongs\(\(prev\) => \{[\s\S]*?pushRecentShortcuts\(updatedPreviouslyPlayed\);/.test(
      playerContext,
    ),
    "recent shortcuts must be published from the updater",
  );
});

check("recent-shortcut pushes are deduped and best-effort", () => {
  const widgetSync = read("modules", "widgetSync.ts");
  assert.ok(widgetSync.includes("lastShortcutIds"), "no dedupe key");
  assert.ok(widgetSync.includes("setRecentShortcuts"), "bridge method not called");
  assert.ok(
    /if \(!native\?\.setRecentShortcuts\) return;/.test(widgetSync),
    "must no-op when the native method is absent",
  );
});

check("quick-settings tile is registered with the QS intent filter", () => {
  assert.ok(plugin.includes("StreamifyPlaybackTileService"));
  assert.ok(
    plugin.includes("android.service.quicksettings.action.QS_TILE"),
    "tile intent-filter action missing",
  );
  assert.ok(
    plugin.includes("android.permission.BIND_QUICK_SETTINGS_TILE"),
    "tile must require BIND_QUICK_SETTINGS_TILE",
  );
  if (!manifest) {
    // android/ is gitignored prebuild output; the plugin-side assertions
    // above still prove the tile is registered with the config plugin.
    results.push(
      `SKIP tile service is declared in the prebuilt manifest (no android/ on this machine)`,
    );
    return;
  }
  assert.ok(manifest.includes(".StreamifyPlaybackTileService"), "service not in manifest");
});

check("tile reuses the heartbeat-gated transport path", () => {
  assert.ok(
    tile.includes("StreamifyWidgetActions.dispatch"),
    "tile must go through dispatch() for the liveness gate",
  );
  assert.ok(
    !tile.includes("dispatchMediaKeyEvent"),
    "tile must not dispatch media keys directly",
  );
});

check("dynamic shortcuts keep the launcher cap in mind", () => {
  assert.ok(
    launcherShortcuts.includes("take(2)"),
    "must publish at most 2 dynamic shortcuts",
  );
  assert.ok(
    launcherShortcuts.includes("ShortcutManagerCompat.pushDynamicShortcut"),
    "should push (ranked) rather than replace the whole set",
  );
});

check("every string the native surfaces reference is declared by the plugin", () => {
  const nativeRefs = new Set();
  for (const src of [tile, shortcuts, plugin]) {
    for (const m of src.matchAll(/@string\/([a-z0-9_]+)/g)) nativeRefs.add(m[1]);
  }
  const declared = new Set(
    [...plugin.matchAll(/\[\s*"([a-z0-9_]+)",\s*"[^"]*"\]/g)].map((m) => m[1]),
  );
  for (const ref of nativeRefs) {
    assert.ok(declared.has(ref), `@string/${ref} is referenced but never declared`);
  }
});

check("the native module exposes the shortcut bridge to JS", () => {
  assert.ok(module_.includes("fun setRecentShortcuts("));
  assert.ok(module_.includes("StreamifyLauncherShortcuts.updateRecentTracks"));
});

const failures = results.filter((r) => r.startsWith("FAIL"));
const skips = results.filter((r) => r.startsWith("SKIP"));
console.log(results.join("\n"));
console.log(
  `\n${results.length - failures.length - skips.length}/${results.length - skips.length} passed` +
    (skips.length ? `, ${skips.length} skipped (no android/ prebuild)` : ""),
);
process.exit(failures.length > 0 ? 1 : 0);
