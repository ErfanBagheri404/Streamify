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

  // Hardcoded Client ID from your logs
  private readonly SOUNDCLOUD_CLIENT_ID = "gqKBMSuBw5rbN9rDRYPqKNvF17ovlObu";

  constructor() {
    this.setupProxyRotation();
    this.setupFallbackStrategies();
    // Don't start health checks initially - they'll be started when needed
    // this.startInstanceHealthChecking();
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
        `[AudioStreamManager] Trying URL modification for audio extraction`
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

        console.log(`[AudioStreamManager] Testing modified URL`);

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
          console.log(`[AudioStreamManager] Found working modified audio URL`);
          return modifiedUrl;
        }
      } catch (error) {
        console.warn(`[AudioStreamManager] URL modification failed:`, error);
      }

      // Method 3: Last resort - return the original URL with audio extraction hint
      // The player will need to handle video streams that contain audio
      console.warn(
        `[AudioStreamManager] All audio extraction methods failed, returning original stream URL with audio hint`
      );

      // Add a query parameter to indicate this is an audio extraction request
      // This helps the player understand it should extract audio from the video stream
      const audioExtractionUrl = `${videoUrl}&audio_only=true&extract_audio=1`;

      // Log for debugging
      console.log(
        `[AudioStreamManager] Returning URL with audio extraction hint`
      );

      return audioExtractionUrl;
    } catch (error) {
      console.error(`[AudioStreamManager] Audio extraction failed:`, error);

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
    return this.soundCloudCache.has(trackId + "_has_full");
  }

  /**
   * Get the best available cached file path for a track
   */
  public getBestCachedFilePath(trackId: string): string | null {
    // Check if we have a full file available
    const fullFilePath = this.soundCloudCache.get(trackId + "_full");
    if (fullFilePath) {
      return fullFilePath;
    }

    // Fall back to partial cache
    return this.soundCloudCache.get(trackId) || null;
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
      for (const [id, filePath] of this.soundCloudCache.entries()) {
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
      // The cached path already includes file:// prefix, return it directly
      return cachedPath;
    }

    // Start background caching with a timeout to wait for quick cache completion
    const cachePromise = this.cacheSoundCloudStreamAsync(
      streamUrl,
      trackId,
      controller
    );

    // Wait for cache to complete, but with a short timeout to avoid blocking playback
    const cacheTimeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => {
        // If cache is ready, use it, otherwise fall back to original URL
        if (this.soundCloudCache.has(trackId)) {
          const cachedPath = this.soundCloudCache.get(trackId)!;
          console.log(
            `[Audio] Cache ready quickly, using cached file for track: ${trackId}`
          );
          // The cached path already includes file:// prefix, return it directly
          resolve(cachedPath);
        } else {
          console.log(
            `[Audio] Cache not ready quickly, using original stream for track: ${trackId}`
          );
          resolve(streamUrl);
        }
      }, 2000); // Wait up to 2 seconds for cache to be ready
    });

    // Race between cache completion and timeout
    const result = await Promise.race([
      cachePromise.then((cachedFilePath) => {
        console.log(
          `[Audio] Cache completed, using cached file: ${cachedFilePath}`
        );
        // The cached file path already includes file:// prefix, return it directly
        return cachedFilePath;
      }),
      cacheTimeoutPromise,
    ]);

    return result;
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

        // Replace the partial cache with the full file for future plays
        this.soundCloudCache.set(trackId + "_full", cacheFilePath + ".full");

        // Also update the main cache entry to point to the full file
        // This ensures subsequent plays use the complete file
        const fullFileInfo = await FileSystem.getInfoAsync(
          cacheFilePath + ".full"
        );
        if (fullFileInfo.exists && fullFileInfo.size > 1048576) {
          // Only replace if full file is actually larger
          console.log(
            `[Audio] Replacing partial cache with full file for track: ${trackId}`
          );
          this.soundCloudCache.set(trackId, cacheFilePath + ".full");

          // Also update the cache to mark this track as having a full file available
          this.soundCloudCache.set(trackId + "_has_full", "true");
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
      // Don't throw - this is background optimization
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

      // Replace the original cache with our enhanced file
      if (totalDownloaded > 5242880) {
        console.log(
          `[Audio] Replacing cache with enhanced file (${totalDownloaded} bytes) for track: ${trackId}`
        );
        await FileSystem.moveAsync({
          from: tempFilePath,
          to: cacheFilePath,
        });

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
      // Don't throw - this is background optimization
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
      return cachedPath;
    }

    console.log(
      `[Audio] Background caching first 5MB of SoundCloud stream for track: ${trackId}`
    );

    try {
      // Create cache directory if it doesn't exist
      const cacheDir = `${FileSystem.cacheDirectory}soundcloud-cache/`;
      await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });

      const cacheFilePath = `${cacheDir}${trackId}.mp3`;

      // Check if we have a full file available first
      const fullFilePath = cacheFilePath + ".full";
      const fullFileInfo = await FileSystem.getInfoAsync(fullFilePath);
      if (fullFileInfo.exists && fullFileInfo.size > 5242880) {
        console.log(
          `[Audio] Using existing full cached file for track: ${trackId}`
        );
        this.soundCloudCache.set(trackId, fullFilePath);
        return fullFilePath; // Return the full cached file path
      }

      // Check if partial file exists
      const fileInfo = await FileSystem.getInfoAsync(cacheFilePath);
      if (fileInfo.exists) {
        console.log(
          `[Audio] Using existing partial cached file for track: ${trackId}`
        );
        this.soundCloudCache.set(trackId, cacheFilePath);
        return cacheFilePath; // Return the cached file path
      }

      // Download the first 5MB (5 * 1024 * 1024 bytes) of the stream
      // This is larger than the original 1MB to prevent early cutouts
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
      return cacheFilePath;
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
          throw new Error(`Rate limited (429): Too many requests`);
        } else if (response.status === 503) {
          throw new Error(
            `Service unavailable (503): Instance may be overloaded`
          );
        } else if (response.status === 502) {
          throw new Error(`Bad gateway (502): Instance proxy error`);
        } else if (response.status === 404) {
          throw new Error(`Not found (404): Resource not available`);
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
            `[AudioStreamManager] Found audio via Invidious adaptiveFormats`
          );
          return audioUrl;
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
          console.log(`[AudioStreamManager] Found audio via formatStreams`);
          return audioUrl;
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
            `[AudioStreamManager] Found video stream with audio via formatStreams`
          );
          return audioUrl;
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
            `[AudioStreamManager] Using video stream for audio extraction via formatStreams`
          );
          return audioUrl;
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
          `[AudioStreamManager] Found direct audio URL via Invidious`
        );
        return audioUrl;
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
            `[AudioStreamManager] Converting video stream to MP3 format`
          );
          return await this.convertStreamToMP3(streamUrl, videoId);
        }
      }

      throw new Error("No audio formats found in response");
    } catch (error) {
      console.warn(`Invidious failed:`, error);
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

  // Cleanup method
  public async cleanup() {
    // Clean up SoundCloud cached files to prevent storage leaks
    for (const filePath of this.soundCloudCache.values()) {
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
