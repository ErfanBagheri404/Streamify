"use client";

export type PreferredSearchSource =
  | "mixed"
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
