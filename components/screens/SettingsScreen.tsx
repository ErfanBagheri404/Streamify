import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  APP_THEME_OPTIONS,
  SEEK_STEP_OPTIONS,
  type AppLanguage,
  type AppTheme,
  type PlaybackRetryMode,
  type PreferredSearchSource,
  isLightAppTheme,
} from "../../lib/app-settings";
import { Screen } from "../ui/Screen";
import { ScrobbleSheet } from "../ScrobbleSheet";
import { SubsonicSheet } from "../SubsonicSheet";
import { BodyText, MutedText, TitleText } from "../ui/Text";
import { AccentButton } from "../ui/Button";
import { SettingsSwitch } from "../ui/SettingsSwitch";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import {
  CURRENT_APP_VERSION,
  useAppUpdate,
} from "../../contexts/AppUpdateContext";
import { useAppSettings } from "../../hooks/useAppSettings";
import { useAuth } from "../../hooks/useAuth";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import {
  CommunityModal,
  useCommunityModalAutoShow,
} from "../ui/CommunityModal";
import {
  buildCurrentLocalLibrarySyncSource,
  pushCloudLibrarySnapshot,
} from "../../lib/cloud-library-sync";
import {
  QUALITY_CAP_OPTIONS,
  QUALITY_MODE_OPTIONS,
  refreshNetworkKind,
  type QualityCap,
  type QualityMode,
} from "../../modules/audioQualityPolicy";
import {
  formatBytes,
  getMonthlyUsage,
  resetMonthlyUsage,
  type MonthlyUsage,
} from "../../modules/dataUsageStore";

const SEARCH_SOURCES: PreferredSearchSource[] = [
  "mixed",
  "itunes",
  "deezer",
  "youtube",
  "youtubemusic",
  "soundcloud",
  "jiosaavn",
];

const RETRY_MODES: PlaybackRetryMode[] = ["ask", "always", "never"];

const THEME_PREVIEW_ACCENTS: Record<AppTheme, string> = {
  default: "#1ed760",
  ocean: "#5cc8ff",
  amethyst: "#c084fc",
  sunset: "#ff9153",
  forest: "#4ade80",
  rose: "#fb7185",
  frost: "#67e8f9",
  midnight: "#818cf8",
  ember: "#fb923c",
  aurora: "#2dd4bf",
  sapphire: "#60a5fa",
  violet: "#d8b4fe",
  copper: "#d97757",
  graphite: "#94a3b8",
  lagoon: "#22d3ee",
  ruby: "#f43f5e",
  olive: "#a3e635",
  starlight: "#a5b4fc",
  dawn: "#ff8a5b",
  mist: "#4f87ff",
  petal: "#f06292",
  meadow: "#2fbf71",
  daybreak: "#8b5cf6",
  linen: "#c08457",
  sky: "#0ea5e9",
  lavender: "#a78bfa",
  peach: "#fb923c",
  mint: "#10b981",
  butter: "#f59e0b",
  sage: "#22c55e",
  ice: "#06b6d4",
  sand: "#d97706",
  blush: "#f43f5e",
};

function getUserDisplayName(
  user: { email?: string | null; user_metadata?: any } | null,
) {
  if (!user) {
    return "";
  }

  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.user_metadata?.preferred_username ||
    user.email ||
    ""
  );
}

function getUserAvatarUrl(user: { user_metadata?: any } | null) {
  if (!user) {
    return "";
  }

  return (
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    user.user_metadata?.image ||
    ""
  );
}

function getUserAccountLabel(
  user: {
    app_metadata?: any;
    identities?: Array<{ provider?: string | null } | null>;
  } | null,
  t: (key: string) => string,
) {
  const providers = new Set<string>();
  const primaryProvider = user?.app_metadata?.provider;

  if (typeof primaryProvider === "string" && primaryProvider.trim()) {
    providers.add(primaryProvider.toLowerCase());
  }

  if (Array.isArray(user?.identities)) {
    user?.identities.forEach((identity) => {
      if (typeof identity?.provider === "string" && identity.provider.trim()) {
        providers.add(identity.provider.toLowerCase());
      }
    });
  }

  if (providers.has("google")) {
    return t("settings.googleAccount");
  }

  if (providers.has("email")) {
    return t("settings.emailAccount");
  }

  return t("settings.accountGuest");
}

/** Flat content group within the selected settings category. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderStatic}>
        <TitleText accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </TitleText>
        <MutedText style={styles.sectionDescription}>{description}</MutedText>
      </View>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

type SettingsTabKey =
  | "account"
  | "playback"
  | "appearance"
  | "library"
  | "about";

const SETTINGS_TABS: Array<{
  key: SettingsTabKey;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}> = [
  {
    key: "account",
    icon: "person-circle-outline",
    labelKey: "settings.tabAccount",
  },
  {
    key: "playback",
    icon: "play-circle-outline",
    labelKey: "settings.tabPlayback",
  },
  {
    key: "appearance",
    icon: "color-palette-outline",
    labelKey: "settings.tabAppearance",
  },
  { key: "library", icon: "library-outline", labelKey: "settings.tabLibrary" },
  {
    key: "about",
    icon: "information-circle-outline",
    labelKey: "settings.tabAbout",
  },
];

function SettingRow({
  label,
  description,
  control,
  colors,
  controlPlacement = "stacked",
}: {
  label: string;
  description: string;
  control: ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
  controlPlacement?: "stacked" | "inline";
}) {
  const isInline = controlPlacement === "inline";

  return (
    <View
      style={[
        styles.settingRow,
        isInline && styles.settingRowInline,
        {
          borderBottomColor: colors.borderSubtle,
        },
      ]}
    >
      <View style={[styles.settingCopy, isInline && styles.settingCopyInline]}>
        <BodyText style={styles.settingLabel}>{label}</BodyText>
        <MutedText style={styles.settingDescription}>{description}</MutedText>
      </View>
      <View
        style={[styles.settingControl, isInline && styles.settingControlInline]}
      >
        {control}
      </View>
    </View>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.accent : colors.background,
          borderColor: selected ? colors.accent : colors.borderSubtle,
        },
      ]}
    >
      <BodyText
        style={[
          styles.chipText,
          { color: selected ? colors.accentContrast : colors.foreground },
        ]}
      >
        {label}
      </BodyText>
    </TouchableOpacity>
  );
}

function ThemeChoiceCard({
  theme,
  selected,
  label,
  colors,
  onPress,
}: {
  theme: AppTheme;
  selected: boolean;
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={[
        styles.themeCard,
        {
          backgroundColor: selected ? colors.surface2 : colors.background,
          borderColor: selected ? colors.accent : colors.borderSubtle,
        },
      ]}
    >
      <View style={styles.themePreviewRow}>
        <View
          style={[
            styles.previewDot,
            {
              backgroundColor: isLightAppTheme(theme) ? "#ffffff" : "#121212",
              borderColor: colors.borderSubtle,
            },
          ]}
        />
        <View
          style={[
            styles.previewDot,
            {
              backgroundColor: THEME_PREVIEW_ACCENTS[theme],
              borderColor: colors.borderSubtle,
            },
          ]}
        />
        <View
          style={[
            styles.previewDot,
            {
              backgroundColor: colors.surface1,
              borderColor: colors.borderSubtle,
            },
          ]}
        />
      </View>
      <BodyText style={styles.themeLabel}>{label}</BodyText>
      {selected ? (
        <View
          style={[
            styles.themeSelectedBadge,
            { backgroundColor: colors.accent },
          ]}
        >
          <Ionicons name="checkmark" size={12} color={colors.accentContrast} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function SettingsScreen({
  navigation,
}: {
  navigation: any;
  route: any;
}) {
  const { colors, isLight } = useTheme();
  const { t } = useAppLanguage();
  const { settings, updateSettings, hasHydratedSettings } = useAppSettings();
  const { availableUpdateInfo, isCheckingForUpdates, reopenUpdateModal } =
    useAppUpdate();
  const { user, isLoading: isAuthLoading, isConfigured, signOut } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    tone: "error" | "success" | "info";
    message: string;
  } | null>(null);
  const [updateFeedback, setUpdateFeedback] = useState<{
    tone: "error" | "success" | "info";
    message: string;
  } | null>(null);
  const [showScrobbleSheet, setShowScrobbleSheet] = useState(false);
  const [showSubsonicSheet, setShowSubsonicSheet] = useState(false);
  const [scrobbleProvider, setScrobbleProvider] = useState<
    "listenbrainz" | "lastfm"
  >("listenbrainz");
  const [monthlyDataUsage, setMonthlyDataUsage] =
    useState<MonthlyUsage | null>(null);

  // #35: the policy itself is pushed by App's NetworkQualityBridge for the
  // app's lifetime; the settings screen only refreshes the network snapshot
  // so the gauge is current when the row renders.
  useEffect(() => {
    let cancelled = false;
    void refreshNetworkKind().finally(() => {
      if (!cancelled) {
        void getMonthlyUsage().then((usage) => {
          if (!cancelled) setMonthlyDataUsage(usage);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAudioQuality = useCallback(
    (mode: QualityMode) => updateSettings({ audioQualityMode: mode }),
    [updateSettings],
  );

  const updateAudioQualityCap = useCallback(
    (cap: QualityCap | null) => updateSettings({ cellularCapKbps: cap }),
    [updateSettings],
  );

  const resetUsage = useCallback(async () => {
    await resetMonthlyUsage();
    setMonthlyDataUsage(await getMonthlyUsage());
  }, []);

  const { autoVisible: communityAutoVisible, closeAuto: closeCommunityAuto } =
    useCommunityModalAutoShow();
  const [isCommunityOpenedManually, setIsCommunityOpenedManually] =
    useState(false);
  const isCommunityVisible = communityAutoVisible || isCommunityOpenedManually;
  const closeCommunity = () => {
    closeCommunityAuto();
    setIsCommunityOpenedManually(false);
  };

  const accountName = getUserDisplayName(user) || t("settings.accountGuest");
  const accountAvatarUrl = getUserAvatarUrl(user);
  const accountProviderLabel = getUserAccountLabel(user, t);
  const cloudSyncUnavailableMessage = t("settings.cloudSyncUnavailable");
  const getLocalizedSyncFeedback = (error: unknown) => {
    const rawMessage = error instanceof Error ? error.message.trim() : "";
    const normalizedMessage = rawMessage.toLowerCase();

    if (
      rawMessage ===
        "Cloud sync is unavailable until Supabase environment variables are configured." ||
      normalizedMessage.includes("supabase environment variables")
    ) {
      return t("settings.cloudSyncUnavailable");
    }

    if (
      rawMessage === "Sign in to sync your library." ||
      normalizedMessage.includes("sign in to sync")
    ) {
      return t("settings.syncSignInRequired");
    }

    return rawMessage || t("settings.syncFailed");
  };

  const sourceLabels: Record<PreferredSearchSource, string> = useMemo(
    () => ({
      mixed: t("search.all"),
      itunes: t("source.itunes"),
      deezer: t("source.deezer"),
      youtube: t("source.youtube"),
      youtubemusic: t("source.youtubemusic"),
      soundcloud: t("source.soundcloud"),
      jiosaavn: t("source.jiosaavn"),
    }),
    [t],
  );

  const retryLabels: Record<PlaybackRetryMode, string> = useMemo(
    () => ({
      ask: t("settings.askMe"),
      always: t("settings.alwaysRetry"),
      never: t("settings.neverRetry"),
    }),
    [t],
  );

  const qualityModeLabels: Record<QualityMode, string> = useMemo(
    () => ({
      alwaysBest: t("settings.alwaysBest"),
      networkAware: t("settings.networkAware"),
      alwaysLow: t("settings.alwaysLow"),
    }),
    [t],
  );

  const themeLabels: Record<AppTheme, string> = useMemo(
    () =>
      APP_THEME_OPTIONS.reduce(
        (acc, theme) => {
          acc[theme] = t(`theme.${theme}`);
          return acc;
        },
        {} as Record<AppTheme, string>,
      ),
    [t],
  );

  const updateDescription = availableUpdateInfo
    ? t("settings.updateReadyDescription", {
        currentVersion: CURRENT_APP_VERSION,
        version: availableUpdateInfo.version,
      })
    : t("settings.checkForUpdatesDescription", {
        currentVersion: CURRENT_APP_VERSION,
      });

  const handleCheckForUpdates = async () => {
    setUpdateFeedback(null);
    const result = await reopenUpdateModal();

    if (result.status === "up_to_date") {
      setUpdateFeedback({
        tone: "info",
        message: t("settings.updateCurrent", {
          version: CURRENT_APP_VERSION,
        }),
      });
      return;
    }

    if (result.status === "error") {
      setUpdateFeedback({
        tone: "error",
        message: t("settings.updateCheckFailed"),
      });
    }
  };

  const handleSyncLibrary = async () => {
    if (!isConfigured) {
      setSyncFeedback({
        tone: "error",
        message: cloudSyncUnavailableMessage,
      });
      return;
    }

    if (!user) {
      setSyncFeedback({
        tone: "error",
        message: t("settings.syncSignInRequired"),
      });
      return;
    }

    const { playlists, likedSongs, snapshot } =
      await buildCurrentLocalLibrarySyncSource();

    if (playlists.length === 0 && likedSongs.length === 0) {
      setSyncFeedback({
        tone: "error",
        message: t("settings.syncEmpty"),
      });
      return;
    }

    setIsSyncing(true);
    setSyncFeedback({
      tone: "info",
      message: t("settings.syncInProgress"),
    });

    try {
      const result = await pushCloudLibrarySnapshot(snapshot);
      setSyncFeedback({
        tone: "success",
        message: t("settings.syncSuccess", {
          playlists: result.syncedPlaylists ?? 0,
          likes: result.syncedLikes ?? 0,
        }),
      });
    } catch (error) {
      setSyncFeedback({
        tone: "error",
        message: getLocalizedSyncFeedback(error),
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // ---- Category tabs (settings rework) ----
  // Remember last selected tab; default to Account on first launch.
  const [activeTab, setActiveTab] = useState<SettingsTabKey>("account");
  const SETTINGS_TAB_KEY = "settings_active_tab";

  useEffect(() => {
    if (!hasHydratedSettings) return;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_TAB_KEY);
        if (raw && ["account", "playback", "appearance", "library", "about"].includes(raw)) {
          setActiveTab(raw as SettingsTabKey);
        }
      } catch {
        // ignore — default to account
      }
    })();
  }, [hasHydratedSettings]);

  const selectTab = useCallback((tab: SettingsTabKey) => {
    setActiveTab(tab);
    void AsyncStorage.setItem(SETTINGS_TAB_KEY, tab).catch(() => {});
  }, []);

  if (!hasHydratedSettings) {
    return (
      <Screen padded={false}>
        <View
          style={[styles.loadingScreen, { backgroundColor: colors.background }]}
        >
          <ActivityIndicator size="large" color={colors.accent} />
          <MutedText>{t("screens.loading.loading")}</MutedText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.background,
              borderBottomColor: colors.borderSubtle,
              flexDirection: "row",
            },
          ]}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
          >
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <TitleText accessibilityRole="header" style={styles.headerTitle}>
              {t("settings.title")}
            </TitleText>
          </View>
        </View>

        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: colors.background,
              borderBottomColor: colors.borderSubtle,
            },
          ]}
        >
          {SETTINGS_TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => selectTab(tab.key)}
                activeOpacity={0.75}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t(tab.labelKey)}
                style={[
                  styles.tabItem,
                  {
                    borderBottomColor: active ? colors.accent : "transparent",
                  },
                ]}
              >
                <Ionicons
                  name={tab.icon}
                  size={20}
                  color={active ? colors.foreground : colors.muted}
                />
                <BodyText
                  style={[
                    styles.tabLabel,
                    {
                      color: active ? colors.foreground : colors.muted,
                      fontWeight: active ? "700" : "500",
                    },
                  ]}
                >
                  {t(tab.labelKey)}
                </BodyText>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {activeTab === "account" ? (
            <Section
              title={t("settings.account")}
              description={t("settings.accountDescription")}
            >
              <View
                style={[
                  styles.accountCard,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderSubtle,
                    flexDirection: "row",
                  },
                ]}
              >
                {accountAvatarUrl ? (
                  <Image
                    source={{ uri: accountAvatarUrl }}
                    style={styles.accountAvatarImage}
                  />
                ) : (
                  <View
                    style={[
                      styles.accountAvatar,
                      {
                        backgroundColor: colors.surface2,
                        borderColor: colors.borderSubtle,
                      },
                    ]}
                  >
                    <BodyText style={styles.accountAvatarText}>
                      {accountName.charAt(0).toUpperCase() || "G"}
                    </BodyText>
                  </View>
                )}
                <View style={styles.accountCopy}>
                  <BodyText style={styles.accountName}>
                    {isAuthLoading ? t("settings.accountLoading") : accountName}
                  </BodyText>
                  <MutedText>
                    {user
                      ? accountProviderLabel
                      : t("settings.cloudSyncDescription")}
                  </MutedText>
                </View>
              </View>
              <SettingRow
                label={t("settings.cloudSync")}
                description={t("settings.cloudSyncDescription")}
                colors={colors}
                control={
                  <View
                    style={[styles.accountActions, { flexDirection: "row" }]}
                  >
                    {user ? (
                      <>
                        <AccentButton
                          title={
                            isSyncing
                              ? t("settings.syncInProgress")
                              : t("settings.syncLibrary")
                          }
                          disabled={isSyncing || !isConfigured}
                          onPress={() => {
                            void handleSyncLibrary();
                          }}
                          style={[
                            styles.primaryButton,
                            { opacity: isSyncing || !isConfigured ? 0.55 : 1 },
                          ]}
                        />
                        <TouchableOpacity
                          onPress={() => {
                            void signOut();
                          }}
                          style={[
                            styles.secondaryButton,
                            {
                              backgroundColor: colors.surface2,
                              borderColor: colors.borderSubtle,
                            },
                          ]}
                        >
                          <BodyText style={styles.secondaryButtonText}>
                            {t("settings.signOut")}
                          </BodyText>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          disabled={!isConfigured}
                          onPress={() =>
                            navigation.navigate("Onboarding", {
                              openAuth: "signin",
                            })
                          }
                          style={[
                            styles.secondaryButton,
                            {
                              backgroundColor: colors.surface2,
                              borderColor: colors.borderSubtle,
                              opacity: isConfigured ? 1 : 0.45,
                            },
                          ]}
                        >
                          <BodyText style={styles.secondaryButtonText}>
                            {t("settings.continueToSignIn")}
                          </BodyText>
                        </TouchableOpacity>
                        <TouchableOpacity
                          disabled={!isConfigured}
                          onPress={() =>
                            navigation.navigate("Onboarding", {
                              openAuth: "signup",
                            })
                          }
                          style={[
                            styles.secondaryButton,
                            {
                              backgroundColor: colors.surface2,
                              borderColor: colors.borderSubtle,
                              opacity: isConfigured ? 1 : 0.45,
                            },
                          ]}
                        >
                          <BodyText style={styles.secondaryButtonText}>
                            {t("settings.continueToSignUp")}
                          </BodyText>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                }
              />
              {syncFeedback ? (
                <View
                  style={[
                    styles.syncFeedbackBox,
                    {
                      backgroundColor:
                        syncFeedback.tone === "error"
                          ? "rgba(220, 38, 38, 0.12)"
                          : syncFeedback.tone === "success"
                            ? withOpacity(colors.accent, 0.12)
                            : withOpacity(colors.foreground, 0.05),
                      borderColor:
                        syncFeedback.tone === "error"
                          ? "rgba(248, 113, 113, 0.22)"
                          : syncFeedback.tone === "success"
                            ? withOpacity(colors.accent, 0.28)
                            : withOpacity(colors.foreground, 0.08),
                    },
                  ]}
                >
                  <BodyText
                    style={[
                      styles.syncFeedbackText,
                      {
                        color:
                          syncFeedback.tone === "error"
                            ? isLight
                              ? "#991b1b"
                              : "#fecaca"
                            : colors.foreground,
                      },
                    ]}
                  >
                    {syncFeedback.message}
                  </BodyText>
                </View>
              ) : null}

              <SettingRow
                label={t("settings.autoSyncLibrary")}
                description={t("settings.autoSyncLibraryDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.autoSyncLibrary")}
                    accessibilityHint={t("settings.autoSyncLibraryDescription")}
                    value={settings.autoSyncLibrary}
                    onValueChange={(value) =>
                      updateSettings({ autoSyncLibrary: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.listenbrainz_scrobbling")}
                description={t("settings.listenbrainz_scrobbling_desc")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      setScrobbleProvider("listenbrainz");
                      setShowScrobbleSheet(true);
                    }}
                    style={[
                      styles.secondaryButton,
                      { borderColor: colors.borderSubtle },
                    ]}
                  >
                    <BodyText
                      style={{ color: colors.foreground, fontSize: 13 }}
                    >
                      {t("settings.connect")}
                    </BodyText>
                  </TouchableOpacity>
                }
              />
              <SettingRow
                label={t("settings.lastfm_scrobbling")}
                description={t("settings.lastfm_scrobbling_desc")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      setScrobbleProvider("lastfm");
                      setShowScrobbleSheet(true);
                    }}
                    style={[
                      styles.secondaryButton,
                      { borderColor: colors.borderSubtle },
                    ]}
                  >
                    <BodyText
                      style={{ color: colors.foreground, fontSize: 13 }}
                    >
                      {t("settings.connect")}
                    </BodyText>
                  </TouchableOpacity>
                }
              />
              <SettingRow
                label={t("settings.subsonic")}
                description={t("settings.subsonic_desc")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setShowSubsonicSheet(true)}
                    style={[
                      styles.secondaryButton,
                      { borderColor: colors.borderSubtle },
                    ]}
                  >
                    <BodyText
                      style={{ color: colors.foreground, fontSize: 13 }}
                    >
                      {t("settings.configure")}
                    </BodyText>
                  </TouchableOpacity>
                }
              />
            </Section>
          ) : null}

          {activeTab === "appearance" ? (
            <Section
              title={t("settings.themeAndMotion")}
              description={t("settings.themeAndMotionDescription")}
            >
              <SettingRow
                label={t("settings.theme")}
                description={t("settings.themeDescription")}
                colors={colors}
                control={
                  <View style={styles.themeGrid}>
                    {APP_THEME_OPTIONS.map((theme) => (
                      <ThemeChoiceCard
                        key={theme}
                        theme={theme}
                        label={themeLabels[theme]}
                        selected={settings.theme === theme}
                        colors={colors}
                        onPress={() => updateSettings({ theme })}
                      />
                    ))}
                  </View>
                }
              />
              <SettingRow
                label={t("settings.disableAnimations")}
                description={t("settings.disableAnimationsDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.disableAnimations")}
                    accessibilityHint={t(
                      "settings.disableAnimationsDescription",
                    )}
                    value={settings.disableAnimations}
                    onValueChange={(value) =>
                      updateSettings({ disableAnimations: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.language")}
                description={t("settings.languageDescription")}
                colors={colors}
                control={
                  <View style={styles.choiceWrap}>
                    {(["en", "fa"] as AppLanguage[]).map((language) => (
                      <ChoiceChip
                        key={language}
                        label={
                          language === "en"
                            ? t("language.english")
                            : t("language.persian")
                        }
                        selected={settings.language === language}
                        onPress={() => updateSettings({ language })}
                        colors={colors}
                      />
                    ))}
                  </View>
                }
              />
            </Section>
          ) : null}

          {activeTab === "playback" ? (
            <Section
              title={t("settings.musicBehaves")}
              description={t("settings.musicBehavesDescription")}
            >
              <SettingRow
                label={t("settings.autoRetryPlayback")}
                description={t("settings.autoRetryPlaybackDescription")}
                colors={colors}
                control={
                  <View style={styles.choiceWrap}>
                    {RETRY_MODES.map((mode) => (
                      <ChoiceChip
                        key={mode}
                        label={retryLabels[mode]}
                        selected={settings.playbackRetryMode === mode}
                        onPress={() =>
                          updateSettings({ playbackRetryMode: mode })
                        }
                        colors={colors}
                      />
                    ))}
                  </View>
                }
              />
              <SettingRow
                label={t("settings.audioQuality")}
                description={t("settings.audioQualityDescription")}
                colors={colors}
                control={
                  <View style={styles.choiceWrap}>
                    {QUALITY_MODE_OPTIONS.map((mode) => (
                      <ChoiceChip
                        key={mode}
                        label={qualityModeLabels[mode]}
                        selected={settings.audioQualityMode === mode}
                        onPress={() => updateAudioQuality(mode)}
                        colors={colors}
                      />
                    ))}
                  </View>
                }
              />
              {settings.audioQualityMode !== "alwaysBest" ? (
                <SettingRow
                  label={t("settings.cellularQualityCap")}
                  description={t("settings.cellularQualityCapDescription")}
                  colors={colors}
                  control={
                    <View style={styles.choiceWrap}>
                      <ChoiceChip
                        label={t("settings.qualityCapBest")}
                        selected={settings.cellularCapKbps === null}
                        onPress={() => updateAudioQualityCap(null)}
                        colors={colors}
                      />
                      {QUALITY_CAP_OPTIONS.map((cap) => (
                        <ChoiceChip
                          key={cap}
                          label={`${cap} kbps`}
                          selected={settings.cellularCapKbps === cap}
                          onPress={() => updateAudioQualityCap(cap)}
                          colors={colors}
                        />
                      ))}
                    </View>
                  }
                />
              ) : null}
              {monthlyDataUsage ? (
                <SettingRow
                  label={t("settings.monthlyDataUsage")}
                  description={`${formatBytes(monthlyDataUsage.totalBytes)} · ${t("settings.dataUsageNote")}`}
                  colors={colors}
                  control={
                    <View style={styles.choiceWrap}>
                      <ChoiceChip
                        label={t("settings.resetDataUsage")}
                        selected={false}
                        onPress={() => void resetUsage()}
                        colors={colors}
                      />
                    </View>
                  }
                />
              ) : null}
              <SettingRow
                label={t("settings.autoplayRecommendedTracks")}
                description={t("settings.autoplayRecommendedTracksDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.autoplayRecommendedTracks")}
                    accessibilityHint={t(
                      "settings.autoplayRecommendedTracksDescription",
                    )}
                    value={settings.autoplayRecommendations}
                    onValueChange={(value) =>
                      updateSettings({ autoplayRecommendations: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.openNowPlayingAutomatically")}
                description={t(
                  "settings.openNowPlayingAutomaticallyDescription",
                )}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t(
                      "settings.openNowPlayingAutomatically",
                    )}
                    accessibilityHint={t(
                      "settings.openNowPlayingAutomaticallyDescription",
                    )}
                    value={settings.openFullscreenOnPlay}
                    onValueChange={(value) =>
                      updateSettings({ openFullscreenOnPlay: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.haptics")}
                description={t("settings.hapticsDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.haptics")}
                    accessibilityHint={t("settings.hapticsDescription")}
                    value={settings.hapticsEnabled}
                    onValueChange={(value) =>
                      updateSettings({ hapticsEnabled: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.autoCacheLikedSongs")}
                description={t("settings.autoCacheLikedSongsDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.autoCacheLikedSongs")}
                    accessibilityHint={t(
                      "settings.autoCacheLikedSongsDescription",
                    )}
                    value={settings.autoCacheLikedSongs}
                    onValueChange={(value) =>
                      updateSettings({ autoCacheLikedSongs: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.crossfade")}
                description={t("settings.crossfadeDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.crossfade")}
                    accessibilityHint={t("settings.crossfadeDescription")}
                    value={settings.crossfadeEnabled}
                    onValueChange={(value) =>
                      updateSettings({ crossfadeEnabled: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.crossfadeSeconds")}
                description={t("settings.crossfadeSecondsDescription")}
                colors={colors}
                control={
                  <View style={styles.choiceWrap}>
                    {[2, 4, 6, 8].map((seconds) => (
                      <ChoiceChip
                        key={seconds}
                        label={`${seconds}s`}
                        selected={settings.crossfadeSeconds === seconds}
                        onPress={() =>
                          updateSettings({ crossfadeSeconds: seconds })
                        }
                        colors={colors}
                      />
                    ))}
                  </View>
                }
              />
              <SettingRow
                label={t("settings.waveformSeek")}
                description={t("settings.waveformSeekDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.waveformSeek")}
                    accessibilityHint={t("settings.waveformSeekDescription")}
                    value={settings.waveformSeekBar}
                    onValueChange={(value) =>
                      updateSettings({ waveformSeekBar: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.replayGain")}
                description={t("settings.replayGainDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.replayGain")}
                    accessibilityHint={t("settings.replayGainDescription")}
                    value={settings.replayGainEnabled}
                    onValueChange={(value) =>
                      updateSettings({ replayGainEnabled: value })
                    }
                  />
                }
              />
            </Section>
          ) : null}

          {activeTab === "library" ? (
            <Section
              title={t("settings.searchPreferences")}
              description={t("settings.searchPreferencesDescription")}
            >
              <SettingRow
                label={t("settings.defaultSearchSource")}
                description={t("settings.defaultSearchSourceDescription")}
                colors={colors}
                control={
                  <View style={styles.choiceWrap}>
                    {SEARCH_SOURCES.map((source) => (
                      <ChoiceChip
                        key={source}
                        label={sourceLabels[source]}
                        selected={settings.preferredSearchSource === source}
                        onPress={() =>
                          updateSettings({ preferredSearchSource: source })
                        }
                        colors={colors}
                      />
                    ))}
                  </View>
                }
              />
              <SettingRow
                label={t("settings.rememberLastSearch")}
                description={t("settings.rememberLastSearchDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.rememberLastSearch")}
                    accessibilityHint={t(
                      "settings.rememberLastSearchDescription",
                    )}
                    value={settings.rememberLastSearch}
                    onValueChange={(value) =>
                      updateSettings({ rememberLastSearch: value })
                    }
                  />
                }
              />
            </Section>
          ) : null}

          {activeTab === "library" ? (
            <Section
              title={t("settings.readingAndInput")}
              description={t("settings.readingAndInputDescription")}
            >
              <SettingRow
                label={t("settings.lyrics")}
                description={t("settings.lyricsDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.lyrics")}
                    accessibilityHint={t("settings.lyricsDescription")}
                    value={settings.lyricsEnabled}
                    onValueChange={(value) =>
                      updateSettings({ lyricsEnabled: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.autoScrollSyncedLyrics")}
                description={t("settings.autoScrollSyncedLyricsDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.autoScrollSyncedLyrics")}
                    accessibilityHint={t(
                      "settings.autoScrollSyncedLyricsDescription",
                    )}
                    value={settings.autoScrollLyrics}
                    disabled={!settings.lyricsEnabled}
                    onValueChange={(value) =>
                      updateSettings({ autoScrollLyrics: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.keyboardShortcuts")}
                description={t("settings.keyboardShortcutsDescription")}
                colors={colors}
                controlPlacement="inline"
                control={
                  <SettingsSwitch
                    accessibilityLabel={t("settings.keyboardShortcuts")}
                    accessibilityHint={t(
                      "settings.keyboardShortcutsDescription",
                    )}
                    value={settings.keyboardShortcuts}
                    onValueChange={(value) =>
                      updateSettings({ keyboardShortcuts: value })
                    }
                  />
                }
              />
              <SettingRow
                label={t("settings.seekJumpLength")}
                description={t("settings.seekJumpLengthDescription")}
                colors={colors}
                control={
                  <View style={styles.choiceWrap}>
                    {SEEK_STEP_OPTIONS.map((seconds) => (
                      <ChoiceChip
                        key={seconds}
                        label={`${seconds}s`}
                        selected={settings.seekStepSeconds === seconds}
                        onPress={() =>
                          updateSettings({ seekStepSeconds: seconds })
                        }
                        colors={colors}
                      />
                    ))}
                  </View>
                }
              />
            </Section>
          ) : null}

          {activeTab === "about" ? (
            <Section
              title={t("settings.appUpdates")}
              description={t("settings.appUpdatesDescription")}
            >
              <SettingRow
                label={t("settings.checkForUpdates")}
                description={updateDescription}
                colors={colors}
                control={
                  <View
                    style={[styles.accountActions, { flexDirection: "row" }]}
                  >
                    <AccentButton
                      title={
                        availableUpdateInfo
                          ? t("settings.openUpdate")
                          : t("settings.checkForUpdates")
                      }
                      disabled={isCheckingForUpdates}
                      onPress={() => {
                        void handleCheckForUpdates();
                      }}
                      style={[
                        styles.primaryButton,
                        { opacity: isCheckingForUpdates ? 0.6 : 1 },
                      ]}
                    />
                    <View
                      style={[
                        styles.secondaryButton,
                        {
                          backgroundColor: colors.surface2,
                          borderColor: colors.borderSubtle,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          opacity: 1,
                        },
                      ]}
                    >
                      {isCheckingForUpdates ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.foreground}
                        />
                      ) : null}
                      <BodyText style={styles.secondaryButtonText}>
                        {availableUpdateInfo?.version || CURRENT_APP_VERSION}
                      </BodyText>
                    </View>
                  </View>
                }
              />
              {updateFeedback ? (
                <View
                  style={[
                    styles.syncFeedbackBox,
                    {
                      backgroundColor:
                        updateFeedback.tone === "error"
                          ? "rgba(220, 38, 38, 0.12)"
                          : updateFeedback.tone === "success"
                            ? withOpacity(colors.accent, 0.12)
                            : withOpacity(colors.foreground, 0.05),
                      borderColor:
                        updateFeedback.tone === "error"
                          ? "rgba(248, 113, 113, 0.22)"
                          : updateFeedback.tone === "success"
                            ? withOpacity(colors.accent, 0.28)
                            : withOpacity(colors.foreground, 0.08),
                    },
                  ]}
                >
                  <BodyText
                    style={[
                      styles.syncFeedbackText,
                      {
                        color:
                          updateFeedback.tone === "error"
                            ? isLight
                              ? "#991b1b"
                              : "#fecaca"
                            : colors.foreground,
                      },
                    ]}
                  >
                    {updateFeedback.message}
                  </BodyText>
                </View>
              ) : null}

              <SettingRow
                label={t("settings.communityTitle")}
                description={t("settings.communityDescription")}
                colors={colors}
                control={
                  <AccentButton
                    style={styles.primaryButton}
                    title={t("settings.communityOpen")}
                    onPress={() => setIsCommunityOpenedManually(true)}
                  />
                }
              />
            </Section>
          ) : null}

          <CommunityModal
            visible={isCommunityVisible}
            onClose={closeCommunity}
          />

          <ScrobbleSheet
            visible={showScrobbleSheet}
            provider={scrobbleProvider}
            onClose={() => setShowScrobbleSheet(false)}
          />

          <SubsonicSheet
            visible={showSubsonicSheet}
            onClose={() => setShowSubsonicSheet(false)}
          />
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 120,
    gap: 32,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    minHeight: 60,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 2,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
    textAlign: "center",
  },

  section: {
    gap: 8,
  },
  sectionHeaderStatic: {
    paddingBottom: 12,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
  },
  sectionDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  sectionContent: {
    gap: 0,
  },
  settingRow: {
    borderBottomWidth: 1,
    paddingVertical: 18,
    gap: 12,
  },
  settingRowInline: {
    flexDirection: "row",
    alignItems: "center",
  },
  settingCopy: {
    gap: 4,
  },
  settingCopyInline: {
    flex: 1,
    minWidth: 0,
  },
  settingLabel: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  settingControl: {
    marginTop: 0,
  },
  settingControlInline: {
    marginTop: 0,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  choiceWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 44,
    minWidth: 44,
    maxWidth: "100%",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
  },
  chipText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  themeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  themeCard: {
    width: "48%",
    maxWidth: "48%",
    minWidth: 0,
    flexBasis: "48%",
    flexGrow: 1,
    flexShrink: 1,
    borderWidth: 1,
    minHeight: 80,
    padding: 12,
    gap: 10,
    position: "relative",
  },
  themePreviewRow: {
    flexDirection: "row",
    paddingRight: 24,
    gap: 6,
  },
  previewDot: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 1,
  },
  themeLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
  },
  themeSelectedBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  accountCard: {
    borderBottomWidth: 1,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  accountAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  accountAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 999,
  },
  accountAvatarText: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "600",
  },
  accountCopy: {
    flex: 1,
    gap: 2,
  },
  accountName: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "600",
  },
  accountActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  primaryButton: {
    borderRadius: 0,
    minHeight: 44,
  },
  secondaryButton: {
    minHeight: 44,
    maxWidth: "100%",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
  },
  syncFeedbackBox: {
    marginTop: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  syncFeedbackText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
