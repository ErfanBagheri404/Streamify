import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { AppState } from "react-native";
import TrackPlayer, { State, Event } from "../utils/safeTrackPlayer";
import * as FileSystem from "expo-file-system";
import {
  getAudioStreamUrl,
  prepareCachedStreamUrl,
  getAudioCacheInfo,
  getFullyCachedAudioUrl,
  markAudioCacheComplete,
  clearAudioCacheForTrack,
  continueCachingTrack,
  monitorAndResumeCache,
  subscribeToAudioCacheProgress,
} from "../modules/audioStreaming";

import { StorageService, subscribeToLibraryUpdates } from "../utils/storage";
import { trackPlayerService } from "../services/TrackPlayerService";
import { t } from "../utils/localization";
import { useAppSettings } from "../hooks/useAppSettings";
import { hasPlaceholderTrackMetadata } from "../lib/cloud-library-sync";

export interface Track {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  artistImage?: string;
  artistSource?: string;
  duration?: number;
  thumbnail?: string;
  audioUrl?: string;
  url?: string;
  source?: string;
  providerHint?: string;
  _isSoundCloud?: boolean;
  _isJioSaavn?: boolean;
}

function resolveTrackSource(
  track: Pick<Track, "source" | "_isSoundCloud" | "_isJioSaavn">,
): "youtube" | "youtubemusic" | "soundcloud" | "jiosaavn" {
  if (track._isSoundCloud || track.source === "soundcloud") {
    return "soundcloud";
  }

  if (track._isJioSaavn || track.source === "jiosaavn") {
    return "jiosaavn";
  }

  if (track.source === "youtubemusic") {
    return "youtubemusic";
  }

  return "youtube";
}

function getNextQueueIndex(
  mode: "off" | "one" | "all",
  queueLength: number,
  activeIndex: number,
): number {
  if (queueLength <= 0 || activeIndex < 0) {
    return -1;
  }

  if (activeIndex < queueLength - 1) {
    return activeIndex + 1;
  }

  if (mode === "all" && queueLength > 1) {
    return 0;
  }

  return -1;
}

function normalizeCachePercentage(
  percentage: number,
  isFullyCached = false,
): number {
  const safePercentage = Number.isFinite(percentage) ? percentage : 0;
  const rounded = Math.round(safePercentage);
  return isFullyCached ? 100 : Math.max(0, Math.min(99, rounded));
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
  canSkipNext: boolean;
  canSkipPrevious: boolean;
  canToggleShuffle: boolean;
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
  playbackError: string | null;

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
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;
  clearPlayer: () => Promise<void>;
  handleStreamFailure: () => Promise<void>;
  clearAudioMonitoring: () => void;
  cancelLoadingState: () => Promise<void>;
  toggleLikeSong: (track: Track) => void;
  stopCachingAndUnlike: (trackId: string) => void;
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
  cancelCaching: (trackId: string) => void;
  startCacheQueue: () => void;
  resetStreamRetryCount: () => void;
  applyPredefinedTheme: (themeName: string) => void;
  clearPlaybackError: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { settings } = useAppSettings();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  // Remove sound state since we're using Track Player
  const [repeatMode, setRepeatModeState] = useState<"off" | "one" | "all">(
    "off",
  );
  const [isInPlaylistContext, setIsInPlaylistContext] = useState(false);
  const [isShuffled, setIsShuffled] = useState(false);
  const [likedSongs, setLikedSongs] = useState<Track[]>([]);
  const [previouslyPlayedSongs, setPreviouslyPlayedSongs] = useState<Track[]>(
    [],
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
  const resetProgressState = useCallback(
    (nextPosition = 0, nextDuration?: number) => {
      setPosition(Math.max(0, nextPosition));
      if (typeof nextDuration === "number" && Number.isFinite(nextDuration)) {
        setDuration(Math.max(0, nextDuration));
      }
    },
    [],
  );
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const originalPlaylistRef = useRef<Track[]>([]);
  const currentPlaylistContextRef = useRef<Track[]>([]);
  const streamCheckRef = useRef<{ position: number; time: number } | null>(
    null,
  );
  const playRequestIdRef = useRef(0);
  const suppressNonPlayingStateRef = useRef(false);
  const playStateSuppressionTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const likedSongsRef = useRef<Track[]>([]);
  const isCacheQueueProcessingRef = useRef(false);
  const cacheQueueAbortControllerRef = useRef<AbortController | null>(null);
  const activeCacheTrackIdRef = useRef<string | null>(null);
  const lastAppliedCachedUrlRef = useRef<string | null>(null);
  const activeQueueLength =
    currentPlaylistContextRef.current.length > 0
      ? currentPlaylistContextRef.current.length
      : playlist.length;
  const canToggleShuffle = activeQueueLength > 1;
  const canSkipNext =
    activeQueueLength > 1 &&
    (currentIndex < activeQueueLength - 1 || repeatMode === "all");
  const canSkipPrevious =
    position > 3 ||
    (activeQueueLength > 1 &&
      (currentIndex > 0 || (repeatMode === "all" && activeQueueLength > 1)));

  // Function refs to avoid stale closures in useEffect
  const playPauseRef = useRef<() => Promise<void>>(async () => {});
  const nextTrackRef = useRef<() => Promise<void>>(async () => {});
  const previousTrackRef = useRef<() => Promise<void>>(async () => {});
  const clearPlayerRef = useRef<() => Promise<void>>(async () => {});
  const seekToRef = useRef<(position: number) => Promise<void>>(async () => {});

  // Audio monitoring listeners for cleanup
  const audioMonitoringListenersRef = useRef<any[]>([]);

  const buildCacheProgressState = useCallback(
    (
      trackId: string,
      percentage: number,
      fileSize: number,
      isFullyCached = false,
    ) => ({
      trackId,
      percentage: normalizeCachePercentage(percentage, isFullyCached),
      fileSize,
    }),
    [],
  );

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

  const clearPlayStateSuppression = useCallback(() => {
    suppressNonPlayingStateRef.current = false;
    if (playStateSuppressionTimeoutRef.current) {
      clearTimeout(playStateSuppressionTimeoutRef.current);
      playStateSuppressionTimeoutRef.current = null;
    }
  }, []);

  const suppressNonPlayingStateTemporarily = useCallback(() => {
    suppressNonPlayingStateRef.current = true;
    if (playStateSuppressionTimeoutRef.current) {
      clearTimeout(playStateSuppressionTimeoutRef.current);
    }
    playStateSuppressionTimeoutRef.current = setTimeout(() => {
      suppressNonPlayingStateRef.current = false;
      playStateSuppressionTimeoutRef.current = null;
    }, 900);
  }, []);

  const normalizePlaybackError = useCallback(
    (message?: string | null, track?: Track | null) => {
      const rawMessage = String(message || "").trim();
      const normalizedMessage = rawMessage.toLowerCase();
      const isSoundCloudTrack =
        track?._isSoundCloud || track?.source === "soundcloud";

      if (isSoundCloudTrack) {
        if (
          rawMessage ===
            "SoundCloud is restricted in your country. Use a VPN or change your IP to play SoundCloud songs." ||
          (normalizedMessage.includes("soundcloud") &&
            (normalizedMessage.includes("restricted") ||
              normalizedMessage.includes("403") ||
              normalizedMessage.includes("401") ||
              normalizedMessage.includes("forbidden") ||
              normalizedMessage.includes("license") ||
              normalizedMessage.includes("drm") ||
              normalizedMessage.includes("encrypted")))
        ) {
          return t("playback.soundcloudRestricted");
        }

        if (
          normalizedMessage.includes(
            "this soundcloud track couldn't be loaded",
          ) ||
          normalizedMessage.includes(
            "this soundcloud track could not be loaded",
          ) ||
          normalizedMessage.includes("soundcloud track couldn't be loaded") ||
          normalizedMessage.includes("soundcloud track could not be loaded") ||
          (normalizedMessage.includes("soundcloud") &&
            (normalizedMessage.includes("couldn't be loaded") ||
              normalizedMessage.includes("could not be loaded") ||
              normalizedMessage.includes("unavailable") ||
              normalizedMessage.includes("playback failed") ||
              normalizedMessage.includes("stream url missing")))
        ) {
          return t("playback.soundcloudTrackUnavailable");
        }

        return t("playback.soundcloudTrackUnavailable");
      }

      const isJioSaavnSource =
        track?._isJioSaavn ||
        track?.source === "jiosaavn" ||
        track?.source === "youtubemusic";
      if (
        isJioSaavnSource &&
        (normalizedMessage.includes("jiosaavn") ||
          normalizedMessage.includes("exact jiosaavn match") ||
          normalizedMessage.includes("not playable from this source") ||
          normalizedMessage.includes("no exact jiosaavn match found") ||
          normalizedMessage.includes(
            "unable to fetch jiosaavn track payload",
          ) ||
          normalizedMessage.includes(
            "no audio streams found via youtube music extraction",
          ) ||
          normalizedMessage.includes(
            "no audio streams found in youtube embed",
          ) ||
          normalizedMessage.includes("no working audio formats found") ||
          normalizedMessage.includes("no audio formats found") ||
          normalizedMessage.includes(
            "matched jiosaavn result had no playable",
          ) ||
          normalizedMessage.includes("missing track metadata for jiosaavn"))
      ) {
        return t("playback.jiosaavnTrackUnavailable");
      }

      if (!rawMessage) {
        return t("playback.errorDefault");
      }

      if (
        rawMessage === "Couldn't load this track right now." ||
        normalizedMessage.includes("couldn't load this track right now")
      ) {
        return t("playback.loadTrackNow");
      }

      if (
        rawMessage ===
          "Couldn't play this track. Try again or choose another one." ||
        normalizedMessage.includes("couldn't play this track")
      ) {
        return t("playback.errorDefault");
      }

      if (
        normalizedMessage.includes("network request failed") ||
        normalizedMessage.includes("failed to fetch") ||
        normalizedMessage.includes("timed out") ||
        normalizedMessage.includes("timeout")
      ) {
        return t("playback.loadTrackNow");
      }

      return rawMessage;
    },
    [],
  );

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
          url: (item as any).url,
          source: (item as any).source,
          providerHint: (item as any).providerHint,
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
          },
        );
        audioMonitoringListenersRef.current.push(progressListener);
      }
    } catch (error) {}
  };

  // Initialize TrackPlayer on startup
  useEffect(() => {
    const initializeTrackPlayer = async () => {
      try {
        console.log("[PlayerContext] Initializing TrackPlayer service...");

        // Ensure the service is properly initialized before any operations
        await trackPlayerService.setupPlayer();
        console.log(
          "[PlayerContext] TrackPlayer service initialized successfully",
        );

        await rehydrateFromTrackPlayer();
      } catch (error) {
        console.error(
          "[PlayerContext] Failed to initialize TrackPlayer service:",
          error,
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
        if (nextIsPlaying) {
          clearPlayStateSuppression();
          setIsPlaying(true);
          return;
        }

        if (suppressNonPlayingStateRef.current) {
          return;
        }

        setIsPlaying(false);
      },
    );
    return () => {
      subscription?.remove?.();
    };
  }, [clearPlayStateSuppression]);

  useEffect(() => {
    const handlePlaybackError = (error: any) => {
      setPlaybackError(normalizePlaybackError(error?.message, currentTrack));
      clearPlayStateSuppression();
      setIsPlaying(false);
      setIsLoading(false);
      setIsTransitioning(false);
    };

    trackPlayerService.onError = handlePlaybackError;
    return () => {
      if (trackPlayerService.onError === handlePlaybackError) {
        trackPlayerService.onError = undefined;
      }
    };
  }, [clearPlayStateSuppression, currentTrack, normalizePlaybackError]);

  const syncCurrentTrackFromPlayer = useCallback(async () => {
    try {
      const queue = await TrackPlayer.getQueue();
      if (!Array.isArray(queue) || queue.length === 0) {
        return;
      }

      const activeTrackIndex =
        typeof (TrackPlayer as any).getActiveTrackIndex === "function"
          ? await (TrackPlayer as any).getActiveTrackIndex()
          : await TrackPlayer.getCurrentTrack();

      if (
        activeTrackIndex === null ||
        activeTrackIndex < 0 ||
        activeTrackIndex >= queue.length
      ) {
        return;
      }

      const existingTracks =
        currentPlaylistContextRef.current.length > 0
          ? currentPlaylistContextRef.current
          : playlist;

      const mappedPlaylist: Track[] = queue.map((item: any) => {
        const id =
          item.id != null
            ? String(item.id)
            : item.url || item.title || "unknown";
        const existingTrack = existingTracks.find((entry) => entry.id === id);

        return {
          ...existingTrack,
          id,
          title: item.title || existingTrack?.title || "Unknown Title",
          artist:
            item.artist ||
            item.author ||
            existingTrack?.artist ||
            "Unknown Artist",
          duration:
            typeof item.duration === "number"
              ? item.duration
              : existingTrack?.duration || 0,
          thumbnail:
            item.artwork || item.thumbnail || existingTrack?.thumbnail || "",
          audioUrl: item.url || existingTrack?.audioUrl,
          url: item.url || existingTrack?.url,
          source: item.source || existingTrack?.source,
          providerHint: item.providerHint || existingTrack?.providerHint,
          _isSoundCloud: item._isSoundCloud ?? existingTrack?._isSoundCloud,
          _isJioSaavn: item._isJioSaavn ?? existingTrack?._isJioSaavn,
        };
      });

      const nextCurrentTrack = mappedPlaylist[activeTrackIndex];
      const [positionSeconds, durationSeconds] = await Promise.all([
        TrackPlayer.getPosition(),
        TrackPlayer.getDuration(),
      ]);

      currentPlaylistContextRef.current = mappedPlaylist;
      setPlaylist(mappedPlaylist);
      setCurrentIndex(activeTrackIndex);
      setCurrentTrack(nextCurrentTrack);
      setPosition(positionSeconds);
      setDuration(durationSeconds || nextCurrentTrack?.duration || 0);
      setIsLoading(false);
      setIsTransitioning(false);
    } catch (error) {
      console.log(
        "[PlayerContext] Failed to sync active track from TrackPlayer:",
        error,
      );
    }
  }, [playlist]);

  useEffect(() => {
    const subscriptions: Array<{ remove?: () => void }> = [];
    const sync = () => {
      void syncCurrentTrackFromPlayer();
    };

    const activeTrackChangedEvent = (Event as any).PlaybackActiveTrackChanged;
    if (activeTrackChangedEvent) {
      subscriptions.push(
        TrackPlayer.addEventListener(activeTrackChangedEvent, (event: any) => {
          const indexedTrack =
            event?.index != null
              ? currentPlaylistContextRef.current[event.index] || null
              : null;
          const nextTrack =
            event?.track || event?.nextTrack || indexedTrack || null;
          resetProgressState(
            0,
            typeof nextTrack?.duration === "number" ? nextTrack.duration : 0,
          );
          sync();
        }),
      );
    }

    const legacyTrackChangedEvent = (Event as any).PlaybackTrackChanged;
    if (
      legacyTrackChangedEvent &&
      legacyTrackChangedEvent !== activeTrackChangedEvent
    ) {
      subscriptions.push(
        TrackPlayer.addEventListener(legacyTrackChangedEvent, () => {
          resetProgressState(0, 0);
          sync();
        }),
      );
    }

    return () => {
      subscriptions.forEach((subscription) => {
        subscription?.remove?.();
      });
    };
  }, [resetProgressState, syncCurrentTrackFromPlayer]);

  // Keep library-backed state in sync with AsyncStorage updates, including cloud restores.
  useEffect(() => {
    const syncLocalLibraryState = async () => {
      try {
        const [savedLikedSongs, savedPreviouslyPlayed] = await Promise.all([
          StorageService.loadLikedSongs(),
          StorageService.loadPreviouslyPlayedSongs(),
        ]);
        setLikedSongs(savedLikedSongs);
        setPreviouslyPlayedSongs(savedPreviouslyPlayed);
      } catch (error) {
        console.error("Error syncing local library state:", error);
      }
    };

    void syncLocalLibraryState();
    return subscribeToLibraryUpdates(() => {
      void syncLocalLibraryState();
    });
  }, []);

  useEffect(() => {
    return subscribeToAudioCacheProgress((update) => {
      setCacheProgress((prev) => {
        const nextPercentage = normalizeCachePercentage(
          update.percentage,
          update.isFullyCached,
        );
        const nextFileSize = update.fileSize || 0;

        if (
          prev?.trackId === update.trackId &&
          prev.percentage === nextPercentage &&
          prev.fileSize === nextFileSize
        ) {
          return prev;
        }

        return {
          trackId: update.trackId,
          percentage: nextPercentage,
          fileSize: nextFileSize,
        };
      });
    });
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
            setCacheProgress((prev) =>
              prev
                ? {
                    ...prev,
                    percentage:
                      info.isFullyCached || info.percentage > prev.percentage
                        ? normalizeCachePercentage(
                            info.percentage,
                            info.isFullyCached,
                          )
                        : prev.percentage,
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

  useEffect(() => {
    likedSongsRef.current = likedSongs;
  }, [likedSongs]);

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
    async (trackId: string) => getAudioCacheInfo(trackId),
    [],
  );

  const clearAudioMonitoring = useCallback(() => {
    console.log("[PlayerContext] Clearing audio monitoring listeners");
    audioMonitoringListenersRef.current.forEach((listener) => {
      listener.remove();
    });
    audioMonitoringListenersRef.current = [];
  }, []);

  const cancelCaching = useCallback((trackId: string) => {
    if (!trackId) {
      return;
    }
    if (activeCacheTrackIdRef.current === trackId) {
      cacheQueueAbortControllerRef.current?.abort();
      cacheQueueAbortControllerRef.current = null;
      activeCacheTrackIdRef.current = null;
    }
    setCacheProgress((prev) => (prev?.trackId === trackId ? null : prev));
    clearAudioCacheForTrack(trackId).catch(() => {});
  }, []);

  const syncResolvedTrackUrlInState = useCallback(
    (trackId: string, audioUrl: string) => {
      currentPlaylistContextRef.current = currentPlaylistContextRef.current.map(
        (entry) => (entry.id === trackId ? { ...entry, audioUrl } : entry),
      );

      setPlaylist((prev) =>
        prev.map((entry) =>
          entry.id === trackId ? { ...entry, audioUrl } : entry,
        ),
      );
      setCurrentTrack((prev) =>
        prev?.id === trackId ? { ...prev, audioUrl } : prev,
      );
    },
    [],
  );

  const resolveTrackStreamUrl = useCallback(async (track: Track) => {
    if (track.id) {
      const cachedAudioUrl = await getFullyCachedAudioUrl(track.id);
      if (cachedAudioUrl) {
        return cachedAudioUrl;
      }
    }

    if (track.audioUrl?.startsWith("file://")) {
      return track.audioUrl;
    }

    const resolvedSource = resolveTrackSource(track);
    const lookupId =
      resolvedSource === "soundcloud" ? track.url || track.id : track.id;

    if (!lookupId) {
      return track.audioUrl;
    }

    try {
      return await getAudioStreamUrl(
        lookupId,
        undefined,
        resolvedSource,
        track.title,
        track.artist,
        {
          urlHint: track.url,
          providerHint: track.providerHint,
        },
      );
    } catch (error) {
      console.error(
        `[PlayerContext] Failed to resolve stream URL for cache queue: ${track.title}`,
        error,
      );
      return track.audioUrl;
    }
  }, []);

  const publishCacheInfo = useCallback(
    (
      trackId: string,
      info: { percentage: number; fileSize: number; isFullyCached?: boolean },
    ) => {
      setCacheProgress(
        buildCacheProgressState(
          trackId,
          info.percentage,
          info.fileSize,
          info.isFullyCached,
        ),
      );
    },
    [buildCacheProgressState],
  );

  const reconcileFinalCacheInfo = useCallback(
    async (trackId: string) => {
      let latestInfo = await getAudioCacheInfo(trackId);
      publishCacheInfo(trackId, latestInfo);

      // Completion can settle a moment after the download loop returns,
      // especially when the cached file is promoted into persistent storage.
      for (let attempt = 0; attempt < 6; attempt++) {
        if (latestInfo.isFullyCached || latestInfo.percentage >= 100) {
          break;
        }

        if (latestInfo.isDownloading) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        latestInfo = await getAudioCacheInfo(trackId);
        publishCacheInfo(trackId, latestInfo);
      }

      return latestInfo;
    },
    [publishCacheInfo],
  );

  const processLikedSongsCacheQueue = useCallback(async () => {
    if (isCacheQueueProcessingRef.current) {
      return;
    }

    isCacheQueueProcessingRef.current = true;
    const attemptedTrackIds = new Set<string>();

    try {
      while (true) {
        let nextTrackToCache: Track | null = null;
        let initialCacheInfo: {
          percentage: number;
          fileSize: number;
        } | null = null;

        for (const likedTrack of likedSongsRef.current) {
          if (!likedTrack?.id || attemptedTrackIds.has(likedTrack.id)) {
            continue;
          }

          // Skip tracks with incomplete metadata (e.g. restored from cloud sync
          // before enrichment completes) to avoid stalling and network churn.
          if (hasPlaceholderTrackMetadata(likedTrack)) {
            attemptedTrackIds.add(likedTrack.id);
            continue;
          }

          const info = await getAudioCacheInfo(likedTrack.id);
          if (info.isFullyCached || info.isDownloading) {
            continue;
          }

          nextTrackToCache = likedTrack;
          initialCacheInfo = {
            percentage: info.percentage,
            fileSize: info.fileSize,
          };
          break;
        }

        if (!nextTrackToCache) {
          break;
        }

        attemptedTrackIds.add(nextTrackToCache.id);
        activeCacheTrackIdRef.current = nextTrackToCache.id;
        const controller = new AbortController();
        cacheQueueAbortControllerRef.current = controller;

        setCacheProgress(
          buildCacheProgressState(
            nextTrackToCache.id,
            initialCacheInfo?.percentage || 0,
            initialCacheInfo?.fileSize || 0,
          ),
        );

        const streamUrl = await resolveTrackStreamUrl(nextTrackToCache);
        if (!streamUrl || streamUrl.startsWith("file://")) {
          await reconcileFinalCacheInfo(nextTrackToCache.id);
          continue;
        }

        try {
          await continueCachingTrack(
            streamUrl,
            nextTrackToCache.id,
            controller,
          );
        } catch (error) {
          console.error(
            `[PlayerContext] Cache queue failed for ${nextTrackToCache.title}:`,
            error,
          );
        }

        await reconcileFinalCacheInfo(nextTrackToCache.id);

        const finalCacheInfo = await getAudioCacheInfo(nextTrackToCache.id);
        const shouldMonitorRecovery =
          !finalCacheInfo.isFullyCached &&
          !finalCacheInfo.isDownloading &&
          !!streamUrl &&
          (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"));

        if (shouldMonitorRecovery) {
          void monitorAndResumeCache(nextTrackToCache.id, streamUrl);
        }

        cacheQueueAbortControllerRef.current = null;
        activeCacheTrackIdRef.current = null;
      }
    } finally {
      cacheQueueAbortControllerRef.current = null;
      activeCacheTrackIdRef.current = null;
      isCacheQueueProcessingRef.current = false;
    }
  }, [reconcileFinalCacheInfo, resolveTrackStreamUrl]);

  useEffect(() => {
    if (settings.autoCacheLikedSongs) {
      void processLikedSongsCacheQueue();
    }
  }, [likedSongs, processLikedSongsCacheQueue, settings.autoCacheLikedSongs]);

  useEffect(() => {
    if (likedSongs.length === 0 || !settings.autoCacheLikedSongs) {
      return;
    }

    const interval = setInterval(() => {
      void processLikedSongsCacheQueue();
    }, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [
    likedSongs.length,
    processLikedSongsCacheQueue,
    settings.autoCacheLikedSongs,
  ]);

  useEffect(() => {
    lastAppliedCachedUrlRef.current = null;
  }, [currentTrack?.id]);

  useEffect(() => {
    return () => {
      clearPlayStateSuppression();
    };
  }, [clearPlayStateSuppression]);

  useEffect(() => {
    if (activeQueueLength <= 1 && repeatMode === "all") {
      setRepeatModeState("off");
    }
  }, [activeQueueLength, repeatMode]);

  useEffect(() => {
    if (activeQueueLength <= 1 && isShuffled) {
      setIsShuffled(false);
      originalPlaylistRef.current = [];
    }
  }, [activeQueueLength, isShuffled]);

  useEffect(() => {
    if (
      !currentTrack?.id ||
      !currentTrack.audioUrl ||
      currentTrack.audioUrl.startsWith("file://") ||
      cacheProgress?.trackId !== currentTrack.id ||
      cacheProgress.percentage < 100
    ) {
      return;
    }

    const cacheKey = `${currentTrack.id}:${currentTrack.audioUrl}`;
    if (lastAppliedCachedUrlRef.current === cacheKey) {
      return;
    }

    let cancelled = false;

    const switchToFullyCachedFile = async () => {
      try {
        const cachedAudioUrl = await getFullyCachedAudioUrl(currentTrack.id);
        if (
          cancelled ||
          !cachedAudioUrl ||
          cachedAudioUrl === currentTrack.audioUrl
        ) {
          return;
        }

        await trackPlayerService.updateCurrentTrack(cachedAudioUrl);
        if (cancelled) {
          return;
        }

        lastAppliedCachedUrlRef.current = `${currentTrack.id}:${cachedAudioUrl}`;
        syncResolvedTrackUrlInState(currentTrack.id, cachedAudioUrl);

        const info = await getAudioCacheInfo(currentTrack.id);
        if (!cancelled) {
          setCacheProgress(
            buildCacheProgressState(currentTrack.id, 100, info.fileSize, true),
          );
        }
      } catch (error) {
        console.error(
          `[PlayerContext] Failed to switch track ${currentTrack.id} to fully cached file:`,
          error,
        );
      }
    };

    void switchToFullyCachedFile();

    return () => {
      cancelled = true;
    };
  }, [
    cacheProgress?.percentage,
    cacheProgress?.trackId,
    currentTrack?.audioUrl,
    currentTrack?.id,
    syncResolvedTrackUrlInState,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        void processLikedSongsCacheQueue();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [processLikedSongsCacheQueue]);

  const startCacheQueue = useCallback(() => {
    void processLikedSongsCacheQueue();
  }, [processLikedSongsCacheQueue]);

  const removeLikedSong = useCallback(
    (trackId: string) => {
      if (!trackId) {
        return;
      }

      cancelCaching(trackId);
      setLikedSongs((prev) => {
        const updated = prev.filter((song) => song.id !== trackId);
        StorageService.saveLikedSongs(updated).catch((error) => {
          console.error("Error saving liked songs:", error);
        });
        return updated;
      });
    },
    [cancelCaching],
  );

  const stopCachingAndUnlike = useCallback(
    async (trackId: string) => {
      removeLikedSong(trackId);
    },
    [removeLikedSong],
  );

  const setRepeatMode = useCallback(
    (mode: "off" | "one" | "all") => {
      if (activeQueueLength <= 1 && mode === "all") {
        setRepeatModeState("one");
        return;
      }

      setRepeatModeState(mode);
    },
    [activeQueueLength],
  );

  const cycleRepeatMode = useCallback(() => {
    setRepeatModeState((prev) => {
      if (activeQueueLength > 1) {
        return prev === "off" ? "all" : prev === "all" ? "one" : "off";
      }

      return prev === "one" ? "off" : "one";
    });
  }, [activeQueueLength]);

  const nextTrack = useCallback(async () => {
    console.log("[PlayerContext] nextTrack() called");
    console.log(
      `[PlayerContext] Playlist length: ${playlist.length}, current index: ${currentIndex}, repeat mode: ${repeatMode}`,
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

    setIsTransitioning(true);

    try {
      // Handle repeat one mode - replay current track
      if (repeatMode === "one" && currentTrack) {
        console.log(
          "[PlayerContext] nextTrack() - Repeat one mode, replaying current track",
        );
        await playTrack(currentTrack, currentPlaylist, currentIndex);
        return;
      }

      // Handle single song playlist
      if (currentPlaylist.length === 1) {
        console.log("[PlayerContext] nextTrack() - Single song playlist");
        if (repeatMode === "one" || repeatMode === "all") {
          console.log(
            "[PlayerContext] nextTrack() - Single song with repeat, replaying",
          );
          await playTrack(currentTrack!, currentPlaylist, 0);
        }
        return;
      }

      // Match the web player queue behavior:
      // only wrap when repeat-all is enabled.
      const nextIndex = getNextQueueIndex(
        repeatMode,
        currentPlaylist.length,
        currentIndex,
      );
      if (nextIndex < 0) {
        console.log(
          "[PlayerContext] nextTrack() - Reached end of queue with no repeat-all",
        );
        return;
      }

      const nextTrackItem = currentPlaylist[nextIndex];

      if (nextTrackItem) {
        console.log(
          `[PlayerContext] nextTrack() - Playing next track at index ${nextIndex}: ${nextTrackItem.title}`,
        );
        await playTrack(nextTrackItem, currentPlaylist, nextIndex);
      } else {
        console.log(
          `[PlayerContext] nextTrack() - No track found at index ${nextIndex}`,
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
    clearPlayStateSuppression();
    setIsLoading(false);
    setIsTransitioning(false);
    setPlaybackError(null);

    // Stop current playback
    try {
      await trackPlayerService.stop();
    } catch (error) {
      console.log(
        "[PlayerContext] Error stopping playback during cancellation:",
        error,
      );
    }

    // Reset position and cache progress
    setPosition(0);
    setCacheProgress(null);
    setIsPlaying(false);
  }, [clearPlayStateSuppression]);

  const playTrack = useCallback(
    async (track: Track, playlistData: Track[] = [], index: number = 0) => {
      console.log(
        `[PlayerContext] playTrack() called with track: ${track.title}, index: ${index}, playlist length: ${playlistData.length}, isLoading: ${isLoading}, isTransitioning: ${isTransitioning}`,
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
      setPlaybackError(null);

      // Clear audio monitoring from previous track to prevent stale errors
      clearAudioMonitoring();

      try {
        suppressNonPlayingStateTemporarily();
        setIsLoading(true);
        setIsTransitioning(true);

        // Reset position and cache tracking for the new track
        setCacheProgress(null);
        setPosition(0);
        setDuration(track.duration || 0);

        // Set the track immediately so MiniPlayer can appear
        console.log(
          `[PlayerContext] playTrack() - Setting current track: ${track.title}, index: ${index}`,
        );
        setCurrentTrack(track);

        // Update playlist context to reflect the effective playlist
        currentPlaylistContextRef.current = effectivePlaylist;
        setPlaylist(effectivePlaylist);
        setCurrentIndex(effectiveIndex);

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
            error,
          );
        }

        // Get audio URL using the streaming manager
        let audioUrl = track.audioUrl;

        if (track.id) {
          const cachedAudioUrl = await getFullyCachedAudioUrl(track.id);
          if (cachedAudioUrl) {
            audioUrl = cachedAudioUrl;
            console.log(
              `[PlayerContext] Using fully cached local file for track: ${track.title}`,
            );
          }
        }

        if (audioUrl && !audioUrl.startsWith("file://")) {
          console.log(
            `[PlayerContext] Using provided streaming URL as original: ${audioUrl}`,
          );
        }

        if (!audioUrl && track.id) {
          try {
            const resolvedSource = resolveTrackSource(track);
            const lookupId =
              resolvedSource === "soundcloud"
                ? track.url || track.id
                : track.id;

            console.log(
              `[PlayerContext] Getting streaming URL for track: ${track.id} (source: ${resolvedSource})`,
            );

            audioUrl = await getAudioStreamUrl(
              lookupId,
              (status) =>
                console.log(
                  `[PlayerContext] ${resolvedSource} streaming status: ${status}`,
                ),
              resolvedSource,
              track.title,
              track.artist,
              {
                urlHint: track.url,
                providerHint: track.providerHint,
              },
            );
            console.log(
              `[PlayerContext] Got ${resolvedSource} streaming URL: ${audioUrl}`,
            );
          } catch (streamingError) {
            console.error(
              "[PlayerContext] Failed to get streaming URL:",
              streamingError,
            );
            setPlaybackError(
              normalizePlaybackError(
                streamingError instanceof Error
                  ? streamingError.message
                  : String(streamingError),
                track,
              ),
            );
          }
        }

        if (!audioUrl) {
          // Instead of throwing an error, create a placeholder track
          console.warn(
            "[PlayerContext] No audio URL available, creating placeholder",
          );
          setPlaybackError(normalizePlaybackError(null, track));
          // We'll still create the sound object but with a silent/placeholder audio
          // This allows the UI to show the track info even if playback isn't available
        }

        const baseStreamUrl = audioUrl || "";

        // Create new track (with enhanced error handling and fallbacks)
        let finalAudioUrl = audioUrl;
        let isUsingCacheProxy = false;

        if (finalAudioUrl && track.id) {
          const isLiked = likedSongs.some((song) => song.id === track.id);
          if (isLiked) {
            try {
              const cached = await prepareCachedStreamUrl(
                finalAudioUrl,
                track.id,
              );
              finalAudioUrl = cached.url;
              if (cached.cacheInfo) {
                isUsingCacheProxy = cached.url !== baseStreamUrl;
                setCacheProgress(
                  buildCacheProgressState(
                    track.id,
                    cached.cacheInfo.percentage,
                    cached.cacheInfo.fileSize,
                    cached.cacheInfo.isFullyCached,
                  ),
                );
              }
            } catch (error) {
              console.error(
                "[PlayerContext] Error preparing cached stream:",
                error,
              );
            }
          }
        }

        try {
          if (finalAudioUrl) {
            // Pre-resolve audio URLs for ALL tracks in the playlist so they can be added to queue
            // Pre-resolve only the next 3 tracks for fast queue transitions.
            // Resolving ALL tracks blocks playback start for no benefit.
            const PRE_RESOLVE_WINDOW = 3;
            const updatedPlaylist = await Promise.all(
              effectivePlaylist.map(async (playlistTrack, index) => {
                if (index === effectiveIndex) {
                  return { ...playlistTrack, audioUrl: finalAudioUrl };
                }
                // Only pre-resolve the next few tracks, not the entire playlist
                const distanceFromCurrent = index - effectiveIndex;
                if (distanceFromCurrent > 0 && distanceFromCurrent <= PRE_RESOLVE_WINDOW && playlistTrack.id) {
                  try {
                    const resolvedUrl = await getAudioStreamUrl(
                      playlistTrack.id,
                      (status) =>
                        console.log(
                          `[PlayerContext] Pre-resolving ${playlistTrack.title}: ${status}`,
                        ),
                      resolveTrackSource(playlistTrack),
                      playlistTrack.title,
                      playlistTrack.artist,
                      {
                        urlHint: playlistTrack.url,
                        providerHint: playlistTrack.providerHint,
                      },
                    );
                    if (resolvedUrl) {
                      console.log(
                        `[PlayerContext] Pre-resolved audio URL for ${playlistTrack.title}`,
                      );
                      return { ...playlistTrack, audioUrl: resolvedUrl };
                    }
                  } catch (e) {
                    console.log(
                      `[PlayerContext] Failed to pre-resolve ${playlistTrack.title}: ${e}`,
                    );
                  }
                }
                return playlistTrack;
              }),
            );

            if (playRequestId !== playRequestIdRef.current) {
              return;
            }

            console.log(
              "[PlayerContext] Checking TrackPlayer initialization status...",
            );

            await trackPlayerService.addTracks(updatedPlaylist, effectiveIndex);
            await trackPlayerService.play();
            if (playRequestId === playRequestIdRef.current) {
              syncResolvedTrackUrlInState(track.id, finalAudioUrl);
              setIsPlaying(true);
              setPlaybackError(null);
              console.log(
                `[PlayerContext] Playback started for track: ${track.title}`,
              );
            }
          } else {
            console.warn(
              `[PlayerContext] No audio URL available for track: ${track.title}`,
            );
            if (playRequestId === playRequestIdRef.current) {
              clearPlayStateSuppression();
              setIsPlaying(false);
              setPlaybackError(normalizePlaybackError(null, track));
            }
          }

          if (playRequestId === playRequestIdRef.current) {
            setIsLoading(false);
            setCurrentTrack({ ...track, audioUrl: finalAudioUrl });
          }
        } catch (playbackError) {
          console.error(
            "[PlayerContext] Critical error in playback setup:",
            playbackError,
          );

          if (playRequestId === playRequestIdRef.current) {
            clearPlayStateSuppression();
            setIsPlaying(false);
            setIsLoading(false);
            setPlaybackError(
              normalizePlaybackError(
                playbackError instanceof Error
                  ? playbackError.message
                  : String(playbackError),
                track,
              ),
            );
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

        const playedTrackId = track.id;
        const isPlayedTrackLiked = likedSongs.some(
          (song) => song.id === playedTrackId,
        );
        const shouldTrackCacheProgress = () => {
          if (!playedTrackId || !isPlayedTrackLiked || !baseStreamUrl) {
            return false;
          }
          if (isUsingCacheProxy) {
            return true;
          }
          if (currentTrack?.id === playedTrackId && currentTrack.audioUrl) {
            return currentTrack.audioUrl !== baseStreamUrl;
          }
          return false;
        };

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
                  `[PlayerContext] CONFIRMED: ${isYouTubeStream ? "YouTube" : "SoundCloud"} audio cutout at ${position}s - position stuck despite isPlaying=true (threshold: ${threshold}, initialBuffer: ${isInitialBufferPhase})`,
                );
                handleStreamFailure();
                positionStuckCounter = 0;
              } else if (
                positionStuckCounter >= threshold &&
                (isTransitioning || isInitialBufferPhase || position <= 1)
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
            if (track._isSoundCloud && position >= 55 && position < 60) {
              console.log(
                `[PlayerContext] SoundCloud track approaching 1min, preparing for refresh at position: ${position}s`,
              );
              // Could implement pre-emptive refresh here if needed
            }

            lastPosition = position;
          },
        );

        // Add the listener to the cleanup array
        audioMonitoringListenersRef.current.push(progressListener);

        // Set up track end listener for auto-next and post-playback caching
        const queueEndedListener = TrackPlayer.addEventListener(
          Event.PlaybackQueueEnded,
          async (event) => {
            setIsPlaying(false);

            if (playedTrackId && isPlayedTrackLiked) {
              await markAudioCacheComplete(playedTrackId);
              const finalCacheInfo = await getCacheInfo(playedTrackId);
              if (finalCacheInfo?.isFullyCached) {
                setCacheProgress(
                  buildCacheProgressState(
                    playedTrackId,
                    100,
                    finalCacheInfo.fileSize,
                    true,
                  ),
                );
              }
            }

            // Auto play next track when current finishes
            if (!isTransitioning && !isLoading) {
              nextTrackRef.current();
            } else {
              console.log(
                "[PlayerContext] Skipping auto-next due to ongoing transition/loading",
              );
            }
          },
        );

        // Add the listener to the cleanup array
        audioMonitoringListenersRef.current.push(queueEndedListener);
      } catch (error) {
        console.error("[PlayerContext] Error playing track:", error);
        if (playRequestId === playRequestIdRef.current) {
          setIsLoading(false);
          setIsTransitioning(false);
          setIsPlaying(false);
          setPlaybackError(
            normalizePlaybackError(
              error instanceof Error ? error.message : String(error),
              track,
            ),
          );
        }
      } finally {
        if (playRequestId === playRequestIdRef.current) {
          clearPlayStateSuppression();
          setIsTransitioning(false);
        }
      }
    },
    [
      isLoading,
      isTransitioning,
      likedSongs,
      currentTrack,
      getCacheInfo,
      nextTrackRef,
      cancelLoadingState,
      clearPlayStateSuppression,
      suppressNonPlayingStateTemporarily,
      syncResolvedTrackUrlInState,
    ],
  );

  const playPause = useCallback(async () => {
    // Allow retry when a track has failed (no audioUrl or stream failed)
    if (hasStreamFailed && currentTrack) {
      console.log("[PlayerContext] Retrying failed track:", currentTrack.title);
      setHasStreamFailed(false);
      setStreamRetryCount(0);
      await playTrack(currentTrack, playlist, currentIndex);
      return;
    }

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
  }, [
    isPlaying,
    currentTrack?.audioUrl,
    isLoading,
    cancelLoadingState,
    hasStreamFailed,
    currentTrack,
    playlist,
    currentIndex,
    playTrack,
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

    try {
      if (position > 3 && currentTrack) {
        console.log(
          "[PlayerContext] previousTrack() - Restarting current track from current position",
        );
        setPosition(0);
        resetProgressState(0, duration || currentTrack.duration || 0);
        await seekToRef.current(0);
        setPosition(0);
        resetProgressState(0, duration || currentTrack.duration || 0);
        return;
      }

      // Handle repeat one mode - replay current track
      if (repeatMode === "one" && currentTrack) {
        clearAudioMonitoring();
        setIsTransitioning(true);
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
          // Clear audio monitoring only when replaying the track from scratch.
          clearAudioMonitoring();
          setIsTransitioning(true);
          console.log(
            "[PlayerContext] previousTrack() - Single song with repeat, replaying",
          );
          await playTrack(currentTrack!, currentPlaylist, 0);
        } else {
          resetProgressState(0, duration || currentTrack?.duration || 0);
          await seekToRef.current(0);
          setPosition(0);
          resetProgressState(0, duration || currentTrack?.duration || 0);
        }
        return;
      }

      // Match the web player queue behavior:
      // only wrap when repeat-all is enabled.
      let prevIndex = -1;
      if (currentIndex > 0) {
        prevIndex = currentIndex - 1;
      } else if (repeatMode === "all" && currentPlaylist.length > 1) {
        prevIndex = currentPlaylist.length - 1;
      }

      if (prevIndex < 0) {
        console.log(
          "[PlayerContext] previousTrack() - At start of queue with no repeat-all",
        );
        resetProgressState(0, duration || currentTrack?.duration || 0);
        await seekToRef.current(0);
        setPosition(0);
        resetProgressState(0, duration || currentTrack?.duration || 0);
        return;
      }

      // Clear audio monitoring only when we are actually changing tracks.
      clearAudioMonitoring();
      setIsTransitioning(true);

      const prevTrack = currentPlaylist[prevIndex];

      if (prevTrack) {
        console.log(
          `[PlayerContext] previousTrack() - Playing previous track at index ${prevIndex}: ${prevTrack.title}`,
        );
        await playTrack(prevTrack, currentPlaylist, prevIndex);
      } else {
        console.log(
          `[PlayerContext] previousTrack() - No track found at index ${prevIndex}`,
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
    position,
    duration,
    repeatMode,
    clearAudioMonitoring,
    setPosition,
  ]);

  const seekTo = useCallback(
    async (positionSeconds: number) => {
      // #region debug-point D:context-seek
      // #endregion
      console.log(
        `[PlayerContext] seekTo called - positionSeconds: ${positionSeconds}, currentTrack?.audioUrl: ${!!currentTrack?.audioUrl}`,
      );
      if (!currentTrack) {
        console.warn("[PlayerContext] Cannot seek: No current track");
        return;
      }
      try {
        // Store current playing state to restore later
        const wasPlaying = isPlaying;

        // Pause playback during seek to prevent audio from continuing at old position
        if (isPlaying) {
          console.log("[PlayerContext] Pausing playback during seek");
          await trackPlayerService.pause();
          setIsPlaying(false);
        }

        // Verify player is ready before seeking
        const state = await TrackPlayer.getPlaybackState();
        if (state.state === State.None) {
          console.warn(
            "[PlayerContext] Cannot seek: Player not ready (likely still loading)",
          );
          return;
        }

        const safePositionSeconds =
          duration > 0
            ? Math.max(0, Math.min(positionSeconds, duration))
            : Math.max(0, positionSeconds);

        console.log(
          `[PlayerContext] Seeking to positionSeconds: ${safePositionSeconds}`,
        );
        setPosition(safePositionSeconds);
        await trackPlayerService.seekTo(safePositionSeconds);
        setPosition(safePositionSeconds);
        setDuration((prevDuration) =>
          prevDuration > 0 ? prevDuration : currentTrack.duration || 0,
        );
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
      currentTrack?.duration,
      duration,
      isPlaying,
    ],
  );

  useEffect(() => {
    seekToRef.current = seekTo;
  }, [seekTo]);

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
      let newAudioUrl =
        (currentTrack.id && (await getFullyCachedAudioUrl(currentTrack.id))) ||
        currentTrack.audioUrl;

      // Always try to get a fresh URL for SoundCloud tracks (they expire)
      if (newAudioUrl?.startsWith("file://")) {
        console.log(
          "[PlayerContext] Using fully cached local file during recovery",
        );
      } else if (currentTrack.id && currentTrack._isSoundCloud) {
        console.log("[PlayerContext] Getting fresh SoundCloud URL");
        try {
          newAudioUrl = await getAudioStreamUrl(
            currentTrack.url || currentTrack.id,
            undefined,
            "soundcloud",
            currentTrack.title,
            currentTrack.artist,
            {
              urlHint: currentTrack.url,
              providerHint: currentTrack.providerHint,
            },
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
          const resolvedSource = resolveTrackSource(currentTrack);
          const lookupId =
            resolvedSource === "soundcloud"
              ? currentTrack.url || currentTrack.id
              : currentTrack.id;
          newAudioUrl = await getAudioStreamUrl(
            lookupId,
            undefined,
            resolvedSource,
            currentTrack.title,
            currentTrack.artist,
            {
              urlHint: currentTrack.url,
              providerHint: currentTrack.providerHint,
            },
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

        // Update track with new URL and play from previous position
        try {
          await trackPlayerService.updateCurrentTrack(newAudioUrl);
          console.log(
            "[PlayerContext] Updated track in Track Player with new audio URL",
          );

          // Seek to previous position
          if (currentPosition > 0) {
            console.log(
              `[PlayerContext] Seeking to previous position: ${currentPosition}ms`,
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
            error,
          );
        }

        // Update current track with new audio URL
        syncResolvedTrackUrlInState(currentTrack.id, newAudioUrl);

        // Update the track in Track Player
        try {
          await trackPlayerService.updateCurrentTrack(newAudioUrl);
          console.log(
            "[PlayerContext] Updated track in Track Player with new audio URL",
          );
        } catch (error) {
          console.error(
            "[PlayerContext] Failed to update track in Track Player:",
            error,
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
                  "[PlayerContext] Possible cache exhaustion detected, reloading stream...",
                );
                handleStreamFailure();
              }
            } else if (currentPosition > 300 && isTransitioning) {
              console.log(
                "[PlayerContext] Skipping cache exhaustion check during transition",
              );
            }

            lastPosition = currentPosition;
          },
        );

        // Store the listener for cleanup
        audioMonitoringListenersRef.current.push(positionUpdateListener);

        console.log("[PlayerContext] === STREAM RELOADED SUCCESSFULLY ===");
      } else {
        console.warn(
          "[PlayerContext] Could not get fresh audio URL for reload",
        );
      }
    } catch (error) {
      console.error("[PlayerContext] === STREAM RELOAD FAILED ===", error);
    }
  }, [currentTrack, nextTrack, isTransitioning, syncResolvedTrackUrlInState]);

  const clearPlayer = useCallback(async () => {
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
    currentPlaylistContextRef.current = [];
    setPlaylist([]);
    setCurrentIndex(0);
    setShowFullPlayer(false);
    setIsPlaying(false);
    setIsLoading(false);
    setIsTransitioning(false);
    setPosition(0);
    setDuration(0);
    setPlaybackError(null);
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
    const handler = async () => {
      await nextTrackRef.current();
    };
    trackPlayerService.onRemoteNext = handler;
    return () => {
      if (trackPlayerService.onRemoteNext === handler) {
        trackPlayerService.onRemoteNext = undefined;
      }
    };
  }, [nextTrack]);

  useEffect(() => {
    const handler = async () => {
      await previousTrackRef.current();
    };
    trackPlayerService.onRemotePrevious = handler;
    return () => {
      if (trackPlayerService.onRemotePrevious === handler) {
        trackPlayerService.onRemotePrevious = undefined;
      }
    };
  }, [previousTrack]);

  useEffect(() => {
    const handler = async () => {
      await clearPlayerRef.current();
    };
    trackPlayerService.onRemoteStop = handler;
    return () => {
      if (trackPlayerService.onRemoteStop === handler) {
        trackPlayerService.onRemoteStop = undefined;
      }
    };
  }, []);

  // Auto-advance: when a track finishes, move to next in queue
  useEffect(() => {
    const handler = async () => {
      await nextTrackRef.current();
    };
    trackPlayerService.onPlaybackEnd = handler;
    return () => {
      if (trackPlayerService.onPlaybackEnd === handler) {
        trackPlayerService.onPlaybackEnd = undefined;
      }
    };
  }, [nextTrack]);

  useEffect(() => {
    clearPlayerRef.current = clearPlayer;
  }, [clearPlayer]);

  const toggleShuffle = useCallback(() => {
    if (playlist.length <= 1) {
      return;
    }

    const newShuffledState = !isShuffled;
    setIsShuffled(newShuffledState);

    if (newShuffledState && playlist.length > 0) {
      // Save original playlist order
      originalPlaylistRef.current = [...playlist];

      // Create shuffled playlist (excluding current track)
      const currentTrackItem = playlist[currentIndex];
      if (!currentTrackItem) {
        return;
      }
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
      currentPlaylistContextRef.current = shuffledPlaylist;
      setPlaylist(shuffledPlaylist);
      setCurrentIndex(0);
    } else if (!newShuffledState && originalPlaylistRef.current.length > 0) {
      // Restore original playlist order
      const currentTrackItem = playlist[currentIndex];
      const originalIndex = originalPlaylistRef.current.findIndex(
        (track) => track.id === currentTrackItem?.id,
      );

      currentPlaylistContextRef.current = originalPlaylistRef.current;
      setPlaylist(originalPlaylistRef.current);
      setCurrentIndex(originalIndex >= 0 ? originalIndex : 0);
    }
  }, [isShuffled, playlist, currentIndex]);

  const toggleLikeSong = useCallback(
    (track: Track) => {
      if (!track.id) {
        return;
      }

      const isCurrentlyLiked = likedSongsRef.current.some(
        (song) => song.id === track.id,
      );

      if (isCurrentlyLiked) {
        removeLikedSong(track.id);
        return;
      }

      setLikedSongs((prev) => {
        const updatedSongs = [...prev, track];

        StorageService.saveLikedSongs(updatedSongs).catch((error) => {
          console.error("Error saving liked songs:", error);
        });

        return updatedSongs;
      });
    },
    [removeLikedSong],
  );

  const isSongLiked = useCallback(
    (trackId: string) => {
      return likedSongs.some((song) => song.id === trackId);
    },
    [likedSongs],
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
    canSkipNext,
    canSkipPrevious,
    canToggleShuffle,
    colorTheme,
    likedSongs,
    previouslyPlayedSongs,
    cacheProgress,
    isTransitioning,
    streamRetryCount,
    hasStreamFailed,
    position,
    duration,
    playbackError,
    playTrack,
    playPause,
    nextTrack,
    previousTrack,
    seekTo,
    setShowFullPlayer,
    setRepeatMode,
    cycleRepeatMode,
    toggleShuffle,
    clearPlayer,
    handleStreamFailure,
    clearAudioMonitoring,
    cancelLoadingState,
    toggleLikeSong,
    stopCachingAndUnlike,
    isSongLiked,
    getCacheInfo,
    cancelCaching,
    startCacheQueue,
    resetStreamRetryCount: () => setStreamRetryCount(0),
    applyPredefinedTheme,
    clearPlaybackError: () => setPlaybackError(null),
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
