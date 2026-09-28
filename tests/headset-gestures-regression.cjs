/**
 * Headset button gesture regression contract tests (issue #45).
 *
 * Exercises the pure detector (modules/headsetGestures.ts) at runtime under
 * Node, plus verifies the app-settings, TrackPlayerService, playbackService,
 * PlayerContext, and SettingsScreen wiring via static contract assertions.
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

const ts = require(path.join(root, "node_modules", "typescript"));
const gestSrc = read("modules", "headsetGestures.ts");
const gestJs = ts.transpileModule(gestSrc, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const mod = new module.constructor();
mod.paths = module.paths;
mod._compile(gestJs, path.join(root, "modules", "headsetGestures.js"));
const { HeadsetGestureDetector, DEFAULT_HEADSET_GESTURE_CONFIG } = mod.exports;

// --- Runtime: single tap fallback to playPause ------------------------------

check("single tap dispatches playPause after the debounce window", async () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { windowMs: 40 },
  );

  detector.recordTap();
  assert.strictEqual(dispatched.length, 0, "must not fire synchronously");

  await new Promise((r) => setTimeout(r, 60));
  assert.deepStrictEqual(dispatched, ["playPause"]);
  detector.reset();
});

// --- Runtime: double tap ----------------------------------------------------

check("double tap within window dispatches configured doubleTapAction", async () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { windowMs: 50, doubleTapAction: "skipNext" },
  );

  detector.recordTap();
  await new Promise((r) => setTimeout(r, 15));
  detector.recordTap();

  await new Promise((r) => setTimeout(r, 70));
  assert.deepStrictEqual(dispatched, ["skipNext"]);
  detector.reset();
});

// --- Runtime: triple tap immediate trigger ----------------------------------

check("triple tap triggers immediately without waiting out the full window", async () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { windowMs: 200, tripleTapAction: "likeCurrent" },
  );

  detector.recordTap();
  await new Promise((r) => setTimeout(r, 20));
  detector.recordTap();
  await new Promise((r) => setTimeout(r, 20));
  detector.recordTap();

  assert.deepStrictEqual(
    dispatched,
    ["likeCurrent"],
    "triple tap must fire synchronously on the 3rd tap",
  );
  detector.reset();
});

// --- Runtime: disabled mode passes through synchronously --------------------

check("disabled mode passes through as immediate playPause with no buffer", () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { enabled: false },
  );

  detector.recordTap();
  assert.deepStrictEqual(
    dispatched,
    ["playPause"],
    "disabled detector must not debounce",
  );
  detector.reset();
});

// --- Runtime: reset clears pending taps -------------------------------------

check("reset clears pending timers so no late dispatch leaks", async () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { windowMs: 40 },
  );

  detector.recordTap();
  detector.reset();

  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(dispatched.length, 0);
});

// --- Runtime: dynamic updateConfig rewires actions --------------------------

check("updateConfig re-targets actions without recreation", async () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { windowMs: 40, doubleTapAction: "skipNext" },
  );

  detector.updateConfig({ doubleTapAction: "sleepTimer" });
  detector.recordTap();
  await new Promise((r) => setTimeout(r, 20));
  detector.recordTap();

  await new Promise((r) => setTimeout(r, 60));
  assert.deepStrictEqual(dispatched, ["sleepTimer"]);
  detector.reset();
});

// --- AppSettings contract ---------------------------------------------------

const appSettings = read("lib", "app-settings.ts");

check("app-settings declares headset gesture fields with safe defaults", () => {
  assert.ok(
    appSettings.includes("headsetGesturesEnabled: boolean"),
    "missing headsetGesturesEnabled in interface",
  );
  assert.ok(
    appSettings.includes("headsetDoubleTapAction: HeadsetAction"),
    "missing headsetDoubleTapAction in interface",
  );
  assert.ok(
    appSettings.includes("headsetTripleTapAction: HeadsetAction"),
    "missing headsetTripleTapAction in interface",
  );
  assert.ok(
    appSettings.includes("headsetGesturesEnabled: false"),
    "headset gestures must be false by default so OS behavior is untouched",
  );
  assert.ok(
    appSettings.includes("isHeadsetAction("),
    "sanitizer must validate the action union",
  );
});

// --- TrackPlayerService + PlaybackService contracts -------------------------

const tpService = read("services", "TrackPlayerService.ts");
const pbService = read("services", "playbackService.ts");

check("TrackPlayerService exposes onRemoteMediaButton and routes RemotePlay/Pause through it", () => {
  assert.ok(
    tpService.includes("onRemoteMediaButton?: () => Promise<void> | void"),
    "missing onRemoteMediaButton hook declaration",
  );
  assert.ok(
    tpService.includes("this.onRemoteMediaButton"),
    "RemotePlay/Pause listeners must check onRemoteMediaButton",
  );
});

check("playbackService checks onRemoteMediaButton before dispatching raw play/pause", () => {
  assert.ok(
    pbService.includes("trackPlayerService.onRemoteMediaButton"),
    "playbackService must check onRemoteMediaButton",
  );
});

// --- PlayerContext wiring contract ------------------------------------------

const playerCtx = read("contexts", "PlayerContext.tsx");

check("PlayerContext instantiates HeadsetGestureDetector and drives player actions", () => {
  assert.ok(
    playerCtx.includes("new HeadsetGestureDetector"),
    "PlayerContext must create detector",
  );
  assert.ok(
    playerCtx.includes("dispatchHeadsetAction"),
    "PlayerContext must have a dispatch action callback",
  );
  assert.ok(
    playerCtx.includes("settings.headsetDoubleTapAction"),
    "PlayerContext must pass doubleTapAction from settings",
  );
  assert.ok(
    playerCtx.includes("settings.headsetTripleTapAction"),
    "PlayerContext must pass tripleTapAction from settings",
  );
  assert.ok(
    playerCtx.includes("trackPlayerService.onRemoteMediaButton ="),
    "PlayerContext must install the media button hook",
  );
});

check("smartQueue builds a real queue instead of aliasing shuffle", () => {
  assert.ok(
    playerCtx.includes("headsetActionsRef.current.smartQueue"),
    "the smart queue action must exist on the action ref",
  );
  assert.ok(
    playerCtx.includes("buildSmartQueue("),
    "smartQueue must score the library, not shuffle it",
  );
  const start = playerCtx.indexOf("const dispatchHeadsetAction");
  const dispatch = playerCtx.slice(start, start + 2000);
  assert.ok(
    /case "smartQueue":[\s\S]{0,120}smartQueue\(\)/.test(dispatch),
    "the smartQueue case must call smartQueue(), not shuffle()",
  );
});

check("no dead long-press action is promised by the settings", () => {
  assert.ok(
    !appSettings.includes("headsetLongPressAction:"),
    "the hardware path only delivers taps; a stored long-press action is dead",
  );
});

// --- SettingsScreen UI contract ---------------------------------------------

const settingsScreen = read("components", "screens", "SettingsScreen.tsx");

check("the long-press action is not offered in settings UI either", () => {
  assert.ok(
    !settingsScreen.includes("headsetLongPressAction"),
    "the selector must not exist for an action the detector cannot fire",
  );
});

check("SettingsScreen includes the headset gestures switch and chip selectors", () => {
  assert.ok(
    settingsScreen.includes("headsetGesturesEnabled"),
    "missing toggle switch in settings",
  );
  assert.ok(
    settingsScreen.includes("headsetDoubleTapAction"),
    "missing double-tap selector",
  );
  assert.ok(
    settingsScreen.includes("headsetTripleTapAction"),
    "missing triple-tap selector",
  );
  assert.ok(
    settingsScreen.includes("HEADSET_GESTURE_ACTIONS"),
    "settings must iterate HEADSET_GESTURE_ACTIONS",
  );
});

// --- Locales contract -------------------------------------------------------

const en = JSON.parse(read("locales", "en.json"));
const fa = JSON.parse(read("locales", "fa.json"));

check("all headset settings and action keys exist in en and fa", () => {
  const required = [
    "headsetGestures",
    "headsetGesturesDescription",
    "headsetDoubleTap",
    "headsetDoubleTapDescription",
    "headsetTripleTap",
    "headsetTripleTapDescription",
    "headsetAction",
  ];
  for (const k of required) {
    assert.ok(en.settings[k], `en missing settings.${k}`);
    assert.ok(fa.settings[k], `fa missing settings.${k}`);
  }
  const actions = [
    "playPause",
    "skipNext",
    "skipPrevious",
    "likeCurrent",
    "smartQueue",
    "sleepTimer",
    "toggleShuffle",
  ];
  for (const a of actions) {
    assert.ok(en.settings.headsetAction[a], `en missing action ${a}`);
    assert.ok(fa.settings.headsetAction[a], `fa missing action ${a}`);
  }
});

// --- Runtime: double-fire guard ---------------------------------------------
// RNTP broadcasts each remote event to every registered listener, and both
// TrackPlayerService.setupEventListeners and the headless playbackService
// register for RemotePlay/RemotePause. One physical press therefore reaches
// recordTap() twice in the same tick. Without the guard, tapCount hits 2 and
// a single tap dispatches doubleTapAction instead of playPause.

check("a double-fired press counts as one tap, not two", async () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { windowMs: 60, doubleTapAction: "skipNext" },
  );

  // Both listener sets fire in the same tick — no await between them.
  detector.recordTap();
  detector.recordTap();

  await new Promise((r) => setTimeout(r, 80));
  assert.deepStrictEqual(
    dispatched,
    ["playPause"],
    "a double-fired single press must dispatch playPause, not doubleTapAction",
  );
  detector.reset();
});

check("a 4th tap inside the window does not start a phantom sequence", async () => {
  const dispatched = [];
  const detector = new HeadsetGestureDetector(
    (action) => dispatched.push(action),
    { windowMs: 200, tripleTapAction: "likeCurrent" },
  );

  detector.recordTap();
  await new Promise((r) => setTimeout(r, 20));
  detector.recordTap();
  await new Promise((r) => setTimeout(r, 20));
  detector.recordTap(); // triple — flushes immediately
  detector.recordTap(); // 4th, inside the old window — must be ignored

  await new Promise((r) => setTimeout(r, 250));
  assert.deepStrictEqual(
    dispatched,
    ["likeCurrent"],
    "a 4th tap must not dispatch a phantom playPause after the window",
  );
  detector.reset();
});

// --- Report -----------------------------------------------------------------

Promise.all(pending).then(() => {
  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) {
    console.log(line);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
});
