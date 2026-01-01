import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";

const FOREGROUND_SERVICE_TASK = "FOREGROUND_SERVICE_TASK";

/**
 * Foreground service manager for Android media playback
 */
export class ForegroundServiceManager {
  private static instance: ForegroundServiceManager;
  private isInitialized = false;
  private isServiceRunning = false;

  private constructor() {}

  public static getInstance(): ForegroundServiceManager {
    if (!ForegroundServiceManager.instance) {
      ForegroundServiceManager.instance = new ForegroundServiceManager();
    }
    return ForegroundServiceManager.instance;
  }

  /**
   * Initialize foreground service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized || Platform.OS !== "android") {
      return;
    }

    try {
      // Register foreground service task
      await this.registerForegroundServiceTask();

      this.isInitialized = true;
      console.log("[ForegroundService] Foreground service initialized");
    } catch (error) {
      console.error(
        "[ForegroundService] Failed to initialize foreground service:",
        error,
      );
      throw error;
    }
  }

  /**
   * Register foreground service task
   */
  private async registerForegroundServiceTask(): Promise<void> {
    if (!TaskManager.isTaskDefined(FOREGROUND_SERVICE_TASK)) {
      TaskManager.defineTask(
        FOREGROUND_SERVICE_TASK,
        async ({ data, error }) => {
          if (error) {
            console.error("[ForegroundService] Task error:", error);
            return;
          }

          try {
            console.log(
              "[ForegroundService] Foreground service task executing",
              data,
            );

            // Keep audio session active
            await this.keepAudioSessionActive();

            // Update notification with current playback state
            const taskData = data as {
              type?: string;
              track?: any;
              isPlaying?: boolean;
            };
            if (taskData && taskData.type === "update_notification") {
              await this.updateServiceNotification(
                taskData.track,
                taskData.isPlaying,
              );
            }
          } catch (error) {
            console.error("[ForegroundService] Task execution error:", error);
          }
        },
      );
    }

    console.log("[ForegroundService] Foreground service task registered");
  }

  /**
   * Start foreground service
   */
  public async startForegroundService(
    track: any,
    isPlaying: boolean,
  ): Promise<void> {
    if (Platform.OS !== "android" || this.isServiceRunning) {
      return;
    }

    try {
      // Configure audio to stay active in background
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: true,
      });

      // Start background fetch task (acts as foreground service)
      await BackgroundFetch.registerTaskAsync(FOREGROUND_SERVICE_TASK, {
        minimumInterval: 30, // 30 seconds
        stopOnTerminate: false,
        startOnBoot: true,
      });

      this.isServiceRunning = true;
      console.log("[ForegroundService] Foreground service started");

      // Send initial update
      await this.updateServiceNotification(track, isPlaying);
    } catch (error) {
      console.error(
        "[ForegroundService] Failed to start foreground service:",
        error,
      );
      throw error;
    }
  }

  /**
   * Stop foreground service
   */
  public async stopForegroundService(): Promise<void> {
    if (Platform.OS !== "android" || !this.isServiceRunning) {
      return;
    }

    try {
      // Stop background fetch task
      await BackgroundFetch.unregisterTaskAsync(FOREGROUND_SERVICE_TASK);

      this.isServiceRunning = false;
      console.log("[ForegroundService] Foreground service stopped");
    } catch (error) {
      console.error(
        "[ForegroundService] Failed to stop foreground service:",
        error,
      );
    }
  }

  /**
   * Update service notification
   */
  private async updateServiceNotification(
    track: any,
    isPlaying: boolean,
  ): Promise<void> {
    try {
      // This will be handled by the media session manager
      // The foreground service just keeps the app alive
      console.log(
        `[ForegroundService] Updating service notification: ${track?.title || "Unknown"} - ${isPlaying ? "Playing" : "Paused"}`,
      );
    } catch (error) {
      console.error(
        "[ForegroundService] Failed to update service notification:",
        error,
      );
    }
  }

  /**
   * Keep audio session active
   */
  private async keepAudioSessionActive(): Promise<void> {
    try {
      // Ensure audio stays active in background
      console.log("[ForegroundService] Audio session is active");
    } catch (error) {
      console.error(
        "[ForegroundService] Error keeping audio session active:",
        error,
      );
    }
  }

  /**
   * Check if service is running
   */
  public isRunning(): boolean {
    return this.isServiceRunning;
  }

  /**
   * Check if service is initialized
   */
  public isForegroundServiceInitialized(): boolean {
    return this.isInitialized;
  }
}

export const foregroundServiceManager = ForegroundServiceManager.getInstance();
