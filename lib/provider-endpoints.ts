import {
  getCachedRuntimeConfigSnapshot,
  getRuntimeConfig,
  type StreamifyRuntimeConfig,
} from "./runtime-config";

export type ProviderEndpoints = {
  instances: {
    piped: string[];
    invidious: string[];
    server: {
      localProxyBase: string;
      localExpressApiUrl: string;
      localAllowedClientOrigin: string;
    };
  };
  providers: {
    search: {
      ytifyInstance: string;
      searchBackendUrl: string;
      soundcloudSearchProxyBase: string;
    };
    jiosaavn: {
      apiBase: string;
      fallbackSearchBase: string;
      webOrigin: string;
    };
    beatseek: {
      apiBase: string;
    };
    lyrics: {
      lrclibBase: string;
      lyricsOvhBase: string;
    };
    soundcloud: {
      origin: string;
      mobileOrigin: string;
      apiBase: string;
      apiV2Base: string;
      widgetBase: string;
      licenseBase: string;
      oembedBase: string;
    };
    youtube: {
      webBase: string;
      musicBase: string;
      oembedBase: string;
      imageBase: string;
    };
  };
  headers: {
    origins: {
      soundcloud: string;
      youtube: string;
      jiosaavn: string;
    };
    referers: {
      soundcloud: string;
      youtube: string;
      jiosaavn: string;
    };
  };
};

export type ProviderQueryValue = string | number | boolean | null | undefined;

function createEmptyProviderEndpoints(): ProviderEndpoints {
  return {
    instances: {
      piped: [],
      invidious: [],
      server: {
        localProxyBase: "",
        localExpressApiUrl: "",
        localAllowedClientOrigin: "",
      },
    },
    providers: {
      search: {
        ytifyInstance: "",
        searchBackendUrl: "",
        soundcloudSearchProxyBase: "",
      },
      jiosaavn: {
        apiBase: "",
        fallbackSearchBase: "",
        webOrigin: "",
      },
      beatseek: {
        apiBase: "",
      },
      lyrics: {
        lrclibBase: "",
        lyricsOvhBase: "",
      },
      soundcloud: {
        origin: "",
        mobileOrigin: "",
        apiBase: "",
        apiV2Base: "",
        widgetBase: "",
        licenseBase: "",
        oembedBase: "",
      },
      youtube: {
        webBase: "",
        musicBase: "",
        oembedBase: "",
        imageBase: "",
      },
    },
    headers: {
      origins: {
        soundcloud: "",
        youtube: "",
        jiosaavn: "",
      },
      referers: {
        soundcloud: "",
        youtube: "",
        jiosaavn: "",
      },
    },
  };
}

function cleanUrl(value: string | undefined): string {
  return value?.trim().replace(/\/+$/g, "") || "";
}

function cleanText(value: string | undefined): string {
  return value?.trim() || "";
}

function cleanUrlList(values: string[] | undefined): string[] {
  return (values || []).map((value) => cleanUrl(value)).filter(Boolean);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function normalizePathVariant(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `/${trimmed.replace(/^\/+/, "")}`;
}

function joinUrlPath(base: string, pathVariant: string): string {
  if (!pathVariant) return cleanUrl(base);

  try {
    const parsed = new URL(base);
    const baseSegments = parsed.pathname.split("/").filter(Boolean);
    const nextSegments = pathVariant.split("/").filter(Boolean);
    let overlap = 0;

    for (
      let size = Math.min(baseSegments.length, nextSegments.length);
      size > 0;
      size -= 1
    ) {
      const baseSuffix = baseSegments.slice(-size).join("/");
      const nextPrefix = nextSegments.slice(0, size).join("/");
      if (baseSuffix.toLowerCase() === nextPrefix.toLowerCase()) {
        overlap = size;
        break;
      }
    }

    parsed.pathname = `/${[
      ...baseSegments,
      ...nextSegments.slice(overlap),
    ].join("/")}`;
    parsed.search = "";
    parsed.hash = "";

    return cleanUrl(parsed.toString());
  } catch {
    return `${cleanUrl(base)}${pathVariant}`;
  }
}

function appendQueryParams(
  value: string,
  query?: Record<string, ProviderQueryValue>
): string {
  if (!query || !value) return value;

  try {
    const parsed = new URL(value);
    for (const [key, rawValue] of Object.entries(query)) {
      if (rawValue == null || rawValue === "") continue;
      parsed.searchParams.set(key, String(rawValue));
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

export function buildProviderUrlCandidates(
  base: string,
  pathVariants: string[] = [],
  query?: Record<string, ProviderQueryValue>
): string[] {
  const normalizedBase = cleanUrl(base);
  if (!normalizedBase) return [];

  const candidates = [
    ...pathVariants.map((pathVariant) =>
      joinUrlPath(normalizedBase, normalizePathVariant(pathVariant))
    ),
    normalizedBase,
  ];

  return dedupeStrings(
    candidates.map((candidate) => appendQueryParams(candidate, query))
  );
}

function mergeProviderEndpoints(
  runtimeConfig: StreamifyRuntimeConfig | null
): ProviderEndpoints {
  const empty = createEmptyProviderEndpoints();
  return {
    instances: {
      piped: cleanUrlList(runtimeConfig?.instances?.client?.piped),
      invidious: cleanUrlList(runtimeConfig?.instances?.client?.invidious),
      server: {
        localProxyBase: cleanUrl(
          runtimeConfig?.instances?.server?.localProxyBase
        ),
        localExpressApiUrl: cleanUrl(
          runtimeConfig?.instances?.server?.localExpressApiUrl
        ),
        localAllowedClientOrigin: cleanUrl(
          runtimeConfig?.instances?.server?.localAllowedClientOrigin
        ),
      },
    },
    providers: {
      search: {
        ytifyInstance: cleanUrl(
          runtimeConfig?.providers?.search?.ytifyInstance
        ),
        searchBackendUrl: cleanUrl(
          runtimeConfig?.providers?.search?.searchBackendUrl
        ),
        soundcloudSearchProxyBase: cleanUrl(
          runtimeConfig?.providers?.search?.soundcloudSearchProxyBase
        ),
      },
      jiosaavn: {
        apiBase: cleanUrl(runtimeConfig?.providers?.jiosaavn?.apiBase),
        fallbackSearchBase: cleanUrl(
          runtimeConfig?.providers?.jiosaavn?.fallbackSearchBase
        ),
        webOrigin: cleanUrl(runtimeConfig?.providers?.jiosaavn?.webOrigin),
      },
      beatseek: {
        apiBase: cleanUrl(runtimeConfig?.providers?.beatseek?.apiBase),
      },
      lyrics: {
        lrclibBase: cleanUrl(runtimeConfig?.providers?.lyrics?.lrclibBase),
        lyricsOvhBase: cleanUrl(
          runtimeConfig?.providers?.lyrics?.lyricsOvhBase
        ),
      },
      soundcloud: {
        origin: cleanUrl(runtimeConfig?.providers?.soundcloud?.origin),
        mobileOrigin: cleanUrl(
          runtimeConfig?.providers?.soundcloud?.mobileOrigin
        ),
        apiBase: cleanUrl(runtimeConfig?.providers?.soundcloud?.apiBase),
        apiV2Base: cleanUrl(runtimeConfig?.providers?.soundcloud?.apiV2Base),
        widgetBase: cleanUrl(runtimeConfig?.providers?.soundcloud?.widgetBase),
        licenseBase: cleanUrl(
          runtimeConfig?.providers?.soundcloud?.licenseBase
        ),
        oembedBase: cleanUrl(runtimeConfig?.providers?.soundcloud?.oembedBase),
      },
      youtube: {
        webBase: cleanUrl(runtimeConfig?.providers?.youtube?.webBase),
        musicBase: cleanUrl(runtimeConfig?.providers?.youtube?.musicBase),
        oembedBase: cleanUrl(runtimeConfig?.providers?.youtube?.oembedBase),
        imageBase: cleanUrl(runtimeConfig?.providers?.youtube?.imageBase),
      },
    },
    headers: {
      origins: {
        soundcloud:
          cleanUrl(runtimeConfig?.headers?.origins?.soundcloud) ||
          empty.headers.origins.soundcloud,
        youtube:
          cleanUrl(runtimeConfig?.headers?.origins?.youtube) ||
          empty.headers.origins.youtube,
        jiosaavn:
          cleanUrl(runtimeConfig?.headers?.origins?.jiosaavn) ||
          empty.headers.origins.jiosaavn,
      },
      referers: {
        soundcloud:
          cleanText(runtimeConfig?.headers?.referers?.soundcloud) ||
          empty.headers.referers.soundcloud,
        youtube:
          cleanText(runtimeConfig?.headers?.referers?.youtube) ||
          empty.headers.referers.youtube,
        jiosaavn:
          cleanText(runtimeConfig?.headers?.referers?.jiosaavn) ||
          empty.headers.referers.jiosaavn,
      },
    },
  };
}

export async function getCachedProviderEndpointsSnapshot() {
  return mergeProviderEndpoints(await getCachedRuntimeConfigSnapshot());
}

export async function getProviderEndpoints(options?: {
  revalidate?: boolean;
}): Promise<ProviderEndpoints> {
  try {
    return mergeProviderEndpoints(await getRuntimeConfig(options));
  } catch {
    return getCachedProviderEndpointsSnapshot();
  }
}
