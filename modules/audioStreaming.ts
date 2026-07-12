import { Audio } from "expo-av";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { toByteArray, fromByteArray } from "base64-js";
import {
  API,
  fetchWithRetry,
  DYNAMIC_INVIDIOUS_INSTANCES,
  getJioSaavnFallbackSearchBase,
  getLocalProxyBase,
  getProviderOrigin,
  getProviderReferer,
  getPrimaryInvidiousInstance,
  getSoundCloudApiBase,
  getSoundCloudApiV2Base,
  getSoundCloudWidgetBase,
  getYouTubeMusicBase,
  getYouTubeWebBase,
  normalizeInvidiousInstance,
  getJioSaavnSongEndpoint,
} from "../components/core/api";
import {
  buildProviderUrlCandidates,
  getProviderEndpoints,
} from "../lib/provider-endpoints";
import { getRuntimeServiceConfig } from "../lib/runtime-services";

// Cache directory configuration
const STREAMIFY_TEMP_CACHE_DIR_CANDIDATES = [
  () => `${FileSystem.cacheDirectory}Streamify/cache/`,
  () => `${FileSystem.documentDirectory}Streamify/cache/`,
  () => `${FileSystem.cacheDirectory}Streamify/`,
  () => `${FileSystem.cacheDirectory}youtube-cache/`,
  () => `${FileSystem.cacheDirectory}audio-cache/`,
  () => `${FileSystem.documentDirectory}audio-cache/`,
];

const STREAMIFY_OFFLINE_DIR_CANDIDATES = [
  () => `${FileSystem.documentDirectory}Streamify/offline/`,
  () => `${FileSystem.cacheDirectory}Streamify/offline/`,
];

async function ensureWritableDirectory(
  dir: string,
  label: string
): Promise<string | null> {
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const testFile = `${dir}.writetest_${Date.now()}`;
    await FileSystem.writeAsStringAsync(testFile, "test");
    await FileSystem.deleteAsync(testFile, { idempotent: true });
    console.log(`[Audio] Using ${label}: ${dir}`);
    return dir;
  } catch (error) {
    console.warn(`[Audio] ${label} not available: ${dir}`, error);
    return null;
  }
}

const CACHE_CONFIG = {
  // Try these directories in order of preference
  cacheDirs: STREAMIFY_TEMP_CACHE_DIR_CANDIDATES,
  getBestCacheDir: async function (): Promise<string | null> {
    for (const dirFunc of this.cacheDirs) {
      const dir = dirFunc();
      const resolved = await ensureWritableDirectory(dir, "cache directory");
      if (resolved) {
        return resolved;
      }
    }
    return null;
  },
};

async function getBestOfflineDir(): Promise<string | null> {
  for (const dirFunc of STREAMIFY_OFFLINE_DIR_CANDIDATES) {
    const dir = dirFunc();
    const resolved = await ensureWritableDirectory(dir, "offline directory");
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function withTrailingSlash(value: string): string {
  if (!value) {
    return "";
  }

  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}

function stripFileUri(path: string): string {
  return path.replace(/^file:\/\//, "");
}

function inferAudioFileExtension(
  sourceUrl?: string,
  fallbackPath?: string
): string {
  const candidates = [sourceUrl, fallbackPath]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return decodeURIComponent(String(value)).toLowerCase();
      } catch {
        return String(value).toLowerCase();
      }
    });

  for (const candidate of candidates) {
    if (
      candidate.includes("audio/webm") ||
      candidate.includes(".webm") ||
      candidate.includes("mime=audio/webm")
    ) {
      return ".webm";
    }
    if (
      candidate.includes("audio/x-m4a") ||
      candidate.includes("audio/mp4") ||
      candidate.includes(".m4a") ||
      candidate.includes(".mp4") ||
      candidate.includes("mime=audio/mp4")
    ) {
      return ".m4a";
    }
    if (
      candidate.includes("audio/ogg") ||
      candidate.includes(".ogg") ||
      candidate.includes("mime=audio/ogg")
    ) {
      return ".ogg";
    }
    if (candidate.includes(".oga")) {
      return ".oga";
    }
    if (
      candidate.includes("audio/mpeg") ||
      candidate.includes("audio/mp3") ||
      candidate.includes(".mp3")
    ) {
      return ".mp3";
    }
    if (candidate.includes(".aac") || candidate.includes("audio/aac")) {
      return ".aac";
    }
  }

  return ".cache";
}

function getYouTubeHeaders() {
  return {
    Referer: getProviderReferer("youtube"),
    Origin: getProviderOrigin("youtube"),
  };
}

function getSoundCloudWidgetHeaders() {
  const widgetBase = getSoundCloudWidgetBase();
  return {
    Referer: withTrailingSlash(widgetBase),
    Origin: widgetBase,
  };
}

function getSoundCloudHeaders() {
  return {
    Referer: getProviderReferer("soundcloud"),
    Origin: getProviderOrigin("soundcloud"),
  };
}

const SOUNDCLOUD_RESTRICTED_PLAYBACK_ERROR_EN =
  "SoundCloud is restricted in your country. Use a VPN or change your IP to play SoundCloud songs.";
const SOUNDCLOUD_TRACK_UNAVAILABLE_ERROR_EN =
  "This SoundCloud track couldn't be loaded.";

function isSoundCloudRestrictedFailure(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("403") ||
    message.includes("401") ||
    message.includes("forbidden") ||
    message.includes("license") ||
    message.includes("drm") ||
    message.includes("encrypted") ||
    message.includes("restricted")
  );
}

function normalizeForMatch(value?: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(
      /\b(feat|ft|featuring|official|video|lyrics|audio|visualizer)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchScore(expectedTitle: string, actualTitle: string): number {
  const expected = normalizeForMatch(expectedTitle);
  const actual = normalizeForMatch(actualTitle);
  if (!expected || !actual) return 0;
  if (expected === actual) return 5;
  if (actual.includes(expected) || expected.includes(actual)) return 3;

  const expectedWords = new Set(expected.split(" "));
  const actualWords = new Set(actual.split(" "));
  let overlap = 0;

  for (const word of expectedWords) {
    if (actualWords.has(word)) {
      overlap += 1;
    }
  }

  return overlap >= Math.min(2, expectedWords.size) ? 2 : 0;
}

function authorMatchScore(
  expectedAuthor?: string,
  actualAuthor?: string
): number {
  const expected = normalizeForMatch(expectedAuthor);
  const actual = normalizeForMatch(actualAuthor);
  if (!expected || !actual) return 0;
  if (expected === actual) return 3;
  if (expected.split(" ").some((part) => part && actual.includes(part))) {
    return 1;
  }
  return 0;
}

// Audio streaming with multiple fallback strategies and ytify v8 concepts
export type AudioCacheProgressUpdate = AudioCacheInfo & {
  trackId: string;
};

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
  private cacheDirectoryInitPromise: Promise<void> | null = null;
  private lastCacheDirectoryInitTime = 0;
  private offlineDirectory: string | null = null;
  private offlineDirectoryInitPromise: Promise<void> | null = null;
  private lastOfflineDirectoryInitTime = 0;

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
  private cacheProgressListeners = new Set<
    (update: AudioCacheProgressUpdate) => void
  >();

  // Maximum retry attempts for failed downloads
  private readonly MAX_RETRY_ATTEMPTS = 1;
  private readonly RETRY_DELAY = 500; // 2 seconds
  private readonly PROGRESS_UPDATE_INTERVAL = 1000; // 1 second
  private readonly MIN_PROGRESS_THRESHOLD = 0.5; // Minimum 0.5% progress per update
  private readonly CACHE_DIR_INIT_COOLDOWN = 10000;

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
  private readonly CACHE_INFO_TTL = 1000;

  private buildCacheProgressUpdate(trackId: string): AudioCacheProgressUpdate {
    const progress = this.cacheProgress.get(trackId);
    if (!progress) {
      return {
        trackId,
        percentage: 0,
        fileSize: 0,
        totalFileSize: 0,
        isFullyCached: false,
        isDownloading: false,
        downloadSpeed: 0,
        retryCount: 0,
      };
    }

    const totalFileSize =
      typeof progress.estimatedTotalSize === "number" &&
      progress.estimatedTotalSize > 0
        ? Math.round((progress.estimatedTotalSize / (1024 * 1024)) * 100) / 100
        : undefined;

    return {
      trackId,
      percentage: progress.isFullyCached
        ? 100
        : Math.max(progress.percentage, progress.isDownloading ? 1 : 0),
      fileSize: progress.downloadedSize || progress.lastFileSize || 0,
      totalFileSize,
      isFullyCached: progress.isFullyCached || false,
      isDownloading: progress.isDownloading,
      downloadSpeed: progress.downloadSpeed || 0,
      retryCount: progress.retryCount || 0,
    };
  }

  private emitCacheProgressUpdate(trackId: string): void {
    if (this.cacheProgressListeners.size === 0) {
      return;
    }

    const update = this.buildCacheProgressUpdate(trackId);
    // #region debug-point A:emit-cache-progress
    fetch("http://192.168.1.106:7777/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "cache-progress-stuck",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "audioStreaming:emitCacheProgressUpdate",
        msg: "[DEBUG] cache progress emitted",
        data: {
          trackId,
          percentage: update.percentage,
          fileSize: update.fileSize,
          totalFileSize: update.totalFileSize ?? null,
          isDownloading: update.isDownloading ?? null,
          isFullyCached: update.isFullyCached,
          listenerCount: this.cacheProgressListeners.size,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    this.cacheProgressListeners.forEach((listener) => {
      try {
        listener(update);
      } catch (error) {
        console.warn(
          `[Audio] Cache progress listener failed for ${trackId}:`,
          error
        );
      }
    });
  }

  public subscribeToCacheProgress(
    listener: (update: AudioCacheProgressUpdate) => void
  ): () => void {
    this.cacheProgressListeners.add(listener);
    return () => {
      this.cacheProgressListeners.delete(listener);
    };
  }

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
  private soundCloudClientId: string | null = null;

  // YouTube instance switching for reliability (similar to YouTube's method)
  private youtubeInstances: string[] = [];
  private currentYoutubeInstanceIndex = 0;
  private preferredInvidiousInstance = "";
  private preferredPipedInstance = "";
  private youtubeInstanceHealth = new Map<
    string,
    { lastCheck: number; isHealthy: boolean }
  >();
  private readonly INSTANCE_HEALTH_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_YOUTUBE_RETRY_ATTEMPTS = 1;

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

    this.cacheDirectoryInitPromise = this.initializeCacheDirectory().finally(
      () => {
        this.cacheDirectoryInitPromise = null;
      }
    );
    this.offlineDirectoryInitPromise =
      this.initializeOfflineDirectory().finally(() => {
        this.offlineDirectoryInitPromise = null;
      });
  }

  public async warmupProviders(): Promise<void> {
    try {
      await getProviderEndpoints();
      this.initializeYoutubeInstances();
      await this.getNextHealthyInstance();
    } catch (error) {
      console.warn("[Audio] Provider warmup failed:", error);
    }
  }

  /**
   * Initialize the best available cache directory
   */
  private async initializeCacheDirectory(): Promise<void> {
    console.log("[Audio] Initializing cache directory...");
    this.cacheDirectory = await CACHE_CONFIG.getBestCacheDir();

    if (this.cacheDirectory) {
      console.log(
        `[Audio] Successfully initialized cache directory: ${this.cacheDirectory}`
      );
    } else {
      console.warn(
        "[Audio] No writable cache directory available, caching will be disabled"
      );
    }
  }

  private async initializeOfflineDirectory(): Promise<void> {
    console.log("[Audio] Initializing offline directory...");
    this.offlineDirectory = await getBestOfflineDir();

    if (this.offlineDirectory) {
      console.log(
        `[Audio] Successfully initialized offline directory: ${this.offlineDirectory}`
      );
    } else {
      console.warn(
        "[Audio] No writable offline directory available, full offline files will stay in temp cache"
      );
    }
  }

  /**
   * Get the current cache directory, initializing if necessary
   */
  public async getCacheDirectory(): Promise<string | null> {
    if (this.cacheDirectory === null) {
      const now = Date.now();
      if (
        !this.cacheDirectoryInitPromise &&
        now - this.lastCacheDirectoryInitTime < this.CACHE_DIR_INIT_COOLDOWN
      ) {
        return null;
      }
      if (!this.cacheDirectoryInitPromise) {
        this.lastCacheDirectoryInitTime = now;
        this.cacheDirectoryInitPromise =
          this.initializeCacheDirectory().finally(() => {
            this.cacheDirectoryInitPromise = null;
          });
      }
      await this.cacheDirectoryInitPromise;
    }
    return this.cacheDirectory;
  }

  public async getOfflineDirectory(): Promise<string | null> {
    if (this.offlineDirectory === null) {
      const now = Date.now();
      if (
        !this.offlineDirectoryInitPromise &&
        now - this.lastOfflineDirectoryInitTime < this.CACHE_DIR_INIT_COOLDOWN
      ) {
        return null;
      }
      if (!this.offlineDirectoryInitPromise) {
        this.lastOfflineDirectoryInitTime = now;
        this.offlineDirectoryInitPromise =
          this.initializeOfflineDirectory().finally(() => {
            this.offlineDirectoryInitPromise = null;
          });
      }
      await this.offlineDirectoryInitPromise;
    }
    return this.offlineDirectory;
  }

  /**
   * Ensure the Streamify directory exists and is accessible
   * This method is called on first app launch to create the directory
   */
  public async ensureStreamifyDirectory(): Promise<string | null> {
    try {
      // Force re-initialization to ensure we get the best directory
      this.cacheDirectory = null;
      const cacheDir = await this.getCacheDirectory();

      if (cacheDir) {
        console.log(`[Audio] Streamify directory ensured at: ${cacheDir}`);
        return cacheDir;
      } else {
        console.warn(
          "[Audio] Could not ensure Streamify directory - no writable directory found"
        );
        return null;
      }
    } catch (error) {
      console.error("[Audio] Error ensuring Streamify directory:", error);
      return null;
    }
  }

  private isOfflinePath(filePath: string): boolean {
    const normalizedPath = stripFileUri(filePath).replace(/\\/g, "/");
    return normalizedPath.toLowerCase().includes("/streamify/offline/");
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
    const urlEstimatedTotal = (() => {
      try {
        const url = options?.originalStreamUrl;
        if (!url) return undefined;
        const u = new URL(url);
        const clen = u.searchParams.get("clen");
        if (clen) {
          const n = parseInt(clen, 10);
          if (!Number.isNaN(n) && n > 0) return n;
        }
      } catch {}
      return undefined;
    })();

    // Atomic update - lock the progress to prevent race conditions
    if (existingProgress) {
      if (
        !options?.isFullyCached &&
        newPercentage < existingProgress.percentage
      ) {
        newPercentage = existingProgress.percentage;
      }

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
        options?.estimatedTotalSize !== undefined
          ? Math.max(
              options.estimatedTotalSize,
              existingProgress?.estimatedTotalSize ?? options.estimatedTotalSize
            )
          : urlEstimatedTotal !== undefined
            ? Math.max(
                urlEstimatedTotal,
                existingProgress?.estimatedTotalSize ?? urlEstimatedTotal
              )
            : existingProgress?.estimatedTotalSize,
      isFullyCached:
        options?.isFullyCached ?? existingProgress?.isFullyCached ?? false,
      originalStreamUrl:
        options?.originalStreamUrl ?? existingProgress?.originalStreamUrl,
    };

    this.cacheProgress.set(trackId, updatedProgress);

    console.log(
      `[CacheProgress] Updated progress for ${trackId}: ${newPercentage}%${fileSize ? ` (${Math.round(fileSize * 100) / 100}MB)` : ""}${options?.downloadedSize ? ` downloaded: ${Math.round(options.downloadedSize * 100) / 100}MB` : ""}`
    );

    // Clear cache info cache since progress changed
    this.clearCacheInfoCache(trackId);
    this.emitCacheProgressUpdate(trackId);

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
    this.clearCacheInfoCache(trackId);
    this.emitCacheProgressUpdate(trackId);
    void updateAudioCacheIndexEntry(trackId, {
      isDownloading: true,
      isFullyCached: false,
      estimatedSizeBytes:
        existingProgress?.estimatedTotalSize &&
        existingProgress.estimatedTotalSize > 0
          ? existingProgress.estimatedTotalSize
          : undefined,
      downloadedBytes:
        existingProgress?.downloadedSize && existingProgress.downloadedSize > 0
          ? Math.round(existingProgress.downloadedSize * 1024 * 1024)
          : undefined,
    });
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

    // Clear cache info cache since the file status changed
    this.clearCacheInfoCache(trackId);
    this.emitCacheProgressUpdate(trackId);
    void updateAudioCacheIndexEntry(trackId, {
      sizeBytes: Math.round(fileSize * 1024 * 1024),
      estimatedSizeBytes: Math.round(fileSize * 1024 * 1024),
      downloadedBytes: Math.round(fileSize * 1024 * 1024),
      isDownloading: false,
      isFullyCached: true,
    });
    console.log(
      `[CacheProgress] Download completed for ${trackId}: ${Math.round(fileSize * 100) / 100}MB (took ${existingProgress ? Math.round((now - existingProgress.downloadStartTime) / 1000) : 0}s)`
    );

    // Promote finished files into persistent offline storage after the current
    // synchronous cache bookkeeping completes.
    setTimeout(() => {
      void this.promoteCompletedTrackToOfflineStorage(trackId);
    }, 0);
  }

  private registerValidatedFullTrackPath(
    trackId: string,
    filePath: string
  ): void {
    if (!trackId || !filePath) {
      return;
    }

    this.trackCache.set(trackId, filePath);
    this.trackCache.set(trackId + "_full", filePath);
    this.trackCache.set(trackId + "_has_full", "true");
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
          this.cacheProgress.delete(trackId);
          this.clearCacheInfoCache(trackId);
          this.emitCacheProgressUpdate(trackId);
          console.log(
            `[CacheProgress] Cleaned up stale progress for ${trackId}`
          );
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Initialize YouTube instances for switching
   */
  private initializeYoutubeInstances(): void {
    this.youtubeInstances = [
      ...this.prioritizePreferredInstance(
        DYNAMIC_INVIDIOUS_INSTANCES,
        this.preferredInvidiousInstance
      ),
      ...this.prioritizePreferredInstance(
        API.piped,
        this.preferredPipedInstance
      ),
    ];
    console.log(
      `[YouTube] Initialized ${this.youtubeInstances.length} instances for switching`
    );
  }

  private prioritizePreferredInstance(
    instances: string[],
    preferredInstance: string
  ): string[] {
    const normalizedInstances = [...new Set(instances.filter(Boolean))];
    if (!preferredInstance) {
      return normalizedInstances;
    }

    const preferredIndex = normalizedInstances.findIndex(
      (instance) => instance === preferredInstance
    );
    if (preferredIndex <= 0) {
      return normalizedInstances;
    }

    return [
      normalizedInstances[preferredIndex],
      ...normalizedInstances.slice(0, preferredIndex),
      ...normalizedInstances.slice(preferredIndex + 1),
    ];
  }

  private rememberWorkingYoutubeInstance(
    type: "invidious" | "piped",
    instance: string
  ): void {
    if (!instance) {
      return;
    }

    if (type === "invidious") {
      this.preferredInvidiousInstance = instance;
    } else {
      this.preferredPipedInstance = instance;
    }

    const youtubeInstanceIndex = this.youtubeInstances.findIndex(
      (entry) => entry === instance
    );
    if (youtubeInstanceIndex >= 0) {
      this.currentYoutubeInstanceIndex = youtubeInstanceIndex;
    }
  }

  /**
   * Check if a YouTube instance is healthy
   */
  private async checkInstanceHealth(instance: string): Promise<boolean> {
    const now = Date.now();
    const cachedHealth = this.youtubeInstanceHealth.get(instance);

    // Use cached health if still valid
    if (
      cachedHealth &&
      now - cachedHealth.lastCheck < this.INSTANCE_HEALTH_TTL
    ) {
      return cachedHealth.isHealthy;
    }

    try {
      // Quick health check - try to fetch the instance's API
      const healthCheckUrl = `${instance}/api/v1/stats`;
      const response = await fetch(healthCheckUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });

      const isHealthy = response.ok;
      this.youtubeInstanceHealth.set(instance, { lastCheck: now, isHealthy });

      console.log(
        `[YouTube] Health check for ${instance}: ${isHealthy ? "healthy" : "unhealthy"}`
      );
      return isHealthy;
    } catch (error) {
      console.warn(`[YouTube] Health check failed for ${instance}:`, error);
      this.youtubeInstanceHealth.set(instance, {
        lastCheck: now,
        isHealthy: false,
      });
      return false;
    }
  }

  /**
   * Get next healthy YouTube instance
   */
  private async getNextHealthyInstance(): Promise<string | null> {
    if (this.youtubeInstances.length === 0) {
      this.initializeYoutubeInstances();
    }

    const startIndex = this.currentYoutubeInstanceIndex;

    for (let i = 0; i < this.youtubeInstances.length; i++) {
      const instanceIndex = (startIndex + i) % this.youtubeInstances.length;
      const instance = this.youtubeInstances[instanceIndex];

      if (await this.checkInstanceHealth(instance)) {
        this.currentYoutubeInstanceIndex = instanceIndex;
        console.log(`[YouTube] Selected healthy instance: ${instance}`);
        return instance;
      }
    }

    console.error("[YouTube] No healthy instances available");
    return null;
  }

  /**
   * Switch to next YouTube instance and retry download
   */
  private async switchInstanceAndRetry(
    videoId: string,
    trackId: string,
    retryCount: number
  ): Promise<string | null> {
    if (retryCount >= this.MAX_YOUTUBE_RETRY_ATTEMPTS) {
      console.error(
        `[YouTube] Max retry attempts (${this.MAX_YOUTUBE_RETRY_ATTEMPTS}) reached for ${videoId}`
      );
      return null;
    }

    const nextInstance = await this.getNextHealthyInstance();
    if (!nextInstance) {
      console.error("[YouTube] No healthy instances available for retry");
      return null;
    }

    console.log(
      `[YouTube] Switching to instance ${nextInstance} (attempt ${retryCount + 1})`
    );

    try {
      // Try to get stream URL from the new instance
      const streamUrl = await this.getYouTubeStreamFromInstance(
        videoId,
        nextInstance
      );
      if (streamUrl) {
        console.log(
          `[YouTube] Successfully got stream URL from ${nextInstance}`
        );
        return streamUrl;
      }
    } catch (error) {
      console.warn(
        `[YouTube] Failed to get stream from ${nextInstance}:`,
        error
      );
    }

    // If this instance failed too, try the next one
    this.currentYoutubeInstanceIndex =
      (this.currentYoutubeInstanceIndex + 1) % this.youtubeInstances.length;
    return await this.switchInstanceAndRetry(videoId, trackId, retryCount + 1);
  }

  /**
   * Get YouTube stream from specific instance
   */
  private async getYouTubeStreamFromInstance(
    videoId: string,
    instance: string
  ): Promise<string | null> {
    try {
      const apiUrl = `${instance}/api/v1/videos/${videoId}`;
      console.log(`[YouTube] Fetching video info from ${apiUrl}`);

      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Prefer Opus WEBM (itag 249/250/251) with explicit lowest size if requested
      const pickAudioUrl = (streams: any[]) => {
        const valid = streams.filter((s) => s?.url);
        const withItag = valid.map((s) => ({
          ...s,
          itag: s.itag ?? s.tag ?? undefined,
          mime: s.mimeType ?? s.type ?? "",
          clen:
            typeof s.clen === "number"
              ? s.clen
              : s.clen
                ? parseInt(String(s.clen), 10)
                : undefined,
        }));
        // Filter audio-only
        const audioOnly = withItag.filter((s) =>
          String(s.mime).toLowerCase().includes("audio/")
        );
        // Prefer opus (webm)
        const opus = audioOnly.filter((s) =>
          String(s.mime).toLowerCase().includes("webm")
        );
        // Itag preference: 249 -> 250 -> 251 -> others
        const order = (s: any) => {
          const i = String(s.itag || "");
          if (i === "249") return 0;
          if (i === "250") return 1;
          if (i === "251") return 2;
          return 3;
        };
        const sorted = (opus.length ? opus : audioOnly).sort((a, b) => {
          const oa = order(a);
          const ob = order(b);
          if (oa !== ob) return oa - ob;
          // Secondary: lowest clen if available, else lowest bitrate
          const ca = a.clen ?? Number.MAX_SAFE_INTEGER;
          const cb = b.clen ?? Number.MAX_SAFE_INTEGER;
          if (ca !== cb) return ca - cb;
          const ba = a.bitrate || 0;
          const bb = b.bitrate || 0;
          return ba - bb;
        });
        return sorted[0]?.url || null;
      };

      // Adaptive formats first
      const adaptiveFormats = Array.isArray(data.adaptiveFormats)
        ? data.adaptiveFormats
        : [];
      const chosenAdaptive = pickAudioUrl(adaptiveFormats);
      if (chosenAdaptive) {
        return chosenAdaptive;
      }

      // Fallback to regular formats
      const formats = Array.isArray(data.formatStreams)
        ? data.formatStreams
        : [];
      const chosenFormat = pickAudioUrl(formats);
      if (chosenFormat) {
        return chosenFormat;
      }

      // Last resort: try any format that might contain audio
      if (formats.length > 0) {
        return formats[0].url || null;
      }

      return null;
    } catch (error) {
      console.error(`[YouTube] Failed to get stream from ${instance}:`, error);
      return null;
    }
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
          const url = new URL(videoUrl);
          url.searchParams.set("itag", itag);
          const audioOnlyUrl = url.toString();

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
    // Proxy bases are loaded lazily from runtime config when needed.
    this.proxyRotation = [];
  }

  private getCorsProxyUrl(url: string): string {
    return url;
  }

  /**
   * Check if a track has a full cached file available
   */
  public hasFullCachedFile(trackId: string): boolean {
    // Check old format
    if (this.soundCloudCache.has(trackId + "_has_full")) {
      return true;
    }

    if (this.trackCache.has(trackId + "_has_full")) {
      return true;
    }

    // Check new format - look for .full in the cached path
    const cachedPath = this.soundCloudCache.get(trackId);
    if (cachedPath && cachedPath.includes(".full")) {
      return true;
    }

    const trackCachedPath = this.trackCache.get(trackId);
    if (trackCachedPath && trackCachedPath.includes(".full")) {
      return true;
    }

    if (trackCachedPath && this.isOfflinePath(trackCachedPath)) {
      return true;
    }

    return false;
  }

  /**
   * Get the best available cached file path for a track
   */
  public async getBestCachedFilePath(trackId: string): Promise<string | null> {
    console.log(`[Audio] Checking cache for track: ${trackId}`);

    const offlineFullPath = this.trackCache.get(trackId + "_offline");
    if (offlineFullPath) {
      const cachedFileInfo = await FileSystem.getInfoAsync(offlineFullPath);
      if (cachedFileInfo.exists) {
        return normalizeFileUri(offlineFullPath);
      }
      this.trackCache.delete(trackId + "_offline");
    }

    const fullTrackCachePath = this.trackCache.get(trackId + "_full");
    if (fullTrackCachePath) {
      const cachedFileInfo = await FileSystem.getInfoAsync(fullTrackCachePath);
      if (cachedFileInfo.exists) {
        return fullTrackCachePath.startsWith("file://")
          ? fullTrackCachePath
          : `file://${fullTrackCachePath}`;
      }
      this.trackCache.delete(trackId + "_full");
    }

    const offlineDir = await this.getOfflineDirectory();
    if (offlineDir) {
      const offlineExtensions = [
        ".mp3",
        ".webm",
        ".m4a",
        ".ogg",
        ".oga",
        ".aac",
        ".cache",
      ];
      for (const ext of offlineExtensions) {
        const filePath = `${offlineDir}${trackId}${ext}`;
        const isValid = await this.validateCachedFile(filePath);
        if (isValid) {
          this.trackCache.set(trackId, filePath);
          this.trackCache.set(trackId + "_full", filePath);
          this.trackCache.set(trackId + "_offline", filePath);
          this.trackCache.set(trackId + "_has_full", "true");
          return normalizeFileUri(filePath);
        }
      }
    }

    const fullSoundCloudPath = this.soundCloudCache.get(trackId + "_full");
    if (fullSoundCloudPath) {
      const cachedFileInfo = await FileSystem.getInfoAsync(fullSoundCloudPath);
      if (cachedFileInfo.exists) {
        return fullSoundCloudPath.startsWith("file://")
          ? fullSoundCloudPath
          : `file://${fullSoundCloudPath}`;
      }
      this.soundCloudCache.delete(trackId + "_full");
    }

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
          `[Audio] Generic cached file doesn't exist, removing from cache: ${genericCachedPath}`
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
          `[Audio] Cached file doesn't exist, removing from cache: ${cachedPath}`
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
          `[Audio] Full cached file doesn't exist, removing from cache: ${fullCachedPath}`
        );
        this.trackCache.delete(trackId + "_full");
        this.trackCache.delete(trackId);
      }
    }

    // If not in memory, scan filesystem for existing cache files
    console.log(
      `[Audio] Scanning filesystem for cache files for track: ${trackId}`
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
              `[Audio] Found existing SoundCloud cache file: ${filePath}`
            );
            const isFull = ext.includes(".full");
            if (isFull) {
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
              `[Audio] Found corrupted SoundCloud cache file, cleaning up: ${filePath}`
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
        "[Audio] No cache directory available, skipping filesystem scan"
      );
      return null;
    }

    try {
      // Check for any YouTube cache files with different extensions
      const youtubeExtensions = [
        ".cache.full",
        ".cache",
        ".mp3.full",
        ".mp3",
        ".webm.full",
        ".webm",
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

            if (ext.includes(".full")) {
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

  public async getFullCachedFilePath(trackId: string): Promise<string | null> {
    console.log(`[Audio] Checking full cache for track: ${trackId}`);

    const offlineDir = await this.getOfflineDirectory();
    if (offlineDir) {
      const offlineExtensions = [
        ".mp3",
        ".webm",
        ".m4a",
        ".ogg",
        ".oga",
        ".aac",
        ".cache",
      ];
      for (const ext of offlineExtensions) {
        const filePath = `${offlineDir}${trackId}${ext}`;
        const isValid = await this.validateCachedFile(filePath);
        if (isValid) {
          this.trackCache.set(trackId, filePath);
          this.trackCache.set(trackId + "_full", filePath);
          this.trackCache.set(trackId + "_offline", filePath);
          this.trackCache.set(trackId + "_has_full", "true");
          return normalizeFileUri(filePath);
        }
      }
    }

    const hasFullMarker =
      this.trackCache.has(trackId + "_has_full") ||
      this.soundCloudCache.has(trackId + "_has_full");

    const cachedFullPath =
      this.trackCache.get(trackId + "_full") ||
      this.soundCloudCache.get(trackId + "_full");
    if (cachedFullPath) {
      const isValid = await this.validateCachedFile(cachedFullPath);
      if (isValid) {
        return cachedFullPath.startsWith("file://")
          ? cachedFullPath
          : `file://${cachedFullPath}`;
      }
      await FileSystem.deleteAsync(cachedFullPath, { idempotent: true });
      this.trackCache.delete(trackId + "_full");
      this.soundCloudCache.delete(trackId + "_full");
    }

    const directPath =
      this.trackCache.get(trackId) || this.soundCloudCache.get(trackId);
    if (directPath && (directPath.includes(".full") || hasFullMarker)) {
      const isValid = await this.validateCachedFile(directPath);
      if (isValid) {
        return directPath.startsWith("file://")
          ? directPath
          : `file://${directPath}`;
      }
      await FileSystem.deleteAsync(directPath, { idempotent: true });
      this.trackCache.delete(trackId);
      this.soundCloudCache.delete(trackId);
    }

    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      return null;
    }

    const fullExtensions = [
      ".cache.full",
      ".mp3.full",
      ".webm.full",
      ".m4a.full",
      ".ogg.full",
      ".oga.full",
    ];

    const soundCloudCacheDir = `${cacheDir}soundcloud-cache/`;
    for (const ext of fullExtensions) {
      const filePath = `${soundCloudCacheDir}${trackId}${ext}`;
      const isValid = await this.validateCachedFile(filePath);
      if (isValid) {
        return filePath.startsWith("file://") ? filePath : `file://${filePath}`;
      }
      await FileSystem.deleteAsync(filePath, { idempotent: true });
      this.trackCache.delete(trackId + "_full");
      this.soundCloudCache.delete(trackId + "_full");
    }

    for (const ext of fullExtensions) {
      const filePath = `${cacheDir}${trackId}${ext}`;
      const isValid = await this.validateCachedFile(filePath);
      if (isValid) {
        return filePath.startsWith("file://") ? filePath : `file://${filePath}`;
      }
      await FileSystem.deleteAsync(filePath, { idempotent: true });
      this.trackCache.delete(trackId + "_full");
      this.soundCloudCache.delete(trackId + "_full");
    }

    return null;
  }

  /**
   * Try different SoundCloud client IDs when the current one fails
   */
  private async tryAlternativeClientIds(
    baseUrl: string,
    trackData: any,
    controller: AbortController
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
        `[Audio] Validating audio stream: ${url.substring(0, 100)}...`
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
        response.headers.get("content-length") || "0"
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
        "application/vnd.apple.mpegurl",
        "application/x-mpegurl",
        "audio/mpegurl",
        "application/octet-stream", // Sometimes used for audio files
      ];

      const isSupportedType = supportedTypes.some(
        (type) =>
          contentType.toLowerCase().includes(type) ||
          url.toLowerCase().includes(type.replace("audio/", ""))
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
        `[Audio] Stream validation successful: ${contentType}, ${contentLength} bytes`
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

      if (!fileInfo.exists) {
        return false;
      }

      if (!fileInfo.size || fileInfo.size === 0) {
        console.warn("[Audio] File validation failed: file is empty");
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
            "[Audio] File validation failed: cannot read file content"
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

  private async promoteCompletedTrackToOfflineStorage(
    trackId: string
  ): Promise<void> {
    try {
      const fullCachedPath = await this.getFullCachedFilePath(trackId);
      if (!fullCachedPath) {
        return;
      }

      if (this.isOfflinePath(fullCachedPath)) {
        this.trackCache.set(trackId, fullCachedPath);
        this.trackCache.set(trackId + "_full", fullCachedPath);
        this.trackCache.set(trackId + "_offline", fullCachedPath);
        this.trackCache.set(trackId + "_has_full", "true");
        return;
      }

      const offlineDir = await this.getOfflineDirectory();
      if (!offlineDir) {
        return;
      }

      const sourceInfo = await FileSystem.getInfoAsync(fullCachedPath);
      if (!sourceInfo.exists || !sourceInfo.size || sourceInfo.size < 10240) {
        return;
      }

      const progress = this.cacheProgress.get(trackId);
      const extension = inferAudioFileExtension(
        progress?.originalStreamUrl,
        fullCachedPath
      );
      const destinationPath = normalizeFileUri(
        `${offlineDir}${trackId}${extension}`
      );
      const normalizedSourcePath = normalizeFileUri(fullCachedPath);

      if (normalizedSourcePath !== destinationPath) {
        const existingDestination =
          await FileSystem.getInfoAsync(destinationPath);
        if (existingDestination.exists) {
          await FileSystem.deleteAsync(destinationPath, { idempotent: true });
        }

        try {
          await FileSystem.moveAsync({
            from: normalizedSourcePath,
            to: destinationPath,
          });
        } catch (moveError) {
          await FileSystem.copyAsync({
            from: normalizedSourcePath,
            to: destinationPath,
          });
          await FileSystem.deleteAsync(normalizedSourcePath, {
            idempotent: true,
          });
        }
      }

      this.trackCache.set(trackId, destinationPath);
      this.trackCache.set(trackId + "_full", destinationPath);
      this.trackCache.set(trackId + "_offline", destinationPath);
      this.trackCache.set(trackId + "_has_full", "true");
      this.soundCloudCache.set(trackId, destinationPath);
      this.soundCloudCache.set(trackId + "_full", destinationPath);
      this.soundCloudCache.set(trackId + "_has_full", "true");
      this.clearCacheInfoCache(trackId);
    } catch (error) {
      console.warn(
        `[Audio] Failed to promote completed track ${trackId} to offline storage:`,
        error
      );
    }
  }

  /**
   * Public cleanup for all cached files and state for a track
   */
  public async cleanupTrackCache(trackId: string): Promise<void> {
    try {
      const cacheDir = await this.getCacheDirectory();
      const candidates = cacheDir
        ? [
            `${cacheDir}${trackId}.cache`,
            `${cacheDir}${trackId}.cache.full`,
            `${cacheDir}${trackId}.cache.resume`,
            `${cacheDir}${trackId}.cache.combined`,
            `${cacheDir}${trackId}.mp3`,
            `${cacheDir}${trackId}.mp3.full`,
            `${cacheDir}${trackId}.webm`,
            `${cacheDir}${trackId}.webm.full`,
            `${cacheDir}${trackId}.m4a`,
            `${cacheDir}${trackId}.m4a.full`,
            `${cacheDir}${trackId}.ogg`,
            `${cacheDir}${trackId}.ogg.full`,
          ]
        : [];

      const soundcloudDir = cacheDir ? `${cacheDir}soundcloud-cache/` : null;
      const scCandidates = soundcloudDir
        ? [
            `${soundcloudDir}${trackId}.mp3`,
            `${soundcloudDir}${trackId}.mp3.full`,
            `${soundcloudDir}${trackId}.webm`,
            `${soundcloudDir}${trackId}.webm.full`,
            `${soundcloudDir}${trackId}.m4a`,
            `${soundcloudDir}${trackId}.m4a.full`,
            `${soundcloudDir}${trackId}.oga`,
            `${soundcloudDir}${trackId}.oga.full`,
          ]
        : [];

      const offlineDir = await this.getOfflineDirectory();
      const offlineCandidates = offlineDir
        ? [
            `${offlineDir}${trackId}.mp3`,
            `${offlineDir}${trackId}.webm`,
            `${offlineDir}${trackId}.m4a`,
            `${offlineDir}${trackId}.ogg`,
            `${offlineDir}${trackId}.oga`,
            `${offlineDir}${trackId}.aac`,
            `${offlineDir}${trackId}.cache`,
          ]
        : [];

      for (const filePath of [
        ...candidates,
        ...scCandidates,
        ...offlineCandidates,
      ]) {
        try {
          const info = await FileSystem.getInfoAsync(filePath);
          if (info.exists) {
            await FileSystem.deleteAsync(filePath, { idempotent: true });
          }
        } catch {}
      }

      // Clear caches and progress
      this.trackCache.delete(trackId);
      this.trackCache.delete(trackId + "_full");
      this.trackCache.delete(trackId + "_has_full");
      this.trackCache.delete(trackId + "_offline");
      this.trackCache.delete(trackId + "_substantial");
      this.soundCloudCache.delete(trackId);
      this.soundCloudCache.delete(trackId + "_full");
      this.soundCloudCache.delete(trackId + "_has_full");
      this.cacheProgress.delete(trackId);
      this.clearCacheInfoCache(trackId);
      this.emitCacheProgressUpdate(trackId);
    } catch {}
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
      // #region debug-point B:get-cache-info-entry
      fetch("http://192.168.1.106:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "cache-progress-stuck",
          runId: "pre-fix",
          hypothesisId: "B",
          location: "audioStreaming:getCacheInfo:entry",
          msg: "[DEBUG] getCacheInfo called",
          data: { trackId, hasActiveProgress: this.cacheProgress.has(trackId) },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      // Check cache first (with 5 second TTL)
      const cached = this.cacheInfoCache.get(trackId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_INFO_TTL) {
        console.log(
          `[Audio] Using cached cache info for ${trackId} (age: ${Date.now() - cached.timestamp}ms)`
        );
        return cached.result;
      }

      console.log(`[Audio] === getCacheInfo START for ${trackId} ===`);

      const cacheIndex = await loadAudioCacheIndex();
      const persistedEntry = cacheIndex.entries[trackId];

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
          const fullCachedPath = await this.getFullCachedFilePath(trackId);
          if (fullCachedPath) {
            console.log(
              `[Audio] Track ${trackId} is fully cached (100% confirmed)`
            );
            const result = {
              percentage: 100,
              fileSize:
                activeProgress.downloadedSize ||
                activeProgress.lastFileSize ||
                0,
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

          this.cacheProgress.set(trackId, {
            ...activeProgress,
            isFullyCached: false,
            percentage: Math.min(activeProgress.percentage, 99),
            lastUpdate: Date.now(),
          });
          this.clearCacheInfoCache(trackId);
          console.log(
            `[Audio] Cleared stale fully-cached flag for ${trackId} because no validated full file exists`
          );
        }

        // If actively downloading, prefer the live file size on disk so callers
        // don't get stuck on the initial seeded percentage.
        if (activeProgress.isDownloading) {
          let liveFileSizeMb =
            activeProgress.downloadedSize || activeProgress.lastFileSize || 0;
          let livePercentage = Math.max(activeProgress.percentage, 1);
          const persistedEstimatedTotalBytes =
            persistedEntry?.estimatedSizeBytes ||
            persistedEntry?.sizeBytes ||
            0;
          let liveTotalFileSizeMb: number | undefined =
            Math.max(
              typeof activeProgress.estimatedTotalSize === "number"
                ? activeProgress.estimatedTotalSize
                : 0,
              persistedEstimatedTotalBytes
            ) > 0
              ? Math.round(
                  (Math.max(
                    typeof activeProgress.estimatedTotalSize === "number"
                      ? activeProgress.estimatedTotalSize
                      : 0,
                    persistedEstimatedTotalBytes
                  ) /
                    (1024 * 1024)) *
                    100
                ) / 100
              : undefined;

          const cachedFilePath = await this.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const normalizedCachedPath = cachedFilePath.replace("file://", "");
            let liveFileInfo =
              await FileSystem.getInfoAsync(normalizedCachedPath);

            if (!liveFileInfo.exists) {
              liveFileInfo = await FileSystem.getInfoAsync(cachedFilePath);
            }

            if (
              liveFileInfo.exists &&
              typeof liveFileInfo.size === "number" &&
              liveFileInfo.size > 0
            ) {
              liveFileSizeMb =
                Math.round((liveFileInfo.size / (1024 * 1024)) * 100) / 100;

              const estimatedTotalBytes = Math.max(
                typeof activeProgress.estimatedTotalSize === "number"
                  ? activeProgress.estimatedTotalSize
                  : 0,
                persistedEstimatedTotalBytes,
                this.estimateTotalFileSize(liveFileInfo.size),
                liveFileInfo.size
              );

              liveTotalFileSizeMb =
                Math.round((estimatedTotalBytes / (1024 * 1024)) * 100) / 100;
              livePercentage = Math.max(
                livePercentage,
                Math.min(
                  99,
                  Math.round((liveFileInfo.size / estimatedTotalBytes) * 100)
                )
              );

              if (
                livePercentage > activeProgress.percentage ||
                liveFileSizeMb >
                  (activeProgress.downloadedSize ||
                    activeProgress.lastFileSize ||
                    0)
              ) {
                this.updateCacheProgress(
                  trackId,
                  livePercentage,
                  liveFileSizeMb,
                  {
                    isDownloading: true,
                    estimatedTotalSize: estimatedTotalBytes,
                    downloadedSize: liveFileSizeMb,
                  }
                );
              }

              void updateAudioCacheIndexEntry(trackId, {
                isDownloading: true,
                isFullyCached: false,
                estimatedSizeBytes: estimatedTotalBytes,
                downloadedBytes: liveFileInfo.size,
              });
            }
          }

          const result = {
            percentage: livePercentage,
            fileSize: liveFileSizeMb,
            totalFileSize: liveTotalFileSizeMb,
            isFullyCached: false,
            isDownloading: true,
            downloadSpeed: activeProgress.downloadSpeed || 0,
            retryCount: activeProgress.retryCount || 0,
          };
          // #region debug-point B:get-cache-info-downloading
          fetch("http://192.168.1.106:7777/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: "cache-progress-stuck",
              runId: "pre-fix",
              hypothesisId: "B",
              location: "audioStreaming:getCacheInfo:downloading",
              msg: "[DEBUG] getCacheInfo returning active download state",
              data: {
                trackId,
                activePercentage: activeProgress.percentage,
                safePercentage: livePercentage,
                downloadedSize: liveFileSizeMb,
                lastFileSize: activeProgress.lastFileSize,
                estimatedTotalSize: liveTotalFileSizeMb ?? null,
                downloadSpeed: activeProgress.downloadSpeed ?? null,
                retryCount: activeProgress.retryCount || 0,
              },
              ts: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          console.log(
            `[Audio] === getCacheInfo END (downloading) for ${trackId} ===`,
            result
          );
          return result;
        }

        // If we have substantial progress but not downloading, verify if a full file exists
        if (activeProgress.percentage > 0) {
          const fullCachedPath = await this.getFullCachedFilePath(trackId);
          if (fullCachedPath) {
            const info = await FileSystem.getInfoAsync(fullCachedPath);
            if (info.exists && typeof info.size === "number") {
              const fileSizeMb = info.size / (1024 * 1024);
              this.markDownloadCompleted(trackId, fileSizeMb);
              const result = {
                percentage: 100,
                fileSize: fileSizeMb,
                isFullyCached: true,
                isDownloading: false,
                downloadSpeed: 0,
                retryCount: 0,
              };
              console.log(
                `[Audio] === getCacheInfo END (promoted to full) for ${trackId} ===`,
                result
              );
              return result;
            }
          }

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
      // console.log(`[Audio] Best cached file path: ${cachedFilePath}`);

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
      // console.log(`[Audio] Getting file info for path: ${filePath}`);
      let fileInfo = await FileSystem.getInfoAsync(filePath);
      // console.log("[Audio] File info:", fileInfo);

      // If file doesn't exist, try with the full path including file://
      if (!fileInfo || !fileInfo.exists) {
        console.log(
          `[Audio] Cached file not found at: ${filePath}, trying with file:// prefix`
        );
        fileInfo = await FileSystem.getInfoAsync(cachedFilePath);
        // console.log("[Audio] File info (with file://):", fileInfo);
      }

      if (!fileInfo || !fileInfo.exists) {
        console.log(
          `[Audio] Cached file not found: ${filePath} or ${cachedFilePath}`
        );
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
        const storedEstimatedSize =
          activeProgress?.estimatedTotalSize ||
          persistedEntry?.estimatedSizeBytes ||
          persistedEntry?.sizeBytes;

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
        let stablePercentage = Math.min(99, Math.round(rawPercentage));

        // Cache progress should be monotonic while a track is still downloading.
        if (stablePercentage < existingPercentage) {
          console.log(
            `[Audio] Preventing percentage drop: ${existingPercentage}% -> ${stablePercentage}%`
          );
          stablePercentage = existingPercentage;
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
            stablePercentage = Math.min(99, Math.round(newRawPercentage));
          }
        }

        percentage = stablePercentage;

        displayFileSize = Math.round((fileSize / 1024 / 1024) * 100) / 100;
      }

      // Update the cache progress with calculated values for consistency
      if (activeProgress) {
        this.updateCacheProgress(trackId, percentage, displayFileSize, {
          estimatedTotalSize,
          isFullyCached: isFullyCached,
        });
      }

      void updateAudioCacheIndexEntry(trackId, {
        sizeBytes: isFullyCached ? fileSize : persistedEntry?.sizeBytes || 0,
        estimatedSizeBytes: estimatedTotalSize,
        downloadedBytes: fileSize,
        isDownloading: false,
        isFullyCached,
      });

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

      // Cache the result for 5 seconds to prevent excessive filesystem calls
      this.cacheInfoCache.set(trackId, {
        result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      console.error(
        `[Audio] Error getting cache info for track ${trackId}:`,
        error
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
          // Clear cache info cache since the file was deleted
          this.clearCacheInfoCache(trackId);
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
            error
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
            error
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
    controller: AbortController
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping YouTube caching for non-remote URL");
      return streamUrl;
    }
    // Check if we already have this track cached (use generic track cache)
    if (this.trackCache.has(trackId)) {
      const cachedPath = this.trackCache.get(trackId);
      console.log(
        `[Audio] Using existing cached file for YouTube track: ${trackId}`
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
        `[Audio] Using existing cached file for YouTube track: ${trackId}`
      );
      console.log(`[Audio] YouTube cached path: ${cachedPath}`);
      // Return the cached path with file:// prefix
      return cachedPath.startsWith("file://")
        ? cachedPath
        : `file://${cachedPath}`;
    }

    console.log(
      `[Audio] Starting progressive YouTube caching for track: ${trackId}`
    );

    // Start background caching immediately without waiting
    this.startProgressiveYouTubeCache(streamUrl, trackId, controller).catch(
      (error) => {
        console.error(
          `[Audio] Progressive YouTube cache failed for ${trackId}:`,
          error
        );
      }
    );

    // Return the stream URL immediately for instant playback
    console.log(
      `[Audio] Returning stream URL immediately for track: ${trackId} (caching in background)`
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
    controller: AbortController
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping SoundCloud caching for non-remote URL");
      return streamUrl;
    }
    if (streamUrl.includes(".m3u8") || streamUrl.includes("/stream/hls")) {
      return streamUrl;
    }
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId);
      if (cachedPath && cachedPath.includes(".full")) {
        return `file://${cachedPath}`;
      }
      return streamUrl;
    }

    // Always wait for cache completion before playing
    try {
      const cachedFilePath = await this.cacheSoundCloudStreamAsync(
        streamUrl,
        trackId,
        controller
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
    options?: { skipConcurrentCheck?: boolean }
  ): Promise<void> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping full track download for non-remote URL");
      return;
    }
    try {
      // Check if already downloading to prevent concurrent downloads
      const existingProgress = this.cacheProgress.get(trackId);
      if (existingProgress?.isDownloading && !options?.skipConcurrentCheck) {
        console.log(
          `[Audio] Download already in progress for track: ${trackId}`
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
        const fullFileInfo = await FileSystem.getInfoAsync(properFullFilePath);
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

          // Replace the partial cache with the full file for future plays (use generic track cache)
          this.trackCache.set(trackId + "_full", properFullFilePath);
          this.trackCache.set(trackId, properFullFilePath);
          this.trackCache.set(trackId + "_has_full", "true");

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
            await FileSystem.deleteAsync(properFullFilePath, {
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
          controller,
          { skipConcurrentCheck: true }
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
          `[Audio] Copied existing cache (${totalDownloaded} bytes) to temp file`
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
            const existingInfo = await FileSystem.getInfoAsync(tempFilePath);
            const currentInfo = await FileSystem.getInfoAsync(
              tempFilePath + ".current"
            );
            const existingSize =
              existingInfo.exists && typeof existingInfo.size === "number"
                ? existingInfo.size
                : 0;
            const currentSize =
              currentInfo.exists && typeof currentInfo.size === "number"
                ? currentInfo.size
                : 0;
            const combinedSize = existingSize + currentSize;
            const maxCombineSize = 24 * 1024 * 1024;

            if (combinedSize > maxCombineSize) {
              console.warn(
                `[Audio] Combined cache size ${combinedSize} bytes too large for in-memory chunk merge, switching to full download for ${trackId}`
              );
              await FileSystem.deleteAsync(tempFilePath + ".current", {
                idempotent: true,
              });
              await this.downloadFullTrackInBackground(
                streamUrl,
                cacheFilePath,
                trackId,
                controller,
                { skipConcurrentCheck: true }
              );
              break;
            }

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

            // Decode both base64 strings to binary, concatenate, then re-encode
            const existingBinary = toByteArray(existingContent);
            const chunkBinary = toByteArray(chunkContent);
            const combinedBinary = new Uint8Array(
              existingBinary.length + chunkBinary.length
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
          this.trackCache.set(trackId + "_substantial", "true");
        }

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
   * Progressive YouTube caching - starts background download without blocking playback
   * This method downloads the first chunk quickly and continues downloading in background
   */
  public async startProgressiveYouTubeCache(
    streamUrl: string,
    trackId: string,
    controller: AbortController
  ): Promise<void> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping progressive YouTube cache for non-remote URL"
      );
      return;
    }
    console.log(
      `[Audio] Starting progressive cache for YouTube track: ${trackId}`
    );
    console.log(
      `[Audio] Stream URL: ${streamUrl ? "present" : "missing"}, Controller: ${controller ? "present" : "missing"}`
    );

    // Start with a small initial chunk for quick startup
    const initialChunkSize = 256 * 1024; // 256KB for very fast startup

    try {
      // First, try to download a small initial chunk quickly
      const cacheDir = await this.getCacheDirectory();
      console.log(`[Audio] Got cache directory: ${cacheDir}`);
      if (!cacheDir) {
        console.warn(
          "[Audio] No cache directory available for progressive caching"
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
          `[Audio] Downloading initial ${initialChunkSize} bytes for quick startup`
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
              ...getYouTubeHeaders(),
            },
            sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
          }
        );

        console.log(
          `[Audio] Initial download result status: ${initialResult.status}`
        );
        console.log(
          "[Audio] Initial download result headers:",
          initialResult.headers
        );

        if (initialResult.status === 200 || initialResult.status === 206) {
          initialChunkDownloaded = true;
          const fileInfo = await FileSystem.getInfoAsync(properCacheFilePath);
          if (fileInfo.exists) {
            console.log(
              `[Audio] Initial chunk downloaded: ${fileInfo.size} bytes (status: ${initialResult.status})`
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
              }
            );
          } else {
            console.warn("[Audio] File info not available for initial chunk");
          }

          console.log(
            "[Audio] Initial chunk cached, player can start immediately"
          );
        } else {
          console.log(
            `[Audio] Initial chunk download unexpected status: ${initialResult.status}`
          );
        }
      } catch (initialError) {
        console.log(
          "[Audio] Initial chunk download failed, will try full download:"
        );
        console.log(
          "[Audio] Error details:",
          initialError instanceof Error
            ? {
                message: initialError.message,
                stack: initialError.stack,
                name: initialError.name,
              }
            : initialError
        );
        console.log(
          `[Audio] Initial download status: ${initialResult?.status || "unknown"}`
        );
        console.log(
          "[Audio] Initial download headers:",
          initialResult?.headers || "no headers"
        );
      }

      // Continue with the full caching process in background
      this.cacheYouTubeStreamAsync(streamUrl, trackId, controller).catch(
        (error) => {
          console.error(
            `[Audio] Background caching failed for ${trackId}:`,
            error
          );
        }
      );
    } catch (error) {
      console.error(
        `[Audio] Progressive caching setup failed for ${trackId}:`,
        error
      );
      // Fallback to regular background caching
      this.cacheYouTubeStreamAsync(streamUrl, trackId, controller).catch(
        (bgError) => {
          console.error(
            `[Audio] Fallback background caching failed for ${trackId}:`,
            bgError
          );
        }
      );
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
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping background YouTube cache for non-remote URL"
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
      `[Audio] Background caching first 5MB of YouTube stream for track: ${trackId}`
    );

    // Get the best available cache directory
    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn(
        "[Audio] No cache directory available, skipping background caching"
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
          "[Audio] Continuing without caching due to directory issues"
        );
        return streamUrl;
      }

      const cacheFilePath = `${cacheDir}${trackId}.cache`;
      const properCacheFilePath = cacheFilePath.startsWith("file://")
        ? cacheFilePath
        : `file://${cacheFilePath}`;

      // Persist original URL for resume operations
      this.updateCacheProgress(trackId, 0, 0, { originalStreamUrl: streamUrl });

      // Check if we have a full file available first
      const fullFilePath = cacheFilePath + ".full";
      const properFullFilePath = fullFilePath.startsWith("file://")
        ? fullFilePath
        : `file://${fullFilePath}`;
      const fullFileInfo = await FileSystem.getInfoAsync(properFullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 1048576) {
        // Reduced from 5MB to 1MB
        console.log(
          `[Audio] Using existing full cached file for YouTube track: ${trackId}`
        );
        this.trackCache.set(trackId, properFullFilePath);
        // Update progress to reflect completed state
        this.updateCacheProgress(
          trackId,
          100,
          fullFileInfo.size / (1024 * 1024),
          {
            isFullyCached: true,
            originalStreamUrl: streamUrl,
          }
        );
        return properFullFilePath;
      }

      // Check if partial file exists
      const partialFileInfo =
        await FileSystem.getInfoAsync(properCacheFilePath);
      if (partialFileInfo.exists) {
        console.log(
          `[Audio] Using existing partial cached file for YouTube track: ${trackId}`
        );
        this.trackCache.set(trackId, properCacheFilePath);
        // Update progress to reflect partial state
        const estimatedTotal = this.estimateTotalFileSize(partialFileInfo.size);
        const percentage = Math.min(
          95,
          Math.round((partialFileInfo.size / estimatedTotal) * 100)
        );
        this.updateCacheProgress(
          trackId,
          percentage,
          partialFileInfo.size / (1024 * 1024),
          { originalStreamUrl: streamUrl, isDownloading: false }
        );
        return properCacheFilePath;
      }

      // Download the first 1MB (1 * 1024 * 1024 bytes) of the stream - REDUCED for faster startup
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
          properCacheFilePath,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              ...getYouTubeHeaders(),
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
            properCacheFilePath,
            {
              headers: {
                Range: "bytes=0-1048575", // Request first 1MB - REDUCED for faster startup
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                ...getYouTubeHeaders(),
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
        console.log("[Audio] Response headers:", downloadResult.headers);
        throw new Error(
          `Failed to download YouTube stream chunk: ${downloadResult.status} - ${downloadResult.headers?.["content-type"] || "unknown content type"}`
        );
      }

      // Check if file was actually created
      const downloadedFileInfo =
        await FileSystem.getInfoAsync(properCacheFilePath);
      console.log("[Audio] Downloaded file info:", downloadedFileInfo);

      console.log(
        `[Audio] Successfully cached YouTube stream ${downloadResult.headers?.["content-length"] || "unknown size"} bytes for track: ${trackId}`
      );

      // Store in cache (use generic track cache for YouTube tracks)
      this.trackCache.set(trackId, properCacheFilePath);
      console.log(`[Audio] Stored cache file path: ${properCacheFilePath}`);

      if (
        downloadedFileInfo?.exists &&
        typeof downloadedFileInfo.size === "number"
      ) {
        const estimatedTotal = this.estimateTotalFileSize(
          downloadedFileInfo.size
        );
        const percentage = Math.min(
          95,
          Math.round((downloadedFileInfo.size / estimatedTotal) * 100)
        );
        this.updateCacheProgress(
          trackId,
          percentage,
          downloadedFileInfo.size / (1024 * 1024),
          {
            isDownloading: false,
            originalStreamUrl: streamUrl,
          }
        );
      }

      // Verify the file was actually created and is accessible
      // const verifyFileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      // console.log(`[Audio] Verification - File info after caching:`, verifyFileInfo);

      // Continue downloading the rest of the file in the background
      this.downloadFullTrackInBackground(
        streamUrl,
        properCacheFilePath,
        trackId,
        controller
      );

      console.log(
        `[Audio] YouTube background caching completed for track: ${trackId}`
      );

      // Return the cached file path so the player uses the local file
      console.log(`[Audio] Returning cached file path: ${properCacheFilePath}`);
      return properCacheFilePath;
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

      // Don't return the original stream URL since it's likely a blocked GoogleVideo URL
      // Instead, throw an error so the caller can try alternative approaches
      throw new Error(
        `YouTube caching failed: ${error instanceof Error ? error.message : "Unknown error"}. The GoogleVideo CDN URL appears to be blocked.`
      );
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
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping post-playback YouTube cache for non-remote URL"
      );
      return;
    }
    // Skip if already cached
    if (this.soundCloudCache.has(trackId)) {
      console.log(`[Audio] YouTube track already cached: ${trackId}`);
      return;
    }

    console.log(
      `[Audio] Post-playback caching YouTube stream for track: ${trackId}`
    );

    // Get the best available cache directory
    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn(
        "[Audio] No cache directory available, skipping post-playback caching"
      );
      return;
    }

    try {
      const controller = new AbortController();

      // For post-playback, prefer MP3 format if available
      if (
        streamUrl.includes("googlevideo.com") ||
        streamUrl.includes("youtube.com")
      ) {
        const videoId = this.extractYouTubeVideoId(streamUrl);
        if (videoId) {
          console.log(
            "[Audio] Attempting MP3 download for post-playback caching"
          );
          try {
            await this.downloadCompleteSongAsMP3(
              streamUrl,
              trackId,
              controller
            );
            console.log(
              `[Audio] Post-playback MP3 caching completed for ${trackId}`
            );
            return;
          } catch (mp3Error) {
            console.warn(
              "[Audio] MP3 download failed, falling back to regular caching:",
              mp3Error
            );
          }
        }
      }

      // Fallback to regular caching
      await this.cacheYouTubeStreamAsync(streamUrl, trackId, controller);
      console.log(
        `[Audio] Post-playback regular caching completed for ${trackId}`
      );
    } catch (error) {
      console.error(
        `[Audio] Post-playback caching failed for ${trackId}:`,
        error
      );
    }
  }

  /**
   * Download complete song as MP3 file
   */
  public async downloadCompleteSongAsMP3(
    streamUrl: string,
    trackId: string,
    controller: AbortController,
    onProgress?: (percentage: number) => void
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log("[Audio] Skipping MP3 download for non-remote URL");
      return streamUrl;
    }

    console.log(`[Audio] Starting complete MP3 download for track: ${trackId}`);

    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn("[Audio] No cache directory available for MP3 download");
      return streamUrl;
    }

    // Use .mp3 extension for the cached file
    const mp3FilePath = `${cacheDir}${trackId}.mp3`;
    const properMp3Path = mp3FilePath.startsWith("file://")
      ? mp3FilePath
      : `file://${mp3FilePath}`;

    // Check if MP3 already exists and is complete
    try {
      const mp3Info = await FileSystem.getInfoAsync(properMp3Path);
      if (mp3Info.exists && mp3Info.size > 1024 * 1024) {
        // At least 1MB
        console.log(`[Audio] MP3 already exists for track: ${trackId}`);
        this.markDownloadCompleted(trackId, mp3Info.size / (1024 * 1024));
        return properMp3Path;
      }
    } catch (error) {
      console.log(
        `[Audio] No existing MP3 found for ${trackId}, starting fresh download`
      );
    }

    this.markDownloadStarted(trackId, streamUrl);

    try {
      // For YouTube streams, use instance switching if needed
      let currentStreamUrl = streamUrl;
      if (
        streamUrl.includes("googlevideo.com") ||
        streamUrl.includes("youtube.com")
      ) {
        const videoId = this.extractYouTubeVideoId(streamUrl);
        if (videoId) {
          console.log(
            "[Audio] Using YouTube instance switching for MP3 download"
          );
          const instanceUrl = await this.getYouTubeStreamFromInstance(
            videoId,
            (await this.getNextHealthyInstance()) ||
              DYNAMIC_INVIDIOUS_INSTANCES[0]
          );
          if (instanceUrl) {
            currentStreamUrl = instanceUrl;
          }
        }
      }

      // Download the complete file
      console.log(`[Audio] Downloading complete MP3 file to: ${properMp3Path}`);

      let downloadedBytes = 0;
      let totalBytes = 0;

      // First, try to get content length
      try {
        const headResponse = await fetch(currentStreamUrl, {
          method: "HEAD",
          signal: controller.signal,
        });
        const contentLength = headResponse.headers.get("content-length");
        if (contentLength) {
          totalBytes = parseInt(contentLength);
          console.log(`[Audio] Total file size: ${totalBytes} bytes`);
        }
      } catch (error) {
        console.warn(
          "[Audio] Could not get content length, downloading without progress"
        );
      }

      // Download with progress tracking
      const downloadResult = await FileSystem.downloadAsync(
        currentStreamUrl,
        properMp3Path,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        }
      );

      if (downloadResult.status === 200) {
        const fileInfo = await FileSystem.getInfoAsync(properMp3Path);
        if (fileInfo.exists) {
          const fileSizeMB = fileInfo.size / (1024 * 1024);
          console.log(`[Audio] MP3 download completed: ${fileSizeMB}MB`);

          this.markDownloadCompleted(trackId, fileSizeMB);
          this.trackCache.set(trackId, properMp3Path);
          this.trackCache.set(trackId + "_full", properMp3Path);
          this.trackCache.set(trackId + "_has_full", "true");

          if (onProgress) {
            onProgress(100);
          }

          return properMp3Path;
        }
      } else {
        throw new Error(
          `Download failed with status: ${downloadResult.status}`
        );
      }
    } catch (error) {
      console.error(`[Audio] MP3 download failed for ${trackId}:`, error);

      // Try instance switching for YouTube content
      if (
        streamUrl.includes("googlevideo.com") ||
        streamUrl.includes("youtube.com")
      ) {
        const videoId = this.extractYouTubeVideoId(streamUrl);
        if (videoId) {
          console.log("[Audio] Trying YouTube instance switching for retry");
          const retryUrl = await this.switchInstanceAndRetry(
            videoId,
            trackId,
            1
          );
          if (retryUrl) {
            return await this.downloadCompleteSongAsMP3(
              retryUrl,
              trackId,
              controller,
              onProgress
            );
          }
        }
      }

      throw error;
    }

    return streamUrl;
  }

  /**
   * Extract YouTube video ID from URL
   */
  private extractYouTubeVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /(?:googlevideo\.com\/videoplayback\?.*&id=)([^&\n?#]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Background caching of SoundCloud stream - doesn't block playback
   */
  private async cacheSoundCloudStreamAsync(
    streamUrl: string,
    trackId: string,
    controller: AbortController
  ): Promise<string> {
    if (!this.isRemoteUrl(streamUrl)) {
      console.log(
        "[Audio] Skipping background SoundCloud cache for non-remote URL"
      );
      return streamUrl;
    }
    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId)!;
      if (cachedPath.includes(".full")) {
        return `file://${cachedPath}`;
      }
      return streamUrl;
    }

    // Get the best available cache directory
    const cacheDir = await this.getCacheDirectory();
    if (!cacheDir) {
      console.warn(
        "[Audio] No cache directory available, returning original stream URL"
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
        this.downloadFullTrackInBackground(
          streamUrl,
          cacheFilePath,
          trackId,
          controller
        );
        return streamUrl;
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

      // Store in cache (use generic track cache for YouTube tracks)
      this.trackCache.set(trackId, cacheFilePath);

      // Continue downloading the rest of the file in the background for better playback
      this.downloadFullTrackInBackground(
        streamUrl,
        cacheFilePath,
        trackId,
        controller
      );

      return streamUrl;
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
    controller: AbortController
  ): Promise<string> {
    console.log(
      `[Audio] Caching YouTube stream from position ${startPosition}s for track: ${trackId}`
    );

    // Check if we already have this track cached
    if (this.soundCloudCache.has(trackId)) {
      const cachedPath = this.soundCloudCache.get(trackId);
      console.log(
        `[Audio] Using existing cached file for YouTube track: ${trackId}`
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
          "[Audio] No cache directory available for position-based caching"
        );
        return streamUrl;
      }

      const cacheFilePath = `${cacheDir}${trackId}.cache`;

      // Mark download as started
      this.markDownloadStarted(trackId, streamUrl);

      // Download chunk starting from the calculated position
      console.log(
        `[Audio] Downloading chunk from byte ${startByte} for track: ${trackId}`
      );

      const downloadResult = await FileSystem.downloadAsync(
        streamUrl,
        cacheFilePath,
        {
          headers: {
            Range: `bytes=${startByte}-${startByte + chunkSize - 1}`,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            ...getYouTubeHeaders(),
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        }
      );

      if (downloadResult.status === 206) {
        const fileInfo = await FileSystem.getInfoAsync(cacheFilePath);
        if (fileInfo.exists) {
          console.log(
            `[Audio] Position-based chunk downloaded: ${fileInfo.size} bytes`
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
            }
          );
        } else {
          console.warn(
            "[Audio] File info not available for position-based chunk"
          );
        }

        // Continue downloading the rest in background
        this.downloadFullTrackInBackground(
          streamUrl,
          cacheFilePath,
          trackId,
          controller
        );

        return `file://${cacheFilePath}`;
      } else {
        console.log(
          `[Audio] Position-based download failed with status: ${downloadResult.status}`
        );
        return streamUrl;
      }
    } catch (error) {
      console.error(
        `[Audio] Position-based caching failed for ${trackId}:`,
        error
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
    onProgress?: (percentage: number) => void
  ): Promise<void> {
    console.log(
      `[Audio] Starting continuous background caching for track: ${trackId}`
    );

    try {
      // #region debug-point D:continue-cache-entry
      fetch("http://192.168.1.106:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "yt-cache-stuck",
          runId: "pre-fix",
          hypothesisId: "D",
          location: "audioStreaming:continueCachingTrack:entry",
          msg: "[DEBUG] continueCachingTrack started",
          data: {
            trackId,
            streamUrlStartsWithFile: streamUrl.startsWith("file://"),
            streamUrlPrefix: streamUrl.slice(0, 80),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      // Get current cache status
      const cacheInfo = await this.getCacheInfo(trackId);

      if (cacheInfo.isFullyCached) {
        console.log(`[Audio] Track ${trackId} is already fully cached`);
        return;
      }

      this.markDownloadStarted(trackId, streamUrl);
      this.updateCacheProgress(
        trackId,
        cacheInfo.percentage,
        cacheInfo.fileSize,
        {
          isDownloading: true,
          estimatedTotalSize: cacheInfo.totalFileSize
            ? cacheInfo.totalFileSize * 1024 * 1024
            : undefined,
          originalStreamUrl: streamUrl,
        }
      );

      // Get the cache directory
      const cacheDir = await this.getCacheDirectory();
      if (!cacheDir) {
        console.warn(
          "[Audio] No cache directory available for continuous caching"
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
          `[Audio] Cache file doesn't exist, creating empty file at: ${properCacheFilePath}`
        );
        await FileSystem.writeAsStringAsync(properCacheFilePath, "", {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      // Continue downloading in chunks until fully cached
      let currentPosition = 0;
      const initialFileInfo =
        await FileSystem.getInfoAsync(properCacheFilePath);
      if (initialFileInfo.exists && typeof initialFileInfo.size === "number") {
        currentPosition = initialFileInfo.size;
      }
      const chunkSize = 512 * 1024; // 512KB chunks
      let consecutiveErrors = 0;
      const maxErrors = 3;

      while (!controller.signal.aborted && consecutiveErrors < maxErrors) {
        // Get updated cache info for each iteration
        const currentCacheInfo = await this.getCacheInfo(trackId);
        if (currentCacheInfo.isFullyCached) {
          console.log(
            `[Audio] Track ${trackId} is now fully cached, stopping download`
          );
          break;
        }
        try {
          console.log(
            `[Audio] Downloading chunk from position ${currentPosition} for ${trackId}`
          );

          // Download next chunk
          const chunkFilePath = `${properCacheFilePath}.chunk_${currentPosition}`;
          const chunkTimeout = new Promise<never>((_, reject) => {
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Chunk download timed out after ${CACHE_CHUNK_REQUEST_TIMEOUT_MS}ms`
                  )
                ),
              CACHE_CHUNK_REQUEST_TIMEOUT_MS
            );
          });
          const chunkResult = (await Promise.race([
            FileSystem.downloadAsync(streamUrl, chunkFilePath, {
              headers: {
                Range: `bytes=${currentPosition}-${currentPosition + chunkSize - 1}`,
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                ...getYouTubeHeaders(),
              },
              sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
            }),
            chunkTimeout,
          ])) as Awaited<ReturnType<typeof FileSystem.downloadAsync>>;

          // #region debug-point A:chunk-response
          fetch("http://192.168.1.106:7777/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: "yt-cache-stuck",
              runId: "pre-fix",
              hypothesisId: "A",
              location: "audioStreaming:continueCachingTrack:chunk-response",
              msg: "[DEBUG] chunk response received",
              data: {
                trackId,
                currentPosition,
                chunkSize,
                status: chunkResult.status,
              },
              ts: Date.now(),
            }),
          }).catch(() => {});
          // #endregion

          if (chunkResult.status === 206 || chunkResult.status === 200) {
            const chunkInfo = await FileSystem.getInfoAsync(chunkFilePath);
            const isLikelyFullResponse =
              chunkResult.status === 200 &&
              chunkInfo.exists &&
              typeof chunkInfo.size === "number" &&
              chunkInfo.size > chunkSize * 1.1;

            if (chunkResult.status === 200 && currentPosition > 0) {
              if (isLikelyFullResponse) {
                await FileSystem.copyAsync({
                  from: chunkFilePath,
                  to: properCacheFilePath,
                });
                await FileSystem.deleteAsync(chunkFilePath, {
                  idempotent: true,
                });

                this.registerValidatedFullTrackPath(
                  trackId,
                  properCacheFilePath
                );

                const fullInfo =
                  await FileSystem.getInfoAsync(properCacheFilePath);
                if (fullInfo.exists && typeof fullInfo.size === "number") {
                  this.markDownloadCompleted(
                    trackId,
                    fullInfo.size / (1024 * 1024)
                  );
                }
                onProgress?.(100);
                break;
              } else {
                console.warn(
                  `[Audio] Range not respected for ${trackId}, switching to full download fallback`
                );
                await FileSystem.deleteAsync(chunkFilePath, {
                  idempotent: true,
                });
                await this.downloadFullTrackInBackground(
                  streamUrl,
                  properCacheFilePath,
                  trackId,
                  controller,
                  { skipConcurrentCheck: true }
                );
                break;
              }
            }

            const existingInfo =
              await FileSystem.getInfoAsync(properCacheFilePath);
            const existingSize =
              existingInfo.exists && typeof existingInfo.size === "number"
                ? existingInfo.size
                : 0;
            const chunkSizeBytes =
              chunkInfo.exists && typeof chunkInfo.size === "number"
                ? chunkInfo.size
                : 0;
            const combinedSize = existingSize + chunkSizeBytes;
            const maxCombineSize = 24 * 1024 * 1024;

            if (combinedSize > maxCombineSize) {
              console.warn(
                `[Audio] Combined cache size ${combinedSize} bytes too large for in-memory append, switching to full download for ${trackId}`
              );
              await FileSystem.deleteAsync(chunkFilePath, {
                idempotent: true,
              });
              await this.downloadFullTrackInBackground(
                streamUrl,
                properCacheFilePath,
                trackId,
                controller,
                { skipConcurrentCheck: true }
              );
              break;
            }

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
                { encoding: FileSystem.EncodingType.Base64 }
              );
              const chunkContent = await FileSystem.readAsStringAsync(
                chunkFilePath,
                { encoding: FileSystem.EncodingType.Base64 }
              );

              // Decode both base64 strings to binary, concatenate, then re-encode
              const existingBinary = toByteArray(existingContent);
              const chunkBinary = toByteArray(chunkContent);
              const combinedBinary = new Uint8Array(
                existingBinary.length + chunkBinary.length
              );
              combinedBinary.set(existingBinary);
              combinedBinary.set(chunkBinary, existingBinary.length);
              const combinedBase64 = fromByteArray(combinedBinary);

              // Write combined content back
              await FileSystem.writeAsStringAsync(
                tempCombinedPath,
                combinedBase64,
                { encoding: FileSystem.EncodingType.Base64 }
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
                chunkCombineError
              );
              await FileSystem.deleteAsync(chunkFilePath, {
                idempotent: true,
              });
              await this.downloadFullTrackInBackground(
                streamUrl,
                properCacheFilePath,
                trackId,
                controller,
                { skipConcurrentCheck: true }
              );
              break;
            }

            // Clean up chunk file
            await FileSystem.deleteAsync(chunkFilePath, { idempotent: true });

            // Update track cache with the combined file
            this.trackCache.set(trackId, properCacheFilePath);

            // Clear cache info cache since we updated the file
            this.clearCacheInfoCache(trackId);

            const updatedFileInfo =
              await FileSystem.getInfoAsync(properCacheFilePath);
            if (
              updatedFileInfo.exists &&
              typeof updatedFileInfo.size === "number"
            ) {
              currentPosition = updatedFileInfo.size;
            } else {
              currentPosition += chunkSize;
            }
            consecutiveErrors = 0; // Reset error counter

            // Update cache info
            const updatedCacheInfo = await this.getCacheInfo(trackId);
            this.updateCacheProgress(
              trackId,
              updatedCacheInfo.percentage,
              updatedCacheInfo.fileSize,
              {
                isDownloading: true,
                estimatedTotalSize: updatedCacheInfo.totalFileSize
                  ? updatedCacheInfo.totalFileSize * 1024 * 1024
                  : undefined,
              }
            );
            void updateAudioCacheIndexEntry(trackId, {
              isDownloading: true,
              isFullyCached: false,
              estimatedSizeBytes: updatedCacheInfo.totalFileSize
                ? Math.round(updatedCacheInfo.totalFileSize * 1024 * 1024)
                : undefined,
              downloadedBytes: Math.round(
                updatedCacheInfo.fileSize * 1024 * 1024
              ),
            });

            console.log(
              `[Audio] Chunk downloaded. Cache progress: ${updatedCacheInfo.percentage}%`
            );
            // #region debug-point D:chunk-progress
            fetch("http://192.168.1.106:7777/event", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: "yt-cache-stuck",
                runId: "pre-fix",
                hypothesisId: "D",
                location: "audioStreaming:continueCachingTrack:chunk",
                msg: "[DEBUG] chunk progress updated",
                data: {
                  trackId,
                  currentPosition,
                  updatedPercentage: updatedCacheInfo.percentage,
                  fileSize: updatedCacheInfo.fileSize,
                  totalFileSize: updatedCacheInfo.totalFileSize ?? null,
                  isDownloading: updatedCacheInfo.isDownloading ?? null,
                  isFullyCached: updatedCacheInfo.isFullyCached,
                },
                ts: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            onProgress?.(updatedCacheInfo.percentage);

            // Only mark completion when we can prove a real full cached file exists.
            if (updatedCacheInfo.percentage >= 95) {
              const fullCachedPath = await this.getFullCachedFilePath(trackId);
              if (fullCachedPath) {
                console.log(
                  `[Audio] Track ${trackId} has a validated full cached file at ${updatedCacheInfo.percentage}%`
                );
                this.markDownloadCompleted(trackId, updatedCacheInfo.fileSize);
                break;
              }
            }

            // Update current position for next chunk
            currentPosition = updatedCacheInfo.fileSize * 1024 * 1024;

            // Small delay between chunks to be gentle on the server
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            console.log(
              `[Audio] Chunk download failed with status: ${chunkResult.status}`
            );
            // #region debug-point A:chunk-non-success
            fetch("http://192.168.1.106:7777/event", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: "yt-cache-stuck",
                runId: "pre-fix",
                hypothesisId: "A",
                location:
                  "audioStreaming:continueCachingTrack:chunk-non-success",
                msg: "[DEBUG] chunk returned non-success status",
                data: {
                  trackId,
                  currentPosition,
                  status: chunkResult.status,
                  consecutiveErrors,
                },
                ts: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            consecutiveErrors++;

            if (chunkResult.status === 416) {
              // Range not satisfiable - reached end of file
              console.log(`[Audio] Reached end of file for ${trackId}`);
              // If the server says the range is not satisfiable, treat it as completion
              const finalInfo =
                await FileSystem.getInfoAsync(properCacheFilePath);
              if (finalInfo.exists && typeof finalInfo.size === "number") {
                this.registerValidatedFullTrackPath(
                  trackId,
                  properCacheFilePath
                );
                this.markDownloadCompleted(
                  trackId,
                  finalInfo.size / (1024 * 1024)
                );
                onProgress?.(100);
              }
              break;
            }
          }
        } catch (chunkError) {
          console.error(
            `[Audio] Error downloading chunk for ${trackId}:`,
            chunkError
          );
          // #region debug-point A:chunk-error
          fetch("http://192.168.1.106:7777/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: "yt-cache-stuck",
              runId: "pre-fix",
              hypothesisId: "A",
              location: "audioStreaming:continueCachingTrack:chunk-error",
              msg: "[DEBUG] chunk download threw error",
              data: {
                trackId,
                currentPosition,
                consecutiveErrors,
                error:
                  chunkError instanceof Error
                    ? chunkError.message
                    : String(chunkError),
              },
              ts: Date.now(),
            }),
          }).catch(() => {});
          // #endregion

          if (
            chunkError instanceof Error &&
            chunkError.message.includes("Chunk download timed out")
          ) {
            console.warn(
              `[Audio] Chunk download timed out for ${trackId}, ending this pass so the queue can refresh the stream URL`
            );
            break;
          }
          consecutiveErrors++;

          // Wait a bit longer before retrying
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.log(`[Audio] Continuous caching completed for track: ${trackId}`);

      // Final check: only finalize when a validated full cached file exists.
      try {
        const finalCacheInfo = await this.getCacheInfo(trackId);
        const fullCachedPath = await this.getFullCachedFilePath(trackId);
        // #region debug-point B:continue-cache-final-state
        fetch("http://192.168.1.106:7777/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "yt-cache-stuck",
            runId: "pre-fix",
            hypothesisId: "B",
            location: "audioStreaming:continueCachingTrack:final-state",
            msg: "[DEBUG] continueCachingTrack final state",
            data: {
              trackId,
              percentage: finalCacheInfo.percentage,
              fileSize: finalCacheInfo.fileSize,
              totalFileSize: finalCacheInfo.totalFileSize ?? null,
              isDownloading: finalCacheInfo.isDownloading ?? null,
              isFullyCached: finalCacheInfo.isFullyCached,
              hasFullCachedPath: Boolean(fullCachedPath),
            },
            ts: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        if (
          fullCachedPath &&
          finalCacheInfo.percentage >= 95 &&
          finalCacheInfo.percentage < 100
        ) {
          console.log(
            `[Audio] Force completing cache at ${finalCacheInfo.percentage}% for ${trackId}`
          );
          this.markDownloadCompleted(trackId, finalCacheInfo.fileSize);
        }
      } catch (finalCheckError) {
        console.warn(
          `[Audio] Final cache check failed for ${trackId}:`,
          finalCheckError
        );
      }
    } catch (error) {
      console.error(`[Audio] Continuous caching failed for ${trackId}:`, error);
    } finally {
      const progress = this.cacheProgress.get(trackId);
      // #region debug-point C:continue-cache-finally
      fetch("http://192.168.1.106:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "yt-cache-stuck",
          runId: "pre-fix",
          hypothesisId: "C",
          location: "audioStreaming:continueCachingTrack:finally",
          msg: "[DEBUG] continueCachingTrack finally state",
          data: {
            trackId,
            hasProgress: Boolean(progress),
            progressPercentage: progress?.percentage ?? null,
            progressIsDownloading: progress?.isDownloading ?? null,
            progressIsFullyCached: progress?.isFullyCached ?? null,
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (progress) {
        this.cacheProgress.set(trackId, {
          ...progress,
          isDownloading: false,
          lastUpdate: Date.now(),
        });
      }
      void updateAudioCacheIndexEntry(trackId, {
        isDownloading: false,
      });
    }
  }

  static getInstance(): AudioStreamManager {
    if (!AudioStreamManager.instance) {
      AudioStreamManager.instance = new AudioStreamManager();
    }
    return AudioStreamManager.instance;
  }

  private setupFallbackStrategies() {
    // Strategy 1: Invidious API (with dynamic instances - highest priority for YouTube)
    this.fallbackStrategies.push(this.tryInvidious.bind(this));

    // Strategy 2: Piped API (alternative to Invidious)
    this.fallbackStrategies.push(this.tryPiped.bind(this));

    // Strategy 3: YouTube Omada (fast fallback)
    this.fallbackStrategies.push(this.tryYouTubeOmada.bind(this));

    // Strategy 4: Local extraction server (if available)
    this.fallbackStrategies.push(this.tryLocalExtraction.bind(this));

    // Strategy 5: SoundCloud API (high priority for music)
    // this.fallbackStrategies.push(this.trySoundCloud.bind(this));

    // Strategy 6: YouTube Music extraction
    this.fallbackStrategies.push(this.tryYouTubeMusic.bind(this));

    // Strategy 7: Spotify Web API (requires auth but has good coverage)
    // this.fallbackStrategies.push(this.trySpotifyWebApi.bind(this));

    // Strategy 9: YouTube embed extraction (last resort)
    this.fallbackStrategies.push(this.tryYouTubeEmbed.bind(this));
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

    // Log available strategies for debugging
    console.log(
      `[AudioStreamManager] Available strategies: ${this.fallbackStrategies.length}`
    );
    this.fallbackStrategies.forEach((strategy, index) => {
      console.log(
        `[AudioStreamManager] Strategy ${index + 1}: ${this.getStrategyName(strategy)}`
      );
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
          if (!soundCloudUrl.startsWith("file://")) {
            onStatusUpdate?.("Caching SoundCloud audio...");
            const controller = new AbortController();
            const cachedUrl = await this.cacheSoundCloudStream(
              soundCloudUrl,
              videoId,
              controller
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
          error
        );
        throw new Error(
          `SoundCloud playback failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    // --- YOUTUBE / YOUTUBE MUSIC EXCLUSIVE HANDLING (try multiple strategies) ---
    if (source === "youtube" || source === "yt" || source === "youtubemusic") {
      const isYouTubeMusicSource = source === "youtubemusic";
      onStatusUpdate?.(
        isYouTubeMusicSource
          ? "Using YouTube Music strategies"
          : "Using YouTube strategies"
      );
      console.log(
        `[AudioStreamManager] ${
          isYouTubeMusicSource ? "YouTube Music" : "YouTube"
        } mode activated for: ${videoId}`
      );

      const strategies = isYouTubeMusicSource
        ? [
            [
              "JioSaavn Exact Match",
              () =>
                this.tryJioSaavnExactMatch(
                  this.currentTrackTitle,
                  this.currentTrackArtist
                ),
            ],
            ["YouTube Music", this.tryYouTubeMusic.bind(this)],
            ["Invidious", this.tryInvidious.bind(this)],
            ["Piped", this.tryPiped.bind(this)],
            ["YouTube Omada", this.tryYouTubeOmada.bind(this)],
            ["Local Extraction", this.tryLocalExtraction.bind(this)],
            ["YouTube Embed", this.tryYouTubeEmbed.bind(this)],
          ]
        : [
            ["Invidious", this.tryInvidious.bind(this)],
            ["Piped", this.tryPiped.bind(this)],
            ["YouTube Omada", this.tryYouTubeOmada.bind(this)],
            ["Local Extraction", this.tryLocalExtraction.bind(this)],
            ["YouTube Music", this.tryYouTubeMusic.bind(this)],
            ["YouTube Embed", this.tryYouTubeEmbed.bind(this)],
          ];

      for (let i = 0; i < strategies.length; i++) {
        const [strategyName, strategy] = strategies[i];

        try {
          console.log(
            `[AudioStreamManager] Trying ${strategyName} for ${
              isYouTubeMusicSource ? "YouTube Music" : "YouTube"
            }: ${videoId}`
          );
          onStatusUpdate?.(`Trying ${strategyName}...`);

          const url = await strategy(videoId);
          if (url) {
            console.log(
              `[AudioStreamManager] ${strategyName} returned URL: ${url.substring(0, 100)}...`
            );
            // Return the raw stream URL - caching will be handled by PlayerContext if needed
            return url;
          }
        } catch (error) {
          console.warn(
            `[AudioStreamManager] ${strategyName} failed for ${
              isYouTubeMusicSource ? "YouTube Music" : "YouTube"
            } ${videoId}:`,
            error instanceof Error ? error.message : error
          );
          // Continue to next strategy
          continue;
        }
      }

      // All strategies failed
      throw new Error(
        isYouTubeMusicSource
          ? "All YouTube Music strategies failed"
          : "All YouTube strategies failed"
      );
    }

    // --- JIOSAAVN HANDLING (exclusive - no fallbacks) ---
    if (source === "jiosaavn") {
      onStatusUpdate?.("Using JioSaavn strategy (exclusive)");
      console.log(
        `[AudioStreamManager] JioSaavn mode activated for: ${videoId}`
      );
      try {
        console.log(
          `[Audio] Attempting JioSaavn extraction for track: ${videoId}`
        );
        const jioSaavnUrl = await this.tryJioSaavn(
          videoId,
          this.currentTrackTitle,
          this.currentTrackArtist
        );

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
          error
        );
        throw new Error(
          `JioSaavn playback failed: ${error instanceof Error ? error.message : "Unknown error"}`
        );
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

    // Run first 3 strategies concurrently with timeout - REDUCED to 3 seconds for faster response
    const concurrentPromises = this.fallbackStrategies
      .slice(0, 3)
      .map(async (strategy, index) => {
        const strategyName = this.getStrategyName(strategy);
        const startTime = Date.now();
        console.log(
          `[AudioStreamManager] Concurrent test: ${strategyName} for ${videoId}`
        );
        try {
          const url = await Promise.race([
            strategy(videoId),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), 3000)
            ),
          ]);
          const latency = Date.now() - startTime;
          console.log(
            `[AudioStreamManager] Concurrent test ${strategyName}: ${url ? "SUCCESS" : "FAILED"} (${latency}ms)`
          );
          return { url, latency, strategy: strategyName };
        } catch (error) {
          console.log(
            `[AudioStreamManager] Concurrent test ${strategyName}: ERROR - ${error}`
          );
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
      console.log(
        `[AudioStreamManager] Concurrent test found fastest strategy: ${fastest.strategy} (${fastest.latency}ms)`
      );
      console.log(`[AudioStreamManager] Fastest URL: ${fastest.url}`);
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
      const strategyName = this.getStrategyName(strategy);

      try {
        onStatusUpdate?.(`Trying ${strategyName}...`);
        console.log(
          `[AudioStreamManager] Attempting strategy: ${strategyName} for videoId: ${videoId}`
        );
        const url = await strategy(videoId);
        console.log(
          `[AudioStreamManager] Strategy ${strategyName} returned: ${url ? "SUCCESS" : "FAILED"}`
        );
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

          console.log(
            `[AudioStreamManager] Strategy ${strategyName} succeeded with URL: ${url}`
          );
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

    const finalError = `All audio extraction strategies failed. Errors: ${errors.join("; ")}`;
    console.error(`[AudioStreamManager] ${finalError}`);
    console.error(
      `[AudioStreamManager] Total strategies attempted: ${errors.length}`
    );
    console.error(
      `[AudioStreamManager] Failed strategies: ${errors.map((e) => e.split(":")[0]).join(", ")}`
    );
    throw new Error(finalError);
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

  private async fetchWithProxy(
    url: string,
    options: RequestInit = {},
    retries = 0,
    timeout = 3000
  ): Promise<Response> {
    let lastError: unknown = null;

    for (let i = 0; i <= retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        console.log(
          `[AudioStreamManager] Attempting request (${i + 1}/${retries + 1}): ${url}`
        );

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

        if (response.ok) {
          return response;
        }

        lastError = new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
      } catch (error) {
        lastError = error;
      }

      if (i < retries) {
        const message =
          lastError instanceof Error ? lastError.message : String(lastError);
        console.warn(
          `[AudioStreamManager] fetchWithProxy attempt ${i + 1} failed for ${url}: ${message}`
        );

        const backoffMs = 300 * (i + 1) + Math.random() * 200;
        console.log(
          `[AudioStreamManager] Waiting ${Math.round(
            backoffMs
          )}ms before retry ${i + 2}`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(
      lastError ? String(lastError) : `Failed to fetch ${url} after retries`
    );
  }

  private async fetchTextWithHeaders(
    url: string,
    headers: Record<string, string>,
    timeout = 12000,
    retries = 1
  ): Promise<string> {
    const response = await this.fetchWithProxy(
      url,
      {
        headers,
      },
      retries,
      timeout
    );
    return response.text();
  }

  private async fetchJsonWithHeaders(
    url: string,
    headers: Record<string, string>,
    timeout = 12000,
    retries = 1
  ): Promise<any> {
    const response = await this.fetchWithProxy(
      url,
      {
        headers,
      },
      retries,
      timeout
    );
    return response.json();
  }

  private async fetchFirstJsonWithHeaders(
    urls: string[],
    headers: Record<string, string>,
    timeout = 5000,
    retries = 0,
    validate?: (payload: any) => boolean
  ): Promise<any | null> {
    const candidates = [...new Set(urls.filter(Boolean))];
    if (candidates.length === 0) {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      let remaining = candidates.length;

      const finish = (value: any | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      candidates.forEach((url) => {
        this.fetchJsonWithHeaders(url, headers, timeout, retries)
          .then((payload) => {
            if (validate && !validate(payload)) {
              throw new Error("Payload rejected");
            }
            finish(payload);
          })
          .catch(() => {
            remaining -= 1;
            if (remaining === 0) {
              finish(null);
            }
          });
      });
    });
  }

  private getJioSaavnRecords(payload: unknown): Record<string, any>[] {
    const queue: unknown[] = [payload];
    const records: Record<string, any>[] = [];
    const seen = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (typeof current !== "object") {
        continue;
      }

      const record = current as Record<string, any>;
      if (!Object.keys(record).length) continue;
      records.push(record);

      queue.push(
        record.data,
        record.song,
        record.songs,
        record.results,
        record.more_info
      );
    }

    return records;
  }

  private extractJioSaavnAudioUrl(payload: unknown): string | null {
    const records = this.getJioSaavnRecords(payload);

    for (const record of records) {
      const downloadCandidates = [
        record.downloadUrl,
        record.download_url,
        record.downloadLinks,
        record.more_info?.download_url,
        record.more_info?.downloadUrl,
      ].find((value) => Array.isArray(value));

      if (Array.isArray(downloadCandidates)) {
        const best = [...downloadCandidates]
          .map((entry) => (entry && typeof entry === "object" ? entry : {}))
          .sort((a: any, b: any) => {
            const score = (value: unknown) => {
              if (typeof value === "number" && Number.isFinite(value)) {
                return value;
              }
              if (typeof value === "string") {
                const match = value.match(/(\d+)/);
                if (match) return Number(match[1]);
              }
              return 0;
            };

            return (
              score(b.quality || b.bitrate || b.kbps) -
              score(a.quality || a.bitrate || a.kbps)
            );
          })
          .map(
            (entry: any) =>
              entry.url || entry.link || entry.downloadUrl || entry.download_url
          )
          .find(Boolean);

        if (best) {
          return String(best).replace("http:", "https:");
        }
      }

      const directUrl =
        record.media_url ||
        record.mediaUrl ||
        record.vlink ||
        record.preview_url ||
        record.url;
      if (typeof directUrl === "string" && /^https?:\/\//i.test(directUrl)) {
        return directUrl.replace("http:", "https:");
      }
    }

    return null;
  }

  private buildJioSaavnSongEndpoints(
    apiBase: string,
    id: string,
    urlHint?: string
  ): string[] {
    const addIdCandidates = (
      value: string,
      output: Set<string>,
      apiBase: string
    ) => {
      buildProviderUrlCandidates(apiBase, [
        `/api/songs/${encodeURIComponent(value)}`,
        `/songs/${encodeURIComponent(value)}`,
      ]).forEach((candidate) => output.add(candidate));
      buildProviderUrlCandidates(apiBase, ["/api/songs", "/songs"], {
        ids: value,
      }).forEach((candidate) => output.add(candidate));
    };

    const addLinkCandidates = (
      value: string,
      output: Set<string>,
      apiBase: string
    ) => {
      buildProviderUrlCandidates(apiBase, ["/api/songs", "/songs"], {
        link: value,
      }).forEach((candidate) => output.add(candidate));
    };

    const candidates = new Set<string>();
    if (!apiBase) {
      return [];
    }

    if (id) {
      addIdCandidates(id, candidates, apiBase);
    }

    if (urlHint) {
      addLinkCandidates(urlHint, candidates, apiBase);
      try {
        const parsed = new URL(urlHint);
        const token = parsed.pathname.split("/").filter(Boolean).pop();
        if (token) {
          addIdCandidates(token, candidates, apiBase);
        }
      } catch {
        addIdCandidates(urlHint, candidates, apiBase);
      }
    }

    return [...candidates];
  }

  private async fetchJioSaavnSongPayload(
    id: string,
    urlHint?: string
  ): Promise<any | null> {
    const providerEndpoints = await getProviderEndpoints();
    const apiBase =
      providerEndpoints.providers.jiosaavn.apiBase || API.jiosaavn.base;

    return this.fetchFirstJsonWithHeaders(
      this.buildJioSaavnSongEndpoints(apiBase, id, urlHint),
      {
        Accept: "application/json",
      },
      4500,
      0,
      (payload) => Boolean(this.extractJioSaavnAudioUrl(payload))
    );
  }

  private async findJioSaavnMatch(
    title: string,
    artist?: string
  ): Promise<{ id: string; url?: string } | null> {
    const query = [title, artist].filter(Boolean).join(" ").trim();
    if (!query) {
      return null;
    }

    const providerEndpoints = await getProviderEndpoints();
    const searchEndpoints = [
      ...buildProviderUrlCandidates(
        providerEndpoints.providers.jiosaavn.apiBase || API.jiosaavn.base,
        ["/api/search", "/search"],
        {
          query,
        }
      ),
      ...buildProviderUrlCandidates(
        providerEndpoints.providers.jiosaavn.fallbackSearchBase,
        ["/search", "/api/search"],
        {
          query,
        }
      ),
    ];

    const payload = await this.fetchFirstJsonWithHeaders(
      searchEndpoints,
      {
        Accept: "application/json",
      },
      3500,
      0,
      (response) => {
        const root = response?.data || response || {};
        return (
          (Array.isArray(root?.results) && root.results.length > 0) ||
          (Array.isArray(root?.songs?.results) && root.songs.results.length > 0)
        );
      }
    );

    if (!payload) {
      return null;
    }

    const root = payload?.data || payload || {};
    const candidates = [
      ...(Array.isArray(root?.results) ? root.results : []),
      ...(Array.isArray(root?.songs?.results) ? root.songs.results : []),
    ]
      .filter((entry: any) => entry && typeof entry === "object")
      .map((entry: any) => ({
        id: String(entry.id || entry.identifier || ""),
        url:
          typeof entry.url === "string"
            ? entry.url
            : typeof entry.permalink_url === "string"
              ? entry.permalink_url
              : undefined,
        title: String(entry.title || entry.song || entry.name || ""),
        author: String(
          entry.primary_artists ||
            entry.primaryArtists ||
            entry.singers ||
            entry.artist ||
            entry.description ||
            ""
        ),
      }))
      .filter((entry) => entry.id)
      .map((entry) => ({
        ...entry,
        score:
          titleMatchScore(title, entry.title) +
          authorMatchScore(artist, entry.author),
      }))
      .sort((left, right) => right.score - left.score);

    if (candidates[0] && candidates[0].score >= 3) {
      return {
        id: candidates[0].id,
        url: candidates[0].url,
      };
    }

    return null;
  }

  private normalizeSoundCloudUrlHint(urlHint?: string): string | undefined {
    if (!urlHint) return undefined;

    try {
      const parsed = new URL(urlHint);
      if (
        parsed.hostname === "w.soundcloud.com" &&
        parsed.pathname === "/player/"
      ) {
        const embeddedUrl = parsed.searchParams.get("url");
        if (embeddedUrl) {
          return embeddedUrl;
        }
      }
      return parsed.toString();
    } catch {
      return urlHint;
    }
  }

  private getSoundCloudClientIdCandidates(): string[] {
    const prioritizedFallbacks = [
      this.FALLBACK_SOUNDCLOUD_CLIENT_IDS[this.currentClientIdIndex],
      this.SOUNDCLOUD_CLIENT_ID,
      ...this.FALLBACK_SOUNDCLOUD_CLIENT_IDS,
    ];

    return prioritizedFallbacks.filter(
      (clientId, index, list) =>
        Boolean(clientId) && list.indexOf(clientId) === index
    );
  }

  private async getSoundCloudClientId(reset = false): Promise<string> {
    if (this.soundCloudClientId && !reset) {
      return this.soundCloudClientId;
    }

    const providerEndpoints = await getProviderEndpoints();
    const soundcloud = providerEndpoints.providers.soundcloud;
    const baseHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    try {
      const oembedUrls = buildProviderUrlCandidates(
        soundcloud.oembedBase,
        ["/oembed"],
        {
          url: `${soundcloud.origin}/lil-durk/back-again`,
        }
      );

      for (const apiUrl of oembedUrls) {
        try {
          const oembedResponse = await this.fetchTextWithHeaders(
            apiUrl,
            {
              ...baseHeaders,
              Referer: `${soundcloud.origin}/`,
              Origin: soundcloud.origin,
            },
            12000
          );
          const clientIdMatch = oembedResponse.match(
            /client_id["\s:]+([a-zA-Z0-9]+)/
          );
          if (clientIdMatch?.[1]) {
            this.soundCloudClientId = clientIdMatch[1];
            return this.soundCloudClientId;
          }
        } catch {
          continue;
        }
      }
    } catch {}

    try {
      const desktopHtml = await this.fetchTextWithHeaders(
        soundcloud.origin,
        {
          ...baseHeaders,
          Referer: `${soundcloud.origin}/`,
          Origin: soundcloud.origin,
        },
        12000
      );
      const scriptUrls = desktopHtml.match(/https?:\/\/[^\s"]+\.js/g) || [];

      for (const scriptUrl of scriptUrls) {
        try {
          const script = await this.fetchTextWithHeaders(
            scriptUrl,
            {
              ...baseHeaders,
              Referer: `${soundcloud.origin}/`,
            },
            12000
          );
          const match = script.match(/[{,]client_id:"(\w+)"/);
          if (match?.[1]) {
            this.soundCloudClientId = match[1];
            return this.soundCloudClientId;
          }
        } catch {
          continue;
        }
      }
    } catch {}

    try {
      const mobileHtml = await this.fetchTextWithHeaders(
        `${soundcloud.mobileOrigin}/`,
        {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/99.0.4844.47 Mobile/15E148 Safari/604.1",
        },
        12000
      );
      const mobileMatch = mobileHtml.match(/"clientId":"(\w+?)"/);
      if (mobileMatch?.[1]) {
        this.soundCloudClientId = mobileMatch[1];
        return this.soundCloudClientId;
      }
    } catch {}

    this.soundCloudClientId =
      this.getSoundCloudClientIdCandidates()[0] || this.SOUNDCLOUD_CLIENT_ID;
    return this.soundCloudClientId;
  }

  private async fetchSoundCloudJson(url: string): Promise<any> {
    const runRequest = async (clientId: string) => {
      const requestUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${clientId}`;
      return this.fetchJsonWithHeaders(
        requestUrl,
        {
          ...getSoundCloudHeaders(),
          Accept: "application/json",
        },
        12000
      );
    };

    const primaryClientId = await this.getSoundCloudClientId();
    try {
      return await runRequest(primaryClientId);
    } catch {
      const fallbackClientIds = this.getSoundCloudClientIdCandidates().filter(
        (clientId) => clientId !== primaryClientId
      );

      for (const clientId of fallbackClientIds) {
        try {
          const payload = await runRequest(clientId);
          this.soundCloudClientId = clientId;
          const fallbackIndex =
            this.FALLBACK_SOUNDCLOUD_CLIENT_IDS.indexOf(clientId);
          if (fallbackIndex >= 0) {
            this.currentClientIdIndex = fallbackIndex;
          }
          return payload;
        } catch {
          continue;
        }
      }

      throw await runRequest(await this.getSoundCloudClientId(true));
    }
  }

  private async tryLocalExtraction(videoId: string): Promise<string> {
    try {
      const localProxyBase = getLocalProxyBase();
      if (!localProxyBase) {
        throw new Error("Local proxy base is not configured");
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${localProxyBase}/streams/${videoId}`, {
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

  private async tryJioSaavn(
    videoId: string,
    trackTitle?: string,
    trackArtist?: string
  ): Promise<string> {
    try {
      const [directPayload, matchedSong] = await Promise.all([
        this.fetchJioSaavnSongPayload(
          videoId,
          /^https?:\/\//i.test(videoId) ? videoId : undefined
        ),
        trackTitle?.trim()
          ? this.findJioSaavnMatch(trackTitle, trackArtist)
          : Promise.resolve(null),
      ]);
      const directAudioUrl = this.extractJioSaavnAudioUrl(directPayload);
      if (directAudioUrl) {
        return directAudioUrl;
      }

      if (matchedSong?.id) {
        const matchedPayload = await this.fetchJioSaavnSongPayload(
          matchedSong.id,
          matchedSong.url
        );
        const matchedAudioUrl = this.extractJioSaavnAudioUrl(matchedPayload);
        if (matchedAudioUrl) {
          return matchedAudioUrl;
        }
      }

      const directDetailsUrl = getJioSaavnSongEndpoint(videoId);
      const directData = await this.fetchJsonWithHeaders(
        directDetailsUrl,
        {
          Accept: "application/json",
        },
        4500,
        0
      );
      const fallbackAudioUrl = this.extractJioSaavnAudioUrl(directData);
      if (fallbackAudioUrl) {
        return fallbackAudioUrl;
      }

      throw new Error(
        "No suitable JioSaavn track payload exposed a playable audio URL"
      );
    } catch (error) {
      throw new Error(
        `JioSaavn search failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async tryJioSaavnExactMatch(
    trackTitle?: string,
    trackArtist?: string
  ): Promise<string> {
    if (!trackTitle?.trim()) {
      throw new Error("Missing track metadata for JioSaavn exact match");
    }

    const matchedSong = await this.findJioSaavnMatch(trackTitle, trackArtist);
    if (!matchedSong?.id) {
      throw new Error("No exact JioSaavn match found");
    }

    const matchedPayload = await this.fetchJioSaavnSongPayload(
      matchedSong.id,
      matchedSong.url
    );
    const matchedAudioUrl = this.extractJioSaavnAudioUrl(matchedPayload);

    if (!matchedAudioUrl) {
      throw new Error("Matched JioSaavn result had no playable audio URL");
    }

    return matchedAudioUrl;
  }

  private async tryYouTubeMusic(videoId: string): Promise<string> {
    try {
      const youTubeMusicBase = getYouTubeMusicBase();
      const youTubeWebBase = getYouTubeWebBase();
      const runtimeServices = await getRuntimeServiceConfig();
      // YouTube Music extraction using alternative endpoints
      const musicEndpoints = [
        `${youTubeMusicBase}/watch?v=${videoId}`,
        ...runtimeServices.audio.youtubeMusicExtractionEndpoints,
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
            formData.append("q", `${youTubeWebBase}/watch?v=${videoId}`);
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

  private getOmadaProxyUrl(): string {
    return this.preferredInvidiousInstance || getPrimaryInvidiousInstance();
  }

  private resolveRelativeUrl(instance: string, relativeUrl: string): string {
    if (relativeUrl.startsWith("//")) {
      // Handle double slash URLs (common from Invidious API)
      // Remove one slash to make it a proper relative URL
      const cleanRelativeUrl = relativeUrl.substring(1);
      const cleanInstance = instance.endsWith("/")
        ? instance.slice(0, -1)
        : instance;
      return `${cleanInstance}${cleanRelativeUrl}`;
    } else if (relativeUrl.startsWith("/")) {
      // Handle single slash URLs
      const cleanInstance = instance.endsWith("/")
        ? instance.slice(0, -1)
        : instance;
      return `${cleanInstance}${relativeUrl}`;
    }
    return relativeUrl;
  }

  private async tryInvidious(videoId: string): Promise<string> {
    // Use runtime-configured instances, preferring the health-checked list.
    const baseInstances =
      DYNAMIC_INVIDIOUS_INSTANCES.length > 0
        ? DYNAMIC_INVIDIOUS_INSTANCES
        : API.invidious;
    const instances = this.prioritizePreferredInstance(
      [
        ...new Set(
          baseInstances.map((instance) => normalizeInvidiousInstance(instance))
        ),
      ],
      this.preferredInvidiousInstance
    );

    console.log(
      `[AudioStreamManager] Invidious trying ${instances.length} instances for video: ${videoId}`
    );
    console.log(
      `[AudioStreamManager] Available instances: ${instances.join(", ")}`
    );

    for (const instance of instances) {
      try {
        console.log(
          `[AudioStreamManager] Trying Invidious instance: ${instance}`
        );
        // Use ?local=true to get proxied URLs that bypass some blocks
        const requestUrl = `${instance}/api/v1/videos/${videoId}?local=true`;
        console.log(`[AudioStreamManager] Invidious request: ${requestUrl}`);

        const response = await this.fetchWithProxy(
          requestUrl,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              Accept: "application/json, text/plain, *\/\*",
              "Accept-Language": "en-US,en;q=0.9",
            },
          },
          0, // 0 retries
          6000 // 6 second timeout
        );

        console.log(
          `[AudioStreamManager] Invidious response status: ${response.status}`
        );

        if (!response.ok) {
          console.warn(
            `[AudioStreamManager] Invidious instance ${instance} returned ${response.status}`
          );
          continue;
        }

        // Check if response is HTML (blocked) instead of JSON
        const contentType = response.headers.get("content-type");
        if (!contentType?.includes("json")) {
          console.warn(
            `[AudioStreamManager] Invidious instance ${instance} returned HTML instead of JSON (blocked)`
          );
          continue;
        }

        const data = await response.json();
        console.log(
          `[AudioStreamManager] Invidious response data keys: ${Object.keys(data).join(", ")}`
        );

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
            let audioUrl = this.resolveRelativeUrl(
              instance,
              audioFormats[0].url
            );
            this.rememberWorkingYoutubeInstance("invidious", instance);
            console.log(
              `[AudioStreamManager] Found audio via Invidious instance ${instance} adaptiveFormats`
            );
            // Return direct stream URL (caching should be handled at PlayerContext level for liked songs only)
            return audioUrl;
          }
        }

        // Fallback to formatStreams if adaptiveFormats not available
        if (data.formatStreams) {
          console.log(
            `[AudioStreamManager] Found formatStreams: ${data.formatStreams.length} streams from ${instance}`
          );
          // First try to find audio-only streams
          const audioStreams = data.formatStreams
            .filter(
              (f: any) =>
                f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/")
            )
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

          if (audioStreams.length > 0 && audioStreams[0].url) {
            // Resolve relative URLs to full URLs
            let audioUrl = this.resolveRelativeUrl(
              instance,
              audioStreams[0].url
            );
            this.rememberWorkingYoutubeInstance("invidious", instance);
            console.log(
              `[AudioStreamManager] Found audio via formatStreams from ${instance}`
            );
            // Return direct stream URL (caching should be handled at PlayerContext level for liked songs only)
            return audioUrl;
          }
        }

        console.warn(
          `[AudioStreamManager] No audio formats found from Invidious instance ${instance}`
        );
      } catch (error) {
        console.warn(
          `[AudioStreamManager] Invidious instance ${instance} failed:`,
          error
        );
        continue;
      }
    }

    throw new Error("All Invidious instances failed");
  }

  private async tryYouTubeOmada(videoId: string): Promise<string> {
    const instance = this.getOmadaProxyUrl();
    console.log(`[YouTube Omada] Using instance: ${instance}`);

    try {
      const requestUrl = `${instance}/api/v1/videos/${videoId}`;
      console.log(`[YouTube Omada] Requesting: ${requestUrl}`);

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
        0, // 0 retries
        6000 // 6 second timeout
      );

      if (!response.ok) {
        console.error(`[YouTube Omada] HTTP error: ${response.status}`);
        throw new Error(`YouTube Omada returned ${response.status}`);
      }

      console.log(`[YouTube Omada] Response status: ${response.status}`);

      // Check if response is HTML (blocked) instead of JSON
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("json")) {
        throw new Error(
          "YouTube Omada returned HTML instead of JSON (blocked)"
        );
      }

      const data = await response.json();
      console.log(
        `[YouTube Omada] Response data keys: ${Object.keys(data).join(", ")}`
      );

      // Check for adaptive formats (primary method)
      if (data.adaptiveFormats) {
        console.log(
          "[YouTube Omada] Found adaptiveFormats:",
          data.adaptiveFormats.length,
          "formats"
        );
        const audioFormats = data.adaptiveFormats
          .filter(
            (f: any) =>
              f.type?.startsWith("audio/") || f.mimeType?.startsWith("audio/")
          )
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        console.log(
          "[YouTube Omada] Filtered audio formats:",
          audioFormats.length
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
            let audioUrl = this.resolveRelativeUrl(instance, audioFormat.url);

            // Check if this is a GoogleVideo URL that might need proxying
            let useOmadaProxy = false;

            if (audioUrl.includes("googlevideo.com")) {
              // **SKIP HEAD TEST**: Immediately try Omada proxy for GoogleVideo URLs
              const googlevideoMatch = audioUrl.match(
                /googlevideo\.com\/videoplayback\?(.+)/
              );
              if (googlevideoMatch) {
                const queryParams = googlevideoMatch[1];
                audioUrl = `${instance}/videoplayback?${queryParams}`;
                useOmadaProxy = true;
                console.log(
                  `[YouTube Omada] Using Omada proxy for GoogleVideo URL (format ${i + 1}/${audioFormats.length}, bitrate: ${audioFormat.bitrate})`
                );
              }
            }

            console.log(
              `[YouTube Omada] Attempting audio format ${i + 1}/${audioFormats.length} (bitrate: ${audioFormat.bitrate}, type: ${audioFormat.type || audioFormat.mimeType})`
            );
            console.log(
              "[YouTube Omada] Audio URL:",
              audioUrl.substring(0, 100) + "..."
            );

            // **RETURN IMMEDIATELY**: Don't test with HEAD, let the caching process handle failures
            console.log(
              "[AudioStreamManager] Found audio via YouTube Omada adaptiveFormats - returning immediately"
            );
            console.log(
              `[YouTube Omada] Audio format ${i + 1} selected, starting playback immediately`
            );
            return audioUrl;
          }
        }

        // If no audio formats worked, continue to formatStreams fallback
        console.log(
          "[YouTube Omada] All audio formats failed, trying formatStreams fallback"
        );
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

        // Try all audio streams
        for (let i = 0; i < audioStreams.length; i++) {
          const audioStream = audioStreams[i];
          if (audioStream.url) {
            // Resolve relative URLs to full URLs
            let audioUrl = this.resolveRelativeUrl(instance, audioStream.url);

            // Check if this is a GoogleVideo URL that needs proxying through Omada
            if (audioUrl.includes("googlevideo.com")) {
              // Convert GoogleVideo URL to Omada proxy URL
              const googlevideoMatch = audioUrl.match(
                /googlevideo\.com\/videoplayback\?(.+)/
              );
              if (googlevideoMatch) {
                const queryParams = googlevideoMatch[1];
                audioUrl = `${instance}/videoplayback?${queryParams}`;
                console.log(
                  "[YouTube Omada] Converting formatStreams GoogleVideo URL to Omada proxy"
                );
              }
            }
            console.log(
              `[YouTube Omada] Attempting formatStreams audio ${i + 1}/${audioStreams.length} (bitrate: ${audioStream.bitrate}, type: ${audioStream.type || audioStream.mimeType})`
            );

            // **RETURN IMMEDIATELY**: Don't test with HEAD, let the caching process handle failures
            console.log(
              "[AudioStreamManager] Found audio via YouTube Omada formatStreams - returning immediately"
            );
            console.log(
              `[YouTube Omada] formatStreams audio ${i + 1} selected, starting playback immediately`
            );
            return audioUrl;
          }
        }

        console.log(
          "[YouTube Omada] All formatStreams audio formats failed - trying video streams"
        );
      }

      // Fallback: Try video streams and extract audio
      if (data.formatStreams && data.formatStreams.length > 0) {
        console.log(
          "[YouTube Omada] Trying video streams for audio extraction"
        );

        // Try video streams sorted by quality (lower quality = smaller file = faster download)
        const videoStreams = data.formatStreams
          .filter(
            (f: any) =>
              !f.type?.startsWith("audio/") && !f.mimeType?.startsWith("audio/")
          )
          .sort((a: any, b: any) => (a.bitrate || 0) - (b.bitrate || 0)); // Lower bitrate first

        for (let i = 0; i < videoStreams.length; i++) {
          const videoStream = videoStreams[i];
          if (videoStream.url) {
            let videoUrl = this.resolveRelativeUrl(instance, videoStream.url);

            // Check if this is a GoogleVideo URL that needs proxying through Omada
            if (videoUrl.includes("googlevideo.com")) {
              // Convert GoogleVideo URL to Omada proxy URL
              const googlevideoMatch = videoUrl.match(
                /googlevideo\.com\/videoplayback\?(.+)/
              );
              if (googlevideoMatch) {
                const queryParams = googlevideoMatch[1];
                videoUrl = `${instance}/videoplayback?${queryParams}`;
                console.log(
                  "[YouTube Omada] Converting video stream GoogleVideo URL to Omada proxy"
                );
              }
            }
            console.log(
              `[YouTube Omada] Attempting video stream ${i + 1}/${videoStreams.length} (bitrate: ${videoStream.bitrate}, quality: ${videoStream.quality || "unknown"})`
            );

            // **SKIP HEAD TEST**: Immediately try to extract audio from video stream
            console.log(
              "[YouTube Omada] Attempting to extract audio from video stream immediately"
            );

            try {
              // Try to convert video stream to audio-only
              const audioUrl = await this.convertStreamToMP3(videoUrl, videoId);
              if (audioUrl) {
                console.log(
                  "[YouTube Omada] Successfully extracted audio from video stream"
                );
                return audioUrl;
              }
            } catch (convertError) {
              console.log(
                `[YouTube Omada] Video stream ${i + 1} conversion failed:`,
                convertError
              );
            }
          }
        }

        console.log("[YouTube Omada] All video streams failed");
      }

      throw new Error(
        "No working audio formats found in YouTube Omada response. All formats failed during conversion."
      );
    } catch (error) {
      console.error("[YouTube Omada] Complete failure details:");
      console.error(
        "[YouTube Omada] Error type:",
        error instanceof Error ? error.constructor.name : typeof error
      );
      console.error(
        "[YouTube Omada] Error message:",
        error instanceof Error ? error.message : String(error)
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
      const youTubeWebBase = getYouTubeWebBase();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${youTubeWebBase}/embed/${videoId}`, {
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
      const runtimeServices = await getRuntimeServiceConfig();
      const spotifySearchProxyBase =
        runtimeServices.audio.spotifySearchProxyBase;
      if (!spotifySearchProxyBase) {
        throw new Error("Spotify search proxy is not configured");
      }

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

      const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`).trim();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const searchResponse = await fetch(
        `${spotifySearchProxyBase}/search?q=${query}&type=track&limit=1`,
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

      const trackId = this.extractSoundCloudTrackId(videoId);
      const normalizedUrlHint = this.normalizeSoundCloudUrlHint(videoId);
      const isPermalink =
        typeof normalizedUrlHint === "string" &&
        normalizedUrlHint.includes("soundcloud.com/");

      let resolvedData: any | null = null;

      if (isPermalink) {
        onStatusUpdate?.("Resolving SoundCloud permalink");
        resolvedData = await this.resolveSoundCloudTrackDataByUrl(
          normalizedUrlHint!
        );
      }

      if (!resolvedData && trackId) {
        onStatusUpdate?.("Resolving SoundCloud track");
        resolvedData = await this.fetchSoundCloudTrackDataById(trackId);
      }

      if (!resolvedData && trackId) {
        const soundCloudApiBase = getSoundCloudApiBase();
        if (!soundCloudApiBase) {
          throw new Error("SoundCloud API base is not configured");
        }
        resolvedData = await this.resolveSoundCloudTrackDataByUrl(
          `${soundCloudApiBase}/tracks/${trackId}`
        );
      }

      if (resolvedData?.media?.transcodings?.length) {
        const controller = new AbortController();
        return await this.extractSoundCloudStream(resolvedData, controller);
      }

      throw new Error(SOUNDCLOUD_TRACK_UNAVAILABLE_ERROR_EN);
    } catch (error) {
      if (isSoundCloudRestrictedFailure(error)) {
        throw new Error(SOUNDCLOUD_RESTRICTED_PLAYBACK_ERROR_EN);
      }

      throw new Error(SOUNDCLOUD_TRACK_UNAVAILABLE_ERROR_EN);
    }
  }

  private getSoundCloudTranscodingScore(transcoding: any): number {
    const protocol = String(transcoding?.format?.protocol || "").toLowerCase();
    const mimeType = String(transcoding?.format?.mime_type || "").toLowerCase();
    let score = 0;

    // Match the web player ordering so we hit the same upstream requests.
    if (protocol === "progressive") score += 100;
    if (protocol === "ctr-encrypted-hls") score += 90;
    if (protocol === "cbc-encrypted-hls") score += 80;
    if (protocol.includes("encrypted")) score += 20;
    if (protocol === "hls") score += 10;
    if (!transcoding?.is_legacy_transcoding) score += 5;
    if (mimeType.includes("audio/mp4")) score += 2;
    if (String(transcoding?.quality || "").toLowerCase() === "sq") score += 1;

    return score;
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
      throw new Error(SOUNDCLOUD_TRACK_UNAVAILABLE_ERROR_EN);
    }

    const trackId = trackData.id ? String(trackData.id) : "";
    if (!trackId) {
      throw new Error(SOUNDCLOUD_TRACK_UNAVAILABLE_ERROR_EN);
    }

    const orderedTranscodings = [...trackData.media.transcodings]
      .filter((transcoding: any) => typeof transcoding?.url === "string")
      .sort(
        (left: any, right: any) =>
          this.getSoundCloudTranscodingScore(right) -
          this.getSoundCloudTranscodingScore(left)
      );

    const playableTranscodings = orderedTranscodings.filter(
      (transcoding: any) => {
        const protocol = String(
          transcoding?.format?.protocol || ""
        ).toLowerCase();
        return !protocol.includes("encrypted");
      }
    );
    if (playableTranscodings.length === 0 && orderedTranscodings.length > 0) {
      throw new Error(SOUNDCLOUD_RESTRICTED_PLAYBACK_ERROR_EN);
    }
    const transcodingsToTry = playableTranscodings;

    let lastError: Error | null = null;

    for (const transcoding of transcodingsToTry) {
      try {
        const resolveUrl = new URL(String(transcoding.url));
        if (trackData.track_authorization) {
          resolveUrl.searchParams.set(
            "track_authorization",
            String(trackData.track_authorization)
          );
        }

        const streamData = await this.fetchSoundCloudJson(
          resolveUrl.toString()
        );
        if (!streamData?.url) {
          lastError = new Error("SoundCloud stream URL missing");
          continue;
        }

        return await this.cacheSoundCloudStream(
          String(streamData.url),
          trackId,
          controller
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (isSoundCloudRestrictedFailure(lastError)) {
      throw new Error(SOUNDCLOUD_RESTRICTED_PLAYBACK_ERROR_EN);
    }

    throw new Error(SOUNDCLOUD_TRACK_UNAVAILABLE_ERROR_EN);
  }

  private extractSoundCloudTrackId(videoId: string): string | null {
    if (/^\d+$/.test(videoId)) {
      return videoId;
    }

    if (videoId.includes("soundcloud:tracks:")) {
      const parts = videoId.split("soundcloud:tracks:");
      const rawId = parts[1]?.split(/[?#/]/)[0];
      if (rawId && /^\d+$/.test(rawId)) {
        return rawId;
      }
    }

    const apiMatch = videoId.match(/api\.soundcloud\.com\/tracks\/(\d+)/);
    if (apiMatch && apiMatch[1]) {
      return apiMatch[1];
    }

    const apiV2Match = videoId.match(/api-v2\.soundcloud\.com\/tracks\/(\d+)/);
    if (apiV2Match && apiV2Match[1]) {
      return apiV2Match[1];
    }

    const soundcloudMatch = videoId.match(/soundcloud\.com\/.*\/.*?(\d+)$/);
    if (soundcloudMatch) {
      return soundcloudMatch[1];
    }

    return null;
  }

  private async fetchSoundCloudTrackDataById(
    trackId: string
  ): Promise<any | null> {
    const soundCloudApiV2Base = getSoundCloudApiV2Base();
    if (!soundCloudApiV2Base) {
      return null;
    }

    try {
      const payload = await this.fetchSoundCloudJson(
        `${soundCloudApiV2Base}/tracks/${encodeURIComponent(trackId)}`
      );
      if (payload?.media?.transcodings?.length) {
        return payload;
      }
    } catch {}

    return null;
  }

  private async resolveSoundCloudTrackDataByUrl(
    url: string
  ): Promise<any | null> {
    const soundCloudApiV2Base = getSoundCloudApiV2Base();
    if (!soundCloudApiV2Base) {
      return null;
    }

    try {
      const resolveUrl = `${soundCloudApiV2Base.replace(
        /\/+$/g,
        ""
      )}/resolve?url=${encodeURIComponent(url)}`;
      const payload = await this.fetchSoundCloudJson(resolveUrl);
      if (payload?.media?.transcodings?.length) {
        return payload;
      }
    } catch {}

    return null;
  }

  private async tryPiped(videoId: string): Promise<string> {
    try {
      const pipedInstances = this.prioritizePreferredInstance(
        [...API.piped],
        this.preferredPipedInstance
      );

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
            const streams = data.audioStreams.filter(
              (stream: any) => stream.url && !stream.videoOnly
            );
            const order = (s: any) => {
              const i = String(s.itag || s.tag || "");
              if (i === "249") return 0;
              if (i === "250") return 1;
              if (i === "251") return 2;
              return 3;
            };
            const sortedStreams = streams.sort((a: any, b: any) => {
              const oa = order(a);
              const ob = order(b);
              if (oa !== ob) return oa - ob;
              const ca =
                typeof a.clen === "number"
                  ? a.clen
                  : a.clen
                    ? parseInt(String(a.clen), 10)
                    : Number.MAX_SAFE_INTEGER;
              const cb =
                typeof b.clen === "number"
                  ? b.clen
                  : b.clen
                    ? parseInt(String(b.clen), 10)
                    : Number.MAX_SAFE_INTEGER;
              if (ca !== cb) return ca - cb;
              return (a.bitrate || 0) - (b.bitrate || 0);
            });

            if (sortedStreams.length > 0) {
              this.rememberWorkingYoutubeInstance("piped", instance);
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

  // Helper method to get video info with extended timeout

  // Helper method to get video info with extended timeout
  private async getVideoInfoWithTimeout(
    videoId: string,
    timeout = 30000
  ): Promise<{ title?: string; author?: string }> {
    try {
      const youTubeWebBase = getYouTubeWebBase();
      // Try multiple sources for video info
      const sources = [
        ...API.invidious.map((url) => `${url}/api/v1/videos/${videoId}`),
        `${youTubeWebBase}/embed/${videoId}`,
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
    videoId: string
  ): Promise<{ title?: string; author?: string }> {
    try {
      const primaryInvidiousInstance = getPrimaryInvidiousInstance();
      const youTubeWebBase = getYouTubeWebBase();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      if (!primaryInvidiousInstance) {
        throw new Error("No Invidious instance is configured");
      }
      const response = await fetch(
        `${primaryInvidiousInstance}/api/v1/videos/${videoId}`,
        {
          signal: controller.signal,
        }
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
          `${getYouTubeWebBase()}/embed/${videoId}`,
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

  // Helper method to get strategy name from function
  private getStrategyName(strategy: Function): string {
    const strategyMap = new Map<Function, string>([
      [this.tryInvidious, "Invidious"],
      [this.tryPiped, "Piped"],
      [this.tryYouTubeOmada, "YouTube Omada"],
      [this.tryLocalExtraction, "Local Extraction"],
      [this.trySoundCloud, "SoundCloud"],
      [this.tryYouTubeMusic, "YouTube Music"],
      [this.trySpotifyWebApi, "Spotify Web API"],
      [this.tryYouTubeEmbed, "YouTube Embed"],
    ]);

    return strategyMap.get(strategy) || "Unknown Strategy";
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
    let resumeFilePath: string;

    try {
      // #region debug-point D:resume-entry
      fetch("http://192.168.1.106:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "yt-cache-stuck",
          runId: "pre-fix",
          hypothesisId: "D",
          location: "audioStreaming:resumeCacheDownload:entry",
          msg: "[DEBUG] resumeCacheDownload started",
          data: {
            trackId,
            startPosition,
            streamUrlPrefix: streamUrl.slice(0, 80),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      console.log(
        `[Audio] Resuming cache download from position ${startPosition} for track: ${trackId}`
      );

      // Mark download as started to indicate active resume operation
      this.markDownloadStarted(trackId, streamUrl);

      // Use our dynamic cache directory instead of extracting from the path
      const cacheDir = await this.getCacheDirectory();
      if (!cacheDir) {
        console.warn(
          "[Audio] No cache directory available, skipping resume download"
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
      const resumeTimeout = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `Resume download timed out after ${CACHE_RESUME_REQUEST_TIMEOUT_MS}ms`
              )
            ),
          CACHE_RESUME_REQUEST_TIMEOUT_MS
        );
      });
      const resumeResult = (await Promise.race([
        FileSystem.downloadAsync(streamUrl, resumeFilePath, {
          headers: {
            Range: `bytes=${startPosition}-`,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            ...getYouTubeHeaders(),
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        }),
        resumeTimeout,
      ])) as Awaited<ReturnType<typeof FileSystem.downloadAsync>>;

      // #region debug-point D:resume-response
      fetch("http://192.168.1.106:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "yt-cache-stuck",
          runId: "pre-fix",
          hypothesisId: "D",
          location: "audioStreaming:resumeCacheDownload:response",
          msg: "[DEBUG] resumeCacheDownload response received",
          data: {
            trackId,
            startPosition,
            status: resumeResult.status,
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      if (resumeResult.status === 200 || resumeResult.status === 206) {
        console.log(`[Audio] Resume download successful for track: ${trackId}`);

        // Check if the resume file exists and has content
        const resumeFileInfo = await FileSystem.getInfoAsync(resumeFilePath);
        if (!resumeFileInfo.exists || resumeFileInfo.size === 0) {
          console.warn(
            `[Audio] Resume file is empty or doesn't exist for track: ${trackId}`
          );
          // Clean up resume file if it exists
          await FileSystem.deleteAsync(resumeFilePath, {
            idempotent: true,
          });
          return;
        }

        // Use a more robust approach: copy the resumed content directly
        // without trying to read it as Base64/UTF8
        console.log("[Audio] Attempting binary-safe file combination");

        // Get file info for both files
        const existingFileInfo =
          await FileSystem.getInfoAsync(properCacheFilePath);

        if (!existingFileInfo.exists || !resumeFileInfo.exists) {
          console.warn(
            "[Audio] One of the files doesn't exist for combination"
          );
          return;
        }

        const existingSize =
          typeof existingFileInfo.size === "number" ? existingFileInfo.size : 0;
        const resumeSize =
          typeof resumeFileInfo.size === "number" ? resumeFileInfo.size : 0;
        const combinedSize = existingSize + resumeSize;
        const maxCombineSize = 24 * 1024 * 1024;

        if (combinedSize > maxCombineSize) {
          console.warn(
            `[Audio] Combined cache size ${combinedSize} bytes too large for in-memory resume, switching to full download for ${trackId}`
          );
          await FileSystem.deleteAsync(resumeFilePath, { idempotent: true });
          await this.downloadFullTrackInBackground(
            streamUrl,
            properCacheFilePath,
            trackId,
            controller,
            { skipConcurrentCheck: true }
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
          { encoding: FileSystem.EncodingType.Base64 }
        );
        const resumeArray = await FileSystem.readAsStringAsync(resumeFilePath, {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Decode both base64 strings to binary, concatenate, then re-encode
        const existingBinary = toByteArray(existingArray);
        const resumeBinary = toByteArray(resumeArray);
        const combinedBinary = new Uint8Array(
          existingBinary.length + resumeBinary.length
        );
        combinedBinary.set(existingBinary);
        combinedBinary.set(resumeBinary, existingBinary.length);
        const combinedBase64 = fromByteArray(combinedBinary);

        // Combine and write back
        await FileSystem.writeAsStringAsync(tempCombinedPath, combinedBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });

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

        // Clean up resume file
        await FileSystem.deleteAsync(resumeFilePath, {
          idempotent: true,
        });

        console.log(`[Audio] Cache resumed and combined for track: ${trackId}`);

        // Report updated progress
        // Add a small delay to ensure filesystem has updated the file size
        await new Promise((resolve) => setTimeout(resolve, 1000));
        this.registerValidatedFullTrackPath(trackId, properCacheFilePath);
        const updatedCacheInfo = await this.getCacheInfo(trackId);
        onProgress?.(updatedCacheInfo.percentage);
        // #region debug-point E:resume-updated-cache
        fetch("http://192.168.1.106:7777/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "yt-cache-stuck",
            runId: "pre-fix",
            hypothesisId: "E",
            location: "audioStreaming:resumeCacheDownload:updated-cache",
            msg: "[DEBUG] resumeCacheDownload updated cache info",
            data: {
              trackId,
              percentage: updatedCacheInfo.percentage,
              fileSize: updatedCacheInfo.fileSize,
              totalFileSize: updatedCacheInfo.totalFileSize ?? null,
              isDownloading: updatedCacheInfo.isDownloading ?? null,
              isFullyCached: updatedCacheInfo.isFullyCached,
            },
            ts: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
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
      // #region debug-point D:resume-error
      fetch("http://192.168.1.106:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "yt-cache-stuck",
          runId: "pre-fix",
          hypothesisId: "D",
          location: "audioStreaming:resumeCacheDownload:error",
          msg: "[DEBUG] resumeCacheDownload threw error",
          data: {
            trackId,
            startPosition,
            error: error instanceof Error ? error.message : String(error),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      console.error(
        `[Audio] Failed to resume cache download for track ${trackId}:`,
        error
      );

      // Check if it's a permission/writability error
      if (
        error?.toString().includes("isn't writable") ||
        error?.toString().includes("Permission denied")
      ) {
        console.warn(
          `[Audio] Cache directory not writable, skipping resume for track ${trackId}`
        );
        // Don't retry resume for permission errors - just continue with streaming
        return;
      }

      if (
        error instanceof Error &&
        error.message.includes("Resume download timed out")
      ) {
        console.warn(
          `[Audio] Resume timed out for ${trackId}, deferring to the next queue pass for a fresh stream URL`
        );
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

export async function startProgressiveYouTubeCache(
  youtubeUrl: string,
  trackId: string,
  controller: AbortController
): Promise<void> {
  return AudioStreamManager.getInstance().startProgressiveYouTubeCache(
    youtubeUrl,
    trackId,
    controller
  );
}

export async function cacheYouTubeStreamFromPosition(
  youtubeUrl: string,
  trackId: string,
  positionSeconds: number,
  controller: AbortController
): Promise<string> {
  return AudioStreamManager.getInstance().cacheYouTubeStreamFromPosition(
    youtubeUrl,
    trackId,
    positionSeconds,
    controller
  );
}

export async function continueCachingTrack(
  streamUrl: string,
  trackId: string,
  controller: AbortController,
  onProgress?: (percentage: number) => void
): Promise<void> {
  return AudioStreamManager.getInstance().continueCachingTrack(
    streamUrl,
    trackId,
    controller,
    onProgress
  );
}

export function subscribeToAudioCacheProgress(
  listener: (update: AudioCacheProgressUpdate) => void
): () => void {
  return AudioStreamManager.getInstance().subscribeToCacheProgress(listener);
}

export async function cleanupCacheForTrack(trackId: string): Promise<void> {
  return AudioStreamManager.getInstance().cleanupTrackCache(trackId);
}

// Track active monitoring instances to prevent duplicates
const activeMonitors = new Set<string>();

async function getFileSizeWithUriFallback(
  filePathOrUri: string
): Promise<number> {
  if (!filePathOrUri) {
    return 0;
  }

  const normalizedPath = filePathOrUri.replace(/^file:\/\//, "");
  let fileInfo = await FileSystem.getInfoAsync(normalizedPath);

  if (!fileInfo.exists) {
    fileInfo = await FileSystem.getInfoAsync(filePathOrUri);
  }

  return fileInfo.exists && typeof fileInfo.size === "number"
    ? fileInfo.size
    : 0;
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
  // Prevent multiple monitoring instances for the same track
  console.log(
    `[CacheMonitor] Checking if monitoring already active for track: ${trackId}, active tracks: ${Array.from(activeMonitors).join(", ")}`
  );
  if (activeMonitors.has(trackId)) {
    console.log(
      `[CacheMonitor] Monitoring already active for track: ${trackId}, skipping duplicate`
    );
    return;
  }

  activeMonitors.add(trackId);
  console.log(
    `[CacheMonitor] Starting monitoring for track: ${trackId}, total active: ${activeMonitors.size}`
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
          `[CacheMonitor] Found substantial partial cache (${currentPercentage}%) but no active download, attempting resume for track: ${trackId}`
        );

        const originalStreamUrl = getOriginalStreamUrl();
        if (originalStreamUrl) {
          // Check if we have any cached file to resume from
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const currentSize =
              await getFileSizeWithUriFallback(cachedFilePath);

            if (currentSize > 0) {
              // console.log(
              //   `[CacheMonitor] Found existing cache file (${currentSize} bytes), resuming download`
              // );

              // Resume downloading from the current position
              const resumeController = new AbortController();
              try {
                await manager.resumeCacheDownload(
                  originalStreamUrl,
                  cachedFilePath,
                  trackId,
                  currentSize,
                  resumeController,
                  onProgress
                );
                activeMonitors.delete(trackId);
                return; // Exit early only if resume succeeds
              } catch (resumeError: any) {
                console.error(
                  `[CacheMonitor] Resume failed for track ${trackId}:`,
                  resumeError
                );

                // If it's a permission/writability error, don't try to resume this track
                if (
                  resumeError?.toString().includes("isn't writable") ||
                  resumeError?.toString().includes("Permission denied")
                ) {
                  console.warn(
                    `[CacheMonitor] Cache directory not writable, skipping resume for track ${trackId}`
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
            `[CacheMonitor] Found cached URL but no active progress, attempting resume for track: ${trackId}`
          );

          // Check if we have any cached file to resume from
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const currentSize =
              await getFileSizeWithUriFallback(cachedFilePath);

            if (currentSize > 0) {
              // console.log(
              //   `[CacheMonitor] Found existing cache file (${currentSize} bytes), resuming download`
              // );

              // Resume downloading from the current position
              const resumeController = new AbortController();
              try {
                await manager.resumeCacheDownload(
                  originalStreamUrl,
                  cachedFilePath,
                  trackId,
                  currentSize,
                  resumeController,
                  onProgress
                );
                return; // Exit early only if resume succeeds
              } catch (resumeError: any) {
                console.error(
                  `[CacheMonitor] Resume failed for track ${trackId}:`,
                  resumeError
                );

                // If it's a permission/writability error, don't try to resume this track
                if (
                  resumeError?.toString().includes("isn't writable") ||
                  resumeError?.toString().includes("Permission denied")
                ) {
                  console.warn(
                    `[CacheMonitor] Cache directory not writable, skipping resume for track ${trackId}`
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
          `[CacheMonitor] Cache appears stuck (${stuckCount}/3) for track: ${trackId}, last: ${lastPercentage}, current: ${currentPercentage}`
        );

        if (stuckCount >= maxStuckCount) {
          console.log(
            `[CacheMonitor] Resuming stuck cache for track: ${trackId}`
          );

          // Resume the cache download from the last position
          const cachedFilePath = await manager.getBestCachedFilePath(trackId);
          if (cachedFilePath) {
            const currentSize =
              await getFileSizeWithUriFallback(cachedFilePath);

            console.log(
              `[CacheMonitor] Current file size: ${currentSize} bytes`
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
                  cachedFilePath,
                  trackId,
                  currentSize,
                  resumeController,
                  onProgress
                );
                stuckCount = 0; // Reset stuck counter only if resume succeeds
              } catch (resumeError: any) {
                console.error(
                  `[CacheMonitor] Resume failed for track ${trackId}:`,
                  resumeError
                );

                // If it's a permission/writability error, stop trying to resume this track
                if (
                  resumeError?.toString().includes("isn't writable") ||
                  resumeError?.toString().includes("Permission denied")
                ) {
                  console.warn(
                    `[CacheMonitor] Cache directory not writable, stopping resume attempts for track ${trackId}`
                  );
                  return; // Exit monitoring for this track
                }

                // For other errors, continue monitoring but don't reset stuckCount
                // This prevents infinite retry loops
              }
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
        // Clean up monitoring instance
        activeMonitors.delete(trackId);
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

export async function clearTrackCache(trackId?: string): Promise<void> {
  await AudioStreamManager.getInstance().clearTrackCache(trackId);
}

export async function downloadCompleteSongAsMP3(
  streamUrl: string,
  trackId: string,
  controller: AbortController,
  onProgress?: (percentage: number) => void
): Promise<string> {
  return AudioStreamManager.getInstance().downloadCompleteSongAsMP3(
    streamUrl,
    trackId,
    controller,
    onProgress
  );
}

type AudioCacheIndexEntry = {
  trackId: string;
  url: string;
  sizeBytes: number;
  estimatedSizeBytes?: number;
  downloadedBytes?: number;
  isDownloading: boolean;
  isFullyCached: boolean;
  updatedAt: number;
  lastUsedAt: number;
};

type AudioCacheIndex = {
  totalBytes: number;
  entries: Record<string, AudioCacheIndexEntry>;
};

const AUDIO_CACHE_INDEX_KEY = "@audio_cache_index_v2";
const CACHE_SIZE_FALLBACK_BYTES = 512 * 1024 * 1024;
const CACHE_MIN_BYTES = 50 * 1024 * 1024;
const CACHE_HEAD_TIMEOUT_MS = 8000;
const CACHE_PROXY_TIMEOUT_MS = 5000;
const CACHE_VALIDATION_DIFF_BYTES = 1024 * 1024;
const CACHE_VALIDATION_DIFF_RATIO = 0.02;
const CACHE_CHUNK_REQUEST_TIMEOUT_MS = 20000;
const CACHE_RESUME_REQUEST_TIMEOUT_MS = 25000;

const toMB = (bytes: number) => Math.max(0, bytes / (1024 * 1024));

const loadAudioCacheIndex = async (): Promise<AudioCacheIndex> => {
  try {
    const raw = await AsyncStorage.getItem(AUDIO_CACHE_INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AudioCacheIndex;
      if (parsed && parsed.entries) {
        return {
          totalBytes: parsed.totalBytes || 0,
          entries: parsed.entries || {},
        };
      }
    }
  } catch {}
  return { totalBytes: 0, entries: {} };
};

const saveAudioCacheIndex = async (index: AudioCacheIndex): Promise<void> => {
  try {
    await AsyncStorage.setItem(AUDIO_CACHE_INDEX_KEY, JSON.stringify(index));
  } catch {}
};

const updateAudioCacheIndexEntry = async (
  trackId: string,
  updates: Partial<AudioCacheIndexEntry>
): Promise<void> => {
  try {
    const index = await loadAudioCacheIndex();
    const existing = index.entries[trackId];
    if (!existing) {
      return;
    }

    const previousReservedBytes = existing.sizeBytes || 0;
    const nextEntry: AudioCacheIndexEntry = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    index.entries[trackId] = nextEntry;

    const nextReservedBytes = nextEntry.sizeBytes || 0;
    if (nextReservedBytes !== previousReservedBytes) {
      index.totalBytes = Math.max(
        0,
        index.totalBytes - previousReservedBytes + nextReservedBytes
      );
    }

    await saveAudioCacheIndex(index);
  } catch {}
};

const getCacheLimitBytes = async (): Promise<number> => {
  try {
    const freeBytes = await FileSystem.getFreeDiskStorageAsync();
    const dynamicLimit = Math.floor(freeBytes * 0.1);
    return Math.max(
      CACHE_MIN_BYTES,
      Math.min(CACHE_SIZE_FALLBACK_BYTES, dynamicLimit)
    );
  } catch {
    return CACHE_SIZE_FALLBACK_BYTES;
  }
};

const parseUrlContentLength = (url: string): number | null => {
  try {
    const parsed = new URL(url);
    const clen = parsed.searchParams.get("clen");
    if (!clen) {
      return null;
    }
    const value = parseInt(clen, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

const fetchHeadContentLength = async (url: string): Promise<number | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CACHE_HEAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    const headerValue = response.headers.get("content-length");
    if (!headerValue) {
      return null;
    }
    const parsed = parseInt(headerValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveContentLength = async (
  url: string
): Promise<{ length: number | null; isValid: boolean }> => {
  const [headLength, urlLength] = await Promise.all([
    fetchHeadContentLength(url),
    Promise.resolve(parseUrlContentLength(url)),
  ]);

  const resolvedLength = headLength ?? urlLength ?? null;
  if (!resolvedLength || resolvedLength <= 0) {
    return { length: null, isValid: false };
  }

  if (headLength && urlLength) {
    const diff = Math.abs(headLength - urlLength);
    const ratio = diff / Math.max(headLength, urlLength);
    if (
      diff > CACHE_VALIDATION_DIFF_BYTES &&
      ratio > CACHE_VALIDATION_DIFF_RATIO
    ) {
      return { length: null, isValid: false };
    }
  }

  return { length: resolvedLength, isValid: true };
};

const isRemoteStreamUrl = (url: string) =>
  url.startsWith("http://") || url.startsWith("https://");

let videoCacheConvert: ((url: string) => string) | null = null;
let videoCacheConvertAsync: ((url: string) => Promise<string>) | null = null;

try {
  // Use require + try/catch so we don't crash if native module is missing
  // or not correctly linked. In that case we simply disable caching.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const videoCacheModule = require("react-native-video-cache");
  if (typeof videoCacheModule === "function") {
    videoCacheConvert = videoCacheModule;
  } else if (typeof videoCacheModule?.default === "function") {
    videoCacheConvert = videoCacheModule.default;
  }
  if (typeof videoCacheModule?.convertAsync === "function") {
    videoCacheConvertAsync = videoCacheModule.convertAsync;
  }
} catch {
  videoCacheConvert = null;
  videoCacheConvertAsync = null;
}

const getProxyUrl = async (
  url: string
): Promise<{ url: string; isProxy: boolean }> => {
  if (videoCacheConvertAsync) {
    try {
      const timeout = new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("proxy-timeout")),
          CACHE_PROXY_TIMEOUT_MS
        )
      );
      const proxyUrl = await Promise.race([
        videoCacheConvertAsync(url),
        timeout,
      ]);
      return { url: proxyUrl, isProxy: proxyUrl !== url };
    } catch {}
  }
  if (videoCacheConvert) {
    try {
      const proxyUrl = videoCacheConvert(url);
      return { url: proxyUrl, isProxy: proxyUrl !== url };
    } catch {}
  }
  return { url, isProxy: false };
};

export type AudioCacheInfo = {
  percentage: number;
  fileSize: number;
  totalFileSize?: number;
  isFullyCached: boolean;
  isDownloading?: boolean;
  downloadSpeed?: number;
  retryCount?: number;
};

export async function prepareCachedStreamUrl(
  url: string,
  trackId?: string
): Promise<{ url: string; cacheInfo: AudioCacheInfo | null }> {
  if (!url || !isRemoteStreamUrl(url)) {
    return { url, cacheInfo: null };
  }

  if (trackId) {
    const manager = AudioStreamManager.getInstance();
    const fullCachedPath = await manager.getFullCachedFilePath(trackId);
    if (fullCachedPath) {
      return {
        url: fullCachedPath,
        cacheInfo: {
          percentage: 100,
          fileSize: 0,
          isFullyCached: true,
          isDownloading: false,
        },
      };
    }
  }

  const proxyResult = await getProxyUrl(url);
  if (!proxyResult.isProxy) {
    return { url, cacheInfo: null };
  }

  const { length, isValid } = await resolveContentLength(url);

  const index = await loadAudioCacheIndex();
  const limitBytes = await getCacheLimitBytes();
  const existing = trackId ? index.entries[trackId] : undefined;
  const currentTotal = index.totalBytes - (existing?.sizeBytes || 0);

  if (isValid && length && currentTotal + length > limitBytes) {
    return { url, cacheInfo: null };
  }

  if (trackId) {
    const updated: AudioCacheIndexEntry = {
      trackId,
      url,
      sizeBytes: isValid && length ? length : 0,
      estimatedSizeBytes: isValid && length ? length : undefined,
      downloadedBytes: 0,
      isDownloading: false,
      isFullyCached: false,
      updatedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    index.entries[trackId] = updated;
    index.totalBytes = isValid && length ? currentTotal + length : currentTotal;
    await saveAudioCacheIndex(index);
  }

  return {
    url: proxyResult.url,
    cacheInfo: {
      percentage: 1,
      fileSize: 0,
      totalFileSize: isValid && length ? toMB(length) : undefined,
      isFullyCached: false,
      isDownloading: true,
    },
  };
}

export async function getAudioCacheInfo(
  trackId: string
): Promise<AudioCacheInfo> {
  try {
    const manager = AudioStreamManager.getInstance();
    return await manager.getCacheInfo(trackId);
  } catch (error) {}
  const index = await loadAudioCacheIndex();
  const entry = index.entries[trackId];
  if (!entry) {
    return {
      percentage: 0,
      fileSize: 0,
      totalFileSize: 0,
      isFullyCached: false,
      isDownloading: false,
    };
  }

  return {
    percentage: entry.isFullyCached
      ? 100
      : entry.estimatedSizeBytes && entry.downloadedBytes
        ? Math.min(
            99,
            Math.max(
              1,
              Math.round(
                (entry.downloadedBytes / entry.estimatedSizeBytes) * 100
              )
            )
          )
        : 1,
    fileSize: entry.isFullyCached
      ? toMB(entry.sizeBytes)
      : toMB(entry.downloadedBytes || 0),
    totalFileSize:
      entry.estimatedSizeBytes || entry.sizeBytes
        ? toMB(entry.estimatedSizeBytes || entry.sizeBytes)
        : undefined,
    isFullyCached: entry.isFullyCached,
    isDownloading: entry.isDownloading,
  };
}

export async function getFullyCachedAudioUrl(
  trackId: string
): Promise<string | null> {
  if (!trackId) {
    return null;
  }

  return AudioStreamManager.getInstance().getFullCachedFilePath(trackId);
}

export async function markAudioCacheComplete(trackId: string): Promise<void> {
  const index = await loadAudioCacheIndex();
  const entry = index.entries[trackId];
  if (!entry) {
    return;
  }
  index.entries[trackId] = {
    ...entry,
    isDownloading: false,
    isFullyCached: true,
    estimatedSizeBytes: entry.sizeBytes || entry.estimatedSizeBytes,
    downloadedBytes: entry.sizeBytes || entry.downloadedBytes || 0,
    updatedAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  await saveAudioCacheIndex(index);
}

export async function clearAudioCacheForTrack(trackId: string): Promise<void> {
  try {
    await AudioStreamManager.getInstance().cleanupTrackCache(trackId);
  } catch {}

  const index = await loadAudioCacheIndex();
  const entry = index.entries[trackId];
  if (entry) {
    const nextTotal = Math.max(0, index.totalBytes - entry.sizeBytes);
    const { [trackId]: _removed, ...rest } = index.entries;
    index.entries = rest;
    index.totalBytes = nextTotal;
    await saveAudioCacheIndex(index);
  }
}
