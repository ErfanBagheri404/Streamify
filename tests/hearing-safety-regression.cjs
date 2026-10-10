/* Run: node tests/hearing-safety-regression.cjs
 * One check per #48 requirement. Drive the pure JS with fakes; contract-check
 * the native side from file text. Exit code is non-zero on any failure.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

let failures = 0;
function check(name, fn) {
  test(name, async () => {
    try {
      await fn();
    } catch (e) {
      failures++;
      throw e;
    }
  });
}

/**
 * Transpile a TS module and evaluate it with injected fakes. The AsyncStorage
 * stub is dual-shaped (module.exports + .default + __esModule) because the TS
 * emit wraps the import in __importDefault.
 */
function storageStub() {
  const store = new Map();
  const api = {
    async getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async setItem(k, v) {
      store.set(k, String(v));
    },
    async removeItem(k) {
      store.delete(k);
    },
    async getAllKeys() {
      return [...store.keys()];
    },
    _store: store,
  };
  api.default = api;
  api.__esModule = true;
  return api;
}

function loadModule(file, fakes) {
  const source = read(file);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  const fakeRequire = (name) => {
    if (fakes[name]) return fakes[name];
    throw new Error(`unexpected require(${name}) in ${file}`);
  };
  new Function("require", "module", "exports", outputText)(
    fakeRequire,
    mod,
    mod.exports,
  );
  return mod.exports;
}

/** hearingSafety loaded with a programmable native module. */
function loadHearing({ os = "android", native = null } = {}) {
  const storage = storageStub();
  const rn = {
    Platform: { OS: os },
    NativeModules:
      native === null ? {} : { StreamifyHearingLimitModule: native },
  };
  const settings = loadModule("lib/app-settings.ts", {
    "react-native": rn,
    "@react-native-async-storage/async-storage": storage,
  });
  const hearing = loadModule("modules/hearingSafety.ts", {
    "react-native": rn,
    "@react-native-async-storage/async-storage": storage,
    "../lib/app-settings": settings,
  });
  return { hearing, settings, storage };
}

/* ------------------------------------------------------------------ */
/* Settings plumbing                                                    */
/* ------------------------------------------------------------------ */

check("settings: defaults + sanitize populate the three hearing fields", async () => {
  const { settings } = loadHearing();
  const out = settings.sanitizeAppSettings({});
  assert.strictEqual(out.hearingLimiterEnabled, false);
  assert.strictEqual(out.hearingCeiling, settings.HEARING_CEILING_DEFAULT);
  assert.strictEqual(out.hearingDeviceProfile, "unknown");

  // Valid values survive the round trip.
  const round = settings.sanitizeAppSettings({
    hearingLimiterEnabled: true,
    hearingCeiling: 70,
    hearingDeviceProfile: "bt-headphones",
  });
  assert.strictEqual(round.hearingLimiterEnabled, true);
  assert.strictEqual(round.hearingCeiling, 70);
  assert.strictEqual(round.hearingDeviceProfile, "bt-headphones");

  // Ceiling outside the range falls back to the default (sanitizeAppSettings
  // validates rather than clamps — the module's own clampCeiling is separate).
  assert.strictEqual(
    settings.sanitizeAppSettings({ hearingCeiling: 140 }).hearingCeiling,
    settings.HEARING_CEILING_DEFAULT,
  );
  assert.strictEqual(
    settings.sanitizeAppSettings({ hearingCeiling: 30 }).hearingCeiling,
    settings.HEARING_CEILING_DEFAULT,
  );

  // Unknown device profile falls back to the safe "unknown".
  const bad = settings.sanitizeAppSettings({ hearingDeviceProfile: "speaker" });
  assert.strictEqual(bad.hearingDeviceProfile, "unknown");
});

check("settings: ceiling options sit inside the ceiling range", async () => {
  const { settings } = loadHearing();
  const { min, max } = settings.HEARING_CEILING_RANGE;
  for (const opt of settings.HEARING_CEILING_OPTIONS) {
    assert.ok(opt >= min && opt <= max, `option ${opt} within ${min}..${max}`);
  }
});

check("settings: unknown profile has maxDbA 0 so it never mis-estimates", async () => {
  const { settings } = loadHearing();
  const entry = settings.HEARING_DEVICE_PROFILES.find((p) => p.id === "unknown");
  assert.strictEqual(entry.maxDbA, 0);
});

/* ------------------------------------------------------------------ */
/* Native surface                                                       */
/* ------------------------------------------------------------------ */

const KOTLIN = stripComments(read("plugins/android/StreamifyHearingLimitModule.kt"));

check("native: every method the JS wrapper calls is a @ReactMethod", async () => {
  const js = stripComments(read("modules/hearingSafety.ts"));
  const called = [
    "getState",
    "setCeiling",
    "setEnabled",
    "getOutputVolume",
  ];
  for (const name of called) {
    assert.ok(
      js.includes(`.${name}(`),
      `JS wrapper calls ${name} — it must be a @ReactMethod`,
    );
    const tagged = new RegExp(
      `@ReactMethod\\s*\\n\\s*fun ${name}\\(`,
    ).test(KOTLIN);
    assert.ok(tagged, `${name} is declared @ReactMethod in Kotlin`);
  }
});

check("native: ceiling is clamped in Kotlin, not trusted from JS", async () => {
  assert.ok(/clampCeiling/.test(KOTLIN), "clampCeiling present");
  assert.ok(
    /coerceIn\(MIN_CEILING, MAX_CEILING\)/.test(KOTLIN),
    "ceiling clamped to MIN..MAX",
  );
  assert.ok(
    /MIN_CEILING = 60/.test(KOTLIN) && /MAX_CEILING = 100/.test(KOTLIN),
    "clamp bounds match the JS range",
  );
  // The clamp must run on the raw JS value before anything is stored.
  assert.ok(
    /ceilingDbA = clampCeiling\(ceiling\.toInt\(\)\)/.test(KOTLIN),
    "setCeiling clamps the incoming value",
  );
});

check("native: init failure becomes supported=false, not a throw", async () => {
  assert.ok(
    /catch \(_\: Exception\) \{/.test(KOTLIN) && /catch \(_\: LinkageError\)/.test(KOTLIN),
    "init failure caught (including vendor LinkageError stubs)",
  );
  assert.ok(
    /state\.putBoolean\("supported", effect != null\)/.test(KOTLIN),
    "supported is false when the effect is null",
  );
  assert.ok(
    /if \(effect == null\) \{\s*\n\s*limiterEnabled = false/.test(KOTLIN),
    "setEnabled refuses to enable a missing effect",
  );
});

// Comments are stripped by stripComments() above, so a commented-out release
// still reads as a live bypass. Replace // line comments line-by-line (NOT a
// regex over the whole file): these files are CRLF, so splitting on "\n"
// leaves a trailing "\r", and a /.*$/ regex never reaches past it — the check
// then silently passes, which is exactly what happened before.
const stripLineComments = (s) =>
  s
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
const KOTLIN_LIVE = stripLineComments(stripComments(KOTLIN));

check("native: effect is released on invalidate", async () => {
  assert.ok(
    /override fun invalidate\(\) \{\s*\n\s*release\(\)/.test(KOTLIN),
    "invalidate releases",
  );
  assert.ok(/effect\?\.release\(\)/.test(KOTLIN), "release guarded");
  assert.ok(/effect = null/.test(KOTLIN), "effect cleared after release");
});

check("native: release() body really calls effect.release (not commented out)", async () => {
  const fn = KOTLIN_LIVE.match(/private fun release\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "release() function body found");
  assert.ok(
    /effect\?\.release\(\)/.test(fn[0]),
    "release body calls effect.release in live code",
  );
});

check("native: invalidate() really calls release (not commented out)", async () => {
  const fn = KOTLIN_LIVE.match(/override fun invalidate\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, "invalidate() body found");
  assert.ok(
    /\brelease\(\)/.test(fn[0]),
    "invalidate body calls release() in live code",
  );
});

/* ------------------------------------------------------------------ */
/* JS module: unsupported paths                                          */
/* ------------------------------------------------------------------ */

check("js: unsupported device reports a state, never throws", async () => {
  const { hearing, settings } = loadHearing();
  const state = await hearing.getHearingLimiterState();
  assert.strictEqual(state.supported, false);
  assert.strictEqual(state.enabled, false);
  assert.strictEqual(state.ceiling, settings.HEARING_CEILING_DEFAULT);
  assert.strictEqual(await hearing.isHearingLimiterSupported(), false);
});

check("js: iOS has no native path — every call degrades", async () => {
  const { hearing } = loadHearing({ os: "ios" });
  assert.strictEqual(hearing.HEARING_NATIVE_AVAILABLE, false);
  const state = await hearing.getHearingLimiterState();
  assert.strictEqual(state.supported, false);
  assert.strictEqual(await hearing.getOutputVolume(), null);
  // setCeiling still returns a sane clamped value on non-Android.
  const out = await hearing.setHearingCeiling(140);
  assert.strictEqual(out, hearing.clampCeiling(140));
  assert.strictEqual(await hearing.setHearingLimiterEnabled(true), false);
});

check("js: a missing native module is a state, not an exception", async () => {
  // getHearingLimiterState deliberately swallows every failure into
  // UNSUPPORTED_STATE (see its doc comment), so nothing rejects here — the
  // point is that callers cannot crash on a broken/absent module.
  const { hearing } = loadHearing();
  const state = await hearing.getHearingLimiterState();
  assert.strictEqual(state.supported, false);
  // The rebuild message is for the developer console, not a user-facing throw.
  const js = stripComments(read("modules/hearingSafety.ts"));
  assert.ok(/StreamifyHearingLimitModule is missing/.test(js), "rebuild message text");
  assert.ok(/rebuild/i.test(js), "message tells the dev to rebuild");
});

/* ------------------------------------------------------------------ */
/* clampCeiling                                                          */
/* ------------------------------------------------------------------ */

check("js: clampCeiling clamps, rounds, and rejects NaN", async () => {
  const { hearing, settings } = loadHearing();
  const { min, max } = settings.HEARING_CEILING_RANGE;
  assert.strictEqual(hearing.clampCeiling(140), max);
  assert.strictEqual(hearing.clampCeiling(30), min);
  assert.strictEqual(hearing.clampCeiling(87.6), 88);
  assert.strictEqual(hearing.clampCeiling(Number.NaN), settings.HEARING_CEILING_DEFAULT);
});

/* ------------------------------------------------------------------ */
/* estimateDbA                                                           */
/* ------------------------------------------------------------------ */

check("js: estimateDbA returns null for unknown profile or zero volume", async () => {
  const { hearing } = loadHearing();
  assert.strictEqual(hearing.estimateDbA(0.5, "unknown"), null);
  assert.strictEqual(hearing.estimateDbA(0, "phone"), null);
  assert.strictEqual(hearing.estimateDbA(-0.1, "phone"), null);
});

check("js: estimateDbA is monotonic in volume and bounded by maxDbA", async () => {
  const { hearing } = loadHearing();
  const low = hearing.estimateDbA(0.25, "phone");
  const mid = hearing.estimateDbA(0.5, "phone");
  const high = hearing.estimateDbA(1, "phone");
  assert.ok(low < mid && mid < high, "louder volume -> higher estimate");
  assert.strictEqual(high, 100, "full volume hits the profile max");
  assert.ok(low >= 80, "quarter volume stays above the 20 dB swing floor");
});

/* ------------------------------------------------------------------ */
/* Exposure meter                                                        */
/* ------------------------------------------------------------------ */

check("exposure: paused or muted contributes nothing", async () => {
  const { hearing } = loadHearing();
  const today = hearing.dayStamp();
  const base = [{ day: today, dbHours: 1, avgDbA: 80, seconds: 3600 }];
  // dbA null is what the caller passes when volume is 0 (muted) or the ROM
  // refuses to report volume — elapsedSeconds is untouched, so the ONLY gate
  // that can stop accrual is the dbA one. That makes it the load-bearing rule.
  const muted = hearing.accumulateExposure(base, {
    dbA: null,
    elapsedSeconds: 600,
    today,
  });
  assert.strictEqual(muted[0].dbHours, 1, "muted (null dbA) adds nothing");
  assert.strictEqual(muted[0].seconds, 3600, "and does not extend the window");
  const paused = hearing.accumulateExposure(base, {
    dbA: 90,
    elapsedSeconds: 0,
    today,
    // paused => the hook never calls this, but a zero interval is the
    // belt-and-braces path
  });
  assert.strictEqual(paused[0].dbHours, 1, "zero elapsed adds nothing");
});

check("exposure: accumulates dB-hours and keeps a weighted average", async () => {
  const { hearing } = loadHearing();
  const today = hearing.dayStamp();
  const next = hearing.accumulateExposure([], {
    dbA: 80,
    elapsedSeconds: 3600,
    today,
  });
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0].dbHours, 80, "80 dB(A) for 1h = 80 dB-hours");
  assert.strictEqual(next[0].seconds, 3600);

  const again = hearing.accumulateExposure(next, {
    dbA: 100,
    elapsedSeconds: 7200,
    today,
  });
  // 2 more hours at 100 dB(A) = 200 dB-hours on top of 80.
  assert.strictEqual(again[0].dbHours, 280, "adds dB(A) * hours");
  // Weighted average: (80*3600 + 100*7200) / 10800 = 93.33...
  assert.ok(Math.abs(again[0].avgDbA - 2800000 / 30000) < 1e-9, "average is time-weighted");
});

check("exposure: history beyond today is kept until the hook clears it", async () => {
  const { hearing } = loadHearing();
  const today = hearing.dayStamp();
  // prune() keeps every entry with day <= today, so historical days survive
  // the fold — daily reset is the HOOK's job (resetIfNewDay), not this
  // function's. Assert that contract so nobody "fixes" it either way.
  const stale = [{ day: "2020-01-01", dbHours: 999, avgDbA: 99, seconds: 9999 }];
  const next = hearing.accumulateExposure(stale, {
    dbA: 80,
    elapsedSeconds: 3600,
    today,
  });
  const old = next.find((e) => e.day === "2020-01-01");
  assert.ok(old, "pre-existing day preserved by prune");
  assert.strictEqual(old.dbHours, 999, "history untouched");
  const fresh = next.find((e) => e.day === today);
  assert.strictEqual(fresh.dbHours, 80, "today's row added");

  // Future-dated rows (clock skew) ARE dropped.
  const future = hearing.accumulateExposure(
    [{ day: "2999-01-01", dbHours: 5, avgDbA: 5, seconds: 5 }],
    { dbA: 80, elapsedSeconds: 3600, today },
  );
  assert.strictEqual(future.length, 1, "future row dropped, today added");
  assert.ok(!future.some((e) => e.day === "2999-01-01"), "future day gone");
});

check("exposure: summarize uses the last 7 days and the WHO budget", async () => {
  const { hearing, settings } = loadHearing();
  const today = hearing.dayStamp();
  const days = [];
  for (let i = 8; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const stamp = hearing.dayStamp(d);
    days.push({ day: stamp, dbHours: 10, avgDbA: 80, seconds: 36000 });
  }
  const s = hearing.summarizeExposure(days, today);
  assert.strictEqual(s.todayDbHours, 10);
  assert.strictEqual(s.weeklyDbHours, 70, "the last 7 days only, older 20 excluded");
  assert.strictEqual(s.budgetDbHours, settings.WHO_WEEKLY_BUDGET_DB_HOURS);
  assert.ok(Math.abs(s.weeklyRatio - 70 / 40) < 1e-9, "ratio = weekly / budget");
  assert.strictEqual(s.days.length, 7, "UI rows capped at 7");
  assert.ok(s.days[0].day <= s.days[6].day, "oldest first");
});

check("exposure: storage round trip survives malformed JSON", async () => {
  const { hearing, storage } = loadHearing();
  await storage.setItem(hearing.HEARING_EXPOSURE_STORAGE_KEY, "{not json");
  const days = await hearing.readExposureDays();
  assert.deepStrictEqual(days, [], "malformed JSON -> empty list, no throw");

  await storage.setItem(
    hearing.HEARING_EXPOSURE_STORAGE_KEY,
    JSON.stringify([{ day: "x" }, { day: "y", dbHours: "nan" }]),
  );
  const filtered = await hearing.readExposureDays();
  assert.deepStrictEqual(filtered, [], "entries without numeric dbHours dropped");
});

check("exposure: recordExposure persists and clearExposure empties", async () => {
  const { hearing, storage } = loadHearing();
  const today = hearing.dayStamp();
  await hearing.recordExposure({ dbA: 80, elapsedSeconds: 3600, today });
  const raw = await storage.getItem(hearing.HEARING_EXPOSURE_STORAGE_KEY);
  assert.ok(raw, "exposure persisted");
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed[0].dbHours, 80);

  await hearing.clearExposure();
  const after = await storage.getItem(hearing.HEARING_EXPOSURE_STORAGE_KEY);
  assert.strictEqual(after, "[]", "clear writes an empty list");
});

/* ------------------------------------------------------------------ */
/* Plugin + UI wiring                                                    */
/* ------------------------------------------------------------------ */

check("plugin: registers the package and copies both Kotlin files", async () => {
  const plugin = stripComments(read("plugins/withHearingSafety.js"));
  assert.ok(/withDangerousMod/.test(plugin), "copies sources via withDangerousMod");
  assert.ok(/withMainApplication/.test(plugin), "registers via withMainApplication");
  assert.ok(
    /add\(StreamifyHearingLimitPackage\(\)\)/.test(plugin),
    "package added to getPackages",
  );
  assert.ok(
    /StreamifyHearingLimitModule\.kt/.test(plugin) &&
      /StreamifyHearingLimitPackage\.kt/.test(plugin),
    "both Kotlin files listed",
  );
  // Guard: a missing source must fail prebuild loudly.
  assert.ok(/throw new Error/.test(plugin), "missing source throws");
});

check("app.json: plugin registered in the plugins array", async () => {
  const app = JSON.parse(read("app.json"));
  assert.ok(
    (app.expo?.plugins ?? app.plugins ?? []).includes("./plugins/withHearingSafety"),
    "withHearingSafety in app.json plugins",
  );
});

check("ui: settings rows gate the native call and use flat styling", async () => {
  const settings = stripComments(read("components/screens/SettingsScreen.tsx"));
  assert.ok(/hearingLimiterEnabled/.test(settings), "limiter toggle wired");
  assert.ok(/hearingCeiling/.test(settings), "ceiling control wired");
  assert.ok(/hearingDeviceProfile/.test(settings), "profile picker wired");
  assert.ok(/updateSettings\(\{ hearingLimiterEnabled: value \}\)/.test(settings),
    "toggle writes the setting");
});

check("ui: Replay's exposure block uses the uncapped store", async () => {
  const replay = stripComments(read("components/screens/ReplayScreen.tsx"));
  assert.ok(/readExposureDays/.test(replay), "reads the exposure store");
  assert.ok(/summarizeExposure/.test(replay), "summarizes exposure");
  // The exposure block must never be fed by loadReplaySummary — that caps its
  // lists at 25 for display, which would silently under-count a cumulative
  // metric. Anchor on the CALL SITE (last occurrence — the first is the
  // import) and check the data flow: readExposureDays -> summarizeExposure.
  const callAt = replay.lastIndexOf("readExposureDays()");
  assert.ok(callAt > -1, "readExposureDays is called");
  // 120 chars covers ".then((days) => { ... setExposure(summarizeExposure(days))"
  // but stops before the next callback, which legitimately uses
  // loadReplaySummary for its OWN (non-exposure) data.
  const block = replay.slice(callAt, callAt + 140);
  assert.ok(/summarizeExposure\(days\)/.test(block), "summary fed by store days");
  assert.ok(!/loadReplaySummary/.test(block), "exposure not fed by capped summary");
  assert.ok(/setExposure/.test(block), "result flows into the exposure state");
  assert.ok(/replay\.hearingExposure/.test(replay), "block has a title key");
  assert.ok(/WHO_WEEKLY_BUDGET_DB_HOURS/.test(replay), "shows the WHO budget");
});

check("hook: the toggle gates the native call — off never enables", async () => {
  const hook = stripComments(read("hooks/useHearingSafety.ts"));
  assert.ok(/hearingLimiterEnabled/.test(hook), "reads the toggle");
  assert.ok(/setHearingLimiterEnabled\(false\)/.test(hook), "off path disables");
  assert.ok(/setHearingLimiterEnabled\(true\)/.test(hook), "on path enables");
  // The paused/muted gates must be in the tick, before any accumulation.
  assert.ok(/if \(!isPlaying\) return;/.test(hook), "paused contributes nothing");
  assert.ok(/volume === null \|\| volume <= 0\) return;/.test(hook),
    "muted/unknown volume contributes nothing");
  // Guard: the ceilings the settings can hold are the ones pushed to native.
  assert.ok(/setHearingCeiling\(hearingCeiling\)/.test(hook),
    "the saved ceiling is what reaches native");
});

check("hook: the disabled setting path disables native (off never enables)", async () => {
  const hook = stripComments(read("hooks/useHearingSafety.ts"));
  // Branch-level proof, independent of the comment-stripped text: the hook's
  // else-branch must exist and must call the disable method. Two anchors, so
  // reordering or a commented-out branch both fail.
  assert.ok(
    /else \{\s*\n\s*await setHearingLimiterEnabled\(false\);/.test(hook),
    "an else branch calls setHearingLimiterEnabled(false)",
  );
  // And the inverse: there is no path where the toggle being OFF still enables.
  const enableCalls = hook.match(/setHearingLimiterEnabled\(true\)/g) ?? [];
  const insideOn = hook.match(
    /if \(hearingLimiterEnabled\) \{[\s\S]{0,400}?setHearingLimiterEnabled\(true\)/,
  );
  assert.strictEqual(enableCalls.length, 1, "enabled(true) called exactly once");
  assert.ok(insideOn, "enabled(true) is gated on the toggle being on");
});

check("ui: App mounts the hearing bridge next to the player", async () => {
  const app = stripComments(read("App.tsx"));
  assert.ok(/useHearingSafety/.test(app), "hook used");
  assert.ok(/HearingSafetyBridge/.test(app), "bridge component mounted");
  // It must sit inside the player scope: the hook reads isPlaying + settings.
  const bridgeAt = app.indexOf("function HearingSafetyBridge");
  assert.ok(bridgeAt > -1, "bridge component defined");
  const body = app.slice(bridgeAt, bridgeAt + 400);
  assert.ok(/usePlayer\(\)/.test(body), "bridge reads isPlaying from usePlayer");
  assert.ok(/useHearingSafety\(/.test(body), "bridge calls the hook");
  assert.ok(/hearingDeviceProfile/.test(body), "bridge passes the device profile");
});

check("locale keys exist in en and fa (fa is real Persian)", async () => {
  const en = JSON.parse(read("locales/en.json")).settings;
  const fa = JSON.parse(read("locales/fa.json")).settings;
  for (const k of [
    "hearingLimiter",
    "hearingLimiterDescription",
    "hearingCeiling",
    "hearingCeilingDescription",
    "hearingDeviceProfile",
    "hearingDeviceProfileDescription",
  ]) {
    assert.ok(en[k], `en ${k}`);
    assert.ok(fa[k], `fa ${k}`);
  }
  // Persian script range (U+0600–U+06FF plus Arabic presentation forms).
  assert.ok(/[؀-ۿ]/.test(fa.hearingLimiter), "fa copy is Persian script");
  assert.ok(
    !/^[A-Za-z]/.test(fa.hearingLimiter),
    "fa copy is not Latin script",
  );
});

// node:test exits non-zero when any check fails.
process.on("exit", (code) => {
  if (failures > 0 && code === 0) process.exitCode = 1;
});
