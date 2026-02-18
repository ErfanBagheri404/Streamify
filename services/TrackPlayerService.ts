import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  IOSCategory,
  IOSCategoryMode,
  IOSCategoryOptions,
  PitchAlgorithm,
  RepeatMode,
  State,
  Track as TrackPlayerTrack,
} from "react-native-track-player";
import { Track } from "../contexts/PlayerContext";
import { StorageService } from "../utils/storage";
import { NativeModules } from "react-native";
import { t } from "../utils/localization";

// Safe fallback for TrackPlayer constants
let TrackPlayerCapability: typeof Capability | null = null;
let TrackPlayerEvent: typeof Event | null = null;

// Try to import constants safely
try {
  if (Capability) {
    TrackPlayerCapability = Capability;
  }
} catch (e) {
  console.warn("[TrackPlayerService] Failed to import Capability constants");
}

try {
  if (Event) {
    TrackPlayerEvent = Event;
  }
} catch (e) {
  console.warn("[TrackPlayerService] Failed to import Event constants");
}

// Safe wrapper functions for TrackPlayer constants
function getSafeCapability(
  capabilityName: keyof typeof Capability
): Capability {
  if (TrackPlayerCapability && TrackPlayerCapability[capabilityName]) {
    return TrackPlayerCapability[capabilityName];
  }
  return Capability[capabilityName];
}

function getSafeEvent(eventName: keyof typeof Event): Event {
  if (TrackPlayerEvent && TrackPlayerEvent[eventName]) {
    return TrackPlayerEvent[eventName];
  }
  return Event[eventName as keyof typeof Event];
}

// TurboModule compatibility setup function
function setupTurboModuleCompatibility() {
  try {
    // Check if native module is available (avoids '...setupPlayer of null' errors)
    const nativeTrackPlayer =
      (NativeModules as any).TrackPlayerModule ||
      (NativeModules as any).TrackPlayer;

    if (!nativeTrackPlayer) {
      throw new Error(
        "Native TrackPlayer module is not available. If you are using Expo, make sure you are *not* running in Expo Go and that you have rebuilt the app after installing react-native-track-player."
      );
    }

    // TurboModule compatibility check - disable synchronous methods that cause issues
    if (
      nativeTrackPlayer &&
      typeof nativeTrackPlayer.getConstants === "function"
    ) {
      try {
        // Temporarily disable synchronous methods that might cause TurboModule issues
        const originalGetConstants = nativeTrackPlayer.getConstants;
        nativeTrackPlayer.getConstants = function () {
          try {
            return originalGetConstants.call(this);
          } catch (e) {
            console.warn(
              "[TrackPlayerService] getConstants failed, returning empty object"
            );
            return {};
          }
        };
      } catch (e) {
        console.warn(
          "[TrackPlayerService] Failed to wrap native module methods:",
          e
        );
      }
    }
  } catch (e) {
    console.warn(
      "[TrackPlayerService] Failed to setup TurboModule compatibility:",
      e
    );
  }
}

export class TrackPlayerService {
  private static instance: TrackPlayerService;
  private isSetup = false;
  private setupPromise: Promise<void> | null = null;
  private currentTrackIndex = 0;
  private playlist: Track[] = [];
  public onError?: (error: any) => void;
  public onRemoteNext?: () => Promise<void> | void;
  public onRemotePrevious?: () => Promise<void> | void;

  static getInstance(): TrackPlayerService {
    if (!TrackPlayerService.instance) {
      try {
        // Setup TurboModule compatibility before creating instance
        setupTurboModuleCompatibility();
        TrackPlayerService.instance = new TrackPlayerService();
      } catch (error) {
        console.error(
          "[TrackPlayerService] Failed to create TrackPlayerService instance:",
          error
        );
        throw error;
      }
    }
    return TrackPlayerService.instance;
  }

  private constructor() {
    // Private constructor for singleton pattern
  }

  private async ensureTrackPlayerReady(): Promise<void> {
    // Check if TrackPlayer is available and initialized
    if (!TrackPlayer) {
      throw new Error(
        "TrackPlayer is not available - make sure react-native-track-player is properly installed"
      );
    }

    // Check if native module is available (avoids '...setupPlayer of null' errors)
    const nativeTrackPlayer =
      (NativeModules as any).TrackPlayerModule ||
      (NativeModules as any).TrackPlayer;

    if (!nativeTrackPlayer) {
      throw new Error(
        "Native TrackPlayer module is not available. If you are using Expo, make sure you are *not* running in Expo Go and that you have rebuilt the app after installing react-native-track-player."
      );
    }

    // TurboModule compatibility check - disable synchronous methods that cause issues
    if (
      nativeTrackPlayer &&
      typeof nativeTrackPlayer.getConstants === "function"
    ) {
      try {
        // Temporarily disable synchronous methods that might cause TurboModule issues
        const originalGetConstants = nativeTrackPlayer.getConstants;
        nativeTrackPlayer.getConstants = function () {
          try {
            return originalGetConstants.call(this);
          } catch (e) {
            console.warn(
              "[TrackPlayerService] getConstants failed, returning empty object"
            );
            return {};
          }
        };
      } catch (e) {
        console.warn(
          "[TrackPlayerService] Failed to wrap native module methods:",
          e
        );
      }
    }

    // Check if TrackPlayer is properly initialized
    try {
      // Try to get current state to verify initialization
      const state = await TrackPlayer.getState();
      console.log("[TrackPlayerService] TrackPlayer state check:", state);
    } catch (error) {
      console.warn(
        "[TrackPlayerService] TrackPlayer not ready, attempting setup..."
      );
      await this.setupPlayer();
    }
  }

  async setupPlayer() {
    if (this.isSetup) {
      return;
    }

    // If setup is already in progress, wait for it to complete
    if (this.setupPromise) {
      return await this.setupPromise;
    }

    // Create a new setup promise to prevent concurrent initialization
    this.setupPromise = this.performSetup();

    try {
      await this.setupPromise;
    } finally {
      this.setupPromise = null;
    }
  }

  private async performSetup() {
    try {
      console.log("[TrackPlayerService] Setting up TrackPlayer...");

      // Check if TrackPlayer JS wrapper is available
      if (!TrackPlayer) {
        console.error("[TrackPlayerService] TrackPlayer is null!");
        throw new Error(
          "TrackPlayer is not available - make sure react-native-track-player is properly installed"
        );
      }

      // Check if Capability constants are available
      if (!Capability) {
        console.warn(
          "[TrackPlayerService] Capability constants are null, using string fallbacks"
        );
      } else {
        console.log(
          "[TrackPlayerService] Capability constants available:",
          Object.keys(Capability)
        );
        // Test individual capabilities to ensure they're not null
        try {
          const testCapabilities = [
            getSafeCapability("Play" as keyof typeof Capability),
            getSafeCapability("Pause" as keyof typeof Capability),
            getSafeCapability("SkipToNext" as keyof typeof Capability),
            getSafeCapability("SkipToPrevious" as keyof typeof Capability),
          ];
          console.log(
            "[TrackPlayerService] All capability fallbacks working correctly"
          );
        } catch (error) {
          console.error(
            "[TrackPlayerService] Error testing capability fallbacks:",
            error
          );
        }
      }

      // Check if native module behind TrackPlayer is available
      const nativeTrackPlayer =
        (NativeModules as any).TrackPlayerModule ||
        (NativeModules as any).TrackPlayer;

      if (!nativeTrackPlayer) {
        console.error(
          "[TrackPlayerService] Native TrackPlayer module is null - this usually means the native module is not linked or you are running in an environment (like Expo Go or web) that does not support react-native-track-player."
        );
        throw new Error(
          "Native TrackPlayer module is not available. Rebuild the app after installing react-native-track-player and avoid running in Expo Go."
        );
      }

      // Additional TurboModule compatibility check before setup
      try {
        // Test if the native module responds to basic calls
        if (typeof nativeTrackPlayer.getConstants === "function") {
          const constants = nativeTrackPlayer.getConstants();
          console.log(
            "[TrackPlayerService] TrackPlayer constants available:",
            !!constants
          );
        }
      } catch (turboError) {
        console.warn(
          "[TrackPlayerService] TurboModule compatibility issue detected, continuing with setup..."
        );
        // Continue with setup even if there are TurboModule issues
      }

      console.log(
        "[TrackPlayerService] TrackPlayer object type:",
        typeof TrackPlayer
      );
      console.log(
        "[TrackPlayerService] TrackPlayer methods:",
        Object.getOwnPropertyNames(TrackPlayer)
          .filter((name) => typeof (TrackPlayer as any)[name] === "function")
          .slice(0, 10)
      );

      // Add a small delay to ensure native module is ready during development reload
      await new Promise((resolve) => setTimeout(resolve, 100));

      await TrackPlayer.setupPlayer({
        maxCacheSize: 1024 * 50, // 50MB cache for better streaming
        iosCategory: IOSCategory.Playback,
        iosCategoryMode: IOSCategoryMode.Default,
        iosCategoryOptions: [
          IOSCategoryOptions.AllowAirPlay,
          IOSCategoryOptions.AllowBluetoothA2DP,
        ],
        // Better buffering for streaming - more conservative for YouTube
        minBuffer: 10, // 10 seconds minimum buffer (reduced from 15)
        maxBuffer: 60, // 60 seconds maximum buffer
        playBuffer: 2, // 2 seconds play buffer (reduced from 5)
        backBuffer: 5, // 5 seconds back buffer (reduced from 10)
        // Additional streaming options
        waitForBuffer: true, // Wait for buffer before playing
        autoUpdateMetadata: false, // Don't auto-update metadata for streams
        // Enable automatic interruption handling
        autoHandleInterruptions: false,
      });
      console.log(
        "[TrackPlayerService] TrackPlayer setup completed successfully"
      );

      // Build capabilities array safely
      const capabilities = [];
      const compactCapabilities = [];
      const notificationCapabilities = [];

      // Only use actual Capability constants if they're available
      if (TrackPlayerCapability) {
        try {
          capabilities.push(
            TrackPlayerCapability.Play,
            TrackPlayerCapability.Pause,
            TrackPlayerCapability.SkipToNext,
            TrackPlayerCapability.SkipToPrevious,
            TrackPlayerCapability.Stop,
            TrackPlayerCapability.SeekTo
          );
          compactCapabilities.push(
            TrackPlayerCapability.Play,
            TrackPlayerCapability.Pause,
            TrackPlayerCapability.SkipToNext,
            TrackPlayerCapability.SkipToPrevious
          );
          notificationCapabilities.push(
            TrackPlayerCapability.Play,
            TrackPlayerCapability.Pause,
            TrackPlayerCapability.SkipToNext,
            TrackPlayerCapability.SkipToPrevious
          );
        } catch (error) {
          console.warn(
            "[TrackPlayerService] Error accessing capability constants, using fallbacks"
          );
        }
      }

      // If no capabilities were added (constants are null), use string fallbacks
      if (capabilities.length === 0) {
        capabilities.push(
          "play",
          "pause",
          "skipToNext",
          "skipToPrevious",
          "stop",
          "seekTo"
        );
        compactCapabilities.push(
          "play",
          "pause",
          "skipToNext",
          "skipToPrevious"
        );
        notificationCapabilities.push(
          "play",
          "pause",
          "skipToNext",
          "skipToPrevious"
        );
      }

      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          alwaysPauseOnInterruption: true,
        },
        // This is the key for proper media session integration
        // The service will automatically handle media session creation
        progressUpdateEventInterval: 0.25,
        capabilities,
        compactCapabilities,
        notificationCapabilities,
      });

      this.setupEventListeners();
      this.isSetup = true;
      console.log("[TrackPlayerService] Player setup completed");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to setup player:", error);
      throw error;
    }
  }

  private setupEventListeners() {
    TrackPlayer.addEventListener(
      getSafeEvent("RemotePlay" as keyof typeof Event),
      () => {
        TrackPlayer.play();
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("RemotePause" as keyof typeof Event),
      () => {
        TrackPlayer.pause();
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("RemoteStop" as keyof typeof Event),
      () => {
        TrackPlayer.stop();
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("RemoteNext" as keyof typeof Event),
      () => {
        if (this.onRemoteNext) {
          Promise.resolve(this.onRemoteNext()).catch((error) => {
            console.error(
              "[TrackPlayerService] Remote next handler failed:",
              error
            );
          });
          return;
        }
        this.skipToNext().catch((error) => {
          console.error("[TrackPlayerService] Failed to skip to next:", error);
        });
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("RemotePrevious" as keyof typeof Event),
      () => {
        if (this.onRemotePrevious) {
          Promise.resolve(this.onRemotePrevious()).catch((error) => {
            console.error(
              "[TrackPlayerService] Remote previous handler failed:",
              error
            );
          });
          return;
        }
        this.skipToPrevious().catch((error) => {
          console.error(
            "[TrackPlayerService] Failed to skip to previous:",
            error
          );
        });
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("RemoteSeek" as keyof typeof Event),
      (event: any) => {
        TrackPlayer.seekTo(event.position);
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("PlaybackQueueEnded" as keyof typeof Event),
      (event: any) => {
        console.log("[TrackPlayerService] Playback queue ended:", event);
        // Handle queue end - could repeat playlist or stop
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("PlaybackTrackChanged" as keyof typeof Event),
      (event: any) => {
        console.log("[TrackPlayerService] Playback track changed:", event);
        this.currentTrackIndex = event.nextTrack;
      }
    );

    TrackPlayer.addEventListener(
      getSafeEvent("PlaybackError" as keyof typeof Event),
      (event: any) => {
        console.error("[TrackPlayerService] Playback error:", event);

        const currentTrack = this.playlist[this.currentTrackIndex];

        if (
          currentTrack &&
          currentTrack.audioUrl &&
          (currentTrack.audioUrl.includes("googlevideo.com") ||
            currentTrack.audioUrl.includes("youtube.com"))
        ) {
          console.error(
            `[TrackPlayerService] YouTube stream error for track: ${currentTrack.title}`
          );
          console.error(
            `[TrackPlayerService] YouTube URL: ${currentTrack.audioUrl.substring(0, 100)}...`
          );

          if (event?.message?.includes("403") || event?.code === 403) {
            console.error(
              "[TrackPlayerService] YouTube URL expired (403 Forbidden) - needs refresh"
            );
          } else if (event?.message?.includes("404") || event?.code === 404) {
            console.error(
              "[TrackPlayerService] YouTube URL not found (404) - stream may be removed"
            );
          } else if (
            event?.message?.includes("Network") ||
            event?.message?.includes("Connection")
          ) {
            console.error(
              "[TrackPlayerService] Network error during YouTube playback"
            );
          }
        }

        const message: string =
          typeof event?.message === "string" ? event.message.toLowerCase() : "";
        const code = event?.code;

        const isCorruptOrMissingSource =
          code === 404 ||
          code === 415 ||
          message.includes("404") ||
          message.includes("not found") ||
          message.includes("unsupported") ||
          message.includes("format") ||
          message.includes("decoder") ||
          message.includes("corrupt");

        if (isCorruptOrMissingSource) {
          console.warn(
            "[TrackPlayerService] Detected corrupt or missing source, attempting to skip to next track"
          );
          this.skipToNext().catch((skipError) => {
            console.error(
              "[TrackPlayerService] Failed to skip to next after corrupt source:",
              skipError
            );
            TrackPlayer.stop().catch(() => {});
          });
          return;
        }

        if (this.onError) {
          this.onError(event);
        }
      }
    );
  }

  private async validateYouTubeUrl(url: string): Promise<boolean> {
    if (!url) {
      console.warn("[TrackPlayerService] YouTube URL validation: empty URL");
      return false;
    }
    // Assume non-empty googlevideo/youtube URLs are usable; rely on playback errors for real failures
    return true;
  }

  private convertTrackToTrackPlayer(
    track: Track,
    index: number
  ): TrackPlayerTrack {
    const headers: { [key: string]: string } = {};
    const url = track.audioUrl || "";

    // Validate URL - throw error if empty to prevent TrackPlayer from failing
    if (!url) {
      throw new Error(`Track ${track.title} (${track.id}) has no audio URL`);
    }

    const isYouTubeStream =
      track.source === "youtube" ||
      url.includes("googlevideo.com") ||
      url.includes("youtube.com");

    if (isYouTubeStream) {
      Object.assign(headers, {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Referer: "https://www.youtube.com/",
        Origin: "https://www.youtube.com/",
      });
    }

    // Add JioSaavn-specific headers if needed
    if (track._isJioSaavn) {
      Object.assign(headers, {
        "User-Agent": "JioSaavn/1.0",
        Accept: "audio/*",
      });
    }

    let contentType: string | undefined;
    if (isYouTubeStream && url) {
      const mimeMatch = url.match(/[?&]mime=([^&]+)/);
      if (mimeMatch && mimeMatch[1]) {
        try {
          contentType = decodeURIComponent(mimeMatch[1]);
        } catch {
          contentType = mimeMatch[1];
        }
      }
    }

    return {
      id: track.id,
      url,
      title: track.title,
      artist: track.artist || t("screens.artist.unknown_artist"),
      album: "Streamify", // Add album for better notification display
      artwork: track.thumbnail || "",
      duration: track.duration || 0,
      headers: headers,
      userAgent: isYouTubeStream
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        : undefined,
      contentType,
      pitchAlgorithm: PitchAlgorithm.Linear,
      ...(track.source && { source: track.source }),
      ...(track._isSoundCloud && { _isSoundCloud: track._isSoundCloud }),
      ...(track._isJioSaavn && { _isJioSaavn: track._isJioSaavn }),
    };
  }

  async addTracks(tracks: Track[], startIndex: number = 0) {
    try {
      console.log(
        "[TrackPlayerService] addTracks called, isSetup:",
        this.isSetup
      );

      // Ensure player is initialized and ready before adding tracks
      await this.ensureTrackPlayerReady();

      console.log(
        "[TrackPlayerService] Player setup complete, proceeding with addTracks"
      );

      // Validate YouTube URLs before adding tracks
      console.log("[TrackPlayerService] Validating YouTube URLs...");
      const validatedTracks = await Promise.all(
        tracks.map(async (track) => {
          if (
            track.audioUrl &&
            (track.source === "youtube" ||
              track.audioUrl.includes("googlevideo.com"))
          ) {
            const isValid = await this.validateYouTubeUrl(track.audioUrl);
            if (!isValid) {
              console.warn(
                `[TrackPlayerService] YouTube URL validation failed for track: ${track.title}`
              );
              return {
                ...track,
                audioUrl: undefined, // Mark as invalid
              };
            }
          }
          return track;
        })
      );

      const playableTracks: Track[] = [];
      const playableIndexMap: number[] = [];

      validatedTracks.forEach((track, index) => {
        if (track.audioUrl) {
          playableTracks.push(track);
          playableIndexMap.push(index);
        } else {
          console.warn(
            `[TrackPlayerService] Skipping track without audio URL: ${track.title} (${track.id})`
          );
        }
      });

      if (playableTracks.length === 0) {
        throw new Error(
          "[TrackPlayerService] No playable tracks with audioUrl to add"
        );
      }

      let adjustedStartIndex = playableIndexMap.indexOf(startIndex);
      if (adjustedStartIndex === -1) {
        adjustedStartIndex = 0;
      }

      const trackPlayerTracks = playableTracks.map((track, index) =>
        this.convertTrackToTrackPlayer(track, index)
      );

      console.log("[TrackPlayerService] About to call TrackPlayer.reset()");

      try {
        await TrackPlayer.reset();
        console.log(
          "[TrackPlayerService] TrackPlayer.reset() completed successfully"
        );
      } catch (resetError) {
        console.error(
          "[TrackPlayerService] TrackPlayer.reset() failed:",
          resetError
        );
        // Continue even if reset fails
      }

      // Add tracks to the player
      console.log("[TrackPlayerService] Adding tracks to TrackPlayer...");
      await TrackPlayer.add(trackPlayerTracks);
      console.log("[TrackPlayerService] Tracks added successfully");

      this.playlist = [...playableTracks];
      this.currentTrackIndex = adjustedStartIndex;

      if (adjustedStartIndex > 0) {
        console.log(
          `[TrackPlayerService] Skipping to track index: ${adjustedStartIndex}`
        );
        await TrackPlayer.skip(adjustedStartIndex);
      }

      console.log("[TrackPlayerService] addTracks completed successfully");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to add tracks:", error);
      throw error;
    }
  }

  async play() {
    try {
      await this.ensureTrackPlayerReady();

      // Get current track to check if it's a YouTube stream
      const currentTrackIndex = await TrackPlayer.getCurrentTrack();
      if (currentTrackIndex !== null && this.playlist[currentTrackIndex]) {
        const currentTrack = this.playlist[currentTrackIndex];
        const isYouTubeStream =
          currentTrack.audioUrl &&
          (currentTrack.audioUrl.includes("googlevideo.com") ||
            currentTrack.audioUrl.includes("youtube.com"));

        if (isYouTubeStream) {
          console.log(
            "[TrackPlayerService] YouTube stream detected, adding safety delay..."
          );
          // Add a small delay for YouTube streams to initialize properly
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Validate the YouTube URL before playing
          const isValid = await this.validateYouTubeUrl(currentTrack.audioUrl);
          if (!isValid) {
            console.error(
              "[TrackPlayerService] YouTube URL validation failed before playback"
            );
            throw new Error("YouTube stream URL is no longer valid");
          }
        }
      }

      await TrackPlayer.play();
      console.log("[TrackPlayerService] Playback started");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to play:", error);
      throw error;
    }
  }

  async pause() {
    try {
      await this.ensureTrackPlayerReady();
      await TrackPlayer.pause();
      console.log("[TrackPlayerService] Playback paused");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to pause:", error);
      throw error;
    }
  }

  async stop() {
    try {
      await this.ensureTrackPlayerReady();
      await TrackPlayer.stop();
      console.log("[TrackPlayerService] Playback stopped");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to stop:", error);
      throw error;
    }
  }

  async seekTo(position: number) {
    try {
      await TrackPlayer.seekTo(position);
      console.log("[TrackPlayerService] Seeked to position:", position);
    } catch (error) {
      console.error("[TrackPlayerService] Failed to seek:", error);
      throw error;
    }
  }

  async skipToNext() {
    try {
      await this.ensureTrackPlayerReady();
      await TrackPlayer.skipToNext();
      console.log("[TrackPlayerService] Skipped to next track");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to skip to next:", error);
      throw error;
    }
  }

  async skipToPrevious() {
    try {
      await this.ensureTrackPlayerReady();
      await TrackPlayer.skipToPrevious();
      console.log("[TrackPlayerService] Skipped to previous track");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to skip to previous:", error);
      throw error;
    }
  }

  async skipToTrack(index: number) {
    try {
      await this.ensureTrackPlayerReady();
      await TrackPlayer.skip(index);
      this.currentTrackIndex = index;
      console.log(`[TrackPlayerService] Skipped to track index: ${index}`);
    } catch (error) {
      console.error("[TrackPlayerService] Failed to skip to track:", error);
      throw error;
    }
  }

  async getCurrentTrack(): Promise<Track | null> {
    try {
      const currentTrackIndex = await TrackPlayer.getCurrentTrack();
      if (
        currentTrackIndex !== null &&
        currentTrackIndex < this.playlist.length
      ) {
        return this.playlist[currentTrackIndex];
      }
      return null;
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get current track:", error);
      return null;
    }
  }

  async updateCurrentTrack(audioUrl: string): Promise<void> {
    try {
      const currentTrackIndex = await TrackPlayer.getCurrentTrack();
      if (
        currentTrackIndex !== null &&
        currentTrackIndex < this.playlist.length
      ) {
        // Validate YouTube URL before updating
        const isYouTubeStream =
          audioUrl &&
          (audioUrl.includes("googlevideo.com") ||
            audioUrl.includes("youtube.com"));

        if (isYouTubeStream) {
          console.log(
            "[TrackPlayerService] Validating YouTube URL before track update..."
          );
          const isValid = await this.validateYouTubeUrl(audioUrl);
          if (!isValid) {
            throw new Error(
              "Cannot update track: YouTube URL is no longer valid"
            );
          }
          console.log("[TrackPlayerService] YouTube URL validation passed");
        }

        // Update the current track's audio URL
        const updatedTrack = {
          ...this.playlist[currentTrackIndex],
          audioUrl,
        };
        this.playlist[currentTrackIndex] = updatedTrack;

        // Get current position before updating
        const currentPosition = await this.getPosition();

        // Remove current track and re-add with new URL
        await TrackPlayer.remove(currentTrackIndex);
        await TrackPlayer.add([
          this.convertTrackToTrackPlayer(updatedTrack, currentTrackIndex),
        ]);

        // Seek back to previous position
        await TrackPlayer.seekTo(currentPosition);

        console.log(
          "[TrackPlayerService] Updated current track with new audio URL"
        );
      }
    } catch (error) {
      console.error(
        "[TrackPlayerService] Failed to update current track:",
        error
      );
      throw error;
    }
  }

  async reset(): Promise<void> {
    try {
      // Stop playback
      await this.stop();

      // Clear the playlist
      this.playlist = [];
      this.currentTrackIndex = 0;

      // Remove all tracks from the queue
      const queue = await TrackPlayer.getQueue();
      if (queue.length > 0) {
        await TrackPlayer.remove([...Array(queue.length).keys()]);
      }

      console.log("[TrackPlayerService] Reset completed");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to reset:", error);
      throw error;
    }
  }

  async getPosition(): Promise<number> {
    try {
      return await TrackPlayer.getPosition();
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get position:", error);
      return 0;
    }
  }

  async getDuration(): Promise<number> {
    try {
      return await TrackPlayer.getDuration();
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get duration:", error);
      return 0;
    }
  }

  async getState(): Promise<State> {
    try {
      return await TrackPlayer.getState();
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get state:", error);
      return State.None;
    }
  }

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    try {
      await TrackPlayer.setRepeatMode(mode);
      console.log(`[TrackPlayerService] Set repeat mode to: ${mode}`);
    } catch (error) {
      console.error("[TrackPlayerService] Failed to set repeat mode:", error);
      throw error;
    }
  }

  async getRepeatMode(): Promise<RepeatMode> {
    try {
      return await TrackPlayer.getRepeatMode();
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get repeat mode:", error);
      return RepeatMode.Off;
    }
  }

  async getQueue(): Promise<TrackPlayerTrack[]> {
    try {
      return await TrackPlayer.getQueue();
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get queue:", error);
      return [];
    }
  }

  async removeUpcomingTracks(): Promise<void> {
    try {
      await TrackPlayer.removeUpcomingTracks();
      console.log("[TrackPlayerService] Removed upcoming tracks");
    } catch (error) {
      console.error(
        "[TrackPlayerService] Failed to remove upcoming tracks:",
        error
      );
      throw error;
    }
  }

  async destroy(): Promise<void> {
    try {
      await TrackPlayer.reset();
      this.isSetup = false;
      console.log("[TrackPlayerService] TrackPlayer destroyed");
    } catch (error) {
      console.error(
        "[TrackPlayerService] Failed to destroy TrackPlayer:",
        error
      );
      throw error;
    }
  }
}

export const trackPlayerService = TrackPlayerService.getInstance();
