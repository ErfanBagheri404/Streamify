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
function check(name, fn) {
  try {
    fn();
    results.push(`PASS ${name}`);
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
  assert.ok(
    playerContext.includes("if (!incognitoRef.current && ("),
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

// --- report -----------------------------------------------------------------

const failed = results.filter((r) => r.startsWith("FAIL"));
for (const line of results) {
  console.log(line);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);


