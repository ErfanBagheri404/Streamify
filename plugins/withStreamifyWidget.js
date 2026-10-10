// Expo config plugin: native Android home-screen player widget (issue #29).
//
// The repo gitignores /android and CI runs `expo prebuild --clean`, so any
// hand-written native file in the android/ tree is wiped before every build.
// A config plugin is the only durable way to ship native Android code here:
// it re-creates the sources, resources and manifest entries on every prebuild.
//
// Pure stdlib + @expo/config-plugins (already an Expo dependency). No new
// package.
const { withAppBuildGradle, withDangerousMod, withStringsXml, withMainApplication, withAndroidManifest } =
  require("@expo/config-plugins");

const fs = require("fs");
const path = require("path");

const PACKAGE = "com.erfanbagheri.streamifymobile";

/** Source of truth lives in this folder and is copied into the android tree. */
const NATIVE_DIR = path.join(__dirname, "android");
const RES_DIR = path.join(NATIVE_DIR, "res");

const KOTLIN_FILES = [
  "StreamifyWidgetStore.kt",
  "StreamifyWidgetActions.kt",
  "StreamifyWidgetProvider.kt",
  "StreamifyWidgetModule.kt",
  "StreamifyWidgetPackage.kt",
];

const RESOURCE_FILES = [
  "layout/widget_player_small.xml",
  "layout/widget_player_medium.xml",
  "layout/widget_player_large.xml",
  "xml/widget_player_info.xml",
  "drawable/widget_background.xml",
  "drawable/ic_widget_prev.xml",
  "drawable/ic_widget_play.xml",
  "drawable/ic_widget_pause.xml",
  "drawable/ic_widget_next.xml",
  "drawable/ic_music_note.xml",
  "values/widget_styles.xml",
];

const WIDGET_STRINGS = [
  ["widget_label", "Streamify player"],
  ["widget_description", "Control playback from your home screen"],
  ["widget_no_track", "Nothing playing"],
  ["widget_artwork_desc", "Album artwork"],
  ["widget_prev", "Previous track"],
  ["widget_play_pause", "Play or pause"],
  ["widget_next", "Next track"],
  ["widget_recent_playlists", "Recent playlists"],
  ["widget_empty_slot", "—"],
];

const TEST_DEPENDENCIES = [
  "testImplementation(\"junit:junit:4.13.2\")",
  "testImplementation(\"org.robolectric:robolectric:4.11.1\")",
  "testImplementation(\"androidx.test:core:1.5.0\")",
];

/** Guard against silently shipping a partial widget on prebuild failure. */
function assertSourcesPresent() {
  for (const file of [...KOTLIN_FILES, "StreamifyWidgetRenderTest.kt"]) {
    const full = path.join(NATIVE_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(
        `withStreamifyWidget: missing native source ${file}. The widget cannot be prebuilt without it.`,
      );
    }
  }
  for (const file of RESOURCE_FILES) {
    const full = path.join(RES_DIR, file);
    if (!fs.existsSync(full)) {
      throw new Error(
        `withStreamifyWidget: missing native resource res/${file}. The widget cannot be prebuilt without it.`,
      );
    }
  }
}

const withStreamifyWidget = (config) => {
  assertSourcesPresent();

  let androidRoot = null;

  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      androidRoot = cfg.modRequest.platformProjectRoot;
      const javaDir = path.join(androidRoot, "app/src/main/java", ...PACKAGE.split("."));
      const resDir = path.join(androidRoot, "app/src/main/res");
      fs.mkdirSync(javaDir, { recursive: true });

      for (const file of KOTLIN_FILES) {
        fs.copyFileSync(path.join(NATIVE_DIR, file), path.join(javaDir, file));
      }
      // Robolectric unit test for the widget store.
      const testDir = path.join(androidRoot, "app/src/test/java", ...PACKAGE.split("."));
      fs.mkdirSync(testDir, { recursive: true });
      fs.copyFileSync(
        path.join(NATIVE_DIR, "StreamifyWidgetRenderTest.kt"),
        path.join(testDir, "StreamifyWidgetRenderTest.kt"),
      );
      for (const file of RESOURCE_FILES) {
        const target = path.join(resDir, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(RES_DIR, file), target);
      }
      return cfg;
    },
  ]);

  // Manifest: register the provider + transport receiver.
  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application[0];
    application.$ = application.$ || {};
    // Remove any previous run's entries so prebuild stays idempotent.
    application.receiver = (application.receiver || []).filter(
      (r) => !String((r.$ || {})["android:name"] || "").startsWith(`.StreamifyWidget`),
    );
    application.receiver.push(
      {
        $: {
          "android:name": ".StreamifyWidgetProvider",
          "android:exported": "false",
          "android:label": "@string/widget_label",
        },
        "intent-filter": [
          {
            $: {},
            action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }],
          },
        ],
        "meta-data": [
          { $: { "android:name": "android.appwidget.provider", "android:resource": "@xml/widget_player_info" } },
        ],
      },
      { $: { "android:name": ".StreamifyWidgetActions", "android:exported": "false" } },
    );
    return cfg;
  });

  // Register the RN package that exposes the widget store to JS.
  // Anchored on the generated template line, not on a locally-added package:
  // CI prebuilds a vanilla android/ tree where LocalMediaPackage doesn't exist.
  config = withMainApplication(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes("StreamifyWidgetPackage()")) return cfg;
    const anchor = "PackageList(this).packages.apply {";
    if (!src.includes(anchor)) {
      throw new Error(
        "withStreamifyWidget: MainApplication template changed; cannot find getPackages anchor.",
      );
    }
    cfg.modResults.contents = src.replace(
      anchor,
      `${anchor}\n              add(StreamifyWidgetPackage())`,
    );
    return cfg;
  });

  // Widget strings, so labels survive a clean prebuild.
  config = withStringsXml(config, (cfg) => {
    for (const [name, value] of WIDGET_STRINGS) {
      const existing = cfg.modResults.resources.string.find((s) => s.$?.name === name);
      if (existing) existing.$.value = value;
      else {
        cfg.modResults.resources.string.push({ $: { name }, _: value });
      }
    }
    return cfg;
  });

  // Robolectric test deps for StreamifyWidgetRenderTest.
  // Anchored on react-android, which every RN template's build.gradle has.
  config = withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("org.robolectric:robolectric")) return cfg;
    const anchor = 'implementation("com.facebook.react:react-android")';
    if (!src.includes(anchor)) {
      throw new Error(
        "withStreamifyWidget: build.gradle template changed; cannot find dependencies anchor.",
      );
    }
    cfg.modResults.contents = src.replace(
      anchor,
      `${anchor}\n\n    ${TEST_DEPENDENCIES.join("\n    ")}`,
    );
    return cfg;
  });

  return config;
};

module.exports = withStreamifyWidget;
