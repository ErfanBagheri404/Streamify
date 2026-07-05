const YOUTUBE_IMAGE_BASE = "https://i.ytimg.com";
const WSRV_BASE = "https://wsrv.nl/";
const DEFAULT_YOUTUBE_THUMBNAIL_VARIANT = "hqdefault.jpg";

type YouTubeThumbnailOutput =
  | "jpg"
  | "jxl"
  | "png"
  | "gif"
  | "tiff"
  | "webp"
  | "json";

function cleanValue(value: string | null | undefined): string {
  return (value || "").trim().replace(/^["'`]+|["'`]+$/g, "");
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.match(/(\d+)/);
    if (match) {
      return Number(match[1]);
    }
  }

  return 0;
}

function scoreImageCandidate(value: unknown): number {
  if (!value || typeof value !== "object") {
    return 0;
  }

  const record = value as Record<string, unknown>;
  const width = toNumber(record.width);
  const height = toNumber(record.height);
  const quality = toNumber(record.quality || record.size);
  return width * height + quality;
}

export function extractYouTubeVideoId(
  value: string | null | undefined
): string {
  const rawValue = cleanValue(value);
  if (!rawValue) {
    return "";
  }

  const thumbnailMatch = rawValue.match(/\/vi(?:_webp)?\/([^/?#]+)\//i);
  if (thumbnailMatch?.[1]) {
    return decodeURIComponent(thumbnailMatch[1]);
  }

  const watchMatch = rawValue.match(/[?&]v=([^&]+)/i);
  if (watchMatch?.[1]) {
    return decodeURIComponent(watchMatch[1]);
  }

  const shortMatch = rawValue.match(/youtu\.be\/([^/?#]+)/i);
  if (shortMatch?.[1]) {
    return decodeURIComponent(shortMatch[1]);
  }

  const embedMatch = rawValue.match(/\/embed\/([^/?#]+)/i);
  if (embedMatch?.[1]) {
    return decodeURIComponent(embedMatch[1]);
  }

  if (/^[a-zA-Z0-9_-]{6,}$/.test(rawValue)) {
    return rawValue;
  }

  return "";
}

export function buildYouTubeThumbnailUrl(
  videoId: string,
  variant = DEFAULT_YOUTUBE_THUMBNAIL_VARIANT,
  useWebp = false
): string {
  const thumbnailPath = useWebp ? "vi_webp" : "vi";
  return `${YOUTUBE_IMAGE_BASE}/${thumbnailPath}/${encodeURIComponent(
    videoId
  )}/${variant}`;
}

function extractYouTubeThumbnailDetails(value: string): {
  variant?: string;
  useWebp: boolean;
} {
  const rawValue = cleanValue(value);
  const match = rawValue.match(
    /\/(vi|vi_webp)\/[^/?#]+\/([^/?#]+(?:\.[a-z0-9]+)?)/i
  );

  if (!match) {
    return { useWebp: false };
  }

  return {
    variant: match[2] || undefined,
    useWebp: match[1]?.toLowerCase() === "vi_webp",
  };
}

function normalizePositiveInt(value: number | null | undefined): string | null {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return null;
  }

  return String(Math.floor(value));
}

function normalizeQuality(value: number | null | undefined): string | null {
  if (!Number.isFinite(value) || !value) {
    return null;
  }

  const quality = Math.max(1, Math.min(100, Math.round(value)));
  return String(quality);
}

function buildWsrvUrl(
  url: string,
  options?: {
    width?: number;
    height?: number;
    fit?: string;
    alignment?: string;
    trim?: string | number;
    output?: YouTubeThumbnailOutput;
    quality?: number;
  }
): string {
  const params = new URLSearchParams({
    url,
  });

  const width = normalizePositiveInt(options?.width);
  const height = normalizePositiveInt(options?.height);
  const quality = normalizeQuality(options?.quality);

  if (width) {
    params.set("w", width);
  }
  if (height) {
    params.set("h", height);
  }
  if (options?.fit?.trim()) {
    params.set("fit", options.fit.trim());
  }
  if (options?.alignment?.trim()) {
    params.set("a", options.alignment.trim());
  }
  if (options?.trim != null && String(options.trim).trim()) {
    params.set("trim", String(options.trim).trim());
  }
  if (options?.output?.trim()) {
    params.set("output", options.output.trim());
  }
  if (quality) {
    params.set("q", quality);
  }

  return `${WSRV_BASE}?${params.toString()}`;
}

export function buildProxiedYouTubeThumbnailUrl(input: {
  url?: string | null;
  videoId?: string | null;
  variant?: string;
}): string | undefined {
  const cleanedUrl = cleanValue(input.url);
  const videoId =
    extractYouTubeVideoId(input.videoId) || extractYouTubeVideoId(cleanedUrl);

  if (!videoId) {
    return undefined;
  }

  const thumbnailDetails = extractYouTubeThumbnailDetails(cleanedUrl);
  return buildWsrvUrl(
    buildYouTubeThumbnailUrl(
      videoId,
      input.variant ||
        thumbnailDetails.variant ||
        DEFAULT_YOUTUBE_THUMBNAIL_VARIANT,
      thumbnailDetails.useWebp
    )
  );
}

export function normalizeYouTubeThumbnailUrl(input: {
  url?: string | null;
  videoId?: string | null;
  variant?: string;
  width?: number;
  height?: number;
  fit?: string;
  alignment?: string;
  trim?: string | number;
  output?: YouTubeThumbnailOutput;
  quality?: number;
}): string | undefined {
  const cleanedUrl = cleanValue(input.url);
  const videoId =
    extractYouTubeVideoId(input.videoId) || extractYouTubeVideoId(cleanedUrl);

  if (!videoId) {
    return cleanedUrl || undefined;
  }

  const thumbnailDetails = extractYouTubeThumbnailDetails(cleanedUrl);
  return buildWsrvUrl(
    buildYouTubeThumbnailUrl(
      videoId,
      input.variant ||
        thumbnailDetails.variant ||
        DEFAULT_YOUTUBE_THUMBNAIL_VARIANT,
      thumbnailDetails.useWebp
    ),
    {
      width: input.width,
      height: input.height,
      fit: input.fit,
      alignment: input.alignment,
      trim: input.trim,
      output: input.output,
      quality: input.quality,
    }
  );
}

function upgradeYouTubeImage(url: string): string {
  if (!url) {
    return "";
  }

  let nextUrl = url;

  if (/(^|\/)(default|mqdefault|sddefault|hqdefault)\.(jpg|jpeg|webp)/i.test(nextUrl)) {
    nextUrl = nextUrl.replace(
      /(^|\/)(default|mqdefault|sddefault|hqdefault)\.(jpg|jpeg|webp)/i,
      "$1hqdefault.$3"
    );
  }

  if (nextUrl.includes("googleusercontent.com")) {
    nextUrl = nextUrl.replace(/=s\d+[^&]*/i, "=s720-c-k-c0x00ffffff-no-rj");
  }

  return nextUrl;
}

function upgradeJioSaavnImage(url: string): string {
  if (!url) {
    return "";
  }

  return url
    .replace(/150x150/gi, "500x500")
    .replace(/50x50/gi, "500x500")
    .replace(/-150x150/gi, "-500x500")
    .replace(/-50x50/gi, "-500x500");
}

export function absolutizeImageUrl(url: string, base?: string): string {
  if (!url) {
    return "";
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("/")) {
    if (url.startsWith("/vi/") || url.startsWith("/vi_webp/")) {
      return `https://i.ytimg.com${url}`;
    }

    if (url.includes("googleusercontent.com") || url.includes("yt3")) {
      return `https://yt3.googleusercontent.com${url}`;
    }

    if (base) {
      try {
        return new URL(url, `${base.replace(/\/+$/g, "")}/`).toString();
      } catch {
        return url;
      }
    }
  }

  if (!base) {
    return url;
  }

  try {
    return new URL(url, `${base.replace(/\/+$/g, "")}/`).toString();
  } catch {
    return url;
  }
}

export function upgradeSoundCloudImage(url: string): string {
  if (!url) {
    return "";
  }

  return url
    .replace("-large.", "-t500x500.")
    .replace("large.jpg", "t500x500.jpg")
    .replace("large.png", "t500x500.png");
}

export function sanitizeImageUrl(url: string, base?: string): string {
  const normalized = absolutizeImageUrl(url, base).trim();
  if (!normalized) {
    return "";
  }

  if (normalized.includes("ytimg.com") || normalized.includes("youtube.com")) {
    return buildProxiedYouTubeThumbnailUrl({ url: normalized }) || normalized;
  }

  if (normalized.includes("googleusercontent.com")) {
    return upgradeYouTubeImage(normalized);
  }

  if (
    normalized.includes("sndcdn.com") ||
    normalized.includes("soundcloud.com")
  ) {
    return upgradeSoundCloudImage(normalized);
  }

  if (normalized.includes("saavncdn.com") || normalized.includes("jiosaavn.com")) {
    return upgradeJioSaavnImage(normalized);
  }

  return normalized;
}

export function hasUsableImageUrl(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function pickBestImageUrl(value: unknown, base?: string): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return sanitizeImageUrl(value, base);
  }

  if (Array.isArray(value)) {
    const sorted = [...value].sort(
      (left, right) => scoreImageCandidate(right) - scoreImageCandidate(left)
    );

    for (const entry of sorted) {
      if (typeof entry === "string") {
        const directUrl = sanitizeImageUrl(entry, base);
        if (directUrl) {
          return directUrl;
        }
        continue;
      }

      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const candidateUrl = [
          record.url,
          record.link,
          record.src,
          record.thumbnail,
          record.thumbnailUrl,
        ].find((candidate) => typeof candidate === "string" && candidate.trim());

        if (typeof candidateUrl === "string") {
          const normalizedUrl = sanitizeImageUrl(candidateUrl, base);
          if (normalizedUrl) {
            return normalizedUrl;
          }
        }
      }
    }

    return "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedCollections = [
      record.authorThumbnails,
      record.videoThumbnails,
      record.thumbnails,
      record.image,
      record.images,
    ];

    for (const nestedValue of nestedCollections) {
      const nestedUrl = pickBestImageUrl(nestedValue, base);
      if (nestedUrl) {
        return nestedUrl;
      }
    }

    const directUrl = [
      record.thumbnailUrl,
      record.thumbnail,
      record.coverUrl,
      record.artwork_url,
      record.artwork,
      record.avatar_url,
      (record.user as Record<string, unknown> | undefined)?.avatar_url,
      record.imageUrl,
      record.url,
    ].find((candidate) => typeof candidate === "string" && candidate.trim());

    if (typeof directUrl === "string") {
      return sanitizeImageUrl(directUrl, base);
    }
  }

  return "";
}

export function generateImageUrl(
  id: string,
  res: "mq" | "hq" = "mq",
  music: string = "",
): string {
  if (id.startsWith("/")) {
    return `https://yt3.googleusercontent.com${id}=s720-c-k-c0x00ffffff-no-rj&output=webp&w=${
      res === "mq" ? "180" : "360"
    }`;
  }

  return (
    buildProxiedYouTubeThumbnailUrl({
      videoId: id,
      variant: `${res}default.webp`,
    }) ||
    `https://i.ytimg.com/vi_webp/${id}/${res}default.webp${music}`
  );
}

export function getThumbIdFromLink(url: string): string {
  try {
    if (url.startsWith("/vi_webp")) {
      return url.slice(9, 20);
    }
    if (url.startsWith("/") || url.length === 11) {
      return url;
    }
    const l = new URL(url);
    const p = l.pathname;
    return l.search.includes("ytimg") ? p.split("/")[2] : p.split("=")[0];
  } catch {
    return url;
  }
}
