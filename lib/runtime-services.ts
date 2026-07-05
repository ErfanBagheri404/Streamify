import {
  getCachedRuntimeConfigSnapshot,
  getRuntimeConfig,
  type StreamifyRuntimeConfig,
} from "./runtime-config";

export type RuntimeServiceConfig = {
  search: {
    jiosaavnSearchFallbackUrl: string;
  };
  audio: {
    corsProxyBases: string[];
    youtubeMusicExtractionEndpoints: string[];
    spotifySearchProxyBase: string;
  };
  web: {
    fallbackUrl: string;
    hyperpipeInstances: string[];
  };
};

function createEmptyRuntimeServiceConfig(): RuntimeServiceConfig {
  return {
    search: {
      jiosaavnSearchFallbackUrl: "",
    },
    audio: {
      corsProxyBases: [],
      youtubeMusicExtractionEndpoints: [],
      spotifySearchProxyBase: "",
    },
    web: {
      fallbackUrl: "",
      hyperpipeInstances: [],
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(
  source: Record<string, unknown> | null,
  key: string
): string {
  const value = source?.[key];
  return typeof value === "string" ? value.trim().replace(/\/+$/g, "") : "";
}

function readStringArray(
  source: Record<string, unknown> | null,
  key: string
): string[] {
  const value = source?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeRuntimeServiceConfig(
  runtimeConfig: StreamifyRuntimeConfig | null
): RuntimeServiceConfig {
  const empty = createEmptyRuntimeServiceConfig();
  const extra = asRecord(runtimeConfig?.extra);
  const services = asRecord(extra?.services);
  const search = asRecord(services?.search);
  const audio = asRecord(services?.audio);
  const web = asRecord(services?.web);

  return {
    search: {
      jiosaavnSearchFallbackUrl:
        readString(search, "jiosaavnSearchFallbackUrl") ||
        empty.search.jiosaavnSearchFallbackUrl,
    },
    audio: {
      corsProxyBases:
        readStringArray(audio, "corsProxyBases") || empty.audio.corsProxyBases,
      youtubeMusicExtractionEndpoints:
        readStringArray(audio, "youtubeMusicExtractionEndpoints") ||
        empty.audio.youtubeMusicExtractionEndpoints,
      spotifySearchProxyBase:
        readString(audio, "spotifySearchProxyBase") ||
        empty.audio.spotifySearchProxyBase,
    },
    web: {
      fallbackUrl: readString(web, "fallbackUrl") || empty.web.fallbackUrl,
      hyperpipeInstances:
        readStringArray(web, "hyperpipeInstances") ||
        empty.web.hyperpipeInstances,
    },
  };
}

export async function getCachedRuntimeServiceConfigSnapshot() {
  return mergeRuntimeServiceConfig(await getCachedRuntimeConfigSnapshot());
}

export async function getRuntimeServiceConfig(options?: {
  revalidate?: boolean;
}) {
  try {
    return mergeRuntimeServiceConfig(await getRuntimeConfig(options));
  } catch {
    return getCachedRuntimeServiceConfigSnapshot();
  }
}
