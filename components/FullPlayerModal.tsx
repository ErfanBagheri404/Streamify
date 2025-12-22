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
  padding: 32px 24px;
  justify-content: space-between;
`;

const AlbumArt = styled.Image`
  width: ${width - 48}px;
  height: ${width - 48}px;
  border-radius: 12px;
  background-color: #333;
  align-self: center;
`;

const PlaceholderAlbumArt = styled.View`
  width: ${width - 48}px;
  height: ${width - 48}px;
  border-radius: 12px;
  background-color: #333;
  justify-content: center;
  align-items: center;
  align-self: center;
`;

const TrackInfo = styled.View`
  align-items: center;
  margin-top: 32px;
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
  } = usePlayer();

  const [currentPosition, setCurrentPosition] = useState(0);
  const [duration, setDuration] = useState(0);

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
            {currentTrack.thumbnail ? (
              <AlbumArt source={{ uri: currentTrack.thumbnail }} />
            ) : (
              <PlaceholderAlbumArt>
                <Ionicons
                  name="musical-notes"
                  size={80}
                  color={colorTheme.text + "66"} /* 40% opacity */
                />
              </PlaceholderAlbumArt>
            )}

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
