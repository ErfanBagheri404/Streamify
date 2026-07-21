import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
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
  type SettingsSectionKey,
  isLightAppTheme,
} from "../../lib/app-settings";
import { Screen } from "../ui/Screen";
import { BodyText, MutedText, TitleText } from "../ui/Text";
import { AccentButton } from "../ui/Button";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import {
  CURRENT_APP_VERSION,
  useAppUpdate,
} from "../../contexts/AppUpdateContext";
import { useAppSettings } from "../../hooks/useAppSettings";
import { useAuth } from "../../hooks/useAuth";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import {
  buildCurrentLocalLibrarySyncSource,
  pushCloudLibrarySnapshot,
} from "../../lib/cloud-library-sync";

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

function Section({
  eyebrow,
  title,
  description,
  colors,
  children,
  collapsed = false,
  onToggle,
  isRtl,
  sectionKey,
  onMeasure,
}: {
  eyebrow: string;
  title: string;
  description: string;
  colors: ReturnType<typeof useTheme>["colors"];
  children: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  isRtl: boolean;
  sectionKey?: SettingsSectionKey;
  onMeasure?: (section: SettingsSectionKey, y: number) => void;
}) {
  return (
    <View
      onLayout={(event) => {
        if (!sectionKey || !onMeasure) {
          return;
        }
        onMeasure(sectionKey, event.nativeEvent.layout.y);
      }}
      style={[
        styles.section,
        {
          backgroundColor: colors.surface1,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.82}
        disabled={!onToggle}
        onPress={onToggle}
        style={[
          styles.sectionHeader,
          { flexDirection: isRtl ? "row-reverse" : "row" },
        ]}
      >
        <View style={styles.sectionHeaderCopy}>
          <MutedText style={styles.eyebrow}>{eyebrow}</MutedText>
          <TitleText style={styles.sectionTitle}>{title}</TitleText>
          <MutedText style={styles.sectionDescription}>{description}</MutedText>
        </View>
        <View
          style={[
            styles.sectionToggle,
            {
              backgroundColor: colors.surface3,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Ionicons
            name={collapsed ? "chevron-down" : "chevron-up"}
            size={18}
            color={colors.foreground}
          />
        </View>
      </TouchableOpacity>
      {!collapsed ? (
        <View style={styles.sectionContent}>{children}</View>
      ) : null}
    </View>
  );
}

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
          backgroundColor: colors.surface3,
          borderColor: colors.borderSubtle,
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
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.accent : colors.surface2,
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

function SummaryCard({
  label,
  value,
  description,
  colors,
}: {
  label: string;
  value: string;
  description: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View
      style={[
        styles.summaryCard,
        {
          backgroundColor: colors.surface3,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <MutedText style={styles.summaryLabel}>{label}</MutedText>
      <BodyText style={styles.summaryValue}>{value}</BodyText>
      <MutedText style={styles.summaryDescription}>{description}</MutedText>
    </View>
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
      style={[
        styles.themeCard,
        {
          backgroundColor: selected ? colors.surface2 : colors.surface3,
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
  const { t, isRtl } = useAppLanguage();
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
  const collapsedSections = settings.collapsedSettingsSections;
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionOffsetsRef = useRef<Partial<Record<SettingsSectionKey, number>>>(
    {},
  );

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

  const switchTrackColor = {
    false: withOpacity(colors.foreground, 0.22),
    true: colors.accent,
  };
  const switchThumbColor = isLight ? "#ffffff" : colors.foreground;

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

  const motionLabel = settings.disableAnimations
    ? t("settings.animationsOff")
    : t("settings.animationsOn");
  const searchMemoryLabel = settings.rememberLastSearch
    ? t("settings.searchMemoryOn")
    : t("settings.searchMemoryOff");
  const retrySummary =
    settings.playbackRetryMode === "always"
      ? t("settings.alwaysRetryOnce")
      : settings.playbackRetryMode === "never"
        ? t("settings.neverRetryAutomatically")
        : t("settings.askWhenPlaybackFails");
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

  const toggleSection = (section: SettingsSectionKey) => {
    updateSettings({
      collapsedSettingsSections: {
        ...collapsedSections,
        [section]: !collapsedSections?.[section],
      },
    });
  };
  const handleSectionMeasure = useCallback(
    (section: SettingsSectionKey, y: number) => {
      sectionOffsetsRef.current[section] = y;
    },
    [],
  );
  const jumpToSection = useCallback(
    (section: SettingsSectionKey) => {
      const isCollapsed = Boolean(collapsedSections?.[section]);
      if (isCollapsed) {
        updateSettings({
          collapsedSettingsSections: {
            ...collapsedSections,
            [section]: false,
          },
        });
      }

      const scrollToSection = () => {
        const offsetY = Math.max(
          0,
          (sectionOffsetsRef.current[section] ?? 0) - 96,
        );
        (
          scrollViewRef.current as unknown as {
            scrollTo: (options: {
              y?: number;
              x?: number;
              animated?: boolean;
            }) => void;
          }
        )?.scrollTo({
          y: offsetY,
          animated: !settings.disableAnimations,
        });
      };

      if (isCollapsed) {
        setTimeout(scrollToSection, settings.disableAnimations ? 0 : 180);
        return;
      }

      requestAnimationFrame(scrollToSection);
    },
    [collapsedSections, settings.disableAnimations, updateSettings],
  );

  const quickAccessSections = useMemo(
    () =>
      [
        { key: "account", label: t("settings.account") },
        { key: "appearance", label: t("settings.themeAndMotion") },
        { key: "playback", label: t("settings.musicBehaves") },
        { key: "discovery", label: t("settings.searchPreferences") },
        { key: "lyrics", label: t("settings.readingAndInput") },
        { key: "updates", label: t("settings.appUpdates") },
      ] as Array<{ key: SettingsSectionKey; label: string }>,
    [t],
  );

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
          >
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <TitleText style={styles.headerTitle}>
              {t("settings.title")}
            </TitleText>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View
            style={[
              styles.hero,
              {
                backgroundColor: colors.surface1,
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <View
              style={[
                styles.heroBadge,
                {
                  backgroundColor: withOpacity(colors.foreground, 0.06),
                  alignSelf: isRtl ? "flex-end" : "flex-start",
                  flexDirection: isRtl ? "row-reverse" : "row",
                },
              ]}
            >
              <Ionicons
                name="sparkles-outline"
                size={14}
                color={colors.accent}
              />
              <BodyText style={styles.heroBadgeText}>
                {t("settings.personalize")}
              </BodyText>
            </View>
            <TitleText style={styles.heroTitle}>
              {t("settings.title")}
            </TitleText>
            <MutedText style={styles.heroDescription}>
              {t("settings.description")}
            </MutedText>
            <View
              style={[
                styles.heroPills,
                { flexDirection: isRtl ? "row-reverse" : "row" },
              ]}
            >
              {[
                `${t("settings.autoRetry")}: ${retrySummary}`,
                `${t("settings.searchLabel")}: ${
                  sourceLabels[settings.preferredSearchSource]
                }`,
                `${t("settings.seekJump")}: ${settings.seekStepSeconds}s`,
                `${t("settings.theme")}: ${themeLabels[settings.theme]}`,
                `${t("settings.motion")}: ${motionLabel}`,
                `${t("settings.searchMemory")}: ${searchMemoryLabel}`,
              ].map((pill) => (
                <View
                  key={pill}
                  style={[
                    styles.heroPill,
                    {
                      backgroundColor: withOpacity(colors.foreground, 0.05),
                      borderColor: withOpacity(colors.foreground, 0.08),
                    },
                  ]}
                >
                  <MutedText style={styles.heroPillText}>{pill}</MutedText>
                </View>
              ))}
            </View>
          </View>

          <View
            style={[
              styles.quickAccessCard,
              {
                backgroundColor: colors.surface1,
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <MutedText style={styles.quickAccessEyebrow}>
              {t("settings.quickAccess")}
            </MutedText>
            <TitleText style={styles.quickAccessTitle}>
              {t("settings.quickAccess")}
            </TitleText>
            <MutedText style={styles.quickAccessDescription}>
              {t("settings.quickAccessDescription")}
            </MutedText>
            <View
              style={[
                styles.quickAccessWrap,
                { flexDirection: isRtl ? "row-reverse" : "row" },
              ]}
            >
              {quickAccessSections.map((section) => (
                <TouchableOpacity
                  key={section.key}
                  onPress={() => jumpToSection(section.key)}
                  style={[
                    styles.quickAccessChip,
                    {
                      backgroundColor: colors.surface3,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <BodyText style={styles.quickAccessChipText}>
                    {section.label}
                  </BodyText>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Section
            eyebrow={t("settings.account")}
            title={t("settings.account")}
            description={t("settings.accountDescription")}
            colors={colors}
            collapsed={Boolean(collapsedSections.account)}
            onToggle={() => toggleSection("account")}
            isRtl={isRtl}
            sectionKey="account"
            onMeasure={handleSectionMeasure}
          >
            <View
              style={[
                styles.accountCard,
                {
                  backgroundColor: colors.surface3,
                  borderColor: colors.borderSubtle,
                  flexDirection: isRtl ? "row-reverse" : "row",
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
                  style={[
                    styles.accountActions,
                    { flexDirection: isRtl ? "row-reverse" : "row" },
                  ]}
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
                        style={{
                          opacity: isSyncing || !isConfigured ? 0.55 : 1,
                        }}
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
                        onPress={() => navigation.navigate("SignIn")}
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
                        onPress={() => navigation.navigate("SignUp")}
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
          </Section>

          <Section
            eyebrow={t("settings.appearance")}
            title={t("settings.themeAndMotion")}
            description={t("settings.themeAndMotionDescription")}
            colors={colors}
            collapsed={Boolean(collapsedSections.appearance)}
            onToggle={() => toggleSection("appearance")}
            isRtl={isRtl}
            sectionKey="appearance"
            onMeasure={handleSectionMeasure}
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
                <Switch
                  value={settings.disableAnimations}
                  onValueChange={(value) =>
                    updateSettings({ disableAnimations: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
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

          <Section
            eyebrow={t("settings.playback")}
            title={t("settings.musicBehaves")}
            description={t("settings.musicBehavesDescription")}
            colors={colors}
            collapsed={Boolean(collapsedSections.playback)}
            onToggle={() => toggleSection("playback")}
            isRtl={isRtl}
            sectionKey="playback"
            onMeasure={handleSectionMeasure}
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
              label={t("settings.autoplayRecommendedTracks")}
              description={t("settings.autoplayRecommendedTracksDescription")}
              colors={colors}
              controlPlacement="inline"
              control={
                <Switch
                  value={settings.autoplayRecommendations}
                  onValueChange={(value) =>
                    updateSettings({ autoplayRecommendations: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
                />
              }
            />
            <SettingRow
              label={t("settings.openNowPlayingAutomatically")}
              description={t("settings.openNowPlayingAutomaticallyDescription")}
              colors={colors}
              controlPlacement="inline"
              control={
                <Switch
                  value={settings.openFullscreenOnPlay}
                  onValueChange={(value) =>
                    updateSettings({ openFullscreenOnPlay: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
                />
              }
            />
            <SettingRow
              label={t("settings.autoCacheLikedSongs")}
              description={t("settings.autoCacheLikedSongsDescription")}
              colors={colors}
              controlPlacement="inline"
              control={
                <Switch
                  value={settings.autoCacheLikedSongs}
                  onValueChange={(value) =>
                    updateSettings({ autoCacheLikedSongs: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
                />
              }
            />
          </Section>

          <Section
            eyebrow={t("settings.discovery")}
            title={t("settings.searchPreferences")}
            description={t("settings.searchPreferencesDescription")}
            colors={colors}
            collapsed={Boolean(collapsedSections.discovery)}
            onToggle={() => toggleSection("discovery")}
            isRtl={isRtl}
            sectionKey="discovery"
            onMeasure={handleSectionMeasure}
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
                <Switch
                  value={settings.rememberLastSearch}
                  onValueChange={(value) =>
                    updateSettings({ rememberLastSearch: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
                />
              }
            />
          </Section>

          <Section
            eyebrow={t("settings.lyricsAndControls")}
            title={t("settings.readingAndInput")}
            description={t("settings.readingAndInputDescription")}
            colors={colors}
            collapsed={Boolean(collapsedSections.lyrics)}
            onToggle={() => toggleSection("lyrics")}
            isRtl={isRtl}
            sectionKey="lyrics"
            onMeasure={handleSectionMeasure}
          >
            <SettingRow
              label={t("settings.lyrics")}
              description={t("settings.lyricsDescription")}
              colors={colors}
              controlPlacement="inline"
              control={
                <Switch
                  value={settings.lyricsEnabled}
                  onValueChange={(value) =>
                    updateSettings({ lyricsEnabled: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
                />
              }
            />
            <SettingRow
              label={t("settings.autoScrollSyncedLyrics")}
              description={t("settings.autoScrollSyncedLyricsDescription")}
              colors={colors}
              controlPlacement="inline"
              control={
                <Switch
                  value={settings.autoScrollLyrics}
                  disabled={!settings.lyricsEnabled}
                  onValueChange={(value) =>
                    updateSettings({ autoScrollLyrics: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
                />
              }
            />
            <SettingRow
              label={t("settings.keyboardShortcuts")}
              description={t("settings.keyboardShortcutsDescription")}
              colors={colors}
              controlPlacement="inline"
              control={
                <Switch
                  value={settings.keyboardShortcuts}
                  onValueChange={(value) =>
                    updateSettings({ keyboardShortcuts: value })
                  }
                  trackColor={switchTrackColor}
                  thumbColor={switchThumbColor}
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

          <Section
            eyebrow={t("settings.activeSetup")}
            title={t("settings.activeSetup")}
            description={t("settings.quickHelp")}
            colors={colors}
            collapsed={Boolean(collapsedSections.summary)}
            onToggle={() => toggleSection("summary")}
            isRtl={isRtl}
            sectionKey="summary"
            onMeasure={handleSectionMeasure}
          >
            <SummaryCard
              label={t("settings.playbackSummary")}
              value={retrySummary}
              description={
                settings.autoplayRecommendations
                  ? t("settings.recommendationsContinue")
                  : t("settings.playbackStops")
              }
              colors={colors}
            />
            <SummaryCard
              label={t("settings.searchSummary")}
              value={sourceLabels[settings.preferredSearchSource]}
              description={
                settings.rememberLastSearch
                  ? t("settings.searchRestores")
                  : t("settings.searchOpensFresh")
              }
              colors={colors}
            />
            <SummaryCard
              label={t("settings.lyricsControlsSummary")}
              value={
                settings.lyricsEnabled
                  ? t("settings.lyricsOn")
                  : t("settings.lyricsOff")
              }
              description={
                settings.keyboardShortcuts
                  ? t("settings.shortcutsEnabled", {
                      seconds: settings.seekStepSeconds,
                    })
                  : t("settings.shortcutsDisabled")
              }
              colors={colors}
            />
            <SummaryCard
              label={t("settings.appearancePerformance")}
              value={themeLabels[settings.theme]}
              description={motionLabel}
              colors={colors}
            />
          </Section>

          <Section
            eyebrow={t("settings.appUpdates")}
            title={t("settings.appUpdates")}
            description={t("settings.appUpdatesDescription")}
            colors={colors}
            collapsed={Boolean(collapsedSections.updates)}
            onToggle={() => toggleSection("updates")}
            isRtl={isRtl}
            sectionKey="updates"
            onMeasure={handleSectionMeasure}
          >
            <SettingRow
              label={t("settings.checkForUpdates")}
              description={updateDescription}
              colors={colors}
              control={
                <View
                  style={[
                    styles.accountActions,
                    { flexDirection: isRtl ? "row-reverse" : "row" },
                  ]}
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
                    style={{
                      opacity: isCheckingForUpdates ? 0.6 : 1,
                    }}
                  />
                  <View
                    style={[
                      styles.secondaryButton,
                      {
                        backgroundColor: colors.surface2,
                        borderColor: colors.borderSubtle,
                        flexDirection: isRtl ? "row-reverse" : "row",
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
          </Section>
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
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  iconButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerSpacer: {
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
    gap: 16,
  },
  hero: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  heroBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
  },
  heroTitle: {
    marginTop: 14,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "900",
  },
  heroDescription: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  heroPills: {
    marginTop: 16,
    flexWrap: "wrap",
    gap: 8,
  },
  heroPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroPillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },
  quickAccessCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  quickAccessEyebrow: {
    fontSize: 11,
    lineHeight: 16,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    fontWeight: "600",
  },
  quickAccessTitle: {
    marginTop: 10,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "700",
  },
  quickAccessDescription: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  quickAccessWrap: {
    marginTop: 14,
    flexWrap: "wrap",
    gap: 8,
  },
  quickAccessChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quickAccessChipText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
  },
  section: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeader: {
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionHeaderCopy: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 16,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    fontWeight: "600",
  },
  sectionTitle: {
    marginTop: 10,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "700",
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionToggle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionContent: {
    marginTop: 16,
    gap: 12,
  },
  settingRow: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
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
  },
  settingLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "600",
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  settingControl: {
    marginTop: 4,
  },
  settingControlInline: {
    marginTop: 0,
    marginLeft: 12,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  choiceWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
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
    borderRadius: 18,
    padding: 12,
    gap: 10,
    position: "relative",
  },
  themePreviewRow: {
    flexDirection: "row",
    gap: 8,
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
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
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
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
  },
  syncFeedbackBox: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  syncFeedbackText: {
    fontSize: 13,
    lineHeight: 18,
  },
  summaryCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  summaryLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  summaryValue: {
    marginTop: 4,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "600",
  },
  summaryDescription: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
});
