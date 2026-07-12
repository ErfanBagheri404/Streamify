import * as React from "react";
import { TouchableOpacity, ActivityIndicator, View } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { usePlayer } from "../contexts/PlayerContext";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useAppSettings } from "../hooks/useAppSettings";
import { getAppFontFamily } from "../utils/fonts";

const MiniPlayerContainer = styled.View<{ bottomPosition: number }>`
  position: absolute;
  bottom: ${(props) => props.bottomPosition}px;
  align-self: center; /* keeps it centered */
  left: 12px;
  right: 12px;
  width: auto; /* let flexbox fill the space between left & right */
  align-self: stretch;
  min-height: 74px;
  flex-direction: row;
  align-items: center;
  padding: 10px 10px 14px 10px;
  elevation: 10;
  shadow-color: #000;
  shadow-offset: 0px -2px;
  shadow-opacity: 0.3;
  shadow-radius: 4px;
  border-radius: 10px;
  overflow: hidden;
`;

const TrackInfo = styled.View`
  flex: 1;
`;

const TrackTitle = styled.Text`
  color: #fff;
  font-size: 14px;
  number-of-lines: 1;
  font-family: GoogleSansSemiBold;
  line-height: 18px;
`;

const TrackArtist = styled.Text`
  color: #999;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const ProgressTrack = styled.View`
  height: 4px;
  overflow: hidden;
`;

const ProgressFill = styled.View`
  height: 100%;
  border-radius: 999px;
`;

const ControlsContainer = styled.View`
  flex-direction: row;
  align-items: center;
`;

const ControlButton = styled.TouchableOpacity`
  padding: 8px;
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const Thumbnail = styled.Image`
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background-color: #333;
`;

const PlaceholderThumbnail = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background-color: #333;
  justify-content: center;
  align-items: center;
`;

const BackgroundContainer = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 10px;
  overflow: hidden;
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
  background-color: rgba(0, 0, 0, 0.7);
`;

interface MiniPlayerProps {
  onExpand: () => void;
  currentScreen?: string;
}

export const MiniPlayer: React.FC<MiniPlayerProps> = ({
  onExpand,
  currentScreen,
}) => {
  const {
    currentTrack,
    isPlaying,
    isLoading,
    isTransitioning,
    canSkipNext,
    canSkipPrevious,
    position,
    duration,
    playPause,
    nextTrack,
    previousTrack,
    seekTo,
    cancelLoadingState,
    playbackError,
  } = usePlayer();
  const { colors, isLight } = useTheme();
  const { language, isRtl, t } = useAppLanguage();
  const { settings } = useAppSettings();

  // Keep the compact player closer to the content on immersive detail screens.
  const compactPlayerScreens = [
    "AlbumPlaylist",
    "LikedSongs",
    "PreviouslyPlayed",
    "Artist",
    "Settings",
  ];
  const targetBottomPosition = compactPlayerScreens.includes(currentScreen)
    ? 15
    : 65;
  // Use state to create smooth animation
  const [currentBottomPosition, setCurrentBottomPosition] =
    React.useState(targetBottomPosition);
  const [progressBarWidth, setProgressBarWidth] = React.useState(0);

  React.useEffect(() => {
    if (settings.disableAnimations) {
      setCurrentBottomPosition(targetBottomPosition);
      return;
    }

    // Create smooth animation by gradually changing the position
    const startPosition = currentBottomPosition;
    const endPosition = targetBottomPosition;
    const duration = 200; // 200ms
    const steps = 20; // 20 steps for smooth animation
    const stepDuration = duration / steps;
    const positionChange = (endPosition - startPosition) / steps;

    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      const newPosition = startPosition + positionChange * currentStep;
      setCurrentBottomPosition(newPosition);

      if (currentStep >= steps) {
        clearInterval(interval);
        setCurrentBottomPosition(endPosition); // Ensure we end at exact position
      }
    }, stepDuration);

    return () => clearInterval(interval);
  }, [settings.disableAnimations, targetBottomPosition]);

  const effectiveDuration = React.useMemo(
    () => (duration > 0 ? duration : currentTrack?.duration || 0),
    [currentTrack?.duration, duration]
  );
  const progressRatio =
    effectiveDuration > 0
      ? Math.min(Math.max(position / effectiveDuration, 0), 1)
      : 0;
  const statusText =
    playbackError ||
    (isLoading || isTransitioning
      ? language === "fa"
        ? "در حال بارگذاری پخش..."
        : "Loading playback..."
      : null);
  const handlePlayPause = async () => {
    await playPause();
  };

  const handleNext = async () => {
    await nextTrack();
  };

  const handlePrevious = async () => {
    await previousTrack();
  };

  const handleProgressLayout = React.useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      setProgressBarWidth(event.nativeEvent.layout.width);
    },
    []
  );

  const handleProgressPress = React.useCallback(
    async (event: { nativeEvent: { locationX: number } }) => {
      if (!effectiveDuration || progressBarWidth <= 0) {
        return;
      }

      const ratio = Math.min(
        Math.max(event.nativeEvent.locationX / progressBarWidth, 0),
        1
      );

      const targetSeconds = ratio * effectiveDuration;
      await seekTo(targetSeconds);
    },
    [effectiveDuration, progressBarWidth, seekTo]
  );

  const displayTheme = {
    primary: colors.accent,
    text: colors.foreground,
    muted: colors.muted,
    border: colors.borderSubtle,
    overlay: withOpacity(colors.heroMid, isLight ? 0.34 : 0.66),
    placeholder: colors.surface2,
    shadow: withOpacity(colors.heroMid, isLight ? 0.18 : 0.42),
  };
  const previousIconName = isRtl ? "play-forward" : "play-back";
  const nextIconName = isRtl ? "play-back" : "play-forward";

  if (!currentTrack) {
    return null;
  }

  // Debug: Log the current color theme

  return (
    <MiniPlayerContainer
      bottomPosition={currentBottomPosition}
      style={{
        backgroundColor: "transparent",
        flexDirection: isRtl ? "row-reverse" : "row",
        shadowColor: displayTheme.shadow,
      }}
    >
      <BackgroundContainer>
        <BackgroundImage
          source={{
            uri: currentTrack.thumbnail || "https://placehold.co/400x400",
          }}
          resizeMode="cover"
          blurRadius={34}
        />
        <BlurOverlay intensity={10} tint={isLight ? "light" : "dark"} />
        <DarkOverlay style={{ backgroundColor: displayTheme.overlay }} />
      </BackgroundContainer>
      <TouchableOpacity
        onPress={onExpand}
        style={{
          flexDirection: isRtl ? "row-reverse" : "row",
          alignItems: "center",
          flex: 1,
          zIndex: 1,
        }}
      >
        {currentTrack.thumbnail ? (
          <Thumbnail source={{ uri: currentTrack.thumbnail }} />
        ) : (
          <PlaceholderThumbnail
            style={{ backgroundColor: displayTheme.placeholder }}
          >
            <Ionicons
              name="musical-notes"
              size={24}
              color={displayTheme.muted}
            />
          </PlaceholderThumbnail>
        )}

        <TrackInfo
          style={{
            marginLeft: isRtl ? 0 : 12,
            marginRight: isRtl ? 12 : 0,
          }}
        >
          <TrackTitle
            numberOfLines={1}
            style={{
              color: displayTheme.text,
              fontFamily: getAppFontFamily(isRtl, "medium"),
              textAlign: isRtl ? "right" : "left",
              writingDirection: isRtl ? "rtl" : "ltr",
            }}
          >
            {currentTrack.title}
          </TrackTitle>
          {(statusText || currentTrack.artist) && (
            <TrackArtist
              numberOfLines={1}
              style={{
                color: playbackError
                  ? isLight
                    ? "#991b1b"
                    : "#fecaca"
                  : statusText
                    ? displayTheme.text
                    : displayTheme.muted,
                fontFamily: getAppFontFamily(isRtl, "regular"),
                textAlign: isRtl ? "right" : "left",
                writingDirection: isRtl ? "rtl" : "ltr",
              }}
            >
              {statusText || currentTrack.artist}
            </TrackArtist>
          )}
        </TrackInfo>
      </TouchableOpacity>

      <ControlsContainer
        style={{
          zIndex: 1,
          flexDirection: isRtl ? "row-reverse" : "row",
          marginLeft: isRtl ? 0 : 16,
          marginRight: isRtl ? 16 : 0,
        }}
      >
        <ControlButton
          onPress={handlePrevious}
          disabled={!canSkipPrevious}
          accessibilityRole="button"
          accessibilityLabel={t("player.play_previous")}
          style={{
            opacity: canSkipPrevious ? 1 : 0.38,
            marginHorizontal: 4,
          }}
        >
          <Ionicons
            name={previousIconName}
            size={20}
            color={displayTheme.text}
          />
        </ControlButton>

        <ControlButton
          onPress={
            isLoading || isTransitioning ? cancelLoadingState : handlePlayPause
          }
          disabled={false}
          accessibilityRole="button"
          accessibilityLabel={
            isPlaying ? t("player.play_button") : t("player.play_button")
          }
          style={{ marginHorizontal: 2 }}
        >
          {isLoading || isTransitioning ? (
            <ActivityIndicator
              size="small"
              color={displayTheme.text}
              style={{ width: 24, height: 24 }}
            />
          ) : (
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={24}
              color={displayTheme.text}
            />
          )}
        </ControlButton>

        <ControlButton
          onPress={handleNext}
          disabled={!canSkipNext}
          accessibilityRole="button"
          accessibilityLabel={t("player.play_next")}
          style={{
            opacity: canSkipNext ? 1 : 0.38,
            marginHorizontal: 4,
          }}
        >
          <Ionicons name={nextIconName} size={20} color={displayTheme.text} />
        </ControlButton>
      </ControlsContainer>
      <TouchableOpacity
        activeOpacity={0.9}
        onLayout={handleProgressLayout}
        onPress={(event) => {
          void handleProgressPress(event);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={
          language === "fa" ? "تغییر موقعیت پخش" : "Seek playback"
        }
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2,
        }}
      >
        <ProgressTrack
          style={{
            width: "100%",
            backgroundColor: withOpacity(displayTheme.text, 0.18),
          }}
        >
          <ProgressFill
            style={{
              width: `${progressRatio * 100}%`,
              backgroundColor: displayTheme.primary,
            }}
          />
        </ProgressTrack>
      </TouchableOpacity>
    </MiniPlayerContainer>
  );
};
