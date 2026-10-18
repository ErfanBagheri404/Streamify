/* Run: node tests/equalizer-regression.cjs
 * One check per #28 requirement. Drive the pure JS with fakes; contract-check
 * the native side from file text. Exit code is non-zero on any failure.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

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

/** Transpile a TS module and evaluate it with injected fakes (known-working pattern). */
function loadModule(file, fakes) {
  const source = read(file);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  const fakeRequire = (name) => {
    if (fakes[name]) return fakes[name];
    throw new Error(`unexpected require(${name}) in ${file}`);
  };
  new Function("require", "module", "exports", outputText)(fakeRequire, mod, mod.exports);
  return mod.exports;
}

/** app-settings imports sanitizeCacheCapMb from ../modules/cacheBudget, so a
 *  settings-level check has to hand it the real module, not a blank fakes map. */
const cacheBudget = loadModule("modules/cacheBudget.ts", {});

/** react-native fake: programmable Platform.OS + NativeModules. */
function rnFake({ os = "android", modules = {} } = {}) {
  const calls = [];
  return {
    rn: {
      Platform: { OS: os },
      NativeModules: modules,
      PermissionsAndroid: {},
    },
    calls,
    track(name) {
      return (...args) => {
        calls.push({ name, args });
        return this[name](...args);
      };
    },
  };
}

const BANDS = {
  getInfo: async () => ({
    supported: true,
    numberOfBands: 2,
    minMillibel: -1500,
    maxMillibel: 1500,
    levels: [0, 100],
    centerFreqHz: [60, 1000],
  }),
  setBandLevel: async (band, millibel) => millibel,
  setEnabled: async (enabled) => enabled,
};

// --- JS wrapper: passthrough and gating ----------------------------------

check("wrapper calls getInfo and surfaces its payload", async () => {
  const { rn } = rnFake({ modules: { StreamifyEqualizerModule: BANDS } });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.deepEqual(await eq.getEqualizerInfo(), await BANDS.getInfo());
});

check("wrapper setBandLevel passes (band, millibel) through", async () => {
  const seen = [];
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: {
        ...BANDS,
        setBandLevel: async (b, m) => {
          seen.push([b, m]);
          return m;
        },
      },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.equal(await eq.setEqualizerBandLevel(1, -300), -300);
  assert.deepEqual(seen, [[1, -300]]);
});

check("wrapper setEnabled passes the boolean through", async () => {
  const seen = [];
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: {
        ...BANDS,
        setEnabled: async (v) => {
          seen.push(v);
          return v;
        },
      },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.equal(await eq.setEqualizerEnabled(true), true);
  assert.deepEqual(seen, [true]);
});

check("wrapper never throws when the module is not linked", async () => {
  const { rn } = rnFake({ modules: {} });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    assert.deepEqual(await eq.getEqualizerInfo(), {
      supported: false,
      numberOfBands: 0,
      minMillibel: 0,
      maxMillibel: 0,
      levels: [],
      centerFreqHz: [],
    });
    assert.equal(await eq.setEqualizerBandLevel(0, 0), null);
    assert.equal(await eq.setEqualizerEnabled(true), false);
  } finally {
    console.warn = orig;
  }
  assert.ok(
    warnings.some((w) => w.includes("not linked")),
    "first unlinked call warns with link guidance",
  );
});

check("wrapper resolves unsupported instead of throwing on native errors", async () => {
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: { getInfo: async () => { throw new Error("boom"); } },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.equal((await eq.getEqualizerInfo()).supported, false);
});

check("wrapper no-ops on non-Android platforms", async () => {
  const { rn } = rnFake({ os: "ios", modules: { StreamifyEqualizerModule: BANDS } });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.equal((await eq.getEqualizerInfo()).supported, false);
  assert.equal(await eq.setEqualizerBandLevel(0, 100), null);
  assert.equal(await eq.setEqualizerEnabled(true), false);
});

// --- settings plumbing ----------------------------------------------------

check("equalizerEnabled is declared, defaulted false and sanitized", async () => {
  const s = loadModule("lib/app-settings.ts", { "../modules/cacheBudget": cacheBudget });
  assert.equal(s.DEFAULT_APP_SETTINGS.equalizerEnabled, false);
  assert.equal(s.sanitizeAppSettings({}).equalizerEnabled, false);
  assert.equal(s.sanitizeAppSettings({ equalizerEnabled: true }).equalizerEnabled, true);
  assert.equal(s.sanitizeAppSettings({ equalizerEnabled: "yes" }).equalizerEnabled, false);
});

check("equalizerEnabled survives a payload of garbage settings", async () => {
  const s = loadModule("lib/app-settings.ts", { "../modules/cacheBudget": cacheBudget });
  const out = s.sanitizeAppSettings({
    equalizerEnabled: true,
    theme: "neon-tan",
    seekStepSeconds: 7,
    crossfadeSeconds: 99,
  });
  assert.equal(out.equalizerEnabled, true, "a good toggle was lost in sanitize");
  assert.equal(out.theme, "default");
  assert.equal(out.seekStepSeconds, 10);
  assert.equal(out.crossfadeSeconds, 4);
});

// --- gain/enable contract on the JS surface ---------------------------------

check("an out-of-range gain is passed through unclamped (native owns the clamp)", async () => {
  const seen = [];
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: {
        ...BANDS,
        setBandLevel: async (band, millibel) => {
          seen.push([band, millibel]);
          return millibel;
        },
      },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.equal(await eq.setEqualizerBandLevel(99, 99_999), 99_999, "gain was clamped in JS");
  assert.equal(await eq.setEqualizerBandLevel(-1, -99_999), -99_999);
  assert.equal(await eq.setEqualizerBandLevel(1, -12.5), -12.5, "gain was rounded in JS");
  assert.deepEqual(seen, [[99, 99_999], [-1, -99_999], [1, -12.5]]);
});

check("setBandLevel resolves null when the native call throws", async () => {
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: {
        ...BANDS,
        setBandLevel: async () => {
          throw new Error("dead effect");
        },
      },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.equal(await eq.setEqualizerBandLevel(0, 300), null);
});

check("setEnabled resolves false when the native call throws", async () => {
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: {
        ...BANDS,
        setEnabled: async () => {
          throw new Error("dead effect");
        },
      },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  assert.equal(await eq.setEqualizerEnabled(true), false);
});

check("the link warning fires once, not on every unlinked call", async () => {
  const { rn } = rnFake({ modules: {} });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    await eq.getEqualizerInfo();
    await eq.getEqualizerInfo();
    await eq.setEqualizerBandLevel(0, 100);
    await eq.setEqualizerEnabled(true);
  } finally {
    console.warn = orig;
  }
  const linkWarnings = warnings.filter((w) => w.includes("not linked")).length;
  assert.equal(linkWarnings, 1, `link guidance repeated ${linkWarnings} times`);
});

check("getInfo is never cached: each call re-reads the native state", async () => {
  let levels = [0, 0];
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: {
        ...BANDS,
        getInfo: async () => ({ ...(await BANDS.getInfo()), levels }),
      },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  await eq.setEqualizerBandLevel(1, -200);
  levels = [0, -200];
  assert.deepEqual((await eq.getEqualizerInfo()).levels, [0, -200]);
  levels = [0, 0];
  assert.deepEqual((await eq.getEqualizerInfo()).levels, [0, 0], "info was cached");
});

check("isEqualizerSupported tracks platform and module linkage", async () => {
  const linkedAndroid = loadModule("modules/audioEqualizer.ts", {
    "react-native": rnFake({ os: "android", modules: { StreamifyEqualizerModule: BANDS } }).rn,
  });
  assert.equal(linkedAndroid.isEqualizerSupported, true);
  const unlinkedAndroid = loadModule("modules/audioEqualizer.ts", {
    "react-native": rnFake({ os: "android", modules: {} }).rn,
  });
  assert.equal(unlinkedAndroid.isEqualizerSupported, false);
  const linkedIos = loadModule("modules/audioEqualizer.ts", {
    "react-native": rnFake({ os: "ios", modules: { StreamifyEqualizerModule: BANDS } }).rn,
  });
  assert.equal(linkedIos.isEqualizerSupported, false, "a linked module is useless on iOS");
});


check("native and settings calls keep their call order", async () => {
  const log = [];
  const { rn } = rnFake({
    modules: {
      StreamifyEqualizerModule: {
        ...BANDS,
        setBandLevel: async (b, m) => {
          log.push(["band", b, m]);
          return m;
        },
        setEnabled: async (v) => {
          log.push(["enabled", v]);
          return v;
        },
      },
    },
  });
  const eq = loadModule("modules/audioEqualizer.ts", { "react-native": rn });
  await eq.setEqualizerEnabled(true);
  await eq.setEqualizerBandLevel(1, -300);
  await eq.setEqualizerEnabled(false);
  assert.deepEqual(log, [
    ["enabled", true],
    ["band", 1, -300],
    ["enabled", false],
  ]);
});

// --- native contract from file text ----------------------------------------

/** Load the config plugin with a recording fake of @expo/config-plugins. */
function loadPlugin() {
  const mods = {};
  const platforms = {};
  const record = (name) => (_config, cb) => {
    // withDangerousMod takes [platform, fn]; the others take fn.
    if (Array.isArray(cb)) {
      platforms[name] = cb[0];
      mods[name] = cb[1];
    } else {
      mods[name] = cb;
    }
    return _config;
  };
  const code = read("plugins/withEqualizer.js");
  const mod = { exports: {} };
  new Function("require", "module", "exports", "__dirname", code)(
    (n) => {
      if (n === "@expo/config-plugins") {
        return {
          withDangerousMod: record("withDangerousMod"),
          withMainApplication: record("withMainApplication"),
          withAndroidManifest: record("withAndroidManifest"),
        };
      }
      // Real builtins: the plugin copies files with fs.
      return require(n);
    },
    mod,
    mod.exports,
    path.join(root, "plugins"),
  );
  const config = mod.exports({ name: "probe" });
  return { config, mods, platforms };
}

const kt = read("plugins/android/StreamifyEqualizerModule.kt");
const pkg = read("plugins/android/StreamifyEqualizerPackage.kt");
const plugin = read("plugins/withEqualizer.js");
const screen = read("components/screens/SettingsScreen.tsx");

check("plugin copies both Kotlin sources into the generated android tree", async () => {
  const os = require("node:os");
  const fakeAndroid = fs.mkdtempSync(path.join(os.tmpdir(), "eq-android-"));
  const { mods, platforms } = loadPlugin();
  assert.equal(platforms.withDangerousMod, "android", "mod targets the android platform");
  mods.withDangerousMod({ modRequest: { platformProjectRoot: fakeAndroid } });
  const copied = fs.existsSync(
    path.join(fakeAndroid, "app/src/main/java/com/erfanbagheri/streamifymobile"),
  )
    ? fs.readdirSync(path.join(fakeAndroid, "app/src/main/java/com/erfanbagheri/streamifymobile")).sort()
    : [];
  assert.deepEqual(copied, ["StreamifyEqualizerModule.kt", "StreamifyEqualizerPackage.kt"]);
  fs.rmSync(fakeAndroid, { recursive: true, force: true });
});

check("plugin registers the package with its import (no unresolved add())", async () => {
  const { mods } = loadPlugin();
  const template = [
    "package com.erfanbagheri.streamifymobile",
    "class MainApplication : Application() {",
    "  override fun getPackages(): List<ReactPackage> {",
    "    return PackageList(this).packages.apply {",
    "    }",
    "  }",
    "}",
  ].join("\n");
  const out = mods.withMainApplication({ modResults: { contents: template } });
  assert.match(out.modResults.contents, /add\(StreamifyEqualizerPackage\(\)\)/);
  assert.ok(
    out.modResults.contents.includes(
      "import com.erfanbagheri.streamifymobile.StreamifyEqualizerPackage",
    ),
    "an add() with no import does not compile — stale test needs updating",
  );
  // Idempotent: a second prebuild pass must not double-register.
  const twice = mods.withMainApplication({ modResults: { contents: out.modResults.contents } });
  assert.equal(
    twice.modResults.contents.match(/add\(StreamifyEqualizerPackage\(\)\)/g).length,
    1,
  );
  assert.equal(
    twice.modResults.contents.match(
      /import com\.erfanbagheri\.streamifymobile\.StreamifyEqualizerPackage/g,
    ).length,
    1,
  );
});

check("plugin requests MODIFY_AUDIO_SETTINGS (AudioEffect init fails without it)", async () => {
  const { mods } = loadPlugin();
  assert.ok(mods.withAndroidManifest, "plugin must touch the manifest");
  const cfg = mods.withAndroidManifest({ modResults: { manifest: {} } });
  const names = (cfg.modResults.manifest["uses-permission"] || []).map(
    (entry) => entry.$?.["android:name"],
  );
  assert.ok(
    names.includes("android.permission.MODIFY_AUDIO_SETTINGS"),
    "AudioEffect init fails on device without this permission",
  );
});

check("native reports center frequencies in Hz, not milliHz", async () => {
  assert.ok(
    kt.includes("getCenterFreq(band.toShort()) / 1000"),
    "getCenterFreq returns milliHz; the UI would label bands 1000x high",
  );
});

check("unsupportedInfo honors the full EqualizerInfo contract", async () => {
  const body = kt.slice(kt.indexOf("private fun unsupportedInfo()"));
  const fn = body.slice(0, body.indexOf("  }"));
  assert.ok(
    fn.includes('putArray("centerFreqHz"'),
    "JS reads centerFreqHz unconditionally — the key must exist",
  );
  const { rn } = rnFake({ modules: {} });
  const onAndroid = { "react-native": { ...rn, Platform: { OS: "android" } } };
  const eq = loadModule("modules/audioEqualizer.ts", onAndroid);
  const info = await eq.getEqualizerInfo();
  assert.ok(
    Array.isArray(info.centerFreqHz),
    "the unsupported surface must carry centerFreqHz",
  );
});

check("plugin throws on a MainApplication template it cannot anchor to", async () => {
  const { mods } = loadPlugin();
  assert.throws(
    () => mods.withMainApplication({ modResults: { contents: "class MainApplication" } }),
    /MainApplication template changed/,
  );
});

check("native exposes exactly the methods the wrapper calls", async () => {
  const methods = [...kt.matchAll(/@ReactMethod\s*\n\s*fun\s+(\w+)/g)].map((m) => m[1]);
  for (const m of ["getInfo", "setBandLevel", "setEnabled"]) {
    assert.ok(methods.includes(m), `module must expose ${m}`);
  }
  assert.ok(!methods.includes("getBands"), "no dead method surface beyond the contract");
});

check("native attaches to the global session (no sessionId handoff)", async () => {
  assert.ok(
    /AudioEffect\s*\(\s*0\s*,\s*AudioEffect\.EFFECT_TYPE_EQUALIZER/.test(kt),
    "constructed with AudioEffect(0, EFFECT_TYPE_EQUALIZER, …)",
  );
});

check("native clamps band index and gain, reports init failure cleanly", async () => {
  // Exact statement forms: a bare `millibel.toInt()` or a release that does not
  // call through must not satisfy these.
  assert.ok(
    /val clamped = millibel\.toInt\(\)\.coerceIn\(range\.first, range\.second\)/.test(kt),
    "millibel clamped to the device range",
  );
  assert.ok(
    /val index = band\.toInt\(\)\.coerceIn\(0, bandCount\(eq\) - 1\)/.test(kt),
    "band index clamped to the device band count",
  );
  assert.ok(/STATE_INITIALIZED/.test(kt), "AudioEffect init state checked");
  assert.ok(/supported.*false/.test(kt), "unsupported state returned, not thrown");
});

check("native releases the effect on teardown", async () => {
  assert.ok(/override fun invalidate\(\)/.test(kt), "invalidate() override present");
  // The release must actually happen in the teardown path, not in a comment.
  assert.match(
    kt,
    /private fun release\(\) \{\s*try \{\s*effect\?\.release\(\)/,
    "release() calls AudioEffect.release on the held effect",
  );
});

check("package returns the module and plugin registers it via withMainApplication", async () => {
  assert.ok(pkg.includes("StreamifyEqualizerModule(reactContext)"), "package creates module");
  assert.ok(plugin.includes("withMainApplication"), "plugin touches MainApplication");
  assert.ok(
    plugin.includes("StreamifyEqualizerPackage()"),
    "plugin registers the package",
  );
  assert.ok(plugin.includes("withDangerousMod"), "plugin copies sources on prebuild");
  for (const f of ["StreamifyEqualizerModule.kt", "StreamifyEqualizerPackage.kt"]) {
    assert.ok(plugin.includes(f), `plugin copies ${f}`);
    assert.ok(fs.existsSync(path.join(root, "plugins/android", f)), `${f} present`);
  }
});

check("plugin has the missing-source guard", async () => {
  assert.match(plugin, /function assertSourcesPresent\(\)/, "guard is a named function");
  assert.ok(
    plugin.includes("cannot be prebuilt without it"),
    "guard fails loudly with an actionable message",
  );
});

check("app.json wires the plugin", async () => {
  const app = JSON.parse(read("app.json"));
  assert.ok(app.expo.plugins.includes("./plugins/withEqualizer"), "plugin listed");
});

check("settings toggle gates the native enable call", async () => {
  assert.ok(screen.includes("settings.equalizerEnabled"), "toggle bound to setting");
  assert.ok(screen.includes("setEqualizerEnabled(value)"), "toggle calls native");
  assert.ok(screen.includes("setEqualizerBandLevel(index, value)"), "sliders call native");
});

check("locale keys exist in en and fa (fa is real Persian)", async () => {
  const en = JSON.parse(read("locales/en.json")).settings;
  const fa = JSON.parse(read("locales/fa.json")).settings;
  for (const k of ["equalizer", "equalizerDescription", "equalizerUnsupported"]) {
    assert.ok(en[k], `en ${k}`);
    assert.ok(fa[k], `fa ${k}`);
  }
  assert.ok(/[؀-ۿ]/.test(fa.equalizer), "fa copy is Persian script");
});

// node:test exits non-zero when any check fails.
process.on("exit", (code) => {
  if (failures > 0 && code === 0) process.exitCode = 1;
});
