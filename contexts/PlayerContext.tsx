import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Audio } from "expo-av";
import {
  AudioStreamManager,
  getAudioStreamUrl,
} from "../modules/audioStreaming";
import { extractColorsFromImage, ColorTheme } from "../utils/imageColors";

export interface Track {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  thumbnail?: string;
  audioUrl?: string;
  source?: string;
  _isSoundCloud?: boolean;
}

interface PlayerContextType {
  currentTrack: Track | null;
  playlist: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  sound: Audio.Sound | null;
  showFullPlayer: boolean;
  repeatMode: "off" | "one" | "all";
  isShuffled: boolean;
  colorTheme: ColorTheme;

  // Actions
  playTrack: (
    track: Track,
    playlist?: Track[],
    index?: number,
  ) => Promise<void>;
  playPause: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  setShowFullPlayer: (show: boolean) => void;
  setRepeatMode: (mode: "off" | "one" | "all") => void;
  toggleShuffle: () => void;
  clearPlayer: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [repeatMode, setRepeatMode] = useState<"off" | "one" | "all">("off");
  const [isShuffled, setIsShuffled] = useState(false);
  const [colorTheme, setColorTheme] = useState<ColorTheme>({
    primary: "#a3e635",
    secondary: "#22d3ee",
    background: "#000000",
    text: "#ffffff",
    accent: "#f59e0b",
  });
  const originalPlaylistRef = useRef<Track[]>([]);

  const soundRef = useRef<Audio.Sound | null>(null);
  const audioManager = useRef(new AudioStreamManager()).current;

  // Update color theme only when track is ready (after loading completes)
  useEffect(() => {
    const updateTheme = async () => {
      if (!currentTrack?.thumbnail || isLoading) {
        setColorTheme({
          primary: "#ffffff",
          secondary: "#ffffff",
          background: "#000000",
          text: "#ffffff",
          accent: "#ffffff",
        });
        return;
      }

      try {
        const theme = await extractColorsFromImage(currentTrack.thumbnail);
        setColorTheme(theme);
      } catch (error) {
        console.error("[PlayerContext] Error extracting theme colors:", error);
      }
    };

    updateTheme();
  }, [currentTrack?.thumbnail, isLoading]);

  const playTrack = useCallback(
    async (track: Track, playlistData: Track[] = [], index: number = 0) => {
      try {
        setIsLoading(true);
        // Set the track immediately so MiniPlayer can appear
        setCurrentTrack(track);
        setPlaylist(playlistData);
        setCurrentIndex(index);
        setIsPlaying(false);

        // Stop current playback if any
        if (soundRef.current) {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        }

        // Get audio URL using the streaming manager
        let audioUrl = track.audioUrl;

        if (!audioUrl && track.id) {
          // Try to get audio URL from streaming service
          try {
            if (track._isSoundCloud || track.source === "soundcloud") {
              // For SoundCloud tracks, use the standalone function with title and artist for better matching
              audioUrl = await getAudioStreamUrl(
                track.id,
                undefined,
                "soundcloud",
                track.title,
                track.artist,
              );
            } else {
              // For YouTube tracks
              audioUrl = await getAudioStreamUrl(
                track.id,
                undefined,
                "youtube",
                track.title,
                track.artist,
              );
            }
          } catch (streamingError) {
            console.error(
              "[PlayerContext] Failed to get streaming URL:",
              streamingError,
            );
            // If streaming fails, try to use a placeholder or fallback
            // For now, we'll continue with a null audioUrl and handle it below
          }
        }

        if (!audioUrl) {
          // Instead of throwing an error, create a placeholder track
          console.warn(
            "[PlayerContext] No audio URL available, creating placeholder",
          );
          // We'll still create the sound object but with a silent/placeholder audio
          // This allows the UI to show the track info even if playback isn't available
        }

        // Create new sound (with fallback for missing audio URL)
        let newSound;
        try {
          if (audioUrl) {
            const { sound } = await Audio.Sound.createAsync(
              { uri: audioUrl },
              { shouldPlay: true },
            );
            newSound = sound;
          } else {
            // Create a silent sound object to allow UI to work
            const { sound } = await Audio.Sound.createAsync(
              { uri: "https://www.soundjay.com/misc/sounds/silence.mp3" }, // Silent placeholder
              { shouldPlay: false, volume: 0 },
            );
            newSound = sound;
            console.warn("[PlayerContext] Created placeholder sound object");
          }

          soundRef.current = newSound;
          setSound(newSound);
          setIsPlaying(!!audioUrl); // Only set as playing if we have a real audio URL
          setIsLoading(false);
          setCurrentTrack({ ...track, audioUrl });
        } catch (soundError) {
          console.error(
            "[PlayerContext] Failed to create sound object:",
            soundError,
          );
          // Even if sound creation fails, we can still show the track in UI
          setIsPlaying(false);
          setIsLoading(false);
          setCurrentTrack({ ...track, audioUrl });
        }

        // Set up playback status updates (only if we have a real sound object)
        if (newSound && audioUrl) {
          newSound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded) {
              if (status.didJustFinish) {
                // Auto play next track when current finishes
                nextTrack();
              }
            }
          });
        }
      } catch (error) {
        console.error("[PlayerContext] Error playing track:", error);
        setIsLoading(false);
      }
    },
    [audioManager, playlist, currentIndex],
  );

  const playPause = useCallback(async () => {
    if (!soundRef.current || !currentTrack?.audioUrl) {
      return;
    }

    try {
      if (isPlaying) {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error("[PlayerContext] Error toggling play/pause:", error);
    }
  }, [isPlaying, currentTrack?.audioUrl]);

  const nextTrack = useCallback(async () => {
    if (playlist.length === 0) {
      return;
    }

    // Handle repeat one mode
    if (repeatMode === "one" && currentTrack) {
      await playTrack(currentTrack, playlist, currentIndex);
      return;
    }

    // Handle repeat all mode (loop back to start)
    let nextIndex = (currentIndex + 1) % playlist.length;

    // If we're at the end and repeat is off, don't play next
    if (
      nextIndex === 0 &&
      repeatMode === "off" &&
      currentIndex === playlist.length - 1
    ) {
      // Stop playback at the end
      if (soundRef.current) {
        await soundRef.current.stopAsync();
      }
      setIsPlaying(false);
      return;
    }

    const nextTrackItem = playlist[nextIndex];

    if (nextTrackItem) {
      await playTrack(nextTrackItem, playlist, nextIndex);
    }
  }, [playlist, currentIndex, playTrack, repeatMode, currentTrack]);

  const previousTrack = useCallback(async () => {
    if (playlist.length === 0) {
      return;
    }

    const prevIndex =
      currentIndex === 0 ? playlist.length - 1 : currentIndex - 1;
    const prevTrack = playlist[prevIndex];

    if (prevTrack) {
      await playTrack(prevTrack, playlist, prevIndex);
    }
  }, [playlist, currentIndex, playTrack]);

  const seekTo = useCallback(async (position: number) => {
    if (!soundRef.current) {
      return;
    }

    try {
      await soundRef.current.setPositionAsync(position);
    } catch (error) {
      console.error("[PlayerContext] Error seeking:", error);
    }
  }, []);

  const clearPlayer = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
    }

    setCurrentTrack(null);
    setPlaylist([]);
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsLoading(false);
    setSound(null);
    soundRef.current = null;
  }, []);

  const toggleShuffle = useCallback(() => {
    const newShuffledState = !isShuffled;
    setIsShuffled(newShuffledState);

    if (newShuffledState && playlist.length > 0) {
      // Save original playlist order
      originalPlaylistRef.current = [...playlist];

      // Create shuffled playlist (excluding current track)
      const currentTrackItem = playlist[currentIndex];
      const remainingTracks = playlist.filter(
        (_, index) => index !== currentIndex,
      );

      // Fisher-Yates shuffle
      for (let i = remainingTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingTracks[i], remainingTracks[j]] = [
          remainingTracks[j],
          remainingTracks[i],
        ];
      }

      // Put current track at the beginning
      const shuffledPlaylist = [currentTrackItem, ...remainingTracks];
      setPlaylist(shuffledPlaylist);
      setCurrentIndex(0);
    } else if (!newShuffledState && originalPlaylistRef.current.length > 0) {
      // Restore original playlist order
      const currentTrackItem = playlist[currentIndex];
      const originalIndex = originalPlaylistRef.current.findIndex(
        (track) => track.id === currentTrackItem?.id,
      );

      setPlaylist(originalPlaylistRef.current);
      setCurrentIndex(originalIndex >= 0 ? originalIndex : 0);
    }
  }, [isShuffled, playlist, currentIndex]);

  const value: PlayerContextType = {
    currentTrack,
    playlist,
    currentIndex,
    isPlaying,
    isLoading,
    sound,
    showFullPlayer,
    repeatMode,
    isShuffled,
    colorTheme,
    playTrack,
    playPause,
    nextTrack,
    previousTrack,
    seekTo,
    setShowFullPlayer,
    setRepeatMode,
    toggleShuffle,
    clearPlayer,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};
