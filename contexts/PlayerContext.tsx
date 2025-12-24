import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";
import * as FileSystem from "expo-file-system";
import {
  AudioStreamManager,
  getAudioStreamUrl,
} from "../modules/audioStreaming";
import { extractColorsFromImage, ColorTheme } from "../utils/imageColors";
import { StorageService } from "../utils/storage";
import { Platform } from "react-native";
import {
  mediaSessionManager,
  MediaSessionConfig,
} from "../modules/mediaSession";
import { backgroundTaskManager } from "../modules/backgroundTasks";
import { foregroundServiceManager } from "../modules/foregroundService";

export interface Track {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  thumbnail?: string;
  audioUrl?: string;
  source?: string;
  _isSoundCloud?: boolean;
  _isJioSaavn?: boolean;
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
  isInPlaylistContext: boolean;
  colorTheme: ColorTheme;
  likedSongs: Track[];
  previouslyPlayedSongs: Track[];
  cacheProgress: {
    trackId: string;
    percentage: number;
    fileSize: number;
  } | null;
  isTransitioning: boolean;

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
  toggleLikeSong: (track: Track) => void;
  isSongLiked: (trackId: string) => boolean;
  getCacheInfo: (trackId: string) => Promise<{
    percentage: number;
    fileSize: number;
    totalFileSize?: number;
    isFullyCached: boolean;
    isDownloading?: boolean;
    downloadSpeed?: number;
    retryCount?: number;
  }>;
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
  const [isInPlaylistContext, setIsInPlaylistContext] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [likedSongs, setLikedSongs] = useState<Track[]>([]);
  const [previouslyPlayedSongs, setPreviouslyPlayedSongs] = useState<Track[]>(
    []
  );
  const [colorTheme, setColorTheme] = useState<ColorTheme>({
    primary: "#a3e635",
    secondary: "#22d3ee",
    background: "#000000",
    text: "#ffffff",
    accent: "#f59e0b",
  });
  const [cacheProgress, setCacheProgress] = useState<{
    trackId: string;
    percentage: number;
    fileSize: number;
  } | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const originalPlaylistRef = useRef<Track[]>([]);
  const streamCheckRef = useRef<{ position: number; time: number } | null>(
    null
  );

  const soundRef = useRef<Audio.Sound | null>(null);
  const audioManager = useRef(new AudioStreamManager()).current;

  // Function refs to avoid stale closures in useEffect
  const playPauseRef = useRef<() => Promise<void>>(async () => {});
  const nextTrackRef = useRef<() => Promise<void>>(async () => {});
  const previousTrackRef = useRef<() => Promise<void>>(async () => {});
  const clearPlayerRef = useRef<() => Promise<void>>(async () => {});

  // Media Notification Helper
  const updateMediaNotification = useCallback(
    async (track: Track | null, isPlaying: boolean = false) => {
      if (!track) {
        console.log("[MediaNotification] Clearing media notification");
        await mediaSessionManager.stop();
        return;
      }

      try {
        // Get current playback status
        let position = 0;
        let duration = track.duration || 0;

        if (soundRef.current) {
          const status = await soundRef.current.getStatusAsync();
          if (status.isLoaded) {
            position = status.positionMillis;
            duration = status.durationMillis || track.duration || 0;
          }
        }

        // Create media session configuration
        const mediaConfig: MediaSessionConfig = {
          track,
          isPlaying,
          position,
          duration,
          colorTheme,
        };

        // Update media session and notification
        await mediaSessionManager.updateMediaSession(mediaConfig);

        // Update background task tracking
        if (isPlaying) {
          await backgroundTaskManager.startBackgroundTracking(
            track.id,
            position,
            duration
          );

          // Start foreground service on Android
          if (Platform.OS === "android") {
            await foregroundServiceManager.startForegroundService(
              track,
              isPlaying
            );
          }
        } else {
          await backgroundTaskManager.updateBackgroundTracking(
            track.id,
            position,
            duration,
            false
          );

          // Stop foreground service on Android when paused
          if (Platform.OS === "android") {
            await foregroundServiceManager.stopForegroundService();
          }
        }

        console.log(
          `[MediaNotification] Updated notification: ${track.title} - ${track.artist || "Unknown Artist"}`
        );
      } catch (error) {
        console.error(
          "[MediaNotification] Error updating media notification:",
          error
        );
      }
    },
    [colorTheme]
  );

  // Update media session during playback
  const updateMediaSessionDuringPlayback = useCallback(async () => {
    if (!currentTrack || !soundRef.current) return;

    try {
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded) {
        const mediaConfig: MediaSessionConfig = {
          track: currentTrack,
          isPlaying: status.isPlaying,
          position: status.positionMillis,
          duration: status.durationMillis || currentTrack.duration || 0,
          colorTheme,
        };

        await mediaSessionManager.updateMediaSession(mediaConfig);

        // Update background tracking
        await backgroundTaskManager.updateBackgroundTracking(
          currentTrack.id,
          status.positionMillis,
          status.durationMillis || currentTrack.duration || 0,
          status.isPlaying
        );
      }
    } catch (error) {
      console.error(
        "[PlayerContext] Error updating media session during playback:",
        error
      );
    }
  }, [currentTrack, colorTheme]);

  // Configure audio mode for media notifications
  useEffect(() => {
    const configureAudioMode = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          playThroughEarpieceAndroid: false,
          staysActiveInBackground: true,
        });
        console.log(
          "[PlayerContext] Audio mode configured for media notifications"
        );
      } catch (error) {
        console.error("[PlayerContext] Error configuring audio mode:", error);
      }
    };
    configureAudioMode();
  }, []);

  // Initialize media session and background tasks
  useEffect(() => {
    const initializeMediaServices = async () => {
      try {
        // Initialize media session manager
        await mediaSessionManager.initialize();

        // Initialize background task manager
        await backgroundTaskManager.initialize();

        // Initialize foreground service (Android only)
        if (Platform.OS === "android") {
          await foregroundServiceManager.initialize();
        }

        // Create notification channel for Android
        await mediaSessionManager.createNotificationChannel();

        // Restore last playback state
        const lastPlaybackState =
          await backgroundTaskManager.getLastPlaybackState();
        if (lastPlaybackState) {
          console.log(
            "[PlayerContext] Found last playback state:",
            lastPlaybackState
          );
          // You could optionally restore playback here
        }

        console.log("[PlayerContext] Media services initialized successfully");
      } catch (error) {
        console.error(
          "[PlayerContext] Error initializing media services:",
          error
        );
      }
    };
    initializeMediaServices();
  }, []);

  // Handle notification responses for media controls
  useEffect(() => {
    // Skip notification handling since expo-notifications is removed
    console.log(
      "[PlayerContext] Notification handling disabled - expo-notifications removed"
    );
    return () => {};
  }, []);

  // Load liked songs from storage on startup
  useEffect(() => {
    const loadLikedSongs = async () => {
      try {
        const savedLikedSongs = await StorageService.loadLikedSongs();
        setLikedSongs(savedLikedSongs);
      } catch (error) {
        console.error("Error loading liked songs:", error);
      }
    };
    loadLikedSongs();
  }, []);

  // Load previously played songs from storage on startup
  useEffect(() => {
    const loadPreviouslyPlayedSongs = async () => {
      try {
        const savedPreviouslyPlayed =
          await StorageService.loadPreviouslyPlayedSongs();
        setPreviouslyPlayedSongs(savedPreviouslyPlayed);
      } catch (error) {
        console.error("Error loading previously played songs:", error);
      }
    };
    loadPreviouslyPlayedSongs();
  }, []);

  // Sync cacheProgress with cache info updates
  useEffect(() => {
    if (cacheProgress && currentTrack?.id === cacheProgress.trackId) {
      console.log(
        `[PlayerContext] Cache progress updated: ${cacheProgress.percentage}%`
      );
      // Force a cache info refresh when cacheProgress changes
      const refreshCacheInfo = async () => {
        try {
          const info = await getCacheInfo(currentTrack.id);
          if (info) {
            // Update the cache info with the new percentage from cacheProgress
            setCacheProgress((prev) =>
              prev
                ? {
                    ...prev,
                    fileSize: info.fileSize,
                  }
                : null
            );
          }
        } catch (error) {
          console.error("[PlayerContext] Error refreshing cache info:", error);
        }
      };
      refreshCacheInfo();
    }
  }, [cacheProgress?.percentage, currentTrack?.id]);

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
            if (currentTrack) {
              console.warn(
                "[PlayerContext] Stream appears stuck, attempting refresh"
              );
              handleStreamFailure();
            } else {
              console.warn(
                "[PlayerContext] Stream appears stuck but no current track, skipping refresh"
              );
            }
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

  // Update media session periodically during playback
  useEffect(() => {
    if (!isPlaying || !currentTrack) {
      return;
    }

    const mediaUpdateInterval = setInterval(() => {
      updateMediaSessionDuringPlayback();
    }, 5000); // Update every 5 seconds

    return () => clearInterval(mediaUpdateInterval);
  }, [isPlaying, currentTrack, updateMediaSessionDuringPlayback]);

  const playTrack = useCallback(
    async (track: Track, playlistData: Track[] = [], index: number = 0) => {
      try {
        setIsLoading(true);
        // Set the track immediately so MiniPlayer can appear
        setCurrentTrack(track);
        setPlaylist(playlistData);
        setCurrentIndex(index);
        setIsPlaying(false);

        // Set playlist context - true if we have a playlist with more than one track
        setIsInPlaylistContext(playlistData.length > 1);

        // Add to previously played songs (only if it's from SoundCloud, YouTube, or JioSaavn)
        if (
          track.source === "soundcloud" ||
          track.source === "youtube" ||
          track.source === "jiosaavn" ||
          track._isSoundCloud
        ) {
          const updatedPreviouslyPlayed = [
            track,
            ...previouslyPlayedSongs.filter((t) => t.id !== track.id),
          ].slice(0, 100); // Keep max 100 songs
          setPreviouslyPlayedSongs(updatedPreviouslyPlayed);
          StorageService.savePreviouslyPlayedSongs(updatedPreviouslyPlayed);
        }

        // Stop current playback if any
        if (soundRef.current) {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        }

        // Get audio URL using the streaming manager
        let audioUrl = track.audioUrl;
        console.log(`[PlayerContext] Initial audioUrl: ${audioUrl}`);

        // Store original streaming URL for cache monitoring
        let originalStreamUrl: string | null = null;

        if (audioUrl && !audioUrl.startsWith("file://")) {
          // If we already have a streaming URL (not a cached file), use it as original
          originalStreamUrl = audioUrl;
          console.log(
            `[PlayerContext] Using provided streaming URL as original: ${originalStreamUrl}`
          );
        }

        if (!audioUrl && track.id) {
          // Try to get audio URL from streaming service
          try {
            if (track._isSoundCloud || track.source === "soundcloud") {
              // For SoundCloud tracks, use the standalone function with title and artist for better matching
              console.log(
                `[PlayerContext] Getting SoundCloud URL for track: ${track.id}`
              );

              // Store the original streaming URL before it gets potentially converted to cached file
              originalStreamUrl = await getAudioStreamUrl(
                track.id,
                (status) =>
                  console.log(`[PlayerContext] Streaming status: ${status}`),
                "soundcloud",
                track.title,
                track.artist
              );

              audioUrl = originalStreamUrl;
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
            } else if (track._isJioSaavn || track.source === "jiosaavn") {
              // For JioSaavn tracks, use the song details API
              console.log(
                `[PlayerContext] Getting JioSaavn URL for track: ${track.id}`
              );

              // Import JioSaavn song details function
              const { searchAPI } = await import("../modules/searchAPI");
              const songDetails = await searchAPI.getJioSaavnSongDetails(
                track.id
              );

              if (songDetails && songDetails.audioUrl) {
                audioUrl = songDetails.audioUrl;
                originalStreamUrl = audioUrl;
                console.log(`[PlayerContext] Got JioSaavn URL: ${audioUrl}`);

                // Update track with proper duration if available
                if (songDetails.duration && track.duration === 0) {
                  track.duration = songDetails.duration;
                }
              } else {
                console.error(
                  `[PlayerContext] Failed to get JioSaavn audio URL for track: ${track.id}`
                );
              }
            } else {
              // For YouTube tracks
              console.log(
                `[PlayerContext] Getting YouTube URL for track: ${track.id}`
              );

              // Store the original streaming URL before it gets potentially converted to cached file
              originalStreamUrl = await getAudioStreamUrl(
                track.id,
                (status) =>
                  console.log(`[PlayerContext] Streaming status: ${status}`),
                "youtube",
                track.title,
                track.artist
              );

              audioUrl = originalStreamUrl;
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

        // Start cache monitoring and completion if we have a valid track ID and audio URL
        if (
          track.id &&
          originalStreamUrl && // Use the original streaming URL, not the cached file URL
          (track._isSoundCloud ||
            track.source === "soundcloud" ||
            track.source === "youtube")
          // Note: JioSaavn tracks are excluded from cache monitoring since they use direct audio URLs
        ) {
          console.log(
            `[PlayerContext] Starting cache monitoring for track: ${track.id}`
          );

          // Monitor cache progress and resume if stuck
          try {
            // Import the monitoring function
            const { monitorAndResumeCache } =
              await import("../modules/audioStreaming");

            monitorAndResumeCache(track.id, originalStreamUrl, (percentage) => {
              console.log(`[PlayerContext] Cache progress: ${percentage}%`);
              setCacheProgress({
                trackId: track.id,
                percentage: percentage,
                fileSize: 0, // Will be updated when cache info is fetched
              });
            });
          } catch (monitorError) {
            console.error(
              "[PlayerContext] Failed to start cache monitoring:",
              monitorError
            );
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
            console.log("[PlayerContext] Sound created successfully");
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

          // Update media notification
          await updateMediaNotification(track, !!audioUrl);
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

        // Position tracking variables for stuck detection
        let lastPosition = 0;
        let positionStuckCounter = 0;
        const STUCK_THRESHOLD = 3;

        newSound.setOnPlaybackStatusUpdate(async (status) => {
          if (status.isLoaded) {
            // Check if we've been in this position for too long (indicating silent playback)
            if (status.positionMillis === lastPosition) {
              positionStuckCounter++;
              if (positionStuckCounter >= 2 && currentTrack) {
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
              if (positionStuckCounter >= STUCK_THRESHOLD && currentTrack) {
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
              // Refresh cache info at end of song
              if (currentTrack?.id) {
                console.log(
                  `[PlayerContext] Song finished, refreshing cache info for: ${currentTrack.id}`
                );
                const finalCacheInfo = await getCacheInfo(currentTrack.id);
                console.log(
                  "[PlayerContext] Final cache info at song end:",
                  finalCacheInfo
                );

                // Trigger post-playback YouTube caching if this is a YouTube stream
                if (
                  currentTrack.audioUrl &&
                  (currentTrack.audioUrl.includes("googlevideo.com") ||
                    currentTrack.audioUrl.includes("youtube.com") ||
                    currentTrack.audioUrl.includes("invidious") ||
                    currentTrack.audioUrl.includes("piped"))
                ) {
                  console.log(
                    `[PlayerContext] Triggering post-playback YouTube caching for: ${currentTrack.id}`
                  );
                  // Don't await this - let it run in background
                  audioManager
                    .cacheYouTubeStreamPostPlayback(
                      currentTrack.audioUrl,
                      currentTrack.id
                    )
                    .catch((error) => {
                      console.log(
                        `[PlayerContext] Post-playback YouTube caching failed: ${error}`
                      );
                    });
                }
              }

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
        await updateMediaNotification(currentTrack, false);

        // Stop background tracking when paused
        if (currentTrack?.id) {
          await backgroundTaskManager.updateBackgroundTracking(
            currentTrack.id,
            status.positionMillis,
            status.durationMillis || currentTrack.duration || 0,
            false
          );
        }
      } else {
        await soundRef.current.playAsync();
        setIsPlaying(true);
        await updateMediaNotification(currentTrack, true);

        // Resume background tracking when playing
        if (currentTrack?.id) {
          await backgroundTaskManager.startBackgroundTracking(
            currentTrack.id,
            status.positionMillis,
            status.durationMillis || currentTrack.duration || 0
          );
        }
      }
    } catch (error) {
      console.error("[PlayerContext] Error toggling play/pause:", error);
    }
  }, [isPlaying, currentTrack?.audioUrl]);

  const nextTrack = useCallback(async () => {
    console.log("[PlayerContext] nextTrack() called");
    console.log(
      `[PlayerContext] Playlist length: ${playlist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`
    );

    if (playlist.length === 0) {
      console.log("[PlayerContext] nextTrack() - No playlist, returning");
      return;
    }

    // Set transitioning state
    setIsTransitioning(true);

    // Handle repeat one mode
    if (repeatMode === "one" && currentTrack) {
      console.log(
        "[PlayerContext] nextTrack() - Repeat one mode, replaying current track"
      );
      try {
        await playTrack(currentTrack, playlist, currentIndex);
      } finally {
        setIsTransitioning(false);
      }
      return;
    }

    // Handle repeat all mode (loop back to start)
    let nextIndex = (currentIndex + 1) % playlist.length;

    // Check if we're at the end of the playlist
    const isAtEnd = currentIndex === playlist.length - 1;

    // If we're at the end and repeat is off, check if we're in playlist context
    if (nextIndex === 0 && repeatMode === "off" && isAtEnd) {
      // If not in playlist context (single track or search result), pause
      if (!isInPlaylistContext) {
        console.log("[PlayerContext] End of single track, pausing playback");
        if (soundRef.current) {
          await soundRef.current.stopAsync();
        }
        setIsPlaying(false);
        setIsTransitioning(false);
        return;
      }
      // If in playlist context, continue to next (which will be first track)
      console.log("[PlayerContext] End of playlist, looping to first track");
    }

    const nextTrackItem = playlist[nextIndex];
    console.log(
      `[PlayerContext] nextTrack() - Playing track at index ${nextIndex}: ${nextTrackItem?.title}`
    );

    if (nextTrackItem) {
      try {
        await playTrack(nextTrackItem, playlist, nextIndex);
      } catch (error) {
        console.error(`[PlayerContext] Failed to play next track: ${error}`);

        // Implement fallback logic for failed tracks
        console.log(
          "[PlayerContext] Attempting to skip to next available track"
        );

        // Try to skip to the next track in the playlist
        const fallbackIndex = (nextIndex + 1) % playlist.length;

        // Prevent infinite loops - only try once more
        if (fallbackIndex !== currentIndex) {
          const fallbackTrack = playlist[fallbackIndex];
          if (fallbackTrack) {
            console.log(
              `[PlayerContext] Fallback: Playing track at index ${fallbackIndex}: ${fallbackTrack.title}`
            );
            try {
              await playTrack(fallbackTrack, playlist, fallbackIndex);
            } catch (fallbackError) {
              console.error(
                `[PlayerContext] Fallback also failed: ${fallbackError}`
              );
              // If both attempts fail, pause playback
              if (soundRef.current) {
                await soundRef.current.stopAsync();
              }
              setIsPlaying(false);
            }
          }
        } else {
          // We're back at the original track - give up and pause
          console.error(
            "[PlayerContext] All fallback attempts failed, pausing playback"
          );
          if (soundRef.current) {
            await soundRef.current.stopAsync();
          }
          setIsPlaying(false);
        }
      } finally {
        setIsTransitioning(false);
      }
    } else {
      setIsTransitioning(false);
    }
  }, [
    playlist,
    currentIndex,
    playTrack,
    repeatMode,
    currentTrack,
    isInPlaylistContext,
    setIsTransitioning,
  ]);

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
        // Check if the target position is cached before seeking
        if (
          currentTrack.id &&
          (currentTrack._isSoundCloud ||
            currentTrack.source === "soundcloud" ||
            currentTrack.source === "youtube")
        ) {
          console.log(
            `[PlayerContext] Checking if position ${position}ms is cached for track: ${currentTrack.id}`
          );

          try {
            const { AudioStreamManager } =
              await import("../modules/audioStreaming");
            const manager = AudioStreamManager.getInstance();

            const positionCheck = await manager.isPositionCached(
              currentTrack.id,
              position
            );
            console.log(
              `[PlayerContext] Position cache check: isCached=${positionCheck.isCached}, cacheEnd=${positionCheck.estimatedCacheEndMs}ms`
            );

            if (!positionCheck.isCached) {
              console.warn(
                `[PlayerContext] Position ${position}ms is not cached (cache ends at ${positionCheck.estimatedCacheEndMs}ms). Attempting to cache more...`
              );

              // Trigger cache completion for the missing portion
              // Import the monitoring function to start cache completion
              const { monitorAndResumeCache } =
                await import("../modules/audioStreaming");

              // Start cache monitoring to complete the missing portion
              monitorAndResumeCache(
                currentTrack.id,
                currentTrack.audioUrl,
                (percentage) => {
                  console.log(
                    `[PlayerContext] Cache completion progress: ${percentage}%`
                  );
                  setCacheProgress({
                    trackId: currentTrack.id,
                    percentage: percentage,
                    fileSize: 0, // Will be updated when cache info is fetched
                  });
                }
              );

              // Show a warning to the user (you might want to add UI feedback here)
              console.warn(
                "[PlayerContext] Seeking to uncached position - audio may stutter while caching completes"
              );

              // Still allow the seek but warn that it might stutter
            } else {
              console.log(
                `[PlayerContext] Position ${position}ms is within cached range`
              );
            }
          } catch (cacheCheckError) {
            console.error(
              "[PlayerContext] Error checking position cache:",
              cacheCheckError
            );
            // Continue with seek even if cache check fails - better to try than block
          }
        }

        // Verify sound still exists before seeking
        const status = await soundRef.current.getStatusAsync();
        if (!status.isLoaded) {
          console.warn("[PlayerContext] Cannot seek: Sound not loaded");
          return;
        }

        console.log(`[PlayerContext] Seeking to position: ${position}`);
        await soundRef.current.setPositionAsync(position);
        console.log("[PlayerContext] Seek completed successfully");
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
    [
      currentTrack?.audioUrl,
      currentTrack?.id,
      currentTrack?._isSoundCloud,
      currentTrack?.source,
    ]
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

        // Position tracking variables for stuck detection
        let lastPosition = currentPosition;
        let positionStuckCounter = 0;
        let lastProgressTime = Date.now();

        newSound.setOnPlaybackStatusUpdate(async (status) => {
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
              console.log(
                "[PlayerContext] Song finished - status.didJustFinish triggered"
              );

              // Refresh cache info at end of song
              if (currentTrack?.id) {
                console.log(
                  `[PlayerContext] Song finished, refreshing cache info for: ${currentTrack.id}`
                );
                const finalCacheInfo = await getCacheInfo(currentTrack.id);
                console.log(
                  "[PlayerContext] Final cache info at song end:",
                  finalCacheInfo
                );

                // Trigger post-playback YouTube caching if this is a YouTube stream
                if (
                  currentTrack.audioUrl &&
                  (currentTrack.audioUrl.includes("googlevideo.com") ||
                    currentTrack.audioUrl.includes("youtube.com") ||
                    currentTrack.audioUrl.includes("invidious") ||
                    currentTrack.audioUrl.includes("piped"))
                ) {
                  console.log(
                    `[PlayerContext] Triggering post-playback YouTube caching for: ${currentTrack.id}`
                  );
                  // Don't await this - let it run in background
                  audioManager
                    .cacheYouTubeStreamPostPlayback(
                      currentTrack.audioUrl,
                      currentTrack.id
                    )
                    .catch((error) => {
                      console.log(
                        `[PlayerContext] Post-playback YouTube caching failed: ${error}`
                      );
                    });
                }
              }

              console.log("[PlayerContext] Calling nextTrack() for auto-play");
              console.log(
                `[PlayerContext] Current playlist length: ${playlist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`
              );

              // Wrap nextTrack in try-catch to handle auto-play failures gracefully
              try {
                await nextTrack();
              } catch (error) {
                console.error(`[PlayerContext] Auto-play failed: ${error}`);

                // If auto-play fails, try to pause gracefully
                console.log(
                  "[PlayerContext] Auto-play failed, pausing playback"
                );
                if (soundRef.current) {
                  try {
                    await soundRef.current.stopAsync();
                  } catch (stopError) {
                    console.error(
                      `[PlayerContext] Failed to stop sound: ${stopError}`
                    );
                  }
                }
                setIsPlaying(false);

                // Update media notification to show paused state
                await updateMediaNotification(currentTrack, false);
              }
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

    // Clear media notification
    await updateMediaNotification(null, false);

    // Stop background tracking
    await backgroundTaskManager.stopBackgroundTracking();

    // Stop foreground service on Android
    if (Platform.OS === "android") {
      await foregroundServiceManager.stopForegroundService();
    }

    setCurrentTrack(null);
    setPlaylist([]);
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsLoading(false);
    setSound(null);
    soundRef.current = null;
  }, [updateMediaNotification]);

  // Update function refs to avoid stale closures
  useEffect(() => {
    playPauseRef.current = playPause;
  }, [playPause]);

  useEffect(() => {
    nextTrackRef.current = nextTrack;
  }, [nextTrack]);

  useEffect(() => {
    previousTrackRef.current = previousTrack;
  }, [previousTrack]);

  useEffect(() => {
    clearPlayerRef.current = clearPlayer;
  }, [clearPlayer]);

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

  const toggleLikeSong = useCallback((track: Track) => {
    setLikedSongs((prev) => {
      const isCurrentlyLiked = prev.some((song) => song.id === track.id);
      let updatedSongs: Track[];

      if (isCurrentlyLiked) {
        // Remove from liked songs
        updatedSongs = prev.filter((song) => song.id !== track.id);
      } else {
        // Add to liked songs
        updatedSongs = [...prev, track];
      }

      // Persist to storage
      StorageService.saveLikedSongs(updatedSongs).catch((error) => {
        console.error("Error saving liked songs:", error);
      });

      return updatedSongs;
    });
  }, []);

  const isSongLiked = useCallback(
    (trackId: string) => {
      return likedSongs.some((song) => song.id === trackId);
    },
    [likedSongs]
  );

  const getCacheInfo = useCallback(
    async (trackId: string) => {
      return await audioManager.getCacheInfo(trackId);
    },
    [audioManager]
  );

  // Handle notification responses for media controls
  useEffect(() => {
    // Skip notification handling since expo-notifications is removed
    console.log(
      "[PlayerContext] Notification handling disabled - expo-notifications removed"
    );
    return () => {};
  }, [playPause, nextTrack, previousTrack, clearPlayer]);

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
    isInPlaylistContext,
    colorTheme,
    likedSongs,
    previouslyPlayedSongs,
    cacheProgress,
    isTransitioning,
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
    toggleLikeSong,
    isSongLiked,
    getCacheInfo,
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

export default PlayerProvider;
