// lib/searchAPI.ts
import {
  API,
  DYNAMIC_INVIDIOUS_INSTANCES,
  fetchStreamFromPipedWithFallback,
  fetchStreamFromInvidiousWithFallback,
  getJioSaavnSearchEndpoint,
  getJioSaavnSongEndpoint,
  getJioSaavnAlbumEndpoint,
  getJioSaavnArtistEndpoint,
  getJioSaavnPlaylistEndpoint,
  fetchWithRetry,
  idFromURL,
  convertSStoHHMMSS,
  numFormatter,
} from "../components/core/api";

export interface SearchResult {
  id: string;
  title: string;
  author?: string;
  duration: string;
  href?: string;
  uploaded?: string;
  channelUrl?: string;
  views?: string;
  videoCount?: string; // For playlists - number of videos
  img?: string;
  thumbnailUrl?: string;
  source?: "youtube" | "soundcloud" | "jiosaavn" | "youtubemusic";
  type?: "song" | "album" | "artist" | "playlist" | "unknown";
  albumId?: string | null;
  albumName?: string | null;
  albumUrl?: string | null;
  albumYear?: string | null;
  description?: string; // For channels - channel description
  verified?: boolean; // For channels - verified badge
}

// --- CONSTANTS ---
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Use centralized API configuration
export const PIPED_INSTANCES = API.piped;

// Use dynamic Invidious instances directly from centralized config

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
    return "";
  }
  let n = Number(stamp);
  if (Number.isNaN(n) || n <= 0) {
    return "";
  }
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  const secDiff = (Date.now() - ms) / 1000;
  if (secDiff < 0) {
    return "just now";
  }
  if (secDiff > 1_600_000_000) {
    return "";
  }
  for (const u of units) {
    const val = Math.floor(secDiff / u.d);
    if (val >= 1) {
      return `${val} ${u.l}${val > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}

// Helper functions are now imported from centralized API configuration

// Robust fetcher for Piped/Invidious
const fetchWithFallbacks = async (
  instances: string[],
  endpoint: string,
): Promise<any> => {
  console.log(
    `[API] fetchWithFallbacks called with ${instances.length} instances for endpoint: ${endpoint}`,
  );
  for (const baseUrl of instances) {
    const startTime = Date.now();
    try {
      console.log(`[API] 🟡 Attempting: ${baseUrl} ...`);
      const url = `${baseUrl}${endpoint}`;
      console.log(`[API] Full URL: ${url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(timeoutId);
      console.log(`[API] Response status: ${response.status}`);
      if (response.ok) {
        const text = await response.text();
        console.log(`[API] Response text length: ${text.length}`);
        try {
          if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
            const parsed = JSON.parse(text);
            console.log(`[API] ✅ Successfully parsed JSON from ${baseUrl}`);
            return parsed;
          } else {
            console.log("[API] Response doesn't start with JSON");
          }
        } catch (e) {
          console.log(`[API] Failed to parse JSON from ${baseUrl}:`, e.message);
        }
      } else {
        console.log(`[API] Response not OK: ${response.status}`);
      }
    } catch (error) {
      console.log(`[API] Network error for ${baseUrl}:`, error.message);
    }
  }
  console.log(`[API] ❌ All instances failed for endpoint: ${endpoint}`);
  return null;
};

/* ---------- MAIN API ---------- */
export const searchAPI = {
  getSuggestions: async (
    query: string,
    source:
      | "youtube"
      | "youtubemusic"
      | "soundcloud"
      | "spotify"
      | "jiosaavn" = "youtube",
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
    const data = await fetchWithFallbacks([...PIPED_INSTANCES], endpoint);
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

    const fallbackTerms = ["mix", "remix", "live", "instrumental", "extended"];

    return [query, ...fallbackTerms.map((term) => `${query} ${term}`)].slice(
      0,
      5,
    );
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
  searchWithJioSaavn: async (
    query: string,
    filter?: string,
    page?: number,
    limit?: number,
  ) => {
    console.log(`[API] Starting JioSaavn search for: "${query}"`);

    try {
      const searchUrl = getJioSaavnSearchEndpoint(query);
      const data = await fetchWithRetry<any>(
        searchUrl,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        },
        3,
        1000,
      );

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

  // COMMENTED OUT: JioSaavn song details disabled to focus on YouTube
  /*
  // --- JIOSAAVN SONG DETAILS ---
  getJioSaavnSongDetails: async (songId: string) => {
    console.log(`[API] Fetching JioSaavn song details for: "${songId}"`);

    try {
      const detailsUrl = getJioSaavnSongEndpoint(songId);
      const data = await fetchWithRetry<any>(
        detailsUrl,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        },
        3,
        1000
      );

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
          song.artists?.primary
            ?.map((artist: any) => artist.name?.replace(/\s*-\s*Topic$/i, ""))
            .join(", ") || "Unknown Artist",
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
  */

  // COMMENTED OUT: JioSaavn album details disabled to focus on YouTube
  /*
  // --- JIOSAAVN ALBUM DETAILS ---
  getJioSaavnAlbumDetails: async (albumId: string, albumName: string) => {
    console.log(
      `[API] Fetching JioSaavn album details for: "${albumName}" (ID: ${albumId})`
    );

    try {
      // Strategy 1: Try direct album endpoint first
      const albumUrl = getJioSaavnAlbumEndpoint(albumId);

      try {
        const albumData = await fetchWithRetry<any>(
          albumUrl,
          {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "application/json",
            },
          },
          3,
          1000
        );

        if (
          albumData &&
          albumData.success &&
          albumData.data &&
          albumData.data.songs
        ) {
          console.log(
            `[API] 🟢 JioSaavn Album Details Success (Direct): Found ${albumData.data.songs.length} songs for "${albumName}"`
          );

          return {
            id: albumId,
            name: albumName,
            year: albumData.data.year || albumData.data.songs[0]?.year || "",
            image: albumData.data.image || albumData.data.songs[0]?.image || [],
            songs: albumData.data.songs,
            artists:
              albumData.data.artists ||
              albumData.data.songs[0]?.artists?.primary
                ?.map((artist: any) =>
                  artist.name?.replace(/\s*-\s*Topic$/i, "")
                )
                .join(", ") ||
              "",
            language:
              albumData.data.language ||
              albumData.data.songs[0]?.language ||
              "",
          };
        }
      } catch (albumError) {
        console.log(
          "[API] Direct album endpoint failed, trying search approach:",
          albumError
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
          const controller = new AbortController();
          const data = await fetchWithRetry<any>(
            getJioSaavnSearchEndpoint(query),
            {
              signal: controller.signal,
              headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/json",
              },
            },
            3,
            1000
          );

          if (!data || !data.success || !data.data || !data.data.results) {
            continue;
          }

          // Filter songs that belong to the specified album
          let albumSongs = data.data.results.filter(
            (song: any) => song.album && song.album.id === albumId
          );

          // If no exact album ID match, try fuzzy matching by album name
          if (albumSongs.length === 0) {
            albumSongs = data.data.results.filter(
              (song: any) =>
                song.album &&
                song.album.name &&
                song.album.name.toLowerCase().includes(albumName.toLowerCase())
            );
          }

          if (albumSongs.length > 0) {
            console.log(
              `[API] 🟢 JioSaavn Album Details Success (Search): Found ${albumSongs.length} songs for "${albumName}" using query: "${query}"`
            );

            return {
              id: albumId,
              name: albumName,
              year: albumSongs[0].year || "",
              image: albumSongs[0].image || [],
              songs: albumSongs,
              artists:
                albumSongs[0].artists?.primary
                  ?.map((artist: any) =>
                    artist.name?.replace(/\s*-\s*Topic$/i, "")
                  )
                  .join(", ") || "",
              language: albumSongs[0].language || "",
            };
          }
        } catch (searchError) {
          console.log(
            `[API] Search attempt with query "${query}" failed:`,
            searchError
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
  */

  // --- YOUTUBE PLAYLIST DETAILS ---
  getYouTubePlaylistDetails: async (playlistId: string) => {
    console.log(
      `[API] Fetching YouTube playlist details for ID: ${playlistId}`,
    );

    // Extract playlist ID from URL format if needed
    let actualPlaylistId = playlistId;
    if (
      playlistId.includes("/playlist?list=") ||
      playlistId.includes("/mix?list=")
    ) {
      actualPlaylistId = playlistId.split("list=")[1] || playlistId;
      console.log(
        `[API] Extracted playlist/mix ID from URL: ${actualPlaylistId}`,
      );
    }

    try {
      // First, try Piped API
      const endpoint = `/playlists/${actualPlaylistId}`;
      console.log(
        `[API] Calling fetchWithFallbacks with endpoint: ${endpoint}`,
      );
      const data = await fetchWithFallbacks([...PIPED_INSTANCES], endpoint);
      console.log(
        "[API] fetchWithFallbacks returned:",
        data ? "data object" : "null",
      );

      // If no data returned from any instance, return null (no fallback)
      if (!data) {
        console.warn("[API] No data returned from any Piped instance");
        return null;
      }

      // Enhanced debugging for response structure
      console.log("[API] Response data keys:", Object.keys(data));
      console.log("[API] Response data type:", typeof data);

      // Check for different possible response structures
      if (data.error) {
        console.warn("[API] API returned error:", data.error);
        return null;
      }

      // Handle different response formats from different Piped instances
      let videos = null;
      let playlistName = data.name || data.title || "Unknown Playlist";
      let playlistDescription = data.description || "";
      let playlistThumbnail = data.thumbnailUrl || data.thumbnail || "";

      // Check for videos in various possible fields
      if (data.videos && Array.isArray(data.videos) && data.videos.length > 0) {
        videos = data.videos;
        console.log(`[API] Using 'videos' field with ${videos.length} videos`);
      } else if (
        data.relatedStreams &&
        Array.isArray(data.relatedStreams) &&
        data.relatedStreams.length > 0
      ) {
        videos = data.relatedStreams;
        console.log(
          `[API] Using 'relatedStreams' field with ${videos.length} videos`,
        );
      } else if (
        data.items &&
        Array.isArray(data.items) &&
        data.items.length > 0
      ) {
        videos = data.items;
        console.log(`[API] Using 'items' field with ${videos.length} videos`);
      } else if (
        data.content &&
        Array.isArray(data.content) &&
        data.content.length > 0
      ) {
        videos = data.content;
        console.log(`[API] Using 'content' field with ${videos.length} videos`);
      }

      // If we found videos, validate they have the required fields
      if (videos && videos.length > 0) {
        console.log(
          "[API] First video structure:",
          JSON.stringify(videos[0], null, 2),
        );

        // Filter out invalid videos and map to standard format
        const validVideos = videos
          .filter((video: any) => {
            // Check if video has at least a title or URL
            const hasTitle = video.title && typeof video.title === "string";
            const hasUrl = video.url || video.videoId || video.id;
            const isValid = hasTitle || hasUrl;
            if (!isValid) {
              console.warn("[API] Skipping invalid video:", video);
            }
            return isValid;
          })
          .map((video: any) => {
            // Extract video ID from various possible formats
            let videoId = "";
            if (video.videoId) {
              videoId = String(video.videoId);
            } else if (video.id) {
              videoId = String(video.id);
            } else if (video.url && typeof video.url === "string") {
              // Try to extract video ID from YouTube URL
              const match = video.url.match(/[?&]v=([^&]+)/);
              videoId = match ? match[1] : video.url;
            }

            return {
              id: videoId,
              title: video.title || "Unknown Title",
              artist:
                video.uploaderName ||
                video.uploader ||
                video.author ||
                "Unknown Artist",
              duration: video.duration || video.lengthSeconds || 0,
              thumbnail: video.thumbnail || video.thumbnailUrl || "",
              views: String(video.views || video.viewCount || 0),
              uploaded:
                video.uploadedDate || video.uploaded || video.published || "",
            };
          });

        if (validVideos.length > 0) {
          console.log(
            `[API] 🟢 YouTube Playlist Success: Found ${validVideos.length} valid videos`,
          );

          // Use first valid video's thumbnail if playlist thumbnail is not available
          if (!playlistThumbnail && validVideos[0].thumbnail) {
            playlistThumbnail = validVideos[0].thumbnail;
          }

          const result = {
            id: playlistId,
            name: playlistName,
            description: playlistDescription,
            thumbnail: playlistThumbnail,
            videos: validVideos,
          };

          console.log(
            `[API] Returning playlist with ${result.videos.length} videos`,
          );
          return result;
        } else {
          console.warn("[API] No valid videos found after filtering");
        }
      } else {
        console.warn("[API] No videos found in any field");
      }

      // If we reach here, we have data but no valid videos
      console.warn("[API] Invalid playlist response format");
      console.warn("[API] Available data keys:", Object.keys(data));
      console.warn(
        "[API] Data structure preview:",
        JSON.stringify(data).substring(0, 500),
      );
      return null;
    } catch (e: any) {
      console.warn(`[API] 🔴 YouTube Playlist Details Error: ${e.message}`);
      return null;
    }
  },

  searchWithPiped: async (
    query: string,
    filter: string,
    page?: number,
    limit?: number,
    nextpage?: string,
  ) => {
    console.log(
      `[API] Searching Piped: "${query}", page: ${page}, nextpage: ${nextpage ? "present" : "none"}`,
    );

    // Enhanced multilingual search - preserve original query but also try transliterated version
    const searchQueries = [query];

    // Check if query contains non-Latin characters and add transliterated version
    if (/[^\u0000-\u007F]/.test(query)) {
      // For now, just use the original query as-is since Piped/YouTube handles multilingual search well
      // In future, we could add transliteration libraries here
      console.log(`[API] Detected non-Latin characters in query: "${query}"`);
    }

    const filterParam = filter === "" ? "all" : filter;

    // Use nextpage endpoint if we have a nextpage token (for pagination)
    let endpoint: string;
    if (nextpage) {
      console.log(
        `[API] Using nextpage endpoint with token: ${nextpage.substring(0, 50)}...`,
      );
      endpoint = `/nextpage/search?nextpage=${encodeURIComponent(nextpage)}`;
    } else {
      // Initial search
      endpoint = `/search?q=${encodeURIComponent(query)}&filter=${filterParam}`;
    }

    const data = await fetchWithFallbacks([...PIPED_INSTANCES], endpoint);

    // If no results and we have multilingual query, try with relaxed search terms (only for initial search)
    if (
      (!data || !Array.isArray(data.items) || data.items.length === 0) &&
      /[^\u0000-\u007F]/.test(query) &&
      !nextpage
    ) {
      console.log(
        "[API] No results for multilingual query, trying broader search",
      );
      const broadEndpoint = `/search?q=${encodeURIComponent(query)}&filter=all`;
      const broadData = await fetchWithFallbacks(
        [...PIPED_INSTANCES],
        broadEndpoint,
      );
      return {
        items:
          broadData && Array.isArray(broadData.items) ? broadData.items : [],
        nextpage: broadData?.nextpage || null,
      };
    }

    // If no results with specific filter (like "channels"), try with "all" filter as fallback (only for initial search)
    if (
      (!data || !Array.isArray(data.items) || data.items.length === 0) &&
      filterParam !== "all" &&
      !nextpage
    ) {
      console.log(
        `[API] No results with filter "${filterParam}", trying with "all" filter`,
      );
      const fallbackEndpoint = `/search?q=${encodeURIComponent(query)}&filter=all`;
      const fallbackData = await fetchWithFallbacks(
        [...PIPED_INSTANCES],
        fallbackEndpoint,
      );
      return {
        items:
          fallbackData && Array.isArray(fallbackData.items)
            ? fallbackData.items
            : [],
        nextpage: fallbackData?.nextpage || null,
      };
    }

    // Return both items and nextpage token for proper pagination
    return {
      items: data && Array.isArray(data.items) ? data.items : [],
      nextpage: data?.nextpage || null,
    };
  },

  searchWithInvidious: async (
    query: string,
    sortType: string,
    page?: number,
    limit?: number,
  ) => {
    console.log(`[API] Searching Invidious: "${query}", page: ${page || 1}`);
    const sortParam = sortType === "date" ? "upload_date" : "view_count";
    const pageParam = page && page > 1 ? `&page=${page}` : "";
    const endpoint = `/search?q=${encodeURIComponent(
      query,
    )}&sort_by=${sortParam}${pageParam}`;
    const invidiousInstances =
      DYNAMIC_INVIDIOUS_INSTANCES.length > 0
        ? DYNAMIC_INVIDIOUS_INSTANCES
        : [...API.invidious];
    const data = await fetchWithFallbacks(invidiousInstances, endpoint);
    return Array.isArray(data) ? data : [];
  },

  // --- SOUNDCLOUD SEARCH WITH PROXY API ---
  searchWithSoundCloud: async (
    query: string,
    filter?: string,
    page?: number,
    limit?: number,
  ) => {
    try {
      const f = (filter || "").toLowerCase();
      if (f === "playlists" || f === "albums") {
        const type = f === "playlists" ? "playlists" : "albums";
        const collections = await searchAPI.scrapeSoundCloudCollections(
          query,
          type,
          page,
          limit,
        );
        if (!Array.isArray(collections)) {
          return [];
        }
        return collections.map((c: any) => {
          const thumb =
            c.thumbnail ||
            c.artwork ||
            c.artworkUrl ||
            c.image ||
            c.thumbnailUrl ||
            c.img ||
            "";
          return {
            id: c.url || c.id || "",
            title: c.title || c.name || "Unknown",
            author: c.artist || c.author || c.uploader || c.user || "Unknown",
            duration: undefined,
            views: undefined,
            videoCount: c.trackCount || c.tracks || undefined,
            uploaded: undefined,
            thumbnailUrl: thumb,
            img: thumb,
            href: c.url || "",
            source: "soundcloud",
            type: type === "playlists" ? "playlist" : "album",
          };
        });
      }

      const tracks = await searchAPI.scrapeSoundCloudSearch(query, page, limit);
      if (!Array.isArray(tracks)) {
        return [];
      }
      const seenIds = new Set<string>();
      return tracks
        .filter((track) => track && track._isSoundCloud)
        .filter((track) => {
          const trackId = String(track.id);
          if (seenIds.has(trackId)) {
            return false;
          }
          seenIds.add(trackId);
          return true;
        })
        .filter((track) => track.duration && track.duration >= 10000)
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
            type: "song",
          };
        });
    } catch (error) {
      return [];
    }
  },

  searchWithYouTubeMusic: async (
    query: string,
    filter: string,
    page?: number,
    limit?: number,
    nextpage?: string,
  ) => {
    // Map YouTube Music filter names to Piped music filter names
    const musicFilterMap: Record<string, string> = {
      songs: "music_songs",
      videos: "music_videos",
      albums: "music_albums",
      playlists: "music_playlists",
      channels: "music_artists", // UI uses "channels" for artists
      artists: "music_artists",
      all: "music_songs", // Default to songs for "all" in YouTube Music
      "": "music_songs", // Default to songs when no filter is specified
    };

    // Convert the filter to the appropriate YouTube Music filter
    const musicFilter = musicFilterMap[filter] || filter;

    console.log(
      `[API] YouTube Music search: "${query}", filter: "${filter}" -> "${musicFilter}"`,
    );

    return searchAPI.searchWithPiped(query, musicFilter, page, limit, nextpage);
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

        // Handle different ID types (videos, channels, playlists)
        let id = "";
        if (item.url && item.url.includes("/channel/")) {
          // Channel ID
          id = item.url.split("/channel/")[1] || item.channelId || "";
        } else if (
          item.url &&
          (item.url.includes("/playlist?list=") ||
            item.url.includes("/mix?list="))
        ) {
          // Playlist ID or Mix ID
          id = item.url.split("list=")[1] || item.playlistId || "";
        } else if (isPiped) {
          // Video ID
          id = item.url.split("v=")[1] || "";
        } else {
          // Fallback to videoId
          id = item.videoId || "";
        }
        let thumbnailUrl = item.thumbnail || "";
        if (
          !thumbnailUrl &&
          Array.isArray(item.videoThumbnails) &&
          item.videoThumbnails.length > 0
        ) {
          thumbnailUrl = item.videoThumbnails[0].url;
        }

        // Determine item type based on available data
        let itemType: "song" | "album" | "artist" | "playlist" | "unknown" =
          "unknown";

        // Channel detection - previous format
        if (
          item.channelId ||
          item.type === "channel" ||
          (item.url && item.url.includes("/channel/"))
        ) {
          itemType = "artist"; // Channel/artist
        } else if (
          item.playlistId ||
          item.type === "playlist" ||
          (item.url &&
            (item.url.includes("/playlist?list=") ||
              item.url.includes("/mix?list=")))
        ) {
          itemType = "playlist"; // Playlist or Mix
        } else if (
          item.duration ||
          item.lengthSeconds ||
          item.videoId ||
          item.type === "video"
        ) {
          itemType = "song"; // Video/song
        }

        // Handle channel/artist items - JioSaavn style format
        if (itemType === "artist") {
          const result: SearchResult = {
            id,
            title:
              item.name || item.title || item.uploaderName || "Unknown Channel",
            author: item.uploaderName || item.author || "Unknown Artist",
            duration: String(item.duration || item.lengthSeconds || "0"),
            views: String(item.views || item.viewCount || "0"),
            videoCount: undefined, // Channels don't have video count
            uploaded: fmtTimeAgo(
              Number(item.published || item.uploaded || Date.now()),
            ),
            thumbnailUrl,
            img: thumbnailUrl,
            href:
              item.url ||
              (item.channelId ? `/channel/${id}` : `/channel/${id}`),
            source: "jiosaavn", // Use JioSaavn source for proper 1:1 thumbnail display
            type: itemType,
            description: item.description || "", // Add channel description
            verified: item.verified || false, // Add verified badge
          };
          return result;
        }

        // Handle playlist items - previous format
        if (itemType === "playlist") {
          const result: SearchResult = {
            id,
            title: item.title || item.name || "Unknown Playlist",
            author: item.uploaderName || item.author || "Unknown Creator",
            duration: String(item.duration || item.lengthSeconds || "0"),
            views: String(item.views || item.viewCount || "0"),
            videoCount: String(
              item.videoCount && item.videoCount > 0
                ? item.videoCount
                : item.videos && item.videos > 0
                  ? item.videos
                  : "",
            ), // Keep for visual layers but hide badge
            uploaded: fmtTimeAgo(
              Number(item.published || item.uploaded || Date.now()),
            ),
            thumbnailUrl,
            img: thumbnailUrl,
            href:
              item.url ||
              (item.playlistId
                ? `/playlist?list=${id}`
                : `/playlist?list=${id}`),
            source: "youtube",
            type: itemType,
          };
          return result;
        }

        // Handle video/song items (default)
        const result: SearchResult = {
          id,
          title: item.title || "Unknown Title",
          author: item.uploaderName || item.author || "Unknown Artist",
          duration: String(item.duration || item.lengthSeconds || "0"),
          views: String(item.views || item.viewCount || "0"),
          videoCount: undefined,
          uploaded: fmtTimeAgo(
            Number(item.published || item.uploaded || Date.now()),
          ),
          thumbnailUrl,
          img: thumbnailUrl,
          href: item.url || `/watch?v=${id}`,
          source: "youtube",
          type: itemType,
        };
        return result;
      })
      .filter((item): item is SearchResult => {
        if (item === null || item.id === "") {
          return false;
        }

        // Filter out album items for YouTube and YouTube Music sources
        if (
          item.type === "album" &&
          (item.source === "youtube" || item.source === "youtubemusic")
        ) {
          return false;
        }

        // Filter out items with video count of -2
        if (item.videoCount === "-2") {
          return false;
        }

        return true;
      });
  },

  scrapeSoundCloudSearch: async (
    query: string,
    page?: number,
    limit?: number,
  ) => {
    try {
      const pageSize = limit && limit > 0 ? limit : 20;
      const offset = page && page > 1 ? (page - 1) * pageSize : 0;
      const url = `https://proxy.searchsoundcloud.com/tracks?q=${encodeURIComponent(
        query,
      )}&limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      const collection = Array.isArray(data?.collection) ? data.collection : [];
      return collection
        .filter((item: any) => item && item.kind === "track")
        .map((item: any) => ({
          _isSoundCloud: true,
          kind: "track",
          id: item.id,
          title: item.title,
          duration: item.duration,
          playback_count: item.playback_count,
          created_at: item.created_at,
          permalink_url: item.permalink_url,
          artwork_url: item.artwork_url,
          user: {
            username: item.user?.username,
            avatar_url: item.user?.avatar_url,
          },
        }));
    } catch {
      return [];
    }
  },

  scrapeSoundCloudCollections: async (
    query: string,
    type: "playlists" | "albums",
    page?: number,
    limit?: number,
  ) => {
    try {
      const pageSize = limit && limit > 0 ? limit : 20;
      const offset = page && page > 1 ? (page - 1) * pageSize : 0;
      const url = `https://proxy.searchsoundcloud.com/${type}?q=${encodeURIComponent(
        query,
      )}&limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      const items = Array.isArray(data?.collection)
        ? data.collection
        : Array.isArray(data?.results)
          ? data.results
          : Array.isArray(data)
            ? data
            : [];
      return items.map((item: any) => ({
        url: item.permalink_url || item.url || item.permalink || "",
        title: item.title || item.name || "",
        artist: item.artist || item.user?.username || "",
        author:
          item.author ||
          item.artist ||
          item.uploader ||
          item.user?.username ||
          item.creator ||
          "",
        artwork:
          item.artwork_url ||
          item.artwork ||
          item.artworkUrl ||
          item.thumbnail ||
          item.image ||
          item.cover ||
          item.img ||
          item.user?.avatar_url ||
          "",
        trackCount:
          item.track_count ||
          item.trackCount ||
          item.tracksCount ||
          item.tracks?.length ||
          undefined,
      }));
    } catch {
      return [];
    }
  },

  // --- YOUTUBE FALLBACK FUNCTIONS ---

  /**
   * Fallback YouTube search using both Piped and Invidious instances
   * Tries Piped first, then falls back to Invidious if Piped fails
   */
  searchYouTubeWithFallback: async (
    query: string,
    filter: string = "all",
    page?: number,
    limit?: number,
    nextpage?: string,
  ) => {
    console.log(
      `[API] YouTube fallback search: "${query}", filter: "${filter}"`,
    );

    // Try Piped first
    try {
      console.log("[API] Attempting Piped search first...");
      const pipedResults = await searchAPI.searchWithPiped(
        query,
        filter,
        page,
        limit,
        nextpage,
      );
      if (
        pipedResults &&
        Array.isArray(pipedResults.items) &&
        pipedResults.items.length > 0
      ) {
        console.log(
          `[API] Piped search successful, found ${pipedResults.items.length} results`,
        );
        return pipedResults;
      }
      console.log(
        "[API] Piped search returned no results, trying Invidious...",
      );
    } catch (error) {
      console.log("[API] Piped search failed:", error.message);
      console.log("[API] Trying Invidious search...");
    }

    // Fallback to Invidious
    try {
      const invidiousResults = await searchAPI.searchWithInvidious(
        query,
        "relevance",
        page,
        limit,
      );
      if (invidiousResults && invidiousResults.length > 0) {
        console.log(
          `[API] Invidious search successful, found ${invidiousResults.length} results`,
        );
        return {
          items: invidiousResults,
          nextpage: null,
        };
      }
      console.log("[API] Invidious search also returned no results");
    } catch (error) {
      console.log("[API] Invidious search also failed:", error.message);
    }

    console.log("[API] Both Piped and Invidious searches failed");
    return {
      items: [],
      nextpage: null,
    };
  },

  /**
   * Fallback YouTube video info/playback using both Piped and Invidious instances
   * Tries Piped first, then falls back to Invidious if Piped fails
   */
  getYouTubeVideoInfoWithFallback: async (videoId: string) => {
    console.log(`[API] YouTube fallback video info: "${videoId}"`);

    // Use the centralized fallback function
    try {
      const result = await fetchStreamFromPipedWithFallback(videoId);
      console.log("[API] Piped video info successful");
      return {
        success: true,
        source: "piped",
        data: result,
      };
    } catch (pipedError) {
      console.log("[API] Piped video info failed, trying Invidious...");

      try {
        const result = await fetchStreamFromInvidiousWithFallback(videoId);
        console.log("[API] Invidious video info successful");
        return {
          success: true,
          source: "invidious",
          data: result,
        };
      } catch (invidiousError) {
        console.log("[API] Both Piped and Invidious video info failed");
        return {
          success: false,
          source: null,
          data: null,
        };
      }
    }
  },
};
