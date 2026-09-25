/**
 * Artwork-driven theme regression suite.
 *
 * `modules/artworkTheme.ts` is pure colour math — no React, no native — so
 * it is transpiled and driven for real against extreme artwork. The
 * platform half (`artworkThemeService`, `artworkThemeBus`) and the wiring into
 * ThemeContext are contract-checked, because they cannot load under Node.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const scratchDir = process.env.TMPDIR || os.tmpdir();

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
}

function loadPureModule(rel) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const out = path.join(
    scratchDir,
    `artworktheme-${process.pid}-${rel.replace(/[\\/]/g, "_")}.cjs`,
  );
  fs.writeFileSync(out, js);
  const originalPaths = Module._nodeModulePaths;
  Module._nodeModulePaths = (from) => originalPaths.call(Module, root);
  try {
    return require(out);
  } finally {
    Module._nodeModulePaths = originalPaths;
    fs.unlinkSync(out);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const art = loadPureModule("modules/artworkTheme.ts");

const service = stripComments(read("modules/artworkThemeService.ts"));
const bus = stripComments(read("modules/artworkThemeBus.ts"));
const themeCtx = stripComments(read("contexts/ThemeContext.tsx"));
const bridge = stripComments(read("components/ArtworkThemeBridge.tsx"));
const settingsScreen = stripComments(read("components/screens/SettingsScreen.tsx"));
const app = stripComments(read("App.tsx"));

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
const parse = (hex) => art.hexToRgb(hex);

// Cover a range of real artwork shapes, including the two the issue calls out.
const COVERS = {
  "near-black": Array.from({ length: 16 }, () => ({ r: 12, g: 11, b: 14 })),
  "pure black": Array.from({ length: 16 }, () => BLACK),
  "pure white": Array.from({ length: 16 }, () => WHITE),
  "neon magenta": Array.from({ length: 16 }, () => ({ r: 255, g: 0, b: 255 })),
  "acid green": Array.from({ length: 16 }, () => ({ r: 57, g: 255, b: 20 })),
  "sunset": Array.from({ length: 16 }, (_, i) => ({
    r: 200 + i,
    g: 90,
    b: 40,
  })),
  grey: Array.from({ length: 16 }, () => ({ r: 128, g: 128, b: 128 })),
  // Dark cover with one bright logo in a corner: the case a plain average
  // turns to mud.
  "dark with one bright pixel": [
    ...Array.from({ length: 15 }, () => ({ r: 18, g: 18, b: 20 })),
    { r: 255, g: 60, b: 20 },
  ],
};

const runtimeChecks = [
  [
    "colour space conversions round-trip",
    () => {
      [
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
        { r: 30, g: 144, b: 255 },
        { r: 255, g: 0, b: 128 },
        { r: 90, g: 200, b: 45 },
      ].forEach((rgb) => {
        const { h, s, l } = art.rgbToHsl(rgb);
        const back = art.hslToRgb(h, s, l);
        // 1/255 rounding tolerance: HSL is a lossy trip.
        ["r", "g", "b"].forEach((k) => {
          assert.ok(
            Math.abs(back[k] - rgb[k]) <= 1,
            `${JSON.stringify(rgb)} -> ${JSON.stringify(back)}`,
          );
        });
      });
    },
  ],
  [
    "hex parsing handles 3- and 6-digit forms and rejects junk",
    () => {
      assert.deepStrictEqual(parse("#ffffff"), WHITE);
      assert.deepStrictEqual(parse("fff"), WHITE);
      assert.deepStrictEqual(parse("#1e90ff"), { r: 30, g: 144, b: 255 });
      assert.strictEqual(parse("nope"), null);
      assert.strictEqual(parse(""), null);
      assert.strictEqual(art.rgbToHex(WHITE), "#ffffff");
    },
  ],
  [
    "luminance and contrast match the known reference values",
    () => {
      assert.ok(Math.abs(art.relativeLuminance(WHITE) - 1) < 0.001);
      assert.ok(Math.abs(art.relativeLuminance(BLACK)) < 0.001);
      // Black on white is the canonical 21:1.
      const ratio = art.contrastRatio(WHITE, BLACK);
      assert.ok(ratio > 20.5 && ratio < 21.5, `got ${ratio}`);
    },
  ],
  [
    "a dominant hue beats a rare vivid pixel",
    () => {
      // 15 red pixels + 1 blue: red must win, or the theme jumps on noise.
      const pixels = [
        ...Array.from({ length: 15 }, () => ({ r: 200, g: 30, b: 30 })),
        { r: 0, b: 255, g: 0 },
      ];
      const result = art.extractDominantColor(pixels);
      assert.ok(result, "no dominant colour found");
      const { h } = art.rgbToHsl(result);
      assert.ok(
        h < 30 || h > 330,
        `expected the red family, got hue ${Math.round(h)}`,
      );
    },
  ],
  [
    "near-grey artwork still yields a colour",
    () => {
      const result = art.extractDominantColor(COVERS.grey);
      assert.ok(result, "grey cover produced nothing");
      const { s } = art.rgbToHsl(result);
      assert.ok(s < 0.2, `grey cover came back saturated: ${s}`);
    },
  ],
  [
    "an empty sample returns null rather than a colour",
    () => {
      assert.strictEqual(art.extractDominantColor([]), null);
    },
  ],
  [
    "a null sample falls back to the default accent",
    () => {
      const seed = art.deriveArtworkSeed(null, false);
      assert.strictEqual(seed.accent, "#1ed760");
      assert.strictEqual(seed.accentContrast, "#04110a");
    },
  ],
];

for (const [name, cover] of Object.entries(COVERS)) {
  for (const isLight of [false, true]) {
    runtimeChecks.push([
      `${name} artwork stays readable in a ${isLight ? "light" : "dark"} theme`,
      () => {
        const seed = art.deriveArtworkSeed(art.extractDominantColor(cover), isLight);
        const background = isLight ? WHITE : { r: 5, g: 5, b: 5 };
        const accent = parse(seed.accent);
        const ratio = art.contrastRatio(accent, background);
        assert.ok(
          ratio >= 3,
          `${name}/${isLight ? "light" : "dark"}: accent ${seed.accent} is only ${ratio.toFixed(2)}:1 on the background`,
        );
        const onAccent = art.contrastRatio(
          parse(seed.accentContrast),
          accent,
        );
        assert.ok(
          onAccent >= 3,
          `${name}/${isLight ? "light" : "dark"}: text on ${seed.accent} is only ${onAccent.toFixed(2)}:1`,
        );
      },
    ]);
  }
}

runtimeChecks.push([
  "extreme artwork never yields an unusable accent",
  () => {
    // The clamps: a pure-white or pure-black cover must not produce a white or
    // black accent, which is what made naive palettes unreadable.
    for (const cover of Object.values(COVERS)) {
      const seed = art.deriveArtworkSeed(art.extractDominantColor(cover), false);
      const { l } = art.rgbToHsl(parse(seed.accent));
      assert.ok(l > 0.2 && l < 0.95, `accent luminance out of range: ${l}`);
      const lightSeed = art.deriveArtworkSeed(art.extractDominantColor(cover), true);
      const lightL = art.rgbToHsl(parse(lightSeed.accent)).l;
      assert.ok(lightL > 0.1 && lightL < 0.8, `light accent luminance out of range: ${lightL}`);
    }
  },
]);

runtimeChecks.push([
  "the same artwork gives the same seed twice",
  () => {
    const cover = COVERS.sunset;
    const a = art.deriveArtworkSeed(art.extractDominantColor(cover), false);
    const b = art.deriveArtworkSeed(art.extractDominantColor(cover), false);
    assert.deepStrictEqual(a, b);
  },
]);

const wiringChecks = [
  [
    "no new dependency is introduced",
    () => {
      const pkg = JSON.parse(read("package.json"));
      // Everything the extractor needs was already declared.
      ["expo-image-manipulator", "expo-file-system", "upng-js"].forEach((dep) => {
        assert.ok(pkg.dependencies[dep], `${dep} is not a declared dependency`);
      });
      assert.ok(
        /from "upng-js"/.test(service),
        "the PNG decoder is not the declared one",
      );
    },
  ],
  [
    "remote artwork is resolved to a local file first",
    () => {
      // expo-image-manipulator only reads local files; handing it a URL
      // throws, so the download step is load-bearing.
      assert.ok(
        /async function ensureLocalFile/.test(service),
        "no remote-to-local resolution step",
      );
      assert.ok(
        /FileSystem\.downloadAsync\(uri, target/.test(service),
        "remote artwork is never downloaded",
      );
      assert.ok(
        /uri\.startsWith\("file:\/\/"\)/.test(service),
        "local files are not short-circuited",
      );
    },
  ],
  [
    "extraction never throws into playback",
    () => {
      assert.ok(/catch \(error\)/.test(service), "no error boundary");
      assert.ok(
        /return null;/.test(service.slice(service.indexOf("catch (error)"))),
        "a failed extraction does not return null",
      );
    },
  ],
  [
    "the theme falls back to the selected palette",
    () => {
      assert.ok(
        /settings\.useArtworkTheme && artwork\.seed \? artwork\.seed : null/.test(
          themeCtx,
        ),
        "the artwork seed is used without the toggle or without a sample",
      );
      assert.ok(
        /const seed: ThemeSeed = artworkSeed\s*\?\s*\{[\s\S]*accent: artworkSeed\.accent/.test(
          themeCtx,
        ),
        "the artwork seed does not replace the accent pair",
      );
      assert.ok(
        /const baseSeed = THEME_SEEDS\[themeName\]/.test(themeCtx),
        "the palette is no longer the base",
      );
    },
  ],
  [
    "the surface tint is bounded and never touches the foreground",
    () => {
      const override = themeCtx.slice(
        themeCtx.indexOf("const seed: ThemeSeed"),
        themeCtx.indexOf("const value = useMemo<ThemeContextValue>"),
      );
      // The tint is what makes the whole UI read as the album, but it has to
      // stay small: a large mix drags the surface toward the accent and the
      // text on top of it loses contrast.
      const tint = themeCtx.match(/const tint = isLightAppTheme\(themeName\) \? ([\d.]+) : ([\d.]+)/);
      assert.ok(tint, "no surface tint is applied at all");
      assert.ok(Number(tint[1]) <= 0.1, `light tint too strong: ${tint[1]}`);
      assert.ok(Number(tint[2]) <= 0.1, `dark tint too strong: ${tint[2]}`);
      assert.ok(!/foreground:/.test(override), "foreground is tinted");
    },
  ],
  [
    "the tinted surface keeps every accent readable",
    () => {
      // Same tint the provider applies (RGB-space mix), applied to the extreme
      // artwork accents this suite already derives.
      const mix = (from, to, ratio) => ({
        r: Math.round(from.r + (to.r - from.r) * ratio),
        g: Math.round(from.g + (to.g - from.g) * ratio),
        b: Math.round(from.b + (to.b - from.b) * ratio),
      });
      for (const cover of Object.values(COVERS)) {
        for (const isLight of [false, true]) {
          const seed = art.deriveArtworkSeed(art.extractDominantColor(cover), isLight);
          const base = isLight ? WHITE : { r: 5, g: 5, b: 5 };
          const tinted = mix(base, parse(seed.accent), isLight ? 0.08 : 0.06);
          const ratio = art.contrastRatio(parse(seed.accent), tinted);
          assert.ok(
            ratio >= 3,
            `${isLight ? "light" : "dark"} tinted surface: ${seed.accent} only ${ratio.toFixed(2)}:1`,
          );
          const onSurface = art.contrastRatio(
            isLight ? { r: 16, g: 16, b: 16 } : WHITE,
            tinted,
          );
          assert.ok(
            onSurface >= 4.5,
            `${isLight ? "light" : "dark"} body text on tinted surface only ${onSurface.toFixed(2)}:1`,
          );
        }
      }
    },
  ],
  [
    "the bridge is mounted under the player",
    () => {
      assert.ok(/<ArtworkThemeBridge \/>/.test(app), "the bridge is not mounted");
      const i = app.indexOf("<ArtworkThemeBridge />");
      assert.ok(
        i > app.indexOf("<PlayerProvider>"),
        "the bridge must sit under PlayerProvider to call usePlayer",
      );
    },
  ],
  [
    "the toggle reaches both languages",
    () => {
      ["en", "fa"].forEach((lang) => {
        const data = JSON.parse(read(`locales/${lang}.json`));
        assert.ok(data.settings.useArtworkTheme, `${lang} lost the label`);
        assert.ok(
          data.settings.useArtworkThemeDescription,
          `${lang} lost the description`,
        );
      });
      assert.ok(
        /t\("settings\.useArtworkTheme"\)/.test(settingsScreen),
        "no toggle in settings",
      );
      assert.ok(
        /updateSettings\(\{ useArtworkTheme: value \}\)/.test(settingsScreen),
        "the toggle does not persist",
      );
    },
  ],
  [
    "a stale sample cannot be published after a track change",
    () => {
      assert.ok(/let cancelled = false/.test(bridge), "no cancellation guard");
      assert.ok(
        /if \(cancelled\) \{\s*return;\s*\}/.test(bridge),
        "an in-flight sample is published after cancellation",
      );
    },
  ],
  [
    "the pure module stays free of native imports",
    () => {
      const pure = stripComments(read("modules/artworkTheme.ts"));
      [
        "expo-image-manipulator",
        "expo-file-system",
        "upng-js",
        "react-native",
        "react",
      ].forEach((dep) => {
        assert.ok(
          !pure.includes(dep),
          `artworkTheme.ts imports ${dep}, so it cannot be unit-tested`,
        );
      });
    },
  ],
  [
    "the bus is one-way",
    () => {
      // ThemeContext must read the bus, never the player: the player is below
      // it in the tree and subscribing would be a cycle.
      assert.ok(
        /readArtworkTheme|subscribeToArtworkTheme/.test(themeCtx),
        "ThemeContext does not read the bus",
      );
      assert.ok(
        !/usePlayer/.test(themeCtx),
        "ThemeContext subscribes to the player, which sits below it",
      );
      assert.ok(/DeviceEventEmitter/.test(bus), "the bus is not an emitter");
    },
  ],
];

async function run() {
  for (const [name, fn] of runtimeChecks) {
    await check(name, fn);
  }
  for (const [name, fn] of wiringChecks) {
    await check(name, fn);
  }
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

run();
