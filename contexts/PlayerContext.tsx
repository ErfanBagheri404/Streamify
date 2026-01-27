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
import {
  extractColorsFromImage,
  ColorTheme,
  ExtendedColorTheme,
  predefinedThemes,
} from "../utils/imageColors";
import { StorageService } from "../utils/storage";
import { Platform, AppState } from "react-native";
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
  colorTheme: ExtendedColorTheme;
  likedSongs: Track[];
  previouslyPlayedSongs: Track[];
  cacheProgress: {
    trackId: string;
    percentage: number;
    fileSize: number;
  } | null;
  isTransitioning: boolean;
  streamRetryCount: number;

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
  handleStreamFailure: () => Promise<void>;
  clearAudioMonitoring: () => void;
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
  resetStreamRetryCount: () => void;
  applyPredefinedTheme: (themeName: string) => void;
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
    [],
  );
  const [colorTheme, setColorTheme] = useState<ExtendedColorTheme>({
    primary: "#a3e635",
    secondary: "#22d3ee",
    background: "#000000",
    text: "#ffffff",
    accent: "#f59e0b",
    isGradient: false,
  });
  const [cacheProgress, setCacheProgress] = useState<{
    trackId: string;
    percentage: number;
    fileSize: number;
  } | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [streamRetryCount, setStreamRetryCount] = useState(0);
  const originalPlaylistRef = useRef<Track[]>([]);
  const currentPlaylistContextRef = useRef<Track[]>([]);
  const streamCheckRef = useRef<{ position: number; time: number } | null>(
    null,
  );

  const soundRef = useRef<Audio.Sound | null>(null);
  const audioManager = useRef(new AudioStreamManager()).current;

  // Function refs to avoid stale closures in useEffect
  const playPauseRef = useRef<() => Promise<void>>(async () => {});
  const nextTrackRef = useRef<() => Promise<void>>(async () => {});
  const previousTrackRef = useRef<() => Promise<void>>(async () => {});
  const clearPlayerRef = useRef<() => Promise<void>>(async () => {});

  // Cache controllers for managing background caching
  const cacheControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Load liked songs from storage on startup
  useEffect(() => {
    const loadLikedSongs = async () => {
      try {
        const savedLikedSongs = await StorageService.loadLikedSongs();
        setLikedSongs(savedLikedSongs);

        // Cache all liked songs that aren't already cached
        if (savedLikedSongs.length > 0) {
          console.log(
            `[PlayerContext] Found ${savedLikedSongs.length} liked songs, starting background caching...`,
          );
          cacheAllLikedSongs(savedLikedSongs);
        }
      } catch (error) {
        console.error("Error loading liked songs:", error);
      }
    };
    loadLikedSongs();
  }, []);

  // Initialize foreground service for background audio playback
  useEffect(() => {
    const initializeForegroundService = async () => {
      if (Platform.OS === "android") {
        try {
          await foregroundServiceManager.initialize();
          console.log("[PlayerContext] Foreground service initialized");
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to initialize foreground service:",
            error,
          );
        }
      }
    };
    initializeForegroundService();
  }, []);

  // Handle app state changes for background audio
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (Platform.OS === "android") {
        if (nextAppState === "background" && isPlaying && currentTrack) {
          console.log(
            "[PlayerContext] App going to background, starting foreground service",
          );
          foregroundServiceManager.startForegroundService(
            currentTrack,
            isPlaying,
          );
        } else if (nextAppState === "active") {
          console.log("[PlayerContext] App coming to foreground");
          // Keep the service running in case user switches tracks
        }
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => {
      subscription.remove();
    };
  }, [isPlaying, currentTrack]);

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
        `[PlayerContext] Cache progress updated: ${cacheProgress.percentage}%`,
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
                : null,
            );
          }
        } catch (error) {
          // Handle error silently
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
          isGradient: false,
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
    console
      .log
      // `[PlayerContext] Stream monitor check - soundRef.current: ${!!soundRef.current}, isPlaying: ${isPlaying}, currentTrack?.audioUrl: ${!!currentTrack?.audioUrl}`
      ();

    if (!soundRef.current || !isPlaying || !currentTrack?.audioUrl) {
      return;
    }

    const streamMonitor = setInterval(async () => {
      try {
        // Double-check sound still exists before accessing
        if (!soundRef.current) {
          console.log(
            "[PlayerContext] Stream monitor - soundRef.current is null, stopping monitoring",
          );
          clearInterval(streamMonitor);
          return;
        }

        const status = await soundRef.current.getStatusAsync();
        console
          .log
          // `[PlayerContext] Stream status - isLoaded: ${status.isLoaded}, isPlaying: ${status.isPlaying}, position: ${status.positionMillis}`
          ();

        if (status.isLoaded && status.isPlaying) {
          // Check if position is advancing
          const currentTime = Date.now();
          const position = status.positionMillis;

          // Store last known position and time
          if (!streamCheckRef.current) {
            streamCheckRef.current = { position, time: currentTime };
            return;
          }

          const timeDiff = currentTime - streamCheckRef.current.time;
          const positionDiff = position - streamCheckRef.current.position;

          // If position hasn't changed in 5+ seconds, stream might be stuck
          if (timeDiff > 5000 && positionDiff === 0) {
            if (currentTrack) {
              console.warn(
                "[PlayerContext] Stream appears stuck, attempting refresh",
              );
              handleStreamFailure();
            } else {
              console.warn(
                "[PlayerContext] Stream appears stuck but no current track, skipping refresh",
              );
            }
            streamCheckRef.current = null;
          } else {
            streamCheckRef.current = { position, time: currentTime };
          }
        } else {
          console.log(
            `[PlayerContext] Stream not in valid state - isLoaded: ${status.isLoaded}, isPlaying: ${status.isPlaying}`,
          );
        }
      } catch (error) {
        // Only log if it's not a "Player does not exist" error (which is expected during cleanup)
        if (error?.toString().includes("Player does not exist")) {
          clearInterval(streamMonitor);
        }
      }
    }, 3000); // Check every 3 seconds

    return () => {
      clearInterval(streamMonitor);
      streamCheckRef.current = null;
    };
  }, [isPlaying, currentTrack?.audioUrl]);

  const playTrack = useCallback(
    async (track: Track, playlistData: Track[] = [], index: number = 0) => {
      console.log(
        `[PlayerContext] playTrack() called with track: ${track.title}, index: ${index}, playlist length: ${playlistData.length}, isLoading: ${isLoading}, isTransitioning: ${isTransitioning}`,
      );

      // Prevent multiple simultaneous play attempts (but allow transitions)
      if (isLoading) {
        console.log("[PlayerContext] Play track blocked - already loading");
        return;
      }

      // Use current playlist and index if not provided
      const effectivePlaylist =
        playlistData.length > 0 ? playlistData : playlist;
      const effectiveIndex = index >= 0 ? index : currentIndex;

      // Reset stream retry counter when starting a new track
      setStreamRetryCount(0);

      try {
        setIsLoading(true);
        setIsTransitioning(true);

        // Clear any existing sound and reset state
        if (soundRef.current) {
          try {
            await soundRef.current.stopAsync();
            await soundRef.current.unloadAsync();
          } catch (error) {
            console.log(
              "[PlayerContext] Error cleaning up previous sound:",
              error,
            );
          }
          soundRef.current = null;
        }

        // Reset position tracking
        setCacheProgress(null);

        // Set the track immediately so MiniPlayer can appear
        console.log(
          `[PlayerContext] playTrack() - Setting current track: ${track.title}, index: ${index}`,
        );
        setCurrentTrack(track);

        // Preserve original playlist context when playing from a specific playlist
        if (playlistData.length > 0) {
          // We're playing from a specific playlist (like Previously Played)
          currentPlaylistContextRef.current = playlistData;
        } else if (currentPlaylistContextRef.current.length === 0) {
          // No specific playlist context, use the current global playlist
          currentPlaylistContextRef.current = playlist;
        }

        // Only update global playlist if we're not in a specific playlist context
        // or if the effectivePlaylist is different from current context
        if (
          playlistData.length > 0 ||
          currentPlaylistContextRef.current.length === 0
        ) {
          setPlaylist(effectivePlaylist);
        }

        setCurrentIndex(effectiveIndex);
        setIsPlaying(false);

        // Set playlist context - true if we have a playlist with more than one track
        setIsInPlaylistContext(effectivePlaylist.length > 1);

        // Add to previously played songs (only if it's from SoundCloud, YouTube, JioSaavn, or has identifying properties)
        if (
          track.source === "soundcloud" ||
          track.source === "youtube" ||
          track.source === "jiosaavn" ||
          track._isSoundCloud ||
          track._isJioSaavn ||
          (track.id && track.title) // Include library tracks that have basic identifying info
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
        // Store original streaming URL for cache monitoring
        let originalStreamUrl: string | null = null;

        if (audioUrl && !audioUrl.startsWith("file://")) {
          // If we already have a streaming URL (not a cached file), use it as original
          originalStreamUrl = audioUrl;
          console.log(
            `[PlayerContext] Using provided streaming URL as original: ${originalStreamUrl}`,
          );
        }

        if (!audioUrl && track.id) {
          try {
            if (track._isSoundCloud || track.source === "soundcloud") {
              // SoundCloud URLs expire, so we need to get a fresh one
              console.log(
                `[PlayerContext] Getting fresh SoundCloud URL for track: ${track.id}`,
              );

              originalStreamUrl = await getAudioStreamUrl(
                track.id,
                (status) =>
                  console.log(`[PlayerContext] Streaming status: ${status}`),
                "soundcloud",
                track.title,
                track.artist,
              );

              audioUrl = originalStreamUrl;
              console.log(`[PlayerContext] Got SoundCloud URL: ${audioUrl}`);
            } else if (track._isJioSaavn || track.source === "jiosaavn") {
              // Only fetch additional details if we don't have audio URL or duration
              if (!track.audioUrl || !track.duration || track.duration === 0) {
                const { searchAPI } = await import("../modules/searchAPI");
                const songDetails = await searchAPI.getJioSaavnSongDetails(
                  track.id,
                );

                if (songDetails && songDetails.audioUrl) {
                  audioUrl = songDetails.audioUrl;
                  originalStreamUrl = audioUrl;

                  if (
                    songDetails.duration &&
                    (!track.duration || track.duration === 0)
                  ) {
                    track.duration = songDetails.duration;
                  }
                } else {
                  console.log(
                    `[PlayerContext] JioSaavn track has no audio URL, playback failed for: ${track.title}`,
                  );
                  throw new Error(
                    `Unable to get audio stream for JioSaavn track: ${track.title}`,
                  );
                }
              } else {
                // Use existing audio URL if available
                audioUrl = track.audioUrl;
                originalStreamUrl = audioUrl;
                console.log(
                  `[PlayerContext] Using existing JioSaavn audio URL for: ${track.title}`,
                );
              }
            } else {
              // Only fetch streaming URL if we don't already have one
              if (!track.audioUrl) {
                console.log(
                  `[PlayerContext] Getting generic streaming URL for track: ${track.id} (source: ${track.source || "unknown"})`,
                );

                originalStreamUrl = await getAudioStreamUrl(
                  track.id,
                  (status) =>
                    console.log(
                      `[PlayerContext] Generic streaming status: ${status}`,
                    ),
                  track.source || "youtube",
                  track.title,
                  track.artist,
                );

                audioUrl = originalStreamUrl;
                console.log(
                  `[PlayerContext] Got generic streaming URL: ${audioUrl}`,
                );
              } else {
                // Use existing audio URL if available
                audioUrl = track.audioUrl;
                originalStreamUrl = audioUrl;
                console.log(
                  `[PlayerContext] Using existing audio URL for: ${track.title}`,
                );
              }
            }
          } catch (streamingError) {
            console.error(
              "[PlayerContext] Failed to get streaming URL:",
              streamingError,
            );
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

        // Create new sound (with enhanced error handling and fallbacks)
        let newSound: Audio.Sound | null = null;
        let finalAudioUrl = audioUrl;

        try {
          if (finalAudioUrl) {
            // Try to create the sound object with the provided URL
            try {
              const { sound } = await Audio.Sound.createAsync(
                { uri: finalAudioUrl },
                { shouldPlay: true },
              );
              newSound = sound;
            } catch (createError: any) {
              const errorMessage =
                (typeof createError?.message === "string" &&
                  createError.message) ||
                createError?.toString?.() ||
                String(createError);
              if (
                errorMessage.includes("extractors") ||
                errorMessage.includes("could read the stream")
              ) {
                console.warn(
                  "[PlayerContext] Detected extractor error, attempting fallback strategies",
                  errorMessage,
                );

                try {
                  const { getAudioStreamUrl } =
                    await import("../modules/audioStreaming");

                  const alternativeUrl = await getAudioStreamUrl(
                    track.id,
                    (status) =>
                      console.log(`[PlayerContext] Fallback: ${status}`),
                    track.source,
                    track.title,
                    track.artist,
                  );

                  if (alternativeUrl && alternativeUrl !== finalAudioUrl) {
                    finalAudioUrl = alternativeUrl;

                    const { sound } = await Audio.Sound.createAsync(
                      { uri: finalAudioUrl },
                      { shouldPlay: true },
                    );
                    console.log(
                      "[PlayerContext] Alternative sound created successfully",
                    );
                    newSound = sound;
                  } else {
                    throw new Error("No alternative stream URL available");
                  }
                } catch (fallbackError) {
                  console.warn(
                    "[PlayerContext] Creating silent placeholder as last resort",
                    fallbackError,
                  );
                  const { sound } = await Audio.Sound.createAsync(
                    { uri: "https://www.soundjay.com/misc/sounds/silence.mp3" },
                    { shouldPlay: false, volume: 0 },
                  );
                  newSound = sound;
                  finalAudioUrl = "";
                }
              } else {
                throw createError;
              }
            }
          } else {
            // Create a silent sound object to allow UI to work
            const { sound } = await Audio.Sound.createAsync(
              { uri: "https://www.soundjay.com/misc/sounds/silence.mp3" },
              { shouldPlay: false, volume: 0 },
            );
            newSound = sound;
            finalAudioUrl = ""; // Mark as invalid for UI
          }

          soundRef.current = newSound;
          setSound(newSound);
          setIsPlaying(!!finalAudioUrl); // Only set as playing if we have a valid audio URL
          setIsLoading(false);
          setCurrentTrack({ ...track, audioUrl: finalAudioUrl });

          // Start foreground service when playing a new track
          if (Platform.OS === "android" && !!finalAudioUrl) {
            foregroundServiceManager.startForegroundService(track, true);
          }

          // Update media notification

          // Show user feedback if we had to use fallback
          if (!finalAudioUrl && track.source === "soundcloud") {
            // You could add a toast notification here to inform the user
          }
        } catch (soundError) {
          console.error(
            "[PlayerContext] Critical error in sound creation:",
            soundError,
          );

          // Even if everything fails, ensure UI remains functional
          setIsPlaying(false);
          setIsLoading(false);
          setCurrentTrack({ ...track, audioUrl: "" }); // Mark as invalid
        }

        // Set up playback monitoring (only if sound was created)
        if (!newSound) {
          return;
        }

        // Position tracking variables for stuck detection
        let lastPosition = 0;
        let positionStuckCounter = 0;
        const STUCK_THRESHOLD = 3;
        let initialBufferTime = Date.now();
        const isYouTubeStream =
          finalAudioUrl &&
          (finalAudioUrl.includes("googlevideo.com") ||
            finalAudioUrl.includes("youtube.com") ||
            finalAudioUrl.includes("invidious") ||
            finalAudioUrl.includes("piped"));

        newSound.setOnPlaybackStatusUpdate(async (status) => {
          if (status.isLoaded) {
            // Check if we've been in this position for too long (indicating silent playback)
            // Be more lenient for YouTube streams during initial buffering
            const timeSinceStart = Date.now() - initialBufferTime;
            const isInitialBufferPhase = timeSinceStart < 3000; // First 3 seconds

            if (status.positionMillis === lastPosition) {
              positionStuckCounter++;

              // Different thresholds for different stream types and phases
              const threshold = isYouTubeStream && isInitialBufferPhase ? 5 : 2;

              if (
                positionStuckCounter >= threshold &&
                currentTrack &&
                !isTransitioning &&
                !isInitialBufferPhase &&
                status.positionMillis > 1000
              ) {
                console.error(
                  `[PlayerContext] CONFIRMED: ${isYouTubeStream ? "YouTube" : "SoundCloud"} audio cutout at ${status.positionMillis}ms - position stuck despite isPlaying=true (threshold: ${threshold}, initialBuffer: ${isInitialBufferPhase})`,
                );
                handleStreamFailure();
                positionStuckCounter = 0;
              } else if (
                positionStuckCounter >= threshold &&
                (isTransitioning ||
                  isInitialBufferPhase ||
                  status.positionMillis <= 1000)
              ) {
                console.log(
                  "[PlayerContext] Skipping stream failure detection during transition or initial buffer",
                );
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
                `[PlayerContext] SoundCloud track approaching 1min, preparing for refresh at position: ${status.positionMillis}ms`,
              );
              // Could implement pre-emptive refresh here if needed
            }

            // Check if position is stuck (indicates stream failure)
            if (status.isPlaying && status.positionMillis === lastPosition) {
              positionStuckCounter++;

              // Different thresholds for different stream types and phases
              const threshold =
                isYouTubeStream && isInitialBufferPhase ? 5 : STUCK_THRESHOLD;

              if (positionStuckCounter >= threshold && currentTrack) {
                console.warn(
                  `[PlayerContext] Audio position stuck at ${status.positionMillis}ms, possible stream failure (${isYouTubeStream ? "YouTube" : "SoundCloud"}, threshold: ${threshold})`,
                );
                // Try to reload the stream
                handleStreamFailure();
              }
            } else {
              positionStuckCounter = 0;
            }
            lastPosition = status.positionMillis;

            if (status.didJustFinish) {
              setIsPlaying(false);

              // Refresh cache info at end of song
              if (currentTrack?.id) {
                console.log(
                  `[PlayerContext] Song finished, refreshing cache info for: ${currentTrack.id}`,
                );
                const finalCacheInfo = await getCacheInfo(currentTrack.id);
                console.log(
                  "[PlayerContext] Final cache info at song end:",
                  finalCacheInfo,
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
                    `[PlayerContext] Triggering post-playback YouTube caching for: ${currentTrack.id}`,
                  );
                  // Don't await this - let it run in background
                  audioManager
                    .cacheYouTubeStreamPostPlayback(
                      currentTrack.audioUrl,
                      currentTrack.id,
                    )
                    .catch((error) => {
                      console.log(
                        `[PlayerContext] Post-playback YouTube caching failed: ${error}`,
                      );
                    });
                }
              }

              // Auto play next track when current finishes
              if (!isTransitioning && !isLoading) {
                nextTrack();
              } else {
                console.log(
                  "[PlayerContext] Skipping auto-next due to ongoing transition/loading",
                );
              }
            }
          }
        });
      } catch (error) {
        console.error("[PlayerContext] Error playing track:", error);
        setIsLoading(false);
        setIsTransitioning(false);
        setIsPlaying(false);
      } finally {
        setIsTransitioning(false);
      }
    },
    [audioManager, isLoading, isTransitioning],
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

        // Stop foreground service when pausing
        if (Platform.OS === "android") {
          foregroundServiceManager.stopForegroundService();
        }

        // Background tracking removed for simplicity
      } else {
        await soundRef.current.playAsync();
        setIsPlaying(true);

        // Start foreground service when playing
        if (Platform.OS === "android") {
          foregroundServiceManager.startForegroundService(currentTrack, true);
        }

        // Background tracking removed for simplicity
      }
    } catch (error) {
      console.error("[PlayerContext] Error toggling play/pause:", error);
    }
  }, [isPlaying, currentTrack?.audioUrl]);

  const clearAudioMonitoring = useCallback(() => {
    console.log("[PlayerContext] Clearing audio monitoring");
    if (soundRef.current) {
      // Clear the playback status update callback to prevent monitoring during transitions
      soundRef.current.setOnPlaybackStatusUpdate(null);
      console.log("[PlayerContext] Audio monitoring cleared");
    }
  }, []);

  const nextTrack = useCallback(async () => {
    console.log("[PlayerContext] nextTrack() called");
    console.log(
      `[PlayerContext] Playlist length: ${playlist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`,
    );

    // Basic validation
    if (playlist.length === 0) {
      console.log("[PlayerContext] nextTrack() - No playlist, returning");
      return;
    }

    // Clear audio monitoring to prevent interference during transition
    clearAudioMonitoring();

    // Stop any ongoing continuous caching for the current track
    if (currentTrack && cacheControllersRef.current.has(currentTrack.id)) {
      const controller = cacheControllersRef.current.get(currentTrack.id);
      controller?.abort();
      cacheControllersRef.current.delete(currentTrack.id);
    }

    setIsTransitioning(true);

    try {
      // Handle repeat one mode - replay current track
      if (repeatMode === "one" && currentTrack) {
        console.log(
          "[PlayerContext] nextTrack() - Repeat one mode, replaying current track",
        );
        await playTrack(currentTrack, playlist, currentIndex);
        return;
      }

      // Handle single song playlist
      if (playlist.length === 1) {
        console.log("[PlayerContext] nextTrack() - Single song playlist");
        if (repeatMode === "one" || repeatMode === "all") {
          console.log(
            "[PlayerContext] nextTrack() - Single song with repeat, replaying",
          );
          await playTrack(currentTrack!, playlist, 0);
        } else {
          console.log(
            "[PlayerContext] nextTrack() - Single song, no repeat, stopping",
          );
          if (soundRef.current) {
            await soundRef.current.stopAsync();
          }
          setIsPlaying(false);
        }
        return;
      }

      // Calculate next index
      const nextIndex = (currentIndex + 1) % playlist.length;
      const nextTrackItem = playlist[nextIndex];

      if (nextTrackItem) {
        console.log(
          `[PlayerContext] nextTrack() - Playing next track at index ${nextIndex}: ${nextTrackItem.title}`,
        );
        await playTrack(nextTrackItem, playlist, nextIndex);
      } else {
        console.log(
          `[PlayerContext] nextTrack() - No track found at index ${nextIndex}`,
        );
        // If no track found, try to stop playback gracefully
        if (soundRef.current) {
          await soundRef.current.stopAsync();
        }
        setIsPlaying(false);
      }
    } catch (error) {
      console.error(`[PlayerContext] Failed to play next track: ${error}`);

      // If track fails to play, pause playback
      if (soundRef.current) {
        await soundRef.current.stopAsync();
      }
      setIsPlaying(false);
    } finally {
      setIsTransitioning(false);
    }
  }, [
    playlist,
    currentIndex,
    playTrack,
    repeatMode,
    currentTrack,
    setIsTransitioning,
    clearAudioMonitoring,
  ]);

  const previousTrack = useCallback(async () => {
    console.log("[PlayerContext] previousTrack() called");

    // Use current playlist context if available, otherwise fall back to global playlist
    const currentPlaylist =
      currentPlaylistContextRef.current.length > 0
        ? currentPlaylistContextRef.current
        : playlist;

    console.log(
      `[PlayerContext] Playlist length: ${currentPlaylist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`,
    );

    // Basic validation
    if (currentPlaylist.length === 0) {
      console.log("[PlayerContext] previousTrack() - No playlist, returning");
      return;
    }

    // Clear audio monitoring to prevent interference during transition
    clearAudioMonitoring();

    // Stop any ongoing continuous caching for the current track
    if (currentTrack && cacheControllersRef.current.has(currentTrack.id)) {
      const controller = cacheControllersRef.current.get(currentTrack.id);
      controller?.abort();
      cacheControllersRef.current.delete(currentTrack.id);
    }

    setIsTransitioning(true);

    try {
      // Handle repeat one mode - replay current track
      if (repeatMode === "one" && currentTrack) {
        console.log(
          "[PlayerContext] previousTrack() - Repeat one mode, replaying current track",
        );
        await playTrack(currentTrack, currentPlaylist, currentIndex);
        return;
      }

      // Handle single song playlist
      if (currentPlaylist.length === 1) {
        console.log("[PlayerContext] previousTrack() - Single song playlist");
        if (repeatMode === "one" || repeatMode === "all") {
          console.log(
            "[PlayerContext] previousTrack() - Single song with repeat, replaying",
          );
          await playTrack(currentTrack!, currentPlaylist, 0);
        } else {
          console.log(
            "[PlayerContext] previousTrack() - Single song, no repeat, stopping",
          );
          if (soundRef.current) {
            await soundRef.current.stopAsync();
          }
          setIsPlaying(false);
        }
        return;
      }

      // Calculate previous index (loop to end if at beginning)
      const prevIndex =
        currentIndex === 0 ? currentPlaylist.length - 1 : currentIndex - 1;
      const prevTrack = currentPlaylist[prevIndex];

      if (prevTrack) {
        console.log(
          `[PlayerContext] previousTrack() - Playing previous track at index ${prevIndex}: ${prevTrack.title}`,
        );
        await playTrack(prevTrack, playlist, prevIndex);
      } else {
        console.log(
          `[PlayerContext] previousTrack() - No track found at index ${prevIndex}`,
        );
        // If no track found, try to stop playback gracefully
        if (soundRef.current) {
          await soundRef.current.stopAsync();
        }
        setIsPlaying(false);
      }
    } catch (error) {
      console.error(`[PlayerContext] Failed to play previous track: ${error}`);

      // If track fails to play, pause playback
      if (soundRef.current) {
        await soundRef.current.stopAsync();
      }
      setIsPlaying(false);
    } finally {
      setIsTransitioning(false);
    }
  }, [
    playlist,
    currentIndex,
    playTrack,
    currentTrack,
    repeatMode,
    setIsTransitioning,
    clearAudioMonitoring,
  ]);

  const seekTo = useCallback(
    async (position: number) => {
      console.log(
        `[PlayerContext] seekTo called - position: ${position}, soundRef.current: ${!!soundRef.current}, currentTrack?.audioUrl: ${!!currentTrack?.audioUrl}`,
      );

      if (!soundRef.current || !currentTrack?.audioUrl) {
        console.warn("[PlayerContext] Cannot seek: Player not ready");
        return;
      }

      try {
        // Store current playing state to restore later
        const wasPlaying = isPlaying;

        // Pause playback during seek to prevent audio from continuing at old position
        if (isPlaying) {
          console.log("[PlayerContext] Pausing playback during seek");
          await soundRef.current.pauseAsync();
          setIsPlaying(false);
        }

        // Check if the target position is cached before seeking
        if (
          currentTrack.id &&
          (currentTrack._isSoundCloud ||
            currentTrack.source === "soundcloud" ||
            currentTrack.source === "youtube" ||
            currentTrack._isJioSaavn ||
            currentTrack.source === "jiosaavn")
        ) {
          console.log(
            `[PlayerContext] Checking if position ${position}ms is cached for track: ${currentTrack.id}`,
          );

          try {
            const { AudioStreamManager } =
              await import("../modules/audioStreaming");
            const manager = AudioStreamManager.getInstance();

            const positionCheck = await manager.isPositionCached(
              currentTrack.id,
              position,
            );
            console.log(
              `[PlayerContext] Position cache check: isCached=${positionCheck.isCached}, cacheEnd=${positionCheck.estimatedCacheEndMs}ms`,
            );

            if (!positionCheck.isCached) {
              console.warn(
                `[PlayerContext] Position ${position}ms is not cached (cache ends at ${positionCheck.estimatedCacheEndMs}ms). Attempting to cache more...`,
              );

              // Set loading state to indicate we're caching
              setIsLoading(true);

              // Trigger cache completion for the missing portion
              // For YouTube tracks, use position-based caching
              if (currentTrack.source === "youtube") {
                console.log(
                  `[PlayerContext] Starting position-based caching from ${position}ms for YouTube track: ${currentTrack.id}`,
                );
                try {
                  const { cacheYouTubeStreamFromPosition } =
                    await import("../modules/audioStreaming");

                  // Create a new controller for position-based caching
                  const seekCacheController = new AbortController();

                  // Start caching from the seek position
                  const cachedUrl = await cacheYouTubeStreamFromPosition(
                    currentTrack.audioUrl,
                    currentTrack.id,
                    position / 1000, // Convert ms to seconds
                    seekCacheController,
                  );

                  console.log(
                    `[PlayerContext] Position-based caching completed, cached URL: ${cachedUrl}`,
                  );
                } catch (seekCacheError) {
                  console.error(
                    `[PlayerContext] Position-based caching failed for ${currentTrack.id}:`,
                    seekCacheError,
                  );
                  // Fallback to regular cache monitoring
                  const { monitorAndResumeCache } =
                    await import("../modules/audioStreaming");

                  monitorAndResumeCache(
                    currentTrack.id,
                    currentTrack.audioUrl,
                    (percentage) => {
                      console.log(
                        `[PlayerContext] Fallback cache completion progress: ${percentage}%`,
                      );
                      setCacheProgress({
                        trackId: currentTrack.id,
                        percentage: percentage,
                        fileSize: 0, // Will be updated when cache info is fetched
                      });
                    },
                  );
                }
              } else {
                // For other sources, use regular cache monitoring
                const { monitorAndResumeCache } =
                  await import("../modules/audioStreaming");

                monitorAndResumeCache(
                  currentTrack.id,
                  currentTrack.audioUrl,
                  (percentage) => {
                    console.log(
                      `[PlayerContext] Cache completion progress: ${percentage}%`,
                    );
                    setCacheProgress({
                      trackId: currentTrack.id,
                      percentage: percentage,
                      fileSize: 0, // Will be updated when cache info is fetched
                    });
                  },
                );
              }

              // Wait a bit for caching to start, then proceed with seek
              // This prevents the audio from playing at old position while caching
              await new Promise((resolve) => setTimeout(resolve, 500));

              // Clear loading state after initial cache setup
              setIsLoading(false);

              console.log(
                "[PlayerContext] Seeking to uncached position - will resume when ready",
              );
            } else {
              console.log(
                `[PlayerContext] Position ${position}ms is within cached range`,
              );
            }
          } catch (cacheCheckError) {
            console.error(
              "[PlayerContext] Error checking position cache:",
              cacheCheckError,
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

        // Only resume playback if it was playing before the seek
        if (wasPlaying) {
          console.log("[PlayerContext] Resuming playback after seek");
          await soundRef.current.playAsync();
          setIsPlaying(true);
        }
      } catch (error) {
        // Only log if it's not a "Player does not exist" error
        if (!error?.toString().includes("Player does not exist")) {
          console.error("[PlayerContext] Error seeking:", error);
        } else {
          console.log(
            "[PlayerContext] Seek failed - player no longer exists (expected during cleanup)",
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
      isPlaying,
    ],
  );

  const handleStreamFailure = useCallback(async () => {
    console.warn("[PlayerContext] === STREAM FAILURE DETECTED ===");
    console.warn("[PlayerContext] Attempting to reload stream...");

    if (!currentTrack) {
      console.warn("[PlayerContext] No current track to reload");
      return;
    }

    // Check if this is a YouTube stream and if it's very early in playback
    const isYouTubeStream =
      currentTrack.audioUrl &&
      (currentTrack.audioUrl.includes("googlevideo.com") ||
        currentTrack.audioUrl.includes("youtube.com") ||
        currentTrack.audioUrl.includes("invidious") ||
        currentTrack.audioUrl.includes("piped"));

    let currentPosition = 0;
    if (soundRef.current) {
      try {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          currentPosition = status.positionMillis;
        }
      } catch (error) {
        // Ignore position errors
      }
    }

    // For YouTube streams in the first 5 seconds, be more conservative
    if (isYouTubeStream && currentPosition < 5000) {
      console.warn(
        "[PlayerContext] YouTube stream failure in early phase, waiting before reload...",
      );
      // Don't reload immediately for YouTube in early phase - might be normal buffering
      return;
    }

    // Check retry limit to prevent infinite loops
    if (streamRetryCount >= 3) {
      console.error(
        "[PlayerContext] Maximum stream retry attempts reached, giving up",
      );
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }

    setStreamRetryCount((prev) => prev + 1);

    console.log(
      `[PlayerContext] Current track: ${currentTrack.title} by ${currentTrack.artist}`,
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
              `[PlayerContext] Current position: ${currentPosition}ms`,
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
            currentTrack.artist,
          );
          console.log(
            `[PlayerContext] Got fresh SoundCloud URL: ${newAudioUrl}`,
          );
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to get fresh SoundCloud URL:",
            error,
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
            currentTrack.artist,
          );
          console.log(`[PlayerContext] Got fresh URL: ${newAudioUrl}`);
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to get fresh audio URL:",
            error,
          );
        }
      }

      if (newAudioUrl) {
        console.log(
          `[PlayerContext] Creating new sound with URL: ${newAudioUrl}`,
        );
        console.log(
          `[PlayerContext] URL starts with file://: ${newAudioUrl.startsWith("file://")}`,
        );
        console.log(
          `[PlayerContext] URL contains double file://: ${newAudioUrl.includes("file://file://")}`,
        );

        // Check if file exists for local files
        if (newAudioUrl.startsWith("file://")) {
          try {
            const fileInfo = await FileSystem.getInfoAsync(
              newAudioUrl.replace("file://", ""),
            );
            console.log(
              `[PlayerContext] File exists check: ${fileInfo.exists}${fileInfo.exists ? `, size: ${fileInfo.size}` : ""}`,
            );
          } catch (error) {
            console.log(`[PlayerContext] File check error: ${error}`);
          }
        }

        // Create new sound with fresh URL
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: newAudioUrl },
          { shouldPlay: true },
        );
        console.log("[PlayerContext] New sound created successfully");

        // Seek to previous position
        if (currentPosition > 0) {
          console.log(
            `[PlayerContext] Seeking to previous position: ${currentPosition}ms`,
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
                "[PlayerContext] Song finished - status.didJustFinish triggered",
              );
              setIsPlaying(false);

              // Refresh cache info at end of song
              if (currentTrack?.id) {
                console.log(
                  `[PlayerContext] Song finished, refreshing cache info for: ${currentTrack.id}`,
                );
                const finalCacheInfo = await getCacheInfo(currentTrack.id);
                console.log(
                  "[PlayerContext] Final cache info at song end:",
                  finalCacheInfo,
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
                    `[PlayerContext] Triggering post-playback YouTube caching for: ${currentTrack.id}`,
                  );
                  // Don't await this - let it run in background
                  audioManager
                    .cacheYouTubeStreamPostPlayback(
                      currentTrack.audioUrl,
                      currentTrack.id,
                    )
                    .catch((error) => {
                      console.log(
                        `[PlayerContext] Post-playback YouTube caching failed: ${error}`,
                      );
                    });
                }
              }

              console.log("[PlayerContext] Calling nextTrack() for auto-play");
              console.log(
                `[PlayerContext] Current playlist length: ${playlist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`,
              );

              // Wrap nextTrack in try-catch to handle auto-play failures gracefully
              // Add safety check to prevent auto-play during transitions
              if (!isTransitioning) {
                try {
                  console.log("[PlayerContext] Auto-playing next track");
                  await nextTrack();
                } catch (error) {
                  console.error(`[PlayerContext] Auto-play failed: ${error}`);

                  // If auto-play fails, try to pause gracefully
                  console.log(
                    "[PlayerContext] Auto-play failed, pausing playback",
                  );
                  if (soundRef.current) {
                    try {
                      await soundRef.current.stopAsync();
                    } catch (stopError) {
                      console.error(
                        `[PlayerContext] Failed to stop sound: ${stopError}`,
                      );
                    }
                  }
                  setIsPlaying(false);

                  // Update media notification to show paused state
                }
              } else {
                console.log(
                  "[PlayerContext] Skipping auto-play due to ongoing transition",
                );
              }
            }

            // Monitor for cache exhaustion - if we're getting close to the 5MB cache limit
            // and the stream is struggling, proactively reload
            if (
              status.positionMillis > 300000 &&
              status.positionMillis < 400000 &&
              !isTransitioning
            ) {
              // Between 5-6.5 minutes
              const timeSinceLastProgress = Date.now() - lastProgressTime;
              if (timeSinceLastProgress > 3000) {
                // No progress in 3 seconds
                console.warn(
                  "[PlayerContext] Possible cache exhaustion detected, reloading stream...",
                );
                handleStreamFailure();
              }
            } else if (status.positionMillis > 300000 && isTransitioning) {
              console.log(
                "[PlayerContext] Skipping cache exhaustion check during transition",
              );
            }
          }
        });

        console.log("[PlayerContext] === STREAM RELOADED SUCCESSFULLY ===");
      } else {
        console.warn(
          "[PlayerContext] Could not get fresh audio URL for reload",
        );
      }
    } catch (error) {
      console.error("[PlayerContext] === STREAM RELOAD FAILED ===", error);
    }
  }, [currentTrack, nextTrack, isTransitioning]);

  const clearPlayer = useCallback(async () => {
    // Stop all ongoing continuous caching
    console.log("[PlayerContext] Stopping all continuous caching operations");
    cacheControllersRef.current.forEach((controller, trackId) => {
      console.log(
        `[PlayerContext] Aborting continuous caching for track: ${trackId}`,
      );
      controller.abort();
    });
    cacheControllersRef.current.clear();

    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
    }

    // Clear media notification

    // Background services removed for simplicity

    // Stop foreground service when clearing player
    if (Platform.OS === "android") {
      foregroundServiceManager.stopForegroundService();
    }

    setCurrentTrack(null);
    setPlaylist([]);
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsLoading(false);
    setSound(null);
    soundRef.current = null;
  }, []);

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

        // Start caching the liked song
        if (track.id && track.audioUrl) {
          console.log(
            `[PlayerContext] Starting to cache liked song: ${track.title} (${track.id})`,
          );

          // Import and start caching in background
          import("../modules/audioStreaming")
            .then(({ continueCachingTrack }) => {
              const cacheController = new AbortController();

              continueCachingTrack(
                track.audioUrl,
                track.id,
                cacheController,
                (percentage) => {
                  console.log(
                    `[PlayerContext] Liked song cache progress: ${percentage}%`,
                  );
                  setCacheProgress({
                    trackId: track.id,
                    percentage: percentage,
                    fileSize: 0,
                  });
                },
              ).catch((error) => {
                console.error(
                  `[PlayerContext] Failed to cache liked song ${track.id}:`,
                  error,
                );
              });

              // Store the controller for cleanup
              if (!cacheControllersRef.current) {
                cacheControllersRef.current = new Map();
              }
              cacheControllersRef.current.set(track.id, cacheController);
            })
            .catch((error) => {
              console.error(
                "[PlayerContext] Failed to import caching module:",
                error,
              );
            });
        }
      }

      // Persist to storage
      StorageService.saveLikedSongs(updatedSongs).catch((error) => {
        console.error("Error saving liked songs:", error);
      });

      return updatedSongs;
    });
  }, []);

  const cacheAllLikedSongs = useCallback(
    async (songs: Track[]) => {
      try {
        const { continueCachingTrack } =
          await import("../modules/audioStreaming");

        for (const song of songs) {
          if (song.id && song.audioUrl) {
            // Check if song is already cached
            const cacheInfo = await audioManager.getCacheInfo(song.id);

            if (cacheInfo.isFullyCached) {
              console.log(`[PlayerContext] Song already cached: ${song.title}`);
              continue;
            }

            if (cacheInfo.isDownloading) {
              console.log(
                `[PlayerContext] Song already downloading: ${song.title}`,
              );
              continue;
            }

            console.log(
              `[PlayerContext] Starting to cache liked song: ${song.title} (${song.id})`,
            );

            const cacheController = new AbortController();

            continueCachingTrack(
              song.audioUrl,
              song.id,
              cacheController,
              (percentage) => {
                console.log(
                  `[PlayerContext] Background cache progress for ${song.title}: ${percentage}%`,
                );
                setCacheProgress({
                  trackId: song.id,
                  percentage: percentage,
                  fileSize: 0,
                });
              },
            ).catch((error) => {
              console.error(
                `[PlayerContext] Failed to cache liked song ${song.id}:`,
                error,
              );
            });

            // Store the controller for cleanup
            if (!cacheControllersRef.current) {
              cacheControllersRef.current = new Map();
            }
            cacheControllersRef.current.set(song.id, cacheController);

            // Add small delay between starting downloads to prevent overwhelming the system
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        console.log(
          `[PlayerContext] Started background caching for ${songs.length} liked songs`,
        );
      } catch (error) {
        console.error("[PlayerContext] Error caching all liked songs:", error);
      }
    },
    [audioManager],
  );

  const isSongLiked = useCallback(
    (trackId: string) => {
      return likedSongs.some((song) => song.id === trackId);
    },
    [likedSongs],
  );

  const getCacheInfo = useCallback(
    async (trackId: string) => {
      return await audioManager.getCacheInfo(trackId);
    },
    [audioManager],
  );

  // Handle notification responses for media controls
  useEffect(() => {
    // Skip notification handling since expo-notifications is removed
    console.log(
      "[PlayerContext] Notification handling disabled - expo-notifications removed",
    );
    return () => {};
  }, [playPause, nextTrack, previousTrack, clearPlayer]);

  const applyPredefinedTheme = (themeName: string) => {
    const theme = predefinedThemes[themeName];
    if (theme) {
      setColorTheme(theme);
    }
  };

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
    streamRetryCount,
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
    clearAudioMonitoring,
    toggleLikeSong,
    isSongLiked,
    getCacheInfo,
    resetStreamRetryCount: () => setStreamRetryCount(0),
    applyPredefinedTheme,
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
