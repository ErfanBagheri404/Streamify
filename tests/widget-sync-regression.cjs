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
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const results = [];
const pending = [];
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      pending.push(
        out.then(
          () => results.push(`PASS ${name}`),
          (e) => results.push(`FAIL ${name}: ${e.message}`),
        ),
      );
    } else {
      results.push(`PASS ${name}`);
    }
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

check("heartbeat progress events convert RNTP seconds to widget milliseconds", () => {
  // RNTP PlaybackProgressUpdated carries seconds; pushing them raw freezes
  // the widget bar near zero. The conversion must live in the heartbeat, not
  // just in the snapshot path.
  const start = widgetSync.indexOf("PlaybackProgressUpdated");
  assert.ok(start >= 0, "heartbeat listener missing");
  const block = widgetSync.slice(start, start + 900);
  assert.ok(
    /event\?\.position[\s\S]{0,40}\*\s*1000/.test(block),
    "position must be multiplied by 1000",
  );
  assert.ok(
    /event\?\.duration[\s\S]{0,40}\*\s*1000/.test(block),
    "duration must be multiplied by 1000",
  );
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

// --- runtime: modules/widgetSync.ts under Node with stubbed native surfaces --

// Small TS loader with a per-call Module._load interceptor, so the transpiled
// module resolves react-native / react-native-track-player to in-memory stubs.
const ts = require(path.join(root, "node_modules", "typescript"));
const Module = require("module");
const origLoad = Module._load.bind(Module);
let virtual = new Map();
Module._load = function (request, parent, isMain) {
  if (virtual.has(request)) return virtual.get(request);
  return origLoad(request, parent, isMain);
};
function loadWidgetModule(platformOs, nativeModule, tpStub) {
  const js = ts.transpileModule(read("modules", "widgetSync.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "widget-sync-"));
  const file = path.join(scratch, "widgetSync.cjs");
  fs.writeFileSync(file, js);
  virtual = new Map();
  virtual.set("react-native", {
    Platform: { OS: platformOs },
    NativeModules: { StreamifyWidgetModule: nativeModule },
    __esModule: true,
  });
  virtual.set("react-native-track-player", tpStub);
  let mod;
  try {
    mod = require(file);
  } finally {
    virtual = new Map();
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
  }
  return mod;
}

function makeTrackPlayerStub() {
  const subs = { progress: [], state: [], track: [] };
  const emitter = {
    addEventListener(name, cb) {
      const bucket = subs[name] || [];
      bucket.push(cb);
      subs[name] = bucket;
      return {
        remove: () => {
          const i = bucket.indexOf(cb);
          if (i >= 0) bucket.splice(i, 1);
        },
      };
    },
  };
  const stub = {
    Event: {
      PlaybackProgressUpdated: "progress",
      PlaybackState: "state",
      PlaybackActiveTrackChanged: "track",
    },
    State: {
      Playing: "playing",
      Buffering: "buffering",
      Connecting: "connecting",
      Paused: "paused",
      Stopped: "stopped",
      Ended: "ended",
    },
    default: emitter,
    __esModule: true,
  };
  stub.default.default = emitter;
  return { stub, subs };
}

check("runtime: isWidgetSyncAvailable reflects the native module", () => {
  const native = { updateState: () => {}, setPlaylistSlots: () => {} };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  assert.strictEqual(mod.isWidgetSyncAvailable, true);
  const mod2 = loadWidgetModule("ios", undefined, stub);
  assert.strictEqual(mod2.isWidgetSyncAvailable, false);
});

check("runtime: pushWidgetState coalesces a burst into one call, last wins", async () => {
  const calls = [];
  const native = { updateState: (...a) => calls.push(a), setPlaylistSlots: () => {} };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  mod.pushWidgetState({ title: "first" }, true, 1, 2);
  mod.pushWidgetState({ title: "second" }, false, 3, 4);
  mod.pushWidgetState({ title: "third" }, true, 5, 6);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(calls.length, 1, `expected 1 flush, got ${calls.length}`);
  assert.deepStrictEqual(calls[0], ["third", null, null, true, 5, 6]);
});

check("runtime: pushWidgetState maps a null track to nulls without throwing", async () => {
  const calls = [];
  const native = { updateState: (...a) => calls.push(a), setPlaylistSlots: () => {} };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  mod.pushWidgetState(null, false, 0, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [null, null, null, false, 0, 0]);
});

check("runtime: pushWidgetPlaylistSlots caps at 4 names and passes them through", () => {
  const slotCalls = [];
  const native = { updateState: () => {}, setPlaylistSlots: (n) => slotCalls.push(n) };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  mod.pushWidgetPlaylistSlots(["a", "b", "c", "d", "e", "f"]);
  assert.deepStrictEqual(slotCalls, [["a", "b", "c", "d"]]);
});

check("runtime: pushWidgetPlaylistSlots swallows a native throw", () => {
  const native = {
    updateState: () => {},
    setPlaylistSlots: () => { throw new Error("bridge down"); },
  };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  assert.doesNotThrow(() => mod.pushWidgetPlaylistSlots(["x"]));
});

check("runtime: pushWidgetState is a no-op when the native module is absent", async () => {
  const calls = [];
  const native = { updateState: (...a) => calls.push(a), setPlaylistSlots: () => {} };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("ios", undefined, stub);
  mod.pushWidgetState({ title: "x" }, true, 1, 2);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(calls.length, 0);
});

check("runtime: pushRecentShortcuts caps at 2, filters bad entries, dedupes", () => {
  const calls = [];
  const native = {
    updateState: () => {},
    setPlaylistSlots: () => {},
    setRecentShortcuts: (...a) => calls.push(a),
  };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  mod.pushRecentShortcuts([
    { id: "a", title: "A", artist: "aa" },
    { id: "", title: "B" },
    { id: "c", title: null },
    { id: "d", title: "D" },
  ]);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [["a", "d"], ["A", "D"], ["aa", ""]]);
  // an identical id set does not re-cross the bridge
  mod.pushRecentShortcuts([
    { id: "a", title: "A changed", artist: "aa" },
    { id: "d", title: "D", artist: "" },
  ]);
  assert.strictEqual(calls.length, 1, "dedupe must skip the second publish");
  // a changed set crosses the bridge again
  mod.pushRecentShortcuts([{ id: "z", title: "Z" }]);
  assert.strictEqual(calls.length, 2);
});

check("runtime: pushRecentShortcuts no-ops when native lacks setRecentShortcuts", () => {
  const native = { updateState: () => {}, setPlaylistSlots: () => {} };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  assert.doesNotThrow(() =>
    mod.pushRecentShortcuts([{ id: "a", title: "A" }]),
  );
});

check("runtime: startWidgetSync is idempotent and its disposer removes listeners", () => {
  const native = { updateState: () => {}, setPlaylistSlots: () => {} };
  const { stub, subs } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  const snap = () => ({ track: { title: "T" }, isPlaying: true, positionMs: 10, durationMs: 20 });
  const dispose = mod.startWidgetSync(snap);
  assert.strictEqual(subs.progress.length, 1);
  assert.strictEqual(subs.state.length, 1);
  assert.strictEqual(subs.track.length, 1);
  const dispose2 = mod.startWidgetSync(snap);
  assert.strictEqual(subs.progress.length, 1, "second start must not add listeners");
  assert.strictEqual(typeof dispose2, "function");
  dispose();
  assert.strictEqual(subs.progress.length, 0);
  assert.strictEqual(subs.state.length, 0);
  assert.strictEqual(subs.track.length, 0);
  // a dispose/restart cycle works
  mod.startWidgetSync(snap);
  assert.strictEqual(subs.progress.length, 1);
});

check("runtime: startWidgetSync returns a no-op disposer when native is absent", () => {
  const { stub, subs } = makeTrackPlayerStub();
  const mod = loadWidgetModule("ios", undefined, stub);
  const dispose = mod.startWidgetSync(() => ({ track: null, isPlaying: false, positionMs: 0, durationMs: 0 }));
  assert.strictEqual(typeof dispose, "function");
  assert.strictEqual(subs.progress.length, 0);
});

check("runtime: progress events convert seconds to ms and clamp negatives", async () => {
  const calls = [];
  const native = { updateState: (...a) => calls.push(a), setPlaylistSlots: () => {} };
  const { stub, subs } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  const snap = () => ({ track: { title: "T", artist: "A", thumbnail: "u" }, isPlaying: true, positionMs: 999, durationMs: 999 });
  mod.startWidgetSync(snap);
  subs.progress.forEach((cb) => cb({ position: 12.3456, duration: 60 }));
  await new Promise((r) => setTimeout(r, 300));
  const converted = calls[calls.length - 1];
  assert.strictEqual(converted[4], 12346, "seconds must be converted to milliseconds");
  assert.strictEqual(converted[5], 60000);
  subs.progress.forEach((cb) => cb({ position: -5 }));
  await new Promise((r) => setTimeout(r, 300));
  const clamped = calls[calls.length - 1];
  assert.deepStrictEqual(clamped, ["T", "A", "u", true, 0, 0], "negative/missing positions clamp to 0");
  subs.progress.forEach((cb) => cb({}));
  await new Promise((r) => setTimeout(r, 300));
  const missing = calls[calls.length - 1];
  assert.deepStrictEqual(missing, ["T", "A", "u", true, 0, 0]);
});

check("runtime: PlaybackState maps playing/buffering/connecting to isPlaying", async () => {
  const calls = [];
  const native = { updateState: (...a) => calls.push(a), setPlaylistSlots: () => {} };
  const { stub, subs } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  const snap = () => ({ track: { title: "T" }, isPlaying: false, positionMs: 7, durationMs: 8 });
  mod.startWidgetSync(snap);
  const flags = [];
  for (const st of ["playing", "buffering", "connecting", "paused", "stopped"]) {
    subs.state.forEach((cb) => cb({ state: st }));
    await new Promise((r) => setTimeout(r, 300));
    flags.push(calls[calls.length - 1][3]);
  }
  subs.state.forEach((cb) => cb("playing")); // bare-state payload
  await new Promise((r) => setTimeout(r, 300));
  flags.push(calls[calls.length - 1][3]);
  assert.deepStrictEqual(flags, [true, true, true, false, false, true]);
});

check("runtime: flush swallows a native throw from updateState", async () => {
  let sawError = null;
  const native = {
    updateState: () => { throw new Error("boom"); },
    setPlaylistSlots: () => {},
  };
  const { stub } = makeTrackPlayerStub();
  const mod = loadWidgetModule("android", native, stub);
  mod.pushWidgetState({ title: "x" }, true, 1, 2);
  try {
    await new Promise((r) => setTimeout(r, 300));
  } catch (e) {
    sawError = e;
  }
  assert.strictEqual(sawError, null, "a bridge failure must not reject the flush timer");
});

Promise.all(pending).then(() => {
  const failures = results.filter((r) => r.startsWith("FAIL"));
  const skips = results.filter((r) => r.startsWith("SKIP"));
  console.log(results.join("\n"));
  console.log(
    `\n${results.length - failures.length - skips.length}/${results.length - skips.length} passed` +
      (skips.length ? `, ${skips.length} skipped (no android/ prebuild)` : ""),
  );
  process.exit(failures.length > 0 ? 1 : 0);
});
