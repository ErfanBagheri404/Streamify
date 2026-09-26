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
  const s = loadModule("lib/app-settings.ts", {});
  assert.equal(s.DEFAULT_APP_SETTINGS.equalizerEnabled, false);
  assert.equal(s.sanitizeAppSettings({}).equalizerEnabled, false);
  assert.equal(s.sanitizeAppSettings({ equalizerEnabled: true }).equalizerEnabled, true);
  assert.equal(s.sanitizeAppSettings({ equalizerEnabled: "yes" }).equalizerEnabled, false);
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

check("plugin registers the package in the withMainApplication output", async () => {
  const { mods } = loadPlugin();
  assert.ok(mods.withMainApplication, "plugin mods MainApplication");
  const template = [
    "class MainApplication : Application() {",
    "  override fun getPackages(): List<ReactPackage> {",
    "    return PackageList(this).packages.apply {",
    "    }",
    "  }",
    "}",
  ].join("\n");
  const out = mods.withMainApplication({ modResults: { contents: template } });
  assert.match(out.modResults.contents, /add\(StreamifyEqualizerPackage\(\)\)/);
  // Idempotent: a second prebuild pass must not double-register.
  const twice = mods.withMainApplication({ modResults: { contents: out.modResults.contents } });
  assert.equal(
    twice.modResults.contents.match(/add\(StreamifyEqualizerPackage\(\)\)/g).length,
    1,
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
