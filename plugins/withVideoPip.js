/**
 * Expo config plugin: Android picture-in-picture for music video (issue #27).
 *
 * The repo gitignores /android and CI runs `expo prebuild --clean`, so any
 * hand-written AndroidManifest.xml edit is wiped before every build. A config
 * plugin is the only durable way to ship manifest changes here.
 *
 * Only manifest edits are needed: react-native-video's PictureInPictureUtil
 * already calls `enterPictureInPictureMode(activity, params)` for us, so no
 * Kotlin module is required.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const MAIN_ACTIVITY = "MainActivity";

/** configChanges the PiP transition needs, plus everything the template set. */
const CONFIG_CHANGES = [
  "density",
  "keyboard",
  "keyboardHidden",
  "orientation",
  "screenLayout",
  "screenSize",
  "smallestScreenSize",
  "uiMode",
];

/** Guard: fail prebuild loudly rather than silently shipping PiP-less builds. */
function requireActivity(manifest) {
  const application = manifest.manifest.application?.[0];
  const activity = application?.activity?.find(
    (a) => String(a.$?.["android:name"] ?? "").endsWith(MAIN_ACTIVITY),
  );
  if (!activity) {
    throw new Error(
      "withVideoPip: MainActivity not found in AndroidManifest; " +
        "picture-in-picture cannot be enabled safely.",
    );
  }
  return activity;
}

const withVideoPip = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const activity = requireActivity(manifest);

    // 1. Picture-in-picture permission for the activity.
    activity.$["android:supportsPictureInPicture"] = "true";

    // 2. configChanges — without it Android restarts the activity on the PiP
    //    size/orientation transition and the video stalls.
    const declared = String(activity.$["android:configChanges"] ?? "");
    const merged = CONFIG_CHANGES.filter((flag) => flag !== "screenLayout")
      .filter((flag) => !declared.split("|").includes(flag))
      .join("|");
    // screenLayout only when screenLayout already there (folding devices);
    // otherwise keep the stock set so we never diverge from the template.
    activity.$["android:configChanges"] = declared
      ? [...declared.split("|").filter(Boolean), ...(merged ? merged.split("|") : [])].join("|")
      : CONFIG_CHANGES.join("|");

    return cfg;
  });

module.exports = withVideoPip;
