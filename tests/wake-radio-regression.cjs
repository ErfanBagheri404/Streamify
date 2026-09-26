/********************************************************************
 *  wake-radio-regression.cjs - static-contract + runtime checks for #46
 *
 *  The scheduler's logic (validation, weekday numbering, next-fire math,
 *  cancel-then-schedule ordering, WEEKLY-vs-DAILY) is transpiled and run
 *  for real against a recording expo-notifications fake. UI wiring is a
 *  file-content contract.
 *******************************************************************/
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");
const ROOT = path.resolve(__dirname, "..");
const TMP = process.env.TMPDIR || os.tmpdir();

let pass = 0;
let fail = 0;
const failures = [];

async function check(name, fn) {
  try {
    // MUST be awaited: an async check that is only invoked and not awaited
    // lets the next check start before this one settles, so a shared fake
    // (the notification log) gets clobbered mid-assertion and the rejection
    // escapes as an uncaught exception instead of a reported failure.
    await fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (e) {
    fail += 1;
    failures.push(name);
    console.log(`not ok - ${name}`);
    console.log(`  ${String(e && e.message).split("\n").slice(0, 4).join("\n  ")}`);
  }
}

const ts = require(require.resolve("typescript", { paths: [ROOT] }));

/** Strip block + line comments so commented-out code never reads live. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

// --- fakes shared by the runtime harness -------------------------------
const notifLog = [];
let permissionsGranted = true;
const fakeNotifications = {
  __esModule: true,
  SchedulableTriggerInputTypes: { DAILY: "daily", WEEKLY: "weekly" },
  AndroidImportance: { MAX: 5 },
  setNotificationChannelAsync: async (id, opts) => {
    notifLog.push({ op: "channel", id, opts });
  },
  getPermissionsAsync: async () => ({
    status: permissionsGranted ? "granted" : "denied",
  }),
  requestPermissionsAsync: async () => ({
    status: permissionsGranted ? "granted" : "denied",
  }),
  scheduleNotificationAsync: async (req) => {
    notifLog.push({ op: "schedule", req });
    return req.identifier;
  },
  cancelScheduledNotificationAsync: async (id) => {
    notifLog.push({ op: "cancel", id });
    return true;
  },
};

const memoryStore = new Map();
const fakeAsyncStorage = {
  __esModule: true,
  default: {
    getItem: async (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: async (k, v) => {
      memoryStore.set(k, v);
    },
    removeItem: async (k) => {
      memoryStore.delete(k);
    },
  },
};

const fakeTrackPlayerCalls = [];
const volumeLog = [];
const fakeTrackPlayer = {
  __esModule: true,
  default: {
    reset: async () => fakeTrackPlayerCalls.push("reset"),
    add: async (t) => fakeTrackPlayerCalls.push(`add:${t.length}`),
    play: async () => fakeTrackPlayerCalls.push("play"),
    setVolume: async (v) => volumeLog.push(v),
  },
};

const fakeRampLog = [];
const fakeFadeService = {
  __esModule: true,
  fadeService: {
    startRamp: (ms) => fakeRampLog.push(ms),
    configure: () => {},
    reset: () => {},
    onProgress: () => {},
    rampFraction: () => null,
    isRamping: () => false,
    setBaseVolume: () => {},
    setTrackGain: () => {},
  },
};

const fakeStorage = {
  __esModule: true,
  StorageService: {
    loadPlaylists: async () => [
      { id: "pl-1", name: "Morning", tracks: [{ id: "t1" }, { id: "t2" }] },
    ],
    loadLikedSongs: async () => Array.from({ length: 6 }, (_, i) => ({ id: `l${i}` })),
    loadPreviouslyPlayedSongs: async () => [{ id: "recent1" }, { id: "recent2" }],
  },
};

const fakeAiPlaylist = {
  __esModule: true,
  buildSmartQueue: (opts) => [{ id: `smart:${opts.seed.id}` }],
  loadPlayCounts: async () => new Map(),
};

const fakeRN = { __esModule: true, Platform: { OS: "android" }, AppState: {} };

function fakeRequire(spec) {
  const map = {
    "expo-notifications": fakeNotifications,
    "@react-native-async-storage/async-storage": fakeAsyncStorage,
    "react-native": fakeRN,
    "../utils/safeTrackPlayer": fakeTrackPlayer,
    "./FadeService": fakeFadeService,
    "../utils/storage": fakeStorage,
    "../modules/aiPlaylistService": fakeAiPlaylist,
    "../contexts/PlayerContext": { __esModule: true },
  };
  if (spec in map) return map[spec];
  throw new Error(`unexpected import in transpiled AlarmService: ${spec}`);
}

/** Transpile a TS file to CJS and evaluate with the fake require. */
function loadModule(relPath) {
  const src = read(relPath);
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: relPath,
  });
  const mod = { exports: {} };
  const fn = new Function("require", "module", "exports", out.outputText);
  fn(fakeRequire, mod, mod.exports);
  return mod.exports;
}

const alarmService = loadModule("services/AlarmService.ts");
const { validateAlarm, alarmService: svc } = {
  validateAlarm: alarmService.validateAlarm,
  alarmService: alarmService.alarmService,
};

const baseAlarm = (over = {}) => ({
  id: "a1",
  weekdays: [1, 2, 3],
  hour: 7,
  minute: 30,
  playlistId: null,
  playlistName: "Mix from history",
  fadeMinutes: 2,
  enabled: true,
  ...over,
});

// --- pure checks (no async) ------------------------------------------
// Validation, weekday mapping, next-fire math and payload parsing are
// synchronous; only the scheduling section needs the event loop.
async function runPureChecks() {
// --- validation ---------------------------------------------------------
await check("rejects an alarm with no weekdays", () => {
assert.throws(() => validateAlarm(baseAlarm({ weekdays: [] })), /weekday/);
});
await check("rejects out-of-range hour", () => {
assert.throws(() => validateAlarm(baseAlarm({ hour: 24 })), /hour/);
});
await check("rejects out-of-range minute", () => {
assert.throws(() => validateAlarm(baseAlarm({ minute: 61 })), /minute/);
});
await check("rejects out-of-range weekday", () => {
assert.throws(() => validateAlarm(baseAlarm({ weekdays: [7] })), /weekday/);
});
await check("rejects duplicate weekdays", () => {
assert.throws(() => validateAlarm(baseAlarm({ weekdays: [1, 1, 2] })), /duplicate/);
});
await check("rejects fade outside 1-3 minutes", () => {
assert.throws(() => validateAlarm(baseAlarm({ fadeMinutes: 5 })), /fade/);
assert.throws(() => validateAlarm(baseAlarm({ fadeMinutes: 0 })), /fade/);
});
await check("accepts a well-formed alarm", () => {
validateAlarm(baseAlarm());
});

// --- weekday numbering --------------------------------------------------
await check("JS Sunday 0 converts to trigger weekday 1 (and back)", () => {
assert.strictEqual(svc.toTriggerWeekday(0), 1);
assert.strictEqual(svc.fromTriggerWeekday(1), 0);
for (let d = 0; d < 7; d += 1) {
  assert.strictEqual(svc.fromTriggerWeekday(svc.toTriggerWeekday(d)), d);
}
});
await check("notification id is unique per alarm+weekday", () => {
assert.strictEqual(svc.notificationId("a1", 0), "a1:0");
assert.notStrictEqual(svc.notificationId("a1", 0), svc.notificationId("a1", 1));
});

// --- nextFireAt ---------------------------------------------------------
const HOUR = 3600_000;
const MIN = 60_000;
function at(h, m, dayOffset = 0) {
const d = new Date(2026, 8, 26, h, m, 0, 0); // 2026-09-26 is a Saturday (getDay 6)
d.setDate(d.getDate() + dayOffset);
return d.getTime();
}
await check("nextFireAt picks today's occurrence when still ahead", () => {
const alarm = baseAlarm({ weekdays: [6], hour: 22, minute: 0 });
const now = at(10, 0);
assert.strictEqual(svc.nextFireAt(alarm, now), at(22, 0));
});
await check("nextFireAt rolls to next week when today's occurrence passed", () => {
const alarm = baseAlarm({ weekdays: [6], hour: 7, minute: 30 });
const now = at(10, 0);
// Only Saturday selected: the next occurrence is 7 days out.
assert.strictEqual(svc.nextFireAt(alarm, now), at(7, 30, 7));
});
await check("nextFireAt rolls to tomorrow when another selected day follows", () => {
const alarm = baseAlarm({ weekdays: [6, 0], hour: 7, minute: 30 });
const now = at(10, 0);
assert.strictEqual(svc.nextFireAt(alarm, now), at(7, 30, 1));
});
await check("nextFireAt skips days that are not selected", () => {
// Now = Saturday; alarm only Mon(1)/Wed(3) -> next is Monday.
const alarm = baseAlarm({ weekdays: [1, 3], hour: 7, minute: 0 });
const now = at(10, 0);
assert.strictEqual(svc.nextFireAt(alarm, now), at(7, 0, 2));
});
await check("nextFireAt returns 0 when no weekdays selected", () => {
assert.strictEqual(svc.nextFireAt(baseAlarm({ weekdays: [] }), at(10, 0)), 0);
});
await check("nextFireAt with every-day wraps exactly one day forward", () => {
const alarm = baseAlarm({ weekdays: [0, 1, 2, 3, 4, 5, 6], hour: 7, minute: 0 });
const now = at(10, 0);
assert.strictEqual(svc.nextFireAt(alarm, now), at(7, 0, 1));
});

// --- payload parsing ----------------------------------------------------
await check("readAlarmId extracts a string alarmId", () => {
assert.strictEqual(svc.readAlarmId({ alarmId: "a1" }), "a1");
});
await check("readAlarmId returns null for foreign payloads", () => {
assert.strictEqual(svc.readAlarmId(null), null);
assert.strictEqual(svc.readAlarmId({}), null);
assert.strictEqual(svc.readAlarmId({ alarmId: 7 }), null);
});

}

// --- scheduling behavior (runtime against the fake) ---------------------
async function runSchedulingChecks() {
  memoryStore.clear();

  await check("scheduling uses WEEKLY triggers, one per weekday", async () => {
    notifLog.length = 0;
    const alarm = baseAlarm({ weekdays: [1, 3, 5] });
    await svc.save(alarm);
    const scheduled = notifLog.filter((e) => e.op === "schedule");
    assert.strictEqual(scheduled.length, 3, `expected 3, got ${scheduled.length}`);
    for (const entry of scheduled) {
      assert.strictEqual(
        entry.req.trigger.type,
        fakeNotifications.SchedulableTriggerInputTypes.WEEKLY,
        `trigger must be weekly, got ${entry.req.trigger.type} (daily fires every day)`,
      );
      assert.strictEqual(entry.req.trigger.hour, 7);
      assert.strictEqual(entry.req.trigger.minute, 30);
    }
    const triggerDays = scheduled.map((e) => e.req.trigger.weekday).sort();
    assert.deepStrictEqual(triggerDays, [2, 4, 6]); // JS 1/3/5 -> trigger 2/4/6
    const ids = scheduled.map((e) => e.req.identifier).sort();
    assert.deepStrictEqual(ids, ["a1:1", "a1:3", "a1:5"]);
  });

  await check("notification payload carries alarmId, not tracks", async () => {
    // Self-contained: set up its own save and read only its own slice of the
    // log, so it cannot pass on state another check happened to leave behind.
    notifLog.length = 0;
    await svc.save(baseAlarm({ id: "payload", weekdays: [2] }));
    const scheduled = notifLog.filter((e) => e.op === "schedule");
    assert.strictEqual(scheduled.length, 1, `expected 1, got ${scheduled.length}`);
    for (const entry of scheduled) {
      assert.strictEqual(entry.req.content.data.alarmId, "payload");
      assert.strictEqual(entry.req.content.data.tracks, undefined);
      assert.ok(
        typeof entry.req.content.title === "string" && entry.req.content.title.length > 0,
        "notification needs a title",
      );
    }
  });

  await check("save cancels every old notification before scheduling", async () => {
    notifLog.length = 0;
    await svc.save(baseAlarm({ hour: 8 }));
    const ops = notifLog.map((e) => e.op);
    const firstSchedule = ops.indexOf("schedule");
    const lastCancel = ops.lastIndexOf("cancel");
    assert.ok(lastCancel >= 0, "expected cancels before reschedule");
    assert.ok(
      lastCancel < firstSchedule,
      `cancel must precede schedule; order=${ops.join(",")}`,
    );
    // 3 cancels (old ids) then 3 schedules (new ids).
    assert.strictEqual(ops.filter((o) => o === "cancel").length, 3);
    assert.strictEqual(ops.filter((o) => o === "schedule").length, 3);
  });

  await check("disabled alarm cancels and schedules nothing", async () => {
    notifLog.length = 0;
    await svc.save(baseAlarm({ id: "a2", enabled: false }));
    assert.strictEqual(notifLog.filter((e) => e.op === "schedule").length, 0);
    assert.strictEqual(notifLog.filter((e) => e.op === "cancel").length, 3);
  });

  await check("permission denied: stores the alarm but schedules nothing", async () => {
    permissionsGranted = false;
    notifLog.length = 0;
    await svc.save(baseAlarm({ id: "a3" }));
    assert.strictEqual(notifLog.filter((e) => e.op === "schedule").length, 0);
    const stored = await svc.load();
    assert.ok(stored.some((a) => a.id === "a3"), "alarm must still persist");
    permissionsGranted = true;
  });

  await check("load drops malformed rows, keeps valid ones", async () => {
    memoryStore.set(
      "@wake_radio_alarms",
      JSON.stringify([baseAlarm({ id: "good" }), { id: "bad" }, null, "junk"]),
    );
    const alarms = await svc.load();
    assert.deepStrictEqual(alarms.map((a) => a.id), ["good"]);
  });

  await check("remove cancels and persists without the alarm", async () => {
    memoryStore.clear();
    await svc.save(baseAlarm({ id: "gone" }));
    notifLog.length = 0;
    const after = await svc.remove("gone");
    assert.strictEqual(after.length, 0);
    assert.strictEqual(notifLog.filter((e) => e.op === "cancel").length, 3);
    const stored = await svc.load();
    assert.strictEqual(stored.length, 0);
  });

  await check("syncAll re-arms only enabled alarms", async () => {
    memoryStore.clear();
    await svc.save(baseAlarm({ id: "on" }));
    await svc.save(baseAlarm({ id: "off", enabled: false }));
    notifLog.length = 0;
    await svc.syncAll();
    const ids = notifLog
      .filter((e) => e.op === "schedule")
      .map((e) => e.req.identifier);
    assert.ok(ids.every((id) => id.startsWith("on:")), `ids=${ids.join(",")}`);
    assert.strictEqual(ids.length, 3);
  });

  await check("start() queues the playlist, ramps, and plays", async () => {
    fakeTrackPlayerCalls.length = 0;
    fakeRampLog.length = 0;
    await svc.start(baseAlarm({ playlistId: "pl-1", fadeMinutes: 3 }));
    assert.deepStrictEqual(fakeTrackPlayerCalls, ["reset", "add:2", "play"]);
    assert.deepStrictEqual(fakeRampLog, [180_000]);
  });

  await check("start() with a missing playlist does not reset the queue", async () => {
    fakeTrackPlayerCalls.length = 0;
    fakeRampLog.length = 0;
    await svc.start(baseAlarm({ playlistId: "does-not-exist" }));
    assert.deepStrictEqual(fakeTrackPlayerCalls, []);
    assert.deepStrictEqual(fakeRampLog, []);
  });

  await check("start() falls back to the smart mix when no playlist", async () => {
    fakeTrackPlayerCalls.length = 0;
    fakeRampLog.length = 0;
    await svc.start(baseAlarm({ playlistId: null }));
    assert.ok(fakeTrackPlayerCalls.includes("add:1"), "mix queue must be added");
    assert.deepStrictEqual(fakeRampLog, [120_000]);
  });
}

// --- FadeService ramp (runtime) ----------------------------------------
// FadeService stamps its ramp start with Date.now(), so a mid-ramp
// assertion needs a movable clock. Install it before the module loads.
const realNow = Date.now;
let clockOffset = 0;
const fakeClock = {
  advance: (ms) => {
    clockOffset += ms;
  },
  reset: () => {
    clockOffset = 0;
  },
};
Date.now = () => realNow() + clockOffset;

function loadFadeService() {
  // Fresh module instance each call: the ramp state is module-level, so a
  // cached copy would leak between checks.
  for (const key of Object.keys(require.cache)) {
    if (key.includes("FadeService")) {
      delete require.cache[key];
    }
  }
  const src = read("services/FadeService.ts");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: "services/FadeService.ts",
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", out.outputText)(
    (spec) => {
      if (spec === "../utils/safeTrackPlayer") return fakeTrackPlayer;
      throw new Error(`unexpected import: ${spec}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

async function runFadeChecks() {
  await check("ramp climbs over time and completes", async () => {
    const { fadeService } = loadFadeService();
    fadeService.startRamp(120_000);
    assert.strictEqual(fadeService.isRamping(), true);
    const start = Date.now();
    const early = fadeService.rampFraction(start + 30_000);
    const late = fadeService.rampFraction(start + 90_000);
    const done = fadeService.rampFraction(start + 121_000);
    assert.ok(early > 0 && early < 1, `early=${early}`);
    assert.ok(late > early, `late=${late} should exceed early=${early}`);
    assert.strictEqual(done, 1);
    assert.strictEqual(fadeService.isRamping(), false, "ramp must clear at completion");
  });

  await check("ramp clamps below 30s and above 180s", async () => {
    const { fadeService } = loadFadeService();
    fadeService.startRamp(1000);
    assert.strictEqual(fadeService.rampFraction(Date.now() + 30_001), 1);
    fadeService.startRamp(999_999);
    const fraction = fadeService.rampFraction(Date.now() + 100_000);
    assert.ok(fraction < 1, `long ramp should still be climbing: ${fraction}`);
  });

  await check("onProgress holds the ramp at the floor instead of jumping to full", async () => {
    const { fadeService } = loadFadeService();
    // Crossfade OFF: without the ramp branch, onProgress would snap straight
    // to refLevel (1.0) and defeat the whole wake ramp.
    fadeService.configure(false, 4);
    fadeService.startRamp(120_000);
    // startRamp already put the player at the floor, so the correct behavior
    // on the very next tick is "stay at the floor" — which is a no-op volume
    // call by design (applyVolume skips unchanged targets). Advance the clock
    // so the ramp is genuinely mid-climb and a real call is expected.
    // onProgress must be a no-op volume-wise: the floor is already applied
    // (applyVolume skips unchanged targets).
    volumeLog.length = 0;
    await fadeService.onProgress(0, 300);
    assert.deepStrictEqual(
      volumeLog.slice(-1),
      [],
      "onProgress must not raise the volume at the start of a ramp",
    );
    volumeLog.length = 0;
    // Rewind the ramp start by a minute: fraction ~0.5.
    fadeService.startRamp(120_000);
    fakeClock.advance(60_000);
    await fadeService.onProgress(0, 300);
    assert.ok(
      volumeLog.length > 0,
      "mid-ramp tick must issue a partial volume call",
    );
    const mid = volumeLog[0];
    assert.ok(
      mid > 0.2 && mid < 0.7,
      `mid-ramp volume should sit between the floor and full, got ${mid}`,
    );
  });

  await check("rampFraction is null when no ramp is active", () => {
    const { fadeService } = loadFadeService();
    assert.strictEqual(fadeService.rampFraction(), null);
  });
}

// --- static contracts ---------------------------------------------------
async function runContractChecks() {
  await check("App mounts AlarmBridge inside PlayerProvider", () => {
    const app = stripComments(read("App.tsx"));
    assert.ok(/<AlarmBridge \/>/.test(app), "bridge not mounted");
    const bridgeIndex = app.indexOf("<AlarmBridge />");
    const providerIndex = app.indexOf("<PlayerProvider>");
    assert.ok(providerIndex >= 0 && bridgeIndex > providerIndex, "bridge must be inside PlayerProvider");
  });

  await check("SleepTimerSheet renders the alarm list", () => {
    const sheet = stripComments(read("components/SleepTimerSheet.tsx"));
    assert.ok(/<AlarmList \/>/.test(sheet), "alarm list not mounted in sleep sheet");
  });

  await check("both locales carry every alarm.* key used in code", () => {
    const sources = ["components/AlarmEditorSheet.tsx", "components/AlarmList.tsx"]
      .map((f) => read(f))
      .join("\n");
    const used = [...new Set([...sources.matchAll(/t\("(alarm\.[a-zA-Z]+)"\)/g)].map((m) => m[1]))];
    assert.ok(used.length >= 8, `expected >=8 alarm keys, found ${used.length}`);
    // Keys resolve through the nested "alarm" block (getNestedValue), not
    // flat top-level keys — assert the same way localization.ts reads them.
    const resolve = (data, key) =>
      key.split(".").reduce(
        (cur, part) => (cur && typeof cur === "object" ? cur[part] : undefined),
        data,
      );
    for (const file of ["locales/en.json", "locales/fa.json"]) {
      const data = JSON.parse(read(file));
      for (const key of used) {
        const value = resolve(data, key);
        assert.ok(
          typeof value === "string" && value.length > 0,
          `${file} missing ${key}`,
        );
      }
    }
  });

  await check("FadeService checks the ramp before the crossfade gate", () => {
    const fade = stripComments(read("services/FadeService.ts"));
    const onProgressIdx = fade.indexOf("onProgress(position");
    assert.ok(onProgressIdx >= 0, "onProgress must exist");
    // Require the consult itself: matching just the "rampFraction" identifier
    // would survive a sabotage that binds it to null instead of the ramp.
    const consultIdx = fade.indexOf("internal.ramp ? fadeService.rampFraction()", onProgressIdx);
    const gateIdx = fade.indexOf("internal.enabled", onProgressIdx);
    assert.ok(consultIdx >= 0, "onProgress must consult the ramp");
    assert.ok(gateIdx >= 0, "crossfade gate must exist in onProgress");
    assert.ok(consultIdx < gateIdx, "ramp must be consulted before the crossfade fast path");
  });

  await check("manual volume change cancels the ramp", () => {
    const fade = stripComments(read("services/FadeService.ts"));
    const setter = fade.indexOf("setBaseVolume(volume: number)");
    const cancel = fade.indexOf("internal.ramp = null", setter);
    assert.ok(setter >= 0 && cancel >= 0, "setBaseVolume must null the ramp");
    assert.ok(cancel - setter < 600, "cancel must be inside setBaseVolume, not a later function");
  });

  await check("AlarmService schedules WEEKLY (guards against the daily trap)", () => {
    const svcSrc = stripComments(read("services/AlarmService.ts"));
    assert.ok(
      /SchedulableTriggerInputTypes\.WEEKLY/.test(svcSrc),
      "WEEKLY trigger required: a DAILY trigger at H:M fires every day",
    );
    assert.ok(
      !/SchedulableTriggerInputTypes\.DAILY/.test(svcSrc),
      "DAILY trigger must not appear anywhere in AlarmService",
    );
  });

  await check("AlarmBridge registers a foreground notification handler", () => {
    const bridge = stripComments(read("components/AlarmBridge.tsx"));
    assert.ok(/setNotificationHandler/.test(bridge), "handler missing");
    assert.ok(/shouldPlaySound: true/.test(bridge), "alarm must be audible");
    assert.ok(/getLastNotificationResponseAsync/.test(bridge), "cold-start tap must be handled");
  });
}

// --- run ---------------------------------------------------------------
(async () => {
  await runPureChecks();
  await runContractChecks();
  await runSchedulingChecks();
  await runFadeChecks();

  console.log("");
  console.log(`# pass ${pass}`);
  console.log(`# fail ${fail}`);
  if (fail > 0) {
    console.log(`# failed: ${failures.join(" | ")}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
