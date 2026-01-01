// lib/searchAPI.ts

export interface SearchResult {
  id: string;
  title: string;
  author?: string;
  duration: string;
  href?: string;
  uploaded?: string;
  channelUrl?: string;
  views?: string;
  img?: string;
  thumbnailUrl?: string;
  source?: "youtube" | "soundcloud" | "jiosaavn";
  type?: "song" | "album" | "artist" | "unknown";
  albumId?: string | null;
  albumName?: string | null;
  albumUrl?: string | null;
  albumYear?: string | null;
}

// --- CONSTANTS ---
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const PIPED_INSTANCES = ["https://api.piped.private.coffee"];

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net/api/v1",
  "https://vid.puffyan.us/api/v1",
  "https://yewtu.be/api/v1",
  "https://invidious.drgns.space/api/v1",
  "https://inv.perditum.com/api/v1",
];

/* ---------- HELPER FUNCTIONS ---------- */
const units = [
  { l: "year", d: 31_536_000 },
  { l: "month", d: 2_592_000 },
  { l: "week", d: 604_800 },
  { l: "day", d: 86_400 },
  { l: "hour", d: 3_600 },
  { l: "minute", d: 60 },
];

function fmtTimeAgo(stamp: number | string | undefined): string {
  if (!stamp) {
    return "unknown date";
  }
  let n = Number(stamp);
  if (Number.isNaN(n)) {
    return "unknown date";
  }
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  const secDiff = (Date.now() - ms) / 1000;
  if (secDiff < 0) {
    return "just now";
  }
  if (secDiff > 1_600_000_000) {
    return "long ago";
  }
  for (const u of units) {
    const val = Math.floor(secDiff / u.d);
    if (val >= 1) {
      return `${val} ${u.l}${val > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}

// Robust fetcher for Piped/Invidious
const fetchWithFallbacks = async (
  instances: string[],
  endpoint: string,
): Promise<any> => {
  for (const baseUrl of instances) {
    const startTime = Date.now();
    try {
      console.log(`[API] 🟡 Attempting: ${baseUrl} ...`);
      const url = `${baseUrl}${endpoint}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const text = await response.text();
        try {
          if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
            return JSON.parse(text);
          }
        } catch (e) {
          /* ignore parse error */
        }
      }
    } catch (error) {
      /* ignore network error */
    }
  }
  return null;
};

/* ---------- MAIN API ---------- */
export const searchAPI = {
  getSuggestions: async (
    query: string,
    source: "youtube" | "soundcloud" | "spotify" | "jiosaavn" = "youtube",
  ): Promise<string[]> => {
    if (!query.trim()) {
      return [];
    }

    // Enhanced multilingual support for suggestions
    const isMultilingual = /[^\u0000-\u007F]/.test(query);
    if (isMultilingual) {
      console.log(
        `[API] Detected multilingual query for suggestions: "${query}"`,
      );
    }

    if (source === "soundcloud") {
      return await searchAPI.getSoundCloudSuggestions(query);
    }
    if (source === "jiosaavn") {
      // For JioSaavn, return simple suggestions based on the query
      const terms = ["song", "remix", "live", "official"];
      return [query, ...terms.map((term) => `${query} ${term}`)].slice(0, 5);
    }
    if (source === "spotify") {
      return await searchAPI.getSpotifySuggestions(query);
    }

    const endpoint = `/suggestions?query=${encodeURIComponent(query)}`;
    const data = await fetchWithFallbacks(PIPED_INSTANCES, endpoint);
    let suggestions: string[] = [];

    if (Array.isArray(data)) {
      if (data.length > 1 && Array.isArray(data[1])) {
        suggestions = (data[1] as any[]).filter(
          (v): v is string => typeof v === "string",
        );
      } else {
        suggestions = (data as any[]).filter(
          (v): v is string => typeof v === "string",
        );
      }
    } else if (data && Array.isArray((data as any).suggestions)) {
      suggestions = (data as any).suggestions.filter(
        (v: any) => typeof v === "string",
      );
    }

    if (!suggestions.length) {
      const ytTerms = ["official video", "lyrics", "live", "remix", "extended"];
      suggestions = [query, ...ytTerms.map((t) => `${query} ${t}`)];
    }

    return suggestions.slice(0, 5);
  },

  getSoundCloudSuggestions: async (query: string): Promise<string[]> => {
    if (!query.trim()) {
      return [];
    }
    try {
      console.log(
        `[API] Fetching SoundCloud suggestions via proxy for: "${query}"`,
      );
      const tracks = await searchAPI.scrapeSoundCloudSearch(query);
      if (!Array.isArray(tracks) || tracks.length === 0) {
        const fallbackTerms = [
          "mix",
          "remix",
          "live",
          "instrumental",
          "extended",
        ];
        return fallbackTerms.map((term) => `${query} ${term}`).slice(0, 5);
      }
      const titles = tracks
        .map((t: any) => t && t.title)
        .filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        );
      const uniqueTitles: string[] = [];
      for (const title of titles) {
        if (!uniqueTitles.includes(title)) {
          uniqueTitles.push(title);
        }
        if (uniqueTitles.length >= 5) {
          break;
        }
      }
      if (uniqueTitles.length === 0) {
        const fallbackTerms = [
          "mix",
          "remix",
          "live",
          "instrumental",
          "extended",
        ];
        return fallbackTerms.map((term) => `${query} ${term}`).slice(0, 5);
      }
      console.log(
        `[API] SoundCloud suggestion titles: ${uniqueTitles.length}`,
        uniqueTitles,
      );
      return uniqueTitles.slice(0, 5);
    } catch (e) {
      const fallbackTerms = [
        "mix",
        "remix",
        "live",
        "instrumental",
        "extended",
      ];
      return fallbackTerms.map((term) => `${query} ${term}`).slice(0, 5);
    }
  },

  getSpotifySuggestions: async (query: string): Promise<string[]> => {
    try {
      const spotifyTerms = [
        "official",
        "explicit",
        "clean",
        "radio edit",
        "remix",
        "acoustic version",
      ];
      const suggestions = spotifyTerms.map((term) => `${query} ${term}`);
      suggestions.unshift(query);
      return suggestions.slice(0, 5);
    } catch (e) {
      console.warn("[API] Spotify suggestions error:", e);
      return [query];
    }
  },

  // --- JIOSAAVN SEARCH ---
  searchWithJioSaavn: async (query: string) => {
    console.log(`[API] Starting JioSaavn search for: "${query}"`);

    try {
      const searchUrl = `https://lowkey-backend.vercel.app/api/search?query=${encodeURIComponent(query)}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || !data.success || !data.data) {
        throw new Error("Invalid response format");
      }

      // Extract all sections from the response
      const topQuery = data.data.topQuery?.results || [];
      const songs = data.data.songs?.results || [];
      const albums = data.data.albums?.results || [];
      const artists = data.data.artists?.results || [];

      // Enhanced artist filtering: prioritize exact matches for individual artist searches
      const filteredArtists = artists.filter((artist: any) => {
        const artistName = artist.title || "";
        const queryLower = query.toLowerCase().trim();
        const artistNameLower = artistName.toLowerCase().trim();

        // For individual artist searches, be very strict - only exact matches or very close
        const isSearchingForIndividualArtist =
          !query.includes("&") && !query.toLowerCase().includes(" and ");

        if (isSearchingForIndividualArtist) {
          // Skip collaboration artists entirely
          if (
            artistNameLower.includes("&") ||
            artistNameLower.includes(" and ") ||
            artistNameLower.includes(" feat ") ||
            artistNameLower.includes(" ft ")
          ) {
            return false;
          }
          // For individual searches, prioritize exact matches first
          if (artistNameLower === queryLower) {
            return true; // Exact match - always include
          }
          // For non-exact matches, be more restrictive - only include if it's a very close match
          // (e.g., "Arijit Singh" should match "Arijit Singh" but not "Arijit Singh & Shreya Ghoshal")
          return (
            artistNameLower.includes(queryLower) &&
            !artistNameLower.includes("&")
          );
        }

        // For collaboration searches, allow broader matching
        return (
          artistNameLower.includes(queryLower) ||
          queryLower.includes(artistNameLower)
        );
      });

      console.log(
        `[API] Filtered ${artists.length} artists to ${filteredArtists.length} relevant artists`,
      );

      // Log exact matches for debugging
      const exactMatches = filteredArtists.filter(
        (artist: any) =>
          (artist.title || "").toLowerCase().trim() ===
          query.toLowerCase().trim(),
      );
      if (exactMatches.length > 0) {
        console.log(
          `[API] Found ${exactMatches.length} exact artist matches for "${query}":`,
          exactMatches.map((a: any) => a.title),
        );
      }

      console.log(
        `[API] 🟢 JioSaavn Success: Found ${songs.length} songs, ${albums.length} albums, ${artists.length} artists, ${topQuery.length} top queries`,
      );

      // Format all results to match SearchResult interface
      const topQueryResults: SearchResult[] = [];
      const songsResults: SearchResult[] = [];
      const albumsResults: SearchResult[] = [];
      const artistsResults: SearchResult[] = [];

      const isSearchingForIndividualArtist =
        !query.includes("&") && !query.toLowerCase().includes(" and ");

      // Process top query results
      topQuery.forEach((item: any) => {
        const thumbnailUrl =
          item.image?.find((img: any) => img.quality === "500x500")?.url ||
          item.image?.find((img: any) => img.quality === "150x150")?.url ||
          item.image?.[0]?.url ||
          "";

        topQueryResults.push({
          id: String(item.id),
          title: item.title || "Unknown Title",
          author: item.description || "Unknown",
          duration: "0",
          views: "0",
          uploaded: "",
          thumbnailUrl: thumbnailUrl,
          img: thumbnailUrl,
          href: item.url || "",
          source: "jiosaavn",
          type: item.type || "unknown",
        });
      });

      // Process song results - filter out collaboration songs when searching for individual artists
      songs.forEach((song: any) => {
        const songTitle =
          song.name || song.title || song.song || "Unknown Title";
        const songArtists =
          song.primaryArtists || song.singers || "Unknown Artist";

        // Skip collaboration songs if user is searching for individual artist
        if (
          isSearchingForIndividualArtist &&
          (songArtists.includes("&") ||
            songArtists.toLowerCase().includes(" and "))
        ) {
          return; // Skip this song
        }

        const thumbnailUrl =
          song.image?.find((img: any) => img.quality === "500x500")?.url ||
          song.image?.find((img: any) => img.quality === "150x150")?.url ||
          song.image?.[0]?.url ||
          "";

        songsResults.push({
          id: String(song.id),
          title: songTitle,
          author: songArtists,
          duration: song.duration ? String(song.duration) : "0",
          views: "0",
          uploaded: "",
          thumbnailUrl: thumbnailUrl,
          img: thumbnailUrl,
          href: song.url || "",
          source: "jiosaavn",
          albumId: song.album?.id || null,
          albumName: song.album?.name || null,
          albumUrl: song.album?.url || null,
        });
      });

      // Process album results
      albums.forEach((album: any) => {
        const thumbnailUrl =
          album.image?.find((img: any) => img.quality === "500x500")?.url ||
          album.image?.find((img: any) => img.quality === "150x150")?.url ||
          album.image?.[0]?.url ||
          "";

        albumsResults.push({
          id: String(album.id),
          title: album.title || "Unknown Album",
          author: album.artist || "Unknown Artist",
          duration: "0",
          views: "0",
          uploaded: album.year || "",
          thumbnailUrl: thumbnailUrl,
          img: thumbnailUrl,
          href: album.url || "",
          source: "jiosaavn",
          type: "album",
          albumYear: album.year || null,
        });
      });

      // Process artist results - filter out collaborations when searching for individual artists
      filteredArtists.forEach((artist: any) => {
        const artistName = artist.title || "Unknown Artist";

        // Skip collaboration artists if user is searching for individual artist
        if (
          isSearchingForIndividualArtist &&
          (artistName.includes("&") ||
            artistName.toLowerCase().includes(" and "))
        ) {
          return; // Skip this artist
        }

        const thumbnailUrl =
          artist.image?.find((img: any) => img.quality === "500x500")?.url ||
          artist.image?.find((img: any) => img.quality === "150x150")?.url ||
          artist.image?.[0]?.url ||
          "";

        artistsResults.push({
          id: String(artist.id),
          title: artistName,
          author: artist.description || "Artist",
          duration: "0",
          views: "0",
          uploaded: "",
          thumbnailUrl: thumbnailUrl,
          img: thumbnailUrl,
          href: artist.url || "",
          source: "jiosaavn",
          type: "artist",
        });
      });

      // Check for exact artist matches in the filtered artists
      const exactArtistMatches = artistsResults.filter(
        (item) =>
          item.title.toLowerCase().trim() === query.toLowerCase().trim(),
      );

      // Build final result array in the correct order: Top Results (with artist first if exact match), Songs, Albums
      let finalResults: SearchResult[] = [];

      // Add top query results first
      if (topQueryResults.length > 0) {
        finalResults = [...finalResults, ...topQueryResults];
      }

      // Add exact artist matches at the top if they exist - but only show ONE exact match
      if (exactArtistMatches.length > 0) {
        finalResults = [...finalResults, exactArtistMatches[0]]; // Only show the first exact match
      }

      // Add songs
      if (songsResults.length > 0) {
        finalResults = [...finalResults, ...songsResults];
      }

      // Add albums
      if (albumsResults.length > 0) {
        finalResults = [...finalResults, ...albumsResults];
      }

      // Add remaining artists (non-exact matches)
      const remainingArtists = artistsResults.filter(
        (item) =>
          item.title.toLowerCase().trim() !== query.toLowerCase().trim(),
      );
      if (remainingArtists.length > 0) {
        finalResults = [...finalResults, ...remainingArtists];
      }

      console.log(`[API] Final JioSaavn results: ${finalResults.length} total`);
      return finalResults;
    } catch (e: any) {
      console.warn(`[API] 🔴 JioSaavn Error: ${e.message}`);
      return [];
    }
  },

  // --- JIOSAAVN SONG DETAILS ---
  getJioSaavnSongDetails: async (songId: string) => {
    console.log(`[API] Fetching JioSaavn song details for: "${songId}"`);

    try {
      const detailsUrl = `https://lowkey-backend.vercel.app/api/songs/${songId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(detailsUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (
        !data ||
        !data.success ||
        !data.data ||
        !Array.isArray(data.data) ||
        data.data.length === 0
      ) {
        throw new Error("Invalid response format");
      }

      const song = data.data[0];

      console.log(`[API] 🟢 JioSaavn Song Details Success: ${song.name}`);

      // Get the best quality audio URL (prefer 320kbps, fallback to lower quality)
      const audioUrl =
        song.downloadUrl?.find((dl: any) => dl.quality === "320kbps")?.url ||
        song.downloadUrl?.find((dl: any) => dl.quality === "160kbps")?.url ||
        song.downloadUrl?.find((dl: any) => dl.quality === "96kbps")?.url ||
        song.downloadUrl?.[0]?.url ||
        "";

      // Get the best quality thumbnail
      const thumbnailUrl =
        song.image?.find((img: any) => img.quality === "500x500")?.url ||
        song.image?.find((img: any) => img.quality === "150x150")?.url ||
        song.image?.[0]?.url ||
        "";

      return {
        id: String(song.id),
        title: song.name || song.title || song.song || "Unknown Title",
        artist:
          song.artists?.primary?.map((artist: any) => artist.name).join(", ") ||
          "Unknown Artist",
        duration: song.duration || 0,
        thumbnail: thumbnailUrl,
        audioUrl: audioUrl,
        album: song.album?.name || "",
        year: song.year || "",
        language: song.language || "",
        hasLyrics: song.hasLyrics || false,
        explicitContent: song.explicitContent || false,
      };
    } catch (e: any) {
      console.warn(`[API] 🔴 JioSaavn Song Details Error: ${e.message}`);
      return null;
    }
  },

  // --- JIOSAAVN ALBUM DETAILS ---
  getJioSaavnAlbumDetails: async (albumId: string, albumName: string) => {
    console.log(
      `[API] Fetching JioSaavn album details for: "${albumName}" (ID: ${albumId})`,
    );

    try {
      // Strategy 1: Try direct album endpoint first
      const albumUrl = `https://lowkey-backend.vercel.app/api/albums?id=${albumId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      try {
        const albumResponse = await fetch(albumUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        });

        if (albumResponse.ok) {
          const albumData = await albumResponse.json();

          if (
            albumData &&
            albumData.success &&
            albumData.data &&
            albumData.data.songs
          ) {
            console.log(
              `[API] 🟢 JioSaavn Album Details Success (Direct): Found ${albumData.data.songs.length} songs for "${albumName}"`,
            );

            return {
              id: albumId,
              name: albumName,
              year: albumData.data.year || albumData.data.songs[0]?.year || "",
              image:
                albumData.data.image || albumData.data.songs[0]?.image || [],
              songs: albumData.data.songs,
              artists:
                albumData.data.artists ||
                albumData.data.songs[0]?.artists?.primary
                  ?.map((artist: any) => artist.name)
                  .join(", ") ||
                "",
              language:
                albumData.data.language ||
                albumData.data.songs[0]?.language ||
                "",
            };
          }
        }
      } catch (albumError) {
        console.log(
          "[API] Direct album endpoint failed, trying search approach:",
          albumError,
        );
      }

      // Strategy 2: Fallback to search approach with multiple attempts
      const searchQueries = [
        albumName,
        `${albumName} album`,
        `${albumName} full album`,
      ];

      for (const query of searchQueries) {
        try {
          const searchUrl = `https://lowkey-backend.vercel.app/api/search/songs?query=${encodeURIComponent(query)}`;

          const searchResponse = await fetch(searchUrl, {
            signal: controller.signal,
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "application/json",
            },
          });

          if (!searchResponse.ok) {
            continue;
          }

          const data = await searchResponse.json();

          if (!data || !data.success || !data.data || !data.data.results) {
            continue;
          }

          // Filter songs that belong to the specified album
          let albumSongs = data.data.results.filter(
            (song: any) => song.album && song.album.id === albumId,
          );

          // If no exact album ID match, try fuzzy matching by album name
          if (albumSongs.length === 0) {
            albumSongs = data.data.results.filter(
              (song: any) =>
                song.album &&
                song.album.name &&
                song.album.name.toLowerCase().includes(albumName.toLowerCase()),
            );
          }

          if (albumSongs.length > 0) {
            console.log(
              `[API] 🟢 JioSaavn Album Details Success (Search): Found ${albumSongs.length} songs for "${albumName}" using query: "${query}"`,
            );

            return {
              id: albumId,
              name: albumName,
              year: albumSongs[0].year || "",
              image: albumSongs[0].image || [],
              songs: albumSongs,
              artists:
                albumSongs[0].artists?.primary
                  ?.map((artist: any) => artist.name)
                  .join(", ") || "",
              language: albumSongs[0].language || "",
            };
          }
        } catch (searchError) {
          console.log(
            `[API] Search attempt with query "${query}" failed:`,
            searchError,
          );
          continue;
        }
      }

      throw new Error("No songs found for this album after multiple attempts");
    } catch (e: any) {
      console.warn(`[API] 🔴 JioSaavn Album Details Error: ${e.message}`);
      return null;
    }
  },

  searchWithPiped: async (query: string, filter: string) => {
    console.log(`[API] Searching Piped: "${query}"`);

    // Enhanced multilingual search - preserve original query but also try transliterated version
    const searchQueries = [query];

    // Check if query contains non-Latin characters and add transliterated version
    if (/[^\u0000-\u007F]/.test(query)) {
      // For now, just use the original query as-is since Piped/YouTube handles multilingual search well
      // In future, we could add transliteration libraries here
      console.log(`[API] Detected non-Latin characters in query: "${query}"`);
    }

    const filterParam = filter === "" ? "all" : filter;

    // Try the primary query first
    const endpoint = `/search?q=${encodeURIComponent(
      query,
    )}&filter=${filterParam}`;
    const data = await fetchWithFallbacks(PIPED_INSTANCES, endpoint);

    // If no results and we have multilingual query, try with relaxed search terms
    if (
      (!data || !Array.isArray(data.items) || data.items.length === 0) &&
      /[^\u0000-\u007F]/.test(query)
    ) {
      console.log(
        "[API] No results for multilingual query, trying broader search",
      );
      const broadEndpoint = `/search?q=${encodeURIComponent(query)}&filter=all`;
      const broadData = await fetchWithFallbacks(
        PIPED_INSTANCES,
        broadEndpoint,
      );
      return broadData && Array.isArray(broadData.items) ? broadData.items : [];
    }

    return data && Array.isArray(data.items) ? data.items : [];
  },

  searchWithInvidious: async (query: string, sortType: string) => {
    console.log(`[API] Searching Invidious: "${query}"`);
    const sortParam = sortType === "date" ? "upload_date" : "view_count";
    const endpoint = `/search?q=${encodeURIComponent(
      query,
    )}&sort_by=${sortParam}`;
    const data = await fetchWithFallbacks(INVIDIOUS_INSTANCES, endpoint);
    return Array.isArray(data) ? data : [];
  },

  // --- SOUNDCLOUD SEARCH WITH PROXY API ---
  searchWithSoundCloud: async (query: string) => {
    // Enhanced multilingual support for SoundCloud
    const isMultilingual = /[^\u0000-\u007F]/.test(query);

    // Use SoundCloud proxy API
    try {
      const tracks = await searchAPI.scrapeSoundCloudSearch(query);

      // Format the results manually instead of calling formatSearchResults
      if (!Array.isArray(tracks)) {
        return [];
      }

      // Deduplicate tracks by ID to prevent duplicate keys
      const seenIds = new Set<string>();
      return (
        tracks
          .filter((track) => track && track._isSoundCloud)
          .filter((track) => {
            const trackId = String(track.id);
            if (seenIds.has(trackId)) {
              console.log(
                `[API] Skipping duplicate SoundCloud track: ${trackId}`,
              );
              return false;
            }
            seenIds.add(trackId);
            return true;
          })
          // Filter out tracks that are likely to be unavailable
          .filter((track) => {
            // Skip tracks with very short duration (likely incomplete)
            if (track.duration && track.duration < 10000) {
              console.log(`[API] Skipping short track: ${track.id}`);
              return false;
            }
            // Skip tracks with no duration info
            if (!track.duration) {
              console.log(`[API] Skipping track with no duration: ${track.id}`);
              return false;
            }
            return true;
          })
          .map((track) => {
            const artwork = track.artwork_url
              ? track.artwork_url.replace("large.jpg", "t500x500.jpg")
              : track.user?.avatar_url;
            return {
              id: String(track.id),
              title: track.title || "Unknown Title",
              author: track.user?.username || "Unknown Artist",
              duration: track.duration
                ? String(Math.floor(track.duration / 1000))
                : "0",
              views: String(track.playback_count || 0),
              uploaded: fmtTimeAgo(new Date(track.created_at).getTime()),
              thumbnailUrl: artwork,
              img: artwork,
              href: track.permalink_url,
              source: "soundcloud",
            };
          })
      );
    } catch (error) {
      return [];
    }
  },

  formatSearchResults: (results: any[]): SearchResult[] => {
    if (!Array.isArray(results)) {
      return [];
    }
    return results
      .map((item) => {
        if (!item) {
          return null;
        }
        // --- SOUNDCLOUD ---
        if (item._isSoundCloud || item.kind === "track") {
          const artwork = item.artwork_url
            ? item.artwork_url.replace("large.jpg", "t500x500.jpg")
            : item.user?.avatar_url;
          return {
            id: String(item.id),
            title: item.title || "Unknown Title",
            author: item.user?.username || "Unknown Artist",
            duration: item.duration
              ? String(Math.floor(item.duration / 1000))
              : "0",
            views: String(item.playback_count || 0),
            uploaded: fmtTimeAgo(new Date(item.created_at).getTime()),
            thumbnailUrl: artwork,
            img: artwork,
            href: item.permalink_url,
            source: "soundcloud",
          } as SearchResult;
        }
        // --- PIPED / INVIDIOUS ---
        const isPiped =
          item.url &&
          typeof item.url === "string" &&
          item.url.startsWith("/watch");
        let id = isPiped ? item.url.split("v=")[1] : item.videoId || "";
        let thumbnailUrl = item.thumbnail || "";
        if (
          !thumbnailUrl &&
          Array.isArray(item.videoThumbnails) &&
          item.videoThumbnails.length > 0
        ) {
          thumbnailUrl = item.videoThumbnails[0].url;
        }
        const result: SearchResult = {
          id,
          title: item.title || "Unknown Title",
          author: item.uploaderName || item.author || "Unknown Artist",
          duration: String(item.duration || item.lengthSeconds || "0"),
          views: String(item.views || item.viewCount || "0"),
          uploaded: fmtTimeAgo(Number(item.published || item.uploaded)),
          thumbnailUrl,
          img: thumbnailUrl,
          href: isPiped ? item.url : `/watch?v=${id}`,
          source: "youtube",
        };
        return result;
      })
      .filter((item): item is SearchResult => item !== null && item.id !== "");
  },

  // --- SOUNDCLOUD PROXY API ---
  scrapeSoundCloudSearch: async (query: string) => {
    try {
      // Use the SoundCloud proxy API
      const searchUrl = `https://proxy.searchsoundcloud.com/tracks?q=${encodeURIComponent(
        query,
      )}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || !data.collection || !Array.isArray(data.collection)) {
        throw new Error("Invalid response format");
      }

      // Convert proxy API response to SoundCloud format
      const tracks = data.collection.map((track: any) => ({
        id: String(track.id),
        title: track.title,
        user: { username: track.user?.username || "Unknown Artist" },
        duration: track.duration || 0,
        playback_count: track.playback_count || 0,
        created_at: track.created_at || new Date().toISOString(),
        permalink_url:
          track.permalink_url || `https://soundcloud.com/tracks/${track.id}`,
        artwork_url: track.artwork_url || null,
        _isSoundCloud: true,
      }));

      return tracks;
    } catch (e: any) {
      return [];
    }
  },
};
