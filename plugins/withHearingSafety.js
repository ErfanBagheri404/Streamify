// Expo config plugin: native Android hearing-safety limiter (issue #48).
//
// The repo gitignores /android and CI runs `expo prebuild --clean`, so any
// hand-written native file in the android/ tree is wiped before every build.
// A config plugin is the only durable way to ship native Android code here.
// Self-contained: does not depend on any other plugin branch.
//
// Pure stdlib + @expo/config-plugins (already an Expo dependency). No new
// package.
const { withDangerousMod, withMainApplication } = require("@expo/config-plugins");

const fs = require("fs");
const path = require("path");

const PACKAGE = "com.erfanbagheri.streamifymobile";

/** Source of truth lives in this folder and is copied into the android tree. */
const NATIVE_DIR = path.join(__dirname, "android");

const KOTLIN_FILES = [
  "StreamifyHearingLimitModule.kt",
  "StreamifyHearingLimitPackage.kt",
];

/** Guard against silently shipping the toggle with no effect behind it. */
function assertSourcesPresent() {
  for (const file of KOTLIN_FILES) {
    const full = path.join(NATIVE_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(
        `withHearingSafety: missing native source ${file}. The hearing limiter cannot be prebuilt without it.`,
      );
    }
  }
}

const withHearingSafety = (config) => {
  assertSourcesPresent();

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

  // Register the RN package that exposes the limiter to JS. Anchored on the
  // generated template line, not on a locally-added package: CI prebuilds a
  // vanilla android/ tree.
  config = withMainApplication(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes("StreamifyHearingLimitPackage()")) return cfg;
    const anchor = "PackageList(this).packages.apply {";
    if (!src.includes(anchor)) {
      throw new Error(
        "withHearingSafety: MainApplication template changed; cannot find getPackages anchor.",
      );
    }
    cfg.modResults.contents = src.replace(
      anchor,
      `${anchor}\n              add(StreamifyHearingLimitPackage())`,
    );
    return cfg;
  });

  return config;
};

module.exports = withHearingSafety;
