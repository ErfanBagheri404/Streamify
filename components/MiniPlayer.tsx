import * as React from "react";
import { TouchableOpacity, ActivityIndicator } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
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
  padding: 10px 10px;
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

const ControlsContainer = styled.View`
  flex-direction: row;
  align-items: center;
  margin-left: 16px;
`;

const ControlButton = styled.TouchableOpacity`
  padding: 8px;
  margin-left: 8px;
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
    colorTheme,
    playPause,
    nextTrack,
    previousTrack,
    cancelLoadingState,
  } = usePlayer();

  // Set bottom position: 65px when not on playlist screen, 15px when on playlist screen or artist screen
  const playlistScreens = [
    "AlbumPlaylist",
    "LikedSongs",
    "PreviouslyPlayed",
    "Artist",
  ];
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

  const displayTheme = colorTheme;

  // Debug: Log the current color theme

  return (
    <MiniPlayerContainer
      bottomPosition={currentBottomPosition}
      style={{
        backgroundColor: "transparent",
        borderTopColor: displayTheme.text + "20" /* 12% opacity */,
      }}
    >
      <BackgroundContainer>
        <BackgroundImage
          source={{
            uri:
              currentTrack.thumbnail ||
              "https://placehold.co/400x400/000000/ffffff?text=Music",
          }}
          resizeMode="cover"
          blurRadius={10}
        />
        <BlurOverlay intensity={5} tint="dark" />
        <DarkOverlay />
      </BackgroundContainer>
      <TouchableOpacity
        onPress={onExpand}
        style={{
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          zIndex: 1,
        }}
      >
        {currentTrack.thumbnail ? (
          <Thumbnail source={{ uri: currentTrack.thumbnail }} />
        ) : (
          <PlaceholderThumbnail
            style={{ backgroundColor: displayTheme.text + "1A" }}
          >
            <Ionicons
              name="musical-notes"
              size={24}
              color={displayTheme.text + "80"}
            />
          </PlaceholderThumbnail>
        )}

        <TrackInfo>
          <TrackTitle numberOfLines={1} style={{ color: "#fff" }}>
            {currentTrack.title}
          </TrackTitle>
          {currentTrack.artist && (
            <TrackArtist
              numberOfLines={1}
              style={{ color: "#fff", opacity: 0.7 }}
            >
              {currentTrack.artist}
            </TrackArtist>
          )}
        </TrackInfo>
      </TouchableOpacity>

      <ControlsContainer style={{ zIndex: 1 }}>
        <ControlButton onPress={handlePrevious}>
          <Ionicons name="play-back" size={20} color="#fff" />
        </ControlButton>

        <ControlButton
          onPress={
            isLoading || isTransitioning ? cancelLoadingState : handlePlayPause
          }
          disabled={false}
        >
          {isLoading || isTransitioning ? (
            <ActivityIndicator
              size="small"
              color="#fff"
              style={{ width: 24, height: 24 }}
            />
          ) : (
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={24}
              color="#fff"
            />
          )}
        </ControlButton>

        <ControlButton onPress={handleNext}>
          <Ionicons name="play-forward" size={20} color="#fff" />
        </ControlButton>
      </ControlsContainer>
    </MiniPlayerContainer>
  );
};
