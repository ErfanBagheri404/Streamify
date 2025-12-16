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
`;
const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: bold;
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
  font-weight: bold;
`;
const ArtistName = styled.Text`
  color: #9ca3af;
  font-size: 16px;
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
`;
const ControlsContainer = styled.View`
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  margin-top: 16px;
  margin-bottom: 32px;
`;
const PlayButton = styled.TouchableOpacity`
  background-color: #a3e635;
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
`;
const ErrorText = styled.Text`
  color: #ef4444;
  font-size: 12px;
  margin-top: 8px;
`;

/* =================================================================
   2.  YT-DLP WRAPPER  (react-native-ytdl)
================================================================= */
async function getAudioUrlWithFallback(
  videoId: string,
  onStatus: (msg: string) => void,
  source?: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<string> {
  try {
    return await getAudioStreamUrl(
      videoId,
      onStatus,
      source,
      trackTitle,
      trackArtist
    );
  } catch (error) {
    console.error("[Player] All audio extraction methods failed:", error);
    throw new Error(
      `Unable to extract audio: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
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

  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationMillis, setDurationMillis] = useState(0);
  const [positionMillis, setPositionMillis] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const appState = useRef(AppState.currentState);

  const formatTime = (millis: number) => {
    if (!millis) return "0:00";
    const total = Math.floor(millis / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
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
      });
    })();
    const sub = AppState.addEventListener("change", (next) => {
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  /* --------------  LOAD SONG WHEN ID CHANGES  -------------- */
  useEffect(() => {
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
      if (sound) await sound.unloadAsync();
      if (!mounted) return;
      setSound(null);
      setIsPlaying(false);
      setPositionMillis(0);
      setDurationMillis(0);
      setError("");
      setStatusMsg("");

      try {
        const uri = await getAudioUrlWithFallback(
          item.id,
          (msg) => mounted && setStatusMsg(msg),
          item.source,
          item.title,
          item.author
        );
        if (!mounted) return;

        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true },
          (status) => {
            if (status.isLoaded && mounted) {
              setIsPlaying(status.isPlaying);
              setDurationMillis(status.durationMillis ?? 0);
              setPositionMillis(status.positionMillis);
            }
          }
        );
        if (mounted) {
          setSound(newSound);
          setStatusMsg("");
          // Prefetch next track after current one loads successfully
          prefetchNextTrack();
        }
      } catch (e: any) {
        if (mounted) {
          setError(e.message || "Playback failed");
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
  }, [item.id]);

  /* --------------  PLAY / PAUSE  -------------- */
  const handlePlayPause = async () => {
    if (!sound) return;
    isPlaying ? await sound.pauseAsync() : await sound.playAsync();
  };

  const progress =
    durationMillis > 0 ? (positionMillis / durationMillis) * 100 : 0;

  /* --------------  RENDER  -------------- */
  if (!item)
    return (
      <Screen style={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#a3e635" />
      </Screen>
    );

  return (
    <Screen>
      <StatusBar barStyle="light-content" />
      <Header>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-down" size={24} color="#fff" />
        </TouchableOpacity>

        <HeaderTextContainer>
          <HeaderText>NOW PLAYING</HeaderText>
          <HeaderTitle numberOfLines={1}>{item.author || "…"}</HeaderTitle>
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
        <ProgressBar>
          <Progress width={progress} />
        </ProgressBar>
        <TimeContainer>
          <TimeText>{formatTime(positionMillis)}</TimeText>
          <TimeText>{formatTime(durationMillis)}</TimeText>
        </TimeContainer>
      </ProgressBarContainer>

      <ControlsContainer>
        <Ionicons name="shuffle" size={24} color="#fff" />
        <Ionicons name="play-skip-back" size={24} color="#fff" />
        <PlayButton onPress={handlePlayPause}>
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={28}
            color="#000"
          />
        </PlayButton>
        <Ionicons name="play-skip-forward" size={24} color="#fff" />
        <Ionicons name="chatbox-ellipses-outline" size={24} color="#fff" />
      </ControlsContainer>
    </Screen>
  );
}
