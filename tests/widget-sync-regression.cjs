/**
 * Widget sync contract tests (issue #29).
 *
 * The runtime mirror (modules/widgetSync.ts) is TypeScript, so this asserts
 * the static contract instead of executing it: the module exists, is
 * platform-guarded, never throws into playback, is wired exactly once, and
 * the native side is registered in the manifest and RN package list. Device
 * behaviour is verified by the manual widget pass, not here.
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

/**
 * `android/` is gitignored (Expo prebuild output): reads throw ENOENT on a
 * fresh clone or CI. Native assertions skip instead of crashing there; the
 * JS-side contract below always runs.
 */
const tryRead = (...parts) => {
  try {
    return fs.readFileSync(path.join(root, ...parts), "utf8");
  } catch {
    return null;
  }
};
const widgetSync = read("modules", "widgetSync.ts");
const playerContext = read("contexts", "PlayerContext.tsx");
const manifest = tryRead("android", "app", "src", "main", "AndroidManifest.xml");
const mainApp = tryRead(
  "android", "app", "src", "main", "java", "com", "erfanbagheri", "streamifymobile",
  "MainApplication.kt",
);
const provider = tryRead(
  "android", "app", "src", "main", "java", "com", "erfanbagheri", "streamifymobile",
  "StreamifyWidgetProvider.kt",
);
const actions = tryRead(
  "android", "app", "src", "main", "java", "com", "erfanbagheri", "streamifymobile",
  "StreamifyWidgetActions.kt",
);
const hasPrebuild = Boolean(manifest && mainApp && provider && actions);

/**
 * Native-side checks run only when `android/` exists (local prebuild). On a
 * fresh clone or CI they SKIP instead of crashing on ENOENT or asserting
 * against null — the JS contract above always runs either way.
 */
function checkNative(name, fn) {
  if (!hasPrebuild) {
    results.push(`SKIP ${name} (no android/ prebuild on this machine)`);
    return;
  }
  check(name, fn);
}

check("widgetSync is Android-only", () => {
  assert.ok(widgetSync.includes('Platform.OS === "android"'));
});

check("widgetSync never propagates a bridge failure into playback", () => {
  assert.ok(
    /try \{[\s\S]*?updateState[\s\S]*?\} catch/.test(widgetSync),
    "updateState must be wrapped in try/catch",
  );
  assert.ok(
    /try \{[\s\S]*?setPlaylistSlots[\s\S]*?\} catch/.test(widgetSync),
    "setPlaylistSlots must be wrapped in try/catch",
  );
});

check("widgetSync exports the three push/start entry points", () => {
  for (const fn of [
    "export function pushWidgetState",
    "export function pushWidgetPlaylistSlots",
    "export function startWidgetSync",
  ]) {
    assert.ok(widgetSync.includes(fn), `missing ${fn}`);
  }
});

check("startWidgetSync is idempotent and returns a disposer", () => {
  assert.ok(widgetSync.includes("if (!native || started) return () => {};"));
  assert.ok(/return \(\) => \{[\s\S]*?progressSub\?\.remove/.test(widgetSync));
});

check("PlayerContext subscribes exactly once", () => {
  const calls = (playerContext.match(/startWidgetSync\(/g) || []).length;
  assert.strictEqual(calls, 1, `expected 1 call site, found ${calls}`);
});

check("PlayerContext converts RNTP seconds to widget milliseconds", () => {
  assert.ok(playerContext.includes("positionRef.current * 1000"));
  assert.ok(playerContext.includes("durationRef.current * 1000"));
});

checkNative("RN package registers the widget module", () => {
  assert.ok(mainApp.includes("StreamifyWidgetPackage()"));
});

checkNative("manifest declares provider and action receiver, not exported", () => {
  assert.ok(manifest.includes('android:name=".StreamifyWidgetProvider"'));
  assert.ok(manifest.includes('android:name=".StreamifyWidgetActions"'));
  assert.ok(manifest.includes('@xml/widget_player_info'));
  const receivers = manifest.match(/<receiver[\s\S]*?>/g) || [];
  assert.strictEqual(receivers.length, 2);
  assert.ok(
    receivers.every((r) => r.includes('android:exported="false"')),
    "widget receivers must not be exported",
  );
});

checkNative("provider refreshes on widget update and on resize", () => {
  assert.ok(provider.includes("override fun onUpdate("));
  assert.ok(provider.includes("override fun onAppWidgetOptionsChanged("));
});

checkNative("provider sizes layouts from the reported widget width", () => {
  assert.ok(provider.includes("OPTION_APPWIDGET_MIN_WIDTH"));
  assert.ok(provider.includes("widget_player_small"));
  assert.ok(provider.includes("widget_player_medium"));
  assert.ok(provider.includes("widget_player_large"));
});

checkNative("transport only fires media keys while our session is alive", () => {
  assert.ok(actions.includes("KEY_ALIVE_WALL"));
  assert.ok(actions.includes("HEARTBEAT_MAX_AGE_MS"));
  assert.ok(actions.includes("dispatchMediaKeyEvent"));
  // The dead path must open the app rather than dispatch a key.
  assert.ok(
    /age in 0 until HEARTBEAT_MAX_AGE_MS[\s\S]*?return[\s\S]*?startActivity/.test(actions),
    "stale heartbeat must fall through to startActivity",
  );
});

const failures = results.filter((r) => r.startsWith("FAIL"));
const skips = results.filter((r) => r.startsWith("SKIP"));
console.log(results.join("\n"));
console.log(
  `\n${results.length - failures.length - skips.length}/${results.length - skips.length} passed` +
    (skips.length ? `, ${skips.length} skipped (no android/ prebuild)` : ""),
);
process.exit(failures.length > 0 ? 1 : 0);
