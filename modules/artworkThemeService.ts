import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import UPNG from "upng-js";
import {
  deriveArtworkSeed,
  extractDominantColor,
  type ArtworkThemeSeed,
  type Rgb,
} from "./artworkTheme";

/**
 * Artwork-driven theme: the platform half.
 *
 * Pipeline: resolve the artwork to a local file, shrink it to a 4x4 PNG in
 * native code, decode those 16 pixels in JS, hand them to the pure module.
 *
 * No androidx.palette and no new dependency — `expo-image-manipulator`,
 * `expo-file-system` and `upng-js` are all already in package.json.
 *
 * 4x4 is deliberate: native does the decode, 16 pixels cross the bridge, and
 * that is plenty to tint a UI.
 */

const SAMPLE_SIZE = 4;
const MAX_CACHE_ENTRIES = 24;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_DIR = `${FileSystem.cacheDirectory ?? ""}Streamify/artwork-samples/`;

interface CacheEntry {
  seed: ArtworkThemeSeed;
  expiresAt: number;
}

const seedCache = new Map<string, CacheEntry>();

function pruneCache(now: number): void {
  seedCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      seedCache.delete(key);
    }
  });
  // Map preserves insertion order, so the first key is the oldest.
  while (seedCache.size > MAX_CACHE_ENTRIES) {
    const oldest = seedCache.keys().next();
    if (oldest.done) {
      break;
    }
    seedCache.delete(oldest.value);
  }
}

/** A stable, filesystem-safe name per artwork URL. */
function sampleFileName(uri: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uri.length; i += 1) {
    hash ^= uri.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}.png`;
}

/**
 * expo-image-manipulator only reads local files, so a remote thumbnail has to
 * be fetched first. Downloads land in the cache directory (not document) so
 * the OS can reclaim them.
 */
async function ensureLocalFile(uri: string): Promise<string | null> {
  if (uri.startsWith("file://") || uri.startsWith("/")) {
    return uri;
  }
  if (!/^https?:\/\//i.test(uri)) {
    return null;
  }
  const target = `${DOWNLOAD_DIR}${sampleFileName(uri)}`;
  try {
    const info = await FileSystem.getInfoAsync(target);
    if (info.exists && typeof info.size === "number" && info.size > 0) {
      return target;
    }
    await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
    const result = await FileSystem.downloadAsync(uri, target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

export interface ArtworkThemeRequest {
  /** Local `file://` path or remote URL of the artwork. */
  uri: string;
  isLightTheme: boolean;
}

export async function deriveSeedFromArtwork({
  uri,
  isLightTheme,
}: ArtworkThemeRequest): Promise<ArtworkThemeSeed | null> {
  if (!uri) {
    return null;
  }
  const now = Date.now();
  pruneCache(now);
  const cached = seedCache.get(uri);
  if (cached) {
    return cached.seed;
  }

  try {
    const localUri = await ensureLocalFile(uri);
    if (!localUri) {
      return null;
    }
    const context = ImageManipulator.ImageManipulator.manipulate(localUri);
    context.resize({ width: SAMPLE_SIZE, height: SAMPLE_SIZE });
    const ref = await context.renderAsync();
    const result = await ref.saveAsync({
      compress: 1,
      format: ImageManipulator.SaveFormat.PNG,
      base64: true,
    });
    if (!result.base64) {
      return null;
    }
    const pixels = decodePngPixels(base64ToBytes(result.base64));
    if (!pixels.length) {
      return null;
    }
    const seed = deriveArtworkSeed(extractDominantColor(pixels), isLightTheme);
    seedCache.set(uri, { seed, expiresAt: now + CACHE_TTL_MS });
    return seed;
  } catch (error) {
    // A failed theme is never worth breaking playback over: the caller falls
    // back to the selected palette.
    console.warn("[ArtworkTheme] extraction failed:", error);
    return null;
  }
}

function base64ToBytes(base64: string): number[] {
  const sanitized = base64.includes(",")
    ? base64.slice(base64.indexOf(",") + 1)
    : base64;
  const binary =
    typeof atob === "function"
      ? atob(sanitized)
      : Buffer.from(sanitized, "base64").toString("binary");
  const bytes: number[] = [];
  for (let i = 0; i < binary.length; i += 1) {
    bytes.push(binary.charCodeAt(i));
  }
  return bytes;
}

/** upng-js decodes to RGBA8 whatever the source colour type, so the channel
 * handling lives here once instead of at every call site. */
function decodePngPixels(bytes: number[]): Rgb[] {
  // UPNG.decode wraps the buffer in a plain Uint8Array, so no alignment
  // padding is needed: Uint8Array.from always allocates a fresh buffer.
  const decoded = UPNG.decode(Uint8Array.from(bytes).buffer as ArrayBuffer);
  const frames = UPNG.toRGBA8(decoded);
  if (!frames || !frames.length) {
    return [];
  }
  const rgba = new Uint8Array(frames[0]);
  const pixels: Rgb[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    // Fully transparent pixels carry no colour worth sampling.
    if (rgba[i + 3] === 0) {
      continue;
    }
    pixels.push({ r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] });
  }
  return pixels;
}

export function clearArtworkThemeCache(): void {
  seedCache.clear();
}
