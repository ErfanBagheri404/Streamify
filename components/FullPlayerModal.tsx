/********************************************************************
 *  FullPlayerModal.tsx - Modern dark theme player with blurred background
 *******************************************************************/
import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Text,
  TextInput,
  ScrollView,
  View,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { Entypo } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer } from "../contexts/PlayerContext";
import { formatTime } from "../utils/formatters";
import { CachedLyrics, lyricsService } from "../modules/lyricsService";
import {
  buildTimedLyrics,
  findActiveLyricIndex,
} from "../modules/lyricsShared";
import { normalizeYouTubeThumbnailUrl, sanitizeImageUrl } from "./core/image";
import { SliderSheet } from "./SliderSheet";
import { StorageService, Playlist } from "../utils/storage";
import { useAppSettings } from "../hooks/useAppSettings";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";

const { Animated, PanResponder } = require("react-native");
const LYRICS_MANUAL_SCROLL_HOLD_MS = 1500;

type LayoutChangeEvent = Parameters<
  NonNullable<React.ComponentProps<typeof View>["onLayout"]>
>[0] & {
  nativeEvent: {
    layout: { x: number; y: number; width: number; height: number };
  };
};
type AccessibilityActionEvent = Parameters<
  NonNullable<React.ComponentProps<typeof View>["onAccessibilityAction"]>
>[0] & { nativeEvent: { actionName?: string } };

const { width, height } = Dimensions.get("window");
const SHEET_HEIGHT = height * 0.5;
const SHEET_CLOSED_TOP = height;
const SHEET_HALF_TOP = height - SHEET_HEIGHT;
const SEEK_STEP_SECONDS = 10;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const ModalContainer = styled.View`
  flex: 1;
  width: 100%;
  height: 100%;
`;

const BackgroundContainer = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const BackgroundImage = styled.Image`
  width: 100%;
  height: 100%;
  transform: scale(1.5);
`;

const BlurOverlay = styled(BlurView)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const DarkOverlay = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
`;

const GradientOverlay = styled(LinearGradient)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const SafeArea = styled(SafeAreaView)`
  flex: 1;
`;

const Header = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0px;
  padding-horizontal: 28px;
`;

const BackButton = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
`;

const MoreButton = styled.TouchableOpacity``;

const BottomSheetOverlay = styled.TouchableOpacity`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
`;

const BottomSheetContainer = styled(Animated.View)`
  position: absolute;
  left: 0;
  right: 0;
`;

const BottomSheetInner = styled.View`
  background-color: #000000;
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  padding-bottom: 32px;
  height: 100%;
`;

const SheetHandle = styled.View`
  width: 40px;
  height: 4px;
  border-radius: 12px;
  background-color: #4b5563;
  align-self: center;
  margin-top: 8px;
  margin-bottom: 8px;
`;

const SheetContent = styled.View`
  padding-vertical: 8px;
  padding-horizontal: 24px;
`;

const SheetHeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding-vertical: 16px;
  padding-horizontal: 24px;
`;

const SheetHeaderCoverImage = styled.Image`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
`;

const SheetHeaderCoverPlaceholder = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
  align-items: center;
  justify-content: center;
`;

const SheetHeaderTextContainer = styled.View`
  flex-direction: column;
  flex: 1;
`;

const SheetHeaderTitle = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansSemiBold;
  line-height: 20px;
`;

const SheetHeaderArtist = styled.Text`
  color: #9ca3af;
  font-size: 14px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const SheetSeparator = styled.View`
  height: 1px;
  background-color: #111827;
  margin-horizontal: 24px;
`;

const SheetItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding-vertical: 12px;
`;

const SheetItemIconWrapper = styled.View`
  width: 28px;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
`;

const SheetItemText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const PlaylistSelectionModal = styled.Modal`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.8);
`;

const PlaylistSelectionContainer = styled.View`
  flex: 1;
  background-color: #1a1a1a;
  margin-top: 50px;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
`;

const PlaylistSelectionHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom-width: 1px;
  border-bottom-color: #333;
`;

const PlaylistSelectionTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  font-family: GoogleSansBold;
`;

const PlaylistSelectionClose = styled.TouchableOpacity`
  padding: 8px;
`;

const PlaylistItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding: 16px 20px;
  border-bottom-width: 1px;
  border-bottom-color: #2a2a2a;
`;

const PlaylistCover = styled.Image`
  width: 50px;
  height: 50px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
`;

const PlaylistPlaceholderCover = styled.View`
  width: 50px;
  height: 50px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
  justify-content: center;
  align-items: center;
`;

const PlaylistInfo = styled.View`
  flex: 1;
`;

const PlaylistName = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansMedium;
`;

const PlaylistMeta = styled.Text`
  color: #888;
  font-size: 14px;
  font-family: GoogleSansRegular;
  margin-top: 2px;
`;

const AlbumArtWrapper = styled.View`
  position: relative;
  width: ${width - 56}px;
  height: ${width - 56}px;
  border-radius: 12px;
  overflow: hidden;
  margin-top: 20px;
  margin-horizontal: 28px;
  align-self: center;
`;

const AlbumArt = styled.Image`
  width: 100%;
  height: 100%;
  border-radius: 12px;
  background-color: #333;
`;

const PlaceholderAlbumArt = styled.View`
  width: 100%;
  height: 100%;
  background-color: #333;
  justify-content: center;
  align-items: center;
`;

const TrackRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 32px;
  padding-horizontal: 28px;
`;

const LikeButton = styled(TouchableOpacity)`
  justify-content: center;
  align-items: center;
  padding-left: 40px;
`;

const TrackInfo = styled.View`
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
`;

const TrackTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  text-align: left;
  margin-right: 8px;
  font-family: GoogleSansBold;
  line-height: 28px;
`;

const TrackArtist = styled.Text`
  color: #999;
  font-size: 18px;
  text-align: left;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 22px;
`;

const ProgressContainer = styled.View`
  margin-top: 24px;
  padding-horizontal: 28px;
`;

const ProgressBarContainer = styled.View`
  width: 100%;
  height: 40px; /* Increased height for better touch target */
  justify-content: center;
  position: relative;
  background-color: transparent;
  z-index: 1;
`;

const ProgressTrack = styled.View`
  width: 100%;
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
`;

const ProgressFill = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: 999px;
`;

const ProgressThumb = styled.View`
  position: absolute;
  top: 50%;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  margin-left: -8px;
  border-radius: 999px;
  border-width: 2px;
`;

const TimeContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 8px;
  padding-horizontal: 0px;
`;

const TimeText = styled.Text`
  color: #ffffff;
  font-size: 14px;
  font-family: GoogleSansRegular;
  font-weight: 500;
`;

const Controls = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-horizontal: 28px;
  margin-top: 20px;
`;

const ControlButton = styled(TouchableOpacity)`
  position: relative;
`;

const RepeatNumber = styled.Text`
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  color: #a3e635;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 2px 4px;
  border-radius: 4px;
  font-family: GoogleSansBold;
`;

const PlayPauseButton = styled(TouchableOpacity)`
  background-color: #fff;
  border-radius: 32px;
  padding: 16px;
  justify-content: center;
  align-items: center;
`;

const LyricsCard = styled.View`
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 22px;
  padding-bottom: 16px;
  margin-top: 20px;
  margin-horizontal: 28px;
  margin-bottom: 0px;
  backdrop-filter: blur(10px);
`;

const LyricsHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const LyricsTitle = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansBold;
  line-height: 20px;
`;

const LyricLine = styled.Text<{ isActive: boolean }>`
  color: #fff;
  font-size: 20px;
  margin-vertical: 6px;
  opacity: 1;
  font-family: GoogleSansRegular;
  line-height: 22px;
`;

const CacheOverlay = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.8);
  justify-content: center;
  align-items: center;
  border-radius: 12px;
`;

const CacheInfoContainer = styled.View`
  align-items: center;
  justify-content: center;
`;

const CacheInfoRow = styled.Text`
  color: #fff;
  font-size: 14px;
  text-align: center;
  margin-vertical: 2px;
  font-family: GoogleSansMedium;
`;

const CacheTouchable = styled.TouchableOpacity`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px;
`;

const AlbumArtWithOpacity = styled(AlbumArt)<{ showCache: boolean }>`
  opacity: ${(props) => (props.showCache ? 0.2 : 1)};
`;

const PlaceholderAlbumArtWithOpacity = styled(PlaceholderAlbumArt)<{
  showCache: boolean;
}>`
  opacity: ${(props) => (props.showCache ? 0.2 : 1)};
`;

const Spacer = styled.View<{ size: number }>`
  height: ${(props) => props.size}px;
`;

interface FullPlayerModalProps {
  visible: boolean;
  onClose: () => void;
  onPlaylistUpdated?: () => void;
}

export const FullPlayerModal: React.FC<FullPlayerModalProps> = ({
  visible,
  onClose,
  onPlaylistUpdated,
}) => {
  const {
    currentTrack,
    playlist,
    currentIndex,
    isPlaying,
    isLoading,
    isTransitioning,
    playPause,
    nextTrack,
    previousTrack,
    playTrack,
    seekTo,
    toggleLikeSong,
    isSongLiked,
    getCacheInfo,
    cacheProgress,
    repeatMode,
    setRepeatMode,
    isShuffled,
    toggleShuffle,
    position,
    duration,
    cancelLoadingState,
  } = usePlayer();
  const { settings } = useAppSettings();
  const { colors, isLight } = useTheme();
  const { t, isRtl, language } = useAppLanguage();

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [seekBarWidth, setSeekBarWidth] = useState(0);
  const [pendingSeekValue, setPendingSeekValue] = useState<number | null>(null);
  const [isSeekPending, setIsSeekPending] = useState(false);
  const [isHighResArtworkReady, setIsHighResArtworkReady] = useState(false);

  const appState = useRef(AppState.currentState);
  const [cacheInfo, setCacheInfo] = useState<{
    percentage: number;
    fileSize: number;
    totalFileSize?: number;
    isFullyCached: boolean;
    isDownloading?: boolean;
    downloadSpeed?: number;
    retryCount?: number;
  } | null>(null);
  const [showCacheSize, setShowCacheSize] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [isSyncedLyrics, setIsSyncedLyrics] = useState(false);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [manualLyricsArtist, setManualLyricsArtist] = useState("");
  const [manualLyricsTitle, setManualLyricsTitle] = useState("");
  const [lyricsManualModeUntil, setLyricsManualModeUntil] = useState(0);
  const [lyricsViewportHeight, setLyricsViewportHeight] = useState(0);
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);
  const [showPlaylistSelection, setShowPlaylistSelection] = useState(false);
  const [isSuggestionPanelVisible, setIsSuggestionPanelVisible] =
    useState(true);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const sheetTop = useRef(new Animated.Value(SHEET_CLOSED_TOP)).current;
  const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHT);
  const sheetStateRef = useRef<"closed" | "half" | "full">("closed");
  const lyricsScrollRef = useRef<any>(null);
  const lyricsLineLayoutsRef = useRef<
    Record<number, { y: number; height: number }>
  >({});
  const iconColor = colors.foreground;
  const mutedTextColor = colors.muted;
  const activeAccentColor = colors.accent;
  const playerActionColor = colors.accentContrast;
  const previousIconName = isRtl ? "play-forward" : "play-back";
  const nextIconName = isRtl ? "play-back" : "play-forward";
  const fullscreenArtworkSources = React.useMemo(() => {
    const baseArtworkUrl = sanitizeImageUrl(currentTrack?.thumbnail || "");
    if (!baseArtworkUrl) {
      return { lowRes: "", highRes: "" };
    }

    const isYouTubeBackedSource =
      currentTrack.source === "youtube" ||
      currentTrack.source === "youtubemusic";

    if (!isYouTubeBackedSource) {
      return { lowRes: baseArtworkUrl, highRes: baseArtworkUrl };
    }

    return {
      lowRes: baseArtworkUrl,
      highRes:
        normalizeYouTubeThumbnailUrl({
          url: currentTrack.thumbnail,
          videoId: currentTrack.id,
          variant: "maxresdefault.jpg",
          output: "webp",
          quality: 100,
        }) || baseArtworkUrl,
    };
  }, [currentTrack?.id, currentTrack?.source, currentTrack?.thumbnail]);
  const fullscreenArtworkUrl =
    isHighResArtworkReady && fullscreenArtworkSources.highRes
      ? fullscreenArtworkSources.highRes
      : fullscreenArtworkSources.lowRes;
  const upNextTracks = React.useMemo(() => {
    const startIndex = Math.max(currentIndex + 1, 0);

    return playlist.slice(startIndex, startIndex + 4).map((track, offset) => ({
      track,
      index: startIndex + offset,
    }));
  }, [currentIndex, playlist]);
  const copy = React.useMemo(
    () => ({
      cacheHint:
        language === "fa"
          ? "برای شروع کش کردن، آهنگ را لایک کنید"
          : "Like the song to start caching",
      cachedPercent: (value: number) =>
        language === "fa" ? `کش شده: ${value}%` : `Cached: ${value}%`,
      downloaded: (value: number) =>
        language === "fa"
          ? `دانلود شده: ${value.toFixed(1)}MB`
          : `Downloaded: ${value.toFixed(1)}MB`,
      total: (value: number) =>
        language === "fa"
          ? `کل: ${value.toFixed(1)}MB`
          : `Total: ${value.toFixed(1)}MB`,
      lyricsOffTitle:
        language === "fa"
          ? "متن ترانه در تنظیمات خاموش است"
          : "Lyrics are turned off in settings",
      lyricsOffDescription:
        language === "fa"
          ? "برای نمایش متن ترانه، آن را از تنظیمات فعال کنید"
          : "Enable lyrics in Settings to show them here",
      lyricsRetry:
        language === "fa"
          ? "بعداً دوباره امتحان کنید یا اتصال اینترنت را بررسی کنید"
          : "Try again later or check your internet connection",
      lyricsUnavailable:
        language === "fa"
          ? "متن ترانه برای این آهنگ در دسترس نیست"
          : "Lyrics not available for this track",
      lyricsExpansion:
        language === "fa"
          ? "ما همیشه در حال گسترش پایگاه داده متن ترانه هستیم"
          : "We're always working to expand our lyrics database",
      noPlaylists:
        language === "fa" ? "هیچ پلی‌لیستی پیدا نشد" : "No playlists found",
      createPlaylistHint:
        language === "fa"
          ? "اول یک پلی‌لیست بسازید تا بتوانید آهنگ‌ها را اضافه کنید"
          : "Create a playlist first to add songs",
      songCount: (count: number) =>
        language === "fa"
          ? `${count} ${count === 1 ? "آهنگ" : "آهنگ"}`
          : `${count} ${count === 1 ? "song" : "songs"}`,
      upNext: language === "fa" ? "در صف" : "Up Next",
      queuePosition: (position: number, total: number) =>
        language === "fa"
          ? `${position} از ${total} در صف`
          : `${position} of ${total} in queue`,
      noUpNext:
        language === "fa"
          ? "آهنگ دیگری در صف فعلی نیست"
          : "No more tracks in the current queue",
      tapToPlay:
        language === "fa"
          ? "برای پخش مستقیم روی هر آهنگ بزنید"
          : "Tap any track to play it right away",
      showUpNext: language === "fa" ? "نمایش پیشنهادها" : "Show suggestions",
      hideUpNext: language === "fa" ? "بستن پیشنهادها" : "Close suggestions",
      manualSearchNoResult:
        language === "fa"
          ? "متن آهنگ پیدا نشد. نام هنرمند یا عنوان را تغییر دهید."
          : "No lyrics found. Try another artist or song title.",
      manualSearchFailed:
        language === "fa"
          ? "جستجوی دستی متن آهنگ انجام نشد. دوباره امتحان کنید."
          : "Couldn't load lyrics for that search. Try another spelling.",
    }),
    [language]
  );

  useEffect(() => {
    setIsSuggestionPanelVisible(true);
  }, [currentTrack?.id]);

  useEffect(() => {
    setIsHighResArtworkReady(
      !!fullscreenArtworkSources.highRes &&
        fullscreenArtworkSources.highRes === fullscreenArtworkSources.lowRes
    );
  }, [
    currentTrack?.id,
    fullscreenArtworkSources.highRes,
    fullscreenArtworkSources.lowRes,
  ]);

  const playerSheetOptions = React.useMemo(
    () => [
      {
        key: "Share",
        label: language === "fa" ? "اشتراک‌گذاری" : "Share",
        icon: "share-outline",
      },
      {
        key: "Add to other playlist",
        label:
          language === "fa"
            ? "افزودن به پلی‌لیست دیگر"
            : "Add to other playlist",
        icon: "add-circle-outline",
      },
      {
        key: "Go to album",
        label: language === "fa" ? "رفتن به آلبوم" : "Go to album",
        icon: "albums-outline",
      },
      {
        key: "Go to artists",
        label: language === "fa" ? "رفتن به هنرمند" : "Go to artists",
        icon: "people-outline",
      },
      {
        key: "Sleep timer",
        label: language === "fa" ? "تایمر خواب" : "Sleep timer",
        icon: "time-outline",
      },
      {
        key: "Go to song radio",
        label: language === "fa" ? "رفتن به رادیوی آهنگ" : "Go to song radio",
        icon: "radio-outline",
      },
      {
        key: "View song credits",
        label: language === "fa" ? "مشاهده عوامل آهنگ" : "View song credits",
        icon: "information-circle-outline",
      },
    ],
    [language]
  );

  // Memoize position calculations to prevent unnecessary re-renders
  const displayPositionSeconds = React.useMemo(() => {
    const trackDuration = currentTrack?.duration || 0;
    const systemDuration = duration > 0 ? duration : trackDuration;
    const effectiveDuration = Math.max(systemDuration, 1);
    const currentPosition = position >= 0 ? position : 0;
    const displayPosition = isSeeking
      ? seekValue
      : (pendingSeekValue ?? currentPosition);
    const calculatedPosition = Math.min(
      Math.max(displayPosition, 0),
      effectiveDuration
    );

    return calculatedPosition;
  }, [
    position,
    duration,
    currentTrack?.duration,
    isSeeking,
    seekValue,
    pendingSeekValue,
  ]);

  // Memoize effective duration to prevent unnecessary updates
  const effectiveDurationSeconds = React.useMemo(() => {
    // Priority: system duration > track duration > fallback 1 second
    const systemDuration = duration > 0 ? duration : 0;
    const trackDuration = currentTrack?.duration || 0;
    const totalDurationSeconds = systemDuration || trackDuration || 1;

    console.log(
      `[FullPlayerModal] Duration calculation - systemDuration: ${systemDuration}, trackDuration: ${trackDuration}, totalDurationSeconds: ${totalDurationSeconds}`
    );

    return totalDurationSeconds;
  }, [duration, currentTrack?.duration]);

  useEffect(() => {
    if (visible) {
      if (currentTrack) {
        const currentPosition = position >= 0 ? position : 0;
        setSeekValue(currentPosition);
        setIsSeeking(false);
        setPendingSeekValue(null);
        setIsSeekPending(false);
      }
    } else {
      setIsSeeking(false);
      setPendingSeekValue(null);
      setIsSeekPending(false);
    }
  }, [visible, currentTrack?.id]);

  const syncedLyrics = React.useMemo(
    () =>
      isSyncedLyrics
        ? buildTimedLyrics(lyricsText, effectiveDurationSeconds)
        : [],
    [effectiveDurationSeconds, isSyncedLyrics, lyricsText]
  );

  const plainLyricsLines = React.useMemo(
    () => lyricsText.split("\n").filter((line) => line.trim()),
    [lyricsText]
  );

  const currentLyricIndex = React.useMemo(() => {
    if (!syncedLyrics.length) {
      return -1;
    }
    return findActiveLyricIndex(syncedLyrics, displayPositionSeconds);
  }, [displayPositionSeconds, syncedLyrics]);

  const isLyricsManualMode = lyricsManualModeUntil > Date.now();

  useEffect(() => {
    if (!lyricsManualModeUntil) {
      return;
    }

    const remainingMs = lyricsManualModeUntil - Date.now();
    if (remainingMs <= 0) {
      setLyricsManualModeUntil(0);
      return;
    }

    const timer = setTimeout(() => {
      setLyricsManualModeUntil(0);
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [lyricsManualModeUntil]);

  useEffect(() => {
    if (!currentTrack) {
      setManualLyricsArtist("");
      setManualLyricsTitle("");
      return;
    }

    setManualLyricsArtist(currentTrack.artist || "");
    setManualLyricsTitle(currentTrack.title || "");
    setLyricsManualModeUntil(0);
    lyricsLineLayoutsRef.current = {};
  }, [currentTrack?.artist, currentTrack?.id, currentTrack?.title]);

  useEffect(() => {
    if (!settings.autoScrollLyrics || !syncedLyrics.length) {
      return;
    }
    if (
      currentLyricIndex < 0 ||
      isLyricsManualMode ||
      lyricsViewportHeight <= 0
    ) {
      return;
    }

    const activeLayout = lyricsLineLayoutsRef.current[currentLyricIndex];
    if (!activeLayout || !lyricsScrollRef.current) {
      return;
    }

    const targetY = Math.max(
      0,
      activeLayout.y + activeLayout.height / 2 - lyricsViewportHeight / 2
    );
    lyricsScrollRef.current.scrollTo({
      y: targetY,
      animated: !settings.disableAnimations,
    });
  }, [
    currentLyricIndex,
    isLyricsManualMode,
    lyricsViewportHeight,
    settings.autoScrollLyrics,
    settings.disableAnimations,
    syncedLyrics.length,
  ]);

  // Reset seek value when track changes to prevent stuck progress bar
  useEffect(() => {
    if (currentTrack) {
      const nextPosition = position >= 0 ? position : 0;
      setSeekValue(nextPosition);
      setIsSeeking(false);
      setPendingSeekValue(null);
      setIsSeekPending(false);
    }
  }, [currentTrack?.id]);

  useEffect(() => {
    if (pendingSeekValue === null) {
      return;
    }

    const currentPosition = position >= 0 ? position : 0;
    const hasReachedTarget =
      Math.abs(currentPosition - pendingSeekValue) <= 1.5;

    if (hasReachedTarget) {
      setPendingSeekValue(null);
      setIsSeekPending(false);
      setSeekValue(currentPosition);
    }
  }, [pendingSeekValue, position]);

  const animateSheet = (state: "closed" | "half" | "full") => {
    let toValue = SHEET_CLOSED_TOP;
    if (state === "closed") {
      setSheetHeight(SHEET_HEIGHT);
      toValue = SHEET_CLOSED_TOP;
    } else if (state === "half") {
      setSheetHeight(SHEET_HEIGHT);
      toValue = SHEET_HALF_TOP;
    } else if (state === "full") {
      setSheetHeight(height);
      toValue = 0;
    }

    Animated.timing(sheetTop, {
      toValue,
      duration: 250,
      useNativeDriver: false,
    }).start(() => {
      sheetStateRef.current = state;
      if (state === "closed") {
        setIsOptionsVisible(false);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 2,
      onPanResponderMove: (_, gestureState) => {
        const base =
          sheetStateRef.current === "full"
            ? 0
            : sheetStateRef.current === "half"
              ? SHEET_HALF_TOP
              : SHEET_CLOSED_TOP;
        let next = base + gestureState.dy;
        if (next < 0) {
          next = 0;
        }
        if (next > SHEET_CLOSED_TOP) {
          next = SHEET_CLOSED_TOP;
        }
        sheetTop.setValue(next);
      },
      onPanResponderRelease: (_, gestureState) => {
        const { dy, vy } = gestureState;
        let target: "closed" | "half" | "full" = sheetStateRef.current;

        if (sheetStateRef.current === "half") {
          if (dy > 60 || vy > 0.5) {
            target = "closed";
          } else if (dy < -60 || vy < -0.5) {
            target = "full";
          } else {
            target = "half";
          }
        } else if (sheetStateRef.current === "full") {
          if (dy > 60 || vy > 0.5) {
            target = "half";
          } else {
            target = "full";
          }
        }

        animateSheet(target);
      },
    })
  ).current;

  const openOptions = () => {
    setIsOptionsVisible(true);
    animateSheet("half");
  };

  const closeOptions = () => {
    animateSheet("closed");
  };

  const loadUserPlaylists = async () => {
    try {
      const allPlaylists = await StorageService.loadPlaylists();
      // Filter out system playlists (liked songs and previously played are not in user playlists)
      setUserPlaylists(allPlaylists);
    } catch (error) {
      console.error("[FullPlayerModal] Error loading playlists:", error);
    }
  };

  const handlePlaylistSelect = async (playlist: Playlist) => {
    if (!currentTrack) {
      console.warn("[FullPlayerModal] No current track to add");
      return;
    }

    try {
      // Check if song is already in playlist
      const isAlreadyInPlaylist = playlist.tracks.some(
        (track) => track.id === currentTrack.id
      );

      if (isAlreadyInPlaylist) {
        console.log("[FullPlayerModal] Song already in playlist");
        setShowPlaylistSelection(false);
        return;
      }

      // Add current track to playlist
      const updatedPlaylist = {
        ...playlist,
        tracks: [...playlist.tracks, currentTrack],
        updatedAt: new Date().toISOString(),
      };

      await StorageService.updatePlaylist(updatedPlaylist);
      console.log("[FullPlayerModal] Song added to playlist:", playlist.name);

      // Notify parent component that playlist was updated
      if (onPlaylistUpdated) {
        onPlaylistUpdated();
      }

      setShowPlaylistSelection(false);
    } catch (error) {
      console.error("[FullPlayerModal] Error adding song to playlist:", error);
    }
  };

  const handleOptionPress = (option: string) => {
    console.log("[FullPlayerModal] Option selected:", option);
    animateSheet("closed");

    if (option === "Add to other playlist") {
      loadUserPlaylists();
      setShowPlaylistSelection(true);
    }
  };

  // Only fetch lyrics while the fullscreen player is open.
  useEffect(() => {
    let cancelled = false;

    const resetLyricsState = () => {
      if (cancelled) {
        return;
      }
      setLyricsText("");
      setIsSyncedLyrics(false);
      setLyricsError(null);
      setIsLoadingLyrics(false);
      setLyricsManualModeUntil(0);
      lyricsLineLayoutsRef.current = {};
    };

    const fetchLyrics = async () => {
      if (!currentTrack) {
        resetLyricsState();
        return;
      }

      if (!visible || !settings.lyricsEnabled) {
        if (!cancelled) {
          setIsLoadingLyrics(false);
          setLyricsError(null);
        }
        return;
      }

      if (!cancelled) {
        setLyricsText("");
        setIsSyncedLyrics(false);
      }
      setLyricsError(null);
      setIsLoadingLyrics(true);
      console.log("[FullPlayerModal] Starting lyrics fetch...");

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Lyrics fetch timeout")), 15000)
      );

      try {
        const cachedLyrics = (await Promise.race([
          lyricsService.getLyrics(currentTrack),
          timeoutPromise,
        ])) as CachedLyrics | null;

        if (cancelled) {
          return;
        }

        if (cachedLyrics) {
          setLyricsText(cachedLyrics.lyrics);
          setIsSyncedLyrics(Boolean(cachedLyrics.isSynced));
          setLyricsError(null);
        } else {
          setLyricsText("");
          setIsSyncedLyrics(false);
          setLyricsError(t("fullscreen.lyricsUnavailable"));
        }
      } catch (error) {
        console.error(
          "[FullPlayerModal] Error or timeout fetching lyrics:",
          error
        );
        if (cancelled) {
          return;
        }
        setLyricsText("");
        setIsSyncedLyrics(false);
        setLyricsError(t("player.errors.couldnt_load_lyrics"));
      } finally {
        if (!cancelled) {
          setIsLoadingLyrics(false);
        }
      }
    };

    void fetchLyrics();

    return () => {
      cancelled = true;
    };
  }, [currentTrack, settings.lyricsEnabled, t, visible]);

  // Update cache info when cacheProgress changes
  useEffect(() => {
    if (cacheProgress && currentTrack?.id === cacheProgress.trackId) {
      // Update cache info with the new percentage
      setCacheInfo((prev) =>
        prev
          ? prev.isFullyCached
            ? prev
            : {
                ...prev,
                percentage: Math.max(
                  prev.percentage || 0,
                  cacheProgress.percentage
                ),
                isDownloading: cacheProgress.percentage >= 100 ? false : true,
              }
          : {
              percentage: cacheProgress.percentage,
              fileSize: 0,
              totalFileSize: 0,
              isFullyCached: false,
              isDownloading: cacheProgress.percentage >= 100 ? false : true,
            }
      );
    }
  }, [cacheProgress, currentTrack?.id]);

  // Position and duration are now managed by PlayerContext via PlaybackProgressUpdated events
  // This provides real-time updates instead of 1-second intervals

  // Cache info update effect
  useEffect(() => {
    if (!currentTrack?.audioUrl) {
      setCacheInfo(null);
      return;
    }

    const updateCacheInfo = async () => {
      try {
        const info = await getCacheInfo(currentTrack.id);
        if (info) {
          setCacheInfo(info);
        }
      } catch (error) {
        // Silently ignore cache info errors
      }
    };

    updateCacheInfo();
    const cacheInterval = setInterval(updateCacheInfo, 1000); // Live cache stats - update every second
    return () => clearInterval(cacheInterval);
  }, [currentTrack?.audioUrl, currentTrack?.id, getCacheInfo]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      appState.current = nextState;
      if (nextState === "active" && currentTrack?.id && currentTrack.audioUrl) {
        getCacheInfo(currentTrack.id)
          .then((info) => {
            if (info) {
              setCacheInfo(info);
            }
          })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, [currentTrack?.id, currentTrack?.audioUrl, getCacheInfo]);

  const handleSeek = async (valueSeconds: number) => {
    setIsSeeking(false);
    setSeekValue(valueSeconds);
    setPendingSeekValue(valueSeconds);
    setIsSeekPending(true);
    const targetSeconds = valueSeconds;
    try {
      await seekTo(targetSeconds);
    } catch (error) {
      setPendingSeekValue(null);
      setIsSeekPending(false);
      setSeekValue(position);
    }
  };

  const canSeek = !!currentTrack && effectiveDurationSeconds > 0;
  const displayedSeekValue = clamp(
    isSeeking ? seekValue : displayPositionSeconds || 0,
    0,
    effectiveDurationSeconds || 1
  );
  const seekRatio =
    effectiveDurationSeconds > 0
      ? clamp(displayedSeekValue / effectiveDurationSeconds, 0, 1)
      : 0;
  const thumbOffset =
    seekBarWidth > 0 ? clamp(seekRatio * seekBarWidth, 0, seekBarWidth) : 0;

  const resolveSeekValueFromX = React.useCallback(
    (locationX: number) => {
      if (seekBarWidth <= 0 || effectiveDurationSeconds <= 0) {
        return 0;
      }

      const ratio = clamp(locationX / seekBarWidth, 0, 1);
      return ratio * effectiveDurationSeconds;
    },
    [effectiveDurationSeconds, seekBarWidth]
  );

  const previewSeekValue = React.useCallback(
    (locationX: number) => {
      const nextValue = resolveSeekValueFromX(locationX);
      setIsSeeking(true);
      setSeekValue(nextValue);
      return nextValue;
    },
    [resolveSeekValueFromX]
  );

  const commitSeekValue = React.useCallback(
    (valueSeconds: number) => {
      if (!canSeek) {
        return;
      }

      void handleSeek(clamp(valueSeconds, 0, effectiveDurationSeconds));
    },
    [canSeek, effectiveDurationSeconds]
  );

  const handleSeekBarLayout = React.useCallback((event: LayoutChangeEvent) => {
    setSeekBarWidth(event.nativeEvent.layout.width);
  }, []);

  const seekBarPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canSeek,
        onStartShouldSetPanResponderCapture: () => canSeek,
        onMoveShouldSetPanResponder: () => canSeek,
        onMoveShouldSetPanResponderCapture: () => canSeek,
        onPanResponderGrant: (event: any) => {
          previewSeekValue(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event: any) => {
          previewSeekValue(event.nativeEvent.locationX);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (event: any) => {
          commitSeekValue(previewSeekValue(event.nativeEvent.locationX));
        },
        onPanResponderTerminate: () => {
          setIsSeeking(false);
          setSeekValue(position >= 0 ? position : 0);
        },
      }),
    [canSeek, commitSeekValue, position, previewSeekValue]
  );

  const handleSeekAccessibilityAction = React.useCallback(
    (event: AccessibilityActionEvent) => {
      if (!canSeek) {
        return;
      }

      const actionName = event.nativeEvent.actionName;
      if (actionName === "increment") {
        commitSeekValue(displayedSeekValue + SEEK_STEP_SECONDS);
      } else if (actionName === "decrement") {
        commitSeekValue(displayedSeekValue - SEEK_STEP_SECONDS);
      }
    },
    [canSeek, commitSeekValue, displayedSeekValue]
  );

  const handlePlayPause = async () => {
    await playPause();
  };

  const handleNext = async () => {
    console.log("[FullPlayerModal] Next button pressed");
    await nextTrack();
  };

  const handlePrevious = async () => {
    console.log("[FullPlayerModal] Previous button pressed");
    await previousTrack();
  };

  const handleLike = () => {
    if (currentTrack) {
      toggleLikeSong(currentTrack);
    }
  };

  const runManualLyricsSearch = React.useCallback(async () => {
    if (!currentTrack) {
      return;
    }

    const nextArtist = manualLyricsArtist.trim() || currentTrack.artist || "";
    const nextTitle = manualLyricsTitle.trim() || currentTrack.title || "";

    setIsLoadingLyrics(true);
    setLyricsError(null);
    setLyricsText("");
    setIsSyncedLyrics(false);
    setLyricsManualModeUntil(0);
    lyricsLineLayoutsRef.current = {};

    try {
      const payload = await lyricsService.getLyrics(
        {
          ...currentTrack,
          artist: nextArtist,
          title: nextTitle,
        },
        { force: true }
      );

      if (!payload?.lyrics) {
        setLyricsError(copy.manualSearchNoResult);
        return;
      }

      setLyricsText(payload.lyrics);
      setIsSyncedLyrics(Boolean(payload.isSynced));
      setLyricsError(null);
    } catch {
      setLyricsError(copy.manualSearchFailed);
    } finally {
      setIsLoadingLyrics(false);
    }
  }, [
    copy.manualSearchFailed,
    copy.manualSearchNoResult,
    currentTrack,
    manualLyricsArtist,
    manualLyricsTitle,
  ]);

  const handleUpNextPress = async (queueIndex: number) => {
    const queuedTrack = playlist[queueIndex];

    if (!queuedTrack) {
      return;
    }

    await playTrack(queuedTrack, playlist, queueIndex);
  };

  if (!currentTrack) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <ModalContainer style={{ backgroundColor: colors.background }}>
        <BackgroundContainer>
          <BackgroundImage
            source={{
              uri:
                fullscreenArtworkUrl ||
                "https://placehold.co/400x400/000000/ffffff?text=Music",
            }}
            resizeMode="cover"
            blurRadius={4}
          />
          <BlurOverlay intensity={10} tint={isLight ? "light" : "dark"} />
          <DarkOverlay
            style={{ backgroundColor: withOpacity(colors.heroMid, 0.5) }}
          />
          <GradientOverlay
            colors={[
              withOpacity(colors.heroStart, 0.18),
              withOpacity(colors.heroMid, 0.72),
              withOpacity(colors.background, 0.92),
            ]}
            locations={[0, 0.6, 0.85]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          />
        </BackgroundContainer>
        <SafeArea edges={["top"]}>
          <View style={{ flex: 1, direction: isRtl ? "rtl" : "ltr" }}>
            <Header style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
              <BackButton onPress={onClose}>
                <Ionicons name="chevron-down" size={24} color={iconColor} />
              </BackButton>
              <MoreButton onPress={openOptions}>
                <Ionicons
                  name="ellipsis-vertical"
                  size={20}
                  color={iconColor}
                />
              </MoreButton>
            </Header>

            {/* Content with ScrollView for full screen scrollability */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              scrollEnabled={!isSeeking}
              nestedScrollEnabled
              contentContainerStyle={{ paddingBottom: 40 }}
            >
              {fullscreenArtworkSources.lowRes ? (
                <AlbumArtWrapper>
                  <AlbumArtWithOpacity
                    source={{ uri: fullscreenArtworkSources.lowRes }}
                    showCache={showCacheSize}
                  />
                  {fullscreenArtworkSources.highRes &&
                  fullscreenArtworkSources.highRes !==
                    fullscreenArtworkSources.lowRes ? (
                    <AlbumArtWithOpacity
                      source={{ uri: fullscreenArtworkSources.highRes }}
                      showCache={showCacheSize}
                      onLoad={() => setIsHighResArtworkReady(true)}
                      style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0,
                        opacity: isHighResArtworkReady
                          ? showCacheSize
                            ? 0.2
                            : 1
                          : 0,
                      }}
                    />
                  ) : null}
                  {showCacheSize && (
                    <CacheOverlay>
                      <CacheInfoContainer>
                        {!isSongLiked(currentTrack.id) ? (
                          <CacheInfoRow>{copy.cacheHint}</CacheInfoRow>
                        ) : cacheInfo ? (
                          <>
                            <CacheInfoRow>
                              {cacheInfo.isDownloading &&
                              !cacheInfo.isFullyCached &&
                              cacheInfo.percentage <= 0
                                ? t("player.caching")
                                : cacheInfo.isFullyCached
                                  ? copy.cachedPercent(100)
                                  : copy.cachedPercent(
                                      Math.round(cacheInfo.percentage)
                                    )}
                            </CacheInfoRow>
                            {cacheInfo.fileSize > 0 && (
                              <CacheInfoRow>
                                {copy.downloaded(cacheInfo.fileSize)}
                              </CacheInfoRow>
                            )}
                            {cacheInfo.totalFileSize > 0 && (
                              <CacheInfoRow>
                                {copy.total(cacheInfo.totalFileSize)}
                              </CacheInfoRow>
                            )}
                          </>
                        ) : (
                          <CacheInfoRow>{t("player.caching")}</CacheInfoRow>
                        )}
                      </CacheInfoContainer>
                    </CacheOverlay>
                  )}
                  <CacheTouchable
                    onPress={() => setShowCacheSize(!showCacheSize)}
                    activeOpacity={1}
                  />
                </AlbumArtWrapper>
              ) : (
                <AlbumArtWrapper>
                  <PlaceholderAlbumArtWithOpacity showCache={showCacheSize}>
                    <Ionicons
                      name="musical-notes"
                      size={80}
                      color={iconColor}
                    />
                  </PlaceholderAlbumArtWithOpacity>
                  {showCacheSize && (
                    <CacheOverlay>
                      <CacheInfoContainer>
                        {!isSongLiked(currentTrack.id) ? (
                          <CacheInfoRow>{copy.cacheHint}</CacheInfoRow>
                        ) : cacheInfo ? (
                          <CacheInfoRow>
                            {cacheInfo.isDownloading &&
                            !cacheInfo.isFullyCached &&
                            cacheInfo.percentage <= 0
                              ? t("player.caching")
                              : cacheInfo.isFullyCached
                                ? copy.cachedPercent(100)
                                : copy.cachedPercent(
                                    Math.round(cacheInfo.percentage)
                                  )}
                          </CacheInfoRow>
                        ) : (
                          <CacheInfoRow>{t("player.caching")}</CacheInfoRow>
                        )}
                      </CacheInfoContainer>
                    </CacheOverlay>
                  )}
                  <CacheTouchable
                    onPress={() => setShowCacheSize(!showCacheSize)}
                    activeOpacity={1}
                  />
                </AlbumArtWrapper>
              )}

              <TrackRow
                style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
              >
                <TrackInfo
                  style={{ alignItems: isRtl ? "flex-end" : "flex-start" }}
                >
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 24,
                      fontFamily: getAppFontFamily(isRtl, "bold"),
                      lineHeight: 28,
                      ...getTextDirectionStyle(isRtl),
                    }}
                    adjustsFontSizeToFit={true}
                    minimumFontScale={0.7}
                    numberOfLines={3}
                    allowFontScaling={false}
                  >
                    {currentTrack.title}
                  </Text>
                  {currentTrack.artist && (
                    <Text
                      style={{
                        color: mutedTextColor,
                        fontSize: 18,
                        marginTop: 2,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        lineHeight: 22,
                        ...getTextDirectionStyle(isRtl),
                      }}
                      adjustsFontSizeToFit={true}
                      minimumFontScale={0.8}
                      numberOfLines={3}
                      allowFontScaling={false}
                    >
                      {currentTrack.artist}
                    </Text>
                  )}
                </TrackInfo>

                <LikeButton
                  onPress={handleLike}
                  style={{
                    paddingHorizontal: 12,
                    marginLeft: isRtl ? 0 : 16,
                    marginRight: isRtl ? 16 : 0,
                  }}
                >
                  <Entypo
                    name={
                      isSongLiked(currentTrack.id) ? "heart" : "heart-outlined"
                    }
                    size={24}
                    color={iconColor}
                  />
                </LikeButton>
              </TrackRow>

              <Spacer size={32} />

              <ProgressContainer>
                <ProgressBarContainer>
                  <View
                    onLayout={handleSeekBarLayout}
                    accessible
                    focusable
                    accessibilityRole="adjustable"
                    accessibilityLabel={
                      language === "fa" ? "تغییر موقعیت پخش" : "Seek playback"
                    }
                    accessibilityActions={[
                      {
                        name: "decrement",
                        label: language === "fa" ? "عقب بردن" : "Seek backward",
                      },
                      {
                        name: "increment",
                        label: language === "fa" ? "جلو بردن" : "Seek forward",
                      },
                    ]}
                    accessibilityValue={{
                      min: 0,
                      max: Math.round(effectiveDurationSeconds || 0),
                      now: Math.round(displayedSeekValue),
                      text: `${formatTime(displayedSeekValue * 1000)} / ${formatTime(
                        (effectiveDurationSeconds || 0) * 1000
                      )}`,
                    }}
                    onAccessibilityAction={handleSeekAccessibilityAction}
                    {...seekBarPanResponder.panHandlers}
                    style={{
                      width: "100%",
                      height: 40,
                      justifyContent: "center",
                    }}
                  >
                    <ProgressTrack
                      style={{
                        backgroundColor: withOpacity(colors.foreground, 0.24),
                      }}
                    >
                      <ProgressFill
                        style={{
                          width: `${seekRatio * 100}%`,
                          backgroundColor: colors.foreground,
                        }}
                      />
                    </ProgressTrack>
                    <ProgressThumb
                      pointerEvents="none"
                      style={{
                        left: thumbOffset,
                        backgroundColor: colors.foreground,
                        borderColor: colors.background,
                      }}
                    />
                  </View>
                </ProgressBarContainer>
                <TimeContainer>
                  <TimeText
                    style={{ fontFamily: getAppFontFamily(isRtl, "medium") }}
                  >
                    {formatTime((displayPositionSeconds || 0) * 1000)}
                  </TimeText>
                  <TimeText
                    style={{ fontFamily: getAppFontFamily(isRtl, "medium") }}
                  >
                    {formatTime((effectiveDurationSeconds || 0) * 1000)}
                  </TimeText>
                </TimeContainer>
              </ProgressContainer>

              <Spacer size={32} />

              <Controls>
                <ControlButton onPress={toggleShuffle}>
                  <Ionicons
                    name="shuffle"
                    size={24}
                    color={isShuffled ? activeAccentColor : iconColor}
                  />
                </ControlButton>

                <ControlButton onPress={handlePrevious}>
                  <Ionicons
                    name={previousIconName}
                    size={24}
                    color={iconColor}
                  />
                </ControlButton>

                <PlayPauseButton
                  style={{ backgroundColor: colors.foreground }}
                  onPress={
                    isLoading || isTransitioning
                      ? cancelLoadingState
                      : handlePlayPause
                  }
                  disabled={isSeekPending}
                >
                  {isLoading || isTransitioning || isSeekPending ? (
                    <ActivityIndicator
                      size="small"
                      color={playerActionColor}
                      style={{ width: 24, height: 24 }}
                    />
                  ) : (
                    <Ionicons
                      name={isPlaying ? "pause" : "play"}
                      size={24}
                      color={playerActionColor}
                    />
                  )}
                </PlayPauseButton>

                <ControlButton onPress={handleNext}>
                  <Ionicons name={nextIconName} size={24} color={iconColor} />
                </ControlButton>

                <ControlButton
                  onPress={() => {
                    // Cycle through repeat modes: off -> all -> one -> off
                    if (repeatMode === "off") {
                      setRepeatMode("all");
                    } else if (repeatMode === "all") {
                      setRepeatMode("one");
                    } else {
                      setRepeatMode("off");
                    }
                  }}
                >
                  <Ionicons
                    name={repeatMode === "off" ? "repeat-outline" : "repeat"}
                    size={24}
                    color={repeatMode === "off" ? iconColor : activeAccentColor}
                  />
                  {repeatMode === "one" && <RepeatNumber>1</RepeatNumber>}
                </ControlButton>
              </Controls>

              <Spacer size={24} />

              <LyricsCard
                style={{
                  backgroundColor: withOpacity(colors.surface1, 0.72),
                  borderColor: colors.borderSubtle,
                  borderWidth: 1,
                }}
              >
                <LyricsHeader
                  style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
                >
                  <LyricsTitle
                    style={{
                      color: colors.foreground,
                      fontFamily: getAppFontFamily(isRtl, "semibold"),
                      ...getTextDirectionStyle(isRtl),
                    }}
                  >
                    {t("player.lyrics")}
                  </LyricsTitle>
                </LyricsHeader>

                {!settings.lyricsEnabled ? (
                  <>
                    <LyricLine
                      isActive={false}
                      style={{
                        color: mutedTextColor,
                        opacity: 0.8,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {copy.lyricsOffTitle}
                    </LyricLine>
                    <LyricLine
                      isActive={false}
                      style={{
                        color: mutedTextColor,
                        opacity: 0.55,
                        fontSize: 12,
                        marginTop: 8,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {copy.lyricsOffDescription}
                    </LyricLine>
                  </>
                ) : isLoadingLyrics ? (
                  <ActivityIndicator
                    size="small"
                    color={mutedTextColor}
                    style={{ marginVertical: 20 }}
                  />
                ) : syncedLyrics.length > 0 ? (
                  <ScrollView
                    ref={lyricsScrollRef}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                    style={{ maxHeight: 240 }}
                    onLayout={(event) =>
                      setLyricsViewportHeight(event.nativeEvent.layout.height)
                    }
                    onScrollBeginDrag={() =>
                      setLyricsManualModeUntil(
                        Date.now() + LYRICS_MANUAL_SCROLL_HOLD_MS
                      )
                    }
                    contentContainerStyle={{
                      paddingTop:
                        currentLyricIndex <= 0
                          ? 8
                          : Math.max(56, lyricsViewportHeight / 2 - 28),
                      paddingBottom: Math.max(
                        56,
                        lyricsViewportHeight / 2 - 28
                      ),
                    }}
                    scrollEventThrottle={16}
                  >
                    {syncedLyrics.map((line, index) => (
                      <TouchableOpacity
                        key={`${line.startTime}-${line.text}-${index}`}
                        activeOpacity={0.84}
                        onPress={() => {
                          setLyricsManualModeUntil(0);
                          void seekTo(line.startTime);
                        }}
                        onLayout={(event) => {
                          lyricsLineLayoutsRef.current[index] = {
                            y: event.nativeEvent.layout.y,
                            height: event.nativeEvent.layout.height,
                          };
                        }}
                        style={{
                          alignSelf: "stretch",
                          borderRadius: 12,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          backgroundColor:
                            index === currentLyricIndex
                              ? withOpacity(colors.foreground, 0.08)
                              : "transparent",
                        }}
                      >
                        <LyricLine
                          isActive={index === currentLyricIndex}
                          style={{
                            color:
                              index === currentLyricIndex
                                ? colors.foreground
                                : mutedTextColor,
                            opacity:
                              index === currentLyricIndex
                                ? 1
                                : currentLyricIndex > index
                                  ? 0.46
                                  : 0.78,
                            fontFamily: getAppFontFamily(
                              isRtl,
                              index === currentLyricIndex ? "medium" : "regular"
                            ),
                            ...getTextDirectionStyle(
                              isRtl,
                              isRtl ? "right" : "left"
                            ),
                          }}
                        >
                          {line.text}
                        </LyricLine>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : plainLyricsLines.length > 0 ? (
                  <>
                    <LyricLine
                      isActive={false}
                      style={{
                        color: mutedTextColor,
                        opacity: 0.62,
                        fontSize: 12,
                        marginBottom: 8,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {t("fullscreen.syncedUnavailable")}
                    </LyricLine>
                    <ScrollView
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={false}
                      style={{ maxHeight: 240 }}
                      contentContainerStyle={{ paddingBottom: 8 }}
                    >
                      {plainLyricsLines.map((line, index) => (
                        <LyricLine
                          key={`${line}-${index}`}
                          isActive={false}
                          style={{
                            color: colors.foreground,
                            opacity: 0.92,
                            fontFamily: getAppFontFamily(isRtl, "regular"),
                            ...getTextDirectionStyle(isRtl),
                          }}
                        >
                          {line}
                        </LyricLine>
                      ))}
                    </ScrollView>
                  </>
                ) : lyricsError ? (
                  <>
                    <LyricLine
                      isActive={false}
                      style={{
                        color: mutedTextColor,
                        opacity: 0.7,
                        fontSize: 14,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {lyricsError}
                    </LyricLine>
                    <LyricLine
                      isActive={false}
                      style={{
                        color: mutedTextColor,
                        opacity: 0.55,
                        fontSize: 12,
                        marginTop: 8,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {copy.lyricsRetry}
                    </LyricLine>
                    <View
                      style={{
                        marginTop: 14,
                        gap: 10,
                      }}
                    >
                      <Text
                        style={{
                          color: mutedTextColor,
                          fontSize: 12,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {t("fullscreen.searchLyricsManually")}
                      </Text>
                      <TextInput
                        value={manualLyricsArtist}
                        onChangeText={setManualLyricsArtist}
                        placeholder={t("fullscreen.artistName")}
                        placeholderTextColor={withOpacity(mutedTextColor, 0.7)}
                        style={{
                          minHeight: 44,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: colors.borderSubtle,
                          backgroundColor: withOpacity(colors.surface2, 0.8),
                          paddingHorizontal: 14,
                          color: colors.foreground,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      />
                      <TextInput
                        value={manualLyricsTitle}
                        onChangeText={setManualLyricsTitle}
                        placeholder={t("fullscreen.songTitle")}
                        placeholderTextColor={withOpacity(mutedTextColor, 0.7)}
                        style={{
                          minHeight: 44,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: colors.borderSubtle,
                          backgroundColor: withOpacity(colors.surface2, 0.8),
                          paddingHorizontal: 14,
                          color: colors.foreground,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      />
                      <TouchableOpacity
                        activeOpacity={0.88}
                        disabled={
                          isLoadingLyrics ||
                          (!manualLyricsArtist.trim() &&
                            !manualLyricsTitle.trim())
                        }
                        onPress={() => {
                          void runManualLyricsSearch();
                        }}
                        style={{
                          minHeight: 44,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 999,
                          backgroundColor: colors.foreground,
                          opacity:
                            isLoadingLyrics ||
                            (!manualLyricsArtist.trim() &&
                              !manualLyricsTitle.trim())
                              ? 0.5
                              : 1,
                        }}
                      >
                        <Text
                          style={{
                            color: playerActionColor,
                            fontSize: 14,
                            fontFamily: getAppFontFamily(isRtl, "semibold"),
                            ...getTextDirectionStyle(isRtl, "center"),
                          }}
                        >
                          {t("common.tryLyricsSearch")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <LyricLine
                      isActive={false}
                      style={{
                        color: mutedTextColor,
                        opacity: 0.7,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {copy.lyricsUnavailable}
                    </LyricLine>
                    <LyricLine
                      isActive={false}
                      style={{
                        color: mutedTextColor,
                        opacity: 0.5,
                        fontSize: 12,
                        marginTop: 8,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {copy.lyricsExpansion}
                    </LyricLine>
                    <View
                      style={{
                        marginTop: 14,
                        gap: 10,
                      }}
                    >
                      <Text
                        style={{
                          color: mutedTextColor,
                          fontSize: 12,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {t("fullscreen.searchLyricsManually")}
                      </Text>
                      <TextInput
                        value={manualLyricsArtist}
                        onChangeText={setManualLyricsArtist}
                        placeholder={t("fullscreen.artistName")}
                        placeholderTextColor={withOpacity(mutedTextColor, 0.7)}
                        style={{
                          minHeight: 44,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: colors.borderSubtle,
                          backgroundColor: withOpacity(colors.surface2, 0.8),
                          paddingHorizontal: 14,
                          color: colors.foreground,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      />
                      <TextInput
                        value={manualLyricsTitle}
                        onChangeText={setManualLyricsTitle}
                        placeholder={t("fullscreen.songTitle")}
                        placeholderTextColor={withOpacity(mutedTextColor, 0.7)}
                        style={{
                          minHeight: 44,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: colors.borderSubtle,
                          backgroundColor: withOpacity(colors.surface2, 0.8),
                          paddingHorizontal: 14,
                          color: colors.foreground,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      />
                      <TouchableOpacity
                        activeOpacity={0.88}
                        disabled={
                          isLoadingLyrics ||
                          (!manualLyricsArtist.trim() &&
                            !manualLyricsTitle.trim())
                        }
                        onPress={() => {
                          void runManualLyricsSearch();
                        }}
                        style={{
                          minHeight: 44,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 999,
                          backgroundColor: colors.foreground,
                          opacity:
                            isLoadingLyrics ||
                            (!manualLyricsArtist.trim() &&
                              !manualLyricsTitle.trim())
                              ? 0.5
                              : 1,
                        }}
                      >
                        <Text
                          style={{
                            color: playerActionColor,
                            fontSize: 14,
                            fontFamily: getAppFontFamily(isRtl, "semibold"),
                            ...getTextDirectionStyle(isRtl, "center"),
                          }}
                        >
                          {t("common.tryLyricsSearch")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </LyricsCard>

              {isSuggestionPanelVisible ? (
                <View
                  style={{
                    marginTop: 20,
                    marginHorizontal: 28,
                    padding: 18,
                    borderRadius: 18,
                    backgroundColor: withOpacity(colors.surface1, 0.72),
                    borderWidth: 1,
                    borderColor: colors.borderSubtle,
                  }}
                >
                  <View
                    style={{
                      flexDirection: isRtl ? "row-reverse" : "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: colors.foreground,
                          fontSize: 16,
                          fontFamily: getAppFontFamily(isRtl, "bold"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {copy.upNext}
                      </Text>
                      <Text
                        style={{
                          color: mutedTextColor,
                          fontSize: 12,
                          marginTop: 4,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {playlist.length > 1
                          ? copy.queuePosition(
                              currentIndex + 1,
                              playlist.length
                            )
                          : copy.tapToPlay}
                      </Text>
                    </View>

                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={copy.hideUpNext}
                      onPress={() => setIsSuggestionPanelVisible(false)}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: withOpacity(colors.surface2, 0.72),
                        borderWidth: 1,
                        borderColor: withOpacity(colors.borderSubtle, 0.9),
                      }}
                    >
                      <Ionicons name="close" size={18} color={iconColor} />
                    </TouchableOpacity>
                  </View>

                  <View style={{ marginTop: 14, gap: 10 }}>
                    {upNextTracks.length > 0 ? (
                      upNextTracks.map(({ track, index }) => (
                        <TouchableOpacity
                          key={`${track.id}-${index}`}
                          onPress={() => {
                            void handleUpNextPress(index);
                          }}
                          style={{
                            flexDirection: isRtl ? "row-reverse" : "row",
                            alignItems: "center",
                            gap: 12,
                            borderRadius: 16,
                            padding: 12,
                            backgroundColor: withOpacity(colors.surface2, 0.76),
                            borderWidth: 1,
                            borderColor: withOpacity(colors.borderSubtle, 0.8),
                          }}
                        >
                          {track.thumbnail ? (
                            <View
                              style={{
                                width: 52,
                                height: 52,
                                borderRadius: 12,
                                overflow: "hidden",
                                backgroundColor: colors.surface2,
                              }}
                            >
                              <AlbumArt
                                source={{ uri: track.thumbnail }}
                                style={{ width: "100%", height: "100%" }}
                              />
                            </View>
                          ) : (
                            <View
                              style={{
                                width: 52,
                                height: 52,
                                borderRadius: 12,
                                backgroundColor: colors.surface2,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Ionicons
                                name="musical-notes"
                                size={20}
                                color={mutedTextColor}
                              />
                            </View>
                          )}

                          <View style={{ flex: 1 }}>
                            <Text
                              numberOfLines={1}
                              style={{
                                color: colors.foreground,
                                fontSize: 14,
                                fontFamily: getAppFontFamily(isRtl, "semibold"),
                                ...getTextDirectionStyle(isRtl),
                              }}
                            >
                              {track.title}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={{
                                color: mutedTextColor,
                                fontSize: 12,
                                marginTop: 3,
                                fontFamily: getAppFontFamily(isRtl, "regular"),
                                ...getTextDirectionStyle(isRtl),
                              }}
                            >
                              {track.artist ||
                                t("screens.artist.unknown_artist")}
                            </Text>
                          </View>

                          <Text
                            style={{
                              color: withOpacity(colors.foreground, 0.58),
                              fontSize: 12,
                              fontFamily: getAppFontFamily(isRtl, "semibold"),
                            }}
                          >
                            {index + 1}
                          </Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text
                        style={{
                          color: mutedTextColor,
                          fontSize: 13,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {copy.noUpNext}
                      </Text>
                    )}
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={copy.showUpNext}
                  onPress={() => setIsSuggestionPanelVisible(true)}
                  style={{
                    marginTop: 20,
                    marginHorizontal: 28,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderRadius: 18,
                    backgroundColor: withOpacity(colors.surface1, 0.6),
                    borderWidth: 1,
                    borderColor: colors.borderSubtle,
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: 15,
                        fontFamily: getAppFontFamily(isRtl, "bold"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {copy.showUpNext}
                    </Text>
                    <Text
                      style={{
                        color: mutedTextColor,
                        fontSize: 12,
                        marginTop: 4,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {playlist.length > 1
                        ? copy.queuePosition(currentIndex + 1, playlist.length)
                        : copy.tapToPlay}
                    </Text>
                  </View>

                  <Ionicons
                    name={isRtl ? "chevron-back" : "chevron-forward"}
                    size={18}
                    color={iconColor}
                  />
                </TouchableOpacity>
              )}

              <Spacer size={40} />
            </ScrollView>
          </View>
        </SafeArea>
        <SliderSheet
          visible={isOptionsVisible}
          onClose={closeOptions}
          sheetTop={sheetTop}
          sheetHeight={sheetHeight}
          panHandlers={panResponder.panHandlers}
          currentTrack={
            currentTrack || { title: "", artist: "", thumbnail: "" }
          }
          options={playerSheetOptions}
          onOptionPress={handleOptionPress}
        />

        {/* Playlist Selection Modal */}
        <PlaylistSelectionModal
          visible={showPlaylistSelection}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowPlaylistSelection(false)}
        >
          <PlaylistSelectionContainer
            style={{ backgroundColor: colors.background }}
          >
            <PlaylistSelectionHeader
              style={{
                borderBottomColor: colors.borderSubtle,
                flexDirection: isRtl ? "row-reverse" : "row",
              }}
            >
              <PlaylistSelectionTitle
                style={{
                  color: colors.foreground,
                  fontFamily: getAppFontFamily(isRtl, "bold"),
                  ...getTextDirectionStyle(isRtl),
                }}
              >
                {t("player.select_playlist")}
              </PlaylistSelectionTitle>
              <PlaylistSelectionClose
                onPress={() => setShowPlaylistSelection(false)}
              >
                <Ionicons name="close" size={24} color={iconColor} />
              </PlaylistSelectionClose>
            </PlaylistSelectionHeader>

            <ScrollView>
              {userPlaylists.map((playlist) => (
                <PlaylistItem
                  key={playlist.id}
                  onPress={() => handlePlaylistSelect(playlist)}
                  style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
                >
                  {playlist.tracks.length > 0 &&
                  playlist.tracks[0].thumbnail ? (
                    <PlaylistCover
                      source={{ uri: playlist.tracks[0].thumbnail }}
                      style={{
                        marginRight: isRtl ? 0 : 12,
                        marginLeft: isRtl ? 12 : 0,
                      }}
                    />
                  ) : (
                    <PlaylistPlaceholderCover
                      style={{
                        marginRight: isRtl ? 0 : 12,
                        marginLeft: isRtl ? 12 : 0,
                      }}
                    >
                      <Ionicons
                        name="musical-notes"
                        size={24}
                        color={withOpacity(iconColor, 0.42)}
                      />
                    </PlaylistPlaceholderCover>
                  )}
                  <PlaylistInfo>
                    <PlaylistName
                      style={{
                        color: colors.foreground,
                        fontFamily: getAppFontFamily(isRtl, "medium"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {playlist.name}
                    </PlaylistName>
                    <PlaylistMeta
                      style={{
                        color: mutedTextColor,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {copy.songCount(playlist.tracks.length)}
                    </PlaylistMeta>
                  </PlaylistInfo>
                </PlaylistItem>
              ))}

              {userPlaylists.length === 0 && (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <Text
                    style={{
                      color: mutedTextColor,
                      fontSize: 16,
                      fontFamily: getAppFontFamily(isRtl, "regular"),
                      ...getTextDirectionStyle(isRtl, "center"),
                    }}
                  >
                    {copy.noPlaylists}
                  </Text>
                  <Text
                    style={{
                      color: withOpacity(iconColor, 0.45),
                      fontSize: 14,
                      marginTop: 8,
                      fontFamily: getAppFontFamily(isRtl, "regular"),
                      ...getTextDirectionStyle(isRtl, "center"),
                    }}
                  >
                    {copy.createPlaylistHint}
                  </Text>
                </View>
              )}
            </ScrollView>
          </PlaylistSelectionContainer>
        </PlaylistSelectionModal>
      </ModalContainer>
    </Modal>
  );
};
