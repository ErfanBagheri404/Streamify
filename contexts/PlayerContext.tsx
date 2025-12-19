import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
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
    index?: number
  ) => Promise<void>;
  playPause: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  setShowFullPlayer: (show: boolean) => void;
  setRepeatMode: (mode: "off" | "one" | "all") => void;
  toggleShuffle: () => void;
  clearPlayer: () => Promise<void>;
  handleStreamFailure: () => Promise<void>;
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
  const streamCheckRef = useRef<{ position: number; time: number } | null>(
    null
  );

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

  // Monitor stream health and refresh if needed
  useEffect(() => {
    console.log(
      `[PlayerContext] Stream monitor check - soundRef.current: ${!!soundRef.current}, isPlaying: ${isPlaying}, currentTrack?.audioUrl: ${!!currentTrack?.audioUrl}`
    );

    if (!soundRef.current || !isPlaying || !currentTrack?.audioUrl) {
      console.log(
        "[PlayerContext] Stream monitor not starting - missing required components"
      );
      return;
    }

    console.log("[PlayerContext] Starting stream health monitoring");

    const streamMonitor = setInterval(async () => {
      try {
        // Double-check sound still exists before accessing
        if (!soundRef.current) {
          console.log(
            "[PlayerContext] Stream monitor - soundRef.current is null, stopping monitoring"
          );
          clearInterval(streamMonitor);
          return;
        }

        const status = await soundRef.current.getStatusAsync();
        console.log(
          `[PlayerContext] Stream status - isLoaded: ${status.isLoaded}, isPlaying: ${status.isPlaying}, position: ${status.positionMillis}`
        );

        if (status.isLoaded && status.isPlaying) {
          // Check if position is advancing
          const currentTime = Date.now();
          const position = status.positionMillis;

          // Store last known position and time
          if (!streamCheckRef.current) {
            streamCheckRef.current = { position, time: currentTime };
            console.log(
              `[PlayerContext] Initial stream check position: ${position}`
            );
            return;
          }

          const timeDiff = currentTime - streamCheckRef.current.time;
          const positionDiff = position - streamCheckRef.current.position;

          console.log(
            `[PlayerContext] Stream check - timeDiff: ${timeDiff}ms, positionDiff: ${positionDiff}ms`
          );

          // If position hasn't changed in 5+ seconds, stream might be stuck
          if (timeDiff > 5000 && positionDiff === 0) {
            console.warn(
              "[PlayerContext] Stream appears stuck, attempting refresh"
            );
            handleStreamFailure();
            streamCheckRef.current = null;
          } else {
            streamCheckRef.current = { position, time: currentTime };
          }
        } else {
          console.log(
            `[PlayerContext] Stream not in valid state - isLoaded: ${status.isLoaded}, isPlaying: ${status.isPlaying}`
          );
        }
      } catch (error) {
        // Only log if it's not a "Player does not exist" error (which is expected during cleanup)
        if (!error?.toString().includes("Player does not exist")) {
          console.error("[PlayerContext] Stream monitoring error:", error);
        } else {
          console.log(
            "[PlayerContext] Stream monitor detected player cleanup, stopping monitoring"
          );
          clearInterval(streamMonitor);
        }
      }
    }, 3000); // Check every 3 seconds

    return () => {
      console.log("[PlayerContext] Stopping stream health monitoring");
      clearInterval(streamMonitor);
      streamCheckRef.current = null;
    };
  }, [isPlaying, currentTrack?.audioUrl]);

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
        console.log(`[PlayerContext] Initial audioUrl: ${audioUrl}`);

        if (!audioUrl && track.id) {
          // Try to get audio URL from streaming service
          try {
            if (track._isSoundCloud || track.source === "soundcloud") {
              // For SoundCloud tracks, use the standalone function with title and artist for better matching
              console.log(
                `[PlayerContext] Getting SoundCloud URL for track: ${track.id}`
              );
              audioUrl = await getAudioStreamUrl(
                track.id,
                (status) =>
                  console.log(`[PlayerContext] Streaming status: ${status}`),
                "soundcloud",
                track.title,
                track.artist
              );
              console.log(`[PlayerContext] Got SoundCloud URL: ${audioUrl}`);

              // Check if we're using a cached file
              if (audioUrl.startsWith("file://")) {
                console.log(
                  `[PlayerContext] Using cached file for playback: ${audioUrl}`
                );
              } else {
                console.log(
                  `[PlayerContext] Using remote stream for playback: ${audioUrl}`
                );
              }
            } else {
              // For YouTube tracks
              console.log(
                `[PlayerContext] Getting YouTube URL for track: ${track.id}`
              );
              audioUrl = await getAudioStreamUrl(
                track.id,
                (status) =>
                  console.log(`[PlayerContext] Streaming status: ${status}`),
                "youtube",
                track.title,
                track.artist
              );
              console.log(`[PlayerContext] Got YouTube URL: ${audioUrl}`);

              // Check if we're using a cached file
              if (audioUrl.startsWith("file://")) {
                console.log(
                  `[PlayerContext] Using cached file for playback: ${audioUrl}`
                );
              } else {
                console.log(
                  `[PlayerContext] Using remote stream for playback: ${audioUrl}`
                );
              }
            }
          } catch (streamingError) {
            console.error(
              "[PlayerContext] Failed to get streaming URL:",
              streamingError
            );
            // If streaming fails, try to use a placeholder or fallback
            // For now, we'll continue with a null audioUrl and handle it below
          }
        }

        if (!audioUrl) {
          // Instead of throwing an error, create a placeholder track
          console.warn(
            "[PlayerContext] No audio URL available, creating placeholder"
          );
          // We'll still create the sound object but with a silent/placeholder audio
          // This allows the UI to show the track info even if playback isn't available
        }

        // Create new sound (with fallback for missing audio URL)
        let newSound: Audio.Sound | null = null;
        try {
          if (audioUrl) {
            console.log(`[PlayerContext] Creating sound with URL: ${audioUrl}`);
            const { sound } = await Audio.Sound.createAsync(
              { uri: audioUrl },
              { shouldPlay: true }
            );
            console.log(`[PlayerContext] Sound created successfully`);
            newSound = sound;
          } else {
            // Create a silent sound object to allow UI to work
            const { sound } = await Audio.Sound.createAsync(
              { uri: "https://www.soundjay.com/misc/sounds/silence.mp3" }, // Silent placeholder
              { shouldPlay: false, volume: 0 }
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
            soundError
          );
          // Even if sound creation fails, we can still show the track in UI
          setIsPlaying(false);
          setIsLoading(false);
          setCurrentTrack({ ...track, audioUrl });
        }

        // Set up playback monitoring (only if sound was created)
        if (!newSound) {
          console.warn(
            "[PlayerContext] Skipping playback monitoring setup: no sound object"
          );
          return;
        }

        newSound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded) {
            let lastPosition = 0;
            let positionStuckCounter = 0;
            const STUCK_THRESHOLD = 3;

            // Check if we've been in this position for too long (indicating silent playback)
            if (status.positionMillis === lastPosition) {
              positionStuckCounter++;
              if (positionStuckCounter >= 2) {
                console.error(
                  `[PlayerContext] CONFIRMED: SoundCloud audio cutout at ${status.positionMillis}ms - position stuck despite isPlaying=true`
                );
                handleStreamFailure();
                positionStuckCounter = 0;
              }
            } else {
              positionStuckCounter = 0;
            }

            // Proactive refresh for SoundCloud tracks around 55 seconds (before they expire)
            if (
              status.isPlaying &&
              track._isSoundCloud &&
              status.positionMillis >= 55000 &&
              status.positionMillis < 60000
            ) {
              console.log(
                `[PlayerContext] SoundCloud track approaching 1min, preparing for refresh at position: ${status.positionMillis}ms`
              );
              // Could implement pre-emptive refresh here if needed
            }

            // Check if position is stuck (indicates stream failure)
            if (status.isPlaying && status.positionMillis === lastPosition) {
              positionStuckCounter++;
              if (positionStuckCounter >= STUCK_THRESHOLD) {
                console.warn(
                  `[PlayerContext] Audio position stuck at ${status.positionMillis}ms, possible stream failure`
                );
                // Try to reload the stream
                handleStreamFailure();
              }
            } else {
              positionStuckCounter = 0;
            }
            lastPosition = status.positionMillis;

            if (status.didJustFinish) {
              // Auto play next track when current finishes
              nextTrack();
            }
          }
        });
      } catch (error) {
        console.error("[PlayerContext] Error playing track:", error);
        setIsLoading(false);
      }
    },
    [audioManager, playlist, currentIndex]
  );

  const playPause = useCallback(async () => {
    if (!soundRef.current || !currentTrack?.audioUrl) {
      console.warn("[PlayerContext] Cannot play/pause: Player not ready");
      return;
    }

    try {
      // Check if sound is loaded before trying to play/pause
      const status = await soundRef.current.getStatusAsync();
      if (!status.isLoaded) {
        console.warn("[PlayerContext] Cannot play/pause: Sound not loaded");
        return;
      }

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

  const seekTo = useCallback(
    async (position: number) => {
      console.log(
        `[PlayerContext] seekTo called - position: ${position}, soundRef.current: ${!!soundRef.current}, currentTrack?.audioUrl: ${!!currentTrack?.audioUrl}`
      );

      if (!soundRef.current || !currentTrack?.audioUrl) {
        console.warn("[PlayerContext] Cannot seek: Player not ready");
        return;
      }

      try {
        // Verify sound still exists before seeking
        const status = await soundRef.current.getStatusAsync();
        if (!status.isLoaded) {
          console.warn("[PlayerContext] Cannot seek: Sound not loaded");
          return;
        }

        console.log(`[PlayerContext] Seeking to position: ${position}`);
        await soundRef.current.setPositionAsync(position);
        console.log(`[PlayerContext] Seek completed successfully`);
      } catch (error) {
        // Only log if it's not a "Player does not exist" error
        if (!error?.toString().includes("Player does not exist")) {
          console.error("[PlayerContext] Error seeking:", error);
        } else {
          console.log(
            "[PlayerContext] Seek failed - player no longer exists (expected during cleanup)"
          );
        }
        throw error;
      }
    },
    [currentTrack?.audioUrl]
  );

  const handleStreamFailure = useCallback(async () => {
    console.warn("[PlayerContext] === STREAM FAILURE DETECTED ===");
    console.warn("[PlayerContext] Attempting to reload stream...");

    if (!currentTrack) {
      console.warn("[PlayerContext] No current track to reload");
      return;
    }

    console.log(
      `[PlayerContext] Current track: ${currentTrack.title} by ${currentTrack.artist}`
    );
    console.log(`[PlayerContext] Current audio URL: ${currentTrack.audioUrl}`);

    try {
      // Store current position for resume
      let currentPosition = 0;
      if (soundRef.current) {
        console.log("[PlayerContext] Getting current position before reload");
        try {
          const status = await soundRef.current.getStatusAsync();
          if (status.isLoaded) {
            currentPosition = status.positionMillis;
            console.log(
              `[PlayerContext] Current position: ${currentPosition}ms`
            );
          } else {
            console.log("[PlayerContext] Sound not loaded, position will be 0");
          }
        } catch (error) {
          console.log(`[PlayerContext] Could not get position: ${error}`);
        }
      } else {
        console.log("[PlayerContext] No sound object to get position from");
      }

      // Clear current sound
      if (soundRef.current) {
        console.log("[PlayerContext] Stopping and unloading current sound");
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
          console.log("[PlayerContext] Current sound unloaded successfully");
        } catch (error) {
          console.log(`[PlayerContext] Error unloading sound: ${error}`);
        }
      }

      // Get fresh audio URL (this might get a new working stream)
      console.log("[PlayerContext] Getting fresh audio URL...");
      let newAudioUrl = currentTrack.audioUrl;

      // Always try to get a fresh URL for SoundCloud tracks (they expire)
      if (currentTrack.id && currentTrack._isSoundCloud) {
        console.log("[PlayerContext] Getting fresh SoundCloud URL");
        try {
          newAudioUrl = await getAudioStreamUrl(
            currentTrack.id,
            undefined,
            "soundcloud",
            currentTrack.title,
            currentTrack.artist
          );
          console.log(
            `[PlayerContext] Got fresh SoundCloud URL: ${newAudioUrl}`
          );
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to get fresh SoundCloud URL:",
            error
          );
          // Keep existing URL as fallback
        }
      } else if (currentTrack.id && !currentTrack.audioUrl) {
        console.log("[PlayerContext] Getting fresh URL for track");
        try {
          newAudioUrl = await getAudioStreamUrl(
            currentTrack.id,
            undefined,
            currentTrack._isSoundCloud ? "soundcloud" : "youtube",
            currentTrack.title,
            currentTrack.artist
          );
          console.log(`[PlayerContext] Got fresh URL: ${newAudioUrl}`);
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to get fresh audio URL:",
            error
          );
        }
      }

      if (newAudioUrl) {
        console.log(
          `[PlayerContext] Creating new sound with URL: ${newAudioUrl}`
        );
        console.log(
          `[PlayerContext] URL starts with file://: ${newAudioUrl.startsWith("file://")}`
        );
        console.log(
          `[PlayerContext] URL contains double file://: ${newAudioUrl.includes("file://file://")}`
        );

        // Check if file exists for local files
        if (newAudioUrl.startsWith("file://")) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(
              newAudioUrl.replace("file://", "")
            );
            console.log(
              `[PlayerContext] File exists check: ${fileInfo.exists}${fileInfo.exists ? `, size: ${fileInfo.size}` : ""}`
            );
          } catch (error) {
            console.log(`[PlayerContext] File check error: ${error}`);
          }
        }

        // Create new sound with fresh URL
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: newAudioUrl },
          { shouldPlay: true }
        );
        console.log("[PlayerContext] New sound created successfully");

        // Seek to previous position
        if (currentPosition > 0) {
          console.log(
            `[PlayerContext] Seeking to previous position: ${currentPosition}ms`
          );
          try {
            await newSound.setPositionAsync(currentPosition);
            console.log("[PlayerContext] Seek completed");
          } catch (error) {
            console.log(`[PlayerContext] Seek failed: ${error}`);
          }
        }

        soundRef.current = newSound;
        setSound(newSound);
        setCurrentTrack({ ...currentTrack, audioUrl: newAudioUrl });

        // Set up playback monitoring again
        console.log("[PlayerContext] Setting up new playback monitoring");
        let lastPosition = currentPosition;
        let positionStuckCounter = 0;
        let lastProgressTime = Date.now();

        newSound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded) {
            // Check if position is stuck again
            if (status.isPlaying && status.positionMillis === lastPosition) {
              positionStuckCounter++;
              if (positionStuckCounter >= 3) {
                console.warn("[PlayerContext] Audio still stuck after reload");
                // Could implement more aggressive recovery here
              }
            } else {
              positionStuckCounter = 0;
              lastProgressTime = Date.now(); // Update progress time when position changes
            }
            lastPosition = status.positionMillis;

            if (status.didJustFinish) {
              nextTrack();
            }

            // Monitor for cache exhaustion - if we're getting close to the 5MB cache limit
            // and the stream is struggling, proactively reload
            if (
              status.positionMillis > 300000 &&
              status.positionMillis < 400000
            ) {
              // Between 5-6.5 minutes
              const timeSinceLastProgress = Date.now() - lastProgressTime;
              if (timeSinceLastProgress > 3000) {
                // No progress in 3 seconds
                console.warn(
                  "[PlayerContext] Possible cache exhaustion detected, reloading stream..."
                );
                handleStreamFailure();
              }
            }
          }
        });

        console.log("[PlayerContext] === STREAM RELOADED SUCCESSFULLY ===");
      } else {
        console.warn(
          "[PlayerContext] Could not get fresh audio URL for reload"
        );
      }
    } catch (error) {
      console.error("[PlayerContext] === STREAM RELOAD FAILED ===", error);
    }
  }, [currentTrack, nextTrack]);

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
        (_, index) => index !== currentIndex
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
        (track) => track.id === currentTrackItem?.id
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
    handleStreamFailure,
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
