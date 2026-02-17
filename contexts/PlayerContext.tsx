import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import TrackPlayer, { State, Event } from "../utils/safeTrackPlayer";
import * as FileSystem from "expo-file-system";
import {
  AudioStreamManager,
  getAudioStreamUrl,
} from "../modules/audioStreaming";

import { StorageService } from "../utils/storage";
import { trackPlayerService } from "../services/TrackPlayerService";

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
  showFullPlayer: boolean;
  repeatMode: "off" | "one" | "all";
  isInPlaylistContext: boolean;
  isShuffled: boolean;
  likedSongs: Track[];
  previouslyPlayedSongs: Track[];
  colorTheme: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    accent: string;
    isGradient: boolean;
    gradient?: {
      colors: string[];
      start?: [number, number];
      end?: [number, number];
      locations?: number[];
    };
  };
  cacheProgress: {
    trackId: string;
    percentage: number;
    fileSize: number;
  } | null;
  isTransitioning: boolean;
  streamRetryCount: number;
  hasStreamFailed: boolean;
  position: number;
  duration: number;

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
  clearAudioMonitoring: () => void;
  cancelLoadingState: () => Promise<void>;
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
  // Remove sound state since we're using Track Player
  const [repeatMode, setRepeatMode] = useState<"off" | "one" | "all">("off");
  const [isInPlaylistContext, setIsInPlaylistContext] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [likedSongs, setLikedSongs] = useState<Track[]>([]);
  const [previouslyPlayedSongs, setPreviouslyPlayedSongs] = useState<Track[]>(
    []
  );
  const [colorTheme, setColorTheme] = useState({
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
  const [hasStreamFailed, setHasStreamFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const originalPlaylistRef = useRef<Track[]>([]);
  const currentPlaylistContextRef = useRef<Track[]>([]);
  const streamCheckRef = useRef<{ position: number; time: number } | null>(
    null
  );
  const playRequestIdRef = useRef(0);

  const audioManager = useRef(new AudioStreamManager()).current;

  // Function refs to avoid stale closures in useEffect
  const playPauseRef = useRef<() => Promise<void>>(async () => {});
  const nextTrackRef = useRef<() => Promise<void>>(async () => {});
  const previousTrackRef = useRef<() => Promise<void>>(async () => {});
  const clearPlayerRef = useRef<() => Promise<void>>(async () => {});

  // Cache controllers for managing background caching
  const cacheControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Audio monitoring listeners for cleanup
  const audioMonitoringListenersRef = useRef<any[]>([]);

  const updateIsPlayingFromState = useCallback(async () => {
    try {
      const playbackState = await TrackPlayer.getPlaybackState();
      const resolvedState =
        (playbackState as any)?.state ?? (playbackState as any);
      const nextIsPlaying =
        resolvedState === State.Playing ||
        resolvedState === State.Buffering ||
        resolvedState === State.Connecting;
      setIsPlaying(nextIsPlaying);
    } catch (error) {}
  }, []);

  const rehydrateFromTrackPlayer = async () => {
    try {
      if (playlist.length > 0 || currentTrack) {
        return;
      }

      const queue = await TrackPlayer.getQueue();
      if (!queue || queue.length === 0) {
        return;
      }

      const currentTrackIndex = await TrackPlayer.getCurrentTrack();
      if (
        currentTrackIndex === null ||
        currentTrackIndex < 0 ||
        currentTrackIndex >= queue.length
      ) {
        return;
      }

      const playbackState = await TrackPlayer.getPlaybackState();
      const resolvedState =
        (playbackState as any)?.state ?? (playbackState as any);
      const nextIsPlaying =
        resolvedState === State.Playing ||
        resolvedState === State.Buffering ||
        resolvedState === State.Connecting;

      const [positionSeconds, durationSeconds] = await Promise.all([
        TrackPlayer.getPosition(),
        TrackPlayer.getDuration(),
      ]);

      const mappedPlaylist: Track[] = queue.map((item: any) => {
        const id =
          item.id != null
            ? String(item.id)
            : item.url || item.title || "unknown";
        return {
          id,
          title: item.title || "Unknown Title",
          artist: item.artist || item.author || "Unknown Artist",
          duration: item.duration || 0,
          thumbnail: item.artwork || item.thumbnail || "",
          audioUrl: item.url,
          source: (item as any).source,
          _isSoundCloud: (item as any)._isSoundCloud,
          _isJioSaavn: (item as any)._isJioSaavn,
        };
      });

      const safeIndex =
        currentTrackIndex >= 0 && currentTrackIndex < mappedPlaylist.length
          ? currentTrackIndex
          : 0;
      const nextCurrentTrack = mappedPlaylist[safeIndex];

      setPlaylist(mappedPlaylist);
      setCurrentIndex(safeIndex);
      setCurrentTrack(nextCurrentTrack);
      setIsPlaying(nextIsPlaying);
      setPosition(positionSeconds);
      setDuration(durationSeconds || nextCurrentTrack?.duration || 0);
      currentPlaylistContextRef.current = mappedPlaylist;
      setIsInPlaylistContext(mappedPlaylist.length > 1);

      if (audioMonitoringListenersRef.current.length === 0) {
        const progressListener = TrackPlayer.addEventListener(
          Event.PlaybackProgressUpdated,
          (event: any) => {
            setPosition(event.position);
            setDuration(event.duration);
          }
        );
        audioMonitoringListenersRef.current.push(progressListener);

        const queueEndedListener = TrackPlayer.addEventListener(
          Event.PlaybackQueueEnded,
          () => {
            setIsPlaying(false);
          }
        );
        audioMonitoringListenersRef.current.push(queueEndedListener);
      }
    } catch (error) {}
  };

  // Initialize TrackPlayer on startup
  useEffect(() => {
    const initializeTrackPlayer = async () => {
      try {
        console.log("[PlayerContext] Initializing TrackPlayer service...");

        // Wait a bit for the service registration to complete
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Ensure the service is properly initialized before any operations
        await trackPlayerService.setupPlayer();
        console.log(
          "[PlayerContext] TrackPlayer service initialized successfully"
        );

        await rehydrateFromTrackPlayer();
      } catch (error) {
        console.error(
          "[PlayerContext] Failed to initialize TrackPlayer service:",
          error
        );
      }
    };

    initializeTrackPlayer();
  }, []);

  useEffect(() => {
    const subscription = TrackPlayer.addEventListener(
      Event.PlaybackState,
      (event: any) => {
        const resolvedState = event?.state ?? event;
        const nextIsPlaying =
          resolvedState === State.Playing ||
          resolvedState === State.Buffering ||
          resolvedState === State.Connecting;
        setIsPlaying(nextIsPlaying);
      }
    );
    return () => {
      subscription?.remove?.();
    };
  }, []);

  // Load liked songs from storage on startup
  useEffect(() => {
    const loadLikedSongs = async () => {
      try {
        const savedLikedSongs = await StorageService.loadLikedSongs();
        setLikedSongs(savedLikedSongs);

        // Cache all liked songs that aren't already cached
        if (savedLikedSongs.length > 0) {
          console.log(
            `[PlayerContext] Found ${savedLikedSongs.length} liked songs, starting background caching...`
          );
          cacheAllLikedSongs(savedLikedSongs);
        }
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
          // Handle error silently
        }
      };
      refreshCacheInfo();
    }
  }, [cacheProgress?.percentage, currentTrack?.id]);

  // Update color theme immediately when track changes (before loading completes)
  useEffect(() => {
    if (!currentTrack?.thumbnail) {
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

    // Use a simple default theme instead of extracting colors from image
    setColorTheme({
      primary: "#a3e635",
      secondary: "#22d3ee",
      background: "#000000",
      text: "#ffffff",
      accent: "#f59e0b",
      isGradient: false,
    });
  }, [currentTrack?.thumbnail]);

  // Monitor stream health and refresh if needed (legacy polling disabled in favor of TrackPlayer events)
  useEffect(() => {
    streamCheckRef.current = null;
  }, [isPlaying, currentTrack?.audioUrl]);

  const getCacheInfo = useCallback(
    async (trackId: string) => {
      return await audioManager.getCacheInfo(trackId);
    },
    [audioManager]
  );

  const clearAudioMonitoring = useCallback(() => {
    console.log("[PlayerContext] Clearing audio monitoring listeners");
    audioMonitoringListenersRef.current.forEach((listener) => {
      listener.remove();
    });
    audioMonitoringListenersRef.current = [];
  }, []);

  const nextTrack = useCallback(async () => {
    console.log("[PlayerContext] nextTrack() called");
    console.log(
      `[PlayerContext] Playlist length: ${playlist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`
    );

    // Use current playlist context if available, otherwise fall back to global playlist
    const currentPlaylist =
      currentPlaylistContextRef.current.length > 0
        ? currentPlaylistContextRef.current
        : playlist;

    // Basic validation
    if (currentPlaylist.length === 0) {
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
          "[PlayerContext] nextTrack() - Repeat one mode, replaying current track"
        );
        await playTrack(currentTrack, currentPlaylist, currentIndex);
        return;
      }

      // Handle single song playlist
      if (currentPlaylist.length === 1) {
        console.log("[PlayerContext] nextTrack() - Single song playlist");
        if (repeatMode === "one" || repeatMode === "all") {
          console.log(
            "[PlayerContext] nextTrack() - Single song with repeat, replaying"
          );
          await playTrack(currentTrack!, currentPlaylist, 0);
        } else {
          console.log(
            "[PlayerContext] nextTrack() - Single song, no repeat, stopping"
          );
          await trackPlayerService.stop();
          setIsPlaying(false);
        }
        return;
      }

      // Calculate next index
      const nextIndex = (currentIndex + 1) % currentPlaylist.length;
      const nextTrackItem = currentPlaylist[nextIndex];

      if (nextTrackItem) {
        console.log(
          `[PlayerContext] nextTrack() - Playing next track at index ${nextIndex}: ${nextTrackItem.title}`
        );
        await playTrack(nextTrackItem, currentPlaylist, nextIndex);
      } else {
        console.log(
          `[PlayerContext] nextTrack() - No track found at index ${nextIndex}`
        );
        // If no track found, try to stop playback gracefully
        await trackPlayerService.stop();
        setIsPlaying(false);
      }
    } catch (error) {
      console.error(`[PlayerContext] Failed to play next track: ${error}`);

      // If track fails to play, pause playback
      await trackPlayerService.stop();
      setIsPlaying(false);
    } finally {
      setIsTransitioning(false);
    }
  }, [playlist, currentIndex, repeatMode, currentTrack, clearAudioMonitoring]);

  const cancelLoadingState = useCallback(async () => {
    console.log("[PlayerContext] Cancelling loading state");
    setIsLoading(false);
    setIsTransitioning(false);

    // Stop any ongoing caching operations
    cacheControllersRef.current.forEach((controller, trackId) => {
      console.log(`[PlayerContext] Aborting caching for track: ${trackId}`);
      controller.abort();
    });
    cacheControllersRef.current.clear();

    // Stop current playback
    try {
      await trackPlayerService.stop();
    } catch (error) {
      console.log(
        "[PlayerContext] Error stopping playback during cancellation:",
        error
      );
    }

    // Reset position and cache progress
    setPosition(0);
    setCacheProgress(null);
    setIsPlaying(false);
  }, []);

  const playTrack = useCallback(
    async (track: Track, playlistData: Track[] = [], index: number = 0) => {
      console.log(
        `[PlayerContext] playTrack() called with track: ${track.title}, index: ${index}, playlist length: ${playlistData.length}, isLoading: ${isLoading}, isTransitioning: ${isTransitioning}`
      );

      const playRequestId = ++playRequestIdRef.current;

      // Cancel any ongoing loading/transitioning state
      if (isLoading || isTransitioning) {
        console.log("[PlayerContext] Cancelling ongoing loading state");
        await cancelLoadingState();
      }

      // Determine effective playlist and index based on context
      let effectivePlaylist: Track[];
      let effectiveIndex: number;

      if (playlistData.length > 0) {
        // Explicit playlist provided (e.g. search results, album, artist)
        effectivePlaylist = playlistData;
        effectiveIndex = index >= 0 ? index : 0;
      } else {
        // No explicit playlist: treat this track as a single-track playlist
        effectivePlaylist = [track];
        effectiveIndex = 0;
      }

      // Reset stream retry counter when starting a new track
      setStreamRetryCount(0);
      // Reset stream failed flag when starting a new track
      setHasStreamFailed(false);

      try {
        setIsLoading(true);
        setIsTransitioning(true);

        // Reset position and cache tracking for the new track
        setCacheProgress(null);
        setPosition(0);
        setDuration(track.duration || 0);

        // Set the track immediately so MiniPlayer can appear
        console.log(
          `[PlayerContext] playTrack() - Setting current track: ${track.title}, index: ${index}`
        );
        setCurrentTrack(track);

        // Update playlist context to reflect the effective playlist
        currentPlaylistContextRef.current = effectivePlaylist;
        setPlaylist(effectivePlaylist);
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
          setPreviouslyPlayedSongs((prev) => {
            const updatedPreviouslyPlayed = [
              track,
              ...prev.filter((t) => t.id !== track.id),
            ].slice(0, 100);
            StorageService.savePreviouslyPlayedSongs(updatedPreviouslyPlayed);
            return updatedPreviouslyPlayed;
          });
        }

        // Stop current playback if any
        try {
          await trackPlayerService.stop();
        } catch (error) {
          console.log(
            "[PlayerContext] Error stopping current playback:",
            error
          );
        }

        // Get audio URL using the streaming manager
        let audioUrl = track.audioUrl;
        let originalStreamUrl: string | null = null;

        if (track.id) {
          const cachedFilePath = await audioManager.getBestCachedFilePath(
            track.id
          );
          if (cachedFilePath) {
            console.log(
              `[PlayerContext] Using cached file for track: ${track.title}`
            );
            audioUrl = cachedFilePath;
          }
        }

        if (audioUrl && !audioUrl.startsWith("file://")) {
          // If we already have a streaming URL (not a cached file), use it as original
          originalStreamUrl = audioUrl;
          console.log(
            `[PlayerContext] Using provided streaming URL as original: ${originalStreamUrl}`
          );
        }

        if (!audioUrl && track.id) {
          try {
            if (track._isSoundCloud || track.source === "soundcloud") {
              // SoundCloud URLs expire, so we need to get a fresh one
              console.log(
                `[PlayerContext] Getting fresh SoundCloud URL for track: ${track.id}`
              );

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
            } else if (track._isJioSaavn || track.source === "jiosaavn") {
              console.log(
                `[PlayerContext] Getting JioSaavn streaming URL for track: ${track.id}`
              );
              originalStreamUrl = await getAudioStreamUrl(
                track.id,
                (status) =>
                  console.log(
                    `[PlayerContext] JioSaavn streaming status: ${status}`
                  ),
                "jiosaavn",
                track.title,
                track.artist
              );
              audioUrl = originalStreamUrl;
              console.log(`[PlayerContext] Got JioSaavn URL: ${audioUrl}`);
            } else {
              // Only fetch streaming URL if we don't already have one
              if (!track.audioUrl) {
                console.log(
                  `[PlayerContext] Getting generic streaming URL for track: ${track.id} (source: ${track.source || "unknown"})`
                );

                originalStreamUrl = await getAudioStreamUrl(
                  track.id,
                  (status) =>
                    console.log(
                      `[PlayerContext] Generic streaming status: ${status}`
                    ),
                  track.source || "youtube",
                  track.title,
                  track.artist
                );

                audioUrl = originalStreamUrl;
                console.log(
                  `[PlayerContext] Got generic streaming URL: ${audioUrl}`
                );
              } else {
                // Use existing audio URL if available
                audioUrl = track.audioUrl;
                originalStreamUrl = audioUrl;
                console.log(
                  `[PlayerContext] Using existing audio URL for: ${track.title}`
                );
              }
            }
          } catch (streamingError) {
            console.error(
              "[PlayerContext] Failed to get streaming URL:",
              streamingError
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

        // Create new track (with enhanced error handling and fallbacks)
        let finalAudioUrl = audioUrl;

        // Check if this song is liked and cache it if so
        if (finalAudioUrl && track.id) {
          const isLiked = likedSongs.some((song) => song.id === track.id);
          if (isLiked) {
            console.log(
              `[PlayerContext] Song is liked, starting MP3 caching: ${track.title}`
            );
            try {
              import("../modules/audioStreaming")
                .then(({ downloadCompleteSongAsMP3 }) => {
                  const cacheController = new AbortController();

                  // Use the new MP3 download functionality for liked songs
                  downloadCompleteSongAsMP3(
                    finalAudioUrl,
                    track.id,
                    cacheController,
                    (percentage) => {
                      console.log(
                        `[PlayerContext] MP3 caching progress for liked song: ${percentage}%`
                      );
                      setCacheProgress({
                        trackId: track.id,
                        percentage: percentage,
                        fileSize: 0, // We don't have file size info here
                      });
                    }
                  )
                    .then((cachedPath) => {
                      console.log(
                        `[PlayerContext] MP3 caching completed for liked song ${track.id}: ${cachedPath}`
                      );
                    })
                    .catch((error) => {
                      console.error(
                        `[PlayerContext] Failed to MP3 cache liked song ${track.id}:`,
                        error
                      );
                      // Fallback to regular caching if MP3 fails
                      import("../modules/audioStreaming")
                        .then(({ continueCachingTrack }) => {
                          continueCachingTrack(
                            finalAudioUrl,
                            track.id,
                            cacheController,
                            (percentage) => {
                              console.log(
                                `[PlayerContext] Fallback caching progress for liked song: ${percentage}%`
                              );
                              setCacheProgress({
                                trackId: track.id,
                                percentage: percentage,
                                fileSize: 0,
                              });
                            }
                          ).catch((fallbackError) => {
                            console.error(
                              `[PlayerContext] Fallback caching also failed for liked song ${track.id}:`,
                              fallbackError
                            );
                          });
                        })
                        .catch((importError) => {
                          console.error(
                            "[PlayerContext] Failed to import fallback caching module:",
                            importError
                          );
                        });
                    });
                })
                .catch((error) => {
                  console.error(
                    "[PlayerContext] Failed to import audioStreaming module:",
                    error
                  );
                });
            } catch (error) {
              console.error(
                "[PlayerContext] Error starting MP3 cache for liked song:",
                error
              );
            }
          }
        }

        try {
          if (finalAudioUrl) {
            const updatedPlaylist = effectivePlaylist.map(
              (playlistTrack, index) => {
                if (index === effectiveIndex) {
                  return { ...playlistTrack, audioUrl: finalAudioUrl };
                }
                return playlistTrack;
              }
            );

            if (playRequestId !== playRequestIdRef.current) {
              return;
            }

            console.log(
              "[PlayerContext] Checking TrackPlayer initialization status..."
            );

            await trackPlayerService.addTracks(updatedPlaylist, effectiveIndex);
            await trackPlayerService.play();
            if (playRequestId === playRequestIdRef.current) {
              setIsPlaying(true);
              console.log(
                `[PlayerContext] Playback started for track: ${track.title}`
              );
            }
          } else {
            console.warn(
              `[PlayerContext] No audio URL available for track: ${track.title}`
            );
            if (playRequestId === playRequestIdRef.current) {
              setIsPlaying(false);
            }
          }

          if (playRequestId === playRequestIdRef.current) {
            setIsLoading(false);
            setCurrentTrack({ ...track, audioUrl: finalAudioUrl });
          }
        } catch (playbackError) {
          console.error(
            "[PlayerContext] Critical error in playback setup:",
            playbackError
          );

          if (playRequestId === playRequestIdRef.current) {
            setIsPlaying(false);
            setIsLoading(false);
            setCurrentTrack({ ...track, audioUrl: "" });
          }
        }

        // Set up playback monitoring (only if track was successfully added)
        if (!finalAudioUrl) {
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

        // Set up RNTP event listeners for playback monitoring
        const progressListener = TrackPlayer.addEventListener(
          Event.PlaybackProgressUpdated,
          async (event) => {
            const position = event.position;
            const duration = event.duration;

            setPosition(position);
            setDuration(duration);

            // Check if we've been in this position for too long (indicating silent playback)
            // Be more lenient for YouTube streams during initial buffering
            const timeSinceStart = Date.now() - initialBufferTime;
            const isInitialBufferPhase = timeSinceStart < 3000; // First 3 seconds

            if (position === lastPosition) {
              positionStuckCounter++;

              // Different thresholds for different stream types and phases
              const threshold = isYouTubeStream && isInitialBufferPhase ? 5 : 2;

              if (
                positionStuckCounter >= threshold &&
                currentTrack &&
                !isTransitioning &&
                !isInitialBufferPhase &&
                position > 1
              ) {
                console.error(
                  `[PlayerContext] CONFIRMED: ${isYouTubeStream ? "YouTube" : "SoundCloud"} audio cutout at ${position}s - position stuck despite isPlaying=true (threshold: ${threshold}, initialBuffer: ${isInitialBufferPhase})`
                );
                handleStreamFailure();
                positionStuckCounter = 0;
              } else if (
                positionStuckCounter >= threshold &&
                (isTransitioning || isInitialBufferPhase || position <= 1)
              ) {
                console.log(
                  "[PlayerContext] Skipping stream failure detection during transition or initial buffer"
                );
                positionStuckCounter = 0;
              }
            } else {
              positionStuckCounter = 0;
            }

            // Proactive refresh for SoundCloud tracks around 55 seconds (before they expire)
            if (track._isSoundCloud && position >= 55 && position < 60) {
              console.log(
                `[PlayerContext] SoundCloud track approaching 1min, preparing for refresh at position: ${position}s`
              );
              // Could implement pre-emptive refresh here if needed
            }

            lastPosition = position;
          }
        );

        // Add the listener to the cleanup array
        audioMonitoringListenersRef.current.push(progressListener);

        // Set up track end listener for auto-next and post-playback caching
        const queueEndedListener = TrackPlayer.addEventListener(
          Event.PlaybackQueueEnded,
          async (event) => {
            setIsPlaying(false);

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
            if (!isTransitioning && !isLoading) {
              nextTrackRef.current();
            } else {
              console.log(
                "[PlayerContext] Skipping auto-next due to ongoing transition/loading"
              );
            }
          }
        );

        // Add the listener to the cleanup array
        audioMonitoringListenersRef.current.push(queueEndedListener);
      } catch (error) {
        console.error("[PlayerContext] Error playing track:", error);
        if (playRequestId === playRequestIdRef.current) {
          setIsLoading(false);
          setIsTransitioning(false);
          setIsPlaying(false);
        }
      } finally {
        if (playRequestId === playRequestIdRef.current) {
          setIsTransitioning(false);
        }
      }
    },
    [
      audioManager,
      isLoading,
      isTransitioning,
      likedSongs,
      currentTrack,
      getCacheInfo,
      nextTrackRef,
      cancelLoadingState,
    ]
  );

  const playPause = useCallback(async () => {
    if (!currentTrack?.audioUrl) {
      console.warn("[PlayerContext] Cannot play/pause: Player not ready");
      return;
    }

    try {
      // Handle loading state - allow stopping loading
      if (isLoading) {
        console.log("[PlayerContext] Stopping loading state");
        await cancelLoadingState();
        return;
      }

      if (isPlaying) {
        await trackPlayerService.pause();
        setIsPlaying(false);
        console.log("[PlayerContext] Playback paused");
      } else {
        await trackPlayerService.play();
        setIsPlaying(true);
        console.log("[PlayerContext] Playback resumed");
      }
    } catch (error) {
      console.error("[PlayerContext] Error toggling play/pause:", error);
    }
  }, [isPlaying, currentTrack?.audioUrl, isLoading, cancelLoadingState]);

  const previousTrack = useCallback(async () => {
    console.log("[PlayerContext] previousTrack() called");

    // Use current playlist context if available, otherwise fall back to global playlist
    const currentPlaylist =
      currentPlaylistContextRef.current.length > 0
        ? currentPlaylistContextRef.current
        : playlist;

    console.log(
      `[PlayerContext] Playlist length: ${currentPlaylist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`
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
          "[PlayerContext] previousTrack() - Repeat one mode, replaying current track"
        );
        await playTrack(currentTrack, currentPlaylist, currentIndex);
        return;
      }

      // Handle single song playlist
      if (currentPlaylist.length === 1) {
        console.log("[PlayerContext] previousTrack() - Single song playlist");
        if (repeatMode === "one" || repeatMode === "all") {
          console.log(
            "[PlayerContext] previousTrack() - Single song with repeat, replaying"
          );
          await playTrack(currentTrack!, currentPlaylist, 0);
        } else {
          console.log(
            "[PlayerContext] previousTrack() - Single song, no repeat, stopping"
          );
          await trackPlayerService.stop();
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
          `[PlayerContext] previousTrack() - Playing previous track at index ${prevIndex}: ${prevTrack.title}`
        );
        await playTrack(prevTrack, playlist, prevIndex);
      } else {
        console.log(
          `[PlayerContext] previousTrack() - No track found at index ${prevIndex}`
        );
        // If no track found, try to stop playback gracefully
        await trackPlayerService.stop();
        setIsPlaying(false);
      }
    } catch (error) {
      console.error(`[PlayerContext] Failed to play previous track: ${error}`);

      // If track fails to play, pause playback
      await trackPlayerService.stop();
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
    async (positionSeconds: number) => {
      console.log(
        `[PlayerContext] seekTo called - positionSeconds: ${positionSeconds}, currentTrack?.audioUrl: ${!!currentTrack?.audioUrl}`
      );
      if (!currentTrack) {
        console.warn("[PlayerContext] Cannot seek: No current track");
        return;
      }
      try {
        const positionMs = positionSeconds * 1000;

        // Store current playing state to restore later
        const wasPlaying = isPlaying;

        // Pause playback during seek to prevent audio from continuing at old position
        if (isPlaying) {
          console.log("[PlayerContext] Pausing playback during seek");
          await trackPlayerService.pause();
          setIsPlaying(false);
        }

        // Check if the target position is cached before seeking
        if (
          currentTrack.id &&
          currentTrack.audioUrl &&
          (currentTrack._isSoundCloud ||
            currentTrack.source === "soundcloud" ||
            currentTrack.source === "youtube" ||
            currentTrack._isJioSaavn ||
            currentTrack.source === "jiosaavn")
        ) {
          console.log(
            `[PlayerContext] Checking if position ${positionMs}ms is cached for track: ${currentTrack.id}`
          );

          try {
            const { AudioStreamManager } =
              await import("../modules/audioStreaming");
            const manager = AudioStreamManager.getInstance();

            const positionCheck = await manager.isPositionCached(
              currentTrack.id,
              positionMs
            );
            console.log(
              `[PlayerContext] Position cache check: isCached=${positionCheck.isCached}, cacheEnd=${positionCheck.estimatedCacheEndMs}ms`
            );

            if (!positionCheck.isCached) {
              console.warn(
                `[PlayerContext] Position ${positionMs}ms is not cached (cache ends at ${positionCheck.estimatedCacheEndMs}ms). Attempting to cache more...`
              );

              // Set loading state to indicate we're caching
              setIsLoading(true);

              // Trigger cache completion for the missing portion
              // For YouTube tracks, use position-based caching
              if (currentTrack.source === "youtube") {
                console.log(
                  `[PlayerContext] Starting position-based caching from ${positionMs}ms for YouTube track: ${currentTrack.id}`
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
                    positionSeconds,
                    seekCacheController
                  );

                  console.log(
                    `[PlayerContext] Position-based caching completed, cached URL: ${cachedUrl}`
                  );
                } catch (seekCacheError) {
                  console.error(
                    `[PlayerContext] Position-based caching failed for ${currentTrack.id}:`,
                    seekCacheError
                  );
                  // Fallback to regular cache monitoring
                  const { monitorAndResumeCache } =
                    await import("../modules/audioStreaming");

                  monitorAndResumeCache(
                    currentTrack.id,
                    currentTrack.audioUrl,
                    (percentage) => {
                      console.log(
                        `[PlayerContext] Fallback cache completion progress: ${percentage}%`
                      );
                      setCacheProgress({
                        trackId: currentTrack.id,
                        percentage: percentage,
                        fileSize: 0, // Will be updated when cache info is fetched
                      });
                    }
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
                      `[PlayerContext] Cache completion progress: ${percentage}%`
                    );
                    setCacheProgress({
                      trackId: currentTrack.id,
                      percentage: percentage,
                      fileSize: 0, // Will be updated when cache info is fetched
                    });
                  }
                );
              }

              // Wait a bit for caching to start, then proceed with seek
              // This prevents the audio from playing at old position while caching
              await new Promise((resolve) => setTimeout(resolve, 500));

              // Clear loading state after initial cache setup
              setIsLoading(false);

              console.log(
                "[PlayerContext] Seeking to uncached position - will resume when ready"
              );
            } else {
              console.log(
                `[PlayerContext] Position ${positionMs}ms is within cached range`
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

        // Verify player is ready before seeking
        const state = await TrackPlayer.getPlaybackState();
        if (state.state === State.None) {
          console.warn(
            "[PlayerContext] Cannot seek: Player not ready (likely still loading)"
          );
          return;
        }

        const safePositionSeconds =
          duration > 0
            ? Math.max(0, Math.min(positionSeconds, duration))
            : Math.max(0, positionSeconds);

        console.log(
          `[PlayerContext] Seeking to positionSeconds: ${safePositionSeconds}`
        );
        await trackPlayerService.seekTo(safePositionSeconds);
        console.log("[PlayerContext] Seek completed successfully");

        // Only resume playback if it was playing before the seek
        if (wasPlaying) {
          console.log("[PlayerContext] Resuming playback after seek");
          await trackPlayerService.play();
          setIsPlaying(true);
        }
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
      isPlaying,
    ]
  );

  const handleStreamFailure = useCallback(async () => {
    console.warn("[PlayerContext] === STREAM FAILURE DETECTED ===");
    console.warn("[PlayerContext] Attempting to reload stream...");

    if (!currentTrack) {
      console.warn("[PlayerContext] No current track to reload");
      return;
    }

    // Check if stream has already failed to prevent retries
    if (hasStreamFailed) {
      console.warn("[PlayerContext] Stream has already failed, not retrying");
      return;
    }

    // Set the stream failed flag to prevent retries
    setHasStreamFailed(true);

    // Check if this is a YouTube stream and if it's very early in playback
    const isYouTubeStream =
      currentTrack.audioUrl &&
      (currentTrack.audioUrl.includes("googlevideo.com") ||
        currentTrack.audioUrl.includes("youtube.com") ||
        currentTrack.audioUrl.includes("invidious") ||
        currentTrack.audioUrl.includes("piped"));

    let currentPosition = 0;
    try {
      currentPosition = await trackPlayerService.getPosition();
      currentPosition = currentPosition * 1000; // Convert to milliseconds
    } catch (error) {
      // Ignore position errors
    }

    // For YouTube streams in the first 5 seconds, be more conservative
    if (isYouTubeStream && currentPosition < 5000) {
      console.warn(
        "[PlayerContext] YouTube stream failure in early phase, waiting before reload..."
      );
      // Don't reload immediately for YouTube in early phase - might be normal buffering
      return;
    }

    // Check retry limit to prevent infinite loops
    if (streamRetryCount >= 3) {
      console.error(
        "[PlayerContext] Maximum stream retry attempts reached, giving up"
      );
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }

    setStreamRetryCount((prev) => prev + 1);

    console.log(
      `[PlayerContext] Current track: ${currentTrack.title} by ${currentTrack.artist}`
    );
    console.log(`[PlayerContext] Current audio URL: ${currentTrack.audioUrl}`);

    try {
      // Store current position for resume
      let currentPosition = 0;
      console.log("[PlayerContext] Getting current position before reload");
      try {
        currentPosition = await trackPlayerService.getPosition();
        currentPosition = currentPosition * 1000; // Convert to milliseconds
        console.log(`[PlayerContext] Current position: ${currentPosition}ms`);
      } catch (error) {
        console.log(`[PlayerContext] Could not get position: ${error}`);
      }

      // Clear current track
      console.log("[PlayerContext] Stopping current track");
      try {
        await trackPlayerService.stop();
        console.log("[PlayerContext] Current track stopped successfully");
      } catch (error) {
        console.log(`[PlayerContext] Error stopping track: ${error}`);
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

        // Update track with new URL and play from previous position
        try {
          await trackPlayerService.updateCurrentTrack(newAudioUrl);
          console.log(
            "[PlayerContext] Updated track in Track Player with new audio URL"
          );

          // Seek to previous position
          if (currentPosition > 0) {
            console.log(
              `[PlayerContext] Seeking to previous position: ${currentPosition}ms`
            );
            try {
              await trackPlayerService.seekTo(currentPosition / 1000); // Convert ms to seconds
              console.log("[PlayerContext] Seek completed");
            } catch (error) {
              console.log(`[PlayerContext] Seek failed: ${error}`);
            }
          }
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to update track in Track Player:",
            error
          );
        }

        // Update current track with new audio URL
        setCurrentTrack({ ...currentTrack, audioUrl: newAudioUrl });

        // Update the track in Track Player
        try {
          await trackPlayerService.updateCurrentTrack(newAudioUrl);
          console.log(
            "[PlayerContext] Updated track in Track Player with new audio URL"
          );
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to update track in Track Player:",
            error
          );
        }

        // Set up playback monitoring again
        console.log("[PlayerContext] Setting up new playback monitoring");

        // Position tracking variables for stuck detection
        let lastPosition = currentPosition;
        let positionStuckCounter = 0;
        let lastProgressTime = Date.now();

        // Track Player handles position updates internally, but we can monitor via events
        const positionUpdateListener = TrackPlayer.addEventListener(
          Event.PlaybackProgressUpdated,
          async (data) => {
            const currentPosition = await trackPlayerService.getPosition();

            // Check if position is stuck again
            if (currentPosition === lastPosition) {
              positionStuckCounter++;
              if (positionStuckCounter >= 3) {
                console.warn("[PlayerContext] Audio still stuck after reload");
                // Could implement more aggressive recovery here
              }
            } else {
              positionStuckCounter = 0;
              lastProgressTime = Date.now(); // Update progress time when position changes
            }

            // Monitor for cache exhaustion - if we're getting close to the 5MB cache limit
            // and the stream is struggling, proactively reload
            if (
              currentPosition > 300 &&
              currentPosition < 400 &&
              !isTransitioning
            ) {
              // Between 5-6.5 minutes (in seconds)
              const timeSinceLastProgress = Date.now() - lastProgressTime;
              if (timeSinceLastProgress > 3000) {
                // No progress in 3 seconds
                console.warn(
                  "[PlayerContext] Possible cache exhaustion detected, reloading stream..."
                );
                handleStreamFailure();
              }
            } else if (currentPosition > 300 && isTransitioning) {
              console.log(
                "[PlayerContext] Skipping cache exhaustion check during transition"
              );
            }

            lastPosition = currentPosition;
          }
        );

        // Store the listener for cleanup
        audioMonitoringListenersRef.current.push(positionUpdateListener);

        console.log("[PlayerContext] === STREAM RELOADED SUCCESSFULLY ===");
      } else {
        console.warn(
          "[PlayerContext] Could not get fresh audio URL for reload"
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
        `[PlayerContext] Aborting continuous caching for track: ${trackId}`
      );
      controller.abort();
    });
    cacheControllersRef.current.clear();

    // Remove all audio monitoring listeners
    console.log("[PlayerContext] Removing audio monitoring listeners");
    audioMonitoringListenersRef.current.forEach((listener) => {
      listener.remove();
    });
    audioMonitoringListenersRef.current = [];

    try {
      await trackPlayerService.stop();
      await trackPlayerService.reset();
    } catch (error) {
      console.log("[PlayerContext] Error stopping playback:", error);
    }

    setCurrentTrack(null);
    setPlaylist([]);
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsLoading(false);
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

        // Start caching the liked song
        if (track.id && track.audioUrl) {
          console.log(
            `[PlayerContext] Starting to cache liked song: ${track.title} (${track.id})`
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
                    `[PlayerContext] Liked song cache progress: ${percentage}%`
                  );
                  setCacheProgress({
                    trackId: track.id,
                    percentage: percentage,
                    fileSize: 0,
                  });
                }
              ).catch((error) => {
                console.error(
                  `[PlayerContext] Failed to cache liked song ${track.id}:`,
                  error
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
                error
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
                `[PlayerContext] Song already downloading: ${song.title}`
              );
              continue;
            }

            console.log(
              `[PlayerContext] Starting to cache liked song: ${song.title} (${song.id})`
            );

            const cacheController = new AbortController();

            continueCachingTrack(
              song.audioUrl,
              song.id,
              cacheController,
              (percentage) => {
                console.log(
                  `[PlayerContext] Background cache progress for ${song.title}: ${percentage}%`
                );
                setCacheProgress({
                  trackId: song.id,
                  percentage: percentage,
                  fileSize: 0,
                });
              }
            ).catch((error) => {
              console.error(
                `[PlayerContext] Failed to cache liked song ${song.id}:`,
                error
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
          `[PlayerContext] Started background caching for ${songs.length} liked songs`
        );
      } catch (error) {
        console.error("[PlayerContext] Error caching all liked songs:", error);
      }
    },
    [audioManager]
  );

  const isSongLiked = useCallback(
    (trackId: string) => {
      return likedSongs.some((song) => song.id === trackId);
    },
    [likedSongs]
  );

  // Handle notification responses for media controls
  useEffect(() => {
    // Skip notification handling since expo-notifications is removed
    console.log(
      "[PlayerContext] Notification handling disabled - expo-notifications removed"
    );
    return () => {};
  }, [playPause, nextTrack, previousTrack, clearPlayer]);

  const applyPredefinedTheme = (themeName: string) => {
    // Simple theme mapping without imageColors dependency
    const simpleThemes: Record<string, any> = {
      default: {
        primary: "#a3e635",
        secondary: "#22d3ee",
        background: "#000000",
        text: "#ffffff",
        accent: "#f59e0b",
        isGradient: false,
      },
      dark: {
        primary: "#ffffff",
        secondary: "#ffffff",
        background: "#000000",
        text: "#ffffff",
        accent: "#ffffff",
        isGradient: false,
      },
    };

    const theme = simpleThemes[themeName];
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
    hasStreamFailed,
    position,
    duration,
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
    cancelLoadingState,
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
