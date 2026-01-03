/********************************************************************
 *  FullPlayerModal.tsx - Modern dark theme player with blurred background
 *******************************************************************/
import React, { useState, useEffect } from "react";
import {
  Modal,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import { SliderProps } from "@react-native-community/slider";
import styled from "styled-components/native";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { Entypo } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer } from "../contexts/PlayerContext";
import { formatTime } from "../utils/formatters";

const { width } = Dimensions.get("window");

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

const BackButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
  margin-left: 8px;
`;

const MoreButton = styled.TouchableOpacity``;

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

const LikeButton = styled.TouchableOpacity`
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
  font-weight: 700;
  text-align: left;
  margin-right: 8px;
`;

const TrackArtist = styled.Text`
  color: #999;
  font-size: 18px;
  text-align: left;
  margin-top: 2px;
`;

const ProgressContainer = styled.View`
  margin-top: 24px;
  padding-horizontal: 28px;
`;

const ProgressBarContainer = styled.View`
  width: 100%;
  height: 4px;
  justify-content: center;
`;

const ProgressSlider = React.forwardRef<Slider, SliderProps>((props, ref) => {
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
  padding-horizontal: 0px;
`;

const TimeText = styled.Text`
  color: #999;
  font-size: 12px;
`;

const Controls = styled.View`
  flex-direction: row;
  justify-content: center;
  align-items: center;
  margin-top: 20px;
  padding-horizontal: 28px;
  width: 100%;
`;

const ControlButton = styled.TouchableOpacity`
  padding: 16px;
  margin: 0 16px;
  position: relative;
`;

const RepeatNumber = styled.Text`
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  font-weight: bold;
  color: #a3e635;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 2px 4px;
  border-radius: 4px;
`;

const PlayPauseButton = styled.TouchableOpacity`
  background-color: #fff;
  border-radius: 32px;
  padding: 16px;
  margin: 0 24px;
  width: 56px;
  height: 56px;
  justify-content: center;
  align-items: center;
`;

const LyricsCard = styled.View`
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 22px;
  margin-top: 20px;
  margin-horizontal: 28px;
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
  font-weight: 600;
`;

const LyricLine = styled.Text<{ isActive: boolean }>`
  color: ${(props) => (props.isActive ? "#fff" : "#999")};
  font-size: 14px;
  margin-vertical: 4px;
  opacity: ${(props) => (props.isActive ? 1 : 0.7)};
  font-weight: ${(props) => (props.isActive ? "600" : "400")};
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
}

export const FullPlayerModal: React.FC<FullPlayerModalProps> = ({
  visible,
  onClose,
}) => {
  const {
    currentTrack,
    playlist,
    currentIndex,
    isPlaying,
    isLoading,
    isTransitioning,
    sound,
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
  const [currentLyricIndex, setCurrentLyricIndex] = useState(0);

  // Sample lyrics data
  const sampleLyrics = [
    "Just a young gun with the quick fuse",
    "I was uptight, wanna let loose",
    "I was dreaming of bigger things",
    "And wanna leave my own life behind",
    "Not a yes sir, not a follower",
    "Fit the box, fit the mold",
    "Have a seat in the foyer, take a number",
    "I was lightning before the thunder",
    "Thunder, thunder",
    "Thunder, thun-, thunder",
    "Thun-thun-thunder, thunder, thunder",
    "Thunder, thunder, thunder",
    "Thunder, thun-, thunder",
    "Thun-thun-thunder, thunder",
  ];

  // Simulate lyric progression
  useEffect(() => {
    if (isPlaying && currentTrack) {
      const interval = setInterval(() => {
        setCurrentLyricIndex((prev) => {
          const newIndex = (prev + 1) % sampleLyrics.length;
          return newIndex;
        });
      }, 3000); // Change lyric every 3 seconds

      return () => clearInterval(interval);
    }
  }, [isPlaying, currentTrack, sampleLyrics.length]);

  // Update cache info when cacheProgress changes
  useEffect(() => {
    if (cacheProgress && currentTrack?.id === cacheProgress.trackId) {
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
  }, [cacheProgress, currentTrack?.id]);

  // Reset position when track changes
  useEffect(() => {
    setCurrentPosition(0);
    setDuration(0);
  }, [currentTrack?.id]);

  // Track position and duration
  useEffect(() => {
    if (!sound || !currentTrack?.audioUrl) {
      return;
    }

    const updatePosition = async () => {
      try {
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          setCurrentPosition(status.positionMillis);
          setDuration(status.durationMillis || 0);
        }
      } catch (error) {
        if (!error?.toString().includes("Player does not exist")) {
          // Silently ignore player not existing errors
        }
      }
    };

    const interval = setInterval(updatePosition, 1000);
    updatePosition();

    return () => clearInterval(interval);
  }, [sound, currentTrack?.id]); // Reset when track changes

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
    const cacheInterval = setInterval(updateCacheInfo, 10000); // Check every 10 seconds
    return () => clearInterval(cacheInterval);
  }, [currentTrack?.audioUrl, currentTrack?.id, getCacheInfo]);

  const handleSeek = async (value: number) => {
    try {
      if (sound && currentTrack?.audioUrl) {
        await seekTo(value);
      }
      setCurrentPosition(value);
    } catch (error) {
      // Silently ignore seek errors
      setCurrentPosition(value);
    }
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
            locations={[0, 0.7, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          />
        </BackgroundContainer>
        <SafeArea edges={["top", "bottom"]}>
          <Header>
            <BackButton onPress={onClose}>
              <Ionicons name="chevron-back" size={20} color="#fff" />
              <BackButtonText>Back</BackButtonText>
            </BackButton>
            <MoreButton onPress={() => {}}>
              <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
            </MoreButton>
          </Header>

          {/* Content without ScrollView for full screen scrollability */}
          <>
            {currentTrack.thumbnail ? (
              <AlbumArtWrapper>
                <AlbumArtWithOpacity
                  source={{ uri: currentTrack.thumbnail }}
                  showCache={showCacheSize}
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
                {cacheInfo && showCacheSize && (
                  <CacheOverlay>
                    <CacheInfoContainer>
                      <CacheInfoRow>
                        {cacheInfo.isFullyCached
                          ? "Cached: 100%"
                          : `Cached: ${Math.round(cacheInfo.percentage)}%`}
                      </CacheInfoRow>
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
                <TrackTitle>{currentTrack.title}</TrackTitle>
                {currentTrack.artist && (
                  <TrackArtist>{currentTrack.artist}</TrackArtist>
                )}
              </TrackInfo>

              <LikeButton onPress={handleLike}>
                <Entypo
                  name={
                    isSongLiked(currentTrack.id) ? "heart" : "heart-outlined"
                  }
                  size={24}
                  color={isSongLiked(currentTrack.id) ? "#ff4757" : "#fff"}
                />
              </LikeButton>
            </TrackRow>

            <Spacer size={32} />

            <ProgressContainer>
              <ProgressBarContainer>
                <ProgressSlider
                  value={currentPosition}
                  maximumValue={duration}
                  minimumValue={0}
                  onSlidingComplete={handleSeek}
                  minimumTrackTintColor="#fff"
                  maximumTrackTintColor="rgba(255, 255, 255, 0.3)"
                  thumbTintColor="#fff"
                />
              </ProgressBarContainer>
              <TimeContainer>
                <TimeText>{formatTime(currentPosition)}</TimeText>
                <TimeText>{formatTime(duration)}</TimeText>
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
                onPress={handlePlayPause}
                disabled={isLoading || isTransitioning}
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
                <LyricsTitle>Lyrics</LyricsTitle>
                <Ionicons name="chevron-forward" size={16} color="#999" />
              </LyricsHeader>
              {sampleLyrics.slice(0, 5).map((line, index) => (
                <LyricLine key={index} isActive={index === currentLyricIndex}>
                  {line}
                </LyricLine>
              ))}
            </LyricsCard>

            <Spacer size={100} />
          </>
        </SafeArea>
      </ModalContainer>
    </Modal>
  );
};
