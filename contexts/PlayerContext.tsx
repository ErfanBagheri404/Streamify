import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { AppState } from "react-native";
import TrackPlayer, { State, Event } from "../utils/safeTrackPlayer";
import {
  recordListening,
  flushNow as flushListeningStats,
  PLAY_COUNT_THRESHOLD_MS,
} from "../utils/listeningStats";
import { scrobblerService } from "../services/ScrobblerService";
import { fadeService } from "../services/FadeService";
import {
  computeTrackGainFactor,
  resolveGainSourcePath,
} from "../modules/replayGain";
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
  AudioStreamManager,
  subscribeToAudioCacheProgress,
} from "../modules/audioStreaming";
import {
  cacheTrackThumbnail,
  getCachedThumbnailPath,
} from "../utils/thumbnailCache";

import { StorageService, subscribeToLibraryUpdates } from "../utils/storage";
import { trackPlayerService } from "../services/TrackPlayerService";
import { t } from "../utils/localization";
import { useAppSettings } from "../hooks/useAppSettings";
import { CacheToast } from "../components/ui/CacheToast";
import { QueueConflictModal } from "../components/ui/QueueConflictModal";
import { hasPlaceholderTrackMetadata } from "../lib/cloud-library-sync";
import { normalizeYouTubeThumbnailUrl } from "../components/core/image";
import DrmAudioPlayer, {
  DrmAudioPlayerRef,
} from "../components/DrmAudioPlayer";
import { DrmPlayerBoundary } from "../components/DrmPlayerBoundary";
import { resolveJioSaavnFallback } from "../lib/backend-api";
import {
  getDirectPlayUri,
  isDirectPlayTrack,
  isPodcastTrack,
  normalizeLocalPlaybackTrack,
} from "../modules/localPlayback";

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
  /** Device file played straight from MediaStore; skip stream resolution. */
  _isLocal?: boolean;
  /** Self-hosted Subsonic/Navidrome server track; stream URL is authoritative. */
  _isSubsonic?: boolean;
  /** Podcast episode: the RSS enclosure URL is authoritative. */
  _isPodcast?: boolean;
  /** Resume point in seconds for a podcast episode (#30). */
  _resumeAtSeconds?: number;
  // DRM playback metadata (returned by backend for SoundCloud Widevine tracks)
  audioType?: string;
  drmLicenseUrl?: string;
  drmScheme?: string;
  drmProvider?: string;
  drmHeaders?: Record<string, string>;
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

// ── Cache queue rate limiting ──────────────────────────────────────────
// Process this many liked songs per batch before taking a cooldown break.
const CACHE_BATCH_SIZE = 2;
// Milliseconds to wait between individual songs in a batch (spreads API calls).
const CACHE_SONG_DELAY_MS = 8_000;
// Milliseconds to wait after finishing a batch before starting the next one.
const CACHE_BATCH_COOLDOWN_MS = 180_000;

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
  /** Increments whenever a track finishes caching — library screens listen to this. */
  cacheQueueVersion: number;
  /** Seconds remaining in cooldown, or 0 if not in cooldown. */
  cacheCooldownSeconds: number;
  isTransitioning: boolean;
  streamRetryCount: number;
  hasStreamFailed: boolean;
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

interface PlaybackProgressContextType {
  position: number;
  duration: number;
}

const PlaybackProgressContext = createContext<PlaybackProgressContextType>({
  position: 0,
  duration: 0,
});

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { settings } = useAppSettings();
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDrmPlayback, setIsDrmPlayback] = useState(false);
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
  // Live mirrors of position/duration for callbacks that only need to READ the
  // current value. Callbacks read these refs instead of the state so their
  // dependency arrays (and therefore the memoized context value) stay stable
  // between playback-progress ticks — the per-second re-render of every
  // usePlayer() consumer was the main source of home-screen jank.
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  // The progress event's duration (not the track metadata) — this is the
  // accurate source for crossfade window calculation.
  const progressDurationRef = useRef(0);
  const setPositionStable = useCallback(
    (next: number | ((prev: number) => number)) => {
      positionRef.current =
        typeof next === "function"
          ? next(positionRef.current)
          : Math.max(0, next);
      setPosition(positionRef.current);
    },
    [],
  );
  const setDurationStable = useCallback(
    (next: number | ((prev: number) => number)) => {
      durationRef.current =
        typeof next === "function"
          ? next(durationRef.current)
          : Math.max(0, next);
      setDuration(durationRef.current);
    },
    [],
  );
  const resetProgressState = useCallback(
    (nextPosition = 0, nextDuration?: number) => {
      positionRef.current = Math.max(0, nextPosition);
      setPositionStable(positionRef.current);
      if (typeof nextDuration === "number" && Number.isFinite(nextDuration)) {
        durationRef.current = Math.max(0, nextDuration);
        setDurationStable(durationRef.current);
      }
    },
    [],
  );
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [cacheToast, setCacheToast] = useState<{
    visible: boolean;
    message: string;
  }>({ visible: false, message: "" });
  const [queueConflictModal, setQueueConflictModal] = useState<{
    visible: boolean;
    trackTitle: string;
  }>({ visible: false, trackTitle: "" });
  const [cacheQueueVersion, setCacheQueueVersion] = useState(0);
  const [cacheCooldownSeconds, setCacheCooldownSeconds] = useState(0);
  const queueConflictResolverRef = useRef<
    ((_choice: "cancel" | "play") => void) | null
  >(null);
  const drmPlayerRef = useRef<DrmAudioPlayerRef>(null);
  // DRM watchdog: native Widevine provisioning can hang forever when the
  // device has no route to the SC license server (no VPN). Force an error
  // after a timeout so step-3 (JioSaavn) fallback can run.
  const drmWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which track the active DRM session belongs to. A late onError from
  // a previous DRM attempt must not bleed onto the now-playing track.
  const activeDrmTrackIdRef = useRef<string | null>(null);
  const originalPlaylistRef = useRef<Track[]>([]);
  const currentPlaylistContextRef = useRef<Track[]>([]);
  const streamCheckRef = useRef<{ position: number; time: number } | null>(
    null,
  );
  const seekGuardRef = useRef(0);
  // Listening-stats sampler: position at the last sample, ms credited to the
  // current track so far, and whether this listen has already been counted
  // as a play.
  const statsLastPositionRef = useRef(0);
  const statsAccumulatedMsRef = useRef(0);
  const statsPlayCountedRef = useRef<string | null>(null);
  /** Always points at the active track; drives the telemetry sampler. */
  const activeTrackRef = useRef<Track | null>(null);
  const playRequestIdRef = useRef(0);
  const suppressNonPlayingStateRef = useRef(false);
  const playStateSuppressionTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const likedSongsRef = useRef<Track[]>([]);
  const isCacheQueueProcessingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const manualDownloadRef = useRef(false);
  const canceledTrackIdsRef = useRef(new Set<string>());
  const cacheQueueAbortControllerRef = useRef<AbortController | null>(null);
  /** Last time a podcast resume checkpoint was written (throttle). */
  const podcastCheckpointRef = useRef(0);
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
    positionRef.current > 3 ||
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
        const existing =
          currentTrack && currentTrack.id === id
            ? currentTrack
            : playlist.find((p) => p.id === id);
        const thumbnail =
          existing?.thumbnail ||
          item.thumbnail ||
          item.thumbnailUrl ||
          item.img ||
          item.artwork ||
          item.artworkUrl ||
          "";
        return {
          id,
          title: item.title || existing?.title || "Unknown Title",
          artist:
            item.artist || item.author || existing?.artist || "Unknown Artist",
          duration: item.duration || existing?.duration || 0,
          thumbnail,
          audioUrl: item.url,
          url: (item as any).url,
          source: existing?.source || (item as any).source,
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
      setPositionStable(positionSeconds);
      setDurationStable(durationSeconds || nextCurrentTrack?.duration || 0);
      currentPlaylistContextRef.current = mappedPlaylist;
      setIsInPlaylistContext(mappedPlaylist.length > 1);

      if (audioMonitoringListenersRef.current.length === 0) {
        const progressListener = TrackPlayer.addEventListener(
          Event.PlaybackProgressUpdated,
          (event: any) => {
            setPositionStable(event.position);
            setDurationStable(event.duration);
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

  const syncCurrentTrackFromPlayer = useCallback(
    async (retryCount = 0) => {
      try {
        const queue = await TrackPlayer.getQueue();
        if (!Array.isArray(queue) || queue.length === 0) {
          if (retryCount < 3) {
            await new Promise((r) => setTimeout(r, 300));
            return syncCurrentTrackFromPlayer(retryCount + 1);
          }
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
          if (retryCount < 3) {
            await new Promise((r) => setTimeout(r, 300));
            return syncCurrentTrackFromPlayer(retryCount + 1);
          }
          return;
        }

        const existingTracks =
          currentPlaylistContextRef.current.length > 0
            ? currentPlaylistContextRef.current
            : playlist;

        // When tracks are skipped from the native queue (no audioUrl yet),
        // the queue is shorter than the full playlist.  Use the unfiltered
        // playlist stored by addTracks to preserve all tracks so next/prev
        // navigation still works.  Only rebuild from queue when it matches.
        const fullPlaylist = trackPlayerService.getFullPlaylist();
        const shortQueue =
          fullPlaylist.length > 0 && queue.length < fullPlaylist.length;

        if (shortQueue) {
          // Queue was truncated by addTracks — do NOT clobber the playlist.
          // Queue indices don't match original playlist indices when tracks
          // were skipped, so locate the active track by ID and map back to
          // its ORIGINAL playlist position for next/prev navigation.
          const queueItem = queue[activeTrackIndex];
          const currentTrackId =
            queueItem?.id != null ? String(queueItem.id) : undefined;
          const originalIndex = currentTrackId
            ? fullPlaylist.findIndex((t) => t.id === currentTrackId)
            : -1;
          const baseTrack =
            (originalIndex >= 0 ? fullPlaylist[originalIndex] : null) ??
            existingTracks.find((t) => t.id === currentTrackId);
          const [positionSeconds, durationSeconds] = await Promise.all([
            TrackPlayer.getPosition(),
            TrackPlayer.getDuration(),
          ]);
          const nextCurrentTrack = queueItem
            ? {
                ...baseTrack,
                id: currentTrackId ?? baseTrack?.id,
                title: queueItem.title || baseTrack?.title || "Unknown Title",
                artist:
                  queueItem.artist ||
                  queueItem.author ||
                  baseTrack?.artist ||
                  "Unknown Artist",
                duration:
                  typeof queueItem.duration === "number"
                    ? queueItem.duration
                    : baseTrack?.duration || 0,
                thumbnail:
                  queueItem.artwork ||
                  queueItem.thumbnail ||
                  baseTrack?.thumbnail ||
                  "",
                audioUrl: queueItem.url || baseTrack?.audioUrl,
              }
            : baseTrack;
          if (originalIndex >= 0) {
            setCurrentIndex(originalIndex);
          }
          setCurrentTrack(nextCurrentTrack);
          // Same sync for the telemetry sampler (remapped track).
          activeTrackRef.current = (nextCurrentTrack as Track | null) ?? null;
          statsAccumulatedMsRef.current = 0;
          statsPlayCountedRef.current = null;
          statsLastPositionRef.current = 0;
          setPositionStable(positionSeconds);
          setDurationStable(durationSeconds || nextCurrentTrack?.duration || 0);
          setIsLoading(false);
          setIsTransitioning(false);
          return;
        }

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
              item.artwork ||
              item.thumbnail ||
              item.thumbnailUrl ||
              item.img ||
              existingTrack?.thumbnail ||
              "",
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
        setPositionStable(positionSeconds);
        setDurationStable(durationSeconds || nextCurrentTrack?.duration || 0);
        setIsLoading(false);
        setIsTransitioning(false);
      } catch (error) {
        console.log(
          "[PlayerContext] Failed to sync active track from TrackPlayer:",
          error,
        );
      }
    },
    [playlist],
  );

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
          // Keep telemetry sampler on the active track; reset its window.
          activeTrackRef.current = (nextTrack as Track | null) ?? null;
          statsAccumulatedMsRef.current = 0;
          statsPlayCountedRef.current = null;
          statsLastPositionRef.current = 0;
          // Scrobbler: finalize the outgoing track, start the incoming one.
          // Fire-and-forget on purpose — never blocks the player sync below.
          if (nextTrack?.title) {
            void scrobblerService
              .onTrackChange({
                id: String(nextTrack.id ?? ""),
                title: nextTrack.title,
                artist: nextTrack.artist,
                album: (nextTrack as any).albumName ?? (nextTrack as any).album,
                duration: nextTrack.duration,
              })
              .catch(() => {});
          }
          // Hand volume back to the base level; the new track's fade-in
          // starts from the next progress tick.
          fadeService.reset();
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

  // Load scrobbler credentials (ListenBrainz / Last.fm) once at startup.
  useEffect(() => {
    void scrobblerService.initialize().catch(() => {});
  }, []);

  // Configure fade/crossfade from saved settings at startup.
  useEffect(() => {
    fadeService.configure(
      settings.crossfadeEnabled,
      settings.crossfadeSeconds,
      1,
    );
  }, [settings.crossfadeEnabled, settings.crossfadeSeconds]);

  // ReplayGain: resolve file path and apply gain factor on track change.
  useEffect(() => {
    if (!settings.replayGainEnabled || !currentTrack) {
      fadeService.setTrackGain(1, false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const path = await resolveGainSourcePath(currentTrack.id);
        if (cancelled || !path) return;
        const factor = await computeTrackGainFactor(path, false);
        if (!cancelled) {
          fadeService.setTrackGain(factor, settings.replayGainEnabled);
        }
      } catch {
        if (!cancelled) fadeService.setTrackGain(1, false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id, settings.replayGainEnabled]);

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
    // Only re-probe cache info when the ACTIVE TRACK CHANGES, not on every
    // percentage tick. getCacheInfo has its own 10s memo, and probing it per
    // tick (every second during a download) adds filesystem I/O on the JS
    // thread for data the UI already has from cacheProgress directly.
  }, [cacheProgress?.trackId, currentTrack?.id]);

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
    // Mark as user-canceled so the auto-cache queue won't re-queue it.
    canceledTrackIdsRef.current.add(trackId);
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
    if (isDirectPlayTrack(track)) return getDirectPlayUri(track);

    if (track.id) {
      const cachedAudioUrl = await getFullyCachedAudioUrl(track.id);
      if (cachedAudioUrl) {
        return cachedAudioUrl;
      }
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
    let songsInBatch = 0;

    try {
      while (true) {
        let nextTrackToCache: Track | null = null;
        let initialCacheInfo: {
          percentage: number;
          fileSize: number;
        } | null = null;

        // ── Wait while user is actively playing ────────────────────
        // The cache queue yields completely during playback so the JS
        // thread and network bandwidth go to the player.
        // Skip this wait when the user manually pressed the download button.
        if (!manualDownloadRef.current) {
          while (isPlayingRef.current) {
            await new Promise<void>((resolve) =>
              setTimeout(() => resolve(), 2000),
            );
            if (!isCacheQueueProcessingRef.current) {
              return; // Queue was stopped externally
            }
          }
        }

        // Enforce batch cooldown: after processing CACHE_BATCH_SIZE songs,
        // pause before starting the next batch to reduce API pressure.
        if (songsInBatch >= CACHE_BATCH_SIZE) {
          songsInBatch = 0;
          // Use setInterval so React state updates aren't batched by concurrent mode
          const totalSec = Math.ceil(CACHE_BATCH_COOLDOWN_MS / 1000);
          await new Promise<void>((resolve) => {
            let remaining = totalSec;
            setCacheCooldownSeconds(remaining);
            const timer = setInterval(() => {
              remaining -= 1;
              if (remaining <= 0) {
                clearInterval(timer);
                setCacheCooldownSeconds(0);
                resolve();
              } else {
                setCacheCooldownSeconds(remaining);
              }
            }, 1000);
          });
        }

        // ── Find the next track to cache ──────────────────────────
        // Scan the liked list and pick the first un-cached, un-queued
        // track.  We batch the getAudioCacheInfo calls so each iteration
        // does at most 10 filesystem reads instead of 50+.
        const SCAN_BATCH = 10;
        const tracks = likedSongsRef.current.filter(
          (t) =>
            t?.id &&
            t.title &&
            !isDirectPlayTrack(t) &&
            !attemptedTrackIds.has(t.id) &&
            !canceledTrackIdsRef.current.has(t.id),
        );

        for (let i = 0; i < tracks.length; i += SCAN_BATCH) {
          // Yield between scan batches so UI stays responsive
          if (i > 0) {
            await new Promise<void>((resolve) =>
              setTimeout(() => resolve(), 400),
            );
          }

          const batch = tracks.slice(i, i + SCAN_BATCH);
          const infoResults = await Promise.all(
            batch.map(async (t) => {
              if (hasPlaceholderTrackMetadata(t)) {
                return { track: t, info: null as null };
              }
              const info = await getAudioCacheInfo(t.id);
              return { track: t, info };
            }),
          );

          for (const r of infoResults) {
            if (!r.info) {
              attemptedTrackIds.add(r.track.id);
              continue;
            }
            if (r.info.isFullyCached || r.info.isDownloading) {
              // Already cached or in progress — don't re-probe it on every
              // loop iteration. Without this, a 50-track library re-runs
              // getAudioCacheInfo (7+ filesystem reads each) for every track
              // on every pass, which starves the JS thread and makes the UI
              // unresponsive while the cache queue runs.
              attemptedTrackIds.add(r.track.id);
              continue;
            }
            nextTrackToCache = r.track;
            initialCacheInfo = {
              percentage: r.info.percentage,
              fileSize: r.info.fileSize,
            };
            break;
          }
          if (nextTrackToCache) break;
        }

        if (!nextTrackToCache) {
          break;
        }

        attemptedTrackIds.add(nextTrackToCache.id);
        activeCacheTrackIdRef.current = nextTrackToCache.id;
        const controller = new AbortController();
        cacheQueueAbortControllerRef.current = controller;

        // Resolve the stream URL — yields JS thread naturally.
        // Do this BEFORE setting cacheProgress so failed resolutions
        // don't leave a stale "caching 0%" entry.
        const streamUrl = await resolveTrackStreamUrl(nextTrackToCache);
        if (!streamUrl || streamUrl.startsWith("file://")) {
          await reconcileFinalCacheInfo(nextTrackToCache.id);
          // Yield after each track so UI can repaint
          await new Promise<void>((resolve) =>
            setTimeout(() => resolve(), 100),
          );
          cacheQueueAbortControllerRef.current = null;
          activeCacheTrackIdRef.current = null;
          continue;
        }

        // Abort raced with playback start mid-resolution — drop this
        // track instead of starting a download that the player needs
        // the bandwidth for.
        if (controller.signal.aborted) {
          cacheQueueAbortControllerRef.current = null;
          activeCacheTrackIdRef.current = null;
          continue;
        }

        setCacheProgress(
          buildCacheProgressState(
            nextTrackToCache.id,
            initialCacheInfo?.percentage || 0,
            initialCacheInfo?.fileSize || 0,
          ),
        );

        // Poll AudioStreamManager's in-memory progress and push to React state
        // so LibraryScreen's loadDownloadingTracks fires and shows live percentage.
        const reactProgressPoll = setInterval(() => {
          try {
            const mgr = AudioStreamManager.getInstance();
            const p = (mgr as any).cacheProgress?.get?.(nextTrackToCache.id);
            if (p && typeof p.percentage === "number") {
              setCacheProgress({
                trackId: nextTrackToCache.id,
                percentage: Math.round(p.percentage),
                fileSize:
                  typeof p.lastFileSize === "number"
                    ? Math.round(p.lastFileSize / (1024 * 1024))
                    : typeof p.downloadedSize === "number"
                      ? Math.round(p.downloadedSize / (1024 * 1024))
                      : 0,
              });
            }
          } catch {}
        }, 1000);

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

        // Stop polling — download finished (success or fail)
        clearInterval(reactProgressPoll);

        // Quick reconcile — read cache status once and move on.
        // Don't block the queue on stale AsyncStorage reads.
        let latestInfo = await getAudioCacheInfo(nextTrackToCache.id);
        publishCacheInfo(nextTrackToCache.id, latestInfo);

        const isFullyDone =
          latestInfo.isFullyCached || latestInfo.percentage >= 100;

        if (isFullyDone) {
          // Cache thumbnail for offline use — fire-and-forget
          cacheTrackThumbnail(nextTrackToCache.id, nextTrackToCache.thumbnail);
          // Track completed — show toast and bump version so library refreshes.
          setCacheToast({
            visible: true,
            message: `${nextTrackToCache.title} cached`,
          });
          setCacheQueueVersion((v) => v + 1);
        } else if (
          !latestInfo.isDownloading &&
          !!streamUrl &&
          (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))
        ) {
          // Not done and not downloading — start recovery monitor
          // but don't block the queue; fire-and-forget.
          void monitorAndResumeCache(nextTrackToCache.id, streamUrl);
        }
        // If still downloading, the monitor will handle it. Move on.

        cacheQueueAbortControllerRef.current = null;
        activeCacheTrackIdRef.current = null;
        songsInBatch += 1;

        // Yield a generous gap between songs so UI can process events
        await new Promise<void>((resolve) =>
          setTimeout(() => resolve(), CACHE_SONG_DELAY_MS),
        );
      }
    } finally {
      cacheQueueAbortControllerRef.current = null;
      activeCacheTrackIdRef.current = null;
      isCacheQueueProcessingRef.current = false;
      manualDownloadRef.current = false;
    }
  }, [resolveTrackStreamUrl, publishCacheInfo]);

  // Sync isPlayingRef so the cache queue can check it without depending
  // on the isPlaying state (which would re-create the callback).
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!settings.autoCacheLikedSongs) {
      return;
    }

    // If playback just started, abort the current cache download so the JS
    // thread and network bandwidth go to the player, not the cache queue.
    if (isPlaying && cacheQueueAbortControllerRef.current) {
      cacheQueueAbortControllerRef.current.abort();
      cacheQueueAbortControllerRef.current = null;
      activeCacheTrackIdRef.current = null;
    }

    // Wait until metadata is loaded for all liked songs before caching
    const hasMissingMetadata = likedSongs.some((t) =>
      hasPlaceholderTrackMetadata(t),
    );

    if (!hasMissingMetadata) {
      void processLikedSongsCacheQueue();
    }
  }, [
    likedSongs,
    isPlaying,
    processLikedSongsCacheQueue,
    settings.autoCacheLikedSongs,
  ]);

  useEffect(() => {
    if (likedSongs.length === 0 || !settings.autoCacheLikedSongs) {
      return;
    }

    // Poll less frequently to reduce unnecessary wake-ups.  The cache queue
    // processes continuously while active; this interval only restarts it
    // after the queue drains (e.g. after all tracks are cached or skipped).
    const interval = setInterval(() => {
      void processLikedSongsCacheQueue();
    }, 130_000);

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
      typeof currentTrack.audioUrl !== "string" ||
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
    if (!settings.autoCacheLikedSongs) {
      return;
    }
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active" && settings.autoCacheLikedSongs) {
        void processLikedSongsCacheQueue();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [processLikedSongsCacheQueue, settings.autoCacheLikedSongs]);

  const startCacheQueue = useCallback(() => {
    // Abort any existing queue so this manual trigger restarts fresh
    // instead of silently being ignored by the isCacheQueueProcessingRef guard.
    if (isCacheQueueProcessingRef.current) {
      cacheQueueAbortControllerRef.current?.abort();
      cacheQueueAbortControllerRef.current = null;
      activeCacheTrackIdRef.current = null;
      isCacheQueueProcessingRef.current = false;
    }
    // Do NOT set manualDownloadRef here — the queue must respect the
    // isPlaying guard so it yields the JS thread and bandwidth to the
    // player during playback.  The queue will resume automatically when
    // playback stops.
    // Clear canceled set so manual download can re-queue previously canceled tracks.
    canceledTrackIdsRef.current.clear();
    void processLikedSongsCacheQueue();
  }, []);

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
    setPositionStable(0);
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

      if (!track) {
        console.error(
          "[PlayerContext] playTrack() called with null/undefined track",
        );
        setIsTransitioning(false);
        setIsLoading(false);
        return;
      }

      track = normalizeLocalPlaybackTrack(track);
      if (playlistData.length > 0) {
        // Explicit playlist provided (e.g. search results, album, artist)
        effectivePlaylist = playlistData.map(normalizeLocalPlaybackTrack);
        effectiveIndex = index >= 0 ? index : 0;
      } else {
        // No explicit playlist: treat this track as a single-track playlist
        effectivePlaylist = [track];
        effectiveIndex = 0;
      }

      // Seed the telemetry active-track ref + reset sampler window for the new track.
      activeTrackRef.current = track;
      statsAccumulatedMsRef.current = 0;
      statsPlayCountedRef.current = null;
      statsLastPositionRef.current = 0;
      // Reset stream retry counter when starting a new track
      setStreamRetryCount(0);
      // Reset stream failed flag when starting a new track
      setHasStreamFailed(false);
      setPlaybackError(null);
      // A new (non-DRM) selection must tear down any DRM session left over
      // from the previous track, or DrmAudioPlayer keeps rendering.
      setIsDrmPlayback(false);

      // Clear audio monitoring from previous track to prevent stale errors
      clearAudioMonitoring();

      try {
        suppressNonPlayingStateTemporarily();
        setIsLoading(true);
        setIsTransitioning(true);

        // Cancel any ongoing cache download for this track to prevent
        // FileSystem.write conflicts and native crashes when playing a
        // song that is currently being cached in the background.
        const isFullyCached = track?.audioUrl?.startsWith("file://");
        // Device files and downloads cannot conflict with remote caching.
        let isActivelyCaching = false;
        let isQueuedForCaching = false;
        if (!isDirectPlayTrack(track)) {
          isActivelyCaching = !!(
            track?.id && activeCacheTrackIdRef.current === track.id
          );
          const isLikedSong =
            track?.id && likedSongsRef.current.some((s) => s.id === track.id);
          // Also check actual cache status — a downloaded song may still have its original HTTP URL
          const cacheInfo = track?.id
            ? await getAudioCacheInfo(track.id)
            : null;
          const isReallyCached =
            isFullyCached || cacheInfo?.isFullyCached || false;
          isQueuedForCaching =
            isLikedSong &&
            !isReallyCached &&
            !canceledTrackIdsRef.current.has(track.id);
        }
        if (isActivelyCaching || isQueuedForCaching) {
          if (settings.autoQueueConflictAutoRemove) {
            // Auto-remove mode: just cancel and proceed with playback
            cancelCaching(track.id);
          } else {
            // Ask user mode - show themed modal
            const choice = await new Promise<"cancel" | "play">((resolve) => {
              queueConflictResolverRef.current = resolve;
              setQueueConflictModal({
                visible: true,
                trackTitle: track.title || "",
              });
            });
            setQueueConflictModal({ visible: false, trackTitle: "" });
            queueConflictResolverRef.current = null;
            if (choice === "cancel") {
              setIsLoading(false);
              setIsTransitioning(false);
              return;
            }
            cancelCaching(track.id);
          }
        }

        // Reset position and cache tracking for the new track
        setCacheProgress(null);
        setPositionStable(0);
        setDurationStable(track.duration || 0);

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
        // Podcast episodes are excluded: this list is the music history shown
        // as a shelf, and a two-hour episode does not belong in it.
        if (
          !isPodcastTrack(track) &&
          (track.source === "soundcloud" ||
            track.source === "youtube" ||
            track.source === "jiosaavn" ||
            track._isSoundCloud ||
            track._isJioSaavn ||
            (track.id && track.title)) // Include library tracks that have basic identifying info
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
        // Clear stale DRM state so a previous DRM track's metadata doesn't
        // leak into the next non-DRM track.
        activeDrmTrackIdRef.current = null;
        if (drmWatchdogRef.current) {
          clearTimeout(drmWatchdogRef.current);
          drmWatchdogRef.current = null;
        }
        try {
          const { AudioStreamManager } =
            await import("../modules/audioStreaming");
          AudioStreamManager.getInstance().lastBackendDrm = null as any;
        } catch {}
        try {
          await trackPlayerService.stop();
          // Brief delay to ensure native player fully releases audio
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
          console.log(
            "[PlayerContext] Error stopping current playback:",
            error,
          );
        }
        // Ensure isPlaying is false after stop
        setIsPlaying(false);

        // Get audio URL using the streaming manager
        let audioUrl = track.audioUrl;

        if (track.id && !isDirectPlayTrack(track)) {
          const cachedAudioUrl = await getFullyCachedAudioUrl(track.id);
          if (cachedAudioUrl) {
            audioUrl = cachedAudioUrl;
            console.log(
              `[PlayerContext] Using fully cached local file for track: ${track.title}`,
            );
          }
        }

        if (
          audioUrl &&
          typeof audioUrl === "string" &&
          !audioUrl.startsWith("file://")
        ) {
          console.log(
            `[PlayerContext] Using provided streaming URL as original: ${audioUrl}`,
          );
        }

        if (!audioUrl && track.id && !isDirectPlayTrack(track)) {
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
            // For SoundCloud DRM tracks the backend also returns Widevine
            // license metadata. Stash it on the in-flight track so the
            // DRM-capable player (react-native-video) can consume it.
            // Match on audioType (not URL) since the returned URL may be
            // rewritten by caching/proxy layers downstream.
            try {
              const { AudioStreamManager } =
                await import("../modules/audioStreaming");
              const drm = AudioStreamManager.getInstance().lastBackendDrm;
              if (drm && drm.audioType === "soundcloud-drm") {
                (track as any).audioType = drm.audioType;
                (track as any).drmLicenseUrl = drm.drmLicenseUrl;
                (track as any).drmScheme = drm.drmScheme;
                (track as any).drmProvider = drm.drmProvider;
                (track as any).drmHeaders = drm.drmHeaders;
                console.log(
                  "[PlayerContext] Captured DRM metadata for:",
                  track.title,
                  "license:",
                  drm.drmLicenseUrl?.slice(0, 60),
                );
              }
            } catch {}
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
          const wasJustCanceled = canceledTrackIdsRef.current.has(track.id);
          if (isLiked && !wasJustCanceled) {
            try {
              // If FAST PATH already resolved to a local file, skip
              // prepareCachedStreamUrl entirely — it would re-validate the
              // same file via getBestCachedFilePath + loadAudioCacheIndex
              // for no benefit.
              if (finalAudioUrl.startsWith("file://")) {
                isUsingCacheProxy = true;
              } else {
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
            // Start playback IMMEDIATELY with the current track. Previously the
            // next 3 tracks were pre-resolved (each doing full network strategy
            // resolution, up to 3-10s) BEFORE addTracks/play were called, so the
            // UI froze on the current action until all resolves finished.
            // Now the playlist is built with the current track's URL and queued
            // immediately; the next tracks are resolved in the background after
            // playback has started and their URLs hot-swapped into the queue.
            const PRE_RESOLVE_WINDOW = 3;

            const basePlaylist = effectivePlaylist.map(
              (playlistTrack, index) =>
                index === effectiveIndex
                  ? { ...playlistTrack, audioUrl: finalAudioUrl }
                  : playlistTrack,
            );

            if (playRequestId !== playRequestIdRef.current) {
              return;
            }

            console.log(
              "[PlayerContext] Checking TrackPlayer initialization status...",
            );

            // Set now-playing metadata BEFORE the queue resets, so the
            // lockscreen/notification doesn't go blank during loading.
            try {
              TrackPlayer.updateNowPlayingMetadata({
                id: track.id,
                title: track.title,
                artist: track.artist || "",
                album: "Streamify",
                artwork: track.thumbnail || undefined,
              });
            } catch {}

            // For DRM SoundCloud tracks, bypass RNTP and play via
            // react-native-video (Widevine) instead.
            if (
              track.audioType === "soundcloud-drm" &&
              track.drmLicenseUrl &&
              track.drmScheme
            ) {
              console.log(
                "[PlayerContext] Routing DRM SoundCloud track to react-native-video:",
                track.title,
              );
              setCurrentTrack({
                ...track,
                audioUrl: finalAudioUrl,
              });
              currentPlaylistContextRef.current = basePlaylist;
              setIsDrmPlayback(true);
              setIsPlaying(true);
              setPlaybackError(null);
              // Register a placeholder track in RNTP so the system media
              // notification appears (with artwork, title, artist). The
              // track is kept paused — ExoPlayer can't decode Widevine HLS
              // so we never actually play it through RNTP.
              // First, stop any existing RNTP queue.
              try {
                await TrackPlayer.stop();
                await TrackPlayer.reset();
              } catch {}
              // Add a silent placeholder so the media notification shows
              // artwork + title + artist without triggering ExoPlayer error.
              const placeholderTrack = {
                id: track.id,
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                url: require("../assets/silent.wav") as any,
                title: track.title,
                artist: track.artist || t("screens.artist.unknown_artist"),
                album: "Streamify",
                artwork:
                  (track.source === "youtube" || track.source === "youtubemusic"
                    ? normalizeYouTubeThumbnailUrl({
                        url: track.thumbnail,
                        videoId: track.id,
                        variant: "hqdefault.jpg",
                      }) || track.thumbnail
                    : track.thumbnail) ||
                  (track.id ? getCachedThumbnailPath(track.id) : undefined) ||
                  undefined,
                duration: track.duration || 0,
              } as any;
              try {
                await TrackPlayer.add([placeholderTrack]);
                await TrackPlayer.skip(0);
                // Keep paused — only the metadata matters for the notification.
                await TrackPlayer.pause();
              } catch {}
              // Tag this DRM session and arm a watchdog: if native Widevine
              // provisioning doesn't start within 20s (no VPN / blocked
              // license server), force-fail so JioSaavn fallback kicks in.
              activeDrmTrackIdRef.current = track.id;
              if (drmWatchdogRef.current) {
                clearTimeout(drmWatchdogRef.current);
              }
              drmWatchdogRef.current = setTimeout(() => {
                // Ref-only checks: state vars are stale inside this closure.
                if (activeDrmTrackIdRef.current !== track.id) {
                  return;
                }
                console.error(
                  "[PlayerContext] DRM provisioning timed out — falling back to JioSaavn",
                );
                drmPlayerRef.current?.stop();
                handleDrmFailure(track);
              }, 20000);
              return;
            }

            await trackPlayerService.addTracks(basePlaylist, effectiveIndex);
            await trackPlayerService.play();
            if (playRequestId === playRequestIdRef.current) {
              setIsDrmPlayback(false);
              syncResolvedTrackUrlInState(track.id, finalAudioUrl);
              setIsPlaying(true);
              setPlaybackError(null);
              console.log(
                `[PlayerContext] Playback started for track: ${track.title}`,
              );
              // Podcast resume (#30). Seeking only makes sense once the
              // native player has a real duration, and a position at or past
              // the end is a finished episode, not a resume point.
              const resumeAt = track._resumeAtSeconds;
              if (resumeAt && resumeAt > 0) {
                const duration = track.duration ?? 0;
                if (!duration || resumeAt < duration - 5) {
                  void trackPlayerService
                    .seekTo(resumeAt)
                    .catch(() => {});
                }
              }
            }

            // Background pre-resolve of the next few tracks — never blocks the
            // playback start above. Each resolved URL is written back into the
            // TrackPlayer queue (skipping the now-playing track).
            void (async () => {
              const currentPlayRequestId = playRequestId;
              for (let i = 1; i <= PRE_RESOLVE_WINDOW; i++) {
                const targetIndex = effectiveIndex + i;
                const targetTrack = effectivePlaylist[targetIndex];
                if (
                  !targetTrack?.id ||
                  targetTrack.id === track.id ||
                  playRequestIdRef.current !== currentPlayRequestId
                ) {
                  break;
                }
                if (isDirectPlayTrack(targetTrack)) continue;
                try {
                  const resolvedUrl = await getAudioStreamUrl(
                    targetTrack.id,
                    (status) =>
                      console.log(
                        `[PlayerContext] Pre-resolving ${targetTrack.title}: ${status}`,
                      ),
                    resolveTrackSource(targetTrack),
                    targetTrack.title,
                    targetTrack.artist,
                    {
                      urlHint: targetTrack.url,
                      providerHint: targetTrack.providerHint,
                    },
                  );
                  if (
                    resolvedUrl &&
                    playRequestIdRef.current === currentPlayRequestId
                  ) {
                    console.log(
                      `[PlayerContext] Pre-resolved audio URL for ${targetTrack.title}`,
                    );
                    // Map the original playlist index to the correct queue
                    // position via the index map stored by addTracks.  When
                    // skipped tracks shift queue indices the old
                    // `targetIndex - effectiveIndex` formula targets the
                    // wrong slot.  updateQueuedTrackUrl takes an OFFSET
                    // from the current track, so translate via both mapped
                    // positions.
                    const targetQueueIndex =
                      trackPlayerService.getOriginalIndexToQueueIndex(
                        targetIndex,
                      );
                    const currentQueueIndex =
                      trackPlayerService.getOriginalIndexToQueueIndex(
                        effectiveIndex,
                      );
                    if (targetQueueIndex >= 0 && currentQueueIndex >= 0) {
                      try {
                        await trackPlayerService.updateQueuedTrackUrl(
                          targetQueueIndex - currentQueueIndex,
                          resolvedUrl,
                        );
                      } catch (queueUpdateError) {
                        console.warn(
                          `[PlayerContext] Queue URL update failed for ${targetTrack.title}:`,
                          queueUpdateError,
                        );
                      }
                    } else if (targetQueueIndex === -1) {
                      // Track was skipped from the queue at addTracks time
                      // (no audioUrl yet).  Now that its URL resolved,
                      // insert it into the native queue so auto-advance and
                      // manual next/prev can reach it.
                      try {
                        await trackPlayerService.insertQueuedTrack(
                          targetIndex,
                          resolvedUrl,
                        );
                      } catch (insertError) {
                        console.warn(
                          `[PlayerContext] Queue insert failed for ${targetTrack.title}:`,
                          insertError,
                        );
                      }
                    }
                    // Reflect the resolved URL in playlist state so
                    // playTrack works when the user navigates to it.
                    syncResolvedTrackUrlInState(targetTrack.id, resolvedUrl);
                  }
                } catch (e) {
                  console.log(
                    `[PlayerContext] Failed to pre-resolve ${targetTrack.title}: ${e}`,
                  );
                }
              }
            })();
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
        // Podcast episodes are not liked songs, so they need their own flag
        // for the resume checkpoint below.
        const isPlayedTrackPodcast = isPodcastTrack(track);
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

            // Skip stale progress events that arrive during a seek
            if (seekGuardRef.current > 0) {
              seekGuardRef.current--;
              return;
            }

            // ── Listening-stats sampler ──
            // Credit the elapsed wall time since the last sample, but only
            // when playback is actually moving forward (a stuck position
            // means buffering/silence, not listening).
            const statsTrack = activeTrackRef.current as Track | null;
            if (statsTrack?.id) {
              const deltaMs = Math.round(
                (position - statsLastPositionRef.current) * 1000,
              );
              if (
                deltaMs > 0 &&
                deltaMs < 4000 &&
                isPlayingRef.current &&
                !isTransitioning
              ) {
                statsAccumulatedMsRef.current += deltaMs;
                const accumulated = statsAccumulatedMsRef.current;
                const shouldCountPlay =
                  statsPlayCountedRef.current !== statsTrack.id &&
                  accumulated >= PLAY_COUNT_THRESHOLD_MS;
                void recordListening(
                  {
                    id: statsTrack.id,
                    title: statsTrack.title,
                    artist: statsTrack.artist,
                    albumName:
                      (statsTrack as any).albumName ??
                      (statsTrack as any).album,
                    thumbnail: statsTrack.thumbnail,
                    artistId: statsTrack.artistId,
                    albumId: (statsTrack as any).albumId,
                  },
                  deltaMs,
                  shouldCountPlay,
                );
                // Feed the same verified-played delta to the scrobbler so
                // paused/buffering time can never inflate a scrobble.
                scrobblerService.recordProgress(deltaMs);
                if (shouldCountPlay)
                  statsPlayCountedRef.current = statsTrack.id;
              } else if (deltaMs <= 0) {
                // Track restarted / seeked backwards: reset accumulation.
                statsAccumulatedMsRef.current = 0;
                statsPlayCountedRef.current = null;
              }
            }
            statsLastPositionRef.current = position;
            // ── end sampler ──

            // ── Podcast resume checkpoint (#30) ──
            // Throttled to every 15s: writing storage on every 250ms tick
            // would put ~4 writes/minute on AsyncStorage for no benefit.
            if (playedTrackId && isPlayedTrackPodcast) {
              const now = Date.now();
              if (now - podcastCheckpointRef.current >= 15_000) {
                podcastCheckpointRef.current = now;
                void import("../utils/storage")
                  .then((storage) =>
                    storage.savePodcastEpisodePosition(
                      playedTrackId,
                      Math.floor(position),
                    ),
                  )
                  .catch(() => {});
              }
            }

            // ── Fade / crossfade-lite ──
            // Derived purely from this already-delivered tick; adds no
            // subscription or timer. Cheap integer/float math per 250ms.
            progressDurationRef.current = duration;
            fadeService.onProgress(position, duration);
            // ── end fade ──

            setPositionStable(position);
            setDurationStable(duration);

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

            // Final podcast checkpoint: the throttle above can leave up to
            // 15s unsaved, and a finished episode must not be re-resumed.
            if (playedTrackId && isPlayedTrackPodcast) {
              podcastCheckpointRef.current = 0;
              void import("../utils/storage")
                .then((storage) =>
                  storage.markPodcastEpisodeFinished(playedTrackId),
                )
                .catch(() => {});
            }

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
      settings.autoQueueConflictAutoRemove,
      cancelCaching,
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
        if (isDrmPlayback) {
          drmPlayerRef.current?.pause();
        } else {
          await trackPlayerService.pause();
        }
        setIsPlaying(false);
        console.log("[PlayerContext] Playback paused");
      } else {
        if (isDrmPlayback) {
          drmPlayerRef.current?.play();
        } else {
          await trackPlayerService.play();
        }
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
      if (positionRef.current > 3 && currentTrack) {
        console.log(
          "[PlayerContext] previousTrack() - Restarting current track from current position",
        );
        setPositionStable(0);
        resetProgressState(
          0,
          durationRef.current || currentTrack.duration || 0,
        );
        await seekToRef.current(0);
        setPositionStable(0);
        resetProgressState(
          0,
          durationRef.current || currentTrack.duration || 0,
        );
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
          resetProgressState(
            0,
            durationRef.current || currentTrack?.duration || 0,
          );
          await seekToRef.current(0);
          setPositionStable(0);
          resetProgressState(
            0,
            durationRef.current || currentTrack?.duration || 0,
          );
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
        resetProgressState(
          0,
          durationRef.current || currentTrack?.duration || 0,
        );
        await seekToRef.current(0);
        setPositionStable(0);
        resetProgressState(
          0,
          durationRef.current || currentTrack?.duration || 0,
        );
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
    repeatMode,
    clearAudioMonitoring,
    setPositionStable,
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
        if (isDrmPlayback) {
          drmPlayerRef.current?.seek(positionSeconds);
          setPositionStable(positionSeconds);
          if (isPlaying) {
            drmPlayerRef.current?.play();
            setIsPlaying(true);
          }
          return;
        }

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
          durationRef.current > 0
            ? Math.max(0, Math.min(positionSeconds, durationRef.current))
            : Math.max(0, positionSeconds);

        console.log(
          `[PlayerContext] Seeking to positionSeconds: ${safePositionSeconds}`,
        );
        seekGuardRef.current++;
        const guardId = seekGuardRef.current;
        setPositionStable(safePositionSeconds);
        await trackPlayerService.seekTo(safePositionSeconds);
        if (seekGuardRef.current === guardId) {
          setPositionStable(safePositionSeconds);
        }
        setDurationStable((prevDuration) =>
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
      typeof currentTrack.audioUrl === "string" &&
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
      // reset() is a single native call that atomically stops playback
      // and clears the queue — much faster than stop() + reset() separately.
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
    setPositionStable(0);
    setDurationStable(0);
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
  // ── DRM media notification remote handlers ──────────────────────
  // When DRM is active, route notification play/pause to react-native-video
  // instead of RNTP's ExoPlayer (which can't decode Widevine).
  useEffect(() => {
    if (isDrmPlayback) {
      trackPlayerService.onRemotePlay = () => {
        drmPlayerRef.current?.play();
        setIsPlaying(true);
      };
      trackPlayerService.onRemotePause = () => {
        drmPlayerRef.current?.pause();
        setIsPlaying(false);
      };
    } else {
      trackPlayerService.onRemotePlay = undefined;
      trackPlayerService.onRemotePause = undefined;
    }
    return () => {
      trackPlayerService.onRemotePlay = undefined;
      trackPlayerService.onRemotePause = undefined;
    };
  }, [isDrmPlayback]);

  // ── Foreground resume: refresh expired stream URLs ───────────────
  // YouTube/SoundCloud/JioSaavn signed URLs expire while backgrounded.
  // When the user returns and presses play, the stale URL silently fails.
  // Proactively refresh on foreground resume.
  useEffect(() => {
    const wasBackgrounded = { current: false };
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        wasBackgrounded.current = true;
        // Persist listening stats promptly when leaving the foreground.
        void flushListeningStats();
        // Drain queued scrobbles, but do NOT finalize the in-progress track:
        // playback continues in the background, so the track-change event
        // still owns that scrobble.
        void scrobblerService.flushPendingOnly().catch(() => {});
      }
      if (next === "active" && wasBackgrounded.current) {
        wasBackgrounded.current = false;
        const track = currentTrack;
        if (!track?.id || typeof track.audioUrl !== "string") return;
        if (isDirectPlayTrack(track)) return;
        // Only refresh remote (non-cached) URLs
        if (lastAppliedCachedUrlRef.current) return;
        void (async () => {
          try {
            // Prefer a fully cached local file when one exists.
            const cachedUrl = await getFullyCachedAudioUrl(track.id);
            if (cachedUrl && cachedUrl !== track.audioUrl) {
              // The user may have switched tracks while resolving — never
              // overwrite a different track's URL with this stale result.
              if (activeTrackRef.current?.id !== track.id) return;
              await trackPlayerService.updateCurrentTrack(cachedUrl);
              syncResolvedTrackUrlInState(track.id, cachedUrl);
              return;
            }
            // No cached file: the remote URL may have expired while
            // backgrounded. Resolve a fresh stream from the track's source
            // so resume doesn't start from a dead URL (initial error).
            const resolvedSource = resolveTrackSource(track);
            const lookupId =
              resolvedSource === "soundcloud"
                ? track.url || track.id
                : track.id;
            const freshUrl = await getAudioStreamUrl(
              lookupId,
              () => {},
              resolvedSource,
              track.title,
              track.artist,
              { urlHint: track.url, providerHint: track.providerHint },
            );
            if (freshUrl && freshUrl !== track.audioUrl) {
              if (activeTrackRef.current?.id !== track.id) return;
              await trackPlayerService.updateCurrentTrack(freshUrl);
              syncResolvedTrackUrlInState(track.id, freshUrl);
            }
          } catch {
            // TrackPlayerService's reactive URL refresh handles hard failures.
          }
        })();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [currentTrack?.id, currentTrack?.audioUrl, syncResolvedTrackUrlInState]);

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

      // Trigger immediate caching if auto-cache is enabled
      if (settings.autoCacheLikedSongs) {
        setTimeout(() => {
          void processLikedSongsCacheQueue();
        }, 100); // Small delay to let React state settle
      }
    },
    [
      removeLikedSong,
      settings.autoCacheLikedSongs,
      processLikedSongsCacheQueue,
    ],
  );

  const isSongLiked = useCallback(
    (trackId: string) => {
      return likedSongs.some((song) => song.id === trackId);
    },
    [likedSongs],
  );

  // Shared DRM failure handler: watchdog timeout and DrmAudioPlayer.onError
  const handleDrmFailure = useCallback(
    (failedTrack: Track, rawError?: unknown) => {
      if (drmWatchdogRef.current) {
        clearTimeout(drmWatchdogRef.current);
        drmWatchdogRef.current = null;
      }
      console.error("[PlayerContext] DRM failed for:", failedTrack.title);
      void (async () => {
        try {
          setIsLoading(true);
          const fallback = await resolveJioSaavnFallback(
            failedTrack.title,
            failedTrack.artist,
          );
          if (fallback?.audioUrl) {
            console.log("[PlayerContext] DRM → JioSaavn:", fallback.title);
            // Pass just the single track — no playlist — so the UI shows
            // the correct song instead of resolving to index 0 of the
            // old playlist (which is a different track).
            await playTrack({
              ...failedTrack,
              id: `${failedTrack.id}-jio`,
              audioType: "jiosaavn" as any,
              audioUrl: fallback.audioUrl,
              drmLicenseUrl: undefined,
              drmScheme: undefined,
              drmHeaders: undefined,
            });
            return;
          }
        } catch (e) {
          console.error("[PlayerContext] JioSaavn fallback error:", e);
        }
        setPlaybackError(
          normalizePlaybackError(
            String(
              rawError instanceof Error
                ? rawError.message
                : typeof rawError === "object" &&
                    rawError &&
                    "message" in rawError
                  ? (rawError as any).message
                  : rawError || "DRM playback failed",
            ),
            failedTrack,
          ),
        );
        setIsDrmPlayback(false);
        setIsPlaying(false);
      })();
    },
    [playTrack, normalizePlaybackError],
  );

  // Handle notification responses for media controls
  useEffect(() => {
    // Skip notification handling since expo-notifications is removed
    console.log(
      "[PlayerContext] Notification handling disabled - expo-notifications removed",
    );
    return () => {};
  }, [playPause, nextTrack, previousTrack, clearPlayer]);

  const applyPredefinedTheme = useCallback((themeName: string) => {
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
  }, []);

  const resetStreamRetryCount = useCallback(() => setStreamRetryCount(0), []);
  const clearPlaybackError = useCallback(() => setPlaybackError(null), []);

  const progressValue = useMemo<PlaybackProgressContextType>(
    () => ({ position, duration }),
    [position, duration],
  );

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
    cacheQueueVersion,
    cacheCooldownSeconds,
    isTransitioning,
    streamRetryCount,
    hasStreamFailed,
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
    resetStreamRetryCount,
    applyPredefinedTheme,
    clearPlaybackError,
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoValue = useMemo<PlayerContextType>(
    () => value,
    [
      // exhaustive list of value members
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
      cacheQueueVersion,
      cacheCooldownSeconds,
      isTransitioning,
      streamRetryCount,
      hasStreamFailed,
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
      resetStreamRetryCount,
      applyPredefinedTheme,
      clearPlaybackError,
    ],
  );

  return (
    <>
      <PlayerContext.Provider value={memoValue}>
        <PlaybackProgressContext.Provider value={progressValue}>
          {children}
        </PlaybackProgressContext.Provider>
      </PlayerContext.Provider>
      <CacheToast
        visible={cacheToast.visible}
        message={cacheToast.message}
        onHide={() => setCacheToast({ visible: false, message: "" })}
      />
      <QueueConflictModal
        visible={queueConflictModal.visible}
        trackTitle={queueConflictModal.trackTitle}
        onCancel={() => {
          queueConflictResolverRef.current?.("cancel");
        }}
        onRemoveAndPlay={() => {
          queueConflictResolverRef.current?.("play");
        }}
      />
      {isDrmPlayback && currentTrack?.drmLicenseUrl ? (
        <DrmPlayerBoundary
          key={currentTrack.id}
          onError={(error) => {
            const failedTrack = currentTrack;
            if (
              !failedTrack ||
              activeDrmTrackIdRef.current !== failedTrack.id
            ) {
              return;
            }
            handleDrmFailure(failedTrack, error);
          }}
        >
          <DrmAudioPlayer
            ref={drmPlayerRef}
            track={currentTrack}
            onPlaybackStarted={() => {
              // Provisioning succeeded — cancel the watchdog.
              if (drmWatchdogRef.current) {
                clearTimeout(drmWatchdogRef.current);
                drmWatchdogRef.current = null;
              }
              setIsPlaying(true);
              setIsLoading(false);
            }}
            onProgress={(data) => {
              const currentTime = Number(data?.currentTime) || 0;
              const playableDuration = Number(data?.playableDuration) || 0;
              setPositionStable(currentTime);
              if (playableDuration > 0) {
                setDurationStable(playableDuration);
              }
              // Sync progress into the RNTP placeholder so the media
              // notification timer advances (not stuck at 00:00).
              TrackPlayer.seekTo(currentTime).catch(() => {});
            }}
            onPlaybackError={(error) => {
              console.error("[PlayerContext] DRM playback error:", error);
              const failedTrack = currentTrack;
              // Stale guard: a late error from a previous track must not bleed
              // onto the now-playing track.
              if (
                !failedTrack ||
                activeDrmTrackIdRef.current !== failedTrack.id
              ) {
                console.log(
                  "[PlayerContext] Ignoring stale DRM error for:",
                  failedTrack?.title,
                );
                return;
              }
              handleDrmFailure(failedTrack, error);
            }}
            onPlaybackEnded={() => {
              // Clear the RNTP placeholder track so the notification goes away.
              try {
                TrackPlayer.reset();
              } catch {}
              const currentIdx = currentPlaylistContextRef.current.findIndex(
                (t) => t.id === currentTrack?.id,
              );
              const nextTrack =
                currentPlaylistContextRef.current[currentIdx + 1];
              if (nextTrack) {
                void playTrack(nextTrack, currentPlaylistContextRef.current);
              } else {
                setIsPlaying(false);
                setIsDrmPlayback(false);
              }
            }}
          />
        </DrmPlayerBoundary>
      ) : null}
    </>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};

export const usePlaybackProgress = () => useContext(PlaybackProgressContext);

export default PlayerProvider;
