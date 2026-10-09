/********************************************************************
 * aiMixGenerator.ts — LLM-guided discovery mix (issue #49, discovery mode)
 *
 * The on-device mix (aiMixPlaylist.ts) only reshuffles what the user
 * already has. This generator asks a keyless LLM for SEARCH QUERIES
 * only — it never picks tracks. The queries run through the app's own
 * search API, results are scored by the same buildSmartQueue weights,
 * and a failure at any stage falls back to the on-device mix.
 *
 * Endpoint: Pollinations text API, OpenAI-compatible, anonymous.
 * The free lane accepts no credentials — an API token in the request
 * would be rejected, so none is ever attached.
 *
 * Privacy: the prompt carries artist/track NAMES only. No ids, no
 * accounts, no play counts beyond rank order. Same tradeoff class as
 * streaming the songs themselves.
 ******************************************************************/
import type { Track } from "../contexts/PlayerContext";
import { StorageService, type Playlist } from "../utils/storage";
import { loadReplaySummary } from "../utils/listeningStats";
import { searchAPI } from "./searchAPI";
import { buildSmartQueue, loadPlayCounts } from "./aiPlaylistService";
import {
  generateAiMixPlaylist,
  persistAiMix,
  pickSeed,
} from "./aiMixPlaylist";

/**
 * The keyless lane is rate-limited and returns HTTP 402 once an IP has used
 * its anonymous quota. Try a second model alias before giving up: they are
 * served by different upstreams, so one being throttled rarely throttles both.
 * Anonymous only — no credentials are ever attached.
 */
const ENDPOINTS = [
  { url: "https://text.pollinations.ai/openai", model: "mistral" },
  { url: "https://text.pollinations.ai/openai", model: "openai" },
];
const REQUEST_TIMEOUT_MS = 15000;
const MAX_QUERIES = 6;
const QUERIES_PER_REQUEST = 8;
const MIN_DISCOVERY_TRACKS = 8;
const SEARCH_LIMIT = 10;

/**
 * The prompt carries names only — top artists and top tracks, ranked.
 * Fenced to a JSON array so parsing is mechanical, not hopeful.
 */
export function buildHistoryPrompt(language: "en" | "fa"): string {
  const ask =
    language === "fa"
      ? "لطفا فقط یک آرایه JSON از رشته‌ها برگردان، بدون هیچ متن دیگری."
      : "Reply with ONLY a JSON array of strings, no other text.";
  return [
    "You suggest music search queries.",
    `Give me exactly ${QUERIES_PER_REQUEST} YouTube Music search queries for finding songs I have NOT heard yet but will like.`,
    `Make them general discovery queries (genres, eras, moods, scenes) - do NOT include these exact artist or track names in the queries.`,
    `Rules: 3-6 words each, in ${language === "fa" ? "Persian/Farsi" : "English"}.`,
    ask,
  ].join("\n");
}

export function buildHistoryContext(
  artists: string[],
  tracks: string[],
  language: "en" | "fa",
): string {
  const head =
    language === "fa"
      ? "من به این آهنگ‌ها گوش می‌دهم:"
      : "These are what I listen to most:";
  return [
    head,
    `Top artists: ${artists.slice(0, 10).join(", ")}`,
    `Top tracks: ${tracks.slice(0, 15).join("; ")}`,
    buildHistoryPrompt(language),
  ].join("\n");
}

/**
 * Strict parser: finds the first JSON array of strings in model output,
 * tolerates markdown fences and chatter around it. Anything else (an
 * object, nested arrays, garbage) returns []. The caller treats [] as
 * "LLM failed" and falls back — never as "empty playlist".
 */
export function parseQueryList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  // Strip code fences first: they are the common wrapping, and their
  // brackets would otherwise win the scan.
  const unfenced = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "");
  const match = unfenced.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const clean = item.trim().slice(0, 80);
    // A query must be words: reject JSON fragments that slipped through.
    if (clean.length < 3 || !/[a-z\u0600-\u06FF]/i.test(clean)) continue;
    out.push(clean);
    if (out.length >= MAX_QUERIES) break;
  }
  return out;
}

/** One attempt against one endpoint. Returns [] on any failure. */
async function fetchFrom(
  endpoint: { url: string; model: string },
  prompt: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Anonymous is the free lane: no auth token of any kind.
      body: JSON.stringify({
        model: endpoint.model,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.log(`[aiMix] ${endpoint.model} HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseQueryList(data?.choices?.[0]?.message?.content);
  } catch (error) {
    console.log(
      `[aiMix] ${endpoint.model} failed:`,
      error instanceof Error ? error.message : error,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk the keyless endpoint chain until one returns usable queries.
 * The last resort is not here — it is the on-device mix, in the caller.
 */
export async function fetchSearchQueries(
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  for (const endpoint of ENDPOINTS) {
    const queries = await fetchFrom(endpoint, prompt, fetchImpl);
    if (queries.length) return queries;
  }
  return [];
}

/** Load ranked artist/track names from local listening stats. */
async function loadHistoryNames(): Promise<{
  artists: string[];
  tracks: string[];
}> {
  try {
    const summary = await loadReplaySummary("alltime");
    const artists = (summary.topArtists || [])
      .map((a) => a.name)
      .filter(Boolean);
    const tracks = (summary.topTracks || [])
      .map((t) => (t.artist ? `${t.title} — ${t.artist}` : t.title))
      .filter(Boolean);
    return { artists, tracks };
  } catch {
    return { artists: [], tracks: [] };
  }
}

/** Run discovery queries through the app's own search. Dedupes by id. */
export async function resolveQueries(
  queries: string[],
  search: (query: string) => Promise<Track[]> = defaultSearch,
): Promise<Track[]> {
  const seen = new Set<string>();
  const found: Track[] = [];
  for (const query of queries.slice(0, MAX_QUERIES)) {
    let results: Track[] = [];
    try {
      results = await search(query);
    } catch {
      // one dead query source must not sink the batch
      continue;
    }
    for (const t of results) {
      if (!t?.id || !t.title || seen.has(String(t.id))) continue;
      seen.add(String(t.id));
      found.push(t);
    }
  }
  return found;
}

/** Default resolver: YouTube Music via the existing search surface. */
async function defaultSearch(query: string): Promise<Track[]> {
  const result = await searchAPI.searchWithYouTubeMusic(query, "all", 1, SEARCH_LIMIT);
  const items = result?.items || [];
  return items.map((item: any) => ({
    id: String(item.id),
    title: item.title || "",
    artist: item.author || item.artist || "",
    thumbnail: item.img || item.thumbnailUrl || item.thumbnail,
    url: item.href,
    source: "youtubemusic",
  })) as Track[];
}

/**
 * Discovery-first generator. Stages:
 *   1. history names -> prompt -> LLM queries      (fail => on-device)
 *   2. queries -> search -> candidate pool         (< MIN => on-device)
 *   3. score with buildSmartQueue against seed     (empty => on-device)
 *   4. persist under the stable @ai_mix id
 */
export async function generateAiMixWithDiscovery(
  language: "en" | "fa",
  deps?: {
    fetchImpl?: typeof fetch;
    search?: (query: string) => Promise<Track[]>;
  },
): Promise<Playlist | null> {
  const [{ artists, tracks: trackNames }, liked, recent, playCounts] =
    await Promise.all([
      loadHistoryNames(),
      StorageService.loadLikedSongs(),
      StorageService.loadPreviouslyPlayedSongs(),
      loadPlayCounts(),
    ]);

  const seed = await pickSeed(liked, recent);
  if (!seed) {
    // Same contract as the on-device path: honest null, no fake playlist.
    return null;
  }

  const prompt = buildHistoryContext(artists, trackNames, language);
  const queries = await fetchSearchQueries(prompt, deps?.fetchImpl);
  if (!queries.length) {
    console.log("[aiMix] no queries from LLM, falling back to on-device mix");
    return generateAiMixPlaylist(language);
  }

  const candidates = await resolveQueries(queries, deps?.search);
  if (candidates.length < MIN_DISCOVERY_TRACKS) {
    console.log(
      `[aiMix] only ${candidates.length} discovery tracks, falling back to on-device mix`,
    );
    return generateAiMixPlaylist(language);
  }

  // Seed scoring gives the discovery pool taste; new tracks have no play
  // history, so playCounts only discriminates tracks the user already has.
  const discovered = buildSmartQueue({
    seed,
    library: candidates,
    size: 30,
    playCounts,
  });
  if (discovered.length < MIN_DISCOVERY_TRACKS) {
    console.log("[aiMix] scoring kept too little, falling back to on-device mix");
    return generateAiMixPlaylist(language);
  }

  console.log(
    `[aiMix] discovery: ${queries.length} queries -> ${candidates.length} candidates -> ${discovered.length} tracks`,
  );
  return persistAiMix(discovered, language);
}
