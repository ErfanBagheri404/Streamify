/**
 * Private Listening / incognito contract tests (issue #44).
 *
 * Asserts the static contract: the setting exists and sanitizes, every
 * write site that must stay silent while incognito is on is actually
 * gated, auto-exit subscribes to the right signals, and the EN/FA locale
 * keys the Settings UI and tab-bar badge reference all exist.
 */
const assert = require("assert");
const fs = require("fs");
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

const appSettings = read("lib", "app-settings.ts");
const playerContext = read("contexts", "PlayerContext.tsx");
const scrobbler = read("services", "ScrobblerService.ts");
const cloudBridge = read("components", "CloudLibraryBridge.tsx");
const cloudSync = read("lib", "cloud-library-sync.ts");
const settingsScreen = read("components", "screens", "SettingsScreen.tsx");
const autoExit = read("modules", "incognitoAutoExit.ts");
const miniPlayer = read("components", "MiniPlayer.tsx");
const app = read("App.tsx");
const en = JSON.parse(read("locales", "en.json"));
const fa = JSON.parse(read("locales", "fa.json"));

// --- settings layer ---------------------------------------------------------

check("setting fields exist", () => {
  assert.ok(appSettings.includes("incognitoMode: boolean"));
  assert.ok(appSettings.includes("incognitoAutoExit: IncognitoAutoExit"));
  assert.ok(appSettings.includes("incognitoDayEnd: number | null"));
});

check("defaults are off and neutral", () => {
  assert.ok(appSettings.includes("incognitoMode: false"));
  assert.ok(appSettings.includes('incognitoAutoExit: "manual"'));
  assert.ok(appSettings.includes("incognitoDayEnd: null"));
});

check("sanitizer reads all three fields", () => {
  assert.ok(appSettings.includes("record.incognitoMode === \"boolean\""));
  assert.ok(appSettings.includes("isIncognitoAutoExit(record.incognitoAutoExit)"));
  assert.ok(appSettings.includes("record.incognitoDayEnd"));
});

// --- incognito stays out of the cloud snapshot ------------------------------

check("cloud snapshot shape excludes settings", () => {
  const snapshotType = cloudSync.slice(
    cloudSync.indexOf("export type CloudLibrarySnapshot"),
  );
  const body = snapshotType.slice(0, snapshotType.indexOf("};"));
  assert.ok(body.includes("playlists"));
  assert.ok(body.includes("likedSongs"));
  // If settings ever got folded into the payload, private listening could
  // leak to the account — assert the type has no room for it.
  assert.ok(!/settings|incognito/i.test(body));
});

// --- write-site gates -------------------------------------------------------

check("listening stats + scrobble progress are gated", () => {
  assert.ok(
    playerContext.includes("if (!incognitoRef.current) {"),
    "sampler must skip recordListening + scrobblerService.recordProgress",
  );
  const gate = playerContext.indexOf("if (!incognitoRef.current) {");
  const record = playerContext.indexOf("void recordListening(");
  const progress = playerContext.indexOf("scrobblerService.recordProgress(deltaMs)");
  assert.ok(record > gate, "recordListening must come after the incognito gate");
  assert.ok(progress > gate, "recordProgress must come after the incognito gate");
});

check("sampler gate does not return early (position bookkeeping)", () => {
  // A `return` inside the sampler would skip
  // `statsLastPositionRef.current = position` and desync the delta math.
  const block = playerContext.slice(
    playerContext.indexOf("if (!incognitoRef.current) {"),
    playerContext.indexOf("if (!incognitoRef.current) {") + 900,
  );
  assert.ok(!/^\s*return;$/m.test(block), "no early return inside the gate");
});

check("scrobble finalize/start is gated on track change", () => {
  assert.ok(
    playerContext.includes("if (nextTrack?.title && !incognitoRef.current) {"),
    "onTrackChange must not run while incognito",
  );
});

  check("previously-played write is gated", () => {
  // The merge folded the podcast gate into the same condition as the
  // incognito gate, so anchor on the gate, not on one exact line shape.
  const writeAt = playerContext.indexOf("setPreviouslyPlayedSongs((prev)");
  assert.ok(writeAt > -1, "the previously-played write exists");
  const gate = playerContext.slice(writeAt - 700, writeAt);
  assert.ok(
    /!incognitoRef\.current &&/.test(gate),
    "setPreviouslyPlayedSongs must be skipped while incognito",
  );
});

check("toggle-on edge discards scrobbler accumulation", () => {
  assert.ok(playerContext.includes("scrobblerService.discardActive()"));
  assert.ok(playerContext.includes("settings.incognitoMode && !wasIncognito"));
  assert.ok(playerContext.includes("statsAccumulatedMsRef.current = 0"));
  assert.ok(playerContext.includes("statsPlayCountedRef.current = null"));
});

check("discardActive resets the scrobbler internals", () => {
  assert.ok(scrobbler.includes("async discardActive()"));
  const body = scrobbler.slice(scrobbler.indexOf("async discardActive()"));
  for (const field of [
    "internal.active = null",
    "internal.activeElapsedMs = 0",
    "internal.activeDurationMs = 0",
  ]) {
    assert.ok(body.includes(field), `discardActive must run ${field}`);
  }
  // activeStartedAt was declared but never read or written — dead state.
  assert.ok(
    !scrobbler.includes("activeStartedAt"),
    "activeStartedAt is dead state and must not come back",
  );
  // It must not flush: discarding is a drop, not a submit.
  const fn = body.slice(0, body.indexOf("},"));
  assert.ok(!fn.includes("flush"), "discardActive must not flush pending");
});

// --- cloud sync gates -------------------------------------------------------

check("cloud push and foreground sync are gated", () => {
  const gate = /!user\?\.id \|\| settings\.incognitoMode/g;
  const matches = cloudBridge.match(gate) || [];
  assert.strictEqual(
    matches.length,
    2,
    "both the auto-push and the foreground-sync effect must check incognito",
  );
  assert.ok(
    cloudBridge.includes("settings.incognitoMode"),
    "incognito must be in the effect dependency lists",
  );
});

// --- auto-exit --------------------------------------------------------------

check("auto-exit subscribes to queue end", () => {
  assert.ok(autoExit.includes("Event.PlaybackQueueEnded"));
  assert.ok(autoExit.includes('mode === "queueEnd"'));
});

check("auto-exit handles the day boundary", () => {
  assert.ok(autoExit.includes('mode === "manual"'));
  assert.ok(autoExit.includes("AppState.addEventListener"));
  assert.ok(autoExit.includes("nextDayEndMillis"));
  // Firing on reopen when midnight already passed is the point of the
  // stored boundary; without it "end of day" would wait a full extra day.
  assert.ok(autoExit.includes("Date.now() >= dayBoundary"));
});

check("day boundary is captured when the toggle turns on", () => {
  assert.ok(settingsScreen.includes("incognitoDayEnd: value ? nextDayEndMillis() : null"));
  assert.ok(settingsScreen.includes("nextDayEndMillis"));
});

check("auto-exit is armed from the player provider", () => {
  assert.ok(playerContext.includes("subscribeIncognitoAutoExit({"));
  assert.ok(playerContext.includes("mode: settings.incognitoAutoExit"));
  assert.ok(playerContext.includes("dayBoundary: settings.incognitoDayEnd"));
});

// --- UI ---------------------------------------------------------------------

check("settings exposes the toggle and the auto-exit chips", () => {
  assert.ok(settingsScreen.includes("settings.incognitoMode"));
  assert.ok(
    /updateSettings\(\{\s*incognitoMode: value/.test(settingsScreen),
    "toggle must write incognitoMode",
  );
  assert.ok(settingsScreen.includes("INCOGNITO_AUTO_EXITS"));
  // Auto-exit chips are meaningless while off.
  assert.ok(settingsScreen.includes("{settings.incognitoMode ? ("));
});

check("indicator is visible on every screen and non-interactive", () => {
  // The tab bar overlays all screens, so the badge lives there.
  assert.ok(app.includes("settings.incognitoMode"));
  assert.ok(app.includes('pointerEvents="none"'));
  assert.ok(app.includes('accessibilityElementsHidden'));
  assert.ok(miniPlayer.includes("settings.incognitoMode"));
});

check("locale keys exist in both languages", () => {
  const keys = [
    "settings.incognito",
    "settings.incognitoDescription",
    "settings.incognitoAutoExit",
    "settings.incognitoAutoExitDescription",
    "settings.incognitoExitManual",
    "settings.incognitoExitQueueEnd",
    "settings.incognitoExitDayEnd",
  ];
  for (const key of keys) {
    assert.ok(en[key], `en.json missing ${key}`);
    assert.ok(fa[key], `fa.json missing ${key}`);
  }
});

// --- runtime: sanitizer + auto-exit logic under Node -------------------------

const os = require("os");
const ts = require(path.join(root, "node_modules", "typescript"));
const Module = require("module");
const origLoad = Module._load.bind(Module);
let virtual = new Map();
Module._load = function (request, parent, isMain) {
  if (virtual.has(request)) return virtual.get(request);
  return origLoad(request, parent, isMain);
};
function loadTs(relPath, provide) {
  const js = ts.transpileModule(read(...relPath.split("/")), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "incognito-"));
  const file = path.join(scratch, "mod.cjs");
  fs.writeFileSync(file, js);
  virtual = new Map(Object.entries(provide || {}));
  let mod;
  try {
    mod = require(file);
  } finally {
    virtual = new Map();
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
  }
  return mod;
}

const CACHE_BUDGET_STUB = {
  sanitizeCacheCapMb: (v) => (v === 500 || v === 2000 || v === 5000 ? v : 500),
};
const settingsModule = () =>
  loadTs("lib/app-settings.ts", { "../modules/cacheBudget": CACHE_BUDGET_STUB });

check("runtime: sanitizer coerces every junk incognito field back to default", () => {
  const { sanitizeAppSettings, DEFAULT_APP_SETTINGS } = settingsModule();
  const out = sanitizeAppSettings({
    incognitoMode: "yes",
    incognitoAutoExit: "sometimes",
    incognitoDayEnd: "tomorrow",
  });
  assert.strictEqual(out.incognitoMode, false);
  assert.strictEqual(out.incognitoAutoExit, "manual");
  assert.strictEqual(out.incognitoDayEnd, null);
  assert.strictEqual(out.incognitoMode, DEFAULT_APP_SETTINGS.incognitoMode);
});

check("runtime: sanitizer keeps the three valid auto-exit modes only", () => {
  const { sanitizeAppSettings } = settingsModule();
  for (const mode of ["manual", "queueEnd", "dayEnd"]) {
    assert.strictEqual(sanitizeAppSettings({ incognitoAutoExit: mode }).incognitoAutoExit, mode);
  }
  assert.strictEqual(sanitizeAppSettings({ incognitoAutoExit: "QueueEnd" }).incognitoAutoExit, "manual");
  assert.strictEqual(sanitizeAppSettings({ incognitoAutoExit: null }).incognitoAutoExit, "manual");
});

check("runtime: a non-finite day boundary is dropped, a finite one survives", () => {
  const { sanitizeAppSettings } = settingsModule();
  assert.strictEqual(sanitizeAppSettings({ incognitoDayEnd: NaN }).incognitoDayEnd, null);
  assert.strictEqual(sanitizeAppSettings({ incognitoDayEnd: Infinity }).incognitoDayEnd, null);
  assert.strictEqual(
    sanitizeAppSettings({ incognitoDayEnd: 1781555401000 }).incognitoDayEnd,
    1781555401000,
  );
});

check("runtime: a settings round-trip through JSON is idempotent", () => {
  const { sanitizeAppSettings } = settingsModule();
  const stored = sanitizeAppSettings({
    incognitoMode: true,
    incognitoAutoExit: "dayEnd",
    incognitoDayEnd: 1781555401000,
  });
  const reloaded = sanitizeAppSettings(JSON.parse(JSON.stringify(stored)));
  assert.deepStrictEqual(reloaded, stored, "a persisted incognito snapshot must reload unchanged");
});

check("runtime: a garbage record falls back to defaults, never to incognito on", () => {
  const { sanitizeAppSettings, DEFAULT_APP_SETTINGS } = settingsModule();
  for (const junk of [null, [], "nonsense", 42]) {
    const out = sanitizeAppSettings(junk);
    assert.strictEqual(out.incognitoMode, false);
    assert.deepStrictEqual(out, DEFAULT_APP_SETTINGS);
  }
});

// --- runtime: subscribeIncognitoAutoExit under Node ---------------------------

function makeAutoExit() {
  const appState = { subs: {}, addEventListener: (n, cb) => { appState.subs[n] = cb; return { remove: () => { delete appState.subs[n]; } }; } };
  const tp = { subs: {}, addEventListener: (n, cb) => { tp.subs[n] = cb; return { remove: () => { delete tp.subs[n]; } }; } };
  const rn = { AppState: appState, __esModule: true };
  const tpStub = { Event: { PlaybackQueueEnded: "PlaybackQueueEnded" }, State: {}, default: tp, __esModule: true };
  tpStub.default.default = tp;
  const mod = loadTs("modules/incognitoAutoExit.ts", {
    "react-native": rn,
    "react-native-track-player": tpStub,
  });
  return { mod, appState, tp };
}

check("runtime: past boundary disables immediately and arms no timers", () => {
  const { mod } = makeAutoExit();
  let disabled = 0;
  mod.subscribeIncognitoAutoExit({ mode: "dayEnd", disable: () => { disabled++; }, dayBoundary: Date.now() - 1000 });
  assert.strictEqual(disabled, 1, "an elapsed boundary must exit on the spot");
});

check("runtime: future boundary waits, and a foreground event before it does not exit", () => {
  const { mod, appState } = makeAutoExit();
  let disabled = 0;
  const dispose = mod.subscribeIncognitoAutoExit({
    mode: "dayEnd",
    disable: () => { disabled++; },
    dayBoundary: Date.now() + 3600000,
  });
  assert.strictEqual(disabled, 0, "a future boundary must not fire early");
  assert.ok(appState.subs.change, "dayEnd must listen to AppState to re-check on foreground");
  appState.subs.change("active");
  assert.strictEqual(disabled, 0, "foreground before the boundary must not exit");
  dispose();
  assert.ok(!("change" in appState.subs), "the disposer must remove the AppState listener");
});

check("runtime: queueEnd subscribes, disables once, and the disposer unsubscribes", () => {
  const { mod, tp } = makeAutoExit();
  let disabled = 0;
  const dispose = mod.subscribeIncognitoAutoExit({ mode: "queueEnd", disable: () => { disabled++; }, dayBoundary: null });
  assert.ok(tp.subs.PlaybackQueueEnded, "must subscribe to the queue-ended event");
  tp.subs.PlaybackQueueEnded();
  assert.strictEqual(disabled, 1);
  dispose();
  assert.ok(!("PlaybackQueueEnded" in tp.subs), "the disposer must remove the listener");
});

check("runtime: manual mode disables nothing and arms no listeners", () => {
  const { mod, appState, tp } = makeAutoExit();
  let disabled = 0;
  const dispose = mod.subscribeIncognitoAutoExit({ mode: "manual", disable: () => { disabled++; }, dayBoundary: null });
  assert.strictEqual(disabled, 0);
  assert.ok(!("change" in appState.subs));
  assert.strictEqual(Object.keys(tp.subs).length, 0);
  dispose();
});

check("runtime: nextDayEndMillis lands on the next local midnight", () => {
  const { mod } = makeAutoExit();
  const from = new Date("2026-06-15T23:59:30").getTime();
  const boundary = mod.nextDayEndMillis(from);
  assert.ok(boundary > from, "boundary must be in the future");
  assert.strictEqual(new Date(boundary).getHours(), 0);
  assert.strictEqual(new Date(boundary).getMinutes(), 0);
  assert.strictEqual(new Date(boundary).getSeconds(), 1);
  assert.strictEqual(new Date(boundary).getDate(), 16);
});

check("runtime: nextDayEndMillis never returns a same-day boundary", () => {
  const { mod } = makeAutoExit();
  const from = new Date("2026-06-15T00:00:30").getTime();
  const boundary = mod.nextDayEndMillis(from);
  assert.ok(boundary > from);
  assert.strictEqual(boundary - from > 1439 * 60000, true, "a boundary captured right after midnight must be a full day out");
});

// --- report -----------------------------------------------------------------

Promise.all(pending).then(() => {
  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) {
    console.log(line);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
});


