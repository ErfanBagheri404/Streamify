// Expo config plugin: USB DAC / hi-res output mode (issue #42).
//
// The repo gitignores /android and CI runs `expo prebuild --clean`, so any
// hand-written native file in the android/ tree is wiped before every build.
// A config plugin is the only durable way to ship native Android code here.
// Modelled on plugins/withEqualizer.js (issue #28 precedent).
//
// Pure stdlib + @expo/config-plugins (already an Expo dependency). No new
// package.
const {
  withDangerousMod,
  withMainApplication,
  withAndroidManifest,
} = require("@expo/config-plugins");

const fs = require("fs");
const path = require("path");

const PACKAGE = "com.erfanbagheri.streamifymobile";

/** Source of truth lives in this folder and is copied into the android tree. */
const NATIVE_DIR = path.join(__dirname, "android");

const KOTLIN_FILES = ["StreamifyUsbAudioModule.kt", "StreamifyUsbAudioPackage.kt"];

/** Guard against silently shipping the toggle with no effect behind it. */
function assertSourcesPresent() {
  for (const file of KOTLIN_FILES) {
    const full = path.join(NATIVE_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(
        `withUsbDac: missing native source ${file}. The USB DAC mode cannot be prebuilt without it.`,
      );
    }
  }
}

const withUsbDac = (config) => {
  assertSourcesPresent();

  // The native module reports the output path and sample rate, so the app
  // needs no permission of its own. The USB permission belongs to the USB
  // host side and is declared by the module's manifest merge, not here.
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const permissions = manifest.$ || {};
    permissions["android:usesCleartextTraffic"] = "true";
    // A DAC is an audio-class USB device; without this the app is filtered
    // out of the USB host list on Android 12+.
    permissions["android:hardware.usb.host"] = "true";
    manifest.$ = permissions;
    return cfg;
  });

  // Copy the Kotlin sources into the android tree, then register the package.
  // One mod does both: the copy must land before MainApplication is read.
  config = withDangerousMod(config, ["android", async (cfg) => {
    const targetDir = path.join(
      cfg.modRequest.platformProjectRoot,
      "app/src/main/java/com/erfanbagheri/streamifymobile",
    );
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of KOTLIN_FILES) {
      fs.copyFileSync(path.join(NATIVE_DIR, file), path.join(targetDir, file));
    }
    return withKotlinRegistration(cfg, PACKAGE);
  }]);

  return config;
};

/** Add our package to the generated MainApplication's package list. */
function withKotlinRegistration(cfg, androidPackage) {
  const pathKotlin = `package ${androidPackage}`;
  const filePath = path.join(
    cfg.modRequest.platformProjectRoot,
    "app/src/main/java/com/erfanbagheri/streamifymobile/MainApplication.kt",
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(
      "withUsbDac: MainApplication.kt not found. Cannot register the USB audio package.",
    );
  }
  let contents = fs.readFileSync(filePath, "utf8");
  if (!contents.includes(pathKotlin)) {
    throw new Error(
      `withUsbDac: unexpected MainApplication package (expected ${pathKotlin}).`,
    );
  }
  if (contents.includes("StreamifyUsbAudioPackage()")) {
    return cfg;
  }
  // StreamifyUsbAudioPackage is copied next to MainApplication, so no import
  // is needed — same package.
  contents = contents.replace(
    /addPackage\((?:\r?\n\s*)[A-Za-z0-9_.]+\(\)\)/,
    (match) => `${match}\n        addPackage(StreamifyUsbAudioPackage())`,
  );
  if (!contents.includes("addPackage(StreamifyUsbAudioPackage())")) {
    // No addPackage call matched (new RN template): append the import + call
    // to the packages block so the module is still registered.
    contents = contents.replace(
      /(PackageList\(this\)\.packages\s*\n)(\s*)(\.apply\s*\{)/,
      "$1$2$3\n$2  addPackage(StreamifyUsbAudioPackage())\n$2",
    );
  }
  fs.writeFileSync(filePath, contents);
  return cfg;
}

module.exports = withUsbDac;
