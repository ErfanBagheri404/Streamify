type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

function cleanUrl(value: string | undefined | null): string {
  return value?.trim().replace(/\/+$/, "") || "";
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
}

function parseBaseUrls(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return dedupeStrings(
    value
      .split(",")
      .map((entry) => cleanUrl(entry))
      .filter(Boolean),
  );
}

const DEFAULT_BACKEND_BASE_URLS = [
  "https://helloify-api.hf.space",
  "https://api.streamify.workers.dev",
];

const DEFAULT_BACKEND_REQUEST_ORIGIN = "https://streamify-player.vercel.app";
const DEFAULT_BACKEND_REQUEST_REFERER = `${DEFAULT_BACKEND_REQUEST_ORIGIN}/`;

export function getBackendBaseUrls(): string[] {
  const envUrls = parseBaseUrls(
    process.env.EXPO_PUBLIC_STREAMIFY_API_BASE_URL ||
      process.env.EXPO_PUBLIC_API_BASE_URL,
  );

  return envUrls.length > 0 ? envUrls : DEFAULT_BACKEND_BASE_URLS;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/";
  }

  return `/${trimmed.replace(/^\/+/, "")}`;
}

function appendSearchParams(
  value: string,
  searchParams?: URLSearchParams | Record<string, QueryValue>,
): string {
  if (!searchParams) {
    return value;
  }

  const url = new URL(value);
  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((paramValue, key) => {
      url.searchParams.append(key, paramValue);
    });
    return url.toString();
  }

  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (rawValue == null || rawValue === "") {
      continue;
    }

    if (Array.isArray(rawValue)) {
      rawValue.forEach((entry) => {
        if (entry == null || entry === "") {
          return;
        }

        url.searchParams.append(key, String(entry));
      });
      continue;
    }

    url.searchParams.set(key, String(rawValue));
  }

  return url.toString();
}

export function buildBackendRouteUrlCandidates(
  path: string,
  searchParams?: URLSearchParams | Record<string, QueryValue>,
): string[] {
  const normalizedPath = normalizePath(path);
  return getBackendBaseUrls().map((baseUrl) =>
    appendSearchParams(`${baseUrl}${normalizedPath}`, searchParams),
  );
}

function shouldRetryResponse(response: Response): boolean {
  return (
    response.status >= 500 ||
    response.status === 403 ||
    response.status === 404 ||
    response.status === 429
  );
}

function withDefaultBackendHeaders(
  init?: RequestInit,
): RequestInit | undefined {
  const headers = new Headers(init?.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  // Mobile/native requests do not always send browser-style origin metadata,
  // but the hosted Streamify backends require an approved origin or referer.
  if (!headers.has("Origin")) {
    headers.set("Origin", DEFAULT_BACKEND_REQUEST_ORIGIN);
  }
  if (!headers.has("Referer")) {
    headers.set("Referer", DEFAULT_BACKEND_REQUEST_REFERER);
  }

  return {
    ...init,
    headers,
  };
}

export async function fetchBackendRoute(
  path: string,
  options?: {
    searchParams?: URLSearchParams | Record<string, QueryValue>;
    init?: RequestInit;
  },
): Promise<Response> {
  const candidates = buildBackendRouteUrlCandidates(
    path,
    options?.searchParams,
  );
  const init = withDefaultBackendHeaders(options?.init);
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    try {
      const response = await fetch(candidate, init);
      const hasNextCandidate = index < candidates.length - 1;

      if (!response.ok && hasNextCandidate && shouldRetryResponse(response)) {
        lastResponse = response;
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (index >= candidates.length - 1) {
        break;
      }
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No backend candidates succeeded for ${path}`);
}
