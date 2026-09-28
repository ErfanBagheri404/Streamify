// Expo config plugin: native Android hardware equalizer (issue #28).
//
// The repo gitignores /android and CI runs `expo prebuild --clean`, so any
// hand-written native file in the android/ tree is wiped before every build.
// A config plugin is the only durable way to ship native Android code here.
// Modelled on plugins/withStreamifyWidget.js (the issue #29 precedent).
//
// Pure stdlib + @expo/config-plugins (already an Expo dependency). No new
// package.
const { withDangerousMod, withMainApplication, withAndroidManifest } = require("@expo/config-plugins");

const fs = require("fs");
const path = require("path");

const PACKAGE = "com.erfanbagheri.streamifymobile";

/** Source of truth lives in this folder and is copied into the android tree. */
const NATIVE_DIR = path.join(__dirname, "android");

const KOTLIN_FILES = ["StreamifyEqualizerModule.kt", "StreamifyEqualizerPackage.kt"];

/** Guard against silently shipping the toggle with no effect behind it. */
function assertSourcesPresent() {
  for (const file of KOTLIN_FILES) {
    const full = path.join(NATIVE_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(
        `withEqualizer: missing native source ${file}. The equalizer cannot be prebuilt without it.`,
      );
    }
  }
}

const withEqualizer = (config) => {
  assertSourcesPresent();

  // MODIFY_AUDIO_SETTINGS is needed to attach the effect to the output mix;
  // without it AudioEffect init fails on device.
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    const has = manifest["uses-permission"].some(
      (entry) =>
        entry.$?.["android:name"] === "android.permission.MODIFY_AUDIO_SETTINGS",
    );
    if (!has) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.MODIFY_AUDIO_SETTINGS" },
      });
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const javaDir = path.join(androidRoot, "app/src/main/java", ...PACKAGE.split("."));
      fs.mkdirSync(javaDir, { recursive: true });
      for (const file of KOTLIN_FILES) {
        fs.copyFileSync(path.join(NATIVE_DIR, file), path.join(javaDir, file));
      }
      return cfg;
    },
  ]);

  // Register the RN package that exposes the equalizer to JS. Anchored on the
  // generated template line, not on a locally-added package: CI prebuilds a
  // vanilla android/ tree.
  config = withMainApplication(config, (cfg) => {
    const src = cfg.modResults.contents;
    const importLine = `import ${PACKAGE}.StreamifyEqualizerPackage`;
    if (!src.includes(importLine)) {
      const packageAnchor = `package ${PACKAGE}`;
      if (!src.includes(packageAnchor)) {
        throw new Error(
          "withEqualizer: MainApplication template changed; cannot find package anchor.",
        );
      }
      cfg.modResults.contents = cfg.modResults.contents.replace(
        packageAnchor,
        `${packageAnchor}\n${importLine}`,
      );
    }
    const updated = cfg.modResults.contents;
    if (updated.includes("StreamifyEqualizerPackage()")) return cfg;
    const anchor = "PackageList(this).packages.apply {";
    if (!updated.includes(anchor)) {
      throw new Error(
        "withEqualizer: MainApplication template changed; cannot find getPackages anchor.",
      );
    }
    cfg.modResults.contents = updated.replace(
      anchor,
      `${anchor}\n              add(StreamifyEqualizerPackage())`,
    );
    return cfg;
  });

  return config;
};

module.exports = withEqualizer;
