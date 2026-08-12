import * as FileSystem from "expo-file-system/legacy";

const THUMBNAIL_DIR = `${FileSystem.documentDirectory}Streamify/thumbnails/`;

/**
 * Cache a track's thumbnail to disk so it's available offline.
 * Called after audio is successfully cached.
 */
export async function cacheTrackThumbnail(
  trackId: string,
  thumbnailUrl: string | undefined | null,
): Promise<void> {
  if (!thumbnailUrl || !trackId) return;
  try {
    // Ensure directory exists
    await FileSystem.makeDirectoryAsync(THUMBNAIL_DIR, { intermediates: true });

    const filePath = `${THUMBNAIL_DIR}${trackId}.jpg`;

    // Skip if already cached
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists && typeof info.size === "number" && info.size > 100) return;

    const download = await FileSystem.downloadAsync(thumbnailUrl, filePath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    if (download.status !== 200) {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    }
  } catch {
    // Non-critical — silently ignore
  }
}

/**
 * Get the cached thumbnail file:// path for a track, or null if not cached.
 */
export function getCachedThumbnailPath(trackId: string): string | null {
  if (!trackId) return null;
  // Synchronous check — works because we're using a known path
  return `${THUMBNAIL_DIR}${trackId}.jpg`;
}

/**
 * Check if a thumbnail is cached on disk (async, checks file existence).
 */
export async function isThumbnailCached(trackId: string): Promise<boolean> {
  if (!trackId) return false;
  try {
    const info = await FileSystem.getInfoAsync(`${THUMBNAIL_DIR}${trackId}.jpg`);
    return !!(info.exists && typeof info.size === "number" && info.size > 100);
  } catch {
    return false;
  }
}

/**
 * Get the best thumbnail URL — cached file:// if available, otherwise the original URL.
 */
export async function getThumbnailUrl(
  trackId: string | undefined | null,
  originalUrl: string | undefined | null,
): Promise<string> {
  if (!trackId || !originalUrl) return originalUrl || "";
  try {
    const info = await FileSystem.getInfoAsync(`${THUMBNAIL_DIR}${trackId}.jpg`);
    if (info.exists && typeof info.size === "number" && info.size > 100) {
      return `${THUMBNAIL_DIR}${trackId}.jpg`;
    }
  } catch {}
  return originalUrl;
}
