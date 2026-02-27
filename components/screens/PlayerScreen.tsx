/********************************************************************
 *  PlayerScreen.tsx  –  react-native-ytdl edition
 *******************************************************************/
import React from "react";
import { useState, useEffect, useRef } from "react";
import styled from "styled-components/native";
import {
  StatusBar,
  Dimensions,
  TouchableOpacity,
  AppState,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";
import type { AVPlaybackStatusError } from "expo-av";
import Slider from "@react-native-community/slider";
import {
  getAudioStreamUrl,
  prefetchAudioStreamUrl,
} from "../../modules/audioStreaming";
/* =================================================================
   1.  STYLES  (unchanged)
================================================================= */
const Screen = styled.View`
  flex: 1;
  background-color: #000;
  padding: 16px;
`;

const EmptyPlayerContainer = styled.View`
  flex: 1;
  background-color: #000;
`;
const Header = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 32px;
  margin-bottom: 32px;
`;
const HeaderTextContainer = styled.View`
  align-items: center;
`;
const HeaderText = styled.Text`
  color: #9ca3af;
  font-size: 12px;
  letter-spacing: 0.5px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;
const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansBold;
`;
const PlaylistPositionText = styled.Text`
  color: #9ca3af;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
`;
const AlbumArt = styled.Image`
  width: ${Dimensions.get("window").width - 32}px;
  height: ${Dimensions.get("window").width - 32}px;
  border-radius: 12px;
  margin-bottom: 32px;
`;
const SongDetailsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
`;
const SongInfo = styled.View`
  flex: 1;
  padding-right: 16px;
`;
const SongTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  font-family: GoogleSansBold;
`;
const ArtistName = styled.Text`
  color: #9ca3af;
  font-size: 16px;
  font-family: GoogleSansRegular;
`;
const ProgressBarContainer = styled.View`
  margin-bottom: 16px;
`;
const ProgressBar = styled.View`
  height: 4px;
  background-color: #4b5563;
  border-radius: 2px;
`;
const Progress = styled.View<{ width: number }>`
  width: ${(p: { width: any }) => p.width}%;
  height: 100%;
  background-color: #a3e635;
  border-radius: 2px;
`;
const TimeContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 8px;
`;
const TimeText = styled.Text`
  color: #9ca3af;
  font-size: 12px;
  font-family: GoogleSansRegular;
`;
const ControlsContainer = styled.View`
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  margin-top: 16px;
  margin-bottom: 32px;
`;
const PlayButton = styled.TouchableOpacity<{ disabled?: boolean }>`
  background-color: ${(props) => (props.disabled ? "#333" : "#a3e635")};
  width: 72px;
  height: 72px;
  border-radius: 36px;
  justify-content: center;
  align-items: center;
`;
const StatusText = styled.Text`
  color: #a3e635;
  font-size: 12px;
  margin-top: 8px;
  font-family: GoogleSansRegular;
`;
const ErrorText = styled.Text`
  color: #ef4444;
  font-size: 12px;
  margin-top: 8px;
  font-family: GoogleSansRegular;
`;

/* =================================================================
   2.  YT-DLP WRAPPER  (react-native-ytdl)
================================================================= */
async function getAudioUrlWithFallback(
  videoId: string,
  onStatus: (msg: string) => void,
  source?: string,
  trackTitle?: string,
  trackArtist?: string,
): Promise<string> {
  try {
    return await getAudioStreamUrl(videoId, onStatus, source);
  } catch (error) {
    console.error("[Player] All audio extraction methods failed:", error);
    throw new Error(
      `Unable to extract audio: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

/* =================================================================
   3.  COMPONENT
================================================================= */
export default function PlayerScreen({ route, navigation }: any) {
  const item = route.params?.item;
  const playlist = route.params?.playlist || [];
  const currentIndex = route.params?.currentIndex || 0;

  console.log("[Player] Screen opened with item:", {
    id: item?.id,
    title: item?.title,
    source: item?.source,
    playlistLength: playlist.length,
    currentIndex,
  });

  // Debug: Log navigation state
  console.log("[Player] Navigation state:", {
    canGoBack: navigation.canGoBack(),
    currentRoute: navigation.getState?.(),
  });

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationMillis, setDurationMillis] = useState(0);
  const [positionMillis, setPositionMillis] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreviewMillis, setSeekPreviewMillis] = useState<number | null>(
    null,
  );
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const appState = useRef(AppState.currentState);
  const lastSeekInteraction = useRef(0);

  // failedTracks removed - no longer needed
  // const failedTracks = useRef<Set<string>>(new Set());

  // Add debouncing for position updates to reduce flickering
  const lastPositionUpdate = useRef(0);
  const positionUpdateThreshold = 250; // Update at most every 250ms for smoother progress

  const formatTime = (millis: number) => {
    if (!millis) {
      return "0:00";
    }
    const total = Math.floor(millis / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  /* --------------  SAFE NAVIGATION  -------------- */
  const handleGoBack = () => {
    try {
      // First try to go back to the previous screen in the stack
      if (navigation.canGoBack()) {
        console.log("[Player] Attempting to go back using navigation.goBack()");
        navigation.goBack();
      } else {
        console.log(
          "[Player] No previous screen available, navigating to Search tab",
        );
        // Navigate to Search tab to preserve search state
        console.log("[Player] Navigating to Home -> Search");
        navigation.navigate("Home", { screen: "Search" });
      }
    } catch (error) {
      console.log("[Player] Navigation error:", error);
      console.log("[Player] Falling back to Search tab");
      navigation.navigate("Home", { screen: "Search" });
    }
  };

  /* --------------  PLAYLIST NAVIGATION  -------------- */
  const navigateToPrevious = async () => {
    if (!item) {
      console.log("[Player] Cannot navigate: no current item");
      return;
    }
    console.log(`[Player] Navigating to previous track: ${currentIndex - 1}`);
    if (currentIndex > 0 && playlist.length > 0) {
      const previousItem = playlist[currentIndex - 1];
      if (!previousItem) {
        console.log("[Player] Cannot navigate: previous item not found");
        return;
      }
      console.log(
        `[Player] Previous item: ${previousItem.title} (${previousItem.id})`,
      );
      console.log(
        "[Player] Previous item complete data:",
        JSON.stringify(previousItem, null, 2),
      );
      // Stop current playback before navigation
      if (sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
      }

      // Add a small delay to ensure cleanup completes and prevent rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log(
        `[Player] Navigating to previous track: ${previousItem.title} (${previousItem.id})`,
      );
      navigation.push("Player", {
        item: previousItem,
        playlist,
        currentIndex: currentIndex - 1,
      });
    }
  };

  const navigateToNext = async () => {
    if (!item) {
      console.log("[Player] Cannot navigate: no current item");
      return;
    }
    console.log(`[Player] Navigating to next track: ${currentIndex + 1}`);
    if (currentIndex < playlist.length - 1 && playlist.length > 0) {
      const nextItem = playlist[currentIndex + 1];
      if (!nextItem) {
        console.log("[Player] Cannot navigate: next item not found");
        return;
      }
      console.log(`[Player] Next item: ${nextItem.title} (${nextItem.id})`);
      console.log(
        "[Player] Next item complete data:",
        JSON.stringify(nextItem, null, 2),
      );

      // Stop current playback before navigation
      if (sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
      }

      // Add a small delay to ensure cleanup completes and prevent rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log(
        `[Player] Navigating to next track: ${nextItem.title} (${nextItem.id})`,
      );
      navigation.push("Player", {
        item: nextItem,
        playlist,
        currentIndex: currentIndex + 1,
      });
    }
  };

  /* --------------  AUDIO SESSION  -------------- */
  useEffect(() => {
    (async () => {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        playThroughEarpieceAndroid: false,
        // Additional settings to reduce audio flickering
        staysActiveInBackground: true,
      });
    })();
    const sub = AppState.addEventListener("change", (next) => {
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isSeeking) {
      return;
    }
    const interval = setInterval(() => {
      if (Date.now() - lastSeekInteraction.current > 1000) {
        setIsSeeking(false);
        setSeekPreviewMillis(null);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [isSeeking]);

  /* --------------  LOAD SONG WHEN ID CHANGES  -------------- */
  useEffect(() => {
    // Guard against running when no item is provided
    if (!item) {
      console.log("[Player] No item provided, skipping audio loading");
      console.log(
        `[Player] Current state - item: ${item}, sound: ${sound}, isPlaying: ${isPlaying}`,
      );
      return;
    }

    console.log(
      `[Player] Item changed, loading new track: ${item.title} (${item.id})`,
    );

    // Reset position and duration when track changes to prevent progress bar sync issues
    setPositionMillis(0);
    setDurationMillis(0);

    // failedTracks removed - no longer clearing failed tracks

    let mounted = true;

    // Prefetch next track for seamless playback (ytify v8 concept)
    const prefetchNextTrack = async () => {
      if (currentIndex < playlist.length - 1) {
        const nextItem = playlist[currentIndex + 1];
        if (nextItem?.id) {
          try {
            await prefetchAudioStreamUrl(nextItem.id, nextItem.source);
            console.log("[Player] Prefetched next track:", nextItem.title);
          } catch (error) {
            console.warn("[Player] Failed to prefetch next track:", error);
          }
        }
      }
    };

    const load = async () => {
      if (sound) {
        await sound.unloadAsync();
      }
      if (!mounted) {
        return;
      }
      setSound(null);
      setError("");
      if (!mounted) {
        return;
      }
      setStatusMsg("Loading...");

      let uri: string | null = null; // Declare uri outside try block

      try {
        console.log(
          `[Player] Loading audio for track: ${item.title} (${item.id}), source: ${item.source}, author: ${item.author}, duration: ${item.duration}`,
        );
        console.log(
          "[Player] Complete track data:",
          JSON.stringify(item, null, 2),
        );
        uri = await getAudioUrlWithFallback(
          item.id,
          (msg) => mounted && setStatusMsg(msg),
          item.source,
          item.title,
          item.author,
        );
        if (!mounted) {
          return;
        }

        console.log("[Player] Got stream URL, creating audio object...");
      } catch (error) {
        console.error(
          `[Player] Failed to load track: ${item.title} (${item.id}):`,
          error,
        );

        // failedTracks removed - no longer tracking failed tracks
        setError(
          `Unable to play this track: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        setStatusMsg("Track unavailable");

        // Just show error, don't auto-skip
        console.log("[Player] Track failed, user can manually skip if desired");
        return;
      }

      try {
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: uri! },
          {
            shouldPlay: true,
            // Optimize for better playback quality and reduce flickering
            androidImplementation: "MediaPlayer", // Use MediaPlayer for better stability
            progressUpdateIntervalMillis: 1000,
            // Reduce audio quality issues
            audioPan: 0,
            volume: 1.0,
            rate: 1.0,
            isMuted: false,
            isLooping: false,
            // Additional optimizations for streaming

            // interruptionModeAndroid is not a valid prop for AVPlaybackStatusToSet
            // Audio mode is already configured globally in the useEffect above
          },
          (status) => {
            if (!mounted) {
              return;
            } // Exit if the component has unmounted

            if (status.isLoaded) {
              // --- Success Case: Audio is loaded ---
              setIsPlaying(status.isPlaying);
              setDurationMillis(status.durationMillis ?? 0);

              // Debounce position updates to reduce flickering
              const now = Date.now();
              if (
                !isSeeking &&
                now - lastPositionUpdate.current >= positionUpdateThreshold
              ) {
                setPositionMillis(status.positionMillis);
                lastPositionUpdate.current = now;
              }

              // Auto-advance to next track when current track ends
              if (status.didJustFinish && !status.isLooping) {
                console.log("[Player] Track finished, advancing to next...");
                navigateToNext();
                return;
              }

              if (status.isBuffering) {
                console.log("[Player] Audio is buffering...");
                // Don't show buffering status for very short buffer events to reduce flicker
                if (
                  status.positionMillis > 0 &&
                  status.durationMillis &&
                  status.positionMillis / status.durationMillis > 0.1
                ) {
                  // Only show after 10% progress
                  setStatusMsg("Buffering...");
                }
              } else {
                // Clear buffering status when not buffering
                if (statusMsg === "Buffering...") {
                  setStatusMsg("");
                }
              }
            } else {
              // --- Error Case: Audio failed to load ---
              // `isLoaded` is false, so status is AVPlaybackStatusError.
              // We can safely access the `error` property here.
              const errorStatus = status as AVPlaybackStatusError;
              if (errorStatus.error) {
                const errorMessage = `Playback error: ${errorStatus.error}`;
                console.error("[Player]", errorMessage);
                setError(errorMessage);
              }
            }
          },
        );
        if (mounted) {
          setSound(newSound);
          setStatusMsg("");
          // Prefetch next track after current one loads successfully
          prefetchNextTrack();
        }
      } catch (e: any) {
        if (mounted) {
          const errorMessage = e.message || "Playback failed";
          console.error(
            `[Player] Audio loading failed for ${item.title}:`,
            errorMessage,
          );
          if (uri) {
            console.error("[Player] Stream URL:", uri);
          }
          setError(errorMessage);
          setStatusMsg("");
        }
        console.error("[Player] load error:", e);
      }
    };

    load();

    return () => {
      mounted = false;
      sound?.unloadAsync();
    };
  }, [item?.id]);

  /* --------------  PLAY / PAUSE  -------------- */
  const handlePlayPause = async () => {
    if (!sound || !item) {
      return;
    }
    isPlaying ? await sound.pauseAsync() : await sound.playAsync();
  };

  /* --------------  SEEK  -------------- */
  const handleSeek = async (valueMillis: number) => {
    if (!sound || !item) {
      return;
    }
    const seekPositionMillis = Math.max(
      0,
      Math.min(valueMillis, durationMillis || 0),
    );
    console.log(`[PlayerScreen] Seeking to: ${seekPositionMillis}ms`);

    try {
      await sound.setPositionAsync(seekPositionMillis);
      setPositionMillis(seekPositionMillis);
    } catch (error) {
      console.error("[PlayerScreen] Error seeking:", error);
    }
  };

  const progress =
    durationMillis > 0 ? (positionMillis / durationMillis) * 100 : 0;

  /* --------------  RENDER  -------------- */
  console.log(
    "[Player] Render - item:",
    item ? `${item.title} (${item.id})` : "null",
    `sound: ${sound ? "exists" : "null"}, isPlaying: ${isPlaying}`,
  );

  // Handle state sync issue: if we have a sound playing but no item data
  if (!item && sound) {
    console.log("[Player] State sync issue: sound exists but no item data");
    // Create a placeholder item to maintain UI consistency
    const placeholderItem = {
      id: "unknown",
      title: "Unknown Track",
      author: "Unknown Artist",
      duration: "0",
      source: "unknown",
      thumbnailUrl: "https://placehold.co/400x400/000000/a3e635?text=Unknown",
    };

    // Use the placeholder item for UI rendering, but keep the actual sound
    return (
      <Screen>
        <StatusBar barStyle="light-content" />
        <Header>
          <TouchableOpacity onPress={handleGoBack}>
            <Ionicons name="chevron-down" size={24} color="#fff" />
          </TouchableOpacity>

          <HeaderTextContainer>
            <HeaderText>NOW PLAYING</HeaderText>
            <HeaderTitle numberOfLines={1}>{placeholderItem.title}</HeaderTitle>
          </HeaderTextContainer>

          <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
        </Header>

        <AlbumArt
          source={{
            uri: placeholderItem.thumbnailUrl,
          }}
        />

        <SongDetailsContainer>
          <SongInfo>
            <SongTitle numberOfLines={2}>{placeholderItem.title}</SongTitle>
            <ArtistName>{placeholderItem.author}</ArtistName>
          </SongInfo>
          <Ionicons name="heart-outline" size={24} color="#fff" />
        </SongDetailsContainer>

        <ProgressBarContainer>
          <Slider
            value={
              isSeeking && seekPreviewMillis !== null
                ? seekPreviewMillis
                : positionMillis
            }
            minimumValue={0}
            maximumValue={Math.max(durationMillis, 1)}
            minimumTrackTintColor="#a3e635"
            maximumTrackTintColor="#4b5563"
            thumbTintColor="#ffffff"
            disabled={durationMillis <= 0}
            onValueChange={(val) => {
              lastSeekInteraction.current = Date.now();
              const delta = Math.abs(val - positionMillis);
              if (!isSeeking && delta > 750) {
                setIsSeeking(true);
                setSeekPreviewMillis(positionMillis);
              }
              setSeekPreviewMillis(val);
            }}
            onSlidingComplete={async (val) => {
              lastSeekInteraction.current = Date.now();
              await handleSeek(val);
              setIsSeeking(false);
              setSeekPreviewMillis(null);
            }}
          />
          <TimeContainer>
            <TimeText>
              {formatTime(
                isSeeking && seekPreviewMillis !== null
                  ? seekPreviewMillis
                  : positionMillis,
              )}
            </TimeText>
            <TimeText>{formatTime(durationMillis)}</TimeText>
          </TimeContainer>
        </ProgressBarContainer>

        <ControlsContainer>
          <Ionicons name="shuffle" size={24} color="#666" />
          <TouchableOpacity onPress={navigateToPrevious}>
            <Ionicons name="play-skip-back" size={24} color="#fff" />
          </TouchableOpacity>
          <PlayButton onPress={handlePlayPause}>
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={28}
              color="#000"
            />
          </PlayButton>
          <TouchableOpacity onPress={navigateToNext}>
            <Ionicons name="play-skip-forward" size={24} color="#fff" />
          </TouchableOpacity>
          <Ionicons name="chatbox-ellipses-outline" size={24} color="#fff" />
        </ControlsContainer>
      </Screen>
    );
  } else if (!item) {
    return (
      <EmptyPlayerContainer>
        <Screen>
          <StatusBar barStyle="light-content" />
          <Header>
            <TouchableOpacity onPress={handleGoBack}>
              <Ionicons name="chevron-down" size={24} color="#fff" />
            </TouchableOpacity>

            <HeaderTextContainer>
              <HeaderText>NOW PLAYING</HeaderText>
              <HeaderTitle numberOfLines={1}>No track loaded</HeaderTitle>
            </HeaderTextContainer>

            <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
          </Header>

          <AlbumArt
            source={{
              uri: "https://placehold.co/400x400/000000/a3e635?text=No+Track",
            }}
          />

          <SongDetailsContainer>
            <SongInfo>
              <SongTitle numberOfLines={2}>No track selected</SongTitle>
              <ArtistName>Select a track to start playing</ArtistName>
            </SongInfo>
            <Ionicons name="heart-outline" size={24} color="#fff" />
          </SongDetailsContainer>

          <ProgressBarContainer>
            <Slider
              value={0}
              minimumValue={0}
              maximumValue={1}
              minimumTrackTintColor="#a3e635"
              maximumTrackTintColor="#4b5563"
              thumbTintColor="#ffffff"
              disabled={true}
            />
            <TimeContainer>
              <TimeText>0:00</TimeText>
              <TimeText>0:00</TimeText>
            </TimeContainer>
          </ProgressBarContainer>

          <ControlsContainer>
            <Ionicons name="shuffle" size={24} color="#666" />
            <TouchableOpacity disabled={true}>
              <Ionicons name="play-skip-back" size={24} color="#666" />
            </TouchableOpacity>
            <PlayButton onPress={() => {}} disabled={true}>
              <Ionicons name="play" size={28} color="#666" />
            </PlayButton>
            <TouchableOpacity disabled={true}>
              <Ionicons name="play-skip-forward" size={24} color="#666" />
            </TouchableOpacity>
            <Ionicons name="chatbox-ellipses-outline" size={24} color="#666" />
          </ControlsContainer>
        </Screen>
      </EmptyPlayerContainer>
    );
  }

  return (
    <Screen>
      <StatusBar barStyle="light-content" />
      <Header>
        <TouchableOpacity onPress={handleGoBack}>
          <Ionicons name="chevron-down" size={24} color="#fff" />
        </TouchableOpacity>

        <HeaderTextContainer>
          <HeaderText>NOW PLAYING</HeaderText>
          <HeaderTitle numberOfLines={1}>{item.author || "…"}</HeaderTitle>
          {playlist.length > 1 && (
            <PlaylistPositionText>
              {currentIndex + 1} of {playlist.length}
            </PlaylistPositionText>
          )}
        </HeaderTextContainer>

        <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
      </Header>

      <AlbumArt
        source={{
          uri:
            item.thumbnailUrl ||
            "https://placehold.co/400x400/000000/a3e635?text=Music",
        }}
      />

      <SongDetailsContainer>
        <SongInfo>
          <SongTitle numberOfLines={2}>{item.title}</SongTitle>
          <ArtistName>{item.author}</ArtistName>
          {statusMsg ? <StatusText>{statusMsg}</StatusText> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
        </SongInfo>
        <Ionicons name="heart-outline" size={24} color="#fff" />
      </SongDetailsContainer>

      <ProgressBarContainer>
        <Slider
          value={
            isSeeking && seekPreviewMillis !== null
              ? seekPreviewMillis
              : positionMillis
          }
          minimumValue={0}
          maximumValue={Math.max(durationMillis, 1)}
          minimumTrackTintColor="#a3e635"
          maximumTrackTintColor="#4b5563"
          thumbTintColor="#ffffff"
          disabled={!item || durationMillis <= 0}
          onValueChange={(val) => {
            lastSeekInteraction.current = Date.now();
            const delta = Math.abs(val - positionMillis);
            if (!isSeeking && delta > 750) {
              setIsSeeking(true);
              setSeekPreviewMillis(positionMillis);
            }
            setSeekPreviewMillis(val);
          }}
          onSlidingComplete={async (val) => {
            lastSeekInteraction.current = Date.now();
            await handleSeek(val);
            setIsSeeking(false);
            setSeekPreviewMillis(null);
          }}
        />
        <TimeContainer>
          <TimeText>
            {formatTime(
              isSeeking && seekPreviewMillis !== null
                ? seekPreviewMillis
                : positionMillis,
            )}
          </TimeText>
          <TimeText>{formatTime(durationMillis)}</TimeText>
        </TimeContainer>
      </ProgressBarContainer>

      <ControlsContainer>
        <Ionicons name="shuffle" size={24} color="#fff" />
        <TouchableOpacity
          onPress={navigateToPrevious}
          disabled={currentIndex === 0 || playlist.length === 0}
        >
          <Ionicons
            name="play-skip-back"
            size={24}
            color={
              currentIndex === 0 || playlist.length === 0 ? "#666" : "#fff"
            }
          />
        </TouchableOpacity>
        <PlayButton onPress={handlePlayPause} disabled={!item}>
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={28}
            color={!item ? "#666" : "#000"}
          />
        </PlayButton>
        <TouchableOpacity
          onPress={navigateToNext}
          disabled={
            currentIndex >= playlist.length - 1 || playlist.length === 0
          }
        >
          <Ionicons
            name="play-skip-forward"
            size={24}
            color={
              currentIndex >= playlist.length - 1 || playlist.length === 0
                ? "#666"
                : "#fff"
            }
          />
        </TouchableOpacity>
        <Ionicons name="chatbox-ellipses-outline" size={24} color="#fff" />
      </ControlsContainer>
    </Screen>
  );
}
