import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKGROUND_PLAYBACK_TASK = "BACKGROUND_PLAYBACK_TASK";
const MEDIA_SESSION_TASK = "MEDIA_SESSION_TASK";

export interface BackgroundPlaybackState {
  trackId: string;
  position: number;
  duration: number;
  isPlaying: boolean;
  timestamp: number;
}

/**
 * Background task manager for media playback
 */
export class BackgroundTaskManager {
  private static instance: BackgroundTaskManager;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): BackgroundTaskManager {
    if (!BackgroundTaskManager.instance) {
      BackgroundTaskManager.instance = new BackgroundTaskManager();
    }
    return BackgroundTaskManager.instance;
  }

  /**
   * Initialize background tasks
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("[BackgroundTask] Already initialized");
      return;
    }

    try {
      // Register background playback task
      await this.registerBackgroundPlaybackTask();

      // Register media session task
      await this.registerMediaSessionTask();

      this.isInitialized = true;
      console.log("[BackgroundTask] Background tasks initialized successfully");
    } catch (error) {
      console.error(
        "[BackgroundTask] Failed to initialize background tasks:",
        error
      );
      throw error;
    }
  }

  /**
   * Register background playback task
   */
  private async registerBackgroundPlaybackTask(): Promise<void> {
    if (!TaskManager.isTaskDefined(BACKGROUND_PLAYBACK_TASK)) {
      TaskManager.defineTask(BACKGROUND_PLAYBACK_TASK, async () => {
        try {
          console.log("[BackgroundTask] Background playback task executing");

          // Get current playback state
          const playbackState = await this.getPlaybackState();

          if (playbackState && playbackState.isPlaying) {
            // Update playback position
            const newPosition =
              await this.updatePlaybackPosition(playbackState);

            // Save updated state
            await this.savePlaybackState({
              ...playbackState,
              position: newPosition,
              timestamp: Date.now(),
            });

            console.log(
              `[BackgroundTask] Updated playback position: ${newPosition}s`
            );
          }

          return BackgroundFetch.BackgroundFetchResult.NewData;
        } catch (error) {
          console.error(
            "[BackgroundTask] Background playback task error:",
            error
          );
          return BackgroundFetch.BackgroundFetchResult.Failed;
        }
      });
    }

    // Register background fetch task
    await BackgroundFetch.registerTaskAsync(BACKGROUND_PLAYBACK_TASK, {
      minimumInterval: 60, // 1 minute
      stopOnTerminate: false,
      startOnBoot: true,
    });

    console.log("[BackgroundTask] Background playback task registered");
  }

  /**
   * Register media session task
   */
  private async registerMediaSessionTask(): Promise<void> {
    if (!TaskManager.isTaskDefined(MEDIA_SESSION_TASK)) {
      TaskManager.defineTask(MEDIA_SESSION_TASK, async ({ data, error }) => {
        if (error) {
          console.error("[BackgroundTask] Media session task error:", error);
          return;
        }

        try {
          console.log("[BackgroundTask] Media session task executing", data);

          const taskData = data as {
            event?: string;
            action?: string;
            trackId?: string;
          };

          // Handle media button events
          if (taskData && taskData.event === "media_button") {
            await this.handleMediaButton(taskData.action);
          }

          // Handle notification actions
          if (taskData && taskData.event === "notification_action") {
            await this.handleNotificationAction(
              taskData.action,
              taskData.trackId
            );
          }
        } catch (error) {
          console.error("[BackgroundTask] Media session task error:", error);
        }
      });
    }

    console.log("[BackgroundTask] Media session task registered");
  }

  /**
   * Get current playback state from storage
   */
  private async getPlaybackState(): Promise<BackgroundPlaybackState | null> {
    try {
      const state = await AsyncStorage.getItem("playback_state");
      return state ? JSON.parse(state) : null;
    } catch (error) {
      console.error("[BackgroundTask] Failed to get playback state:", error);
      return null;
    }
  }

  /**
   * Save playback state to storage
   */
  private async savePlaybackState(
    state: BackgroundPlaybackState
  ): Promise<void> {
    try {
      await AsyncStorage.setItem("playback_state", JSON.stringify(state));
    } catch (error) {
      console.error("[BackgroundTask] Failed to save playback state:", error);
    }
  }

  /**
   * Update playback position
   */
  private async updatePlaybackPosition(
    state: BackgroundPlaybackState
  ): Promise<number> {
    try {
      const currentTime = Date.now();
      const timeDiff = (currentTime - state.timestamp) / 1000; // Convert to seconds

      // Calculate new position based on elapsed time
      const newPosition = Math.min(state.position + timeDiff, state.duration);

      return newPosition;
    } catch (error) {
      console.error(
        "[BackgroundTask] Failed to update playback position:",
        error
      );
      return state.position;
    }
  }

  /**
   * Handle media button events
   */
  private async handleMediaButton(action: string): Promise<void> {
    console.log(`[BackgroundTask] Handling media button: ${action}`);

    switch (action) {
      case "play_pause":
        // This will be handled by the PlayerContext
        break;
      case "next":
        // This will be handled by the PlayerContext
        break;
      case "previous":
        // This will be handled by the PlayerContext
        break;
      case "stop":
        await this.stopBackgroundPlayback();
        break;
      default:
        console.warn(`[BackgroundTask] Unknown media button action: ${action}`);
    }
  }

  /**
   * Handle notification actions
   */
  private async handleNotificationAction(
    action: string,
    trackId?: string
  ): Promise<void> {
    console.log(
      `[BackgroundTask] Handling notification action: ${action} for track: ${trackId}`
    );

    switch (action) {
      case "PLAY_PAUSE":
      case "NEXT_TRACK":
      case "PREVIOUS_TRACK":
      case "STOP":
        // These will be handled by the PlayerContext
        break;
      default:
        console.warn(`[BackgroundTask] Unknown notification action: ${action}`);
    }
  }

  /**
   * Stop background playback
   */
  private async stopBackgroundPlayback(): Promise<void> {
    try {
      // Get current playback state
      const state = await this.getPlaybackState();

      if (state) {
        // Update state to stopped
        await this.savePlaybackState({
          ...state,
          isPlaying: false,
          timestamp: Date.now(),
        });

        console.log("[BackgroundTask] Background playback stopped");
      }
    } catch (error) {
      console.error(
        "[BackgroundTask] Failed to stop background playback:",
        error
      );
    }
  }

  /**
   * Start background playback tracking
   */
  public async startBackgroundTracking(
    trackId: string,
    position: number,
    duration: number
  ): Promise<void> {
    try {
      const state: BackgroundPlaybackState = {
        trackId,
        position,
        duration,
        isPlaying: true,
        timestamp: Date.now(),
      };

      await this.savePlaybackState(state);

      console.log(
        `[BackgroundTask] Started background tracking for track: ${trackId}`
      );
    } catch (error) {
      console.error(
        "[BackgroundTask] Failed to start background tracking:",
        error
      );
    }
  }

  /**
   * Update background playback state
   */
  public async updateBackgroundTracking(
    trackId: string,
    position: number,
    duration: number,
    isPlaying: boolean
  ): Promise<void> {
    try {
      const state: BackgroundPlaybackState = {
        trackId,
        position,
        duration,
        isPlaying,
        timestamp: Date.now(),
      };

      await this.savePlaybackState(state);

      console.log(
        `[BackgroundTask] Updated background tracking - Playing: ${isPlaying}, Position: ${position}s`
      );
    } catch (error) {
      console.error(
        "[BackgroundTask] Failed to update background tracking:",
        error
      );
    }
  }

  /**
   * Stop background playback tracking
   */
  public async stopBackgroundTracking(): Promise<void> {
    try {
      await AsyncStorage.removeItem("playback_state");

      console.log("[BackgroundTask] Stopped background tracking");
    } catch (error) {
      console.error(
        "[BackgroundTask] Failed to stop background tracking:",
        error
      );
    }
  }

  /**
   * Get last known playback state
   */
  public async getLastPlaybackState(): Promise<BackgroundPlaybackState | null> {
    return await this.getPlaybackState();
  }

  /**
   * Check if background tasks are initialized
   */
  public isBackgroundTasksInitialized(): boolean {
    return this.isInitialized;
  }
}

export const backgroundTaskManager = BackgroundTaskManager.getInstance();
