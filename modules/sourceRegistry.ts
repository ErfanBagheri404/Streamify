/********************************************************************
 *  sourceRegistry.ts - Pluggable music sources (additive by design)
 *
 *  The existing search chain (backend /search/all first, then YouTube +
 *  YouTube Music + JioSaavn + SoundCloud fan-out inside searchAPI.searchMixed)
 *  is proven and load-bearing. This registry does NOT modify or re-route it.
 *
 *  New sources register here and are only consulted when:
 *    1. ENABLE_EXTRA_SOURCES is true (off until the sources are device-tested), and
 *    2. the built-in chain returned nothing for the query.
 *
 *  A source plugin is the minimum surface: an id, a label, a search that
 *  returns normalized results, and a resolver that turns a result into a
 *  directly playable URL. Anything richer (playlists, charts) can hang off
 *  the same object later without changing call sites.
 *******************************************************************/

/** Flip to true after testing each new source on a device. */
export const ENABLE_EXTRA_SOURCES = false;

export interface SourceSearchResult {
  id: string;
  title: string;
  author?: string;
  duration?: string | number;
  thumbnailUrl?: string;
  /** Source-specific handle the resolver needs (track id, path, etc). */
  handle?: string;
  source: string;
}

export interface SourcePlugin {
  id: string;
  label: string;
  /** Direct-stream providers (no auth) run in parallel with zero cost. */
  requiresAuth: boolean;
  search(query: string, limit: number): Promise<SourceSearchResult[]>;
  /** Resolve a playable http(s) stream URL, or null if unplayable. */
  resolve(result: SourceSearchResult): Promise<string | null>;
}

// --- Audius ----------------------------------------------------------------
// Public discovery nodes serve previews + 64k streams without auth.
const AUDIUS_DISCOVERY = "https://api.audius.co";

const audiusSource: SourcePlugin = {
  id: "audius",
  label: "Audius",
  requiresAuth: false,
  async search(query, limit) {
    const url = `${AUDIUS_DISCOVERY}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=Streamify`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    const tracks = Array.isArray(data?.data) ? data.data : [];
    return tracks.slice(0, limit).map((t: any) => ({
      id: `audius-${t.id}`,
      title: t.title || "Untitled",
      author: t.user?.name,
      duration: t.duration,
      thumbnailUrl: t.artwork?.["480x480"] || t.artwork?.["150x150"],
      handle: t.id,
      source: "audius",
    }));
  },
  async resolve(result) {
    if (!result.handle) {
      return null;
    }
    // Stream endpoint 302s to the actual file; RNTP follows redirects.
    return `${AUDIUS_DISCOVERY}/v1/tracks/${result.handle}/stream?app_name=Streamify`;
  },
};

// --- Internet Archive ------------------------------------------------------
// Full audio search on archive.org; items expose a deterministic MP3 path.
const ARCHIVE_API = "https://archive.org/advancedsearch.php";

const archiveSource: SourcePlugin = {
  id: "archive",
  label: "Internet Archive",
  requiresAuth: false,
  async search(query, limit) {
    const q = `collection:(audio) AND (${query.replace(/"/g, "")})`;
    const url =
      `${ARCHIVE_API}?q=${encodeURIComponent(q)}` +
      `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator` +
      `&rows=${Math.min(limit, 20)}&page=1&output=json`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    const docs = data?.response?.docs || [];
    return docs.slice(0, limit).map((d: any) => ({
      id: `archive-${d.identifier}`,
      title: Array.isArray(d.title) ? d.title[0] : d.title || d.identifier,
      author: Array.isArray(d.creator) ? d.creator[0] : d.creator,
      thumbnailUrl: `https://archive.org/metadata/${d.identifier}/thumbnail`,
      handle: d.identifier,
      source: "archive",
    }));
  },
  async resolve(result) {
    if (!result.handle) {
      return null;
    }
    // Metadata call gives the file list; pick the first mp3.
    try {
      const metaRes = await fetch(
        `https://archive.org/metadata/${result.handle}`,
      );
      if (!metaRes.ok) {
        return null;
      }
      const meta = await metaRes.json();
      const file = (meta?.files || []).find((f: any) =>
        String(f.name || "").toLowerCase().endsWith(".mp3"),
      );
      if (!file) {
        return null;
      }
      return `https://archive.org/download/${result.handle}/${file.name}`;
    } catch {
      return null;
    }
  },
};

// --- Registry ----------------------------------------------------------------

const sources: SourcePlugin[] = [audiusSource, archiveSource];

export function getRegisteredSources(): readonly SourcePlugin[] {
  return sources;
}

export function getSource(id: string): SourcePlugin | undefined {
  return sources.find((s) => s.id === id);
}

/**
 * Search every registered non-auth source in parallel and merge. Errors on
 * individual sources are swallowed — this runs only when the built-in chain
 * already failed, so partial answers are strictly better than none.
 */
export async function searchExtraSources(
  query: string,
  limit = 20,
): Promise<SourceSearchResult[]> {
  if (!ENABLE_EXTRA_SOURCES) {
    return [];
  }
  const batches = await Promise.allSettled(
    sources
      .filter((s) => !s.requiresAuth)
      .map((s) => s.search(query, limit)),
  );
  return batches.flatMap((b) => (b.status === "fulfilled" ? b.value : []));
}

/** Resolve a playable URL for a result produced by one of our sources. */
export async function resolveExtraSourceUrl(
  result: SourceSearchResult,
): Promise<string | null> {
  const source = getSource(result.source);
  if (!source) {
    return null;
  }
  try {
    return await source.resolve(result);
  } catch {
    return null;
  }
}
