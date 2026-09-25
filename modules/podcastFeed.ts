/**
 * Podcast subscriptions and episode parsing (#30).
 *
 * Pure part first: RSS is a hostile XML format (namespaces, CDATA, missing
 * tags, byte-vs-text content types), so parsing is isolated here and driven
 * directly by the regression suite. Persistence lives in `utils/storage.ts`
 * (`subscribeToPodcast` / `loadPodcastEpisodes` / `savePodcastEpisodePosition`);
 * the UI reads through it.
 */

import { XMLParser } from "fast-xml-parser";

export type PodcastShow = {
  /** Stable id: hash of the feed URL, so re-subscribing to the same feed is idempotent. */
  id: string;
  feedUrl: string;
  title: string;
  author?: string;
  description?: string;
  artworkUrl?: string;
  /** When the feed itself was last fetched (ms). */
  lastFetchedAt?: number;
  /** Unplayed episode count, cached so the badge survives a cold start. */
  unplayedCount?: number;
};

export type PodcastEpisode = {
  id: string;
  showId: string;
  title: string;
  /** Direct media URL from the RSS enclosure — playback does not need resolving. */
  audioUrl: string;
  publishedAt?: number;
  durationSeconds?: number;
  artworkUrl?: string;
  description?: string;
  /** Resume point in seconds, persisted per episode. */
  positionSeconds?: number;
  played?: boolean;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Feed bodies are untrusted HTML fragments; keep them as text so nothing
  // can turn into markup the app later renders.
  processEntities: false,
  trimValues: true,
});

const asArray = <T,>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

/** RSS text can be a bare string, a CDATA object, or `{ "#text": ... }`. */
function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record["#text"] === "string") return record["#text"].trim() || undefined;
  }
  return undefined;
}

function attrOf(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return typeof value === "string" && value ? value : undefined;
}

/** FNV-1a — short, stable, and no crypto dependency for an id that is not a secret. */
function hashId(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export const podcastShowId = (feedUrl: string): string => hashId(feedUrl.trim());

/** `hh:mm:ss`, `mm:ss`, or a bare number of seconds. */
export function parseDuration(value: unknown): number | undefined {
  const raw = textOf(value);
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return undefined;
}

const MIME_EXTENSIONS: Array<[RegExp, string]> = [
  [/\bmp3\b/i, "mp3"],
  [/\bm4a\b/i, "m4a"],
  [/\baac\b/i, "aac"],
  [/\bogg|opus\b/i, "ogg"],
  [/\bwav\b/i, "wav"],
  [/\bflac\b/i, "flac"],
];

/** Enclosure URL, or undefined when the item has no playable media. */
function enclosureUrl(item: Record<string, unknown>): string | undefined {
  for (const enclosure of asArray(item.enclosure as unknown)) {
    const record = (enclosure ?? {}) as Record<string, unknown>;
    const url = attrOf(record, "url");
    const type = attrOf(record, "type") || "";
    const length = Number(attrOf(record, "length") || 0);
    if (!url) continue;
    // A zero/absent length is normal; a type we cannot play is not.
    if (type && !MIME_EXTENSIONS.some(([pattern]) => pattern.test(type)) && length === 0) {
      continue;
    }
    return url;
  }
  const media = (item.enclosure as Record<string, unknown> | undefined)?.media ?? undefined;
  const mediaContent = asArray(
    (item["media:content"] ?? media) as unknown,
  )[0] as Record<string, unknown> | undefined;
  const mediaUrl = attrOf(mediaContent, "url");
  return mediaUrl || undefined;
}

export type ParsedFeed = {
  show: PodcastShow;
  episodes: PodcastEpisode[];
  /** Items present in the feed that are not playable audio. */
  skippedItems: number;
};

/**
 * Parses an RSS 2.0 or Atom feed. Never throws: a malformed feed returns the
 * best-effort show with zero episodes, so a bad URL cannot crash the screen.
 */
export function parsePodcastFeed(feedUrl: string, xml: string): ParsedFeed {
  const fallbackUrl = feedUrl.trim();
  const showId = podcastShowId(fallbackUrl);

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return {
      show: { id: showId, feedUrl: fallbackUrl, title: fallbackUrl },
      episodes: [],
      skippedItems: 0,
    };
  }

  const rss = (doc.rss ?? {}) as Record<string, unknown>;
  const channel = (rss.channel ?? doc.feed ?? {}) as Record<string, unknown>;

  // iTunes author, or Atom author name.
  const itunesAuthor = textOf(channel["itunes:author"]);
  const atomAuthor = ((channel.author ?? {}) as Record<string, unknown>).name;
  const showArtwork =
    attrOf(channel["itunes:image"], "href") ??
    textOf(channel["itunes:image"] as unknown) ??
    asArray(channel.link as unknown)
      .map((link) => attrOf(link, "href"))
      .find((href) => !!href && /\.(jpe?g|png|webp)(\?|$)/i.test(href));

  const show: PodcastShow = {
    id: showId,
    feedUrl: fallbackUrl,
    title: textOf(channel.title) ?? fallbackUrl,
    author: textOf(itunesAuthor) ?? textOf(atomAuthor as unknown),
    description: textOf(channel.description) ?? textOf(channel.subtitle as unknown),
    artworkUrl: showArtwork,
  };

  const items = [
    ...asArray(channel.item as unknown),
    ...asArray(channel.entry as unknown),
  ] as Array<Record<string, unknown>>;

  const episodes: PodcastEpisode[] = [];
  let skippedItems = 0;

  for (const item of items) {
    const audioUrl = enclosureUrl(item);
    if (!audioUrl) {
      skippedItems += 1;
      continue;
    }
    const guid =
      textOf(item.guid as unknown) ??
      textOf(item.id as unknown) ??
      audioUrl;
    const published =
      textOf(item.pubDate as unknown) ??
      textOf(item.published as unknown) ??
      textOf(item.updated as unknown);
    const parsedTime = published ? Date.parse(published) : Number.NaN;

    episodes.push({
      id: `${showId}:${hashId(guid)}`,
      showId,
      title: textOf(item.title) ?? audioUrl,
      audioUrl,
      publishedAt: Number.isFinite(parsedTime) ? parsedTime : undefined,
      durationSeconds:
        parseDuration(item["itunes:duration"]) ?? parseDuration(item.duration),
      artworkUrl:
        attrOf(item["itunes:image"], "href") ??
        attrOf(asArray(item.enclosure as unknown)[0], "url") ??
        undefined,
      description: textOf(item.description as unknown) ?? textOf(item.summary as unknown),
    });
  }

  // Newest first; undated episodes sort last rather than first.
  episodes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

  return { show, episodes, skippedItems };
}
