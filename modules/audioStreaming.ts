import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { toByteArray, fromByteArray } from "base64-js";

// Cache directory configuration
const CACHE_CONFIG = {
  // Try these directories in order of preference
  cacheDirs: [
    () => `${FileSystem.cacheDirectory}youtube-cache/`,
    () => `${FileSystem.cacheDirectory}audio-cache/`,
    () => `${FileSystem.documentDirectory}audio-cache/`,
  ],
  getBestCacheDir: async function (): Promise<string | null> {
    for (const dirFunc of this.cacheDirs) {
      const dir = dirFunc();
      try {
        // Test if we can create and write to this directory
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const testFile = `${dir}.writetest_${Date.now()}`;
        await FileSystem.writeAsStringAsync(testFile, "test");
        await FileSystem.deleteAsync(testFile, { idempotent: true });
        console.log(`[Audio] Using cache directory: ${dir}`);
        return dir;
      } catch (error) {
        console.warn(`[Audio] Cache directory not available: ${dir}`, error);
        continue;
      }
    }
    return null;
  },
};

// Audio streaming with multiple fallback strategies and ytify v8 concepts
export class AudioStreamManager {
  private static instance: AudioStreamManager;

  private fallbackStrategies: Array<(videoId: string) => Promise<string>> = [];
  private proxyRotation: string[] = [];
  private currentProxyIndex = 0;
  private prefetchQueue: Map<string, Promise<string>> = new Map();
  private concurrentTestResults: Map<
    string,
    { url: string; latency: number; strategy: string }[]
  > = new Map();

  // Track information for better SoundCloud searching
  private currentTrackTitle?: string;
  private currentTrackArtist?: string;

  // SoundCloud stream cache (1MB pre-buffering)
  private soundCloudCache: Map<string, string> = new Map();

  // Generic track cache for all track types (YouTube, SoundCloud, etc.)
  private trackCache: Map<string, string> = new Map();

  // Cache directory path (determined at runtime)
  private cacheDirectory: string | null = null;

  // Cache progress tracking to prevent regression
  private cacheProgress: Map<
    string,
    {
      percentage: number;
      lastUpdate: number;
      isDownloading: boolean;
      downloadStartTime: number;
      retryCount: number;
      lastFileSize: number;
      downloadedSize?: number;
      downloadSpeed?: number;
      originalStreamUrl?: string; // Store original URL for resume operations
      estimatedTotalSize?: number; // Estimated total file size for accurate percentage
      isFullyCached?: boolean; // Track if file is confirmed complete
    }
  > = new Map();

  // Maximum retry attempts for failed downloads
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY = 2000; // 2 seconds
  private readonly PROGRESS_UPDATE_INTERVAL = 1000; // 1 second
  private readonly MIN_PROGRESS_THRESHOLD = 0.5; // Minimum 0.5% progress per update

  // Cache for getCacheInfo results to prevent excessive filesystem calls
  private cacheInfoCache = new Map<
    string,
    {
      result: {
        percentage: number;
        fileSize: number;
        totalFileSize?: number;
        isFullyCached: boolean;
        isDownloading?: boolean;
        downloadSpeed?: number;
        retryCount?: number;
      };
      timestamp: number;
    }
  >();
  private readonly CACHE_INFO_TTL = 5000; // 5 second TTL

  /**
   * Clear cached cache info for a specific track
   */
  private clearCacheInfoCache(trackId: string): void {
    this.cacheInfoCache.delete(trackId);
    console.log(`[Audio] Cleared cache info cache for track: ${trackId}`);
  }

  // Hardcoded Client ID from your logs
  private readonly SOUNDCLOUD_CLIENT_ID = "gqKBMSuBw5rbN9rDRYPqKNvF17ovlObu";

  // Fallback client IDs for when the primary one fails
  private readonly FALLBACK_SOUNDCLOUD_CLIENT_IDS = [
    "gqKBMSuBw5rbN9rDRYPqKNvF17ovlObu",
    "iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX",
    "W0KE1gQE6g2Qlx6WfB6Q2WfB6Q2WfB6Q",
    "gKzE4W8FNPVldzAoXiZIs9mchVcX5lhV",
    "fDoItIDGPGBYQK0R7hgmy7vLqNYnZOLM",
  ];
  private currentClientIdIndex = 0;

  private isRemoteUrl(url: string | null | undefined): boolean {
    if (!url) {
      return false;
    }
    return url.startsWith("http://") || url.startsWith("https://");
  }

  // Helper method to update download progress with atomic updates
  private updateDownloadProgress(
    trackId: string,
    downloadedMB: number,
    speed: number,
  ): void {
    const progress = this.cacheProgress.get(trackId);
    if (progress) {
      // Use atomic updateCacheProgress to prevent race conditions
      this.updateCacheProgress(
        trackId,
        progress.percentage,
        progress.lastFileSize,
        {
          downloadedSize: downloadedMB,
          downloadSpeed: speed,
          isDownloading: progress.isDownloading,
          estimatedTotalSize: progress.estimatedTotalSize,
          isFullyCached: progress.isFullyCached,
          originalStreamUrl: progress.originalStreamUrl,
        },
      );
    }
  }

  constructor() {
    this.setupProxyRotation();
    this.setupFallbackStrategies();
    // Don't start health checks initially - they'll be started when needed
    // this.startInstanceHealthChecking();

    // Initialize cache progress cleanup interval
    this.startCacheProgressCleanup();

    // Initialize cache directory
    this.initializeCacheDirectory();
  }

  /**
   * Initialize the best available cache directory
   */
  private async initializeCacheDirectory(): Promise<void> {
    console.log("[Audio] Initializing cache directory...");
    this.cacheDirectory = await CACHE_CONFIG.getBestCacheDir();

    if (this.cacheDirectory) {
      console.log(
        `[Audio] Successfully initialized cache directory: ${this.cacheDirectory}`,
      );
    } else {
      console.warn(
        "[Audio] No writable cache directory available, caching will be disabled",
      );
    }
  }

  /**
   * Get the current cache directory, initializing if necessary
   */
  private async getCacheDirectory(): Promise<string | null> {
    if (this.cacheDirectory === null) {
      await this.initializeCacheDirectory();
    }
    return this.cacheDirectory;
  }

  /**
   * Safely update cache progress to prevent regression with atomic updates
   */
  private updateCacheProgress(
    trackId: string,
    newPercentage: number,
    fileSize?: number,
    options?: {
      isDownloading?: boolean;
      downloadedSize?: number;
      downloadSpeed?: number;
      estimatedTotalSize?: number;
      isFullyCached?: boolean;
      originalStreamUrl?: string;
    },
  ): boolean {
    const now = Date.now();
    const existingProgress = this.cacheProgress.get(trackId);

    // Atomic update - lock the progress to prevent race conditions
    if (existingProgress) {
      // Check if this is a regression (but allow for file size recalculation)
      const isSignificantRegression =
        newPercentage < existingProgress.percentage - 5;
      const isFileSizeUpdate =
        options?.estimatedTotalSize &&
        options.estimatedTotalSize !== existingProgress.estimatedTotalSize;

      if (isSignificantRegression && !isFileSizeUpdate) {
        console.warn(
          `[CacheProgress] Preventing regression for ${trackId}: ${existingProgress.percentage}% -> ${newPercentage}%`,
        );
        return false;
      }

      // Check if progress is significant enough (avoid tiny increments)
      const timeSinceLastUpdate = now - existingProgress.lastUpdate;
      const progressDelta = newPercentage - existingProgress.percentage;

      if (
        timeSinceLastUpdate < this.PROGRESS_UPDATE_INTERVAL &&
        progressDelta < this.MIN_PROGRESS_THRESHOLD &&
        !options?.isDownloading && // Always allow updates when download state changes
        !options?.isFullyCached // Always allow completion updates
      ) {
        console.log(
          `[CacheProgress] Skipping minor update for ${trackId}: ${progressDelta}% in ${timeSinceLastUpdate}ms`,
        );
        return false;
      }
    }

    // Atomic update - merge all changes at once
    const updatedProgress = {
      percentage: newPercentage,
      lastUpdate: now,
      isDownloading:
        options?.isDownloading ?? existingProgress?.isDownloading ?? false,
      downloadStartTime: existingProgress?.downloadStartTime || now,
      retryCount: existingProgress?.retryCount || 0,
      lastFileSize: fileSize ?? existingProgress?.lastFileSize ?? 0,
      downloadedSize:
        options?.downloadedSize ?? existingProgress?.downloadedSize,
      downloadSpeed: options?.downloadSpeed ?? existingProgress?.downloadSpeed,
      estimatedTotalSize:
        options?.estimatedTotalSize ?? existingProgress?.estimatedTotalSize,
      isFullyCached:
        options?.isFullyCached ?? existingProgress?.isFullyCached ?? false,
      originalStreamUrl:
        options?.originalStreamUrl ?? existingProgress?.originalStreamUrl,
    };

    this.cacheProgress.set(trackId, updatedProgress);

    console.log(
      `[CacheProgress] Updated progress for ${trackId}: ${newPercentage}%${fileSize ? ` (${Math.round(fileSize * 100) / 100}MB)` : ""}${options?.downloadedSize ? ` downloaded: ${Math.round(options.downloadedSize * 100) / 100}MB` : ""}`,
    );

    // Clear cache info cache since progress changed
    this.clearCacheInfoCache(trackId);

    return true;
  }

  /**
   * Mark download as started with proper state initialization
   */
  private markDownloadStarted(trackId: string, streamUrl?: string): void {
    const now = Date.now();
    const existingProgress = this.cacheProgress.get(trackId);

    // Preserve existing progress but mark as downloading
    const updatedProgress = {
      percentage: existingProgress?.percentage || 0,
      lastUpdate: now,
      isDownloading: true,
      downloadStartTime: existingProgress?.downloadStartTime || now,
      retryCount: existingProgress?.retryCount || 0,
      lastFileSize: existingProgress?.lastFileSize || 0,
      downloadedSize: existingProgress?.downloadedSize || 0,
      downloadSpeed: existingProgress?.downloadSpeed || 0,
      estimatedTotalSize: existingProgress?.estimatedTotalSize || 0,
      isFullyCached: false, // Reset when starting new download
      originalStreamUrl: streamUrl || existingProgress?.originalStreamUrl,
    };

    this.cacheProgress.set(trackId, updatedProgress);
    console.log(
      `[CacheProgress] Download started for ${trackId}${streamUrl ? ` from: ${streamUrl.substring(0, 50)}...` : ""}`,
    );
  }

  /**
   * Mark download as completed with proper state finalization
   */
  private markDownloadCompleted(trackId: string, fileSize: number): void {
    const existingProgress = this.cacheProgress.get(trackId);
    const now = Date.now();

    const completedProgress = {
      percentage: 100,
      lastUpdate: now,
      isDownloading: false,
      downloadStartTime: existingProgress?.downloadStartTime || now,
      retryCount: 0,
      lastFileSize: fileSize,
      downloadedSize: fileSize, // Set downloaded size to match file size
      downloadSpeed: 0, // Reset speed on completion
      estimatedTotalSize: fileSize, // Set estimated total to actual file size
      isFullyCached: true, // Mark as fully cached
      originalStreamUrl: existingProgress?.originalStreamUrl, // Preserve URL
    };

    this.cacheProgress.set(trackId, completedProgress);

    // Clear cache info cache since the file status changed
    this.clearCacheInfoCache(trackId);
    console.log(
      `[CacheProgress] Download completed for ${trackId}: ${Math.round(fileSize * 100) / 100}MB (took ${existingProgress ? Math.round((now - existingProgress.downloadStartTime) / 1000) : 0}s)`,
    );
  }

  /**
   * Clean up stale cache progress entries
   */
  private startCacheProgressCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 5 * 60 * 1000; // 5 minutes

      for (const entry of Array.from(this.cacheProgress.entries())) {
        const [trackId, progress] = entry;
        if (
          !progress.isDownloading &&
          now - progress.lastUpdate > staleThreshold
        ) {
          if (progress.originalStreamUrl) {
            // Preserve original URL for resume operations, but reset other values
            this.cacheProgress.set(trackId, {
              percentage: 0,
              lastFileSize: 0,
              downloadedSize: 0,
              downloadSpeed: 0,
              isDownloading: false,
              estimatedTotalSize: progress.estimatedTotalSize || 0,
              isFullyCached: false,
              originalStreamUrl: progress.originalStreamUrl,
              lastUpdate: Date.now(),
              retryCount: progress.retryCount || 0,
              downloadStartTime: Date.now(),
            });
            console.log(
              `[CacheProgress] Preserved URL in stale cleanup for ${trackId}`,
            );
          } else {
            this.cacheProgress.delete(trackId);
            console.log(
              `[CacheProgress] Cleaned up stale progress for ${trackId}`,
            );
          }
        }
      }
    }, 60000); // Run every minute
  }

  // Convert video stream to audio format by finding audio-only alternatives
  private async convertStreamToMP3(
    videoUrl: string,
    videoId: string,
  ): Promise<string> {
    try {
      console.log(
        `[AudioStreamManager] Converting video stream to audio for video: ${videoId}`,
      );

      // Method 1: Try to find audio-only streams with specific itags
      // YouTube/Invidious audio-only itags: 140 (AAC), 251 (Opus), 139 (AAC low)
      const audioItags = ["140", "251", "139", "250", "249"];

      for (const itag of audioItags) {
        try {
          // Replace the itag parameter in the URL
          const audioOnlyUrl = videoUrl.replace(/&itag=\d+/, `&itag=${itag}`);

          console.log(`[AudioStreamManager] Testing audio-only itag ${itag}`);

          // Test if this audio-only URL works
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const testResponse = await fetch(audioOnlyUrl, {
            method: "HEAD",
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          clearTimeout(timeoutId);

          if (testResponse.ok) {
            console.log(
              `[AudioStreamManager] Found working audio-only stream with itag ${itag}`,
            );
            return audioOnlyUrl;
          }
        } catch (error) {
          console.warn(
            `[AudioStreamManager] Audio-only itag ${itag} failed:`,
            error,
          );
          continue;
        }
      }

      // Method 2: Try to modify the URL to get an audio-only version
      // Remove video-specific parameters and add audio-specific ones
      console.log(
        "[AudioStreamManager] Trying URL modification for audio extraction",
      );

      try {
        // Parse the URL to understand its structure
        const url = new URL(videoUrl);
        const params = new URLSearchParams(url.search);

        // Remove video quality parameters
        params.delete("quality");
        params.delete("vcodec");
        params.delete("width");
        params.delete("height");

        // Add audio-specific parameters
        params.set("acodec", "mp4a");
        params.set("abr", "128");

        const modifiedUrl = `${url.origin}${url.pathname}?${params.toString()}`;

        console.log("[AudioStreamManager] Testing modified URL");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const testResponse = await fetch(modifiedUrl, {
          method: "HEAD",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        clearTimeout(timeoutId);

        if (testResponse.ok) {
          console.log("[AudioStreamManager] Found working modified audio URL");
          return modifiedUrl;
        }
      } catch (error) {
        console.warn("[AudioStreamManager] URL modification failed:", error);
      }

      // Method 3: Last resort - return the original URL with audio extraction hint
      // The player will need to handle video streams that contain audio
      console.warn(
        "[AudioStreamManager] All audio extraction methods failed, returning original stream URL with audio hint",
      );

      // Add a query parameter to indicate this is an audio extraction request
      // This helps the player understand it should extract audio from the video stream
      const audioExtractionUrl = `${videoUrl}&audio_only=true&extract_audio=1`;

      // Log for debugging
      console.log(
        "[AudioStreamManager] Returning URL with audio extraction hint",
      );

      return audioExtractionUrl;
    } catch (error) {
      console.error("[AudioStreamManager] Audio extraction failed:", error);

      // Even in case of error, return the original URL so playback can still work
      // The player might be able to handle the video stream directly
      console.warn(
        `[AudioStreamManager] Returning original URL due to extraction error: ${videoUrl}`,
      );
      return videoUrl;
    }
  }

  private setupProxyRotation() {
    // Dynamic proxy rotation for network resilience
    this.proxyRotation = [
      "https://corsproxy.io/?",
      "https://api.allorigins.win/raw?url=",
      "https://cors-anywhere.herokuapp.com/",
      "https://proxy.cors.sh/",
      "https://corsproxy.org/?",
      "https://cors.eu.org/?",
      "https://corsproxy.com/?",
    ];
  }

  private getCorsProxyUrl(url: string): string {
    // Use a simple CORS proxy to bypass CORS issues
    const corsProxies = [
      "https://corsproxy.io/?",
      "https://api.allorigins.win/raw?url=",
      "https://cors-anywhere.herokuapp.com/",
      "https://proxy.cors.sh/",
    ];

    // Use the first available proxy
    const proxy = corsProxies[0];
    return proxy + encodeURIComponent(url);
  }

  /**
   * Check if a track has a full cached file available
   */
  public hasFullCachedFile(trackId: string): boolean {
    // Check old format
    if (this.soundCloudCache.has(trackId + "_has_full")) {
      return true;
    }

    // Check new format - look for .full in the cached path
    const cachedPath = this.soundCloudCache.get(trackId);
    if (cachedPath && cachedPath.includes(".full")) {
      return true;
    }

    return false;
  }

  /**
   * Get the best available cached file path for a track
   */
  public async getBestCachedFilePath(trackId: string): Promise<string | null> {
    console.log(`[Audio] Checking cache for track: ${trackId}`);

    // First check generic track cache (for all track types)
    const genericCachedPath = this.trackCache.get(trackId);
    if (genericCachedPath) {
      // Verify the cached path actually exists before returning it
      const cachedFileInfo = await FileSystem.getInfoAsync(genericCachedPath);
      if (cachedFileInfo.exists) {
        return genericCachedPath.startsWith("file://")
          ? genericCachedPath
          : `file://${genericCachedPath}`;
      } else {
        console.log(
          `[Audio] Generic cached file doesn't exist, removing from cache: ${genericCachedPath}`,
        );
        this.trackCache.delete(trackId);
      }
    }

    // Then check SoundCloud-specific cache for backward compatibility
    const fullFilePath = this.soundCloudCache.get(trackId + "_full");
    if (fullFilePath) {
      // Return the path without adding file:// prefix if it already has it
      return fullFilePath.startsWith("file://")
        ? fullFilePath
        : `file://${fullFilePath}`;
    }

    // Check if we have a full file in the new format (direct trackId)
    const cachedPath = this.soundCloudCache.get(trackId);
    if (cachedPath) {
      // Verify the cached path actually exists before returning it
      const cachedFileInfo = await FileSystem.getInfoAsync(cachedPath);
      if (!cachedFileInfo.exists) {
        console.log(
          `[Audio] Cached file doesn't exist, removing from cache: ${cachedPath}`,
        );
        this.soundCloudCache.delete(trackId);
        // Continue to filesystem scan below
      } else {
        // Check if this is a full file by looking at the path
        if (cachedPath.includes(".full")) {
          // console.log(`[Audio] Found full cached file: ${cachedPath}`);
          // Return the path without adding file:// prefix if it already has it
          return cachedPath.startsWith("file://")
            ? cachedPath
            : `file://${cachedPath}`;
        }
        // This is a partial cache
        // console.log(`[Audio] Found partial cached file: ${cachedPath}`);
        // Return the path without adding file:// prefix if it already has it
        return cachedPath.startsWith("file://")
          ? cachedPath
          : `file://${cachedPath}`;
      }
    }

    // Check for full file indicator in generic track cache
    const fullCachedPath = this.trackCache.get(trackId + "_full");
    if (fullCachedPath) {
      const cachedFileInfo = await FileSystem.getInfoAsync(fullCachedPath);
      if (cachedFileInfo.exists) {
        return fullCachedPath.startsWith("file://")
          ? fullCachedPath
          : `file://${fullCachedPath}`;
      } else {
        console.log(
          `[Audio] Full cached file doesn't exist, removing from cache: ${fullCachedPath}`,
        );
        this.trackCache.delete(trackId + "_full");
        this.trackCache.delete(trackId);
      }
    }

    // If not in memory, scan filesystem for existing cache files
    console.log(
      `[Audio] Scanning filesystem for cache files for track: ${trackId}`,
    );

    // Get the best available cache directory
    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn("[Audio] No cache directory available for SoundCloud scan");
      return null;
    }

    // Check SoundCloud cache directory
    const soundCloudCacheDir = `${cacheDir}soundcloud-cache/`;

    try {
      // Check for any SoundCloud cache files with different extensions
      const soundCloudExtensions = [
        ".mp3",
        ".mp3.full",
        ".cache",
        ".webm",
        ".webm.full",
      ];

      for (const ext of soundCloudExtensions) {
        const filePath = `${soundCloudCacheDir}${trackId}${ext}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);

        if (fileInfo.exists && fileInfo.size > 0) {
          // Validate file integrity before using it
          const isValid = await this.validateCachedFile(filePath);
          if (isValid) {
            console.log(
              `[Audio] Found existing SoundCloud cache file: ${filePath}`,
            );
            this.soundCloudCache.set(trackId + "_full", filePath);
            this.soundCloudCache.set(trackId, filePath);
            this.soundCloudCache.set(trackId + "_has_full", "true");
            // Return the path without adding file:// prefix if it already has it
            return filePath.startsWith("file://")
              ? filePath
              : `file://${filePath}`;
          } else {
            console.warn(
              `[Audio] Found corrupted SoundCloud cache file, cleaning up: ${filePath}`,
            );
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          }
        }
      }
    } catch (error) {
      // Error checking SoundCloud cache directory
    }

    // Get the best available cache directory
    const youtubeCacheDir = await this.getCacheDirectory();
    if (!youtubeCacheDir) {
      console.warn(
        "[Audio] No cache directory available, skipping filesystem scan",
      );
      return null;
    }

    try {
      // Check for any YouTube cache files with different extensions
      const youtubeExtensions = [
        ".cache",
        ".webm",
        ".webm.full",
        ".mp3",
        ".mp3.full",
      ];

      for (const ext of youtubeExtensions) {
        const filePath = `${youtubeCacheDir}${trackId}${ext}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);

        if (fileInfo.exists && fileInfo.size > 0) {
          // Validate file integrity before using it
          const isValid = await this.validateCachedFile(filePath);
          if (isValid) {
            console.log(
              `[Audio] Found existing YouTube cache file: ${filePath}`,
            );

            // Mark as full if it has .full extension or is substantial
            if (ext.includes(".full") || fileInfo.size > 5242880) {
              // 5MB
              this.soundCloudCache.set(trackId + "_full", filePath);
              this.soundCloudCache.set(trackId + "_has_full", "true");
            }

            this.soundCloudCache.set(trackId, filePath);
            // Return the path without adding file:// prefix if it already has it
            return filePath.startsWith("file://")
              ? filePath
              : `file://${filePath}`;
          } else {
            console.warn(
              `[Audio] Found corrupted YouTube cache file, cleaning up: ${filePath}`,
            );
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          }
        }
      }
    } catch (error) {
      console.log("[Audio] Error checking YouTube cache directory:", error);
    }

    console.log(`[Audio] No cache files found for track: ${trackId}`);
    return null;
  }

  /**
   * Try different SoundCloud client IDs when the current one fails
   */
  private async tryAlternativeClientIds(
    baseUrl: string,
    trackData: any,
    controller: AbortController,
  ): Promise<string> {
    const originalIndex = this.currentClientIdIndex;

    for (let i = 0; i < this.FALLBACK_SOUNDCLOUD_CLIENT_IDS.length; i++) {
      const clientIdIndex =
        (originalIndex + i + 1) % this.FALLBACK_SOUNDCLOUD_CLIENT_IDS.length;
      const clientId = this.FALLBACK_SOUNDCLOUD_CLIENT_IDS[clientIdIndex];

      try {
        // Create URL with alternative client ID
        const altUrl = new URL(baseUrl);
        altUrl.searchParams.set("client_id", clientId);

        const response = await fetch(this.getCorsProxyUrl(altUrl.toString()), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await response.json();
          if (data.url) {
            this.currentClientIdIndex = clientIdIndex; // Update current index for future use
            return data.url;
          }
        }
      } catch (error) {
        // Alternative client ID failed
        continue;
      }
    }

    throw new Error("All SoundCloud client IDs failed");
  }

  /**
   * Validate that an audio stream URL is accessible and in a supported format
   */
  private async validateAudioStream(url: string): Promise<{
    isValid: boolean;
    contentType?: string;
    contentLength?: number;
    error?: string;
  }> {
    try {
      console.log(
        `[Audio] Validating audio stream: ${url.substring(0, 100)}...`,
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const response = await fetch(url, {
        method: "HEAD", // Use HEAD to avoid downloading the entire file
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Range: "bytes=0-1023", // Request first 1KB to test accessibility
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          isValid: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      const contentLength = parseInt(
        response.headers.get("content-length") || "0",
      );

      // Check if content type is supported by Expo AV
      const supportedTypes = [
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/wav",
        "audio/ogg",
        "audio/webm",
        "audio/aac",
        "audio/x-m4a",
        "application/octet-stream", // Sometimes used for audio files
      ];

      const isSupportedType = supportedTypes.some(
        (type) =>
          contentType.toLowerCase().includes(type) ||
          url.toLowerCase().includes(type.replace("audio/", "")),
      );

      if (!isSupportedType && contentType && !contentType.includes("audio")) {
        console.warn(`[Audio] Unsupported content type: ${contentType}`);
        return {
          isValid: false,
          contentType,
          contentLength,
          error: `Unsupported content type: ${contentType}`,
        };
      }

      // Check if file size is reasonable (at least 10KB for audio)
      if (contentLength > 0 && contentLength < 10240) {
        return {
          isValid: false,
          contentType,
          contentLength,
          error: "File too small to be valid audio",
        };
      }

      console.log(
        `[Audio] Stream validation successful: ${contentType}, ${contentLength} bytes`,
      );
      return {
        isValid: true,
        contentType,
        contentLength,
      };
    } catch (error) {
      console.error("[Audio] Stream validation failed:", error);
      return {
        isValid: false,
        error:
          error instanceof Error ? error.message : "Unknown validation error",
      };
    }
  }

  /**
   * Validate the integrity of a cached file
   */
  private async validateCachedFile(filePath: string): Promise<boolean> {
    try {
      const fileInfo = await FileSystem.getInfoAsync(filePath);

      if (!fileInfo.exists || !fileInfo.size || fileInfo.size === 0) {
        console.warn(
          "[Audio] File validation failed: file doesn't exist or is empty",
        );
        return false;
      }

      // Check minimum file size (10KB for meaningful audio data)
      if (fileInfo.size < 10240) {
        console.warn(
          `[Audio] File validation failed: file too small (${fileInfo.size} bytes)`,
        );
        return false;
      }

      // Check if file can be read (basic corruption check)
      try {
        const testRead = await FileSystem.readAsStringAsync(filePath, {
          encoding: FileSystem.EncodingType.Base64,
          length: 1024, // Read first 1KB to test file integrity
        });

        if (!testRead || testRead.length === 0) {
          console.warn(
            "[Audio] File validation failed: cannot read file content",
          );
          return false;
        }
      } catch (readError) {
        console.warn("[Audio] File validation failed: read error", readError);
        return false;
      }

      console.log(`[Audio] File validation passed for: ${filePath}`);
      return true;
    } catch (error) {
      console.warn("[Audio] File validation error:", error);
      return false;
    }
  }

  /**
   * Clean up partial/incomplete cached files
   */
  private async cleanupPartialCache(trackId: string): Promise<void> {
    try {
      console.log(`[Audio] Cleaning up partial cache for track: ${trackId}`);

      // Get the best available cache directory
      const cacheDir = await this.getCacheDirectory();
      if (!cacheDir) {
        console.warn("[Audio] No cache directory available for cleanup");
        return;
      }

      const audioCacheDir = cacheDir + "audio_cache/";
      const possibleFiles = [
        audioCacheDir + trackId + ".mp3",
        audioCacheDir + trackId + ".mp3.full",
        audioCacheDir + trackId + ".mp3.chunks",
        audioCacheDir + trackId + ".mp3.chunks.current",
      ];

      for (const filePath of possibleFiles) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(filePath);
          if (fileInfo.exists) {
            await FileSystem.deleteAsync(filePath, { idempotent: true });
            console.log(`[Audio] Cleaned up partial file: ${filePath}`);
          }
        } catch (cleanupError) {
          console.warn(
            `[Audio] Failed to clean up file ${filePath}:`,
            cleanupError,
          );
        }
      }

      // Preserve essential information for resume operations
      const existingProgress = this.cacheProgress.get(trackId);
      if (existingProgress?.originalStreamUrl) {
        // Keep minimal progress with original URL for resume capability
        this.cacheProgress.set(trackId, {
          percentage: 0,
          lastFileSize: 0,
          downloadedSize: 0,
          downloadSpeed: 0,
          isDownloading: false,
          estimatedTotalSize: existingProgress.estimatedTotalSize || 0,
          isFullyCached: false,
          originalStreamUrl: existingProgress.originalStreamUrl,
          lastUpdate: Date.now(),
          retryCount: existingProgress.retryCount || 0,
          downloadStartTime: Date.now(),
        });
        console.log(
          `[Audio] Preserved original URL for track: ${trackId} during cleanup`,
        );
      } else {
        // Clear cache progress for this track if no URL to preserve
        this.cacheProgress.delete(trackId);
      }

      console.log(
        `[Audio] Partial cache cleanup completed for track: ${trackId}`,
      );
    } catch (error) {
      console.warn(
        `[Audio] Error during partial cache cleanup for ${trackId}:`,
        error,
      );
    }
  }

  /**
   * Estimate total file size based on current downloaded size
   * Uses conservative estimates to prevent percentage drops
   */
  private estimateTotalFileSize(fileSize: number): number {
    let estimatedTotalSize: number;

    if (fileSize >= 10485760) {
      // 10MB+ - likely complete or near-complete, but cap at 12MB
      estimatedTotalSize = Math.min(fileSize * 1.2, 12582912); // 20% buffer, max 12MB
    } else if (fileSize >= 7340032) {
      // 7-10MB - estimate 10-12MB total with buffer
      estimatedTotalSize = Math.max(10485760, fileSize * 1.3); // Min 10MB, 30% buffer
    } else if (fileSize >= 5242880) {
      // 5-7MB - estimate 8-10MB total with buffer
      estimatedTotalSize = Math.max(8388608, fileSize * 1.4); // Min 8MB, 40% buffer
    } else if (fileSize >= 3145728) {
      // 3-5MB - estimate 6-8MB total with buffer
      estimatedTotalSize = Math.max(6291456, fileSize * 1.8); // Min 6MB, 80% buffer
    } else if (fileSize >= 2097152) {
      // 2-3MB - estimate 4-6MB total with buffer
      estimatedTotalSize = Math.max(4194304, fileSize * 2.0); // Min 4MB, 100% buffer
    } else if (fileSize >= 1048576) {
      // 1-2MB - estimate 3-4MB total with buffer
      estimatedTotalSize = Math.max(3145728, fileSize * 2.5); // Min 3MB, 150% buffer
    } else {
      // Less than 1MB - estimate 2-4MB total with buffer
      estimatedTotalSize = Math.max(2097152, fileSize * 4.0); // Min 2MB, 300% buffer
    }

    console.log(
      `[Audio] Estimated total size: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB for current size: ${Math.round((fileSize / 1024 / 1024) * 100) / 100}MB`,
    );

    return estimatedTotalSize;
  }

  /**
   * Get cache information for a track with improved state consistency
   */
  public async getCacheInfo(trackId: string): Promise<{
    percentage: number;
    fileSize: number;
    totalFileSize?: number;
    isFullyCached: boolean;
    isDownloading?: boolean;
    downloadSpeed?: number;
    retryCount?: number;
  }> {
    try {
      // Check cache first (with 5 second TTL)
      const cached = this.cacheInfoCache.get(trackId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_INFO_TTL) {
        console.log(
          `[Audio] Using cached cache info for ${trackId} (age: ${Date.now() - cached.timestamp}ms)`,
        );
        return cached.result;
      }

      console.log(`[Audio] === getCacheInfo START for ${trackId} ===`);

      // Check if we have any cached progress for this track (even completed downloads)
      const activeProgress = this.cacheProgress.get(trackId);
      console.log("[Audio] Active progress found:", !!activeProgress);
      if (activeProgress) {
        // If we have a completed download (100%) and confirmed fully cached, return that immediately
        if (
          activeProgress.percentage === 100 &&
          !activeProgress.isDownloading &&
          activeProgress.isFullyCached
        ) {
          console.log(
            `[Audio] Track ${trackId} is fully cached (100% confirmed)`,
          );
          const result = {
            percentage: 100,
            fileSize:
              activeProgress.downloadedSize || activeProgress.lastFileSize || 0,
            isFullyCached: true,
            isDownloading: false,
            downloadSpeed: 0,
            retryCount: 0,
          };
          console.log(
            `[Audio] === getCacheInfo END (100% cached) for ${trackId} ===`,
            result,
          );
          return result;
        }

        // If actively downloading, return current progress with consistency checks
        if (activeProgress.isDownloading) {
          // Ensure percentage doesn't decrease during active download
          const safePercentage = Math.max(
            activeProgress.percentage,
            activeProgress.lastFileSize > 0 ? 1 : 0,
          );
          const result = {
            percentage: safePercentage,
            fileSize:
              activeProgress.downloadedSize || activeProgress.lastFileSize || 0,
            isFullyCached: false,
            isDownloading: true,
            downloadSpeed: activeProgress.downloadSpeed || 0,
            retryCount: activeProgress.retryCount || 0,
          };
          console.log(
            `[Audio] === getCacheInfo END (downloading) for ${trackId} ===`,
            result,
          );
          return result;
        }

        // If we have substantial progress but not downloading, use stored state
        if (activeProgress.percentage > 0) {
          const result = {
            percentage: activeProgress.percentage,
            fileSize:
              activeProgress.downloadedSize || activeProgress.lastFileSize || 0,
            isFullyCached: activeProgress.isFullyCached || false,
            isDownloading: false,
            downloadSpeed: 0,
            retryCount: activeProgress.retryCount || 0,
          };
          console.log(
            `[Audio] === getCacheInfo END (stored progress) for ${trackId} ===`,
            result,
          );
          return result;
        }
      }

      // Check if we have any cached file
      const cachedFilePath = await this.getBestCachedFilePath(trackId);
      // console.log(`[Audio] Best cached file path: ${cachedFilePath}`);

      if (!cachedFilePath) {
        console.log(`[Audio] No cached file found for track: ${trackId}`);
        const result = { percentage: 0, fileSize: 0, isFullyCached: false };
        console.log(
          `[Audio] === getCacheInfo END (no file) for ${trackId} ===`,
          result,
        );
        return result;
      }

      // Get file info - remove file:// prefix for FileSystem.getInfoAsync
      const filePath = cachedFilePath.replace("file://", "");
      // console.log(`[Audio] Getting file info for path: ${filePath}`);
      let fileInfo = await FileSystem.getInfoAsync(filePath);
      // console.log("[Audio] File info:", fileInfo);

      // If file doesn't exist, try with the full path including file://
      if (!fileInfo || !fileInfo.exists) {
        console.log(
          `[Audio] Cached file not found at: ${filePath}, trying with file:// prefix`,
        );
        fileInfo = await FileSystem.getInfoAsync(cachedFilePath);
        // console.log("[Audio] File info (with file://):", fileInfo);
      }

      if (!fileInfo || !fileInfo.exists) {
        console.log(
          `[Audio] Cached file not found: ${filePath} or ${cachedFilePath}`,
        );
        const result = { percentage: 0, fileSize: 0, isFullyCached: false };
        console.log(
          `[Audio] === getCacheInfo END (file missing) for ${trackId} ===`,
          result,
        );
        return result;
      }

      // Check if it's fully cached or has substantial cache
      const isFullyCached = this.hasFullCachedFile(trackId);
      const hasSubstantialCache = this.soundCloudCache.has(
        trackId + "_substantial",
      );
      const fileSize = fileInfo.size || 0;

      console.log(
        `[Audio] Cache status for ${trackId}: fullyCached=${isFullyCached}, substantial=${hasSubstantialCache}, size=${fileSize} bytes`,
      );

      // For very small files (< 10KB), consider them as not meaningfully cached
      const minFileSize = 10240; // 10KB minimum
      if (fileSize < minFileSize) {
        console.log(
          `[Audio] File too small to be considered cached: ${fileSize} bytes (min: ${minFileSize})`,
        );
        const result = {
          percentage: 0,
          fileSize: Math.round((fileSize / 1024 / 1024) * 100) / 100,
          isFullyCached: false,
        };
        console.log(
          `[Audio] === getCacheInfo END (too small) for ${trackId} ===`,
          result,
        );
        return result;
      }

      // Calculate percentage based on file size with improved algorithm
      let percentage: number;
      let displayFileSize: number;
      let estimatedTotalSize: number;

      if (isFullyCached) {
        percentage = 100;
        displayFileSize = Math.round((fileSize / 1024 / 1024) * 10) / 10;
        estimatedTotalSize = fileSize;
      } else {
        // Use more accurate estimation based on actual file patterns
        // and any stored estimated total size
        const storedEstimatedSize = activeProgress?.estimatedTotalSize;

        if (storedEstimatedSize && storedEstimatedSize > fileSize) {
          // Use stored estimate if available and larger than current file
          estimatedTotalSize = storedEstimatedSize;
          console.log(
            `[Audio] Using stored estimated size: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB`,
          );
        } else {
          // Dynamic estimation based on file size patterns
          // Use more conservative estimates to prevent percentage drops
          if (fileSize >= 10485760) {
            // 10MB+ - likely complete or near-complete, but cap at 12MB
            estimatedTotalSize = Math.min(fileSize * 1.2, 12582912); // 20% buffer, max 12MB
            console.log(
              `[Audio] Large file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (20% buffer)`,
            );
          } else if (fileSize >= 7340032) {
            // 7-10MB - estimate 10-12MB total with buffer
            estimatedTotalSize = Math.max(10485760, fileSize * 1.3); // Min 10MB, 30% buffer
            console.log(
              `[Audio] Medium-large file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (30% buffer)`,
            );
          } else if (fileSize >= 5242880) {
            // 5-7MB - estimate 8-10MB total with buffer
            estimatedTotalSize = Math.max(8388608, fileSize * 1.4); // Min 8MB, 40% buffer
            console.log(
              `[Audio] Medium file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (40% buffer)`,
            );
          } else if (fileSize >= 3145728) {
            // 3-5MB - estimate 6-8MB total with buffer (this is our current case)
            estimatedTotalSize = Math.max(6291456, fileSize * 1.8); // Min 6MB, 80% buffer
            console.log(
              `[Audio] Small-medium file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (80% buffer)`,
            );
          } else if (fileSize >= 2097152) {
            // 2-3MB - estimate 4-6MB total with buffer
            estimatedTotalSize = Math.max(4194304, fileSize * 2.0); // Min 4MB, 100% buffer
            console.log(
              `[Audio] Small file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (100% buffer)`,
            );
          } else {
            // Less than 2MB - use conservative 4MB estimate
            estimatedTotalSize = 4194304; // 4MB
            console.log(
              `[Audio] Very small file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (fixed)`,
            );
          }
        }

        // Calculate percentage with better accuracy and stability
        const rawPercentage = (fileSize / estimatedTotalSize) * 100;

        // Apply stability rules to prevent percentage drops
        const existingPercentage = activeProgress?.percentage || 0;
        let stablePercentage = Math.min(99, Math.round(rawPercentage));

        // Never allow percentage to decrease significantly (more than 5%)
        if (stablePercentage < existingPercentage - 5) {
          console.log(
            `[Audio] Preventing percentage drop: ${existingPercentage}% -> ${stablePercentage}%`,
          );
          stablePercentage = Math.max(stablePercentage, existingPercentage - 2); // Allow max 2% drop
        }

        // If we're close to the estimated total, boost the estimate
        if (stablePercentage > 85 && fileSize > 0) {
          const newEstimatedTotal = Math.max(
            estimatedTotalSize,
            fileSize * 1.1,
          );
          if (newEstimatedTotal > estimatedTotalSize) {
            estimatedTotalSize = newEstimatedTotal;
            console.log(
              `[Audio] Boosting estimated total to prevent premature 100%: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB`,
            );
            // Recalculate percentage with new estimate
            const newRawPercentage = (fileSize / estimatedTotalSize) * 100;
            stablePercentage = Math.min(99, Math.round(newRawPercentage));
          }
        }

        percentage = stablePercentage;

        // Boost percentage for substantial cache but cap at 95%
        if (hasSubstantialCache && percentage < 90) {
          percentage = Math.min(95, percentage + 5);
          console.log(
            `[Audio] Boosting cache percentage for substantial cache: ${percentage}%`,
          );
        }

        displayFileSize = Math.round((fileSize / 1024 / 1024) * 100) / 100;
      }

      // Update the cache progress with calculated values for consistency
      if (activeProgress) {
        this.updateCacheProgress(trackId, percentage, displayFileSize, {
          estimatedTotalSize,
          isFullyCached: isFullyCached,
        });
      }

      console.log(
        `[Audio] Cache info for ${trackId}: ${percentage}% (${fileSize} bytes, ${isFullyCached ? "full" : "partial"})`,
      );
      console.log(
        `[Audio] Cache info details: percentage=${percentage}, displayFileSize=${displayFileSize}MB, isFullyCached=${isFullyCached}, estimatedTotal=${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB`,
      );

      const result = {
        percentage: percentage,
        fileSize: displayFileSize,
        totalFileSize:
          Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100,
        isFullyCached,
        isDownloading: false,
        downloadSpeed: 0,
        retryCount: 0,
      };
      console.log(`[Audio] === getCacheInfo END for ${trackId} ===`, result);

      // Cache the result for 5 seconds to prevent excessive filesystem calls
      this.cacheInfoCache.set(trackId, {
        result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      console.error(
        `[Audio] Error getting cache info for track ${trackId}:`,
        error,
      );
      const errorResult = {
        percentage: 0,
        fileSize: 0,
        totalFileSize: 0,
        isFullyCached: false,
      };

      // Cache the error result for 5 seconds to prevent excessive filesystem calls
      this.cacheInfoCache.set(trackId, {
        result: errorResult,
        timestamp: Date.now(),
      });

      return errorResult;
    }
  }

  /**
   * Get the original streaming URL for a track from cache progress
   * This is used for resume operations when cache gets stuck
   */
  public getOriginalStreamUrl(trackId: string): string | null {
    const progress = this.cacheProgress.get(trackId);
    return progress?.originalStreamUrl || null;
  }

  /**
   * Check if a specific playback position (in milliseconds) is likely to be cached
   * This estimates based on file size and typical audio bitrates
   */
  public async isPositionCached(
    trackId: string,
    positionMs: number,
  ): Promise<{ isCached: boolean; estimatedCacheEndMs: number }> {
    try {
      const cacheInfo = await this.getCacheInfo(trackId);

      if (cacheInfo.isFullyCached) {
        return { isCached: true, estimatedCacheEndMs: Number.MAX_SAFE_INTEGER };
      }

      if (cacheInfo.percentage === 0) {
        return { isCached: false, estimatedCacheEndMs: 0 };
      }

      // Estimate total duration based on typical audio file sizes
      // Assuming average bitrate of 128kbps (16KB/s) for streaming audio
      const averageBitrate = 128000; // 128 kbps in bits per second
      const bytesPerSecond = averageBitrate / 8; // 16 KB/s

      // Convert file size to estimated duration
      const actualFileSizeBytes = cacheInfo.fileSize * 1024 * 1024; // Convert MB back to bytes
      const estimatedCacheDurationMs =
        (actualFileSizeBytes / bytesPerSecond) * 1000;

      // Add a 5-second buffer to account for variations
      const bufferMs = 5000;
      const estimatedCacheEndMs = estimatedCacheDurationMs + bufferMs;

      console.log(
        `[Audio] Position check for ${trackId}: position=${positionMs}ms, cached=${estimatedCacheEndMs}ms, fileSize=${cacheInfo.fileSize}MB`,
      );

      return {
        isCached: positionMs <= estimatedCacheEndMs,
        estimatedCacheEndMs: Math.round(estimatedCacheEndMs),
      };
    } catch (error) {
      console.error(
        `[Audio] Error checking position cache for track ${trackId}:`,
        error,
      );
      return { isCached: false, estimatedCacheEndMs: 0 };
    }
  }

  /**
   * Clear cached SoundCloud stream for a specific track
   */
  public async clearSoundCloudCache(trackId?: string) {
    if (trackId) {
      const cachedFilePath = this.soundCloudCache.get(trackId);
      if (cachedFilePath) {
        try {
          // Delete the cached file
          await FileSystem.deleteAsync(cachedFilePath, { idempotent: true });
          this.soundCloudCache.delete(trackId);
          // Clear cache info cache since the file was deleted
          this.clearCacheInfoCache(trackId);
        } catch (error) {
          console.warn(
            `[Audio] Failed to delete cached file for track ${trackId}:`,
            error,
          );
        }
      }
    } else {
      // Clear all cached tracks
      for (const [id, filePath] of Array.from(this.soundCloudCache.entries())) {
        try {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        } catch (error) {
          console.warn(
            `[Audio] Failed to delete cached file for track ${id}:`,
            error,
          );
        }
      }
      this.soundCloudCache.clear();
    }
  }

  /**
   * Clear cached track for a specific track or all tracks (generic cache for all track types)
   */
  public async clearTrackCache(trackId?: string) {
    if (trackId) {
      const cachedFilePath = this.trackCache.get(trackId);
      if (cachedFilePath) {
        try {
          // Delete the cached file
          await FileSystem.deleteAsync(cachedFilePath, { idempotent: true });
          this.trackCache.delete(trackId);
          // Clear cache info cache since the file was deleted
          this.clearCacheInfoCache(trackId);
        } catch (error) {
          console.warn(
            `[Audio] Failed to delete cached file for track ${trackId}:`,
            error,
          );
        }
      }
    } else {
      // Clear all cached tracks
      for (const [id, filePath] of Array.from(this.trackCache.entries())) {
        try {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        } catch (error) {
          console.warn(
            `[Audio] Failed to delete cached file for track ${id}:`,
            error,
          );
        }
      }
      this.trackCache.clear();
    }
  }

  /**
   * Progressive YouTube caching - returns stream URL immediately and caches in background
   * This allows immediate playback while caching happens asynchronously
   * The player will switch to cached file once enough data is available
   */
  private async cacheYouTubeStream(
    streamUrl: string,
    trackId: string,
    controller: AbortController,
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping YouTube caching for non-remote URL");
      return streamUrl;
    }
    // Check if we already have this track cached (use generic track cache)
    if (this.trackCache.has(trackId)) {
      const cachedPath = this.trackCache.get(trackId);
      console.log(
        `[Audio] Using existing cached file for YouTube track: ${trackId}`,
      );
      console.log(`[Audio] YouTube cached path: ${cachedPath}`);
      // Return the cached path with file:// prefix
      return cachedPath.startsWith("file://")
        ? cachedPath
        : `file://${cachedPath}`;
    }

    // Fallback to SoundCloud cache for backward compatibility
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId);
      console.log(
        `[Audio] Using existing cached file for YouTube track: ${trackId}`,
      );
      console.log(`[Audio] YouTube cached path: ${cachedPath}`);
      // Return the cached path with file:// prefix
      return cachedPath.startsWith("file://")
        ? cachedPath
        : `file://${cachedPath}`;
    }

    console.log(
      `[Audio] Starting progressive YouTube caching for track: ${trackId}`,
    );

    // Start background caching immediately without waiting
    this.startProgressiveYouTubeCache(streamUrl, trackId, controller).catch(
      (error) => {
        console.error(
          `[Audio] Progressive YouTube cache failed for ${trackId}:`,
          error,
        );
      },
    );

    // Return the stream URL immediately for instant playback
    console.log(
      `[Audio] Returning stream URL immediately for track: ${trackId} (caching in background)`,
    );
    return streamUrl;
  }

  /**
   * Cache the first megabyte of a SoundCloud stream for pre-buffering
   * This downloads the first chunk in the background and returns the cached file path when ready
   * The cache is used to reduce initial buffering time and improve playback quality
   */
  private async cacheSoundCloudStream(
    streamUrl: string,
    trackId: string,
    controller: AbortController,
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping SoundCloud caching for non-remote URL");
      return streamUrl;
    }
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId);
      // Return the cached path with file:// prefix
      return `file://${cachedPath}`;
    }

    // Always wait for cache completion before playing
    try {
      const cachedFilePath = await this.cacheSoundCloudStreamAsync(
        streamUrl,
        trackId,
        controller,
      );
      return cachedFilePath;
    } catch (error) {
      // If caching fails completely, return the original stream URL as fallback
      return streamUrl;
    }
  }

  /**
   * Continue downloading the full track in the background after initial 1MB cache
   * This helps prevent buffering during playback
   */
  private async downloadFullTrackInBackground(
    streamUrl: string,
    cacheFilePath: string,
    trackId: string,
    controller: AbortController,
  ): Promise<void> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping full track download for non-remote URL");
      return;
    }
    try {
      // Check if already downloading to prevent concurrent downloads
      const existingProgress = this.cacheProgress.get(trackId);
      if (existingProgress?.isDownloading) {
        console.log(
          `[Audio] Download already in progress for track: ${trackId}`,
        );
        return;
      }

      // Mark download as started with URL persistence
      this.markDownloadStarted(trackId, streamUrl);

      console.log(`[Audio] Starting full track download for track: ${trackId}`);

      // Ensure proper file:// prefix for the full file path
      const fullFilePath = cacheFilePath + ".full";
      const properFullFilePath = fullFilePath.startsWith("file://")
        ? fullFilePath
        : `file://${fullFilePath}`;

      // First, let's try to get the full track by downloading without range header
      // This will give us the complete file
      const fullDownloadResult = await FileSystem.downloadAsync(
        streamUrl,
        properFullFilePath,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        },
      );

      if (
        fullDownloadResult.status === 200 ||
        fullDownloadResult.status === 206
      ) {
        console.log(
          `[Audio] Full track download completed for track: ${trackId}`,
        );

        // Check if the full download is actually significantly larger than the partial cache
        const fullFileInfo = await FileSystem.getInfoAsync(properFullFilePath);
        const partialFileInfo = await FileSystem.getInfoAsync(cacheFilePath);

        const fullSize = fullFileInfo.exists ? fullFileInfo.size : 0;
        const partialSize = partialFileInfo.exists ? partialFileInfo.size : 0;

        console.log(
          `[Audio] Full file size: ${fullSize} bytes, Partial file size: ${partialSize} bytes`,
        );

        // Only consider it a successful full download if it's significantly larger
        // or if we got a 200 status (indicating complete file)
        const isSignificantlyLarger = fullSize > partialSize + 1048576; // At least 1MB larger
        const isCompleteDownload =
          fullDownloadResult.status === 200 || isSignificantlyLarger;

        if (fullFileInfo.exists && fullSize > 3145728 && isCompleteDownload) {
          // At least 3MB and complete
          console.log(
            `[Audio] Replacing partial cache with full file for track: ${trackId}`,
          );

          // Replace the partial cache with the full file for future plays (use generic track cache)
          this.trackCache.set(trackId + "_full", properFullFilePath);
          this.trackCache.set(trackId, properFullFilePath);
          this.trackCache.set(trackId + "_has_full", "true");

          // Mark download as completed
          this.markDownloadCompleted(trackId, fullSize / (1024 * 1024)); // Convert to MB

          console.log(
            `[Audio] Full file cache updated for track: ${trackId} (${fullSize} bytes)`,
          );
        } else {
          console.log(
            `[Audio] Full download not significantly larger, keeping partial cache for track: ${trackId}`,
          );
          // Clean up the failed full download
          try {
            await FileSystem.deleteAsync(properFullFilePath, {
              idempotent: true,
            });
          } catch (cleanupError) {
            console.warn(
              "[Audio] Failed to clean up partial full download:",
              cleanupError,
            );
          }
        }
      } else {
        // If full download fails, try downloading the rest in chunks
        console.log(
          `[Audio] Full download failed, trying chunked download for track: ${trackId}`,
        );
        await this.downloadTrackInChunks(
          streamUrl,
          cacheFilePath,
          trackId,
          controller,
        );
      }
    } catch (error) {
      console.warn(
        `[Audio] Full track download failed for track ${trackId}:`,
        error,
      );

      // Mark download as failed and check retry logic
      const progress = this.cacheProgress.get(trackId);
      if (progress && progress.retryCount < this.MAX_RETRY_ATTEMPTS) {
        console.log(
          `[Audio] Retrying download for track ${trackId} (attempt ${progress.retryCount + 1}/${this.MAX_RETRY_ATTEMPTS})`,
        );

        // Increment retry count
        this.cacheProgress.set(trackId, {
          ...progress,
          retryCount: progress.retryCount + 1,
          lastUpdate: Date.now(),
        });

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));

        // Retry the download
        await this.downloadFullTrackInBackground(
          streamUrl,
          cacheFilePath,
          trackId,
          controller,
        );
      } else {
        // Mark download as failed
        if (progress) {
          this.cacheProgress.set(trackId, {
            ...progress,
            isDownloading: false,
            lastUpdate: Date.now(),
          });
        }
        console.error(
          `[Audio] Download failed permanently for track ${trackId} after ${progress?.retryCount || 0} attempts`,
        );

        // If full download fails, try downloading the rest in chunks
        console.log(
          `[Audio] Full download failed, trying chunked download for track: ${trackId}`,
        );
        await this.downloadTrackInChunks(
          streamUrl,
          cacheFilePath,
          trackId,
          controller,
        );
      }
      // Don't throw - this is background optimization
    } finally {
      // Always mark download as not in progress when done
      const progress = this.cacheProgress.get(trackId);
      if (progress) {
        this.cacheProgress.set(trackId, {
          ...progress,
          isDownloading: false,
          lastUpdate: Date.now(),
        });
      }
    }
  }

  /**
   * Download track in chunks to build a complete file progressively
   * This is used when full download fails but we want to build the complete file
   */
  private async downloadTrackInChunks(
    streamUrl: string,
    cacheFilePath: string,
    trackId: string,
    controller: AbortController,
  ): Promise<void> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping chunked download for non-remote URL");
      return;
    }
    try {
      console.log(`[Audio] Starting chunked download for track: ${trackId}`);

      // Check if we have existing cache to determine starting position
      const cacheFileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      const startFrom5MB = cacheFileInfo.exists;

      // Start from 5MB if we have existing cache, otherwise start from beginning
      let currentPosition = startFrom5MB ? 5242880 : 0;
      const chunkSize = 2 * 1024 * 1024; // 2MB chunks
      let totalDownloaded = startFrom5MB ? 5242880 : 0; // We already have first 5MB if resuming

      // Create a temporary file for the chunks
      const tempFilePath = cacheFilePath + ".chunks";

      // Check if cache file exists, if not create empty temp file
      if (cacheFileInfo.exists) {
        // Copy existing cache to temp file
        await FileSystem.copyAsync({
          from: cacheFilePath,
          to: tempFilePath,
        });
        console.log(
          `[Audio] Copied existing cache (${totalDownloaded} bytes) to temp file`,
        );
      } else {
        // Create empty temp file for fresh download
        await FileSystem.writeAsStringAsync(tempFilePath, "", {
          encoding: FileSystem.EncodingType.Base64,
        });
        totalDownloaded = 0; // Reset since we're starting fresh
        console.log("[Audio] Created empty temp file for fresh download");
      }

      // Mark download as started with initial progress and URL persistence
      this.markDownloadStarted(trackId, streamUrl);
      this.updateDownloadProgress(trackId, totalDownloaded / (1024 * 1024), 0);

      let lastProgressUpdate = Date.now();
      const progressUpdateInterval = 1000; // Update progress every 1 second

      while (!controller.signal.aborted) {
        const endPosition = currentPosition + chunkSize - 1;

        try {
          console.log(
            `[Audio] Downloading chunk ${currentPosition}-${endPosition} for track: ${trackId}`,
          );

          const chunkResult = await FileSystem.downloadAsync(
            streamUrl,
            tempFilePath + ".current",
            {
              headers: {
                Range: `bytes=${currentPosition}-${endPosition}`,
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              },
              sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
            },
          );

          if (chunkResult.status === 200 || chunkResult.status === 206) {
            // Append the chunk to our temp file
            const chunkContent = await FileSystem.readAsStringAsync(
              tempFilePath + ".current",
              { encoding: FileSystem.EncodingType.Base64 },
            );

            // Read existing content and append new chunk
            const existingContent = await FileSystem.readAsStringAsync(
              tempFilePath,
              { encoding: FileSystem.EncodingType.Base64 },
            );

            // Decode both base64 strings to binary, concatenate, then re-encode
            const existingBinary = toByteArray(existingContent);
            const chunkBinary = toByteArray(chunkContent);
            const combinedBinary = new Uint8Array(
              existingBinary.length + chunkBinary.length,
            );
            combinedBinary.set(existingBinary);
            combinedBinary.set(chunkBinary, existingBinary.length);
            const combinedBase64 = fromByteArray(combinedBinary);

            await FileSystem.writeAsStringAsync(tempFilePath, combinedBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });

            // Clear cache info cache since we updated the file
            this.clearCacheInfoCache(trackId);

            const chunkSizeDownloaded = chunkResult.headers?.["content-length"]
              ? parseInt(chunkResult.headers["content-length"])
              : chunkSize;

            totalDownloaded += chunkSizeDownloaded;
            currentPosition += chunkSize;

            console.log(
              `[Audio] Downloaded chunk, total: ${totalDownloaded} bytes`,
            );

            // Update progress every second to avoid too frequent updates
            const now = Date.now();
            if (now - lastProgressUpdate >= progressUpdateInterval) {
              this.updateDownloadProgress(
                trackId,
                totalDownloaded / (1024 * 1024),
                0,
              );
              lastProgressUpdate = now;
            }

            // If we got less data than requested, we might be at the end
            if (chunkSizeDownloaded < chunkSize) {
              console.log(
                `[Audio] Reached end of file, total downloaded: ${totalDownloaded} bytes`,
              );
              break;
            }
          } else {
            // If we get a 416 (Range Not Satisfiable), we've reached the end
            if (chunkResult.status === 416) {
              console.log(
                `[Audio] Reached end of file (416 response) for track: ${trackId}`,
              );
              break;
            }
            throw new Error(
              `Chunk download failed with status: ${chunkResult.status}`,
            );
          }
        } catch (error) {
          console.warn(
            `[Audio] Chunk download failed at position ${currentPosition}:`,
            error,
          );
          // If we can't download more chunks, stop and use what we have
          break;
        }
      }

      // Final progress update
      this.updateDownloadProgress(trackId, totalDownloaded / (1024 * 1024), 0);

      // Replace the original cache with our enhanced file
      if (totalDownloaded > 5242880) {
        console.log(
          `[Audio] Replacing cache with enhanced file (${totalDownloaded} bytes) for track: ${trackId}`,
        );
        await FileSystem.moveAsync({
          from: tempFilePath,
          to: cacheFilePath,
        });

        // If we downloaded significantly more than the initial 5MB,
        // mark this as having a substantial cache
        if (totalDownloaded > 7340032) {
          // More than 7MB total
          console.log(
            `[Audio] Marking track as having substantial cache for track: ${trackId}`,
          );
          this.trackCache.set(trackId + "_substantial", "true");
        }

        // Mark download as completed
        this.markDownloadCompleted(trackId, totalDownloaded / (1024 * 1024));

        // Clean up temp files
        try {
          await FileSystem.deleteAsync(tempFilePath + ".current", {
            idempotent: true,
          });
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      console.warn(
        `[Audio] Chunked download failed for track ${trackId}:`,
        error,
      );

      // Check if we should retry
      const progress = this.cacheProgress.get(trackId);
      if (progress && progress.retryCount < this.MAX_RETRY_ATTEMPTS) {
        console.log(
          `[Audio] Retrying chunked download for track ${trackId} (attempt ${progress.retryCount + 1}/${this.MAX_RETRY_ATTEMPTS})`,
        );

        // Increment retry count and wait before retry
        this.cacheProgress.set(trackId, {
          ...progress,
          retryCount: progress.retryCount + 1,
          lastUpdate: Date.now(),
        });

        await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY));

        // Retry the chunked download
        await this.downloadTrackInChunks(
          streamUrl,
          cacheFilePath,
          trackId,
          controller,
        );
      } else {
        // Mark download as failed
        if (progress) {
          this.cacheProgress.set(trackId, {
            ...progress,
            isDownloading: false,
            lastUpdate: Date.now(),
          });
        }
        console.error(
          `[Audio] Chunked download failed permanently for track ${trackId} after ${progress?.retryCount || 0} attempts`,
        );
      }
    } finally {
      // Always mark download as not in progress when done
      const progress = this.cacheProgress.get(trackId);
      if (progress) {
        this.cacheProgress.set(trackId, {
          ...progress,
          isDownloading: false,
          lastUpdate: Date.now(),
        });
      }
    }
  }

  /**
   * Progressive YouTube caching - starts background download without blocking playback
   * This method downloads the first chunk quickly and continues downloading in background
   */
  public async startProgressiveYouTubeCache(
    streamUrl: string,
    trackId: string,
    controller: AbortController,
  ): Promise<void> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping progressive YouTube cache for non-remote URL",
      );
      return;
    }
    console.log(
      `[Audio] Starting progressive cache for YouTube track: ${trackId}`,
    );
    console.log(
      `[Audio] Stream URL: ${streamUrl ? "present" : "missing"}, Controller: ${controller ? "present" : "missing"}`,
    );

    // Start with a small initial chunk for quick startup
    const initialChunkSize = 256 * 1024; // 256KB for very fast startup

    try {
      // First, try to download a small initial chunk quickly
      const cacheDir = await this.getCacheDirectory();
      console.log(`[Audio] Got cache directory: ${cacheDir}`);
      if (!cacheDir) {
        console.warn(
          "[Audio] No cache directory available for progressive caching",
        );
        return;
      }

      const cacheFilePath = `${cacheDir}${trackId}.cache`;
      console.log(`[Audio] Cache file path: ${cacheFilePath}`);
      const properCacheFilePath = cacheFilePath.startsWith("file://")
        ? cacheFilePath
        : `file://${cacheFilePath}`;

      // Mark download as started
      this.markDownloadStarted(trackId, streamUrl);

      // Try to download initial chunk with range request
      let initialChunkDownloaded = false;
      let initialResult: any = null;
      try {
        console.log(
          `[Audio] Downloading initial ${initialChunkSize} bytes for quick startup`,
        );
        console.log(`[Audio] Download URL: ${streamUrl.substring(0, 100)}...`);
        console.log(`[Audio] Target cache file: ${properCacheFilePath}`);

        initialResult = await FileSystem.downloadAsync(
          streamUrl,
          properCacheFilePath,
          {
            headers: {
              Range: `bytes=0-${initialChunkSize - 1}`,
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              Referer: "https://www.youtube.com/",
              Origin: "https://www.youtube.com/",
            },
            sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
          },
        );

        console.log(
          `[Audio] Initial download result status: ${initialResult.status}`,
        );
        console.log(
          "[Audio] Initial download result headers:",
          initialResult.headers,
        );

        if (initialResult.status === 200 || initialResult.status === 206) {
          initialChunkDownloaded = true;
          const fileInfo = await FileSystem.getInfoAsync(properCacheFilePath);
          if (fileInfo.exists) {
            console.log(
              `[Audio] Initial chunk downloaded: ${fileInfo.size} bytes (status: ${initialResult.status})`,
            );

            // Store in cache immediately so player can use it
            this.trackCache.set(trackId, properCacheFilePath);

            // Update progress
            this.updateCacheProgress(
              trackId,
              10, // 10% progress for initial chunk
              fileInfo.size / (1024 * 1024),
              {
                isDownloading: true,
                estimatedTotalSize: this.estimateTotalFileSize(fileInfo.size),
              },
            );
          } else {
            console.warn("[Audio] File info not available for initial chunk");
          }

          console.log(
            "[Audio] Initial chunk cached, player can start immediately",
          );
        } else {
          console.log(
            `[Audio] Initial chunk download unexpected status: ${initialResult.status}`,
          );
        }
      } catch (initialError) {
        console.log(
          "[Audio] Initial chunk download failed, will try full download:",
        );
        console.log(
          "[Audio] Error details:",
          initialError instanceof Error
            ? {
                message: initialError.message,
                stack: initialError.stack,
                name: initialError.name,
              }
            : initialError,
        );
        console.log(
          `[Audio] Initial download status: ${initialResult?.status || "unknown"}`,
        );
        console.log(
          "[Audio] Initial download headers:",
          initialResult?.headers || "no headers",
        );
      }

      // Continue with the full caching process in background
      this.cacheYouTubeStreamAsync(streamUrl, trackId, controller).catch(
        (error) => {
          console.error(
            `[Audio] Background caching failed for ${trackId}:`,
            error,
          );
        },
      );
    } catch (error) {
      console.error(
        `[Audio] Progressive caching setup failed for ${trackId}:`,
        error,
      );
      // Fallback to regular background caching
      this.cacheYouTubeStreamAsync(streamUrl, trackId, controller).catch(
        (bgError) => {
          console.error(
            `[Audio] Fallback background caching failed for ${trackId}:`,
            bgError,
          );
        },
      );
    }
  }

  /**
   * Background caching of YouTube stream - doesn't block playback
   */
  private async cacheYouTubeStreamAsync(
    streamUrl: string,
    trackId: string,
    controller: AbortController,
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping background YouTube cache for non-remote URL",
      );
      return streamUrl;
    }
    // Check if we already have this track cached
    if (this.trackCache.has(trackId)) {
      console.log(`[Audio] Background cache hit for YouTube track: ${trackId}`);
      const cachedPath = this.trackCache.get(trackId)!;
      return `file://${cachedPath}`;
    }

    console.log(
      `[Audio] Background caching first 5MB of YouTube stream for track: ${trackId}`,
    );

    // Get the best available cache directory
    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn(
        "[Audio] No cache directory available, skipping background caching",
      );
      return;
    }

    try {
      console.log(`[Audio] Using cache directory: ${cacheDir}`);
      // Directory is already tested and created by getCacheDirectory()

      // Test if we can write to the directory
      const testFile = `${cacheDir}test.txt`;
      try {
        await FileSystem.writeAsStringAsync(testFile, "test");
        await FileSystem.deleteAsync(testFile, { idempotent: true });
        console.log("[Audio] Cache directory is writable");
      } catch (writeError: any) {
        console.error("[Audio] Cache directory is not writable:", writeError);
        console.error("[Audio] Error details:", {
          message: writeError.message,
          code: writeError.code,
          directory: cacheDir,
          fileSystem: FileSystem.cacheDirectory,
        });
        // Continue without caching - return original stream URL
        console.log(
          "[Audio] Continuing without caching due to directory issues",
        );
        return streamUrl;
      }

      const cacheFilePath = `${cacheDir}${trackId}.cache`;
      const properCacheFilePath = cacheFilePath.startsWith("file://")
        ? cacheFilePath
        : `file://${cacheFilePath}`;

      // Mark download as started with URL persistence for YouTube tracks
      this.markDownloadStarted(trackId, streamUrl);

      // Check if we have a full file available first
      const fullFilePath = cacheFilePath + ".full";
      const properFullFilePath = fullFilePath.startsWith("file://")
        ? fullFilePath
        : `file://${fullFilePath}`;
      const fullFileInfo = await FileSystem.getInfoAsync(properFullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 1048576) {
        // Reduced from 5MB to 1MB
        console.log(
          `[Audio] Using existing full cached file for YouTube track: ${trackId}`,
        );
        this.trackCache.set(trackId, properFullFilePath);
        // Update progress to reflect completed state
        this.updateCacheProgress(
          trackId,
          100,
          fullFileInfo.size / (1024 * 1024),
          {
            isFullyCached: true,
          },
        );
        return properFullFilePath;
      }

      // Check if partial file exists
      const partialFileInfo =
        await FileSystem.getInfoAsync(properCacheFilePath);
      if (partialFileInfo.exists) {
        console.log(
          `[Audio] Using existing partial cached file for YouTube track: ${trackId}`,
        );
        this.trackCache.set(trackId, properCacheFilePath);
        // Update progress to reflect partial state
        const estimatedTotal = this.estimateTotalFileSize(partialFileInfo.size);
        const percentage = Math.min(
          95,
          Math.round((partialFileInfo.size / estimatedTotal) * 100),
        );
        this.updateCacheProgress(
          trackId,
          percentage,
          partialFileInfo.size / (1024 * 1024),
        );
        return properCacheFilePath;
      }

      // Download the first 1MB (1 * 1024 * 1024 bytes) of the stream - REDUCED for faster startup
      console.log(
        `[Audio] Downloading partial cache for YouTube track: ${trackId}`,
      );

      // Check if stream URL is valid
      if (!streamUrl) {
        console.log(`[Audio] Invalid stream URL, skipping cache: ${streamUrl}`);
        return streamUrl;
      }

      // Try without Range header first (YouTube often blocks range requests)
      let downloadResult;
      try {
        console.log(
          `[Audio] Attempting direct download from: ${streamUrl.substring(0, 50)}...`,
        );
        downloadResult = await FileSystem.downloadAsync(
          streamUrl,
          properCacheFilePath,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              Referer: "https://www.youtube.com/",
              Origin: "https://www.youtube.com/",
            },
            sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
          },
        );
        console.log(
          `[Audio] Direct download completed with status: ${downloadResult.status}`,
        );
      } catch (downloadError) {
        console.log(
          "[Audio] Direct download failed, trying with range header:",
          downloadError,
        );
        // Fallback to range request
        try {
          downloadResult = await FileSystem.downloadAsync(
            streamUrl,
            properCacheFilePath,
            {
              headers: {
                Range: "bytes=0-1048575", // Request first 1MB - REDUCED for faster startup
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                Referer: "https://www.youtube.com/",
                Origin: "https://www.youtube.com/",
              },
              sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
            },
          );
          console.log(
            `[Audio] Range download completed with status: ${downloadResult.status}`,
          );
        } catch (rangeError) {
          console.error("[Audio] Range download also failed:", rangeError);
          // If both fail, return original URL
          return streamUrl;
        }
      }

      if (downloadResult.status !== 200 && downloadResult.status !== 206) {
        console.log(
          `[Audio] Download failed with status: ${downloadResult.status}`,
        );
        console.log("[Audio] Response headers:", downloadResult.headers);
        throw new Error(
          `Failed to download YouTube stream chunk: ${downloadResult.status} - ${downloadResult.headers?.["content-type"] || "unknown content type"}`,
        );
      }

      // Check if file was actually created
      const downloadedFileInfo =
        await FileSystem.getInfoAsync(properCacheFilePath);
      console.log("[Audio] Downloaded file info:", downloadedFileInfo);

      console.log(
        `[Audio] Successfully cached YouTube stream ${downloadResult.headers?.["content-length"] || "unknown size"} bytes for track: ${trackId}`,
      );

      // Store in cache (use generic track cache for YouTube tracks)
      this.trackCache.set(trackId, properCacheFilePath);
      console.log(`[Audio] Stored cache file path: ${properCacheFilePath}`);

      // Verify the file was actually created and is accessible
      // const verifyFileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      // console.log(`[Audio] Verification - File info after caching:`, verifyFileInfo);

      // Continue downloading the rest of the file in the background
      this.downloadFullTrackInBackground(
        streamUrl,
        properCacheFilePath,
        trackId,
        controller,
      );

      console.log(
        `[Audio] YouTube background caching completed for track: ${trackId}`,
      );

      // Return the cached file path so the player uses the local file
      console.log(`[Audio] Returning cached file path: ${properCacheFilePath}`);
      return properCacheFilePath;
    } catch (error) {
      console.log(
        `[Audio] YouTube background caching failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
      console.log(
        `[Audio] YouTube stream URL: ${streamUrl.substring(0, 100)}...`,
      );

      // Try to get more error details
      if (error instanceof Error) {
        console.log(`[Audio] Error stack: ${error.stack}`);
      }

      // Log the error but don't fail - YouTube URLs expire quickly
      // We'll try again on the next playback attempt
      console.log(
        `[Audio] YouTube caching failed for ${trackId}, will retry next time`,
      );

      // Don't return the original stream URL since it's likely a blocked GoogleVideo URL
      // Instead, throw an error so the caller can try alternative approaches
      throw new Error(
        `YouTube caching failed: ${error instanceof Error ? error.message : "Unknown error"}. The GoogleVideo CDN URL appears to be blocked.`,
      );
    }
  }

  /**
   * Post-playback YouTube caching - cache after successful playback
   * This is more reliable since we have a working URL
   */
  public async cacheYouTubeStreamPostPlayback(
    streamUrl: string,
    trackId: string,
  ): Promise<void> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping post-playback YouTube cache for non-remote URL",
      );
      return;
    }
    // Skip if already cached
    if (this.soundCloudCache.has(trackId)) {
      console.log(`[Audio] YouTube track already cached: ${trackId}`);
      return;
    }

    console.log(
      `[Audio] Post-playback caching YouTube stream for track: ${trackId}`,
    );

    // Get the best available cache directory
    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn(
        "[Audio] No cache directory available, skipping post-playback caching",
      );
      return;
    }

    try {
      console.log(`[Audio] Using cache directory: ${cacheDir}`);
      // Directory is already tested and created by getCacheDirectory()

      const cacheFilePath = `${cacheDir}${trackId}.webm`;
      const fullFilePath = cacheFilePath + ".full";

      // Check if we already have a full file
      const fullFileInfo = await FileSystem.getInfoAsync(fullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 1048576) {
        // Reduced from 5MB to 1MB
        console.log(
          `[Audio] YouTube full cached file already exists for: ${trackId}`,
        );
        this.soundCloudCache.set(trackId, fullFilePath);
        return;
      }

      // Create a new controller for this download
      const controller = new AbortController();

      // Download the stream with a longer timeout since it's post-playback
      const downloadResult = await FileSystem.downloadAsync(
        streamUrl,
        cacheFilePath,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        },
      );

      if (downloadResult.status === 200) {
        console.log(
          `[Audio] YouTube stream downloaded successfully for: ${trackId}`,
        );

        // Check file size
        const fileInfo = await FileSystem.getInfoAsync(cacheFilePath);
        if (fileInfo.exists && fileInfo.size > 0) {
          console.log(
            `[Audio] YouTube cached file size: ${fileInfo.size} bytes`,
          );

          // If file is large enough, mark it as full
          if (fileInfo.size > 1048576) {
            // 1MB - Reduced from 5MB for faster startup
            await FileSystem.moveAsync({
              from: cacheFilePath,
              to: fullFilePath,
            });
            this.trackCache.set(trackId, fullFilePath);
            console.log(`[Audio] YouTube full cached file saved: ${trackId}`);
          } else {
            this.trackCache.set(trackId, cacheFilePath);
            console.log(
              `[Audio] YouTube partial cached file saved: ${trackId}`,
            );
          }
        }
      } else {
        console.log(
          `[Audio] YouTube download failed with status: ${downloadResult.status}`,
        );
        // Clean up partial file
        try {
          await FileSystem.deleteAsync(cacheFilePath);
          // Clear cache info cache since the file was deleted
          this.clearCacheInfoCache(trackId);
        } catch (cleanupError) {
          console.log(
            `[Audio] Failed to cleanup partial file: ${cleanupError}`,
          );
        }
      }
    } catch (error) {
      console.log(`[Audio] Post-playback YouTube caching failed: ${error}`);
      // Don't throw - this is background caching
    }
  }

  /**
   * Background caching of SoundCloud stream - doesn't block playback
   */
  private async cacheSoundCloudStreamAsync(
    streamUrl: string,
    trackId: string,
    controller: AbortController,
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping background SoundCloud cache for non-remote URL",
      );
      return streamUrl;
    }
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId)!;
      return `file://${cachedPath}`;
    }

    // Get the best available cache directory
    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn(
        "[Audio] No cache directory available, returning original stream URL",
      );
      return streamUrl;
    }

    try {
      console.log(`[Audio] Using cache directory: ${cacheDir}`);
      // Directory is already tested and created by getCacheDirectory()

      // Test if we can write to the directory
      const testFile = `${cacheDir}test.txt`;
      try {
        await FileSystem.writeAsStringAsync(testFile, "test");
        await FileSystem.deleteAsync(testFile, { idempotent: true });
      } catch (writeError: any) {
        // SoundCloud cache directory is not writable, continuing without caching
        return streamUrl;
      }

      const cacheFilePath = `${cacheDir}${trackId}.mp3`;

      // Check if we have a full file available first
      const fullFilePath = cacheFilePath + ".full";
      const fullFileInfo = await FileSystem.getInfoAsync(fullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 5242880) {
        this.soundCloudCache.set(trackId, fullFilePath);
        return `file://${fullFilePath}`; // Return the full cached file path
      }

      // Check if partial file exists
      const fileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      if (fileInfo.exists) {
        this.trackCache.set(trackId, cacheFilePath);
        return `file://${cacheFilePath}`; // Return the cached file path
      }

      // Download the first 5MB (5 * 1024 * 1024 bytes) of the stream
      // This is larger than the original 1MB to prevent early cutouts
      console.log(`[Audio] Downloading partial cache for track: ${trackId}`);
      const downloadResult = await FileSystem.downloadAsync(
        streamUrl,
        cacheFilePath,
        {
          headers: {
            Range: "bytes=0-5242879", // Request first 5MB (5 * 1024 * 1024 - 1)
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        },
      );

      if (downloadResult.status !== 200 && downloadResult.status !== 206) {
        throw new Error(
          `Failed to download stream chunk: ${downloadResult.status}`,
        );
      }

      // Store in cache (use generic track cache for YouTube tracks)
      this.trackCache.set(trackId, cacheFilePath);

      // Continue downloading the rest of the file in the background for better playback
      this.downloadFullTrackInBackground(
        streamUrl,
        cacheFilePath,
        trackId,
        controller,
      );

      // Return the cached file path so the player uses the local file
      return `file://${cacheFilePath}`;
    } catch (error) {
      // Don't throw - this is background caching, failures shouldn't affect playback
      // Return the original stream URL as fallback
      return streamUrl;
    }
  }

  /**
   * Cache a specific portion of a YouTube stream starting from a seek position
   * This is useful for caching from the current playback position
   */
  public async cacheYouTubeStreamFromPosition(
    streamUrl: string,
    trackId: string,
    startPosition: number, // Position in seconds
    controller: AbortController,
  ): Promise<string> {
    console.log(
      `[Audio] Caching YouTube stream from position ${startPosition}s for track: ${trackId}`,
    );

    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId);
      console.log(
        `[Audio] Using existing cached file for YouTube track: ${trackId}`,
      );
      return `file://${cachedPath}`;
    }

    // Estimate byte position based on bitrate (128kbps average for audio)
    const averageBitrate = 128000; // 128 kbps
    const startByte = Math.floor((startPosition * averageBitrate) / 8);
    const chunkSize = 512 * 1024; // 512KB chunks for smooth playback

    try {
      const cacheDir = await this.getCacheDirectory();
      if (!cacheDir) {
        console.warn(
          "[Audio] No cache directory available for position-based caching",
        );
        return streamUrl;
      }

      const cacheFilePath = `${cacheDir}${trackId}.cache`;

      // Mark download as started
      this.markDownloadStarted(trackId, streamUrl);

      // Download chunk starting from the calculated position
      console.log(
        `[Audio] Downloading chunk from byte ${startByte} for track: ${trackId}`,
      );

      const downloadResult = await FileSystem.downloadAsync(
        streamUrl,
        cacheFilePath,
        {
          headers: {
            Range: `bytes=${startByte}-${startByte + chunkSize - 1}`,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Referer: "https://www.youtube.com/",
            Origin: "https://www.youtube.com/",
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        },
      );

      if (downloadResult.status === 206) {
        const fileInfo = await FileSystem.getInfoAsync(cacheFilePath);
        if (fileInfo.exists) {
          console.log(
            `[Audio] Position-based chunk downloaded: ${fileInfo.size} bytes`,
          );

          // Store in cache (use generic track cache for YouTube tracks)
          this.trackCache.set(trackId, cacheFilePath);

          // Update progress
          this.updateCacheProgress(
            trackId,
            15, // 15% progress for position-based chunk
            fileInfo.size / (1024 * 1024),
            {
              isDownloading: true,
              estimatedTotalSize: this.estimateTotalFileSize(fileInfo.size),
            },
          );
        } else {
          console.warn(
            "[Audio] File info not available for position-based chunk",
          );
        }

        // Continue downloading the rest in background
        this.downloadFullTrackInBackground(
          streamUrl,
          cacheFilePath,
          trackId,
          controller,
        );

        return `file://${cacheFilePath}`;
      } else {
        console.log(
          `[Audio] Position-based download failed with status: ${downloadResult.status}`,
        );
        return streamUrl;
      }
    } catch (error) {
      console.error(
        `[Audio] Position-based caching failed for ${trackId}:`,
        error,
      );
      return streamUrl;
    }
  }

  /**
   * Continue caching a track in the background while it's playing
   * This method downloads the rest of the track incrementally
   */
  public async continueCachingTrack(
    streamUrl: string,
    trackId: string,
    controller: AbortController,
    onProgress?: (percentage: number) => void,
  ): Promise<void> {
    console.log(
      `[Audio] Starting continuous background caching for track: ${trackId}`,
    );

    try {
      // Get current cache status
      const cacheInfo = await this.getCacheInfo(trackId);

      if (cacheInfo.isFullyCached) {
        console.log(`[Audio] Track ${trackId} is already fully cached`);
        return;
      }

      // Get the cache directory
      const cacheDir = await this.getCacheDirectory();
      if (!cacheDir) {
        console.warn(
          "[Audio] No cache directory available for continuous caching",
        );
        return;
      }

      const cacheFilePath = `${cacheDir}${trackId}.cache`;
      const properCacheFilePath = cacheFilePath.startsWith("file://")
        ? cacheFilePath
        : `file://${cacheFilePath}`;

      // Check if cache file exists, if not create it
      const fileInfo = await FileSystem.getInfoAsync(properCacheFilePath);
      if (!fileInfo.exists) {
        console.log(
          `[Audio] Cache file doesn't exist, creating empty file at: ${properCacheFilePath}`,
        );
        await FileSystem.writeAsStringAsync(properCacheFilePath, "", {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      // Continue downloading in chunks until fully cached
      let currentPosition = cacheInfo.fileSize * 1024 * 1024; // Convert MB to bytes
      const chunkSize = 512 * 1024; // 512KB chunks
      let consecutiveErrors = 0;
      const maxErrors = 3;

      while (!controller.signal.aborted && consecutiveErrors < maxErrors) {
        // Get updated cache info for each iteration
        const currentCacheInfo = await this.getCacheInfo(trackId);
        if (currentCacheInfo.isFullyCached) {
          console.log(
            `[Audio] Track ${trackId} is now fully cached, stopping download`,
          );
          break;
        }
        try {
          console.log(
            `[Audio] Downloading chunk from position ${currentPosition} for ${trackId}`,
          );

          // Download next chunk
          const chunkFilePath = `${properCacheFilePath}.chunk_${currentPosition}`;
          const chunkResult = await FileSystem.downloadAsync(
            streamUrl,
            chunkFilePath,
            {
              headers: {
                Range: `bytes=${currentPosition}-${currentPosition + chunkSize - 1}`,
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                Referer: "https://www.youtube.com/",
                Origin: "https://www.youtube.com/",
              },
              sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
            },
          );

          if (chunkResult.status === 206 || chunkResult.status === 200) {
            // Append chunk to main file using binary-safe approach
            try {
              // Create a temporary combined file
              const tempCombinedPath = `${properCacheFilePath}.combined`;

              // First copy the existing file to temp location
              await FileSystem.copyAsync({
                from: properCacheFilePath,
                to: tempCombinedPath,
              });

              // Read both files as Base64 and combine them
              const existingContent = await FileSystem.readAsStringAsync(
                tempCombinedPath,
                { encoding: FileSystem.EncodingType.Base64 },
              );
              const chunkContent = await FileSystem.readAsStringAsync(
                chunkFilePath,
                { encoding: FileSystem.EncodingType.Base64 },
              );

              // Decode both base64 strings to binary, concatenate, then re-encode
              const existingBinary = toByteArray(existingContent);
              const chunkBinary = toByteArray(chunkContent);
              const combinedBinary = new Uint8Array(
                existingBinary.length + chunkBinary.length,
              );
              combinedBinary.set(existingBinary);
              combinedBinary.set(chunkBinary, existingBinary.length);
              const combinedBase64 = fromByteArray(combinedBinary);

              // Write combined content back
              await FileSystem.writeAsStringAsync(
                tempCombinedPath,
                combinedBase64,
                { encoding: FileSystem.EncodingType.Base64 },
              );

              // Replace the original file with the combined one
              await FileSystem.copyAsync({
                from: tempCombinedPath,
                to: properCacheFilePath,
              });

              // Clean up temp files
              await FileSystem.deleteAsync(tempCombinedPath, {
                idempotent: true,
              });

              console.log("[Audio] Successfully appended chunk to cache file");
            } catch (chunkCombineError) {
              console.error(
                "[Audio] Error combining chunk:",
                chunkCombineError,
              );
              // Fallback: just copy the chunk file to replace the original
              try {
                await FileSystem.copyAsync({
                  from: chunkFilePath,
                  to: properCacheFilePath,
                });
                console.log("[Audio] Fallback: Replaced cache file with chunk");
              } catch (fallbackError) {
                console.error("[Audio] Chunk fallback failed:", fallbackError);
                throw fallbackError;
              }
            }

            // Clean up chunk file
            await FileSystem.deleteAsync(chunkFilePath, { idempotent: true });

            // Update track cache with the combined file
            this.trackCache.set(trackId, properCacheFilePath);

            // Clear cache info cache since we updated the file
            this.clearCacheInfoCache(trackId);

            // Update position and check cache status
            currentPosition += chunkSize;
            consecutiveErrors = 0; // Reset error counter

            // Update cache info
            const updatedCacheInfo = await this.getCacheInfo(trackId);

            console.log(
              `[Audio] Chunk downloaded. Cache progress: ${updatedCacheInfo.percentage}%`,
            );
            onProgress?.(updatedCacheInfo.percentage);

            // Check if we're fully cached - allow completion at 95% to prevent getting stuck
            if (updatedCacheInfo.percentage >= 95) {
              console.log(
                `[Audio] Track ${trackId} is now fully cached at ${updatedCacheInfo.percentage}%!`,
              );
              this.markDownloadCompleted(trackId, updatedCacheInfo.fileSize);
              break;
            }

            // Update current position for next chunk
            currentPosition = updatedCacheInfo.fileSize * 1024 * 1024;

            // Small delay between chunks to be gentle on the server
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            console.log(
              `[Audio] Chunk download failed with status: ${chunkResult.status}`,
            );
            consecutiveErrors++;

            if (chunkResult.status === 416) {
              // Range not satisfiable - reached end of file
              console.log(`[Audio] Reached end of file for ${trackId}`);
              // Get final cache info and mark as completed
              const finalCacheInfo = await this.getCacheInfo(trackId);
              if (finalCacheInfo.percentage >= 95) {
                console.log(
                  `[Audio] File appears complete at ${finalCacheInfo.percentage}%, marking as fully cached`,
                );
                this.markDownloadCompleted(trackId, finalCacheInfo.fileSize);
              }
              break;
            }
          }
        } catch (chunkError) {
          console.error(
            `[Audio] Error downloading chunk for ${trackId}:`,
            chunkError,
          );
          consecutiveErrors++;

          // Wait a bit longer before retrying
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.log(`[Audio] Continuous caching completed for track: ${trackId}`);

      // Final check: if we're very close to completion, force mark as 100%
      try {
        const finalCacheInfo = await this.getCacheInfo(trackId);
        if (
          finalCacheInfo.percentage >= 95 &&
          finalCacheInfo.percentage < 100
        ) {
          console.log(
            `[Audio] Force completing cache at ${finalCacheInfo.percentage}% for ${trackId}`,
          );
          this.markDownloadCompleted(trackId, finalCacheInfo.fileSize);
        }
      } catch (finalCheckError) {
        console.warn(
          `[Audio] Final cache check failed for ${trackId}:`,
          finalCheckError,
        );
      }
    } catch (error) {
      console.error(`[Audio] Continuous caching failed for ${trackId}:`, error);
    }
  }

  static getInstance(): AudioStreamManager {
    if (!AudioStreamManager.instance) {
      AudioStreamManager.instance = new AudioStreamManager();
    }
    return AudioStreamManager.instance;
  }

  private setupFallbackStrategies() {
    // Strategy 1: YouTube Omada (fastest for YouTube - added for priority)
    this.fallbackStrategies.push(this.tryYouTubeOmada.bind(this));
    // Strategy 2: Local extraction server (if available)
    this.fallbackStrategies.push(this.tryLocalExtraction.bind(this));
    // Strategy 3: SoundCloud API (high priority for music)
    // this.fallbackStrategies.push(this.trySoundCloud.bind(this));
    // Strategy 4: YouTube Music extraction
    this.fallbackStrategies.push(this.tryYouTubeMusic.bind(this));
    // Strategy 5: Spotify Web API (requires auth but has good coverage)
    // this.fallbackStrategies.push(this.trySpotifyWebApi.bind(this));
    // Strategy 6: Hyperpipe API
    this.fallbackStrategies.push(this.tryHyperpipe.bind(this));
    // Strategy 7: Piped API (alternative to Invidious)
    this.fallbackStrategies.push(this.tryPiped.bind(this));
    // Strategy 8: YouTube embed extraction (last resort)
    this.fallbackStrategies.push(this.tryYouTubeEmbed.bind(this));
    // Note: YouTube Omada is handled exclusively in getAudioUrl for youtube/yt sources
  }

  async getAudioUrl(
    videoId: string,
    onStatusUpdate?: (status: string) => void,
    source?: string,
    trackTitle?: string,
    trackArtist?: string,
  ): Promise<string> {
    // Store track information for better SoundCloud searching
    this.currentTrackTitle = trackTitle;
    this.currentTrackArtist = trackArtist;

    console.log("[AudioStreamManager] getAudioUrl called with:", {
      videoId,
      source,
      trackTitle,
      trackArtist,
    });

    // Check if we have a prefetched result
    const prefetched = this.prefetchQueue.get(videoId);
    if (prefetched) {
      onStatusUpdate?.("Using prefetched audio");
      return prefetched;
    }

    // Always ensure caching before playing
    onStatusUpdate?.("Ensuring audio is cached before playback...");

    // --- SOUNDCLOUD HANDLING (exclusive) ---
    if (source === "soundcloud") {
      onStatusUpdate?.("Using SoundCloud strategy (exclusive)");
      console.log(
        `[AudioStreamManager] SoundCloud mode activated for: ${videoId}`,
      );
      try {
        console.log(
          `[Audio] Attempting SoundCloud extraction for track: ${videoId}`,
        );
        const soundCloudUrl = await this.trySoundCloud(
          videoId,
          this.currentTrackTitle,
          this.currentTrackArtist,
        );

        if (soundCloudUrl) {
          if (!soundCloudUrl.startsWith("file://")) {
            onStatusUpdate?.("Caching SoundCloud audio...");
            const controller = new AbortController();
            const cachedUrl = await this.cacheSoundCloudStream(
              soundCloudUrl,
              videoId,
              controller,
            );
            return cachedUrl;
          }

          return soundCloudUrl;
        } else {
          throw new Error("SoundCloud extraction returned no URL");
        }
      } catch (error) {
        console.error(
          "[AudioStreamManager] SoundCloud extraction failed:",
          error,
        );
        throw new Error(
          `SoundCloud playback failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    // --- YOUTUBE EXCLUSIVE HANDLING (only use YouTube Omada API) ---
    if (source === "youtube" || source === "yt") {
      onStatusUpdate?.("Using YouTube Omada API (exclusive)");
      console.log(
        `[AudioStreamManager] YouTube mode activated for: ${videoId}`,
      );
      try {
        console.log(
          `[Audio] Attempting YouTube Omada extraction for track: ${videoId}`,
        );
        const youtubeUrl = await this.tryYouTubeOmada(videoId);

        if (youtubeUrl) {
          console.log(
            `[AudioStreamManager] YouTube Omada returned URL: ${youtubeUrl.substring(0, 100)}...`,
          );
          // Cache the YouTube stream and return cached file path
          onStatusUpdate?.("Caching YouTube audio...");
          const controller = new AbortController();
          const cachedUrl = await this.cacheYouTubeStream(
            youtubeUrl,
            videoId,
            controller,
          );
          return cachedUrl;
        } else {
          console.error("[AudioStreamManager] YouTube Omada returned no URL");
          throw new Error("YouTube Omada extraction returned no URL");
        }
      } catch (error) {
        // YouTube Omada strategy failed, do not try fallback strategies
        console.error(
          "[AudioStreamManager] YouTube Omada extraction failed:",
          error,
        );
        throw new Error(
          `YouTube playback failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    // --- JIOSAAVN HANDLING (exclusive - no fallbacks) ---
    if (source === "jiosaavn") {
      onStatusUpdate?.("Using JioSaavn strategy (exclusive)");
      console.log(
        `[AudioStreamManager] JioSaavn mode activated for: ${videoId}`,
      );
      try {
        console.log(
          `[Audio] Attempting JioSaavn extraction for track: ${videoId}`,
        );
        const jioSaavnUrl = await this.tryJioSaavn(videoId);

        if (jioSaavnUrl) {
          // JioSaavn URLs are typically direct streaming URLs, return as-is
          return jioSaavnUrl;
        } else {
          throw new Error("JioSaavn extraction returned no URL");
        }
      } catch (error) {
        // JioSaavn strategy failed, do not try fallback strategies
        console.error(
          "[AudioStreamManager] JioSaavn extraction failed:",
          error,
        );
        throw new Error(
          `JioSaavn playback failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    // --- STANDARD FALLBACK LOGIC (For non-SoundCloud sources) ---

    // Try concurrent testing first (ytify v8 concept)
    const concurrentResult = await this.testConcurrentStrategies(
      videoId,
      onStatusUpdate,
    );

    if (concurrentResult) {
      return concurrentResult;
    }

    // Fallback to sequential strategy testing
    return this.testSequentialStrategies(videoId, onStatusUpdate);
  }

  private async testConcurrentStrategies(
    videoId: string,
    onStatusUpdate?: (status: string) => void,
  ): Promise<string | null> {
    onStatusUpdate?.("Testing strategies concurrently...");

    // Run first 3 strategies concurrently with timeout - REDUCED to 3 seconds for faster response
    const concurrentPromises = this.fallbackStrategies
      .slice(0, 3)
      .map(async (strategy, index) => {
        const strategyName = strategy.name || `Strategy ${index + 1}`;
        const startTime = Date.now();
        try {
          const url = await Promise.race([
            strategy(videoId),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), 3000),
            ),
          ]);
          const latency = Date.now() - startTime;
          return { url, latency, strategy: strategyName };
        } catch (error) {
          return null;
        }
      });

    const results = await Promise.all(concurrentPromises);
    const successfulResults = results.filter((r) => r !== null) as {
      url: string;
      latency: number;
      strategy: string;
    }[];

    if (successfulResults.length > 0) {
      // Sort by latency and return fastest result
      successfulResults.sort((a, b) => a.latency - b.latency);
      const fastest = successfulResults[0];
      onStatusUpdate?.(`Fastest: ${fastest.strategy} (${fastest.latency}ms)`);

      // Apply caching based on the strategy type
      if (
        fastest.strategy.includes("YouTube") ||
        fastest.strategy.includes("Invidious") ||
        fastest.strategy.includes("Piped") ||
        fastest.strategy.includes("Hyperpipe") ||
        fastest.strategy.includes("YouTubeMusic") ||
        fastest.strategy.includes("YouTubeEmbed")
      ) {
        // For YouTube strategies, ensure caching is complete before returning
        try {
          onStatusUpdate?.("Caching audio before playback...");
          const controller = new AbortController();
          const cachedUrl = await this.cacheYouTubeStream(
            fastest.url,
            videoId,
            controller,
          );
          console.log(
            `[Audio] YouTube caching completed for ${videoId}: ${cachedUrl !== fastest.url ? "cached" : "original"}`,
          );
          return cachedUrl;
        } catch (cacheError) {
          console.log(
            `[Audio] YouTube caching failed, using original URL: ${cacheError}`,
          );
          return fastest.url;
        }
      }

      return fastest.url;
    }

    return null;
  }

  private async testSequentialStrategies(
    videoId: string,
    onStatusUpdate?: (status: string) => void,
  ): Promise<string> {
    const errors: string[] = [];

    for (let i = 0; i < this.fallbackStrategies.length; i++) {
      const strategy = this.fallbackStrategies[i];
      const strategyName = strategy.name || `Strategy ${i + 1}`;

      try {
        onStatusUpdate?.(`Trying ${strategyName}...`);
        const url = await strategy(videoId);
        if (url) {
          onStatusUpdate?.(`Success with ${strategyName}`);

          // Apply caching based on the strategy type
          if (
            strategyName.includes("YouTube") ||
            strategyName.includes("Invidious") ||
            strategyName.includes("Piped")
          ) {
            // For YouTube strategies, ensure caching is complete before returning
            try {
              onStatusUpdate?.("Caching audio before playback...");
              const controller = new AbortController();
              const cachedUrl = await this.cacheYouTubeStream(
                url,
                videoId,
                controller,
              );
              console.log(
                `[Audio] YouTube caching completed for ${videoId}: ${cachedUrl !== url ? "cached" : "original"}`,
              );
              return cachedUrl;
            } catch (cacheError) {
              console.log(
                `[Audio] YouTube caching failed, using original URL: ${cacheError}`,
              );
              return url;
            }
          }

          return url;
        }
      } catch (error) {
        const errorMsg = `${strategyName} failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        errors.push(errorMsg);
        console.warn(`[AudioStreamManager] ${errorMsg}`);
        onStatusUpdate?.(`Failed: ${strategyName}`);
      }
    }

    throw new Error(
      `All audio extraction strategies failed. Errors: ${errors.join("; ")}`,
    );
  }

  // Queue prefetch functionality (ytify v8 concept)
  async prefetchAudioUrl(videoId: string, source?: string): Promise<void> {
    if (this.prefetchQueue.has(videoId)) {
      return; // Already prefetched
    }

    const prefetchPromise = this.getAudioUrl(videoId, undefined, source).catch(
      (error) => {
        console.warn(
          `[AudioStreamManager] Prefetch failed for ${videoId}:`,
          error,
        );
        throw error;
      },
    );

    this.prefetchQueue.set(videoId, prefetchPromise);

    // Limit prefetch queue size to prevent memory issues
    if (this.prefetchQueue.size > 10) {
      const firstKey = this.prefetchQueue.keys().next().value;
      if (firstKey) {
        this.prefetchQueue.delete(firstKey);
      }
    }
  }

  async prefetchQueueItems(videoIds: string[]): Promise<void> {
    const prefetchPromises = videoIds
      .slice(0, 5)
      .map((id) => this.prefetchAudioUrl(id).catch(() => {}));
    await Promise.allSettled(prefetchPromises);
  }

  // Dynamic proxy rotation helper
  private getNextProxy(): string {
    const proxy = this.proxyRotation[this.currentProxyIndex];
    this.currentProxyIndex =
      (this.currentProxyIndex + 1) % this.proxyRotation.length;
    return proxy;
  }

  // Enhanced fetch with proxy rotation and retry logic
  private async fetchWithProxy(
    url: string,
    options: RequestInit = {},
    retries = 3,
    timeout = 30000,
  ): Promise<Response> {
    for (let i = 0; i <= retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept: "application/json, text/plain, * / *",
            "Accept-Language": "en-US,en;q=0.9",
            ...options.headers,
          },
        });
        clearTimeout(timeoutId);

        // Enhanced blocking detection
        const contentType = response.headers.get("content-type");
        const responseText = await response.text();

        // Check for various blocking indicators
        const isHtmlResponse = contentType?.includes("text/html");
        const isApiRequest = url.includes("/api/");
        const hasCloudflare =
          responseText.includes("cf-browser-verification") ||
          responseText.includes("cloudflare") ||
          responseText.includes("Checking your browser") ||
          responseText.includes("DDoS protection by Cloudflare");
        const hasBlockingPage =
          responseText.includes("blocked") ||
          responseText.includes("access denied") ||
          responseText.includes("forbidden");

        if (
          (isHtmlResponse && isApiRequest) ||
          hasCloudflare ||
          hasBlockingPage
        ) {
          throw new Error(
            `Cloudflare/blocked API request: ${hasCloudflare ? "Cloudflare detected" : hasBlockingPage ? "Blocking page" : "HTML response to API request"}`,
          );
        }

        // Re-create response since we consumed the body
        const recreatedResponse = new Response(responseText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });

        if (response.ok) {
          return recreatedResponse;
        }

        // Handle specific HTTP error codes
        if (response.status === 429) {
          throw new Error("Rate limited (429): Too many requests");
        } else if (response.status === 503) {
          throw new Error(
            "Service unavailable (503): Instance may be overloaded",
          );
        } else if (response.status === 502) {
          throw new Error("Bad gateway (502): Instance proxy error");
        } else if (response.status === 404) {
          throw new Error("Not found (404): Resource not available");
        } else if (response.status >= 500) {
          throw new Error(
            `Server error (${response.status}): Instance may be down`,
          );
        }

        if (i < retries) {
          const proxyUrl = this.getNextProxy() + encodeURIComponent(url);
          const proxyController = new AbortController();
          const proxyTimeoutId = setTimeout(
            () => proxyController.abort(),
            timeout,
          );

          const proxyResponse = await fetch(proxyUrl, {
            ...options,
            signal: proxyController.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/json, text/plain, *\/\/*",
              "Accept-Language": "en-US,en;q=0.9",
              ...options.headers,
            },
          });
          clearTimeout(proxyTimeoutId);

          const proxyContentType = proxyResponse.headers.get("content-type");
          const proxyResponseText = await proxyResponse.text();

          // Check for blocking indicators in proxy response
          const proxyHasCloudflare =
            proxyResponseText.includes("cf-browser-verification") ||
            proxyResponseText.includes("cloudflare") ||
            proxyResponseText.includes("Checking your browser") ||
            proxyResponseText.includes("DDoS protection by Cloudflare");

          if (
            (proxyContentType?.includes("text/html") &&
              url.includes("/api/")) ||
            proxyHasCloudflare
          ) {
            throw new Error(
              `Cloudflare/blocked API request via proxy: ${proxyHasCloudflare ? "Cloudflare detected" : "HTML response to API request"}`,
            );
          }

          // Re-create proxy response
          const recreatedProxyResponse = new Response(proxyResponseText, {
            status: proxyResponse.status,
            statusText: proxyResponse.statusText,
            headers: proxyResponse.headers,
          });

          if (proxyResponse.ok) {
            return recreatedProxyResponse;
          }
        }
      } catch (error) {
        if (i === retries) {
          throw error;
        }

        // Enhanced error logging
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `[AudioStreamManager] fetchWithProxy attempt ${i + 1} failed for ${url}: ${errorMessage}`,
        );

        // Don't retry on certain errors (blocking, auth, etc.)
        if (
          errorMessage.includes("Cloudflare") ||
          errorMessage.includes("blocked") ||
          errorMessage.includes("forbidden") ||
          errorMessage.includes("401") ||
          errorMessage.includes("403")
        ) {
          throw error; // Don't retry on blocking/auth errors
        }

        // Exponential backoff with jitter
        const backoffMs = 2000 * Math.pow(2, i) + Math.random() * 1000;
        console.log(
          `[AudioStreamManager] Waiting ${Math.round(backoffMs)}ms before retry ${i + 2}`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries + 1} attempts`);
  }

  private async tryLocalExtraction(videoId: string): Promise<string> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`http://localhost:9999/streams/${videoId}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Local server returned ${response.status}`);
      }

      const data = await response.json();
      if (data.streamingData?.adaptiveFormats) {
        const audioFormats = data.streamingData.adaptiveFormats
          .filter((f: any) => f.mimeType?.startsWith("audio/"))
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        if (audioFormats.length > 0) {
          return audioFormats[0].url;
        }
      }
      throw new Error("No audio formats found in local extraction");
    } catch (error) {
      throw new Error(
        `Local extraction unavailable: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async tryJioSaavn(videoId: string): Promise<string> {
    try {
      // Get video info with extended timeout
      const videoInfo = await this.getVideoInfoWithTimeout(videoId, 25000);
      if (!videoInfo.title) {
        throw new Error("Could not extract video title for JioSaavn search");
      }

      // Clean up title for better search results
      const cleanTitle = videoInfo.title
        .replace(/\(.*?\)|\.|.*|\]/g, "")
        .trim();
      const cleanAuthor = videoInfo.author
        ? videoInfo.author.replace(/ - Topic|VEVO|Official/gi, "").trim()
        : "";

      // Try multiple JioSaavn endpoints
      const jiosaavnEndpoints = [
        "https://jiosaavn-api-privatecvc.vercel.app/api/search/songs",
        "https://jiosaavn-api-v3.vercel.app/api/search/songs",
        "https://jiosaavn-api-ts.vercel.app/api/search/songs",
      ];

      for (const endpoint of jiosaavnEndpoints) {
        try {
          const query = encodeURIComponent(
            `${cleanTitle} ${cleanAuthor}`,
          ).trim();
          const searchUrl = `${endpoint}?query=${query}`;

          // Use our enhanced fetch method
          const searchResponse = await this.fetchWithProxy(
            searchUrl,
            {},
            2,
            30000,
          );
          const searchData = await searchResponse.json();

          if (searchData.data?.results && searchData.data.results.length > 0) {
            // Get the first result
            const firstTrack = searchData.data.results[0];

            if (firstTrack?.downloadUrl && firstTrack.downloadUrl.length > 0) {
              // Get highest quality available
              const downloadUrls = firstTrack.downloadUrl;
              const highestQuality = downloadUrls[downloadUrls.length - 1];

              if (highestQuality?.url) {
                return highestQuality.url.replace("http:", "https:");
              }
            }

            // Fallback: Try alternative download URL structure
            if (firstTrack?.url) {
              return firstTrack.url.replace("http:", "https:");
            }
          }
        } catch (error) {
          console.warn(`JioSaavn endpoint ${endpoint} failed:`, error);
          continue;
        }
      }

      throw new Error("No suitable track found in any JioSaavn endpoint");
    } catch (error) {
      throw new Error(
        `JioSaavn search failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async tryYouTubeMusic(videoId: string): Promise<string> {
    try {
      // YouTube Music extraction using alternative endpoints
      const musicEndpoints = [
        `https://music.youtube.com/watch?v=${videoId}`,
        "https://yt1s.com/api/ajax/search/home",
        "https://yt5s.com/api/ajax/search/home",
      ];

      for (const endpoint of musicEndpoints) {
        try {
          if (endpoint.includes("music.youtube.com")) {
            // Try YouTube Music directly
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            const response = await fetch(endpoint, {
              signal: controller.signal,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*\/\/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
              },
            });
            clearTimeout(timeoutId);

            if (response.ok) {
              const html = await response.text();

              // Look for audio stream URLs in YouTube Music page
              const audioMatches = html.match(/"audioUrl":"([^"]*)"/g);
              if (audioMatches && audioMatches.length > 0) {
                const audioUrl = audioMatches[0].match(/"audioUrl":"([^"]*)"/);
                if (audioUrl && audioUrl[1]) {
                  return decodeURIComponent(
                    audioUrl[1].replace(/\\u0026/g, "&"),
                  );
                }
              }

              // Alternative: Look for adaptive formats
              const adaptiveMatches = html.match(
                /"adaptiveFormats":\[([^\]]*)\]/,
              );
              if (adaptiveMatches && adaptiveMatches[1]) {
                try {
                  const formats = JSON.parse(`[${adaptiveMatches[1]}]`);
                  const audioFormats = formats.filter((f: any) =>
                    f.mimeType?.startsWith("audio/"),
                  );

                  if (audioFormats.length > 0) {
                    const bestAudio = audioFormats.sort(
                      (a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0),
                    )[0];
                    if (bestAudio && bestAudio.url) {
                      return bestAudio.url;
                    }
                  }
                } catch (e) {
                  console.warn("Failed to parse adaptive formats:", e);
                }
              }
            }
          } else {
            // Try alternative YouTube download services
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);
            const formData = new FormData();
            formData.append("q", `https://www.youtube.com/watch?v=${videoId}`);
            formData.append("vt", "home");

            const response = await fetch(endpoint, {
              method: "POST",
              body: formData,
              signal: controller.signal,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Accept: "application/json, text/javascript, *\/\/*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
              },
            });
            clearTimeout(timeoutId);

            if (response.ok) {
              const data = await response.json();
              if (data.links && data.links.mp3) {
                const mp3Links = data.links.mp3;
                const bestQuality = Object.keys(mp3Links).sort(
                  (a, b) => parseInt(b) - parseInt(a),
                )[0];
                if (bestQuality && mp3Links[bestQuality]?.k) {
                  return mp3Links[bestQuality].k;
                }
              }
            }
          }
        } catch (error) {
          console.warn(`YouTube Music endpoint ${endpoint} failed:`, error);
          continue;
        }
      }
      throw new Error("No audio streams found via YouTube Music extraction");
    } catch (error) {
      throw new Error(
        `YouTube Music extraction failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async tryHyperpipe(videoId: string): Promise<string> {
    try {
      // Try multiple Hyperpipe instances
      const hyperpipeInstances = [
        "https://hyperpipeapi.onrender.com",
        "https://hyperpipe-api.vercel.app",
        "https://hyperpipe.onrender.com",
      ];

      for (const instance of hyperpipeInstances) {
        try {
          const url = `${instance}/streams/${videoId}`;
          const response = await this.fetchWithProxy(url, {}, 2, 25000);
          const data = await response.json();

          if (data.audioStreams && data.audioStreams.length > 0) {
            // Sort by quality and return highest quality stream
            const sortedStreams = data.audioStreams
              .filter((stream: any) => stream.url && !stream.videoOnly)
              .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

            if (sortedStreams.length > 0) {
              return sortedStreams[0].url;
            }
          }
        } catch (error) {
          console.warn(`Hyperpipe instance ${instance} failed:`, error);
          continue;
        }
      }
      throw new Error("All Hyperpipe instances failed");
    } catch (error) {
      throw new Error(
        `Hyperpipe failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  // Commented out echostreamz method - using new YouTube endpoints instead
  /*
  private async tryInvidious(videoId: string): Promise<string> {
    const instance = "https://echostreamz.com";

    try {
      // Use ?local=true to get proxied URLs that bypass some blocks
      const response = await this.fetchWithProxy(
        `${instance}/api/v1/videos/${videoId}?local=true`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept: "application/json, text/plain, *\/\/*",
            "Accept-Language": "en-US,en;q=0.9",
          },
        },
        2, // 2 retries
        12000 // 12 second timeout
      );

      if (!response.ok) {
        throw new Error(`Invidious returned ${response.status}`);
      }

      // Check if response is HTML (blocked) instead of JSON
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("json")) {
        throw new Error("Invidious returned HTML instead of JSON (blocked)");
      }

      const data = await response.json();

      // Check for adaptive formats (primary method)
      if (data.adaptiveFormats) {
        const audioFormats = data.adaptiveFormats
          .filter(
            (f: any) =>
              f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/")
          )
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        if (audioFormats.length > 0 && audioFormats[0].url) {
          // Resolve relative URLs to full URLs
          let audioUrl = audioFormats[0].url;
          if (audioUrl.startsWith("/")) {
            audioUrl = `${instance}${audioUrl}`;
          }
          console.log(
            "[AudioStreamManager] Found audio via Invidious adaptiveFormats"
          );
          // Cache the YouTube stream and return cached file path
          return this.cacheYouTubeStream(
            audioUrl,
            videoId,
            new AbortController()
          );
        }
      }

      // Fallback to formatStreams if adaptiveFormats not available
      if (data.formatStreams) {
        console.log("[YouTube Omada] Found formatStreams:", data.formatStreams.length, "streams");
        // First try to find audio-only streams
        const audioStreams = data.formatStreams
          .filter(
            (f: any) =>
              f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/")
          )
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        console.log("[YouTube Omada] Filtered audio streams from formatStreams:", audioStreams.length);
        if (audioStreams.length > 0) {
          console.log("[YouTube Omada] Best audio stream:", {
            url: audioStreams[0].url?.substring(0, 100) + "...",
            bitrate: audioStreams[0].bitrate,
            type: audioStreams[0].type || audioStreams[0].mimeType
          });
        }

        if (audioStreams.length > 0 && audioStreams[0].url) {
          // Resolve relative URLs to full URLs
          let audioUrl = audioStreams[0].url;
          if (audioUrl.startsWith("/")) {
            audioUrl = `${instance}${audioUrl}`;
          }
          console.log("[AudioStreamManager] Found audio via formatStreams");
          // Cache the YouTube stream and return cached file path
          return this.cacheYouTubeStream(
            audioUrl,
            videoId,
            new AbortController()
          );
        }

        // If no audio-only streams, try video streams that contain audio (muxed)
        // These are video streams but they also contain audio tracks
        const videoStreamsWithAudio = data.formatStreams
          .filter((f: any) => {
            const type = f.type || f.mimeType || "";
            // Look for video streams that likely contain audio
            return (
              type.startsWith("video/") &&
              (f.type?.includes("mp4") || f.mimeType?.includes("mp4")) &&
              // Prefer streams with audio codecs
              (type.includes("mp4a") || type.includes("audio"))
            );
          })
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        if (videoStreamsWithAudio.length > 0 && videoStreamsWithAudio[0].url) {
          // Resolve relative URLs to full URLs
          let audioUrl = videoStreamsWithAudio[0].url;
          if (audioUrl.startsWith("/")) {
            audioUrl = `${instance}${audioUrl}`;
          }
          console.log(
            "[AudioStreamManager] Found video stream with audio via formatStreams"
          );
          // Cache the YouTube stream and return cached file path
          return this.cacheYouTubeStream(
            audioUrl,
            videoId,
            new AbortController()
          );
        }

        // Last resort: any video stream (can be extracted for audio)
        const anyVideoStream = data.formatStreams
          .filter((f: any) => {
            const type = f.type || f.mimeType || "";
            return type.startsWith("video/");
          })
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
          .find((f: any) => f.url);

        if (anyVideoStream) {
          // Resolve relative URLs to full URLs
          let audioUrl = anyVideoStream.url;
          if (audioUrl.startsWith("/")) {
            audioUrl = `${instance}${audioUrl}`;
          }
          console.log(
            "[AudioStreamManager] Using video stream for audio extraction via formatStreams"
          );
          // Cache the YouTube stream and return cached file path
          return this.cacheYouTubeStream(
            audioUrl,
            videoId,
            new AbortController()
          );
        }
      }

      // Check for direct audio URL in response
      if (data.audioUrl) {
        // Resolve relative URLs to full URLs
        let audioUrl = data.audioUrl;
        if (audioUrl.startsWith("/")) {
          audioUrl = `${instance}${audioUrl}`;
        }
        console.log(
          "[AudioStreamManager] Found direct audio URL via Invidious"
        );
        // Cache the YouTube stream and return cached file path
        return this.cacheYouTubeStream(
          audioUrl,
          videoId,
          new AbortController()
        );
      }

      // If we have a video stream URL, convert it to MP3 format
      // This handles muxed streams that contain both video and audio
      if (data.formatStreams && data.formatStreams.length > 0) {
        const bestStream = data.formatStreams[0];
        if (bestStream.url) {
          let streamUrl = bestStream.url;
          if (streamUrl.startsWith("/")) {
            streamUrl = `${instance}${streamUrl}`;
          }

          // Convert video stream to MP3 format using a conversion service
          console.log(
            "[AudioStreamManager] Converting video stream to MP3 format"
          );
          return await this.convertStreamToMP3(streamUrl, videoId);
        }
      }

      throw new Error("No audio formats found in response");
    } catch (error) {
      console.warn("Invidious failed:", error);
      throw error;
    }
  }
  */

  private async tryYouTubeOmada(videoId: string): Promise<string> {
    const instance = "https://yt.omada.cafe";

    try {
      const requestUrl = `${instance}/api/v1/videos/${videoId}`;

      // Use the new yt.omada.cafe endpoint for YouTube playback
      const response = await this.fetchWithProxy(
        requestUrl,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Accept: "application/json, text/plain, *\/\/*",
            "Accept-Language": "en-US,en;q=0.9",
          },
        },
        2, // 2 retries
        12000, // 12 second timeout
      );

      if (!response.ok) {
        throw new Error(`YouTube Omada returned ${response.status}`);
      }

      // Check if response is HTML (blocked) instead of JSON
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("json")) {
        throw new Error(
          "YouTube Omada returned HTML instead of JSON (blocked)",
        );
      }

      const data = await response.json();

      // Check for adaptive formats (primary method)
      if (data.adaptiveFormats) {
        console.log(
          "[YouTube Omada] Found adaptiveFormats:",
          data.adaptiveFormats.length,
          "formats",
        );
        const audioFormats = data.adaptiveFormats
          .filter(
            (f: any) =>
              f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/"),
          )
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        console.log(
          "[YouTube Omada] Filtered audio formats:",
          audioFormats.length,
        );
        if (audioFormats.length > 0) {
          console.log("[YouTube Omada] Best audio format:", {
            url: audioFormats[0].url?.substring(0, 100) + "...",
            bitrate: audioFormats[0].bitrate,
            type: audioFormats[0].type || audioFormats[0].mimeType,
          });
        }

        // Try all available audio formats in order of quality
        // **NEW APPROACH**: Return the first available URL immediately and let caching handle failures
        for (let i = 0; i < audioFormats.length; i++) {
          const audioFormat = audioFormats[i];
          if (audioFormat.url) {
            // Resolve relative URLs to full URLs
            let audioUrl = audioFormat.url;
            if (audioUrl.startsWith("/")) {
              audioUrl = `${instance}${audioUrl}`;
            }

            // Check if this is a GoogleVideo URL that might need proxying
            let useOmadaProxy = false;

            if (audioUrl.includes("googlevideo.com")) {
              // **SKIP HEAD TEST**: Immediately try Omada proxy for GoogleVideo URLs
              const googlevideoMatch = audioUrl.match(
                /googlevideo\.com\/videoplayback\?(.+)/,
              );
              if (googlevideoMatch) {
                const queryParams = googlevideoMatch[1];
                audioUrl = `https://yt.omada.cafe/videoplayback?${queryParams}`;
                useOmadaProxy = true;
                console.log(
                  `[YouTube Omada] Using Omada proxy for GoogleVideo URL (format ${i + 1}/${audioFormats.length}, bitrate: ${audioFormat.bitrate})`,
                );
              }
            }

            console.log(
              `[YouTube Omada] Attempting audio format ${i + 1}/${audioFormats.length} (bitrate: ${audioFormat.bitrate}, type: ${audioFormat.type || audioFormat.mimeType})`,
            );
            console.log(
              "[YouTube Omada] Audio URL:",
              audioUrl.substring(0, 100) + "...",
            );

            // **RETURN IMMEDIATELY**: Don't test with HEAD, let the caching process handle failures
            console.log(
              "[AudioStreamManager] Found audio via YouTube Omada adaptiveFormats - returning immediately",
            );
            console.log(
              `[YouTube Omada] Audio format ${i + 1} selected, starting playback immediately`,
            );
            return audioUrl;
          }
        }

        // If no audio formats worked, continue to formatStreams fallback
        console.log(
          "[YouTube Omada] All audio formats failed, trying formatStreams fallback",
        );
      }

      // Fallback to formatStreams if adaptiveFormats not available
      if (data.formatStreams) {
        // First try to find audio-only streams
        const audioStreams = data.formatStreams
          .filter(
            (f: any) =>
              f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/"),
          )
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        // Try all audio streams
        for (let i = 0; i < audioStreams.length; i++) {
          const audioStream = audioStreams[i];
          if (audioStream.url) {
            // Resolve relative URLs to full URLs
            let audioUrl = audioStream.url;
            if (audioUrl.startsWith("/")) {
              audioUrl = `${instance}${audioUrl}`;
            }

            // Check if this is a GoogleVideo URL that needs proxying through Omada
            if (audioUrl.includes("googlevideo.com")) {
              // Convert GoogleVideo URL to Omada proxy URL
              const googlevideoMatch = audioUrl.match(
                /googlevideo\.com\/videoplayback\?(.+)/,
              );
              if (googlevideoMatch) {
                const queryParams = googlevideoMatch[1];
                audioUrl = `https://yt.omada.cafe/videoplayback?${queryParams}`;
                console.log(
                  "[YouTube Omada] Converting formatStreams GoogleVideo URL to Omada proxy",
                );
              }
            }
            console.log(
              `[YouTube Omada] Attempting formatStreams audio ${i + 1}/${audioStreams.length} (bitrate: ${audioStream.bitrate}, type: ${audioStream.type || audioStream.mimeType})`,
            );

            // **RETURN IMMEDIATELY**: Don't test with HEAD, let the caching process handle failures
            console.log(
              "[AudioStreamManager] Found audio via YouTube Omada formatStreams - returning immediately",
            );
            console.log(
              `[YouTube Omada] formatStreams audio ${i + 1} selected, starting playback immediately`,
            );
            return audioUrl;
          }
        }

        console.log(
          "[YouTube Omada] All formatStreams audio formats failed - trying video streams",
        );
      }

      // Fallback: Try video streams and extract audio
      if (data.formatStreams && data.formatStreams.length > 0) {
        console.log(
          "[YouTube Omada] Trying video streams for audio extraction",
        );

        // Try video streams sorted by quality (lower quality = smaller file = faster download)
        const videoStreams = data.formatStreams
          .filter(
            (f: any) =>
              !f.type?.startsWith("audio/") &&
              !f.mimeType?.startsWith("audio/"),
          )
          .sort((a: any, b: any) => (a.bitrate || 0) - (b.bitrate || 0)); // Lower bitrate first

        for (let i = 0; i < videoStreams.length; i++) {
          const videoStream = videoStreams[i];
          if (videoStream.url) {
            let videoUrl = videoStream.url;
            if (videoUrl.startsWith("/")) {
              videoUrl = `${instance}${videoUrl}`;
            }

            // Check if this is a GoogleVideo URL that needs proxying through Omada
            if (videoUrl.includes("googlevideo.com")) {
              // Convert GoogleVideo URL to Omada proxy URL
              const googlevideoMatch = videoUrl.match(
                /googlevideo\.com\/videoplayback\?(.+)/,
              );
              if (googlevideoMatch) {
                const queryParams = googlevideoMatch[1];
                videoUrl = `https://yt.omada.cafe/videoplayback?${queryParams}`;
                console.log(
                  "[YouTube Omada] Converting video stream GoogleVideo URL to Omada proxy",
                );
              }
            }
            console.log(
              `[YouTube Omada] Attempting video stream ${i + 1}/${videoStreams.length} (bitrate: ${videoStream.bitrate}, quality: ${videoStream.quality || "unknown"})`,
            );

            // **SKIP HEAD TEST**: Immediately try to extract audio from video stream
            console.log(
              "[YouTube Omada] Attempting to extract audio from video stream immediately",
            );

            try {
              // Try to convert video stream to audio-only
              const audioUrl = await this.convertStreamToMP3(videoUrl, videoId);
              if (audioUrl) {
                console.log(
                  "[YouTube Omada] Successfully extracted audio from video stream",
                );
                return audioUrl;
              }
            } catch (convertError) {
              console.log(
                `[YouTube Omada] Video stream ${i + 1} conversion failed:`,
                convertError,
              );
            }
          }
        }

        console.log("[YouTube Omada] All video streams failed");
      }

      throw new Error(
        "No working audio formats found in YouTube Omada response. All formats failed during conversion.",
      );
    } catch (error) {
      console.error("[YouTube Omada] Complete failure details:");
      console.error(
        "[YouTube Omada] Error type:",
        error instanceof Error ? error.constructor.name : typeof error,
      );
      console.error(
        "[YouTube Omada] Error message:",
        error instanceof Error ? error.message : String(error),
      );
      if (error instanceof Error && error.stack) {
        console.error("[YouTube Omada] Stack trace:", error.stack);
      }
      throw error;
    }
  }

  private async tryYouTubeEmbed(videoId: string): Promise<string> {
    // Last resort: Try to extract from YouTube embed page
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`https://www.youtube.com/embed/${videoId}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`YouTube embed returned ${response.status}`);
      }

      const html = await response.text();

      // Look for stream URLs in the embed page
      const streamMatches = html.match(/"url":"([^"]*audio[^"]*)"/g);
      if (streamMatches && streamMatches.length > 0) {
        // Clean up and return the first audio stream URL
        const urlMatch = streamMatches[0].match(/"url":"([^"]*)"/);
        if (urlMatch && urlMatch[1]) {
          return decodeURIComponent(urlMatch[1].replace(/\\u0026/g, "&"));
        }
      }
      throw new Error("No audio streams found in YouTube embed");
    } catch (error) {
      throw new Error(
        `YouTube embed extraction failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  // New fallback strategies for enhanced network resilience
  private async trySpotifyWebApi(videoId: string): Promise<string> {
    try {
      // First, get video info to extract title and artist
      const videoInfo = await this.getVideoInfo(videoId);
      if (!videoInfo.title) {
        throw new Error("Could not extract video title for Spotify search");
      }

      // Clean up title for better search results
      const cleanTitle = videoInfo.title
        .replace(/\(.*?\)|\.|.*|\]/g, "")
        .trim();
      const cleanArtist = videoInfo.author
        ? videoInfo.author.replace(/ - Topic|VEVO|Official/gi, "").trim()
        : "";

      // Search using Spotify's public search endpoint (no auth required for basic search)
      const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`).trim();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Use a public Spotify search proxy
      const searchResponse = await fetch(
        `https://spotify-api-wrapper.onrender.com/search?q=${query}&type=track&limit=1`,
        { signal: controller.signal },
      );
      clearTimeout(timeoutId);

      if (!searchResponse.ok) {
        throw new Error(`Spotify API returned ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();
      if (!searchData.tracks?.items || searchData.tracks.items.length === 0) {
        throw new Error("No tracks found on Spotify");
      }

      const track = searchData.tracks.items[0];

      // Get preview URL (30-second preview)
      if (track.preview_url) {
        return track.preview_url;
      }

      // Fallback: Try to get external URL and extract audio
      if (track.external_urls?.spotify) {
        // Use a service to extract audio from Spotify track
        const extractResponse = await fetch(
          `https://spotify-downloader1.p.rapidapi.com/download-track?track_url=${encodeURIComponent(
            track.external_urls.spotify,
          )}`,
          {
            method: "GET",
            headers: {
              "X-RapidAPI-Key": "demo-key", // This would need a real API key
              "X-RapidAPI-Host": "spotify-downloader1.p.rapidapi.com",
            },
            signal: controller.signal,
          },
        );

        if (extractResponse.ok) {
          const extractData = await extractResponse.json();
          if (extractData.download_link) {
            return extractData.download_link;
          }
        }
      }
      throw new Error("No audio stream available for Spotify track");
    } catch (error) {
      throw new Error(
        `Spotify Web API failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async trySoundCloud(
    videoId: string,
    trackTitle?: string,
    trackArtist?: string,
    onStatusUpdate?: (status: string) => void,
  ): Promise<string> {
    try {
      console.log(
        `[Audio] trySoundCloud called with videoId: ${videoId}, title: ${trackTitle}, artist: ${trackArtist}`,
      );

      // Check if this is a SoundCloud track (from our search results)
      const trackId = this.extractSoundCloudTrackId(videoId);
      console.log(`[Audio] Extracted trackId: ${trackId}`);
      if (!trackId) {
        throw new Error("Not a SoundCloud track ID");
      }

      // Strategy 1: Try to access the track directly via widget API
      try {
        // Add retry logic for better reliability
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
          try {
            const directUrl = `https://api-widget.soundcloud.com/resolve?url=https://api.soundcloud.com/tracks/${trackId}&client_id=${this.SOUNDCLOUD_CLIENT_ID}&format=json`;

            // Use CORS proxy for the API call
            const proxiedDirectUrl = this.getCorsProxyUrl(directUrl);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const directResponse = await fetch(proxiedDirectUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              },
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (directResponse.ok) {
              const trackData = await directResponse.json();

              if (trackData && trackData.media?.transcodings?.length > 0) {
                console.log(
                  `[Audio] Track has ${trackData.media.transcodings.length} transcodings`,
                );
                return await this.extractSoundCloudStream(
                  trackData,
                  controller,
                );
              } else {
                console.log("[Audio] Track has no transcodings available");
              }
            } else {
              console.log(
                `[Audio] Direct widget failed with status: ${directResponse.status}`,
              );
              const errorText = await directResponse.text();
              console.log(`[Audio] Direct widget error: ${errorText}`);
            }
            break; // Success or clear failure, don't retry
          } catch (retryError) {
            retryCount++;
            console.log(
              `[Audio] Direct widget attempt ${retryCount} failed: ${
                retryError instanceof Error ? retryError.message : retryError
              }`,
            );
            if (retryCount < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, retryCount * 1000),
              );
            }
          }
        }
      } catch (directError) {
        // Direct widget strategy failed
      }

      // Strategy 2: Try using the SoundCloud widget API directly
      try {
        // Use a proper SoundCloud URL format
        const widgetUrl = `https://api-widget.soundcloud.com/resolve?url=https://api.soundcloud.com/tracks/${trackId}&client_id=${this.SOUNDCLOUD_CLIENT_ID}&format=json`;

        // Use CORS proxy for the widget API call
        const proxiedWidgetUrl = this.getCorsProxyUrl(widgetUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const widgetResponse = await fetch(proxiedWidgetUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Referer: "https://w.soundcloud.com/",
            Origin: "https://w.soundcloud.com",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        console.log(`[Audio] Widget response status: ${widgetResponse.status}`);

        if (widgetResponse.ok) {
          const widgetData = await widgetResponse.json();
          if (widgetData && widgetData.media && widgetData.media.transcodings) {
            return await this.extractSoundCloudStream(widgetData, controller);
          } else if (widgetData && widgetData.id) {
            // Even if no transcodings, we can try to use this data
            return await this.extractSoundCloudStream(widgetData, controller);
          }
        } else {
          // Widget API failed
        }
      } catch (widgetError) {
        // Widget strategy failed
      }

      // Strategy 3: Search for the specific track by title and artist
      if (trackTitle || trackArtist) {
        try {
          const searchQuery = [trackTitle, trackArtist]
            .filter(Boolean)
            .join(" ");

          const searchUrl = `https://proxy.searchsoundcloud.com/tracks?q=${encodeURIComponent(
            searchQuery,
          )}&limit=10&client_id=${this.SOUNDCLOUD_CLIENT_ID}`;
          console.log(`[Audio] Search URL: ${searchUrl}`);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const searchResponse = await fetch(searchUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();

            if (searchData.collection && searchData.collection.length > 0) {
              // Look for exact match by track ID first
              const exactMatch = searchData.collection.find(
                (track: any) => String(track.id) === trackId,
              );

              if (exactMatch) {
                return await this.extractSoundCloudStream(
                  exactMatch,
                  controller,
                );
              }

              // Look for title/artist match
              const titleMatch = searchData.collection.find((track: any) => {
                const trackTitleLower = track.title?.toLowerCase() || "";
                const searchTitleLower = trackTitle?.toLowerCase() || "";
                const trackArtistLower =
                  track.user?.username?.toLowerCase() || "";
                const searchArtistLower = trackArtist?.toLowerCase() || "";

                return (
                  (searchTitleLower &&
                    trackTitleLower.includes(searchTitleLower)) ||
                  (searchArtistLower &&
                    trackArtistLower.includes(searchArtistLower))
                );
              });

              if (titleMatch) {
                return await this.extractSoundCloudStream(
                  titleMatch,
                  controller,
                );
              }

              // If no exact matches, try the first track with transcodings
              const availableTrack = searchData.collection.find(
                (track: any) => track.media?.transcodings?.length > 0,
              );

              if (availableTrack) {
                return await this.extractSoundCloudStream(
                  availableTrack,
                  controller,
                );
              }
            }
          }
        } catch (searchError) {
          console.log(
            `[Audio] Search strategy failed: ${
              searchError instanceof Error ? searchError.message : searchError
            }`,
          );
        }
      }

      // Strategy 4: Fallback - try to construct a direct stream URL
      const fallbackUrl = `https://api.soundcloud.com/tracks/${trackId}/stream?client_id=${this.SOUNDCLOUD_CLIENT_ID}`;

      // Test if this URL works using CORS proxy
      const proxiedFallbackUrl = this.getCorsProxyUrl(fallbackUrl);

      try {
        const testResponse = await fetch(proxiedFallbackUrl, {
          method: "HEAD",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
        });

        if (testResponse.ok) {
          return fallbackUrl;
        }
      } catch (testError) {
        // Fallback URL test failed
      }

      throw new Error(`Track with ID ${trackId} not found or unavailable`);
    } catch (error) {
      throw new Error(
        `SoundCloud playback failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async extractSoundCloudStream(
    trackData: any,
    controller: AbortController,
  ): Promise<string> {
    if (
      !trackData.media ||
      !trackData.media.transcodings ||
      trackData.media.transcodings.length === 0
    ) {
      throw new Error("No media transcodings available");
    }

    // Find the best quality stream (prefer progressive MP3, fallback to HLS)
    const preferredTranscoding =
      trackData.media.transcodings.find(
        (t: any) =>
          t.preset === "mp3_standard" && t.format?.protocol === "progressive",
      ) ||
      trackData.media.transcodings.find(
        (t: any) => t.format?.protocol === "progressive",
      ) ||
      trackData.media.transcodings.find(
        (t: any) => t.format?.protocol === "hls",
      );

    if (!preferredTranscoding) {
      throw new Error("No suitable audio stream found");
    }

    const transcodingUrl = preferredTranscoding.url;
    const resolveUrl = new URL(transcodingUrl);

    // Append the client_id - this is crucial for the API to return the stream URL
    resolveUrl.searchParams.append("client_id", this.SOUNDCLOUD_CLIENT_ID);

    if (trackData.track_authorization) {
      resolveUrl.searchParams.append(
        "track_authorization",
        trackData.track_authorization,
      );
    }

    // Try to resolve the stream URL through the API using CORS proxy
    try {
      // Use CORS proxy to resolve the stream URL
      const proxyUrl = this.getCorsProxyUrl(resolveUrl.toString());
      const streamResponse = await fetch(proxyUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        signal: controller.signal,
      });

      if (streamResponse.ok) {
        const streamData = await streamResponse.json();
        if (streamData.url) {
          // Validate the stream URL before using it
          const validation = await this.validateAudioStream(streamData.url);
          if (!validation.isValid) {
            throw new Error(`Invalid SoundCloud stream: ${validation.error}`);
          }

          console.log(
            `[Audio] Stream validated: ${validation.contentType}, ${validation.contentLength} bytes`,
          );

          // For SoundCloud, we need to use the CORS proxy for the actual stream too
          // because the resolved URLs often have CORS restrictions
          const proxiedStreamUrl = this.getCorsProxyUrl(streamData.url);

          // Validate the proxied URL as well
          const proxiedValidation =
            await this.validateAudioStream(proxiedStreamUrl);
          if (!proxiedValidation.isValid) {
            // Try without proxy if proxied version fails
            return await this.cacheSoundCloudStream(
              streamData.url,
              trackData.id.toString(),
              controller,
            );
          }

          // Cache the first megabyte of the stream before returning
          return await this.cacheSoundCloudStream(
            proxiedStreamUrl,
            trackData.id.toString(),
            controller,
          );
        } else {
          // No URL in response, try alternative client IDs
          try {
            const altStreamUrl = await this.tryAlternativeClientIds(
              resolveUrl.toString(),
              trackData,
              controller,
            );

            if (altStreamUrl) {
              return await this.cacheSoundCloudStream(
                altStreamUrl,
                trackData.id.toString(),
                controller,
              );
            }
          } catch (altError) {
            // All alternative client IDs failed
          }
        }
      } else {
        console.warn(
          `[Audio] Failed to resolve stream. Status: ${streamResponse.status}`,
        );

        // Try alternative client IDs if primary failed
        if (streamResponse.status === 401 || streamResponse.status === 403) {
          try {
            const altStreamUrl = await this.tryAlternativeClientIds(
              resolveUrl.toString(),
              trackData,
              controller,
            );

            if (altStreamUrl) {
              return await this.cacheSoundCloudStream(
                altStreamUrl,
                trackData.id.toString(),
                controller,
              );
            }
          } catch (altError) {
            console.error(
              "[Audio] All alternative client IDs failed after auth failure:",
              altError,
            );
          }
        }
      }
    } catch (streamError) {
      // Failed to fetch stream URL
    }

    // Fallback: Try using the widget API to get a working stream
    try {
      const widgetUrl = `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${trackData.id}`;
      const proxyWidgetUrl = this.getCorsProxyUrl(widgetUrl);

      const widgetResponse = await fetch(proxyWidgetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        signal: controller.signal,
      });

      if (widgetResponse.ok) {
        const widgetHtml = await widgetResponse.text();

        // Look for stream URLs in the widget HTML
        const streamUrlMatch = widgetHtml.match(
          /\"(https?:\/\/[^\"]*\.mp3[^\"]*)\"/,
        );
        if (streamUrlMatch) {
          // Validate the extracted URL
          const validation = await this.validateAudioStream(streamUrlMatch[1]);
          if (!validation.isValid) {
            throw new Error(`Invalid widget stream: ${validation.error}`);
          }

          // Use CORS proxy for the stream URL too
          const proxiedWidgetStreamUrl = this.getCorsProxyUrl(
            streamUrlMatch[1],
          );

          // Validate the proxied URL
          const proxiedValidation = await this.validateAudioStream(
            proxiedWidgetStreamUrl,
          );
          if (!proxiedValidation.isValid) {
            console.warn(
              `[Audio] Proxied widget stream validation failed: ${proxiedValidation.error}`,
            );
            // Try without proxy
            return await this.cacheSoundCloudStream(
              streamUrlMatch[1],
              trackData.id.toString(),
              controller,
            );
          }

          // Cache the first megabyte of the stream before returning
          return await this.cacheSoundCloudStream(
            proxiedWidgetStreamUrl,
            trackData.id.toString(),
            controller,
          );
        }
      } else if (
        widgetResponse.status === 401 ||
        widgetResponse.status === 403
      ) {
        // Try alternative client IDs for widget as well
        try {
          // Try to construct a direct API call with alternative client IDs
          const altStreamUrl = await this.tryAlternativeClientIds(
            `https://api.soundcloud.com/i1/tracks/${trackData.id}/streams`,
            trackData,
            controller,
          );

          if (altStreamUrl) {
            console.log(
              "[Audio] Alternative client ID provided stream URL after widget auth failure",
            );
            return await this.cacheSoundCloudStream(
              altStreamUrl,
              trackData.id.toString(),
              controller,
            );
          }
        } catch (altError) {
          // Alternative client IDs failed after widget auth failure
        }
      }
    } catch (widgetError) {
      // Widget fallback failed
    }

    // Last resort: return the transcoding URL with CORS proxy

    // Cache the first megabyte of the stream before returning
    const proxiedUrl = this.getCorsProxyUrl(resolveUrl.toString());
    return await this.cacheSoundCloudStream(
      proxiedUrl,
      trackData.id.toString(),
      controller,
    );
  }

  private extractSoundCloudTrackId(videoId: string): string | null {
    // Check if this looks like a SoundCloud track ID (numeric)
    if (/^\d+$/.test(videoId)) {
      return videoId;
    }
    // Check if this is a SoundCloud permalink URL and extract track ID
    const soundcloudMatch = videoId.match(/soundcloud\.com\/.*\/.*?(\d+)$/);
    if (soundcloudMatch) {
      return soundcloudMatch[1];
    }
    return null;
  }

  private async tryPiped(videoId: string): Promise<string> {
    try {
      const pipedInstances = [
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.tokhmi.xyz",
        "https://pipedapi.moomoo.me",
        "https://pipedapi.syncpundit.io",
        "https://pipedapi.rydberg.one",
      ];

      for (const instance of pipedInstances) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const response = await fetch(`${instance}/streams/${videoId}`, {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            continue;
          }

          const data = await response.json();
          if (data.audioStreams && data.audioStreams.length > 0) {
            // Sort by quality and return highest quality stream
            const sortedStreams = data.audioStreams
              .filter((stream: any) => stream.url && !stream.videoOnly)
              .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

            if (sortedStreams.length > 0) {
              return sortedStreams[0].url;
            }
          }
        } catch (error) {
          console.warn(`Piped instance ${instance} failed:`, error);
          continue;
        }
      }
      // throw new Error("All Piped instances failed");
    } catch (error) {
      throw new Error(
        `Piped API failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  // Helper method to get video info with extended timeout

  // Helper method to get video info with extended timeout
  private async getVideoInfoWithTimeout(
    videoId: string,
    timeout = 30000,
  ): Promise<{ title?: string; author?: string }> {
    try {
      // Try multiple sources for video info
      const sources = [
        `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
        `https://yewtu.be/api/v1/videos/${videoId}`,
        `https://invidious.f5.si/api/v1/videos/${videoId}`,
        `https://inv.perditum.com/api/v1/videos/${videoId}`,
        `https://inv.nadeko.net/api/v1/videos/${videoId}`,
        `https://www.youtube.com/embed/${videoId}`,
      ];

      for (const source of sources) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(source, {
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/json, text/html, *\/\/*",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            if (source.includes("youtube.com/embed")) {
              // Parse HTML for embed page
              const html = await response.text();
              const titleMatch = html.match(/"title":"([^"]*)"/);
              const authorMatch = html.match(/"author":"([^"]*)"/);

              if (titleMatch || authorMatch) {
                return {
                  title: titleMatch ? titleMatch[1] : undefined,
                  author: authorMatch ? authorMatch[1] : undefined,
                };
              }
            } else {
              // Parse JSON from Invidious API
              const data = await response.json();
              if (data.title || data.author) {
                return { title: data.title, author: data.author };
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to get video info from ${source}:`, error);
          continue;
        }
      }
      return {};
    } catch (error) {
      console.warn("getVideoInfoWithTimeout failed:", error);
      return {};
    }
  }

  // Helper method to get video info
  private async getVideoInfo(
    videoId: string,
  ): Promise<{ title?: string; author?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(
        `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
        { signal: controller.signal },
      );
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return { title: data.title, author: data.author };
      }
    } catch (error) {
      // Fallback to YouTube embed
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(
          `https://www.youtube.com/embed/${videoId}`,
          {
            signal: controller.signal,
          },
        );
        clearTimeout(timeoutId);

        const html = await response.text();
        const titleMatch = html.match(/"title":"([^"]*)"/);
        const authorMatch = html.match(/"author":"([^"]*)"/);

        return {
          title: titleMatch ? titleMatch[1] : undefined,
          author: authorMatch ? authorMatch[1] : undefined,
        };
      } catch {
        return {};
      }
    }
    return {};
  }

  // Cleanup method

  /**
   * Resume cache download from a specific position
   * This is used when cache gets stuck or needs to continue from partial download
   */
  public async resumeCacheDownload(
    streamUrl: string,
    cacheFilePath: string,
    trackId: string,
    startPosition: number,
    controller: AbortController,
    onProgress?: (percentage: number) => void,
  ): Promise<void> {
    let resumeFilePath: string;

    try {
      console.log(
        `[Audio] Resuming cache download from position ${startPosition} for track: ${trackId}`,
      );

      // Mark download as started to indicate active resume operation
      this.markDownloadStarted(trackId, streamUrl);

      // Use our dynamic cache directory instead of extracting from the path
      const cacheDir = await this.getCacheDirectory();
      if (!cacheDir) {
        console.warn(
          "[Audio] No cache directory available, skipping resume download",
        );
        return;
      }

      console.log(`[Audio] Using cache directory for resume: ${cacheDir}`);
      // Directory is already tested and created by getCacheDirectory()

      // Ensure cacheFilePath is a proper file:// URI
      const properCacheFilePath = cacheFilePath.startsWith("file://")
        ? cacheFilePath
        : `file://${cacheFilePath}`;

      // Construct the resume file path using our dynamic cache directory
      resumeFilePath = `${cacheDir}${trackId}.cache.resume`;
      console.log(`[Audio] Resume download to: ${resumeFilePath}`);

      // Try to download the rest of the file starting from the current position
      const resumeResult = await FileSystem.downloadAsync(
        streamUrl,
        resumeFilePath,
        {
          headers: {
            Range: `bytes=${startPosition}-`,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Referer: "https://www.youtube.com/",
            Origin: "https://www.youtube.com/",
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        },
      );

      if (resumeResult.status === 200 || resumeResult.status === 206) {
        console.log(`[Audio] Resume download successful for track: ${trackId}`);

        // Check if the resume file exists and has content
        const resumeFileInfo = await FileSystem.getInfoAsync(resumeFilePath);
        if (!resumeFileInfo.exists || resumeFileInfo.size === 0) {
          console.warn(
            `[Audio] Resume file is empty or doesn't exist for track: ${trackId}`,
          );
          // Clean up resume file if it exists
          await FileSystem.deleteAsync(resumeFilePath, {
            idempotent: true,
          });
          return;
        }

        try {
          // Use a more robust approach: copy the resumed content directly
          // without trying to read it as Base64/UTF8
          console.log("[Audio] Attempting binary-safe file combination");

          // Get file info for both files
          const existingFileInfo =
            await FileSystem.getInfoAsync(properCacheFilePath);
          const resumeFileInfo = await FileSystem.getInfoAsync(resumeFilePath);

          if (!existingFileInfo.exists || !resumeFileInfo.exists) {
            console.warn(
              "[Audio] One of the files doesn't exist for combination",
            );
            return;
          }

          // Create a temporary combined file
          const tempCombinedPath = properCacheFilePath + ".combined";

          // First copy the existing file to temp location
          await FileSystem.copyAsync({
            from: properCacheFilePath,
            to: tempCombinedPath,
          });

          // Then append the resume content using binary-safe approach
          // Read both files as binary arrays and combine them
          const existingArray = await FileSystem.readAsStringAsync(
            tempCombinedPath,
            { encoding: FileSystem.EncodingType.Base64 },
          );
          const resumeArray = await FileSystem.readAsStringAsync(
            resumeFilePath,
            { encoding: FileSystem.EncodingType.Base64 },
          );

          // Decode both base64 strings to binary, concatenate, then re-encode
          const existingBinary = toByteArray(existingArray);
          const resumeBinary = toByteArray(resumeArray);
          const combinedBinary = new Uint8Array(
            existingBinary.length + resumeBinary.length,
          );
          combinedBinary.set(existingBinary);
          combinedBinary.set(resumeBinary, existingBinary.length);
          const combinedBase64 = fromByteArray(combinedBinary);

          // Combine and write back
          await FileSystem.writeAsStringAsync(
            tempCombinedPath,
            combinedBase64,
            { encoding: FileSystem.EncodingType.Base64 },
          );

          // Replace the original file with the combined one
          await FileSystem.copyAsync({
            from: tempCombinedPath,
            to: properCacheFilePath,
          });

          // Clean up temp files
          await FileSystem.deleteAsync(tempCombinedPath, {
            idempotent: true,
          });

          console.log("[Audio] Successfully combined cache files using Base64");
        } catch (combinationError) {
          console.error("[Audio] File combination failed:", combinationError);
          // Final fallback: just replace the original file with the resumed one
          try {
            await FileSystem.copyAsync({
              from: resumeFilePath,
              to: properCacheFilePath,
            });
            console.log(
              "[Audio] Fallback: Replaced cache file with resumed content",
            );
          } catch (finalError) {
            console.error("[Audio] Final fallback failed:", finalError);
            throw finalError;
          }
        }

        // Clean up resume file
        await FileSystem.deleteAsync(resumeFilePath, {
          idempotent: true,
        });

        console.log(`[Audio] Cache resumed and combined for track: ${trackId}`);

        // Report updated progress
        // Add a small delay to ensure filesystem has updated the file size
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const updatedCacheInfo = await this.getCacheInfo(trackId);
        onProgress?.(updatedCacheInfo.percentage);
        console.log(
          `[Audio] Updated cache progress after resume: ${updatedCacheInfo.percentage}%`,
        );

        // Mark download as completed
        this.markDownloadCompleted(trackId, updatedCacheInfo.fileSize);
      } else {
        console.log(
          `[Audio] Resume download failed with status: ${resumeResult.status}`,
        );
      }
    } catch (error) {
      console.error(
        `[Audio] Failed to resume cache download for track ${trackId}:`,
        error,
      );

      // Check if it's a permission/writability error
      if (
        error?.toString().includes("isn't writable") ||
        error?.toString().includes("Permission denied")
      ) {
        console.warn(
          `[Audio] Cache directory not writable, skipping resume for track ${trackId}`,
        );
        // Don't retry resume for permission errors - just continue with streaming
        return;
      }

      // Clean up resume file on error
      try {
        await FileSystem.deleteAsync(resumeFilePath, {
          idempotent: true,
        });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      // Mark download as not downloading on error so monitoring can continue
      const existingProgress = this.cacheProgress.get(trackId);
      if (existingProgress) {
        this.cacheProgress.set(trackId, {
          ...existingProgress,
          isDownloading: false,
          lastUpdate: Date.now(),
        });
      }
    }
  }

  // Cleanup method
  public async cleanup() {
    // Clean up SoundCloud cached files to prevent storage leaks
    for (const filePath of Array.from(this.soundCloudCache.values())) {
      try {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      } catch (error) {
        console.warn("[Audio] Failed to delete cached file:", error);
      }
    }
    this.soundCloudCache.clear();

    this.prefetchQueue.clear();
    this.concurrentTestResults.clear();
  }
}

// Export the AudioStreamManager class and utility functions

// Enhanced convenience functions with ytify v8 concepts
export async function getAudioStreamUrl(
  videoId: string,
  onStatus?: (status: string) => void,
  source?: string,
  trackTitle?: string,
  trackArtist?: string,
): Promise<string> {
  return AudioStreamManager.getInstance().getAudioUrl(
    videoId,
    onStatus,
    source,
    trackTitle,
    trackArtist,
  );
}

export async function prefetchAudioStreamUrl(
  videoId: string,
  source?: string,
): Promise<void> {
  return AudioStreamManager.getInstance().prefetchAudioUrl(videoId, source);
}

export async function prefetchAudioStreamQueue(
  videoIds: string[],
): Promise<void> {
  return AudioStreamManager.getInstance().prefetchQueueItems(videoIds);
}

export async function startProgressiveYouTubeCache(
  youtubeUrl: string,
  trackId: string,
  controller: AbortController,
): Promise<void> {
  return AudioStreamManager.getInstance().startProgressiveYouTubeCache(
    youtubeUrl,
    trackId,
    controller,
  );
}

export async function cacheYouTubeStreamFromPosition(
  youtubeUrl: string,
  trackId: string,
  positionSeconds: number,
  controller: AbortController,
): Promise<string> {
  return AudioStreamManager.getInstance().cacheYouTubeStreamFromPosition(
    youtubeUrl,
    trackId,
    positionSeconds,
    controller,
  );
}

export async function continueCachingTrack(
  streamUrl: string,
  trackId: string,
  controller: AbortController,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  return AudioStreamManager.getInstance().continueCachingTrack(
    streamUrl,
    trackId,
    controller,
    onProgress,
  );
}

// Track active monitoring instances to prevent duplicates
const activeMonitors = new Set<string>();

/**
 * Monitor cache progress during playback and resume if stuck
 * This function checks if cache percentage is not increasing and resumes download
 */
export async function monitorAndResumeCache(
  trackId: string,
  currentAudioUrl: string,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  // Prevent multiple monitoring instances for the same track
  console.log(
    `[CacheMonitor] Checking if monitoring already active for track: ${trackId}, active tracks: ${Array.from(activeMonitors).join(", ")}`,
  );
  if (activeMonitors.has(trackId)) {
    console.log(
      `[CacheMonitor] Monitoring already active for track: ${trackId}, skipping duplicate`,
    );
    return;
  }

  activeMonitors.add(trackId);
  console.log(
    `[CacheMonitor] Starting monitoring for track: ${trackId}, total active: ${activeMonitors.size}`,
  );
  const manager = AudioStreamManager.getInstance();
  let lastPercentage = 0;
  let stuckCount = 0;
  const maxStuckCount = 3; // Consider stuck after 3 checks with no progress

  // Get the original streaming URL from cache progress for resume operations
  const getOriginalStreamUrl = (): string | null => {
    return manager.getOriginalStreamUrl(trackId);
  };

  const checkCacheProgress = async () => {
    try {
      const cacheInfo = await manager.getCacheInfo(trackId);
      const currentPercentage = cacheInfo.percentage;

      // console.log(
      //   `[CacheMonitor] Track ${trackId}: ${currentPercentage}% cached`
      // );
      onProgress?.(currentPercentage);

      // If there's no active progress but we have substantial partial cache (>=30%), try to resume
      if (
        currentPercentage >= 30 &&
        currentPercentage < 98 &&
        cacheInfo.isDownloading === false
      ) {
        console.log(
          `[CacheMonitor] Found substantial partial cache (${currentPercentage}%) but no active download, attempting resume for track: ${trackId}`,
        );

        const originalStreamUrl = getOriginalStreamUrl();
        if (originalStreamUrl) {
          // Check if we have any cached file to resume from
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const filePath = cachedFilePath.replace("file://", "");
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            const currentSize = fileInfo.exists ? fileInfo.size : 0;

            if (currentSize > 0) {
              // console.log(
              //   `[CacheMonitor] Found existing cache file (${currentSize} bytes), resuming download`
              // );

              // Resume downloading from the current position
              const resumeController = new AbortController();
              try {
                await manager.resumeCacheDownload(
                  originalStreamUrl,
                  filePath,
                  trackId,
                  currentSize,
                  resumeController,
                  onProgress,
                );
                activeMonitors.delete(trackId);
                return; // Exit early only if resume succeeds
              } catch (resumeError: any) {
                console.error(
                  `[CacheMonitor] Resume failed for track ${trackId}:`,
                  resumeError,
                );

                // If it's a permission/writability error, don't try to resume this track
                if (
                  resumeError?.toString().includes("isn't writable") ||
                  resumeError?.toString().includes("Permission denied")
                ) {
                  console.warn(
                    `[CacheMonitor] Cache directory not writable, skipping resume for track ${trackId}`,
                  );
                  activeMonitors.delete(trackId);
                  return; // Exit monitoring for this track
                }

                // For other errors, continue with normal flow (don't return)
              }
            }
          }
        }
      }

      // If there's no active progress but we have a cached URL, try to resume
      if (currentPercentage === 0 && cacheInfo.isDownloading === false) {
        const originalStreamUrl = getOriginalStreamUrl();
        if (originalStreamUrl) {
          console.log(
            `[CacheMonitor] Found cached URL but no active progress, attempting resume for track: ${trackId}`,
          );

          // Check if we have any cached file to resume from
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const filePath = cachedFilePath.replace("file://", "");
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            const currentSize = fileInfo.exists ? fileInfo.size : 0;

            if (currentSize > 0) {
              // console.log(
              //   `[CacheMonitor] Found existing cache file (${currentSize} bytes), resuming download`
              // );

              // Resume downloading from the current position
              const resumeController = new AbortController();
              try {
                await manager.resumeCacheDownload(
                  originalStreamUrl,
                  filePath,
                  trackId,
                  currentSize,
                  resumeController,
                  onProgress,
                );
                return; // Exit early only if resume succeeds
              } catch (resumeError: any) {
                console.error(
                  `[CacheMonitor] Resume failed for track ${trackId}:`,
                  resumeError,
                );

                // If it's a permission/writability error, don't try to resume this track
                if (
                  resumeError?.toString().includes("isn't writable") ||
                  resumeError?.toString().includes("Permission denied")
                ) {
                  console.warn(
                    `[CacheMonitor] Cache directory not writable, skipping resume for track ${trackId}`,
                  );
                  activeMonitors.delete(trackId);
                  return; // Exit monitoring for this track
                }

                // For other errors, continue with normal flow (don't return)
              }
            }
          }
        }
      }

      // Check if percentage is stuck (allow for small variations due to rounding)
      if (
        Math.abs(currentPercentage - lastPercentage) < 1 &&
        currentPercentage < 98
      ) {
        stuckCount++;
        console.log(
          `[CacheMonitor] Cache appears stuck (${stuckCount}/3) for track: ${trackId}, last: ${lastPercentage}, current: ${currentPercentage}`,
        );

        if (stuckCount >= maxStuckCount) {
          console.log(
            `[CacheMonitor] Resuming stuck cache for track: ${trackId}`,
          );

          // Resume the cache download from the last position
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const filePath = cachedFilePath.replace("file://", "");
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            const currentSize = fileInfo.exists ? fileInfo.size : 0;

            console.log(
              `[CacheMonitor] Current file size: ${currentSize} bytes`,
            );

            // Get the original streaming URL from cache progress
            const originalStreamUrl = getOriginalStreamUrl();

            if (originalStreamUrl) {
              // Create a new controller for the resume operation
              const resumeController = new AbortController();

              // Resume downloading from the current position
              try {
                await manager.resumeCacheDownload(
                  originalStreamUrl,
                  filePath,
                  trackId,
                  currentSize,
                  resumeController,
                  onProgress,
                );
                stuckCount = 0; // Reset stuck counter only if resume succeeds
              } catch (resumeError: any) {
                console.error(
                  `[CacheMonitor] Resume failed for track ${trackId}:`,
                  resumeError,
                );

                // If it's a permission/writability error, stop trying to resume this track
                if (
                  resumeError?.toString().includes("isn't writable") ||
                  resumeError?.toString().includes("Permission denied")
                ) {
                  console.warn(
                    `[CacheMonitor] Cache directory not writable, stopping resume attempts for track ${trackId}`,
                  );
                  return; // Exit monitoring for this track
                }

                // For other errors, continue monitoring but don't reset stuckCount
                // This prevents infinite retry loops
              }
            } else {
              console.warn(
                `[CacheMonitor] Cannot resume cache - no original streaming URL available for track: ${trackId}`,
              );
            }
          } else {
            console.warn(
              `[CacheMonitor] No cached file path found for track: ${trackId}`,
            );
          }
        }
      } else {
        stuckCount = 0; // Reset if progress is detected
        console.log(
          `[CacheMonitor] Progress detected: ${lastPercentage}% -> ${currentPercentage}%`,
        );
      }

      lastPercentage = currentPercentage;

      // Continue monitoring if not fully cached (increased threshold to 98%)
      if (currentPercentage < 98) {
        setTimeout(checkCacheProgress, 3000); // Check every 3 seconds (reduced from 5)
      } else {
        console.log(
          `[CacheMonitor] Cache nearly complete (${currentPercentage}%), stopping monitoring`,
        );
        // Clean up monitoring instance
        activeMonitors.delete(trackId);
      }
    } catch (error) {
      console.error(
        `[CacheMonitor] Error monitoring cache for track ${trackId}:`,
        error,
      );
      // Continue monitoring even after errors
      if (lastPercentage < 98) {
        setTimeout(checkCacheProgress, 5000);
      }
    }
  };

  // Start monitoring
  checkCacheProgress();
}

export async function cleanupAudioStreamManager(): Promise<void> {
  await AudioStreamManager.getInstance().cleanup();
}

/**
 * Clear cached SoundCloud streams
 * @param trackId - Optional track ID to clear specific cache, clears all if not provided
 */
export async function clearSoundCloudCache(trackId?: string): Promise<void> {
  await AudioStreamManager.getInstance().clearSoundCloudCache(trackId);
}

export async function clearTrackCache(trackId?: string): Promise<void> {
  await AudioStreamManager.getInstance().clearTrackCache(trackId);
}
