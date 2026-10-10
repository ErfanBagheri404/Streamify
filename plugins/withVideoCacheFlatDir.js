// Expo config plugin: keep react-native-video-cache resolvable after a clean
// prebuild.
//
// react-native-video-cache ships a local AAR
// (node_modules/react-native-video-cache/android/libs/com/danikula/videocache/2.7.1)
// and declares it as `implementation`, so :app inherits the dependency but
// not the repository that can resolve it. On a dirty (hand-edited) android/
// tree a flatDir block sat in app/build.gradle; `expo prebuild --clean`
// regenerates that file and drops it, so the release build fails with
// "Could not find :videocache-2.7.1:". Re-injecting it here makes a clean
// prebuild — which is what CI runs — build the same tree as local.
const { withAppBuildGradle } = require("@expo/config-plugins");

const VIDEOCACHE_AAR_DIR =
  "$rootDir/../node_modules/react-native-video-cache/android/libs/com/danikula/videocache/2.7.1";

const FLAT_DIR_BLOCK = `// Local AAR for react-native-video-cache (danikula videocache). The
// library declares it as \`implementation\`, so :app inherits the dependency
// without inheriting a repository that can resolve a flatDir artifact.
// Injected by plugins/withVideoCacheFlatDir.js; prebuild --clean would
// otherwise drop it.
repositories {
    flatDir {
        dirs "${VIDEOCACHE_AAR_DIR}"
    }
}
`;

const withVideoCacheFlatDir = (config) => {
  config = withAppBuildGradle(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes("com/danikula/videocache")) return cfg;
    const anchor = "android {";
    if (!src.includes(anchor)) {
      throw new Error(
        "withVideoCacheFlatDir: app/build.gradle template changed; cannot find android { anchor.",
      );
    }
    cfg.modResults.contents = src.replace(anchor, `${FLAT_DIR_BLOCK}\n${anchor}`);
    return cfg;
  });
  return config;
};

module.exports = withVideoCacheFlatDir;
