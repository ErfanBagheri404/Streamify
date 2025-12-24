import React, { useState, useEffect } from "react";
import { Modal, TouchableOpacity, View, Text, Dimensions } from "react-native";
import Slider from "@react-native-community/slider";
import { SliderProps } from "@react-native-community/slider";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { Entypo } from "@expo/vector-icons";
import { usePlayer } from "../contexts/PlayerContext";
import { formatTime } from "../utils/formatters";

const { width, height } = Dimensions.get("window");

const ModalContainer = styled.View`
  flex: 1;
`;

const Header = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
`;

const HeaderButton = styled.TouchableOpacity`
  padding: 8px;
`;

const Content = styled.View`
  flex: 1;
  padding: 32px 24px 0px 24px;
  justify-content: space-between;
`;

const AlbumArtWrapper = styled.View`
  position: relative;
  width: ${width - 48}px;
  height: ${width - 48}px;
  border-radius: 12px;
  overflow: hidden;
  background-color: #444; /* Debug background to see the wrapper */
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

const TrackInfo = styled.View`
  align-items: center;
  margin-top: 32px;
`;

const AlbumArtContainer = styled.View`
  align-self: center;
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
  font-weight: 500;
  text-align: center;
  margin-vertical: 2px;
`;

const TrackTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 8px;
`;

const TrackArtist = styled.Text`
  color: #999;
  font-size: 18px;
  text-align: center;
`;

const ProgressContainer = styled.View`
  margin-top: 32px;
`;

const ProgressBarContainer = styled.View`
  width: 100%;
  height: 4px;
  justify-content: center;
`;

const ProgressSlider = React.forwardRef<any, SliderProps>((props, ref) => {
  return (
    <Slider
      ref={ref}
      {...props}
      style={[{ width: "100%", height: 4 }, props.style]}
    />
  );
});
ProgressSlider.displayName = "ProgressSlider";

const TimeContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 8px;
`;

const TimeText = styled.Text`
  color: #999;
  font-size: 12px;
`;

const Controls = styled.View`
  flex-direction: row;
  justify-content: center;
  align-items: center;
  margin-top: 32px;
`;

const ControlButton = styled.TouchableOpacity`
  padding: 16px;
  margin: 0 8px;
`;

const PlayPauseButton = styled.TouchableOpacity`
  background-color: #fff;
  border-radius: 32px;
  padding: 16px;
  margin: 0 16px;
`;

interface FullPlayerModalProps {
  visible: boolean;
  onClose: () => void;
}

export const FullPlayerModal: React.FC<FullPlayerModalProps> = ({
  visible,
  onClose,
}) => {
  const {
    currentTrack,
    isPlaying,
    isLoading,
    sound,
    repeatMode,
    isShuffled,
    colorTheme,
    playPause,
    nextTrack,
    previousTrack,
    seekTo,
    setRepeatMode,
    toggleShuffle,
    toggleLikeSong,
    isSongLiked,
    getCacheInfo,
    cacheProgress,
  } = usePlayer();

  const [currentPosition, setCurrentPosition] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [isHoldingCover, setIsHoldingCover] = useState(false);

  // Debug log for cache info
  useEffect(() => {
    console.log("[FullPlayerModal] cacheInfo state:", cacheInfo);
  }, [cacheInfo]);

  // Update cache info when cacheProgress changes
  useEffect(() => {
    if (cacheProgress && currentTrack?.id === cacheProgress.trackId) {
      console.log(
        `[FullPlayerModal] Cache progress updated: ${cacheProgress.percentage}%`
      );
      // Update cache info with the new percentage
      setCacheInfo((prev) =>
        prev
          ? {
              ...prev,
              percentage: cacheProgress.percentage,
            }
          : {
              percentage: cacheProgress.percentage,
              fileSize: 0,
              totalFileSize: 0,
              isFullyCached: false,
            }
      );
    }
  }, [cacheProgress?.percentage, currentTrack?.id]);

  // Debug log for component render
  useEffect(() => {
    console.log(
      "[FullPlayerModal] Component rendered, currentTrack:",
      currentTrack?.id
    );
  }, [currentTrack?.id]);

  useEffect(() => {
    if (!sound || !currentTrack?.audioUrl) {
      return; // Don't track position if no sound or track doesn't have audio
    }

    const updatePosition = async () => {
      try {
        if (!sound) {
          return; // Don't try to get position if sound doesn't exist
        }
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          setCurrentPosition(status.positionMillis);
          setDuration(status.durationMillis || 0);
        }
      } catch (error) {
        // Only log if it's not a "Player does not exist" error (which is expected)
        if (!error?.toString().includes("Player does not exist")) {
          console.error("Error getting position:", error);
        }
      }
    };

    const interval = setInterval(updatePosition, 1000);
    updatePosition(); // Initial update

    return () => clearInterval(interval);
  }, [sound]);

  // Cache info update effect
  useEffect(() => {
    if (!currentTrack?.audioUrl) {
      setCacheInfo(null);
      return;
    }

    const updateCacheInfo = async () => {
      try {
        console.log(
          "[FullPlayerModal] Getting cache info for track:",
          currentTrack.id
        );
        const info = await getCacheInfo(currentTrack.id);
        console.log("[FullPlayerModal] Cache info result:", info);
        if (info) {
          setCacheInfo(info);
          setCacheRetryCount(0); // Reset retry count on successful update
        } else {
          // If no cache info, retry a few times
          if (cacheRetryCount < 3) {
            setTimeout(() => {
              setCacheRetryCount((prev) => prev + 1);
            }, 1000);
          }
        }
      } catch (error) {
        console.error("[FullPlayerModal] Error getting cache info:", error);
      }
    };

    updateCacheInfo();

    // Update cache info every 5 seconds
    const cacheInterval = setInterval(updateCacheInfo, 5000);

    return () => clearInterval(cacheInterval);
  }, [currentTrack?.audioUrl, currentTrack?.id, getCacheInfo, cacheRetryCount]);

  const handleSeek = async (value: number) => {
    try {
      if (sound && currentTrack?.audioUrl) {
        await seekTo(value);
        console.log(
          `[FullPlayerModal] Seek successful, updating position to: ${value}`
        );
      } else {
        console.warn("[FullPlayerModal] Cannot seek: Player not ready");
      }
      // Update position visually even if seek fails
      console.log(`[FullPlayerModal] Updating visual position to: ${value}`);
      setCurrentPosition(value);
    } catch (error) {
      console.error("[FullPlayerModal] Error seeking:", error);
      console.log(
        "[FullPlayerModal] Seek failed - player no longer exists (expected during cleanup)"
      );
      // Update position visually even if seek fails
      console.log(
        `[FullPlayerModal] Updating visual position to: ${value} (after error)`
      );
      setCurrentPosition(value);
    }
  };

  const handlePlayPause = async () => {
    await playPause();
  };

  const handleNext = async () => {
    await nextTrack();
  };

  const handlePrevious = async () => {
    await previousTrack();
  };

  const handleRepeat = () => {
    const modes: ("off" | "one" | "all")[] = ["off", "one", "all"];
    const currentIndex = modes.indexOf(repeatMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    setRepeatMode(nextMode);
  };

  const handleShuffle = () => {
    toggleShuffle();
  };

  const handleLike = () => {
    if (currentTrack) {
      toggleLikeSong(currentTrack);
    }
  };

  const getRepeatIcon = () => {
    return "repeat" as const;
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
    >
      <ModalContainer style={{ backgroundColor: colorTheme.background }}>
        <Header>
          <HeaderButton onPress={onClose}>
            <Ionicons name="chevron-down" size={24} color={colorTheme.text} />
          </HeaderButton>
          <Text style={{ color: colorTheme.text, opacity: 0.7, fontSize: 14 }}>
            NOW PLAYING
          </Text>
          <HeaderButton onPress={handleLike}>
            <Entypo
              name={isSongLiked(currentTrack.id) ? "heart" : "heart-outlined"}
              size={24}
              color={
                isSongLiked(currentTrack.id)
                  ? colorTheme.primary
                  : colorTheme.text
              }
            />
          </HeaderButton>
        </Header>

        <Content>
          <View>
            <AlbumArtContainer>
              {currentTrack.thumbnail ? (
                <AlbumArtWrapper>
                  <AlbumArt
                    source={{ uri: currentTrack.thumbnail }}
                    style={{ opacity: showCacheSize ? 0.2 : 1 }}
                  />
                  {cacheInfo && showCacheSize && (
                    <CacheOverlay>
                      <CacheInfoContainer>
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

                      </CacheInfoContainer>
                    </CacheOverlay>
                  )}
                  <TouchableOpacity
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    }}
                    onPress={() => setShowCacheSize(!showCacheSize)}
                    activeOpacity={1}
                  />
                </AlbumArtWrapper>
              ) : (
                <AlbumArtWrapper>
                  <PlaceholderAlbumArt
                    style={{ opacity: showCacheSize ? 0.2 : 1 }}
                  >
                    <Ionicons
                      name="musical-notes"
                      size={80}
                      color={colorTheme.text + "66"} /* 40% opacity */
                    />
                  </PlaceholderAlbumArt>
                  {cacheInfo && showCacheSize && (
                    <CacheOverlay>
                      <CacheInfoContainer>
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
                      </CacheInfoContainer>
                    </CacheOverlay>
                  )}
                  <TouchableOpacity
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    }}
                    onPress={() => setShowCacheSize(!showCacheSize)}
                    activeOpacity={1}
                  />
                </AlbumArtWrapper>
              )}
            </AlbumArtContainer>

            <TrackInfo>
              <TrackTitle numberOfLines={2} style={{ color: colorTheme.text }}>
                {currentTrack.title}
              </TrackTitle>
              {currentTrack.artist && (
                <TrackArtist style={{ color: colorTheme.text, opacity: 0.7 }}>
                  {currentTrack.artist}
                </TrackArtist>
              )}
            </TrackInfo>

            <ProgressContainer>
              <ProgressBarContainer>
                <ProgressSlider
                  value={currentPosition}
                  maximumValue={duration}
                  minimumValue={0}
                  onSlidingComplete={handleSeek}
                  minimumTrackTintColor={colorTheme.primary}
                  maximumTrackTintColor={
                    colorTheme.text + "4D"
                  } /* 30% opacity */
                  thumbTintColor={colorTheme.primary}
                />
              </ProgressBarContainer>
              <TimeContainer>
                <TimeText style={{ color: colorTheme.text, opacity: 0.7 }}>
                  {formatTime(currentPosition)}
                </TimeText>
                <TimeText style={{ color: colorTheme.text, opacity: 0.7 }}>
                  {formatTime(duration)}
                </TimeText>
              </TimeContainer>
            </ProgressContainer>
          </View>

          {/* Additional Controls Row */}
          <Controls>
            <ControlButton onPress={handleShuffle}>
              <Ionicons
                name="shuffle"
                size={20}
                color={isShuffled ? colorTheme.primary : colorTheme.text}
              />
            </ControlButton>

            <ControlButton onPress={handlePrevious}>
              <Ionicons name="play-back" size={24} color={colorTheme.text} />
            </ControlButton>

            <PlayPauseButton
              onPress={handlePlayPause}
              style={{ backgroundColor: colorTheme.primary }}
            >
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={24}
                color={colorTheme.background}
              />
            </PlayPauseButton>

            <ControlButton onPress={handleNext}>
              <Ionicons name="play-forward" size={24} color={colorTheme.text} />
            </ControlButton>

            <ControlButton onPress={handleRepeat}>
              <Ionicons
                name={getRepeatIcon()}
                size={20}
                color={
                  repeatMode !== "off" ? colorTheme.primary : colorTheme.text
                }
              />
            </ControlButton>
          </Controls>
        </Content>
      </ModalContainer>
    </Modal>
  );
};
