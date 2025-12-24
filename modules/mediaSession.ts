import { Platform } from "react-native";
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";
import { Track } from "../contexts/PlayerContext";

export interface MediaSessionConfig {
  track: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  colorTheme: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    accent: string;
  };
}

class MediaSessionManager {
  private static instance: MediaSessionManager;
  private mediaSession: any = null;
  private notificationId: string | null = null;
  private isInitialized = false;
  private currentConfig: MediaSessionConfig | null = null;

  private constructor() {}

  public static getInstance(): MediaSessionManager {
    if (!MediaSessionManager.instance) {
      MediaSessionManager.instance = new MediaSessionManager();
    }
    return MediaSessionManager.instance;
  }

  /**
   * Initialize the media session and notification system
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("[MediaSession] Already initialized");
      return;
    }

    try {
      // Configure notification handling - disabled since expo-notifications removed
      console.log(
        "[MediaSession] Notification handling disabled - expo-notifications removed"
      );

      // Configure audio session for media playback
      await this.configureAudioSession();

      this.isInitialized = true;
      console.log("[MediaSession] Media session initialized successfully");
    } catch (error) {
      console.error(
        "[MediaSession] Failed to initialize media session:",
        error
      );
      throw error;
    }
  }

  /**
   * Configure audio session for media playback
   */
  private async configureAudioSession(): Promise<void> {
    try {
      // Configure audio mode for media playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      });

      console.log("[MediaSession] Audio session configured");
    } catch (error) {
      console.error("[MediaSession] Failed to configure audio session:", error);
      throw error;
    }
  }

  /**
   * Update media session with current playback state
   */
  public async updateMediaSession(config: MediaSessionConfig): Promise<void> {
    if (!this.isInitialized) {
      console.warn("[MediaSession] Media session not initialized");
      return;
    }

    this.currentConfig = config;

    try {
      // Update notification functionality removed since expo-notifications is uninstalled
      console.log(
        "[MediaSession] Media session updated (notifications disabled)"
      );
    } catch (error) {
      console.error("[MediaSession] Failed to update media session:", error);
      throw error;
    }
  }

  /**
   * Update Android media session
   */
  private async updateAndroidMediaSession(
    config: MediaSessionConfig
  ): Promise<void> {
    if (Platform.OS !== "android") {
      return;
    }

    try {
      // Android media session functionality removed since expo-notifications is uninstalled
      console.log("[MediaSession] Android media session update skipped");
    } catch (error) {
      console.error(
        "[MediaSession] Failed to update Android media session:",
        error
      );
      throw error;
    }
  }

  /**
   * Update iOS media session
   */
  private async updateIOSMediaSession(
    config: MediaSessionConfig
  ): Promise<void> {
    if (Platform.OS !== "ios") {
      return;
    }

    try {
      // iOS media session functionality removed since expo-notifications is uninstalled
      console.log("[MediaSession] iOS media session update skipped");
    } catch (error) {
      console.error(
        "[MediaSession] Failed to update iOS media session:",
        error
      );
      throw error;
    }
  }

  /**
   * Update notification - functionality removed
   */
  private async updateNotification(config: MediaSessionConfig): Promise<void> {
    if (!config.track) {
      console.log("[MediaSession] No track to display in notification");
      return;
    }

    // Notification functionality removed since expo-notifications is uninstalled
    console.log("[MediaSession] Notification update skipped");
  }

  /**
   * Handle notification actions - functionality removed
   */
  public async handleNotificationAction(
    action: string,
    trackId?: string
  ): Promise<void> {
    console.log(
      `[MediaSession] Notification action handling disabled: ${action} for track: ${trackId}`
    );
  }

  /**
   * Stop media session and clear notification - functionality removed
   */
  public async stop(): Promise<void> {
    try {
      // Notification functionality removed since expo-notifications is uninstalled
      this.currentConfig = null;
      console.log(
        "[MediaSession] Media session stopped (notifications disabled)"
      );
    } catch (error) {
      console.error("[MediaSession] Failed to stop media session:", error);
      throw error;
    }
  }

  /**
   * Create notification channel - functionality removed
   */
  public async createNotificationChannel(): Promise<void> {
    if (Platform.OS !== "android") {
      return;
    }

    console.log("[MediaSession] Notification channel creation skipped");
  }

  /**
   * Get current media session configuration
   */
  public getCurrentConfig(): MediaSessionConfig | null {
    return this.currentConfig;
  }

  /**
   * Check if media session is initialized
   */
  public isMediaSessionInitialized(): boolean {
    return this.isInitialized;
  }
}

export const mediaSessionManager = MediaSessionManager.getInstance();
