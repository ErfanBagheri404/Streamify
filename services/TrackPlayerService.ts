import TrackPlayer, {
  Event,
  Capability,
  RepeatMode,
  AppKilledPlaybackBehavior,
  State,
  IOSCategory,
  IOSCategoryMode,
  IOSCategoryOptions,
  PitchAlgorithm,
} from "react-native-track-player";
import { t } from "../utils/localization";
import { Platform, NativeModules } from "react-native";
import { Track } from "../contexts/PlayerContext";

export class TrackPlayerService {
  private static instance: TrackPlayerService;
  private isSetup = false;
  private currentTrackIndex = 0;
  private playlist: Track[] = [];

  static getInstance(): TrackPlayerService {
    if (!TrackPlayerService.instance) {
      TrackPlayerService.instance = new TrackPlayerService();
    }
    return TrackPlayerService.instance;
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
    if (this.isSetup) return;

    try {
      console.log("[TrackPlayerService] Setting up TrackPlayer...");

      // Check if TrackPlayer JS wrapper is available
      if (!TrackPlayer) {
        console.error("[TrackPlayerService] TrackPlayer is null!");
        throw new Error(
          "TrackPlayer is not available - make sure react-native-track-player is properly installed"
        );
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

      console.log(
        "[TrackPlayerService] TrackPlayer object type:",
        typeof TrackPlayer
      );
      console.log(
        "[TrackPlayerService] TrackPlayer methods:",
        Object.keys(TrackPlayer)
      );

      await TrackPlayer.setupPlayer({
        maxCacheSize: 1024 * 10, // 10MB cache
        iosCategory: IOSCategory.Playback,
        iosCategoryMode: IOSCategoryMode.Default,
        iosCategoryOptions: [
          IOSCategoryOptions.AllowAirPlay,
          IOSCategoryOptions.AllowBluetoothA2DP,
        ],
      });
      console.log(
        "[TrackPlayerService] TrackPlayer setup completed successfully"
      );

      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          alwaysPauseOnInterruption: true,
        },
        // This is the key for proper media session integration
        // The service will automatically handle media session creation
        progressUpdateEventInterval: 1,
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.Stop,
          Capability.SeekTo,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
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
    TrackPlayer.addEventListener(Event.RemotePlay, () => {
      TrackPlayer.play();
    });

    TrackPlayer.addEventListener(Event.RemotePause, () => {
      TrackPlayer.pause();
    });

    TrackPlayer.addEventListener(Event.RemoteNext, () => {
      TrackPlayer.skipToNext();
    });

    TrackPlayer.addEventListener(Event.RemotePrevious, () => {
      TrackPlayer.skipToPrevious();
    });

    TrackPlayer.addEventListener(Event.RemoteStop, () => {
      TrackPlayer.stop();
    });

    TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
      TrackPlayer.seekTo(event.position);
    });

    TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      console.log("[TrackPlayerService] Playback queue ended");
    });

    TrackPlayer.addEventListener(Event.PlaybackTrackChanged, (event) => {
      console.log(
        "[TrackPlayerService] Track changed to index:",
        event.nextTrack
      );
      this.currentTrackIndex = event.nextTrack || 0;
    });
  }

  convertTrackToTrackPlayer(track: Track, index: number) {
    return {
      id: track.id,
      url: track.audioUrl || "",
      title: track.title,
      artist: track.artist || t("screens.artist.unknown_artist"),
      artwork: track.thumbnail || "",
      duration: track.duration || 0,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      // Store original track data for internal use
      pitchAlgorithm: PitchAlgorithm.Linear,
      // Add custom metadata
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

      const trackPlayerTracks = tracks.map((track, index) =>
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
        console.error("[TrackPlayerService] TrackPlayer object:", TrackPlayer);
        throw resetError;
      }

      await TrackPlayer.add(trackPlayerTracks);
      this.playlist = tracks;
      this.currentTrackIndex = startIndex;

      if (startIndex > 0) {
        await TrackPlayer.skip(startIndex);
      }

      console.log(
        "[TrackPlayerService] Added",
        tracks.length,
        "tracks starting at index",
        startIndex
      );
    } catch (error) {
      console.error("[TrackPlayerService] Failed to add tracks:", error);
      throw error;
    }
  }

  async play() {
    try {
      await this.ensureTrackPlayerReady();
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
      await TrackPlayer.skipToNext();
      this.currentTrackIndex = Math.min(
        this.currentTrackIndex + 1,
        this.playlist.length - 1
      );
      console.log("[TrackPlayerService] Skipped to next track");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to skip to next:", error);
      throw error;
    }
  }

  async skipToPrevious() {
    try {
      await TrackPlayer.skipToPrevious();
      this.currentTrackIndex = Math.max(this.currentTrackIndex - 1, 0);
      console.log("[TrackPlayerService] Skipped to previous track");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to skip to previous:", error);
      throw error;
    }
  }

  async skipToTrack(index: number) {
    try {
      await TrackPlayer.skip(index);
      this.currentTrackIndex = index;
      console.log("[TrackPlayerService] Skipped to track index:", index);
    } catch (error) {
      console.error("[TrackPlayerService] Failed to skip to track:", error);
      throw error;
    }
  }

  async getCurrentTrack() {
    try {
      const track = await TrackPlayer.getActiveTrack();
      return track;
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get current track:", error);
      return null;
    }
  }

  async getPosition() {
    try {
      const position = await TrackPlayer.getPosition();
      return position;
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get position:", error);
      return 0;
    }
  }

  async getDuration() {
    try {
      const duration = await TrackPlayer.getDuration();
      return duration;
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get duration:", error);
      return 0;
    }
  }

  async getPlaybackState() {
    try {
      const state = await TrackPlayer.getPlaybackState();
      return state;
    } catch (error) {
      console.error(
        "[TrackPlayerService] Failed to get playback state:",
        error
      );
      return { state: State.None };
    }
  }

  async isPlaying() {
    try {
      const state = await this.getPlaybackState();
      return state.state === State.Playing;
    } catch (error) {
      console.error("[TrackPlayerService] Failed to check if playing:", error);
      return false;
    }
  }

  async setVolume(volume: number) {
    try {
      await TrackPlayer.setVolume(volume);
      console.log("[TrackPlayerService] Volume set to:", volume);
    } catch (error) {
      console.error("[TrackPlayerService] Failed to set volume:", error);
      throw error;
    }
  }

  async getVolume() {
    try {
      const volume = await TrackPlayer.getVolume();
      return volume;
    } catch (error) {
      console.error("[TrackPlayerService] Failed to get volume:", error);
      return 1;
    }
  }

  async setRepeatMode(mode: "off" | "one" | "all") {
    try {
      let repeatMode: RepeatMode;
      switch (mode) {
        case "one":
          repeatMode = RepeatMode.Track;
          break;
        case "all":
          repeatMode = RepeatMode.Queue;
          break;
        default:
          repeatMode = RepeatMode.Off;
      }
      await TrackPlayer.setRepeatMode(repeatMode);
      console.log("[TrackPlayerService] Repeat mode set to:", mode);
    } catch (error) {
      console.error("[TrackPlayerService] Failed to set repeat mode:", error);
      throw error;
    }
  }

  async reset() {
    try {
      await TrackPlayer.reset();
      this.playlist = [];
      this.currentTrackIndex = 0;
      console.log("[TrackPlayerService] Player reset");
    } catch (error) {
      console.error("[TrackPlayerService] Failed to reset:", error);
      throw error;
    }
  }

  getCurrentTrackIndex() {
    return this.currentTrackIndex;
  }

  getPlaylist() {
    return this.playlist;
  }

  async updateCurrentTrack(newAudioUrl: string) {
    try {
      const currentTrack = await this.getCurrentTrack();
      if (!currentTrack) {
        console.error("[TrackPlayerService] No current track to update");
        return;
      }

      // Update the current track's URL
      const updatedTrack = {
        ...currentTrack,
        url: newAudioUrl,
      };

      // Remove current track and add updated one
      await TrackPlayer.remove(this.currentTrackIndex);
      await TrackPlayer.add([updatedTrack], this.currentTrackIndex);

      // Skip to the updated track
      await TrackPlayer.skip(this.currentTrackIndex);

      console.log(
        "[TrackPlayerService] Updated current track with new URL:",
        newAudioUrl
      );
    } catch (error) {
      console.error(
        "[TrackPlayerService] Failed to update current track:",
        error
      );
      throw error;
    }
  }
}

export const trackPlayerService = TrackPlayerService.getInstance();
