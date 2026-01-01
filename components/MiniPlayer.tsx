import * as React from "react";
import { TouchableOpacity, ActivityIndicator } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { usePlayer } from "../contexts/PlayerContext";

const MiniPlayerContainer = styled.View<{ bottomPosition: number }>`
  position: absolute;
  bottom: ${(props) => props.bottomPosition}px;
  align-self: center; /* keeps it centered */
  left: 12px;
  right: 12px;
  width: auto; /* let flexbox fill the space between left & right */
  align-self: stretch;
  height: 64px;
  flex-direction: row;
  align-items: center;
  padding: 0 16px;
  elevation: 10;
  shadow-color: #000;
  shadow-offset: 0px -2px;
  shadow-opacity: 0.3;
  shadow-radius: 4px;
  border-radius: 10px;
`;

const TrackInfo = styled.View`
  flex: 1;
  margin-left: 12px;
`;

const TrackTitle = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  number-of-lines: 1;
`;

const TrackArtist = styled.Text`
  color: #999;
  font-size: 12px;
  margin-top: 2px;
`;

const ControlsContainer = styled.View`
  flex-direction: row;
  align-items: center;
  margin-left: 16px;
`;

const ControlButton = styled.TouchableOpacity`
  padding: 8px;
  margin-left: 8px;
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
    colorTheme,
    playPause,
    nextTrack,
    previousTrack,
  } = usePlayer();

  // Set bottom position: 65px when not on playlist screen, 15px when on playlist screen
  const playlistScreens = ["AlbumPlaylist", "LikedSongs", "PreviouslyPlayed"];
  const targetBottomPosition = playlistScreens.includes(currentScreen)
    ? 15
    : 65;
  // Use state to create smooth animation
  const [currentBottomPosition, setCurrentBottomPosition] =
    React.useState(targetBottomPosition);

  React.useEffect(() => {
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
  }, [targetBottomPosition]);

  if (!currentTrack) {
    return null;
  }

  const handlePlayPause = async () => {
    await playPause();
  };

  const handleNext = async () => {
    await nextTrack();
  };

  const handlePrevious = async () => {
    await previousTrack();
  };

  return (
    <MiniPlayerContainer
      bottomPosition={currentBottomPosition}
      style={{
        backgroundColor: colorTheme.background,
        borderTopColor: colorTheme.text + "20" /* 12% opacity */,
      }}
    >
      <TouchableOpacity
        onPress={onExpand}
        style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
      >
        {currentTrack.thumbnail ? (
          <Thumbnail source={{ uri: currentTrack.thumbnail }} />
        ) : (
          <PlaceholderThumbnail
            style={{ backgroundColor: colorTheme.text + "1A" }}
          >
            <Ionicons
              name="musical-notes"
              size={24}
              color={colorTheme.text + "80"}
            />
          </PlaceholderThumbnail>
        )}

        <TrackInfo>
          <TrackTitle numberOfLines={1} style={{ color: colorTheme.text }}>
            {currentTrack.title}
          </TrackTitle>
          {currentTrack.artist && (
            <TrackArtist
              numberOfLines={1}
              style={{ color: colorTheme.text, opacity: 0.7 }}
            >
              {currentTrack.artist}
            </TrackArtist>
          )}
        </TrackInfo>
      </TouchableOpacity>

      <ControlsContainer>
        <ControlButton onPress={handlePrevious}>
          <Ionicons name="play-back" size={20} color={colorTheme.text} />
        </ControlButton>

        <ControlButton
          onPress={handlePlayPause}
          disabled={isLoading || isTransitioning}
        >
          {isLoading || isTransitioning ? (
            <ActivityIndicator size="small" color={colorTheme.text} />
          ) : (
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={24}
              color={colorTheme.text}
            />
          )}
        </ControlButton>

        <ControlButton onPress={handleNext}>
          <Ionicons name="play-forward" size={20} color={colorTheme.text} />
        </ControlButton>
      </ControlsContainer>
    </MiniPlayerContainer>
  );
};
