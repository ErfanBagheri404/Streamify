"use client";

export type PreferredSearchSource =
  | "mixed"
  | "itunes"
  | "deezer"
  | "youtube"
  | "youtubemusic"
  | "soundcloud"
  | "jiosaavn";

export type AppTheme =
  | "default"
  | "ocean"
  | "amethyst"
  | "sunset"
  | "forest"
  | "rose"
  | "frost"
  | "midnight"
  | "ember"
  | "aurora"
  | "sapphire"
  | "violet"
  | "copper"
  | "graphite"
  | "lagoon"
  | "ruby"
  | "olive"
  | "starlight"
  | "dawn"
  | "mist"
  | "petal"
  | "meadow"
  | "daybreak"
  | "linen"
  | "sky"
  | "lavender"
  | "peach"
  | "mint"
  | "butter"
  | "sage"
  | "ice"
  | "sand"
  | "blush";

export type AppLanguage = "en" | "fa";

export type PlaybackRetryMode = "ask" | "always" | "never";

export type SettingsSectionKey =
  | "account"
  | "appearance"
  | "playback"
  | "discovery"
  | "lyrics"
  | "summary"
  | "updates"
  | "help";

/** Per-device max-SPL table for hearing-safety estimates.
 * `maxDbA` is the estimated output with the volume at full scale. */
export type HearingDeviceProfile = "unknown" | "phone" | "flagship" | "wired-earbuds" | "bt-headphones" | "bt-earbuds";

export interface HearingProfileEntry {
  id: HearingDeviceProfile;
  maxDbA: number;
}

export const HEARING_DEVICE_PROFILES: HearingProfileEntry[] = [
  { id: "unknown", maxDbA: 0 },
  { id: "phone", maxDbA: 100 },
  { id: "flagship", maxDbA: 103 },
  { id: "wired-earbuds", maxDbA: 102 },
  { id: "bt-headphones", maxDbA: 100 },
  { id: "bt-earbuds", maxDbA: 98 },
];

/** Limiter ceiling window (estimated dB(A)). WHO flags risk above 80 dB(A). */
export const HEARING_CEILING_RANGE = { min: 60, max: 100 } as const;
export const HEARING_CEILING_DEFAULT = 85;

/** Stepper choices offered in Settings; all inside HEARING_CEILING_RANGE. */
export const HEARING_CEILING_OPTIONS = [70, 80, 85, 90] as const;

/** Weekly safe-listening budget in dB-hours (WHO 80 dB(A) guidance). */
export const WHO_WEEKLY_BUDGET_DB_HOURS = 40;

export function isHearingDeviceProfile(
  value: unknown,
): value is HearingDeviceProfile {
  return HEARING_DEVICE_PROFILES.some((entry) => entry.id === value);
}

export interface AppSettings {
  autoplayRecommendations: boolean;
  openFullscreenOnPlay: boolean;
  lyricsEnabled: boolean;
  autoScrollLyrics: boolean;
  keyboardShortcuts: boolean;
  playbackRetryMode: PlaybackRetryMode;
  theme: AppTheme;
  language: AppLanguage;
  disableAnimations: boolean;
  rememberLastSearch: boolean;
  preferredSearchSource: PreferredSearchSource;
  seekStepSeconds: number;
  autoCacheLikedSongs: boolean;
  /** When true, local library changes auto-push to cloud and a full sync
   * runs when the app returns to foreground. Disable to sync manually only. */
  autoSyncLibrary: boolean;
  /** When true, playing a queued song auto-removes it from download queue.
   * When false, shows a confirmation popup first. */
  autoQueueConflictAutoRemove: boolean;
  /** When true, player controls give tactile feedback. */
  hapticsEnabled: boolean;
  /** Fade in/out at track boundaries instead of hard cuts. Off by default. */
  crossfadeEnabled: boolean;
  /** Fade window in seconds (clamped 1-12). */
  crossfadeSeconds: number;
  /** Show a waveform seek bar (local + fully-cached tracks, Android only). Off by default. */
  waveformSeekBar: boolean;
  /** Enable ReplayGain normalization on local/cached tracks. */
  replayGainEnabled: boolean;
  /** Clamp output with the native limiter so playback stays under a hearing-safe ceiling. Off by default. */
  hearingLimiterEnabled: boolean;
  /** Limiter ceiling in estimated dB(A), clamped to HEARING_CEILING_RANGE. */
  hearingCeiling: number;
  /** Device profile used to estimate SPL from the volume setting ("unknown" estimates nothing). */
  hearingDeviceProfile: HearingDeviceProfile;
  collapsedSettingsSections: Partial<Record<SettingsSectionKey, boolean>>;
}

export const APP_SETTINGS_STORAGE_KEY = "@app_settings";
export const LAST_SEARCH_STATE_KEY = "@last_search_state";

export const SEEK_STEP_OPTIONS = [5, 10, 15, 30] as const;

export const LIGHT_APP_THEMES = [
  "dawn",
  "mist",
  "petal",
  "meadow",
  "daybreak",
  "linen",
  "sky",
  "lavender",
  "peach",
  "mint",
  "butter",
  "sage",
  "ice",
  "sand",
  "blush",
] as const;

export const APP_THEME_OPTIONS: AppTheme[] = [
  "default",
  "ocean",
  "amethyst",
  "sunset",
  "forest",
  "rose",
  "frost",
  "midnight",
  "ember",
  "aurora",
  "sapphire",
  "violet",
  "copper",
  "graphite",
  "lagoon",
  "ruby",
  "olive",
  "starlight",
  "dawn",
  "mist",
  "petal",
  "meadow",
  "daybreak",
  "linen",
  "sky",
  "lavender",
  "peach",
  "mint",
  "butter",
  "sage",
  "ice",
  "sand",
  "blush",
];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoplayRecommendations: true,
  openFullscreenOnPlay: false,
  lyricsEnabled: true,
  autoScrollLyrics: true,
  keyboardShortcuts: true,
  playbackRetryMode: "ask",
  theme: "default",
  language: "en",
  disableAnimations: false,
  rememberLastSearch: true,
  preferredSearchSource: "mixed",
  seekStepSeconds: 10,
  autoCacheLikedSongs: false,
  autoSyncLibrary: true,
  autoQueueConflictAutoRemove: false,
  hapticsEnabled: true,
  crossfadeEnabled: false,
  crossfadeSeconds: 4,
  waveformSeekBar: false,
  replayGainEnabled: false,
  hearingLimiterEnabled: false,
  hearingCeiling: HEARING_CEILING_DEFAULT,
  hearingDeviceProfile: "unknown",
  collapsedSettingsSections: {},
};

function sanitizeCollapsedSettingsSections(
  value: unknown,
): Partial<Record<SettingsSectionKey, boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const allowedKeys: SettingsSectionKey[] = [
    "account",
    "appearance",
    "playback",
    "discovery",
    "lyrics",
    "summary",
    "updates",
    "help",
  ];
  const nextValue: Partial<Record<SettingsSectionKey, boolean>> = {};
  const record = value as Record<string, unknown>;

  allowedKeys.forEach((key) => {
    if (typeof record[key] === "boolean") {
      nextValue[key] = record[key] as boolean;
    }
  });

  return nextValue;
}

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "fa";
}

function isAppTheme(value: unknown): value is AppTheme {
  return (APP_THEME_OPTIONS as readonly AppTheme[]).includes(value as AppTheme);
}

function isPreferredSearchSource(
  value: unknown,
): value is PreferredSearchSource {
  return (
    value === "mixed" ||
    value === "itunes" ||
    value === "deezer" ||
    value === "youtube" ||
    value === "youtubemusic" ||
    value === "soundcloud" ||
    value === "jiosaavn"
  );
}

function isSeekStepSeconds(
  value: unknown,
): value is (typeof SEEK_STEP_OPTIONS)[number] {
  return (
    typeof value === "number" &&
    SEEK_STEP_OPTIONS.includes(value as (typeof SEEK_STEP_OPTIONS)[number])
  );
}

function isPlaybackRetryMode(value: unknown): value is PlaybackRetryMode {
  return value === "ask" || value === "always" || value === "never";
}

export function isLightAppTheme(theme: AppTheme): boolean {
  return (LIGHT_APP_THEMES as readonly AppTheme[]).includes(theme);
}

export function sanitizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_APP_SETTINGS;
  }

  const record = value as Partial<AppSettings>;

  return {
    autoplayRecommendations:
      typeof record.autoplayRecommendations === "boolean"
        ? record.autoplayRecommendations
        : DEFAULT_APP_SETTINGS.autoplayRecommendations,
    openFullscreenOnPlay:
      typeof record.openFullscreenOnPlay === "boolean"
        ? record.openFullscreenOnPlay
        : DEFAULT_APP_SETTINGS.openFullscreenOnPlay,
    lyricsEnabled:
      typeof record.lyricsEnabled === "boolean"
        ? record.lyricsEnabled
        : DEFAULT_APP_SETTINGS.lyricsEnabled,
    autoScrollLyrics:
      typeof record.autoScrollLyrics === "boolean"
        ? record.autoScrollLyrics
        : DEFAULT_APP_SETTINGS.autoScrollLyrics,
    keyboardShortcuts:
      typeof record.keyboardShortcuts === "boolean"
        ? record.keyboardShortcuts
        : DEFAULT_APP_SETTINGS.keyboardShortcuts,
    playbackRetryMode: isPlaybackRetryMode(record.playbackRetryMode)
      ? record.playbackRetryMode
      : DEFAULT_APP_SETTINGS.playbackRetryMode,
    theme: isAppTheme(record.theme) ? record.theme : DEFAULT_APP_SETTINGS.theme,
    language: isAppLanguage(record.language)
      ? record.language
      : DEFAULT_APP_SETTINGS.language,
    disableAnimations:
      typeof record.disableAnimations === "boolean"
        ? record.disableAnimations
        : DEFAULT_APP_SETTINGS.disableAnimations,
    rememberLastSearch:
      typeof record.rememberLastSearch === "boolean"
        ? record.rememberLastSearch
        : DEFAULT_APP_SETTINGS.rememberLastSearch,
    preferredSearchSource: isPreferredSearchSource(record.preferredSearchSource)
      ? record.preferredSearchSource
      : DEFAULT_APP_SETTINGS.preferredSearchSource,
    seekStepSeconds: isSeekStepSeconds(record.seekStepSeconds)
      ? record.seekStepSeconds
      : DEFAULT_APP_SETTINGS.seekStepSeconds,
    autoCacheLikedSongs:
      typeof record.autoCacheLikedSongs === "boolean"
        ? record.autoCacheLikedSongs
        : DEFAULT_APP_SETTINGS.autoCacheLikedSongs,
    autoSyncLibrary:
      typeof record.autoSyncLibrary === "boolean"
        ? record.autoSyncLibrary
        : DEFAULT_APP_SETTINGS.autoSyncLibrary,
    hapticsEnabled:
      typeof record.hapticsEnabled === "boolean"
        ? record.hapticsEnabled
        : DEFAULT_APP_SETTINGS.hapticsEnabled,
  autoQueueConflictAutoRemove:
      typeof record.autoQueueConflictAutoRemove === "boolean"
        ? record.autoQueueConflictAutoRemove
        : DEFAULT_APP_SETTINGS.autoQueueConflictAutoRemove,
    crossfadeEnabled:
      typeof record.crossfadeEnabled === "boolean"
        ? record.crossfadeEnabled
        : DEFAULT_APP_SETTINGS.crossfadeEnabled,
    crossfadeSeconds:
      typeof record.crossfadeSeconds === "number" &&
      Number.isFinite(record.crossfadeSeconds) &&
      record.crossfadeSeconds >= 1 &&
      record.crossfadeSeconds <= 12
        ? Math.round(record.crossfadeSeconds)
        : DEFAULT_APP_SETTINGS.crossfadeSeconds,
    replayGainEnabled:
      typeof record.replayGainEnabled === "boolean"
        ? record.replayGainEnabled
        : DEFAULT_APP_SETTINGS.replayGainEnabled,
    waveformSeekBar:
      typeof record.waveformSeekBar === "boolean"
        ? record.waveformSeekBar
        : DEFAULT_APP_SETTINGS.waveformSeekBar,
    hearingLimiterEnabled:
      typeof record.hearingLimiterEnabled === "boolean"
        ? record.hearingLimiterEnabled
        : DEFAULT_APP_SETTINGS.hearingLimiterEnabled,
    hearingCeiling:
      typeof record.hearingCeiling === "number" &&
      Number.isFinite(record.hearingCeiling) &&
      record.hearingCeiling >= HEARING_CEILING_RANGE.min &&
      record.hearingCeiling <= HEARING_CEILING_RANGE.max
        ? Math.round(record.hearingCeiling)
        : DEFAULT_APP_SETTINGS.hearingCeiling,
    hearingDeviceProfile: isHearingDeviceProfile(record.hearingDeviceProfile)
      ? record.hearingDeviceProfile
      : DEFAULT_APP_SETTINGS.hearingDeviceProfile,

    collapsedSettingsSections: sanitizeCollapsedSettingsSections(
      record.collapsedSettingsSections,
    ),
  };
}

export function getAppThemeLabel(theme: AppTheme): string {
  if (theme === "default") {
    return "Default";
  }

  return theme
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getPreferredSourceLabel(source: PreferredSearchSource): string {
  switch (source) {
    case "mixed":
      return "Mixed";
    case "itunes":
      return "iTunes";
    case "deezer":
      return "Deezer";
    case "youtube":
      return "YouTube";
    case "youtubemusic":
      return "YouTube Music";
    case "soundcloud":
      return "SoundCloud";
    case "jiosaavn":
      return "JioSaavn";
    default:
      return "Mixed";
  }
}
