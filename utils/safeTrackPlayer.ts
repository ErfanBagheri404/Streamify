import { NativeModules } from "react-native";

// ---------------------------------------------------------------------------
// 1.  Detect if the native module is linked -----------------------------------
// ---------------------------------------------------------------------------
const hasNativeModule = Boolean(
  (NativeModules as any).TrackPlayerModule ||
  (NativeModules as any).TrackPlayer,
);

// ---------------------------------------------------------------------------
// 2.  No-op / safe fallback implementations -----------------------------------
// ---------------------------------------------------------------------------
const noop = () => Promise.resolve();
const noopSync = () => undefined;

const safePlayer = {
  // Lifecycle
  setupPlayer: noop,
  destroy: noop,
  reset: noop,

  // Playback control
  play: noop,
  pause: noop,
  stop: noop,
  seekTo: noop,
  setVolume: noop,
  setRate: noop,

  // Queue management
  add: noop,
  remove: noop,
  skip: noop,
  skipToNext: noop,
  skipToPrevious: noop,
  removeUpcomingTracks: noop,
  setQueue: noop,
  updateMetadataForTrack: noop,
  clearNowPlayingMetadata: noopSync,
  updateNowPlayingMetadata: noopSync,

  // Getters (return safe defaults)
  getPosition: () => Promise.resolve(0),
  getDuration: () => Promise.resolve(0),
  getBufferedPosition: () => Promise.resolve(0),
  getPlaybackState: () => Promise.resolve({ state: "idle" }),
  getActiveTrack: () => Promise.resolve(null),
  getQueue: () => Promise.resolve([]),
  getCurrentTrack: () => Promise.resolve(null),
  getVolume: () => Promise.resolve(1),
  getRate: () => Promise.resolve(1),
  getPlayWhenReady: () => Promise.resolve(false),
  isServiceRunning: () => false,

  // Events (return an empty unsubscribe function)
  addEventListener: () => ({ remove: noopSync }) as any,

  // Registration (safe no-op)
  registerPlaybackService: noopSync,
} as const;

// ---------------------------------------------------------------------------
// 3.  Export either the real module or the safe stub ------------------------
// ---------------------------------------------------------------------------
export default hasNativeModule
  ? require("react-native-track-player").default
  : safePlayer;

// Also re-export the named exports so `import { Event, Capability } ...` keeps working
export const Event = hasNativeModule
  ? require("react-native-track-player").Event
  : ({} as any);

export const Capability = hasNativeModule
  ? require("react-native-track-player").Capability
  : ({} as any);

export const State = hasNativeModule
  ? require("react-native-track-player").State
  : ({} as any);

export const RepeatMode = hasNativeModule
  ? require("react-native-track-player").RepeatMode
  : ({} as any);

export const AppKilledPlaybackBehavior = hasNativeModule
  ? require("react-native-track-player").AppKilledPlaybackBehavior
  : ({} as any);

export const IOSCategory = hasNativeModule
  ? require("react-native-track-player").IOSCategory
  : ({} as any);

export const IOSCategoryMode = hasNativeModule
  ? require("react-native-track-player").IOSCategoryMode
  : ({} as any);

export const IOSCategoryOptions = hasNativeModule
  ? require("react-native-track-player").IOSCategoryOptions
  : ({} as any);

export const PitchAlgorithm = hasNativeModule
  ? require("react-native-track-player").PitchAlgorithm
  : ({} as any);
