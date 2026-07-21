import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface StreamifyRuntimeConfig {
  app?: {
    name?: string;
    env?: string;
    version?: string;
    updatedAt?: string;
    siteUrl?: string;
    origin?: string;
  };
  instances?: {
    client?: {
      piped?: string[];
      invidious?: string[];
    };
    server?: {
      localProxyBase?: string;
      localExpressApiUrl?: string;
      localAllowedClientOrigin?: string;
    };
  };
  providers?: {
    search?: {
      ytifyInstance?: string;
      searchBackendUrl?: string;
      soundcloudSearchProxyBase?: string;
    };
    jiosaavn?: {
      apiBase?: string;
      fallbackSearchBase?: string;
      webOrigin?: string;
    };
    beatseek?: {
      apiBase?: string;
    };
    lyrics?: {
      lrclibBase?: string;
      lyricsOvhBase?: string;
    };
    soundcloud?: {
      origin?: string;
      mobileOrigin?: string;
      apiBase?: string;
      apiV2Base?: string;
      widgetBase?: string;
      licenseBase?: string;
      oembedBase?: string;
    };
    youtube?: {
      webBase?: string;
      musicBase?: string;
      oembedBase?: string;
      imageBase?: string;
    };
    supabase?: {
      url?: string;
    };
    mobile?: {
      androidAppUrl?: string;
    };
  };
  headers?: {
    origins?: Record<string, string | undefined>;
    referers?: Record<string, string | undefined>;
  };
  curated?: {
    categoryPlaylists?: Array<Record<string, unknown>>;
  };
  extra?: Record<string, unknown>;
}

type RuntimeConfigCacheRecord = {
  etag?: string;
  payload: StreamifyRuntimeConfig;
  cachedAt: number;
};

const RUNTIME_CONFIG_CACHE_KEY = "@streamify_runtime_config";
const DEFAULT_RUNTIME_CONFIG_URL =
  "https://streamifyinstances.erfannodes.workers.dev/config";
const RUNTIME_CONFIG_TTL_MS = 5 * 60 * 1000;

let memoryCachedRuntimeConfig: RuntimeConfigCacheRecord | null = null;
let runtimeConfigPromise: Promise<StreamifyRuntimeConfig> | null = null;

function getRuntimeClientHeaders(): Record<string, string> {
  const platform = Platform.OS || "unknown";

  return {
    "x-streamify-client-app": "streamify-mobile",
    "x-streamify-client-platform": platform,
  };
}

function getRuntimeConfigUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_STREAMIFY_CONFIG_URL?.trim();
  return fromEnv || DEFAULT_RUNTIME_CONFIG_URL;
}

function isRuntimeConfigFresh(
  cache: RuntimeConfigCacheRecord | null,
): cache is RuntimeConfigCacheRecord {
  return Boolean(cache && Date.now() - cache.cachedAt < RUNTIME_CONFIG_TTL_MS);
}

async function readCachedRuntimeConfig(): Promise<RuntimeConfigCacheRecord | null> {
  if (memoryCachedRuntimeConfig?.payload) {
    return memoryCachedRuntimeConfig;
  }

  try {
    const raw = await AsyncStorage.getItem(RUNTIME_CONFIG_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as RuntimeConfigCacheRecord;
    memoryCachedRuntimeConfig = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCachedRuntimeConfig(cache: RuntimeConfigCacheRecord) {
  memoryCachedRuntimeConfig = cache;

  try {
    await AsyncStorage.setItem(RUNTIME_CONFIG_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

async function fetchRuntimeConfig(
  cached: RuntimeConfigCacheRecord | null,
): Promise<StreamifyRuntimeConfig> {
  try {
    const response = await fetch(getRuntimeConfigUrl(), {
      headers: {
        Accept: "application/json",
        ...getRuntimeClientHeaders(),
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      },
      cache: "no-store",
    });

    if (response.status === 304 && cached?.payload) {
      await writeCachedRuntimeConfig({
        ...cached,
        cachedAt: Date.now(),
      });
      return cached.payload;
    }

    const payload = (await response.json()) as StreamifyRuntimeConfig & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to load runtime config");
    }

    await writeCachedRuntimeConfig({
      etag: response.headers.get("ETag") || cached?.etag || undefined,
      payload,
      cachedAt: Date.now(),
    });

    return payload;
  } catch (error) {
    if (cached?.payload) {
      return cached.payload;
    }

    throw error;
  }
}

export async function getCachedRuntimeConfigSnapshot() {
  return (await readCachedRuntimeConfig())?.payload || null;
}

export async function getRuntimeConfig(options?: {
  revalidate?: boolean;
}): Promise<StreamifyRuntimeConfig> {
  const cached = await readCachedRuntimeConfig();

  if (cached?.payload && !options?.revalidate && isRuntimeConfigFresh(cached)) {
    return cached.payload;
  }

  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  runtimeConfigPromise = fetchRuntimeConfig(cached);

  try {
    return await runtimeConfigPromise;
  } finally {
    runtimeConfigPromise = null;
  }
}

export async function primeRuntimeConfig(): Promise<StreamifyRuntimeConfig> {
  const cached = await readCachedRuntimeConfig();
  if (cached?.payload) {
    return cached.payload;
  }

  return getRuntimeConfig();
}
