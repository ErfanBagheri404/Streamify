import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";

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

  // Hardcoded Client ID from your logs
  private readonly SOUNDCLOUD_CLIENT_ID = "gqKBMSuBw5rbN9rDRYPqKNvF17ovlObu";

  // Helper method to update download progress with atomic updates
  private updateDownloadProgress(
    trackId: string,
    downloadedMB: number,
    speed: number
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
        }
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
    }
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
          `[CacheProgress] Preventing regression for ${trackId}: ${existingProgress.percentage}% -> ${newPercentage}%`
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
          `[CacheProgress] Skipping minor update for ${trackId}: ${progressDelta}% in ${timeSinceLastUpdate}ms`
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
      `[CacheProgress] Updated progress for ${trackId}: ${newPercentage}%${fileSize ? ` (${Math.round(fileSize * 100) / 100}MB)` : ""}${options?.downloadedSize ? ` downloaded: ${Math.round(options.downloadedSize * 100) / 100}MB` : ""}`
    );
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
      `[CacheProgress] Download started for ${trackId}${streamUrl ? ` from: ${streamUrl.substring(0, 50)}...` : ""}`
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
    console.log(
      `[CacheProgress] Download completed for ${trackId}: ${Math.round(fileSize * 100) / 100}MB (took ${existingProgress ? Math.round((now - existingProgress.downloadStartTime) / 1000) : 0}s)`
    );
  }

  /**
   * Clean up stale cache progress entries
   */
  private startCacheProgressCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 5 * 60 * 1000; // 5 minutes

      for (const [trackId, progress] of this.cacheProgress.entries()) {
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
              `[CacheProgress] Preserved URL in stale cleanup for ${trackId}`
            );
          } else {
            this.cacheProgress.delete(trackId);
            console.log(
              `[CacheProgress] Cleaned up stale progress for ${trackId}`
            );
          }
        }
      }
    }, 60000); // Run every minute
  }

  // Convert video stream to audio format by finding audio-only alternatives
  private async convertStreamToMP3(
    videoUrl: string,
    videoId: string
  ): Promise<string> {
    try {
      console.log(
        `[AudioStreamManager] Converting video stream to audio for video: ${videoId}`
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
              `[AudioStreamManager] Found working audio-only stream with itag ${itag}`
            );
            return audioOnlyUrl;
          }
        } catch (error) {
          console.warn(
            `[AudioStreamManager] Audio-only itag ${itag} failed:`,
            error
          );
          continue;
        }
      }

      // Method 2: Try to modify the URL to get an audio-only version
      // Remove video-specific parameters and add audio-specific ones
      console.log(
        "[AudioStreamManager] Trying URL modification for audio extraction"
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
        "[AudioStreamManager] All audio extraction methods failed, returning original stream URL with audio hint"
      );

      // Add a query parameter to indicate this is an audio extraction request
      // This helps the player understand it should extract audio from the video stream
      const audioExtractionUrl = `${videoUrl}&audio_only=true&extract_audio=1`;

      // Log for debugging
      console.log(
        "[AudioStreamManager] Returning URL with audio extraction hint"
      );

      return audioExtractionUrl;
    } catch (error) {
      console.error("[AudioStreamManager] Audio extraction failed:", error);

      // Even in case of error, return the original URL so playback can still work
      // The player might be able to handle the video stream directly
      console.warn(
        `[AudioStreamManager] Returning original URL due to extraction error: ${videoUrl}`
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

    // First check in-memory cache for performance
    const fullFilePath = this.soundCloudCache.get(trackId + "_full");
    console.log(`[Audio] Full file path (old format): ${fullFilePath}`);

    if (fullFilePath) {
      return `file://${fullFilePath}`;
    }

    // Check if we have a full file in the new format (direct trackId)
    const cachedPath = this.soundCloudCache.get(trackId);
    console.log(`[Audio] Cached path: ${cachedPath}`);

    if (cachedPath) {
      // Check if this is a full file by looking at the path
      if (cachedPath.includes(".full")) {
        console.log(`[Audio] Found full cached file: ${cachedPath}`);
        return `file://${cachedPath}`;
      }
      // This is a partial cache
      console.log(`[Audio] Found partial cached file: ${cachedPath}`);
      return `file://${cachedPath}`;
    }

    // If not in memory, scan filesystem for existing cache files
    console.log(
      `[Audio] Scanning filesystem for cache files for track: ${trackId}`
    );

    // Check SoundCloud cache directory
    const soundCloudCacheDir = `${FileSystem.cacheDirectory}soundcloud-cache/`;

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
              `[Audio] Found existing SoundCloud cache file: ${filePath}`
            );
            this.soundCloudCache.set(trackId + "_full", filePath);
            this.soundCloudCache.set(trackId, filePath);
            this.soundCloudCache.set(trackId + "_has_full", "true");
            return `file://${filePath}`;
          } else {
            console.warn(
              `[Audio] Found corrupted SoundCloud cache file, cleaning up: ${filePath}`
            );
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          }
        }
      }
    } catch (error) {
      console.log("[Audio] Error checking SoundCloud cache directory:", error);
    }

    // Check YouTube cache directory
    const youtubeCacheDir = `${FileSystem.cacheDirectory}youtube-cache/`;

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
              `[Audio] Found existing YouTube cache file: ${filePath}`
            );

            // Mark as full if it has .full extension or is substantial
            if (ext.includes(".full") || fileInfo.size > 5242880) {
              // 5MB
              this.soundCloudCache.set(trackId + "_full", filePath);
              this.soundCloudCache.set(trackId + "_has_full", "true");
            }

            this.soundCloudCache.set(trackId, filePath);
            return `file://${filePath}`;
          } else {
            console.warn(
              `[Audio] Found corrupted YouTube cache file, cleaning up: ${filePath}`
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
   * Validate the integrity of a cached file
   */
  private async validateCachedFile(filePath: string): Promise<boolean> {
    try {
      const fileInfo = await FileSystem.getInfoAsync(filePath);

      if (!fileInfo.exists || !fileInfo.size || fileInfo.size === 0) {
        console.warn(
          `[Audio] File validation failed: file doesn't exist or is empty`
        );
        return false;
      }

      // Check minimum file size (10KB for meaningful audio data)
      if (fileInfo.size < 10240) {
        console.warn(
          `[Audio] File validation failed: file too small (${fileInfo.size} bytes)`
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
            `[Audio] File validation failed: cannot read file content`
          );
          return false;
        }
      } catch (readError) {
        console.warn(`[Audio] File validation failed: read error`, readError);
        return false;
      }

      console.log(`[Audio] File validation passed for: ${filePath}`);
      return true;
    } catch (error) {
      console.warn(`[Audio] File validation error:`, error);
      return false;
    }
  }

  /**
   * Clean up partial/incomplete cached files
   */
  private async cleanupPartialCache(trackId: string): Promise<void> {
    try {
      console.log(`[Audio] Cleaning up partial cache for track: ${trackId}`);

      const cacheDir = FileSystem.cacheDirectory + "audio_cache/";
      const possibleFiles = [
        cacheDir + trackId + ".mp3",
        cacheDir + trackId + ".mp3.full",
        cacheDir + trackId + ".mp3.chunks",
        cacheDir + trackId + ".mp3.chunks.current",
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
            cleanupError
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
          `[Audio] Preserved original URL for track: ${trackId} during cleanup`
        );
      } else {
        // Clear cache progress for this track if no URL to preserve
        this.cacheProgress.delete(trackId);
      }

      console.log(
        `[Audio] Partial cache cleanup completed for track: ${trackId}`
      );
    } catch (error) {
      console.warn(
        `[Audio] Error during partial cache cleanup for ${trackId}:`,
        error
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
      `[Audio] Estimated total size: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB for current size: ${Math.round((fileSize / 1024 / 1024) * 100) / 100}MB`
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
      console.log(`[Audio] === getCacheInfo START for ${trackId} ===`);

      // Check if we have any cached progress for this track (even completed downloads)
      const activeProgress = this.cacheProgress.get(trackId);
      console.log(`[Audio] Active progress found:`, !!activeProgress);
      if (activeProgress) {
        console.log(`[Audio] Progress details:`, {
          percentage: activeProgress.percentage,
          downloadedSize: activeProgress.downloadedSize ?? 0,
          isDownloading: activeProgress.isDownloading,
          lastFileSize: activeProgress.lastFileSize,
          isFullyCached: activeProgress.isFullyCached ?? false,
          estimatedTotalSize: activeProgress.estimatedTotalSize ?? 0,
          originalStreamUrl: activeProgress.originalStreamUrl ?? "none",
        });

        // If we have a completed download (100%) and confirmed fully cached, return that immediately
        if (
          activeProgress.percentage === 100 &&
          !activeProgress.isDownloading &&
          activeProgress.isFullyCached
        ) {
          console.log(
            `[Audio] Track ${trackId} is fully cached (100% confirmed)`
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
            result
          );
          return result;
        }

        // If actively downloading, return current progress with consistency checks
        if (activeProgress.isDownloading) {
          // Ensure percentage doesn't decrease during active download
          const safePercentage = Math.max(
            activeProgress.percentage,
            activeProgress.lastFileSize > 0 ? 1 : 0
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
            result
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
            result
          );
          return result;
        }
      }

      // Check if we have any cached file
      const cachedFilePath = await this.getBestCachedFilePath(trackId);
      console.log(`[Audio] Best cached file path: ${cachedFilePath}`);

      if (!cachedFilePath) {
        console.log(`[Audio] No cached file found for track: ${trackId}`);
        const result = { percentage: 0, fileSize: 0, isFullyCached: false };
        console.log(
          `[Audio] === getCacheInfo END (no file) for ${trackId} ===`,
          result
        );
        return result;
      }

      // Get file info - remove file:// prefix for FileSystem.getInfoAsync
      const filePath = cachedFilePath.replace("file://", "");
      console.log(`[Audio] Getting file info for path: ${filePath}`);
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      console.log("[Audio] File info:", fileInfo);

      if (!fileInfo || !fileInfo.exists) {
        console.log(`[Audio] Cached file not found: ${filePath}`);
        const result = { percentage: 0, fileSize: 0, isFullyCached: false };
        console.log(
          `[Audio] === getCacheInfo END (file missing) for ${trackId} ===`,
          result
        );
        return result;
      }

      // Check if it's fully cached or has substantial cache
      const isFullyCached = this.hasFullCachedFile(trackId);
      const hasSubstantialCache = this.soundCloudCache.has(
        trackId + "_substantial"
      );
      const fileSize = fileInfo.size || 0;

      console.log(
        `[Audio] Cache status for ${trackId}: fullyCached=${isFullyCached}, substantial=${hasSubstantialCache}, size=${fileSize} bytes`
      );

      // For very small files (< 10KB), consider them as not meaningfully cached
      const minFileSize = 10240; // 10KB minimum
      if (fileSize < minFileSize) {
        console.log(
          `[Audio] File too small to be considered cached: ${fileSize} bytes (min: ${minFileSize})`
        );
        const result = {
          percentage: 0,
          fileSize: Math.round((fileSize / 1024 / 1024) * 100) / 100,
          isFullyCached: false,
        };
        console.log(
          `[Audio] === getCacheInfo END (too small) for ${trackId} ===`,
          result
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
            `[Audio] Using stored estimated size: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB`
          );
        } else {
          // Dynamic estimation based on file size patterns
          // Use more conservative estimates to prevent percentage drops
          if (fileSize >= 10485760) {
            // 10MB+ - likely complete or near-complete, but cap at 12MB
            estimatedTotalSize = Math.min(fileSize * 1.2, 12582912); // 20% buffer, max 12MB
            console.log(
              `[Audio] Large file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (20% buffer)`
            );
          } else if (fileSize >= 7340032) {
            // 7-10MB - estimate 10-12MB total with buffer
            estimatedTotalSize = Math.max(10485760, fileSize * 1.3); // Min 10MB, 30% buffer
            console.log(
              `[Audio] Medium-large file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (30% buffer)`
            );
          } else if (fileSize >= 5242880) {
            // 5-7MB - estimate 8-10MB total with buffer
            estimatedTotalSize = Math.max(8388608, fileSize * 1.4); // Min 8MB, 40% buffer
            console.log(
              `[Audio] Medium file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (40% buffer)`
            );
          } else if (fileSize >= 3145728) {
            // 3-5MB - estimate 6-8MB total with buffer (this is our current case)
            estimatedTotalSize = Math.max(6291456, fileSize * 1.8); // Min 6MB, 80% buffer
            console.log(
              `[Audio] Small-medium file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (80% buffer)`
            );
          } else if (fileSize >= 2097152) {
            // 2-3MB - estimate 4-6MB total with buffer
            estimatedTotalSize = Math.max(4194304, fileSize * 2.0); // Min 4MB, 100% buffer
            console.log(
              `[Audio] Small file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (100% buffer)`
            );
          } else {
            // Less than 2MB - use conservative 4MB estimate
            estimatedTotalSize = 4194304; // 4MB
            console.log(
              `[Audio] Very small file estimation: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB (fixed)`
            );
          }
        }

        // Calculate percentage with better accuracy and stability
        const rawPercentage = (fileSize / estimatedTotalSize) * 100;

        // Apply stability rules to prevent percentage drops
        const existingPercentage = activeProgress?.percentage || 0;
        let stablePercentage = Math.min(98, Math.round(rawPercentage));

        // Never allow percentage to decrease significantly (more than 5%)
        if (stablePercentage < existingPercentage - 5) {
          console.log(
            `[Audio] Preventing percentage drop: ${existingPercentage}% -> ${stablePercentage}%`
          );
          stablePercentage = Math.max(stablePercentage, existingPercentage - 2); // Allow max 2% drop
        }

        // If we're close to the estimated total, boost the estimate
        if (stablePercentage > 85 && fileSize > 0) {
          const newEstimatedTotal = Math.max(
            estimatedTotalSize,
            fileSize * 1.1
          );
          if (newEstimatedTotal > estimatedTotalSize) {
            estimatedTotalSize = newEstimatedTotal;
            console.log(
              `[Audio] Boosting estimated total to prevent premature 100%: ${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB`
            );
            // Recalculate percentage with new estimate
            const newRawPercentage = (fileSize / estimatedTotalSize) * 100;
            stablePercentage = Math.min(98, Math.round(newRawPercentage));
          }
        }

        percentage = stablePercentage;

        // Boost percentage for substantial cache but cap at 95%
        if (hasSubstantialCache && percentage < 90) {
          percentage = Math.min(95, percentage + 5);
          console.log(
            `[Audio] Boosting cache percentage for substantial cache: ${percentage}%`
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
        `[Audio] Cache info for ${trackId}: ${percentage}% (${fileSize} bytes, ${isFullyCached ? "full" : "partial"})`
      );
      console.log(
        `[Audio] Cache info details: percentage=${percentage}, displayFileSize=${displayFileSize}MB, isFullyCached=${isFullyCached}, estimatedTotal=${Math.round((estimatedTotalSize / 1024 / 1024) * 100) / 100}MB`
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
      return result;
    } catch (error) {
      console.error(
        `[Audio] Error getting cache info for track ${trackId}:`,
        error
      );
      return {
        percentage: 0,
        fileSize: 0,
        totalFileSize: 0,
        isFullyCached: false,
      };
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
    positionMs: number
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
        `[Audio] Position check for ${trackId}: position=${positionMs}ms, cached=${estimatedCacheEndMs}ms, fileSize=${cacheInfo.fileSize}MB`
      );

      return {
        isCached: positionMs <= estimatedCacheEndMs,
        estimatedCacheEndMs: Math.round(estimatedCacheEndMs),
      };
    } catch (error) {
      console.error(
        `[Audio] Error checking position cache for track ${trackId}:`,
        error
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
          console.log(`[Audio] Cleared SoundCloud cache for track: ${trackId}`);
        } catch (error) {
          console.warn(
            `[Audio] Failed to delete cached file for track ${trackId}:`,
            error
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
            error
          );
        }
      }
      this.soundCloudCache.clear();
      console.log("[Audio] Cleared all SoundCloud cache");
    }
  }

  /**
   * Cache the first megabyte of a YouTube stream for pre-buffering
   * This downloads the first chunk in the background and returns the cached file path when ready
   * The cache is used to reduce initial buffering time and improve playback quality
   */
  private async cacheYouTubeStream(
    streamUrl: string,
    trackId: string,
    controller: AbortController
  ): Promise<string> {
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId);
      console.log(
        `[Audio] Using existing cached file for YouTube track: ${trackId}`
      );
      console.log(`[Audio] YouTube cached path: ${cachedPath}`);
      // Return the cached path with file:// prefix
      return `file://${cachedPath}`;
    }

    console.log(
      `[Audio] Waiting for YouTube cache completion for track: ${trackId}`
    );

    try {
      // Wait for cache completion before returning
      const cachedPath = await this.cacheYouTubeStreamAsync(
        streamUrl,
        trackId,
        controller
      );

      if (cachedPath.startsWith("file://")) {
        console.log(
          `[Audio] YouTube caching completed successfully for track: ${trackId}`
        );
        return cachedPath;
      } else {
        console.log(
          `[Audio] YouTube caching failed for track: ${trackId}, falling back to stream URL`
        );
        return streamUrl;
      }
    } catch (error) {
      console.log(`[Audio] YouTube caching error for track ${trackId}:`, error);
      // If caching fails completely, return the original stream URL as fallback
      return streamUrl;
    }
  }

  /**
   * Cache the first megabyte of a SoundCloud stream for pre-buffering
   * This downloads the first chunk in the background and returns the cached file path when ready
   * The cache is used to reduce initial buffering time and improve playback quality
   */
  private async cacheSoundCloudStream(
    streamUrl: string,
    trackId: string,
    controller: AbortController
  ): Promise<string> {
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId);
      console.log(`[Audio] Using existing cached file for track: ${trackId}`);
      console.log(`[Audio] Cached path: ${cachedPath}`);
      // Return the cached path with file:// prefix
      return `file://${cachedPath}`;
    }

    // Always wait for cache completion before playing
    console.log(
      `[Audio] Waiting for SoundCloud cache completion for track: ${trackId}`
    );

    try {
      const cachedFilePath = await this.cacheSoundCloudStreamAsync(
        streamUrl,
        trackId,
        controller
      );

      console.log(
        `[Audio] SoundCloud cache completed, using cached file: ${cachedFilePath}`
      );
      return cachedFilePath;
    } catch (error) {
      console.log(
        `[Audio] SoundCloud caching failed for track ${trackId}:`,
        error
      );
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
    controller: AbortController
  ): Promise<void> {
    try {
      // Check if already downloading to prevent concurrent downloads
      const existingProgress = this.cacheProgress.get(trackId);
      if (existingProgress?.isDownloading) {
        console.log(
          `[Audio] Download already in progress for track: ${trackId}`
        );
        return;
      }

      // Mark download as started with URL persistence
      this.markDownloadStarted(trackId, streamUrl);

      console.log(`[Audio] Starting full track download for track: ${trackId}`);

      // First, let's try to get the full track by downloading without range header
      // This will give us the complete file
      const fullDownloadResult = await FileSystem.downloadAsync(
        streamUrl,
        cacheFilePath + ".full",
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        }
      );

      if (
        fullDownloadResult.status === 200 ||
        fullDownloadResult.status === 206
      ) {
        console.log(
          `[Audio] Full track download completed for track: ${trackId}`
        );

        // Check if the full download is actually significantly larger than the partial cache
        const fullFileInfo = await FileSystem.getInfoAsync(
          cacheFilePath + ".full"
        );
        const partialFileInfo = await FileSystem.getInfoAsync(cacheFilePath);

        const fullSize = fullFileInfo.exists ? fullFileInfo.size : 0;
        const partialSize = partialFileInfo.exists ? partialFileInfo.size : 0;

        console.log(
          `[Audio] Full file size: ${fullSize} bytes, Partial file size: ${partialSize} bytes`
        );

        // Only consider it a successful full download if it's significantly larger
        // or if we got a 200 status (indicating complete file)
        const isSignificantlyLarger = fullSize > partialSize + 1048576; // At least 1MB larger
        const isCompleteDownload =
          fullDownloadResult.status === 200 || isSignificantlyLarger;

        if (fullFileInfo.exists && fullSize > 3145728 && isCompleteDownload) {
          // At least 3MB and complete
          console.log(
            `[Audio] Replacing partial cache with full file for track: ${trackId}`
          );

          // Replace the partial cache with the full file for future plays
          this.soundCloudCache.set(trackId + "_full", cacheFilePath + ".full");
          this.soundCloudCache.set(trackId, cacheFilePath + ".full");
          this.soundCloudCache.set(trackId + "_has_full", "true");

          // Mark download as completed
          this.markDownloadCompleted(trackId, fullSize / (1024 * 1024)); // Convert to MB

          console.log(
            `[Audio] Full file cache updated for track: ${trackId} (${fullSize} bytes)`
          );
        } else {
          console.log(
            `[Audio] Full download not significantly larger, keeping partial cache for track: ${trackId}`
          );
          // Clean up the failed full download
          try {
            await FileSystem.deleteAsync(cacheFilePath + ".full", {
              idempotent: true,
            });
          } catch (cleanupError) {
            console.warn(
              "[Audio] Failed to clean up partial full download:",
              cleanupError
            );
          }
        }
      } else {
        // If full download fails, try downloading the rest in chunks
        console.log(
          `[Audio] Full download failed, trying chunked download for track: ${trackId}`
        );
        await this.downloadTrackInChunks(
          streamUrl,
          cacheFilePath,
          trackId,
          controller
        );
      }
    } catch (error) {
      console.warn(
        `[Audio] Full track download failed for track ${trackId}:`,
        error
      );

      // Mark download as failed and check retry logic
      const progress = this.cacheProgress.get(trackId);
      if (progress && progress.retryCount < this.MAX_RETRY_ATTEMPTS) {
        console.log(
          `[Audio] Retrying download for track ${trackId} (attempt ${progress.retryCount + 1}/${this.MAX_RETRY_ATTEMPTS})`
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
          controller
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
          `[Audio] Download failed permanently for track ${trackId} after ${progress?.retryCount || 0} attempts`
        );

        // If full download fails, try downloading the rest in chunks
        console.log(
          `[Audio] Full download failed, trying chunked download for track: ${trackId}`
        );
        await this.downloadTrackInChunks(
          streamUrl,
          cacheFilePath,
          trackId,
          controller
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
    controller: AbortController
  ): Promise<void> {
    try {
      console.log(`[Audio] Starting chunked download for track: ${trackId}`);

      // Start from 5MB (where initial cache left off)
      let currentPosition = 5242880;
      const chunkSize = 2 * 1024 * 1024; // 2MB chunks
      let totalDownloaded = 5242880; // We already have first 5MB

      // Create a temporary file for the chunks
      const tempFilePath = cacheFilePath + ".chunks";

      // Copy existing cache to temp file
      await FileSystem.copyAsync({
        from: cacheFilePath,
        to: tempFilePath,
      });

      // Mark download as started with initial progress and URL persistence
      this.markDownloadStarted(trackId, streamUrl);
      this.updateDownloadProgress(trackId, totalDownloaded / (1024 * 1024), 0); // 5MB initial

      let lastProgressUpdate = Date.now();
      const progressUpdateInterval = 1000; // Update progress every 1 second

      while (!controller.signal.aborted) {
        const endPosition = currentPosition + chunkSize - 1;

        try {
          console.log(
            `[Audio] Downloading chunk ${currentPosition}-${endPosition} for track: ${trackId}`
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
            }
          );

          if (chunkResult.status === 200 || chunkResult.status === 206) {
            // Append the chunk to our temp file
            const chunkContent = await FileSystem.readAsStringAsync(
              tempFilePath + ".current",
              { encoding: FileSystem.EncodingType.Base64 }
            );

            // Read existing content and append new chunk
            const existingContent = await FileSystem.readAsStringAsync(
              tempFilePath,
              { encoding: FileSystem.EncodingType.Base64 }
            );

            await FileSystem.writeAsStringAsync(
              tempFilePath,
              existingContent + chunkContent,
              { encoding: FileSystem.EncodingType.Base64 }
            );

            const chunkSizeDownloaded = chunkResult.headers?.["content-length"]
              ? parseInt(chunkResult.headers["content-length"])
              : chunkSize;

            totalDownloaded += chunkSizeDownloaded;
            currentPosition += chunkSize;

            console.log(
              `[Audio] Downloaded chunk, total: ${totalDownloaded} bytes`
            );

            // Update progress every second to avoid too frequent updates
            const now = Date.now();
            if (now - lastProgressUpdate >= progressUpdateInterval) {
              this.updateDownloadProgress(
                trackId,
                totalDownloaded / (1024 * 1024),
                0
              );
              lastProgressUpdate = now;
            }

            // If we got less data than requested, we might be at the end
            if (chunkSizeDownloaded < chunkSize) {
              console.log(
                `[Audio] Reached end of file, total downloaded: ${totalDownloaded} bytes`
              );
              break;
            }
          } else {
            // If we get a 416 (Range Not Satisfiable), we've reached the end
            if (chunkResult.status === 416) {
              console.log(
                `[Audio] Reached end of file (416 response) for track: ${trackId}`
              );
              break;
            }
            throw new Error(
              `Chunk download failed with status: ${chunkResult.status}`
            );
          }
        } catch (error) {
          console.warn(
            `[Audio] Chunk download failed at position ${currentPosition}:`,
            error
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
          `[Audio] Replacing cache with enhanced file (${totalDownloaded} bytes) for track: ${trackId}`
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
            `[Audio] Marking track as having substantial cache for track: ${trackId}`
          );
          this.soundCloudCache.set(trackId + "_substantial", "true");
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
        error
      );

      // Check if we should retry
      const progress = this.cacheProgress.get(trackId);
      if (progress && progress.retryCount < this.MAX_RETRY_ATTEMPTS) {
        console.log(
          `[Audio] Retrying chunked download for track ${trackId} (attempt ${progress.retryCount + 1}/${this.MAX_RETRY_ATTEMPTS})`
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
          controller
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
          `[Audio] Chunked download failed permanently for track ${trackId} after ${progress?.retryCount || 0} attempts`
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
   * Background caching of YouTube stream - doesn't block playback
   */
  private async cacheYouTubeStreamAsync(
    streamUrl: string,
    trackId: string,
    controller: AbortController
  ): Promise<string> {
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      console.log(`[Audio] Background cache hit for YouTube track: ${trackId}`);
      const cachedPath = this.soundCloudCache.get(trackId)!;
      return `file://${cachedPath}`;
    }

    console.log(
      `[Audio] Background caching first 5MB of YouTube stream for track: ${trackId}`
    );

    try {
      // Create cache directory if it doesn't exist
      const cacheDir = `${FileSystem.cacheDirectory}youtube-cache/`;
      console.log(`[Audio] Creating YouTube cache directory: ${cacheDir}`);
      try {
        await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
      } catch (mkdirError: any) {
        console.warn("[Audio] Could not create cache directory:", mkdirError);
        console.warn("[Audio] Continuing with existing directory or fallback");
        // Don't return here - the directory might already exist
      }

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
          "[Audio] Continuing without caching due to directory issues"
        );
        return streamUrl;
      }

      const cacheFilePath = `${cacheDir}${trackId}.cache`;

      // Mark download as started with URL persistence for YouTube tracks
      this.markDownloadStarted(trackId, streamUrl);

      // Check if we have a full file available first
      const fullFilePath = cacheFilePath + ".full";
      const fullFileInfo = await FileSystem.getInfoAsync(fullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 5242880) {
        console.log(
          `[Audio] Using existing full cached file for YouTube track: ${trackId}`
        );
        this.soundCloudCache.set(trackId, fullFilePath);
        // Update progress to reflect completed state
        this.updateCacheProgress(
          trackId,
          100,
          fullFileInfo.size / (1024 * 1024),
          {
            isFullyCached: true,
          }
        );
        return `file://${fullFilePath}`;
      }

      // Check if partial file exists
      const partialFileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      if (partialFileInfo.exists) {
        console.log(
          `[Audio] Using existing partial cached file for YouTube track: ${trackId}`
        );
        this.soundCloudCache.set(trackId, cacheFilePath);
        // Update progress to reflect partial state
        const estimatedTotal = this.estimateTotalFileSize(partialFileInfo.size);
        const percentage = Math.min(
          95,
          Math.round((partialFileInfo.size / estimatedTotal) * 100)
        );
        this.updateCacheProgress(
          trackId,
          percentage,
          partialFileInfo.size / (1024 * 1024)
        );
        return `file://${cacheFilePath}`;
      }

      // Download the first 5MB (5 * 1024 * 1024 bytes) of the stream
      console.log(
        `[Audio] Downloading partial cache for YouTube track: ${trackId}`
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
          `[Audio] Attempting direct download from: ${streamUrl.substring(0, 50)}...`
        );
        downloadResult = await FileSystem.downloadAsync(
          streamUrl,
          cacheFilePath,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              Referer: "https://www.youtube.com/",
              Origin: "https://www.youtube.com/",
            },
            sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
          }
        );
        console.log(
          `[Audio] Direct download completed with status: ${downloadResult.status}`
        );
      } catch (downloadError) {
        console.log(
          "[Audio] Direct download failed, trying with range header:",
          downloadError
        );
        // Fallback to range request
        try {
          downloadResult = await FileSystem.downloadAsync(
            streamUrl,
            cacheFilePath,
            {
              headers: {
                Range: "bytes=0-5242879", // Request first 5MB
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                Referer: "https://www.youtube.com/",
                Origin: "https://www.youtube.com/",
              },
              sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
            }
          );
          console.log(
            `[Audio] Range download completed with status: ${downloadResult.status}`
          );
        } catch (rangeError) {
          console.error("[Audio] Range download also failed:", rangeError);
          // If both fail, return original URL
          return streamUrl;
        }
      }

      if (downloadResult.status !== 200 && downloadResult.status !== 206) {
        console.log(
          `[Audio] Download failed with status: ${downloadResult.status}`
        );
        console.log(`[Audio] Response headers:`, downloadResult.headers);
        throw new Error(
          `Failed to download YouTube stream chunk: ${downloadResult.status} - ${downloadResult.headers?.["content-type"] || "unknown content type"}`
        );
      }

      // Check if file was actually created
      const downloadedFileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      console.log(`[Audio] Downloaded file info:`, downloadedFileInfo);

      console.log(
        `[Audio] Successfully cached YouTube stream ${downloadResult.headers?.["content-length"] || "unknown size"} bytes for track: ${trackId}`
      );

      // Store in cache
      this.soundCloudCache.set(trackId, cacheFilePath);
      console.log(`[Audio] Stored cache file path: ${cacheFilePath}`);

      // Continue downloading the rest of the file in the background
      this.downloadFullTrackInBackground(
        streamUrl,
        cacheFilePath,
        trackId,
        controller
      );

      console.log(
        `[Audio] YouTube background caching completed for track: ${trackId}`
      );

      // Return the cached file path so the player uses the local file
      const resultPath = `file://${cacheFilePath}`;
      console.log(`[Audio] Returning cached file path: ${resultPath}`);
      return resultPath;
    } catch (error) {
      console.log(
        `[Audio] YouTube background caching failed: ${
          error instanceof Error ? error.message : error
        }`
      );
      console.log(
        `[Audio] YouTube stream URL: ${streamUrl.substring(0, 100)}...`
      );

      // Try to get more error details
      if (error instanceof Error) {
        console.log(`[Audio] Error stack: ${error.stack}`);
      }

      // Log the error but don't fail - YouTube URLs expire quickly
      // We'll try again on the next playback attempt
      console.log(
        `[Audio] YouTube caching failed for ${trackId}, will retry next time`
      );

      // Return the original stream URL as fallback (don't cache on failure)
      return streamUrl;
    }
  }

  /**
   * Post-playback YouTube caching - cache after successful playback
   * This is more reliable since we have a working URL
   */
  public async cacheYouTubeStreamPostPlayback(
    streamUrl: string,
    trackId: string
  ): Promise<void> {
    // Skip if already cached
    if (this.soundCloudCache.has(trackId)) {
      console.log(`[Audio] YouTube track already cached: ${trackId}`);
      return;
    }

    console.log(
      `[Audio] Post-playback caching YouTube stream for track: ${trackId}`
    );

    try {
      const cacheDir = `${FileSystem.cacheDirectory}youtube-cache/`;
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });

      const cacheFilePath = `${cacheDir}${trackId}.webm`;
      const fullFilePath = cacheFilePath + ".full";

      // Check if we already have a full file
      const fullFileInfo = await FileSystem.getInfoAsync(fullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 5242880) {
        console.log(
          `[Audio] YouTube full cached file already exists for: ${trackId}`
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
        }
      );

      if (downloadResult.status === 200) {
        console.log(
          `[Audio] YouTube stream downloaded successfully for: ${trackId}`
        );

        // Check file size
        const fileInfo = await FileSystem.getInfoAsync(cacheFilePath);
        if (fileInfo.exists && fileInfo.size > 0) {
          console.log(
            `[Audio] YouTube cached file size: ${fileInfo.size} bytes`
          );

          // If file is large enough, mark it as full
          if (fileInfo.size > 5242880) {
            // 5MB
            await FileSystem.moveAsync({
              from: cacheFilePath,
              to: fullFilePath,
            });
            this.soundCloudCache.set(trackId, fullFilePath);
            console.log(`[Audio] YouTube full cached file saved: ${trackId}`);
          } else {
            this.soundCloudCache.set(trackId, cacheFilePath);
            console.log(
              `[Audio] YouTube partial cached file saved: ${trackId}`
            );
          }
        }
      } else {
        console.log(
          `[Audio] YouTube download failed with status: ${downloadResult.status}`
        );
        // Clean up partial file
        try {
          await FileSystem.deleteAsync(cacheFilePath);
        } catch (cleanupError) {
          console.log(
            `[Audio] Failed to cleanup partial file: ${cleanupError}`
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
    controller: AbortController
  ): Promise<string> {
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      console.log(`[Audio] Background cache hit for track: ${trackId}`);
      const cachedPath = this.soundCloudCache.get(trackId)!;
      return `file://${cachedPath}`;
    }

    console.log(
      `[Audio] Background caching first 5MB of SoundCloud stream for track: ${trackId}`
    );

    try {
      // Create cache directory if it doesn't exist
      const cacheDir = `${FileSystem.cacheDirectory}soundcloud-cache/`;
      console.log(`[Audio] Creating SoundCloud cache directory: ${cacheDir}`);
      try {
        await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
      } catch (mkdirError: any) {
        console.warn(
          "[Audio] Could not create SoundCloud cache directory:",
          mkdirError
        );
        console.warn("[Audio] Continuing with existing directory or fallback");
        // Don't return here - the directory might already exist
      }

      // Test if we can write to the directory
      const testFile = `${cacheDir}test.txt`;
      try {
        await FileSystem.writeAsStringAsync(testFile, "test");
        await FileSystem.deleteAsync(testFile, { idempotent: true });
        console.log("[Audio] SoundCloud cache directory is writable");
      } catch (writeError: any) {
        console.error(
          "[Audio] SoundCloud cache directory is not writable:",
          writeError
        );
        console.error("[Audio] Error details:", {
          message: writeError.message,
          code: writeError.code,
          directory: cacheDir,
          fileSystem: FileSystem.cacheDirectory,
        });
        // Continue without caching - return original stream URL
        console.log(
          "[Audio] Continuing without SoundCloud caching due to directory issues"
        );
        return streamUrl;
      }

      const cacheFilePath = `${cacheDir}${trackId}.mp3`;

      // Check if we have a full file available first
      const fullFilePath = cacheFilePath + ".full";
      const fullFileInfo = await FileSystem.getInfoAsync(fullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 5242880) {
        console.log(
          `[Audio] Using existing full cached file for track: ${trackId}`
        );
        this.soundCloudCache.set(trackId, fullFilePath);
        return `file://${fullFilePath}`; // Return the full cached file path
      }

      // Check if partial file exists
      const fileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      if (fileInfo.exists) {
        console.log(
          `[Audio] Using existing partial cached file for track: ${trackId}`
        );
        this.soundCloudCache.set(trackId, cacheFilePath);
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
        }
      );

      if (downloadResult.status !== 200 && downloadResult.status !== 206) {
        throw new Error(
          `Failed to download stream chunk: ${downloadResult.status}`
        );
      }

      console.log(
        `[Audio] Successfully cached ${
          downloadResult.headers?.["content-length"] || "unknown size"
        } bytes for track: ${trackId}`
      );

      // Store in cache
      this.soundCloudCache.set(trackId, cacheFilePath);

      // Continue downloading the rest of the file in the background for better playback
      this.downloadFullTrackInBackground(
        streamUrl,
        cacheFilePath,
        trackId,
        controller
      );

      console.log(`[Audio] Background caching completed for track: ${trackId}`);

      // Return the cached file path so the player uses the local file
      return `file://${cacheFilePath}`;
    } catch (error) {
      console.log(
        `[Audio] Background caching failed: ${
          error instanceof Error ? error.message : error
        }`
      );
      // Don't throw - this is background caching, failures shouldn't affect playback
      // Return the original stream URL as fallback
      return streamUrl;
    }
  }

  static getInstance(): AudioStreamManager {
    if (!AudioStreamManager.instance) {
      AudioStreamManager.instance = new AudioStreamManager();
    }
    return AudioStreamManager.instance;
  }

  private setupFallbackStrategies() {
    // Strategy 1: Local extraction server (if available)
    // this.fallbackStrategies.push(this.tryLocalExtraction.bind(this));
    // Strategy 2: SoundCloud API (high priority for music)
    // this.fallbackStrategies.push(this.trySoundCloud.bind(this));
    // Strategy 3: JioSaavn API for music content
    // this.fallbackStrategies.push(this.tryJioSaavn.bind(this));
    // Strategy 4: YouTube Music extraction
    // this.fallbackStrategies.push(this.tryYouTubeMusic.bind(this));
    // Strategy 5: Spotify Web API (requires auth but has good coverage)
    // this.fallbackStrategies.push(this.trySpotifyWebApi.bind(this));
    // Strategy 6: Hyperpipe API
    // this.fallbackStrategies.push(this.tryHyperpipe.bind(this));
    // Strategy 7: Invidious instances (health-checked) - PRIMARY FOR YOUTUBE
    this.fallbackStrategies.push(this.tryInvidious.bind(this));
    // Strategy 8: Piped API (alternative to Invidious)
    // this.fallbackStrategies.push(this.tryPiped.bind(this));
    // Strategy 9: YouTube embed extraction (last resort)
    // this.fallbackStrategies.push(this.tryYouTubeEmbed.bind(this));
  }

  async getAudioUrl(
    videoId: string,
    onStatusUpdate?: (status: string) => void,
    source?: string,
    trackTitle?: string,
    trackArtist?: string
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

    // --- SOUNDCLOUD HANDLING (with fallbacks) ---
    if (source === "soundcloud") {
      onStatusUpdate?.("Using SoundCloud strategy (with fallbacks)");
      console.log(
        `[AudioStreamManager] SoundCloud mode activated for: ${videoId}`
      );
      try {
        console.log(
          `[Audio] Attempting SoundCloud extraction for track: ${videoId}`
        );
        const soundCloudUrl = await this.trySoundCloud(
          videoId,
          this.currentTrackTitle,
          this.currentTrackArtist
        );

        if (soundCloudUrl) {
          console.log("[Audio] SoundCloud strategy succeeded!");
          console.log(`[Audio] SoundCloud URL result: ${soundCloudUrl}`);
          console.log(
            `[Audio] Is cached file: ${soundCloudUrl.startsWith("file://")}`
          );

          // Ensure we have a cached file before returning
          if (!soundCloudUrl.startsWith("file://")) {
            onStatusUpdate?.("Caching SoundCloud audio...");
            const controller = new AbortController();
            const cachedUrl = await this.cacheSoundCloudStream(
              soundCloudUrl,
              videoId,
              controller
            );
            console.log(`[Audio] SoundCloud cached result: ${cachedUrl}`);
            return cachedUrl;
          }

          return soundCloudUrl;
        }
      } catch (error) {
        console.error(
          "[Audio] SoundCloud strategy failed, will try fallback strategies:",
          error
        );
        // Don't throw immediately - allow fallback strategies to try
        onStatusUpdate?.("SoundCloud failed, trying fallback strategies...");
      }
    }

    // --- STANDARD FALLBACK LOGIC (For non-SoundCloud sources) ---

    // Try concurrent testing first (ytify v8 concept)
    const concurrentResult = await this.testConcurrentStrategies(
      videoId,
      onStatusUpdate
    );

    if (concurrentResult) {
      return concurrentResult;
    }

    // Fallback to sequential strategy testing
    return this.testSequentialStrategies(videoId, onStatusUpdate);
  }

  private async testConcurrentStrategies(
    videoId: string,
    onStatusUpdate?: (status: string) => void
  ): Promise<string | null> {
    onStatusUpdate?.("Testing strategies concurrently...");

    // Run first 3 strategies concurrently with timeout
    const concurrentPromises = this.fallbackStrategies
      .slice(0, 3)
      .map(async (strategy, index) => {
        const strategyName = strategy.name || `Strategy ${index + 1}`;
        const startTime = Date.now();
        try {
          const url = await Promise.race([
            strategy(videoId),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), 8000)
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
        fastest.strategy.includes("Piped")
      ) {
        // For YouTube strategies, ensure caching is complete before returning
        try {
          onStatusUpdate?.("Caching audio before playback...");
          const controller = new AbortController();
          const cachedUrl = await this.cacheYouTubeStream(
            fastest.url,
            videoId,
            controller
          );
          console.log(
            `[Audio] YouTube caching completed for ${videoId}: ${cachedUrl !== fastest.url ? "cached" : "original"}`
          );
          return cachedUrl;
        } catch (cacheError) {
          console.log(
            `[Audio] YouTube caching failed, using original URL: ${cacheError}`
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
    onStatusUpdate?: (status: string) => void
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
                controller
              );
              console.log(
                `[Audio] YouTube caching completed for ${videoId}: ${cachedUrl !== url ? "cached" : "original"}`
              );
              return cachedUrl;
            } catch (cacheError) {
              console.log(
                `[Audio] YouTube caching failed, using original URL: ${cacheError}`
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
      `All audio extraction strategies failed. Errors: ${errors.join("; ")}`
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
          error
        );
        throw error;
      }
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
    timeout = 30000
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
            Accept: "application/json, text/plain, */*",
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
            `Cloudflare/blocked API request: ${hasCloudflare ? "Cloudflare detected" : hasBlockingPage ? "Blocking page" : "HTML response to API request"}`
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
            "Service unavailable (503): Instance may be overloaded"
          );
        } else if (response.status === 502) {
          throw new Error("Bad gateway (502): Instance proxy error");
        } else if (response.status === 404) {
          throw new Error("Not found (404): Resource not available");
        } else if (response.status >= 500) {
          throw new Error(
            `Server error (${response.status}): Instance may be down`
          );
        }

        if (i < retries) {
          const proxyUrl = this.getNextProxy() + encodeURIComponent(url);
          const proxyController = new AbortController();
          const proxyTimeoutId = setTimeout(
            () => proxyController.abort(),
            timeout
          );

          const proxyResponse = await fetch(proxyUrl, {
            ...options,
            signal: proxyController.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/json, text/plain, */*",
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
              `Cloudflare/blocked API request via proxy: ${proxyHasCloudflare ? "Cloudflare detected" : "HTML response to API request"}`
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
          `[AudioStreamManager] fetchWithProxy attempt ${i + 1} failed for ${url}: ${errorMessage}`
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
          `[AudioStreamManager] Waiting ${Math.round(backoffMs)}ms before retry ${i + 2}`
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
        }`
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
            `${cleanTitle} ${cleanAuthor}`
          ).trim();
          const searchUrl = `${endpoint}?query=${query}`;

          // Use our enhanced fetch method
          const searchResponse = await this.fetchWithProxy(
            searchUrl,
            {},
            2,
            30000
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
        }`
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
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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
                    audioUrl[1].replace(/\\u0026/g, "&")
                  );
                }
              }

              // Alternative: Look for adaptive formats
              const adaptiveMatches = html.match(
                /"adaptiveFormats":\[([^\]]*)\]/
              );
              if (adaptiveMatches && adaptiveMatches[1]) {
                try {
                  const formats = JSON.parse(`[${adaptiveMatches[1]}]`);
                  const audioFormats = formats.filter((f: any) =>
                    f.mimeType?.startsWith("audio/")
                  );

                  if (audioFormats.length > 0) {
                    const bestAudio = audioFormats.sort(
                      (a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0)
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
                Accept: "application/json, text/javascript, */*; q=0.01",
                "X-Requested-With": "XMLHttpRequest",
              },
            });
            clearTimeout(timeoutId);

            if (response.ok) {
              const data = await response.json();
              if (data.links && data.links.mp3) {
                const mp3Links = data.links.mp3;
                const bestQuality = Object.keys(mp3Links).sort(
                  (a, b) => parseInt(b) - parseInt(a)
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
        }`
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
        }`
      );
    }
  }

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
            Accept: "application/json, text/plain, */*",
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
        // First try to find audio-only streams
        const audioStreams = data.formatStreams
          .filter(
            (f: any) =>
              f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/")
          )
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

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
        }`
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
        { signal: controller.signal }
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
            track.external_urls.spotify
          )}`,
          {
            method: "GET",
            headers: {
              "X-RapidAPI-Key": "demo-key", // This would need a real API key
              "X-RapidAPI-Host": "spotify-downloader1.p.rapidapi.com",
            },
            signal: controller.signal,
          }
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
        }`
      );
    }
  }

  private async trySoundCloud(
    videoId: string,
    trackTitle?: string,
    trackArtist?: string,
    onStatusUpdate?: (status: string) => void
  ): Promise<string> {
    try {
      console.log(
        `[Audio] trySoundCloud called with videoId: ${videoId}, title: ${trackTitle}, artist: ${trackArtist}`
      );

      // Check if this is a SoundCloud track (from our search results)
      const trackId = this.extractSoundCloudTrackId(videoId);
      console.log(`[Audio] Extracted trackId: ${trackId}`);
      if (!trackId) {
        throw new Error("Not a SoundCloud track ID");
      }

      console.log(`[Audio] Searching for SoundCloud track: ${trackId}`);

      // Strategy 1: Try to access the track directly via widget API
      try {
        console.log(
          `[Audio] Trying to access track ${trackId} directly via widget API`
        );

        // Add retry logic for better reliability
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
          try {
            const directUrl = `https://api-widget.soundcloud.com/resolve?url=https://api.soundcloud.com/tracks/${trackId}&client_id=${this.SOUNDCLOUD_CLIENT_ID}&format=json`;
            console.log(`[Audio] Direct widget URL: ${directUrl}`);

            // Use CORS proxy for the API call
            const proxiedDirectUrl = this.getCorsProxyUrl(directUrl);
            console.log(`[Audio] Using CORS proxy: ${proxiedDirectUrl}`);

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
            console.log(
              `[Audio] Direct widget response status: ${directResponse.status}`
            );

            if (directResponse.ok) {
              const trackData = await directResponse.json();
              console.log(
                `[Audio] Successfully retrieved track: ${
                  trackData.title || trackData.id
                }`
              );

              if (trackData && trackData.media?.transcodings?.length > 0) {
                console.log(
                  `[Audio] Track has ${trackData.media.transcodings.length} transcodings`
                );
                return await this.extractSoundCloudStream(
                  trackData,
                  controller
                );
              } else {
                console.log("[Audio] Track has no transcodings available");
              }
            } else {
              console.log(
                `[Audio] Direct widget failed with status: ${directResponse.status}`
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
              }`
            );
            if (retryCount < maxRetries) {
              console.log(`[Audio] Retrying in ${retryCount * 1000}ms...`);
              await new Promise((resolve) =>
                setTimeout(resolve, retryCount * 1000)
              );
            }
          }
        }
      } catch (directError) {
        console.log(
          `[Audio] Direct widget strategy failed: ${
            directError instanceof Error ? directError.message : directError
          }`
        );
      }

      // Strategy 2: Try using the SoundCloud widget API directly
      try {
        console.log("[Audio] Trying widget API directly");
        // Use a proper SoundCloud URL format
        const widgetUrl = `https://api-widget.soundcloud.com/resolve?url=https://api.soundcloud.com/tracks/${trackId}&client_id=${this.SOUNDCLOUD_CLIENT_ID}&format=json`;
        console.log(`[Audio] Widget URL: ${widgetUrl}`);

        // Use CORS proxy for the widget API call
        const proxiedWidgetUrl = this.getCorsProxyUrl(widgetUrl);
        console.log(`[Audio] Using CORS proxy for widget: ${proxiedWidgetUrl}`);

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
          console.log(
            "[Audio] Widget response data keys:",
            Object.keys(widgetData)
          );
          if (widgetData && widgetData.media && widgetData.media.transcodings) {
            console.log(`[Audio] Found track via widget: ${widgetData.title}`);
            return await this.extractSoundCloudStream(widgetData, controller);
          } else if (widgetData && widgetData.id) {
            console.log(
              `[Audio] Found track via widget (no transcodings): ${
                widgetData.title || widgetData.id
              }`
            );
            // Even if no transcodings, we can try to use this data
            return await this.extractSoundCloudStream(widgetData, controller);
          }
        } else {
          console.log(
            `[Audio] Widget API failed with status: ${widgetResponse.status}`
          );
          const errorText = await widgetResponse.text();
          console.log(`[Audio] Widget API error: ${errorText}`);
        }
      } catch (widgetError) {
        console.log(
          `[Audio] Widget strategy failed: ${
            widgetError instanceof Error ? widgetError.message : widgetError
          }`
        );
      }

      // Strategy 3: Search for the specific track by title and artist
      if (trackTitle || trackArtist) {
        try {
          const searchQuery = [trackTitle, trackArtist]
            .filter(Boolean)
            .join(" ");
          console.log(`[Audio] Searching for track: "${searchQuery}"`);

          const searchUrl = `https://proxy.searchsoundcloud.com/tracks?q=${encodeURIComponent(
            searchQuery
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
          console.log(
            `[Audio] Search response status: ${searchResponse.status}`
          );

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            console.log(
              `[Audio] Search found ${
                searchData.collection?.length || 0
              } tracks`
            );

            if (searchData.collection && searchData.collection.length > 0) {
              // Look for exact match by track ID first
              const exactMatch = searchData.collection.find(
                (track: any) => String(track.id) === trackId
              );

              if (exactMatch) {
                console.log(`[Audio] Found exact match: ${exactMatch.title}`);
                return await this.extractSoundCloudStream(
                  exactMatch,
                  controller
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
                console.log(
                  `[Audio] Found title/artist match: ${titleMatch.title}`
                );
                return await this.extractSoundCloudStream(
                  titleMatch,
                  controller
                );
              }

              // If no exact matches, try the first track with transcodings
              const availableTrack = searchData.collection.find(
                (track: any) => track.media?.transcodings?.length > 0
              );

              if (availableTrack) {
                console.log(
                  `[Audio] Using first available track: ${availableTrack.title}`
                );
                return await this.extractSoundCloudStream(
                  availableTrack,
                  controller
                );
              }
            }
          }
        } catch (searchError) {
          console.log(
            `[Audio] Search strategy failed: ${
              searchError instanceof Error ? searchError.message : searchError
            }`
          );
        }
      }

      // Strategy 4: Fallback - try to construct a direct stream URL
      console.log("[Audio] Falling back to direct URL construction");
      const fallbackUrl = `https://api.soundcloud.com/tracks/${trackId}/stream?client_id=${this.SOUNDCLOUD_CLIENT_ID}`;
      console.log(`[Audio] Fallback URL: ${fallbackUrl}`);

      // Test if this URL works using CORS proxy
      const proxiedFallbackUrl = this.getCorsProxyUrl(fallbackUrl);
      console.log(
        `[Audio] Using CORS proxy for fallback test: ${proxiedFallbackUrl}`
      );

      try {
        const testResponse = await fetch(proxiedFallbackUrl, {
          method: "HEAD",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
        });

        if (testResponse.ok) {
          console.log("[Audio] Fallback URL is accessible");
          return fallbackUrl;
        }
      } catch (testError) {
        console.log(
          `[Audio] Fallback URL test failed: ${
            testError instanceof Error ? testError.message : testError
          }`
        );
      }

      throw new Error(`Track with ID ${trackId} not found or unavailable`);
    } catch (error) {
      throw new Error(
        `SoundCloud playback failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async extractSoundCloudStream(
    trackData: any,
    controller: AbortController
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
          t.preset === "mp3_standard" && t.format?.protocol === "progressive"
      ) ||
      trackData.media.transcodings.find(
        (t: any) => t.format?.protocol === "progressive"
      ) ||
      trackData.media.transcodings.find(
        (t: any) => t.format?.protocol === "hls"
      );

    if (!preferredTranscoding) {
      throw new Error("No suitable audio stream found");
    }

    console.log(
      `[Audio] Found transcoding: ${preferredTranscoding.preset} (${preferredTranscoding.format?.protocol})`
    );

    const transcodingUrl = preferredTranscoding.url;
    const resolveUrl = new URL(transcodingUrl);

    // Append the client_id - this is crucial for the API to return the stream URL
    resolveUrl.searchParams.append("client_id", this.SOUNDCLOUD_CLIENT_ID);

    if (trackData.track_authorization) {
      resolveUrl.searchParams.append(
        "track_authorization",
        trackData.track_authorization
      );
    }

    // Try to resolve the stream URL through the API using CORS proxy
    console.log(`[Audio] Fetching stream URL from: ${resolveUrl.toString()}`);
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
          console.log("[Audio] SoundCloud stream URL resolved successfully");

          // For SoundCloud, we need to use the CORS proxy for the actual stream too
          // because the resolved URLs often have CORS restrictions
          const proxiedStreamUrl = this.getCorsProxyUrl(streamData.url);
          console.log(
            `[Audio] Using CORS proxy for stream: ${proxiedStreamUrl}`
          );

          // Cache the first megabyte of the stream before returning
          return await this.cacheSoundCloudStream(
            proxiedStreamUrl,
            trackData.id.toString(),
            controller
          );
        }
      } else {
        console.warn(
          `[Audio] Failed to resolve stream. Status: ${streamResponse.status}`
        );
      }
    } catch (streamError) {
      console.log(
        `[Audio] Failed to fetch stream URL: ${
          streamError instanceof Error ? streamError.message : streamError
        }`
      );
    }

    // Fallback: Try using the widget API to get a working stream
    console.log(
      `[Audio] Trying widget API fallback for track: ${trackData.id}`
    );
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
          /\"(https?:\/\/[^\"]*\.mp3[^\"]*)\"/
        );
        if (streamUrlMatch) {
          console.log(
            `[Audio] Found stream URL in widget: ${streamUrlMatch[1]}`
          );

          // Use CORS proxy for the stream URL too
          const proxiedWidgetStreamUrl = this.getCorsProxyUrl(
            streamUrlMatch[1]
          );
          console.log(
            `[Audio] Using CORS proxy for widget stream: ${proxiedWidgetStreamUrl}`
          );

          // Cache the first megabyte of the stream before returning
          return await this.cacheSoundCloudStream(
            proxiedWidgetStreamUrl,
            trackData.id.toString(),
            controller
          );
        }
      }
    } catch (widgetError) {
      console.log(
        `[Audio] Widget fallback failed: ${
          widgetError instanceof Error ? widgetError.message : widgetError
        }`
      );
    }

    // Last resort: return the transcoding URL with CORS proxy
    console.log("[Audio] Using transcoding URL with CORS proxy as last resort");

    // Cache the first megabyte of the stream before returning
    const proxiedUrl = this.getCorsProxyUrl(resolveUrl.toString());
    return await this.cacheSoundCloudStream(
      proxiedUrl,
      trackData.id.toString(),
      controller
    );
  }

  private extractSoundCloudTrackId(videoId: string): string | null {
    console.log(`[Audio] extractSoundCloudTrackId called with: ${videoId}`);
    // Check if this looks like a SoundCloud track ID (numeric)
    if (/^\d+$/.test(videoId)) {
      console.log(`[Audio] Found numeric SoundCloud ID: ${videoId}`);
      return videoId;
    }
    // Check if this is a SoundCloud permalink URL and extract track ID
    const soundcloudMatch = videoId.match(/soundcloud\.com\/.*\/.*?(\d+)$/);
    if (soundcloudMatch) {
      console.log(`[Audio] Found SoundCloud URL ID: ${soundcloudMatch[1]}`);
      return soundcloudMatch[1];
    }
    console.log(`[Audio] No SoundCloud ID found in: ${videoId}`);
    return null;
  }

  /*
  // private async tryPiped(videoId: string): Promise<string> {
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
        }`
      );
    }
  }
  */

  // Helper method to get video info with extended timeout

  // Helper method to get video info with extended timeout
  private async getVideoInfoWithTimeout(
    videoId: string,
    timeout = 30000
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
              Accept: "application/json, text/html, */*",
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
    videoId: string
  ): Promise<{ title?: string; author?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(
        `https://invidious.nerdvpn.de/api/v1/videos/${videoId}`,
        { signal: controller.signal }
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
          }
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
    onProgress?: (percentage: number) => void
  ): Promise<void> {
    try {
      console.log(
        `[Audio] Resuming cache download from position ${startPosition} for track: ${trackId}`
      );

      // Mark download as started to indicate active resume operation
      this.markDownloadStarted(trackId, streamUrl);

      // Try to download the rest of the file starting from the current position
      const resumeResult = await FileSystem.downloadAsync(
        streamUrl,
        cacheFilePath + ".resume",
        {
          headers: {
            Range: `bytes=${startPosition}-`,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Referer: "https://www.youtube.com/",
            Origin: "https://www.youtube.com/",
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        }
      );

      if (resumeResult.status === 200 || resumeResult.status === 206) {
        console.log(`[Audio] Resume download successful for track: ${trackId}`);

        // Check if the resume file exists and has content
        const resumeFileInfo = await FileSystem.getInfoAsync(
          cacheFilePath + ".resume"
        );
        if (!resumeFileInfo.exists || resumeFileInfo.size === 0) {
          console.warn(
            `[Audio] Resume file is empty or doesn't exist for track: ${trackId}`
          );
          // Clean up resume file if it exists
          await FileSystem.deleteAsync(cacheFilePath + ".resume", {
            idempotent: true,
          });
          return;
        }

        try {
          // Append the resumed content to the existing file
          const resumedContent = await FileSystem.readAsStringAsync(
            cacheFilePath + ".resume",
            { encoding: FileSystem.EncodingType.Base64 }
          );

          const existingContent = await FileSystem.readAsStringAsync(
            cacheFilePath,
            { encoding: FileSystem.EncodingType.Base64 }
          );

          // Combine the contents
          await FileSystem.writeAsStringAsync(
            cacheFilePath,
            existingContent + resumedContent,
            { encoding: FileSystem.EncodingType.Base64 }
          );
        } catch (base64Error) {
          console.error(
            `[Audio] Base64 encoding error during resume for track: ${trackId}`,
            base64Error
          );
          // Fallback: Use binary-safe file copying
          try {
            console.log(`[Audio] Attempting binary-safe file combination`);

            // Use copyAsync to append files safely
            const tempCombinedPath = cacheFilePath + ".combined";

            // First copy the existing file to temp location
            await FileSystem.copyAsync({
              from: cacheFilePath,
              to: tempCombinedPath,
            });

            // Then append the resume content using UTF8 encoding (safer than base64)
            const existingContent = await FileSystem.readAsStringAsync(
              tempCombinedPath,
              { encoding: FileSystem.EncodingType.UTF8 }
            );
            const resumeContent = await FileSystem.readAsStringAsync(
              cacheFilePath + ".resume",
              { encoding: FileSystem.EncodingType.UTF8 }
            );

            await FileSystem.writeAsStringAsync(
              tempCombinedPath,
              existingContent + resumeContent,
              { encoding: FileSystem.EncodingType.UTF8 }
            );

            // Replace the original file with the combined one
            await FileSystem.copyAsync({
              from: tempCombinedPath,
              to: cacheFilePath,
            });

            // Clean up temp files
            await FileSystem.deleteAsync(tempCombinedPath, {
              idempotent: true,
            });

            console.log(`[Audio] Successfully combined cache files using UTF8`);
          } catch (utf8Error) {
            console.error(`[Audio] UTF8 combination failed:`, utf8Error);
            // Final fallback: just replace the original file with the resumed one
            try {
              await FileSystem.copyAsync({
                from: cacheFilePath + ".resume",
                to: cacheFilePath,
              });
              console.log(
                `[Audio] Fallback: Replaced cache file with resumed content`
              );
            } catch (finalError) {
              console.error(`[Audio] Final fallback failed:`, finalError);
              throw finalError;
            }
          }
        }

        // Clean up resume file
        await FileSystem.deleteAsync(cacheFilePath + ".resume", {
          idempotent: true,
        });

        console.log(`[Audio] Cache resumed and combined for track: ${trackId}`);

        // Report updated progress
        // Add a small delay to ensure filesystem has updated the file size
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const updatedCacheInfo = await this.getCacheInfo(trackId);
        onProgress?.(updatedCacheInfo.percentage);
        console.log(
          `[Audio] Updated cache progress after resume: ${updatedCacheInfo.percentage}%`
        );

        // Mark download as completed
        this.markDownloadCompleted(trackId, updatedCacheInfo.fileSize);
      } else {
        console.log(
          `[Audio] Resume download failed with status: ${resumeResult.status}`
        );
      }
    } catch (error) {
      console.error(
        `[Audio] Failed to resume cache download for track ${trackId}:`,
        error
      );
      // Clean up resume file on error
      try {
        await FileSystem.deleteAsync(cacheFilePath + ".resume", {
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

// Enhanced convenience functions with ytify v8 concepts
export async function getAudioStreamUrl(
  videoId: string,
  onStatus?: (status: string) => void,
  source?: string,
  trackTitle?: string,
  trackArtist?: string
): Promise<string> {
  return AudioStreamManager.getInstance().getAudioUrl(
    videoId,
    onStatus,
    source,
    trackTitle,
    trackArtist
  );
}

export async function prefetchAudioStreamUrl(
  videoId: string,
  source?: string
): Promise<void> {
  return AudioStreamManager.getInstance().prefetchAudioUrl(videoId, source);
}

export async function prefetchAudioStreamQueue(
  videoIds: string[]
): Promise<void> {
  return AudioStreamManager.getInstance().prefetchQueueItems(videoIds);
}

/**
 * Monitor cache progress during playback and resume if stuck
 * This function checks if cache percentage is not increasing and resumes download
 */
export async function monitorAndResumeCache(
  trackId: string,
  currentAudioUrl: string,
  onProgress?: (percentage: number) => void
): Promise<void> {
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

      console.log(
        `[CacheMonitor] Track ${trackId}: ${currentPercentage}% cached`
      );
      onProgress?.(currentPercentage);

      // If there's no active progress but we have substantial partial cache (>=30%), try to resume
      if (
        currentPercentage >= 30 &&
        currentPercentage < 98 &&
        cacheInfo.isDownloading === false
      ) {
        console.log(
          `[CacheMonitor] Found substantial partial cache (${currentPercentage}%) but no active download, attempting resume for track: ${trackId}`
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
              console.log(
                `[CacheMonitor] Found existing cache file (${currentSize} bytes), resuming download`
              );

              // Resume downloading from the current position
              const resumeController = new AbortController();
              await manager.resumeCacheDownload(
                originalStreamUrl,
                filePath,
                trackId,
                currentSize,
                resumeController,
                onProgress
              );
              return; // Exit early after resuming
            }
          }
        }
      }

      // If there's no active progress but we have a cached URL, try to resume
      if (currentPercentage === 0 && cacheInfo.isDownloading === false) {
        const originalStreamUrl = getOriginalStreamUrl();
        if (originalStreamUrl) {
          console.log(
            `[CacheMonitor] Found cached URL but no active progress, attempting resume for track: ${trackId}`
          );

          // Check if we have any cached file to resume from
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const filePath = cachedFilePath.replace("file://", "");
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            const currentSize = fileInfo.exists ? fileInfo.size : 0;

            if (currentSize > 0) {
              console.log(
                `[CacheMonitor] Found existing cache file (${currentSize} bytes), resuming download`
              );

              // Resume downloading from the current position
              const resumeController = new AbortController();
              await manager.resumeCacheDownload(
                originalStreamUrl,
                filePath,
                trackId,
                currentSize,
                resumeController,
                onProgress
              );
              return; // Exit early after resuming
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
          `[CacheMonitor] Cache appears stuck (${stuckCount}/3) for track: ${trackId}, last: ${lastPercentage}, current: ${currentPercentage}`
        );

        if (stuckCount >= maxStuckCount) {
          console.log(
            `[CacheMonitor] Resuming stuck cache for track: ${trackId}`
          );

          // Resume the cache download from the last position
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const filePath = cachedFilePath.replace("file://", "");
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            const currentSize = fileInfo.exists ? fileInfo.size : 0;

            console.log(
              `[CacheMonitor] Current file size: ${currentSize} bytes`
            );

            // Get the original streaming URL from cache progress
            const originalStreamUrl = getOriginalStreamUrl();

            if (originalStreamUrl) {
              // Create a new controller for the resume operation
              const resumeController = new AbortController();

              // Resume downloading from the current position
              await manager.resumeCacheDownload(
                originalStreamUrl,
                filePath,
                trackId,
                currentSize,
                resumeController,
                onProgress
              );

              stuckCount = 0; // Reset stuck counter after resuming
            } else {
              console.warn(
                `[CacheMonitor] Cannot resume cache - no original streaming URL available for track: ${trackId}`
              );
            }
          } else {
            console.warn(
              `[CacheMonitor] No cached file path found for track: ${trackId}`
            );
          }
        }
      } else {
        stuckCount = 0; // Reset if progress is detected
        console.log(
          `[CacheMonitor] Progress detected: ${lastPercentage}% -> ${currentPercentage}%`
        );
      }

      lastPercentage = currentPercentage;

      // Continue monitoring if not fully cached (increased threshold to 98%)
      if (currentPercentage < 98) {
        setTimeout(checkCacheProgress, 3000); // Check every 3 seconds (reduced from 5)
      } else {
        console.log(
          `[CacheMonitor] Cache nearly complete (${currentPercentage}%), stopping monitoring`
        );
      }
    } catch (error) {
      console.error(
        `[CacheMonitor] Error monitoring cache for track ${trackId}:`,
        error
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
