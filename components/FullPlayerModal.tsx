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
  ScrollView,
  View,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import { SliderProps } from "@react-native-community/slider";
import styled from "styled-components/native";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { Entypo } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import TrackPlayer from "../utils/safeTrackPlayer";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer } from "../contexts/PlayerContext";
import { formatTime } from "../utils/formatters";
import { CachedLyrics, lyricsService } from "../modules/lyricsService";
import { SliderSheet } from "./SliderSheet";
import { StorageService, Playlist } from "../utils/storage";

const { Animated, PanResponder } = require("react-native");

const { width, height } = Dimensions.get("window");
const SHEET_HEIGHT = height * 0.5;
const SHEET_CLOSED_TOP = height;
const SHEET_HALF_TOP = height - SHEET_HEIGHT;

const PLAYER_SHEET_OPTIONS = [
  { key: "Share", label: "Share", icon: "share-outline" },
  {
    key: "Add to other playlist",
    label: "Add to other playlist",
    icon: "add-circle-outline",
  },
  { key: "Go to album", label: "Go to album", icon: "albums-outline" },
  { key: "Go to artists", label: "Go to artists", icon: "people-outline" },
  { key: "Sleep timer", label: "Sleep timer", icon: "time-outline" },
  {
    key: "Go to song radio",
    label: "Go to song radio",
    icon: "radio-outline",
  },
  {
    key: "View song credits",
    label: "View song credits",
    icon: "information-circle-outline",
  },
];

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

const ProgressBarTouchable = styled.TouchableOpacity`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
`;

const ProgressSlider = React.forwardRef<Slider, SliderProps>((props, ref) => {
  return (
    <Slider
      ref={ref}
      {...props}
      style={[{ width: "100%", height: 40 }, props.style]}
      minimumTrackTintColor="#ffffff"
      maximumTrackTintColor="#666666"
      thumbTintColor="#ffffff"
    />
  );
});
ProgressSlider.displayName = "ProgressSlider";

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

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [seekPreviewSeconds, setSeekPreviewSeconds] = useState<number | null>(
    null
  );
  const progressBarWidthRef = useRef(0);
  const durationRef = useRef(0);
  const isUpdatingPositionRef = useRef(false);
  const progressSliderRef = useRef<Slider>(null);
  const positionRef = useRef(position);

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
  const [cacheRetryCount, setCacheRetryCount] = useState(0);
  const [showCacheSize, setShowCacheSize] = useState(false);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(0);
  const [lyricsData, setLyricsData] = useState<string[]>([]);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [isOptionsVisible, setIsOptionsVisible] = useState(false);
  const [sheetState, setSheetState] = useState<"closed" | "half" | "full">(
    "closed"
  );
  const [showPlaylistSelection, setShowPlaylistSelection] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const sheetTop = useRef(new Animated.Value(SHEET_CLOSED_TOP)).current;
  const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHT);
  const sheetStateRef = useRef<"closed" | "half" | "full">("closed");

  // Memoize position calculations to prevent unnecessary re-renders
  const displayPositionSeconds = React.useMemo(() => {
    // Ensure we always have valid duration and position values
    const trackDuration = currentTrack?.duration || 0;
    const systemDuration = duration > 0 ? duration : trackDuration;
    const effectiveDuration = Math.max(systemDuration, 1);

    // Use seekValue during normal playback for smooth updates, use position only when seeking
    const currentPosition = position >= 0 ? position : 0;
    const displayPosition = isSeeking
      ? seekPreviewSeconds !== null
        ? seekPreviewSeconds
        : seekValue
      : seekValue > 0
        ? seekValue
        : currentPosition;

    // Ensure position doesn't exceed duration
    const calculatedPosition = Math.min(
      Math.max(displayPosition, 0),
      effectiveDuration
    );

    console.log(
      `[FullPlayerModal] Position calculation - systemPosition: ${position}, seekValue: ${seekValue}, displayPosition: ${displayPosition}, effectiveDuration: ${effectiveDuration}, isSeeking: ${isSeeking}`
    );

    return calculatedPosition;
  }, [
    position,
    duration,
    currentTrack?.duration,
    isSeeking,
    seekPreviewSeconds,
    seekValue,
  ]);

  useEffect(() => {
    positionRef.current = position >= 0 ? position : 0;
  }, [position]);

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
    durationRef.current = effectiveDurationSeconds;
  }, [effectiveDurationSeconds]);

  useEffect(() => {
    if (visible) {
      console.log(
        `[FullPlayerModal] Modal became visible - position: ${position}, duration: ${duration}, effectiveDurationSeconds: ${effectiveDurationSeconds}, displayPositionSeconds: ${displayPositionSeconds}`
      );

      // Always initialize progress bar when modal becomes visible
      if (currentTrack) {
        const currentPosition = position >= 0 ? position : 0;
        console.log(
          `[FullPlayerModal] Setting seek value on visible: ${currentPosition}s`
        );
        setSeekValue(currentPosition);
        setIsSeeking(false);
        setSeekPreviewSeconds(null);

        // Reset position tracking for fresh start
        lastPositionRef.current = currentPosition;
        positionUpdateCounter.current = 0;
      }
    } else {
      // Reset seek state when modal closes to prevent stuck state
      console.log("[FullPlayerModal] Modal closed - resetting seek state");
      setIsSeeking(false);
      setSeekPreviewSeconds(null);
      setSeekValue(0);
      // Reset refs for next open
      lastPositionRef.current = 0;
      positionUpdateCounter.current = 0;
    }
  }, [visible]);

  // Update seek value when position changes (but not when user is seeking)
  useEffect(() => {
    if (!isSeeking && visible && currentTrack) {
      // Prevent updates if we're already updating to avoid flickering
      if (isUpdatingPositionRef.current) {
        return;
      }

      // Only update if position has changed significantly (0.5 second threshold)
      const positionChanged = Math.abs(position - seekValue) > 0.5;

      if (positionChanged) {
        console.log(
          `[FullPlayerModal] Position updated - setting seek value to: ${position}`
        );
        isUpdatingPositionRef.current = true;
        setSeekValue(position);
        lastPositionRef.current = position;
        positionUpdateCounter.current = 0;

        // Reset the flag after a short delay
        setTimeout(() => {
          isUpdatingPositionRef.current = false;
        }, 50);
      }
    }
  }, [position, isSeeking, visible, currentTrack, seekValue]);

  // Ensure smooth position updates during playback
  useEffect(() => {
    if (visible && !isSeeking && isPlaying && currentTrack) {
      // Skip if we're already updating to prevent conflicts
      if (isUpdatingPositionRef.current) {
        return;
      }

      // Only update seekValue when position changes significantly
      const positionChanged = Math.abs(position - seekValue) > 1.0; // 1.0 second threshold for smooth updates

      if (positionChanged) {
        console.log(
          `[FullPlayerModal] Smooth position update: ${position}s (was ${seekValue}s)`
        );
        isUpdatingPositionRef.current = true;
        setSeekValue(position);

        // Reset the flag after a short delay
        setTimeout(() => {
          isUpdatingPositionRef.current = false;
        }, 100);
      }
    }
  }, [position, isPlaying, isSeeking, visible, currentTrack]);

  useEffect(() => {
    if (!visible || !currentTrack) {
      return;
    }
    const intervalId = setInterval(() => {
      if (isSeeking) {
        return;
      }
      const currentPosition = positionRef.current;
      setSeekValue((prev) =>
        Math.abs(prev - currentPosition) > 0.5 ? currentPosition : prev,
      );
    }, 500);
    return () => clearInterval(intervalId);
  }, [visible, currentTrack?.id, isSeeking]);

  // Reset seek value when track changes to prevent stuck progress bar
  useEffect(() => {
    if (currentTrack) {
      console.log(
        `[FullPlayerModal] Track changed - resetting seek state for: ${currentTrack.title}`
      );
      const nextPosition = position >= 0 ? position : 0;
      setSeekValue(visible ? nextPosition : 0);
      setIsSeeking(false);
      setSeekPreviewSeconds(null);
    }
  }, [currentTrack?.id, position, visible]);

  // Immediate progress bar initialization when modal becomes visible
  useEffect(() => {
    if (visible && currentTrack) {
      console.log(
        `[FullPlayerModal] Immediate progress bar initialization - isPlaying: ${isPlaying}, position: ${position}`
      );

      // Force immediate render with available data
      const trackDuration = currentTrack.duration || 0;
      const currentPosition = position >= 0 ? position : 0;

      // Only update if position has changed significantly or seekValue is invalid
      const shouldUpdate =
        Math.abs(seekValue - currentPosition) > 1.0 || seekValue < 0;

      if (shouldUpdate && !isUpdatingPositionRef.current) {
        console.log(
          `[FullPlayerModal] Setting initial seek value: ${currentPosition}s (duration: ${trackDuration}s)`
        );
        isUpdatingPositionRef.current = true;
        setSeekValue(currentPosition);
        setIsSeeking(false);
        setSeekPreviewSeconds(null);

        // Reset the flag after a short delay
        setTimeout(() => {
          isUpdatingPositionRef.current = false;
        }, 100);
      }

      // Ensure duration is set
      if (trackDuration > 0 && duration === 0) {
        console.log(
          `[FullPlayerModal] Using track duration: ${trackDuration}s`
        );
      }

      console.log(
        `[FullPlayerModal] Progress bar initialized - position: ${currentPosition}, duration: ${trackDuration}, isPlaying: ${isPlaying}`
      );
    }
  }, [visible, currentTrack?.id, isPlaying]);

  // Optimize position updates to prevent excessive re-renders
  const lastPositionRef = useRef(position);
  const positionUpdateCounter = useRef(0);
  const OPTIMIZED_POSITION_INTERVAL = 1; // Update every 1 second instead of every 250ms

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
      setSheetState(state);
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

  // Fetch real lyrics when track changes
  useEffect(() => {
    const fetchLyrics = async () => {
      // Reduced logging - uncomment for debugging
      // console.log("[FullPlayerModal] Lyrics effect triggered", {
      //   currentTrack,
      //   hasTrack: !!currentTrack,
      //   trackTitle: currentTrack?.title,
      //   trackArtist: currentTrack?.artist,
      //   trackSource: currentTrack?.source,
      //   trackId: currentTrack?.id,
      // });

      if (!currentTrack) {
        setLyricsData([]);
        setCurrentLyricIndex(0);
        setLyricsError(null);
        return;
      }

      // Reset error state when track changes
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

        // Reduced logging - uncomment for debugging
        // console.log("[FullPlayerModal] Lyrics fetch result:", {
        //   hasLyrics: !!cachedLyrics,
        //   lyricsLength: cachedLyrics?.lyrics?.length,
        //   provider: cachedLyrics?.searchEngine,
        //   artistName: cachedLyrics?.artistName,
        //   trackName: cachedLyrics?.trackName,
        // });

        if (cachedLyrics) {
          // Split lyrics into lines
          const lines = cachedLyrics.lyrics
            .split("\n")
            .filter((line) => line.trim());
          setLyricsData(lines);
          setCurrentLyricIndex(0);
          setLyricsError(null);
          // Reduced logging - uncomment for debugging
          // console.log(`[FullPlayerModal] Loaded ${lines.length} lyrics lines`);
        } else {
          setLyricsData([]);
          setCurrentLyricIndex(0);
          setLyricsError("Lyrics service temporarily unavailable");
          // Reduced logging - uncomment for debugging
          // console.log("[FullPlayerModal] No lyrics found");
        }
      } catch (error) {
        console.error(
          "[FullPlayerModal] Error or timeout fetching lyrics:",
          error
        );
        setLyricsData([]);
        setCurrentLyricIndex(0);
        setLyricsError("Couldn't load lyrics for this track");
      } finally {
        setIsLoadingLyrics(false);
      }
    };

    fetchLyrics();
  }, [currentTrack]);

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
              }
          : {
              percentage: cacheProgress.percentage,
              fileSize: 0,
              totalFileSize: 0,
              isFullyCached: false,
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
    console.log(
      `[FullPlayerModal] handleSeek called with valueSeconds: ${valueSeconds}`
    );

    setIsSeeking(false);
    setSeekValue(valueSeconds);
    setSeekPreviewSeconds(null);
    const targetSeconds = valueSeconds;
    console.log(
      `[FullPlayerModal] Seeking to position: ${targetSeconds} seconds`
    );
    try {
      await seekTo(targetSeconds);
      console.log("[FullPlayerModal] Seek completed successfully");
    } catch (error) {
      console.error("[FullPlayerModal] Seek failed:", error);
      // Reset seek state on error
      setSeekValue(position);
      setSeekPreviewSeconds(null);
    }
  };

  const handleProgressBarTap = (event: any) => {
    if (
      !currentTrack ||
      !progressBarWidthRef.current ||
      effectiveDurationSeconds <= 0
    ) {
      return;
    }

    const { locationX } = event.nativeEvent;
    const tapPercentage = locationX / progressBarWidthRef.current;
    const tapSeconds = tapPercentage * effectiveDurationSeconds;

    console.log(
      `[FullPlayerModal] Progress bar tapped at ${locationX}px (${tapPercentage * 100}%) = ${tapSeconds}s`
    );

    // Immediately update UI
    setSeekValue(tapSeconds);
    setSeekPreviewSeconds(null);
    setIsSeeking(false);

    // Perform the seek
    handleSeek(tapSeconds);
  };

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
      <ModalContainer style={{ backgroundColor: "#000" }}>
        <BackgroundContainer>
          <BackgroundImage
            source={{
              uri:
                currentTrack.thumbnail ||
                "https://placehold.co/400x400/000000/ffffff?text=Music",
            }}
            resizeMode="cover"
            blurRadius={4}
          />
          <BlurOverlay intensity={10} tint="dark" />
          <DarkOverlay />
          <GradientOverlay
            colors={[
              "rgba(0, 0, 0, 0.3)",
              "rgba(0, 0, 0, 0.8)",
              "rgba(0, 0, 0, 0.9)",
            ]}
            locations={[0, 0.6, 0.85]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          />
        </BackgroundContainer>
        <SafeArea edges={["top"]}>
          <Header>
            <BackButton onPress={onClose}>
              <Ionicons name="chevron-down" size={24} color="#fff" />
            </BackButton>
            <MoreButton onPress={openOptions}>
              <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
            </MoreButton>
          </Header>

          {/* Content with ScrollView for full screen scrollability */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            scrollEnabled={!isSeeking}
          >
            {currentTrack.thumbnail ? (
              <AlbumArtWrapper>
                <AlbumArtWithOpacity
                  source={{ uri: currentTrack.thumbnail }}
                  showCache={showCacheSize}
                />
                {showCacheSize && (
                  <CacheOverlay>
                    <CacheInfoContainer>
                      {!isSongLiked(currentTrack.id) ? (
                        <CacheInfoRow>
                          Like the song to start caching
                        </CacheInfoRow>
                      ) : cacheInfo ? (
                        <>
                          <CacheInfoRow>
                            {cacheInfo.isFullyCached
                              ? "Cached: 100%"
                              : `Cached: ${Math.round(cacheInfo.percentage)}%`}
                          </CacheInfoRow>
                          {cacheInfo.fileSize > 0 && (
                            <CacheInfoRow>
                              {`Downloaded: ${cacheInfo.fileSize.toFixed(1)}MB`}
                            </CacheInfoRow>
                          )}
                          {cacheInfo.totalFileSize > 0 && (
                            <CacheInfoRow>
                              {`Total: ${cacheInfo.totalFileSize.toFixed(1)}MB`}
                            </CacheInfoRow>
                          )}
                        </>
                      ) : (
                        <CacheInfoRow>Caching...</CacheInfoRow>
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
                  <Ionicons name="musical-notes" size={80} color="#fff" />
                </PlaceholderAlbumArtWithOpacity>
                {showCacheSize && (
                  <CacheOverlay>
                    <CacheInfoContainer>
                      {!isSongLiked(currentTrack.id) ? (
                        <CacheInfoRow>
                          Like the song to start caching
                        </CacheInfoRow>
                      ) : cacheInfo ? (
                        <CacheInfoRow>
                          {cacheInfo.isFullyCached
                            ? "Cached: 100%"
                            : `Cached: ${Math.round(cacheInfo.percentage)}%`}
                        </CacheInfoRow>
                      ) : (
                        <CacheInfoRow>Caching...</CacheInfoRow>
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

            <TrackRow>
              <TrackInfo>
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 24,
                    textAlign: "left",
                    marginRight: 8,
                    fontFamily: "GoogleSansBold",
                    lineHeight: 28,
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
                      color: "#999",
                      fontSize: 18,
                      textAlign: "left",
                      marginTop: 2,
                      fontFamily: "GoogleSansRegular",
                      lineHeight: 22,
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

              <LikeButton onPress={handleLike}>
                <Entypo
                  name={
                    isSongLiked(currentTrack.id) ? "heart" : "heart-outlined"
                  }
                  size={24}
                  color={isSongLiked(currentTrack.id) ? "#fff" : "#fff"}
                />
              </LikeButton>
            </TrackRow>

            <Spacer size={32} />

            <ProgressContainer>
              <ProgressBarContainer
                onLayout={(event) => {
                  progressBarWidthRef.current = event.nativeEvent.layout.width;
                  console.log(
                    `[FullPlayerModal] Progress bar layout - width: ${progressBarWidthRef.current}, effectiveDurationSeconds: ${effectiveDurationSeconds}, position: ${position}`
                  );
                }}
              >
                {/* Always render slider, even with placeholder values */}
                <ProgressSlider
                  key={`slider-${currentTrack?.id}`}
                  ref={progressSliderRef}
                  value={isSeeking ? seekValue : displayPositionSeconds || 0}
                  maximumValue={effectiveDurationSeconds || 1} // Always provide valid maximum
                  minimumValue={0}
                  disabled={!currentTrack} // Only disable if no track, not based on duration
                  minimumTrackTintColor={isPlaying ? "#a3e635" : "#9ca3af"}
                  maximumTrackTintColor="#6b7280"
                  thumbTintColor={isPlaying ? "#ffffff" : "#9ca3af"}
                  onValueChange={(valueSeconds) => {
                    console.log(
                      `[FullPlayerModal] Slider onValueChange - valueSeconds: ${valueSeconds}, isSeeking: ${isSeeking}, displayPositionSeconds: ${displayPositionSeconds}`
                    );
                    if (!isSeeking) {
                      setIsSeeking(true);
                      setSeekValue(valueSeconds);
                      setSeekPreviewSeconds(valueSeconds);
                    } else {
                      setSeekValue(valueSeconds);
                      setSeekPreviewSeconds(valueSeconds);
                    }
                  }}
                  onSlidingComplete={async (valueSeconds) => {
                    console.log(
                      `[FullPlayerModal] Slider onSlidingComplete - valueSeconds: ${valueSeconds}`
                    );
                    setSeekValue(valueSeconds);
                    setSeekPreviewSeconds(null);
                    await handleSeek(valueSeconds);
                  }}
                />
                {/* Touchable overlay for tap-to-seek functionality */}
                <ProgressBarTouchable onPress={handleProgressBarTap} />
              </ProgressBarContainer>
              <TimeContainer>
                <TimeText>
                  {formatTime((displayPositionSeconds || 0) * 1000)}
                </TimeText>
                <TimeText>
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
                  color={isShuffled ? "#a3e635" : "#fff"}
                />
              </ControlButton>

              <ControlButton onPress={handlePrevious}>
                <Ionicons name="play-back" size={24} color="#fff" />
              </ControlButton>

              <PlayPauseButton
                onPress={
                  isLoading || isTransitioning
                    ? cancelLoadingState
                    : handlePlayPause
                }
                disabled={false}
              >
                {isLoading || isTransitioning ? (
                  <ActivityIndicator
                    size="small"
                    color="#000"
                    style={{ width: 24, height: 24 }}
                  />
                ) : (
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={24}
                    color="#000"
                  />
                )}
              </PlayPauseButton>

              <ControlButton onPress={handleNext}>
                <Ionicons name="play-forward" size={24} color="#fff" />
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
                  color={repeatMode === "off" ? "#fff" : "#a3e635"}
                />
                {repeatMode === "one" && <RepeatNumber>1</RepeatNumber>}
              </ControlButton>
            </Controls>

            <Spacer size={24} />

            <LyricsCard>
              <LyricsHeader>
                <LyricsTitle>LYRICS</LyricsTitle>
              </LyricsHeader>

              {isLoadingLyrics ? (
                <ActivityIndicator
                  size="small"
                  color="#999"
                  style={{ marginVertical: 20 }}
                />
              ) : lyricsData.length > 0 ? (
                lyricsData.map((line, index) => (
                  <LyricLine key={index} isActive={index === currentLyricIndex}>
                    {line}
                  </LyricLine>
                ))
              ) : lyricsError ? (
                <>
                  <LyricLine
                    isActive={false}
                    style={{ opacity: 0.6, fontSize: 14 }}
                  >
                    {lyricsError}
                  </LyricLine>
                  <LyricLine
                    isActive={false}
                    style={{ opacity: 0.4, fontSize: 12, marginTop: 8 }}
                  >
                    Try again later or check your internet connection
                  </LyricLine>
                </>
              ) : (
                <>
                  <LyricLine isActive={false} style={{ opacity: 0.6 }}>
                    Lyrics not available for this track
                  </LyricLine>
                  <LyricLine
                    isActive={false}
                    style={{ opacity: 0.4, fontSize: 12, marginTop: 8 }}
                  >
                    We're always working to expand our lyrics database
                  </LyricLine>
                </>
              )}
            </LyricsCard>

            <Spacer size={40} />
          </ScrollView>
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
          options={PLAYER_SHEET_OPTIONS}
          onOptionPress={handleOptionPress}
        />

        {/* Playlist Selection Modal */}
        <PlaylistSelectionModal
          visible={showPlaylistSelection}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowPlaylistSelection(false)}
        >
          <PlaylistSelectionContainer>
            <PlaylistSelectionHeader>
              <PlaylistSelectionTitle>Select Playlist</PlaylistSelectionTitle>
              <PlaylistSelectionClose
                onPress={() => setShowPlaylistSelection(false)}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </PlaylistSelectionClose>
            </PlaylistSelectionHeader>

            <ScrollView>
              {userPlaylists.map((playlist) => (
                <PlaylistItem
                  key={playlist.id}
                  onPress={() => handlePlaylistSelect(playlist)}
                >
                  {playlist.tracks.length > 0 &&
                  playlist.tracks[0].thumbnail ? (
                    <PlaylistCover
                      source={{ uri: playlist.tracks[0].thumbnail }}
                    />
                  ) : (
                    <PlaylistPlaceholderCover>
                      <Ionicons name="musical-notes" size={24} color="#666" />
                    </PlaylistPlaceholderCover>
                  )}
                  <PlaylistInfo>
                    <PlaylistName>{playlist.name}</PlaylistName>
                    <PlaylistMeta>
                      {playlist.tracks.length}{" "}
                      {playlist.tracks.length === 1 ? "song" : "songs"}
                    </PlaylistMeta>
                  </PlaylistInfo>
                </PlaylistItem>
              ))}

              {userPlaylists.length === 0 && (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <Text style={{ color: "#888", fontSize: 16 }}>
                    No playlists found
                  </Text>
                  <Text style={{ color: "#666", fontSize: 14, marginTop: 8 }}>
                    Create a playlist first to add songs
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
