import React, { useState, useEffect, useRef } from "react";
import { ScrollView, TouchableOpacity } from "react-native";
import styled from "styled-components/native";
import { default as StreamItem } from "../StreamItem";
import { SafeArea } from "../SafeArea";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer, Track } from "../../contexts/PlayerContext";
import {
  FeaturedPlaylistSkeleton,
  CategoryPlaylistSkeleton,
  PreviouslyPlayedSkeleton,
  RecommendationsSkeleton,
} from "../SkeletonLoader";
import {
  getJioSaavnPlaylistEndpoint,
  getJioSaavnPlaylistByIdEndpoint,
  API,
  fetchWithRetry,
  fetchYouTubeMix,
  fetchJioSaavnSuggestions,
  getTrackSource,
  extractYouTubeVideoId,
} from "../core/api";
import { StorageService } from "../../utils/storage";

// API endpoints for your Lowkey Backend
const CATEGORY_APIS = {
  indie: getJioSaavnPlaylistEndpoint("indie"),
  edm: getJioSaavnPlaylistEndpoint("edm"),
  metal: getJioSaavnPlaylistEndpoint("metal"),
  punk: getJioSaavnPlaylistEndpoint("punk"),
  party: getJioSaavnPlaylistEndpoint("party"),
  jazz: getJioSaavnPlaylistEndpoint("jazz"),
  love: getJioSaavnPlaylistEndpoint("love"),
  rap: getJioSaavnPlaylistEndpoint("rap"),
  workout: getJioSaavnPlaylistEndpoint("workout"),
  pop: getJioSaavnPlaylistEndpoint("pop"),
  hiphop: getJioSaavnPlaylistEndpoint("hiphop"),
  rock: getJioSaavnPlaylistEndpoint("rock"),
  melody: getJioSaavnPlaylistEndpoint("melody"),
  lofi: getJioSaavnPlaylistEndpoint("lofi"),
  chill: getJioSaavnPlaylistEndpoint("chill"),
  focus: getJioSaavnPlaylistEndpoint("focus"),
  instrumental: getJioSaavnPlaylistEndpoint("instrumental"),
  folk: getJioSaavnPlaylistEndpoint("folk"),
  devotional: getJioSaavnPlaylistEndpoint("devotional"),
  ambient: getJioSaavnPlaylistEndpoint("ambient"),
  sleep: getJioSaavnPlaylistEndpoint("sleep"),
  soul: getJioSaavnPlaylistEndpoint("soul"),
};

// Featured playlist IDs
const FEATURED_PLAYLIST_IDS = [
  "1265154514",
  "1223482895",
  "2252904",
  "158206266",
  "1210453303",
];

const SOUNDCLOUD_GENRE_CACHE_KEY = "@soundcloud_genre_cache";

const DEFAULT_SOUNDCLOUD_GENRES = [
  "Afro House",
  "Ambient",
  "Deep House",
  "Downtempo",
  "Drum & Bass",
  "Dubstep",
  "Hard Techno",
  "House",
  "Melodic House",
  "Melodic Techno",
  "Minimal",
  "Progressive House",
  "Progressive Trance",
  "Tech House",
  "Techno",
  "Trance",
  "Uplifting Trance",
];

// Existing styled components
const Section = styled.View`
  margin-bottom: 12px;
  margin-top: 12px;
`;

const ChipsContainer = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 16px 0;
`;

const ProfileContainer = styled(LinearGradient).attrs({
  colors: ["rgba(0, 0, 0, 1)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.0)"],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
})`
  width: 28px;
  height: 28px;
  border-radius: 16px;
  margin-left: 16px;
  margin-right: 10px;
  shadow-color: #000;
  shadow-offset: 3px 3px;
  shadow-opacity: 0.4;
  shadow-radius: 6px;
  elevation: 8;
`;

const UserProfileImage = styled.Image`
  width: 100%;
  height: 100%;
  border-radius: 20px;
`;

const ChipsScrollView = styled.ScrollView`
  flex: 1;
  padding-right: 16px;
`;

const ChipsContent = styled.View`
  flex-direction: row;
  align-items: center;
`;

const Chip = styled.TouchableOpacity<{ active?: boolean }>`
  padding: 8px 16px;
  border-radius: 999px;
  background-color: ${(p: { active?: boolean }) =>
    p.active ? "#a3e635" : "#262626"};
  margin-right: 8px;
`;

const ChipText = styled.Text<{ active?: boolean }>`
  color: ${(p: { active?: boolean }) => (p.active ? "#000" : "#fff")};
  font-size: 14px;
  font-family: GoogleSansMedium;
  line-height: 18px;
`;

const SectionHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  margin-bottom: 16px;
`;

const SectionTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  font-family: GoogleSansSemiBold;
  line-height: 22px;
`;

const HorizontalScroll = styled.ScrollView`
  padding: 0 16px;
`;

const Card = styled.TouchableOpacity`
  width: 160px;
  margin-right: 16px;
`;

const CardImage = styled.Image`
  width: 160px;
  height: 160px;
  border-radius: 12px;
`;

const CardTitle = styled.Text`
  color: #fff;
  margin-top: 8px;
  font-size: 14px;
  font-family: GoogleSansMedium;
  line-height: 18px;
`;

const CardMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const Row = styled.View`
  padding: 0 16px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled.Text`
  color: #fff;
  font-size: 18px;
  font-family: GoogleSansSemiBold;
  line-height: 22px;
`;

const SubtitleBtn = styled.TouchableOpacity``;

const SubtitleText = styled.Text`
  color: #a3e635;
  font-family: GoogleSansRegular;
`;

const Horizontal = styled.ScrollView`
  padding: 16px 0 0 16px;
`;

const RecommendationScroll = styled.ScrollView`
  padding: 0 16px;
`;

const RecommendationColumn = styled.View`
  width: 240px;
  margin-right: 16px;
`;

const RecommendationItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  margin-bottom: 12px;
`;

const RecommendationThumb = styled.Image`
  width: 88px;
  height: 88px;
  border-radius: 12px;
`;

const TopRecommendationThumb = styled.Image`
  width: 72px;
  height: 72px;
  border-radius: 10px;
`;

const RecommendationTextWrap = styled.View`
  flex: 1;
  margin-left: 10px;
`;

const RecommendationTitle = styled.Text`
  color: #fff;
  font-size: 13px;
  font-family: GoogleSansMedium;
  line-height: 18px;
`;

const RecommendationMeta = styled.Text`
  color: #a3a3a3;
  font-size: 11px;
  font-family: GoogleSansRegular;
  line-height: 14px;
`;

const TopRecommendationTitle = styled.Text`
  color: #fff;
  font-size: 14px;
  font-family: GoogleSansMedium;
  line-height: 20px;
`;

const TopRecommendationMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const GenreRecommendationThumb = styled.Image`
  width: 54px;
  height: 54px;
  border-radius: 10px;
`;

const ArtistTileWrap = styled.TouchableOpacity`
  width: 160px;
  min-height: 204px;
  margin-right: 16px;
  align-items: center;
`;

const ArtistAvatar = styled.Image`
  width: 160px;
  height: 160px;
  border-radius: 80px;
`;

const ArtistName = styled.Text`
  color: #fff;
  font-size: 13px;
  font-family: GoogleSansMedium;
  line-height: 18px;
  margin-top: 8px;
  text-align: center;
`;
const EmptySectionText = styled.Text`
  color: #a3a3a3;
  font-size: 13px;
  font-family: GoogleSansRegular;
  padding: 0 16px;
  line-height: 18px;
`;

const CollectionWrap = styled.View`
  padding: 0 16px;
  flex-direction: row;
`;

const CollectionCard = styled.View`
  flex: 1;
  flex-direction: row;
  align-items: center;
  background-color: #171717;
  border-radius: 12px;
  padding: 16px;
`;

const CollectionInfo = styled.View`
  flex: 1;
`;

const CollectionTitle = styled.Text`
  color: #fff;
  font-family: GoogleSansSemiBold;
  line-height: 20px;
`;

const CollectionSub = styled.Text`
  color: #a3a3a3;
  margin-top: 4px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const Arrow = styled.Text`
  color: #a3e635;
  margin-top: 8px;
  font-family: GoogleSansMedium;
  line-height: 16px;
`;

const LoadingContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #000;
  padding: 40px 0;
`;

const ErrorText = styled.Text`
  color: #ff4444;
  text-align: center;
  padding: 20px;
  font-family: GoogleSansRegular;
`;

interface Playlist {
  id: string;
  name: string;
  type: string;
  image: Array<{
    quality: string;
    url: string;
  }>;
  url: string;
  songCount: number;
  language: string;
  explicitContent: boolean;
}

interface SuggestedTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
  source: "youtube" | "jiosaavn" | "soundcloud";
}

interface RecentlyPlayedArtist {
  id?: string;
  title: string;
  thumbnailUrl: string;
  source: "youtube" | "jiosaavn" | "soundcloud";
}

export default function HomeScreen({ navigation }: any) {
  const { playTrack, previouslyPlayedSongs } = usePlayer();
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    "all",
  ]);
  const [categoryData, setCategoryData] = useState<{
    [key: string]: Playlist[];
  }>({});
  const [featuredPlaylists, setFeaturedPlaylists] = useState<Playlist[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);

  // Previously played songs and suggestions
  const [previouslyPlayedTracks, setPreviouslyPlayedTracks] = useState<Track[]>(
    []
  );
  const [youtubeMixTracks, setYoutubeMixTracks] = useState<SuggestedTrack[]>(
    []
  );
  const [jiosaavnSuggestions, setJiosaavnSuggestions] = useState<
    SuggestedTrack[]
  >([]);
  const [loadingPreviouslyPlayed, setLoadingPreviouslyPlayed] = useState(true);
  const [loadingYoutubeMix, setLoadingYoutubeMix] = useState(false);
  const [loadingJiosaavnSuggestions, setLoadingJiosaavnSuggestions] =
    useState(false);
  const [soundcloudGenre, setSoundcloudGenre] = useState<string | null>(null);
  const [soundcloudGenreTracks, setSoundcloudGenreTracks] = useState<
    SuggestedTrack[]
  >([]);
  const [loadingSoundcloudGenreTracks, setLoadingSoundcloudGenreTracks] =
    useState(false);
  const [topArtistVideos, setTopArtistVideos] = useState<SuggestedTrack[]>([]);
  const [loadingTopArtistVideos, setLoadingTopArtistVideos] = useState(false);
  const [topArtistName, setTopArtistName] = useState<string>("");
  const [recentlyPlayedArtists, setRecentlyPlayedArtists] = useState<
    RecentlyPlayedArtist[]
  >([]);
  const [loadingRecentlyPlayedArtists, setLoadingRecentlyPlayedArtists] =
    useState(false);
  const lastRecommendationSeedRef = useRef<string | null>(null);
  const hasLoadedSoundcloudGenre = useRef(false);
  const hasLoadedHomeRecommendationsRef = useRef(false);

  const chunkRecommendations = (tracks: SuggestedTrack[], size: number) => {
    const columns: SuggestedTrack[][] = [];
    for (let i = 0; i < tracks.length; i += size) {
      columns.push(tracks.slice(i, i + size));
    }
    return columns;
  };

  // Filter out Hindi/Indian playlists
  // Fetch playlist data for a specific category - COMMENTED OUT
  const fetchCategoryPlaylists = async (category: string) => {
    // Temporarily disabled - no playlist loading
    return;
    /*
    try {
      const data = await fetchWithRetry<any>(
        CATEGORY_APIS[category as keyof typeof CATEGORY_APIS],
        {},
        3,
        1000
      );

      if (data.success && data.data?.results) {
        const playlists = data.data.results.slice(0, 6);
        setCategoryData((prev) => ({ ...prev, [category]: playlists }));
      }
    } catch (error) {
      console.error(`Failed to fetch ${category} playlists:`, error);
    }
    */
  };

  // Fetch featured playlist - COMMENTED OUT
  const fetchFeaturedPlaylists = async () => {
    // Temporarily disabled - no featured playlists loading
    setLoadingFeatured(false);
    return;
    /*
    try {
      setLoadingFeatured(true);

      // Fetch all featured playlists in parallel for faster loading
      const playlistPromises = FEATURED_PLAYLIST_IDS.map(async (playlistId) => {
        try {
          const data = await fetchWithRetry<any>(
            getJioSaavnPlaylistByIdEndpoint(playlistId),
            {},
            3,
            1000
          );

          if (data.success && data.data) {
            return data.data;
          }
          return null;
        } catch (error) {
          console.error(
            `Failed to fetch featured playlist ${playlistId}:`,
            error
          );
          return null;
        }
      });

      // Wait for all playlists to load in parallel
      const featuredData = await Promise.all(playlistPromises);

      // Filter out any null results (failed fetches)
      const validPlaylists = featuredData.filter(
        (playlist) => playlist !== null
      );



      // Transform playlist data to match expected interface
      const transformedPlaylists = validPlaylists.map((playlist) => {
        try {
          // Handle different possible API response formats
          const playlistData = {
            id: playlist.id || playlist.playlistId || "",
            name:
              playlist.name ||
              playlist.title ||
              playlist.playlistName ||
              "Unknown Playlist",
            type: playlist.type || "playlist",
            image:
              playlist.image || playlist.images || playlist.imageUrl
                ? Array.isArray(playlist.image)
                  ? playlist.image
                  : Array.isArray(playlist.images)
                    ? playlist.images
                    : playlist.imageUrl
                      ? [{ quality: "500x500", url: playlist.imageUrl }]
                      : []
                : [],
            url: playlist.url || playlist.permaUrl || "",
            songCount:
              playlist.songCount ||
              playlist.songsCount ||
              playlist.songs?.length ||
              0,
            language: playlist.language || "Unknown",
            explicitContent: playlist.explicitContent || false,
          };

          // If no images found, add a default one
          if (playlistData.image.length === 0) {
            playlistData.image = [
              {
                quality: "500x500",
                url: "https://via.placeholder.com/500x500.png?text=No+Image",
              },
            ];
          }

          return playlistData;
        } catch (error) {

          // Return a default playlist structure if transformation fails
          return {
            id: "error",
            name: "Error Loading Playlist",
            type: "playlist",
            image: [
              {
                quality: "500x500",
                url: "https://via.placeholder.com/500x500.png?text=Error",
              },
            ],
            url: "",
            songCount: 0,
            language: "Unknown",
            explicitContent: false,
          };
        }
      });



      setFeaturedPlaylists(transformedPlaylists);
    } catch (error) {
      console.error("Failed to fetch featured playlists:", error);
    } finally {
      setLoadingFeatured(false);
    }
    */
  };

  // Toggle category selection - COMMENTED OUT
  const toggleCategory = (category: string) => {
    // Temporarily disabled - no category functionality
    return;
    /*
    setSelectedCategories((prev) => {
      // Handle "All" button logic
      if (category === "all") {
        return ["all"];
      }

      // If "All" is currently selected, switch to only the new category
      if (prev.includes("all")) {
        fetchCategoryPlaylists(category);
        return [category];
      }

      // Handle normal category toggling
      const newCategories = prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category];

      // Fetch data for newly selected categories
      if (!prev.includes(category)) {
        fetchCategoryPlaylists(category);
      }

      // If no categories selected, default to "All"
      return newCategories.length === 0 ? ["all"] : newCategories;
    });
    */
  };

  // Load initial data - COMMENTED OUT
  useEffect(() => {
    // Temporarily disabled - no playlist loading on homescreen
    return;
    /*
    // Load featured playlists first (now in parallel for faster loading)
    fetchFeaturedPlaylists();

    // Load categories with a small delay to prioritize featured playlists
    // This ensures featured playlists appear to load first
    const categoryLoadTimeout = setTimeout(() => {
      if (selectedCategories.includes("all")) {
        // Load all categories when "All" is selected
        Object.keys(CATEGORY_APIS).forEach((category) => {
          fetchCategoryPlaylists(category);
        });
      } else {
        // Load only selected categories
        selectedCategories.forEach((category) => {
          fetchCategoryPlaylists(category);
        });
      }
    }, 200); // Small delay to prioritize featured playlists

    return () => clearTimeout(categoryLoadTimeout);
    */
  }, []);

  // Fetch previously played songs and their suggestions
  const fetchPreviouslyPlayedSongs = async (sourceSongs?: Track[]) => {
    try {
      setLoadingPreviouslyPlayed(true);

      const songs = sourceSongs || previouslyPlayedSongs;
      console.log("[HomeScreen] Previously played songs:", songs);

      setPreviouslyPlayedTracks(songs.slice(0, 5));

      if (songs.length > 0) {
        const randomTrack = songs[Math.floor(Math.random() * songs.length)];
        const trackSource = getTrackSource(randomTrack);
        if (trackSource === "youtube") {
          await fetchYouTubeMixRecommendations(randomTrack);
        } else if (trackSource === "jiosaavn") {
          await fetchJioSaavnSuggestionsForTrack(randomTrack);
        }
      }
    } catch (error) {
      console.error("Failed to fetch previously played songs:", error);
    } finally {
      setLoadingPreviouslyPlayed(false);
    }
  };

  const fetchYouTubeMixRecommendations = async (track: Track) => {
    try {
      setLoadingYoutubeMix(true);

      console.log("[HomeScreen] Fetching YouTube mix for track:", track);

      let videoId = track.id;
      console.log("[HomeScreen] Initial videoId:", videoId);

      if (!videoId || videoId.length !== 11) {
        if (videoId && videoId.startsWith("RD") && videoId.length > 11) {
          videoId = videoId.slice(2);
        }
        // Try to extract from audio URL
        if (track.audioUrl) {
          console.log(
            "[HomeScreen] Trying to extract from audioUrl:",
            track.audioUrl
          );
          const extractedId = extractYouTubeVideoId(track.audioUrl);
          console.log("[HomeScreen] Extracted ID:", extractedId);
          if (extractedId) {
            videoId = extractedId;
          } else {
            throw new Error("Could not extract YouTube video ID");
          }
        }
      }

      console.log("[HomeScreen] Final videoId for Mix API:", videoId);

      const mixData = await fetchYouTubeMix(videoId);
      console.log("[HomeScreen] Mix API response:", mixData);

      const mixVideos = Array.isArray(mixData?.videos) ? mixData.videos : [];
      if (mixVideos.length > 0) {
        console.log("[HomeScreen] Found mix videos:", mixVideos.length);
        const suggestedTracks: SuggestedTrack[] = mixVideos
          .filter((video: any) => (video.lengthSeconds || 0) > 0)
          .slice(0, 12)
          .map((video: any) => {
            const thumbnails = Array.isArray(video.videoThumbnails)
              ? video.videoThumbnails
              : [];
            const thumbnail =
              thumbnails[thumbnails.length - 1]?.url ||
              video.thumbnail ||
              video.thumbnailUrl ||
              "";
            return {
              id: String(video.videoId || video.id || video.url || video.title),
              title: video.title,
              artist: video.author || "Unknown Artist",
              thumbnail,
              duration: video.lengthSeconds || video.duration || 0,
              source: "youtube" as const,
            };
          });

        console.log(
          "[HomeScreen] Processed YouTube suggestions:",
          suggestedTracks
        );
        setYoutubeMixTracks(suggestedTracks);
      } else {
        console.log("[HomeScreen] No mix videos found in response");
        setYoutubeMixTracks([]);
      }
    } catch (error) {
      console.error("Failed to fetch YouTube mix:", error);
      setYoutubeMixTracks([]);
    } finally {
      setLoadingYoutubeMix(false);
    }
  };

  // Fetch JioSaavn suggestions for a track
  const fetchJioSaavnSuggestionsForTrack = async (track: Track) => {
    try {
      setLoadingJiosaavnSuggestions(true);

      console.log(
        "[HomeScreen] Fetching JioSaavn suggestions for track:",
        track
      );

      const suggestionsData = await fetchJioSaavnSuggestions(track.id);
      console.log("[HomeScreen] JioSaavn API response:", suggestionsData);

      if (suggestionsData && suggestionsData.data) {
        console.log(
          "[HomeScreen] Found JioSaavn suggestions:",
          suggestionsData.data.length
        );
        const suggestedTracks: SuggestedTrack[] = suggestionsData.data
          .slice(0, 5)
          .map((song: any) => ({
            id: song.id || song.url,
            title: song.name || song.title,
            artist: song.primaryArtists || song.artist || "Unknown Artist",
            thumbnail: song.image?.[0]?.url || song.thumbnail,
            duration: song.duration,
            source: "jiosaavn" as const,
          }));

        console.log(
          "[HomeScreen] Processed JioSaavn suggestions:",
          suggestedTracks
        );
        setJiosaavnSuggestions(suggestedTracks);
      } else {
        console.log("[HomeScreen] No suggestions found in response");
        setJiosaavnSuggestions([]);
      }
    } catch (error) {
      console.error("Failed to fetch JioSaavn suggestions:", error);
      setJiosaavnSuggestions([]);
    } finally {
      setLoadingJiosaavnSuggestions(false);
    }
  };

  const extractBeatseekGenre = (data: any): string | null => {
    const candidates = [
      data?.genre,
      data?.primaryGenre,
      data?.track?.genre,
      data?.track?.primaryGenre,
      data?.metadata?.genre,
      data?.tag,
      data?.tags,
      data?.genres,
      data?.styles,
      data?.style,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
      if (Array.isArray(candidate) && candidate.length > 0) {
        const first = candidate.find(
          (value) => typeof value === "string" && value.trim().length > 0
        );
        if (first) {
          return first.trim();
        }
      }
    }
    return null;
  };

  const fetchBeatseekGenreByTrackId = async (
    trackId: string
  ): Promise<string | null> => {
    const endpoints = [
      `https://beatseek.io/api/track?id=${encodeURIComponent(trackId)}`,
      `https://beatseek.io/api/tracks/${encodeURIComponent(trackId)}`,
    ];
    for (const endpoint of endpoints) {
      try {
        const data = await fetchWithRetry<any>(endpoint, {}, 2, 300);
        const genre = extractBeatseekGenre(data);
        if (genre) {
          return genre;
        }
      } catch (error) {}
    }
    return null;
  };

  const fetchSoundCloudGenreRecommendations = async (
    genre: string
  ): Promise<number> => {
    try {
      setLoadingSoundcloudGenreTracks(true);
      const url = `https://beatseek.io/api/search?query=${encodeURIComponent(
        genre
      )}&platform=soundcloud&type=tracks&sort=both&limit=50`;
      const data = await fetchWithRetry<any>(url, {}, 2, 300);
      const items =
        data?.results || data?.data || data?.items || data?.tracks || [];
      const suggestedTracks: SuggestedTrack[] = (
        Array.isArray(items) ? items : []
      )
        .map((track: any) => {
          const id = track.id || track.trackId || track.url || track.permalink;
          if (!id) {
            return null;
          }
          const title = track.title || track.name || "Unknown Title";
          const artist =
            track.artist ||
            track.user?.username ||
            track.uploader ||
            "Unknown Artist";
          const artwork =
            (track.artwork_url
              ? String(track.artwork_url).replace("large.jpg", "t500x500.jpg")
              : track.artwork) ||
            track.thumbnail ||
            track.image ||
            "";
          const thumbnail = artwork || track.user?.avatar_url || "";
          const duration =
            track.duration || track.lengthSeconds || track.length_seconds || 0;
          return {
            id: String(id),
            title,
            artist,
            thumbnail,
            duration,
            source: "soundcloud" as const,
          } as SuggestedTrack;
        })
        .filter((track): track is SuggestedTrack => !!track)
        .slice(0, 16);
      setSoundcloudGenreTracks(suggestedTracks);
      return suggestedTracks.length;
    } catch (error) {
      setSoundcloudGenreTracks([]);
      return 0;
    } finally {
      setLoadingSoundcloudGenreTracks(false);
    }
  };

  const loadSoundcloudGenreRecommendations = async () => {
    try {
      const cachedGenre = await StorageService.getItem(
        SOUNDCLOUD_GENRE_CACHE_KEY
      );
      const genreToUse =
        cachedGenre && cachedGenre.trim().length > 0
          ? cachedGenre
          : DEFAULT_SOUNDCLOUD_GENRES[
              Math.floor(Math.random() * DEFAULT_SOUNDCLOUD_GENRES.length)
            ];
      if (!genreToUse) {
        return;
      }
      setSoundcloudGenre(genreToUse);
      const count = await fetchSoundCloudGenreRecommendations(genreToUse);
      if (count === 0) {
        const fallbackGenre = DEFAULT_SOUNDCLOUD_GENRES.find(
          (genre) => genre !== genreToUse
        );
        if (fallbackGenre) {
          setSoundcloudGenre(fallbackGenre);
          await fetchSoundCloudGenreRecommendations(fallbackGenre);
        }
      }
    } catch (error) {
      setSoundcloudGenreTracks([]);
    }
  };

  const cacheSoundcloudGenreFromTrack = async (trackId: string) => {
    if (!trackId) {
      return;
    }
    try {
      const genre = await fetchBeatseekGenreByTrackId(trackId);
      if (genre) {
        await StorageService.setItem(SOUNDCLOUD_GENRE_CACHE_KEY, genre);
      }
    } catch (error) {}
  };

  const formatCompactNumber = (count: number) => {
    return Intl.NumberFormat("en", { notation: "compact" }).format(count);
  };

  const resolveYouTubeVideoId = (track: Track) => {
    let videoId = track.id;
    if (!videoId || videoId.length !== 11) {
      if (videoId && videoId.startsWith("RD") && videoId.length > 11) {
        videoId = videoId.slice(2);
      }
      if (track.audioUrl) {
        const extractedId = extractYouTubeVideoId(track.audioUrl);
        if (extractedId) {
          videoId = extractedId;
        }
      }
    }
    return videoId && videoId.length === 11 ? videoId : "";
  };

  const fetchRecentlyPlayedArtists = async (sourceSongs?: Track[]) => {
    try {
      setLoadingRecentlyPlayedArtists(true);
      const artists: RecentlyPlayedArtist[] = [];
      const seen = new Set<string>();
      const songs = sourceSongs || previouslyPlayedSongs;
      for (const track of songs) {
        const isSC = track._isSoundCloud || track.source === "soundcloud";
        const isJS = track._isJioSaavn || track.source === "jiosaavn";
        if (!isSC && !isJS) {
          continue;
        }
        const source = isSC ? "soundcloud" : "jiosaavn";
        const title = track.artist || "";
        if (!title) {
          continue;
        }
        const key = `${source}:${title.toLowerCase()}`;
        if (seen.has(key)) {
          continue;
        }
        const thumbnailUrl = track.thumbnail || "";
        artists.push({
          title,
          thumbnailUrl,
          source,
        });
        seen.add(key);
      }

      const youtubeTracks = songs.filter(
        (track) => getTrackSource(track) === "youtube"
      );
      if (youtubeTracks.length > 0) {
        const { searchAPI } = await import("../../modules/searchAPI");
        for (const track of youtubeTracks) {
          const videoId = resolveYouTubeVideoId(track);
          if (!videoId) {
            continue;
          }
          const info = await searchAPI.getYouTubeVideoInfoWithFallback(videoId);
          const uploaderUrl =
            (info?.data as any)?.uploaderUrl ||
            (info?.data as any)?.authorUrl ||
            "";
          let channelId = "";
          if (
            typeof uploaderUrl === "string" &&
            uploaderUrl.includes("/channel/")
          ) {
            const parts = uploaderUrl.split("/channel/");
            channelId = parts[1] || "";
          }
          if (!channelId) {
            continue;
          }
          const key = `youtube:${channelId}`;
          if (seen.has(key)) {
            continue;
          }
          const channelData = await fetchWithRetry<any>(
            `${API.piped[0]}/channel/${channelId}`,
            {},
            2,
            800
          );
          const channelName = (channelData?.name || "").replace(
            /\s*-\s*Topic$/i,
            ""
          );
          artists.push({
            id: channelId,
            title: channelName || "Unknown Channel",
            thumbnailUrl: channelData?.avatarUrl || "",
            source: "youtube",
          });
          seen.add(key);
          if (artists.length >= 10) {
            break;
          }
        }
      }

      setRecentlyPlayedArtists(artists);
    } catch (error) {
      setRecentlyPlayedArtists([]);
    } finally {
      setLoadingRecentlyPlayedArtists(false);
    }
  };

  const fetchTopArtistVideosForYouTubeTrack = async (track: Track) => {
    try {
      setLoadingTopArtistVideos(true);
      const videoId = resolveYouTubeVideoId(track);
      if (!videoId) {
        setTopArtistVideos([]);
        setTopArtistName("");
        return;
      }
      const { searchAPI } = await import("../../modules/searchAPI");
      const info = await searchAPI.getYouTubeVideoInfoWithFallback(videoId);
      const uploaderUrl =
        (info?.data as any)?.uploaderUrl ||
        (info?.data as any)?.authorUrl ||
        "";
      const uploaderName =
        (info?.data as any)?.uploader ||
        (info?.data as any)?.author ||
        track.artist ||
        "";
      let channelId = "";
      if (
        typeof uploaderUrl === "string" &&
        uploaderUrl.includes("/channel/")
      ) {
        const parts = uploaderUrl.split("/channel/");
        channelId = parts[1] || "";
      }
      if (!channelId) {
        setTopArtistVideos([]);
        setTopArtistName("");
        return;
      }
      const channelData = await fetchWithRetry<any>(
        `${API.piped[0]}/channel/${channelId}`,
        {},
        3,
        1000
      );
      const streams = Array.isArray(channelData?.relatedStreams)
        ? channelData.relatedStreams
        : [];
      const getViewCount = (value: any) => {
        if (typeof value === "number") {
          return value;
        }
        if (typeof value === "string") {
          const numeric = Number(value.replace(/[^0-9]/g, ""));
          return Number.isNaN(numeric) ? 0 : numeric;
        }
        return 0;
      };
      const sorted = streams
        .slice()
        .sort(
          (a: any, b: any) => getViewCount(b.views) - getViewCount(a.views)
        );
      const top = sorted.slice(0, 12).map((video: any) => {
        const id =
          (video.url && video.url.split("v=")[1]) ||
          video.videoId ||
          video.id ||
          "";
        const thumbnails = Array.isArray(video.videoThumbnails)
          ? video.videoThumbnails
          : [];
        const thumbnail =
          thumbnails[thumbnails.length - 1]?.url ||
          video.thumbnail ||
          video.thumbnailUrl ||
          "";
        return {
          id: String(id || video.title),
          title: video.title,
          artist: uploaderName || "Unknown Artist",
          thumbnail,
          duration: video.lengthSeconds || video.duration || 0,
          source: "youtube" as const,
        } as SuggestedTrack;
      });
      setTopArtistVideos(
        top.filter((t) => t.thumbnail && t.thumbnail.length > 0)
      );
      setTopArtistName(uploaderName);
    } catch (error) {
      setTopArtistVideos([]);
      setTopArtistName("");
    } finally {
      setLoadingTopArtistVideos(false);
    }
  };

  useEffect(() => {
    const loadHomeRecommendations = async () => {
      if (hasLoadedHomeRecommendationsRef.current) {
        return;
      }
      hasLoadedHomeRecommendationsRef.current = true;
      const savedPreviouslyPlayed =
        await StorageService.loadPreviouslyPlayedSongs();
      if (!savedPreviouslyPlayed || savedPreviouslyPlayed.length === 0) {
        setPreviouslyPlayedTracks([]);
        setTopArtistVideos([]);
        setTopArtistName("");
        setRecentlyPlayedArtists([]);
        setSoundcloudGenreTracks([]);
        setSoundcloudGenre(null);
        return;
      }
      const latestSeedId = savedPreviouslyPlayed[0]?.id || null;
      if (latestSeedId) {
        lastRecommendationSeedRef.current = latestSeedId;
      }
      await fetchPreviouslyPlayedSongs(savedPreviouslyPlayed);
      const hasRecommendations = savedPreviouslyPlayed.slice(0, 5).length > 0;
      if (!hasRecommendations) {
        return;
      }

      const latestYoutube = savedPreviouslyPlayed.find(
        (t) => getTrackSource(t) === "youtube"
      );
      if (latestYoutube) {
        await fetchTopArtistVideosForYouTubeTrack(latestYoutube);
      } else {
        setTopArtistVideos([]);
        setTopArtistName("");
      }
      const hasTopSongs = topArtistVideos.length > 0;

      await fetchRecentlyPlayedArtists(savedPreviouslyPlayed);

      const soundcloudCount = savedPreviouslyPlayed.filter(
        (t) => t._isSoundCloud || t.source === "soundcloud"
      ).length;
      if (
        hasTopSongs &&
        soundcloudCount > 0 &&
        !hasLoadedSoundcloudGenre.current
      ) {
        hasLoadedSoundcloudGenre.current = true;
        await loadSoundcloudGenreRecommendations();
      } else if (soundcloudCount === 0) {
        setSoundcloudGenreTracks([]);
        setSoundcloudGenre(null);
      }
    };
    const unsubscribe = navigation.addListener("focus", () => {
      loadHomeRecommendations();
    });
    loadHomeRecommendations();
    return unsubscribe;
  }, [navigation]);

  const handlePlayTrack = (track: any) => {
    if (!track) {
      return;
    }
    const isSoundCloud = track._isSoundCloud || track.source === "soundcloud";
    if (isSoundCloud && track.id) {
      cacheSoundcloudGenreFromTrack(String(track.id));
    }
    if (track.title || track.artist) {
      playTrack({
        id: track.id,
        title: track.title || track.name,
        artist: track.artist || track.artists?.[0]?.name || "Unknown Artist",
        duration:
          typeof track.duration === "number"
            ? track.duration
            : track.duration_ms || 0,
        thumbnail:
          track.thumbnail ||
          track.album?.images?.[0]?.url ||
          track.artwork_url ||
          "",
        audioUrl: track.audioUrl || track.preview_url,
        source: track.source,
        _isSoundCloud: isSoundCloud,
        _isJioSaavn: track._isJioSaavn,
      });
      return;
    }
    if (track.name && track.artists && track.preview_url) {
      playTrack({
        id: track.id,
        title: track.name,
        artist: track.artists[0]?.name || "Unknown Artist",
        audioUrl: track.preview_url,
        thumbnail: track.album?.images[0]?.url || "",
        duration: track.duration_ms,
      });
    }
  };

  const handleArtistPress = (artist: RecentlyPlayedArtist) => {
    if (artist.source !== "youtube" || !artist.id) {
      return;
    }
    navigation.navigate("Artist", {
      artistId: artist.id,
      artistName: artist.title,
    });
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    if (playlist && playlist.id) {
      console.log("Playing playlist:", playlist.name);
      navigation.navigate("Playlist", {
        playlistId: playlist.id,
        playlistName: playlist.name,
      });
    }
  };

  const handlePlaySuggestedTrack = (track: SuggestedTrack) => {
    const trackToPlay: Track = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      thumbnail: track.thumbnail,
      duration: track.duration,
      source: track.source,
      _isJioSaavn: track.source === "jiosaavn",
      _isSoundCloud: track.source === "soundcloud",
    };

    if (track.source === "soundcloud") {
      cacheSoundcloudGenreFromTrack(track.id);
    }
    playTrack(trackToPlay);
  };

  const getPlaylistImageSource = (playlist: Playlist) => {
    try {
      // Ensure playlist.image is an array
      const imageArray = Array.isArray(playlist.image) ? playlist.image : [];

      const highQualityImage = imageArray.find(
        (img) => img && img.quality === "500x500"
      );
      const imageUrl = highQualityImage?.url || imageArray[0]?.url;

      // Return the image URL as URI or fallback image source
      if (imageUrl) {
        return { uri: imageUrl };
      } else {
        return require("../../assets/StreamifyLogo.png");
      }
    } catch (error) {
      return require("../../assets/StreamifyLogo.png");
    }
  };

  const formatSongCount = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k songs`;
    }
    return `${count} songs`;
  };

  const recommendationColumns = chunkRecommendations(youtubeMixTracks, 4);
  const soundcloudGenreColumns = chunkRecommendations(soundcloudGenreTracks, 2);
  const topArtistColumns = chunkRecommendations(topArtistVideos, 3);
  const hasPreviouslyPlayed = previouslyPlayedSongs.length > 0;
  const soundcloudPlayedCount = previouslyPlayedSongs.filter(
    (t) => t._isSoundCloud || t.source === "soundcloud"
  ).length;
  const youtubePlayedCount = previouslyPlayedSongs.filter(
    (t) => getTrackSource(t) === "youtube"
  ).length;

  return (
    <SafeArea>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Header with Category Chips */}
        <ChipsContainer>
          <ProfileContainer>
            <UserProfileImage
              source={require("../../assets/StreamifyLogo.png")}
            />
          </ProfileContainer>
          <ChipsScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
          >
            <ChipsContent>
              {/* All Button */}
              <Chip
                key="all"
                active={selectedCategories.includes("all")}
                onPress={() => toggleCategory("all")}
              >
                <ChipText active={selectedCategories.includes("all")}>
                  All
                </ChipText>
              </Chip>
              {Object.keys(CATEGORY_APIS).map((category) => (
                <Chip
                  key={category}
                  active={selectedCategories.includes(category)}
                  onPress={() => toggleCategory(category)}
                >
                  <ChipText active={selectedCategories.includes(category)}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </ChipText>
                </Chip>
              ))}
            </ChipsContent>
          </ChipsScrollView>
        </ChipsContainer>
        {/* Featured Playlists - COMMENTED OUT */}
        {/*
        <Section>
          <SectionHeader>
            <SectionTitle>Featured Playlists</SectionTitle>
          </SectionHeader>
          {loadingFeatured ? (
            <FeaturedPlaylistSkeleton />
          ) : (
            <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
              {featuredPlaylists.map((playlist) => (
                <Card
                  key={playlist.id}
                  onPress={() => handlePlayPlaylist(playlist)}
                >
                  <CardImage source={getPlaylistImageSource(playlist)} />
                  <CardTitle numberOfLines={2}>{playlist.name}</CardTitle>
                  <CardMeta>
                    {formatSongCount(playlist.songCount)} • {playlist.language}
                  </CardMeta>
                </Card>
              ))}
            </HorizontalScroll>
          )}
        </Section>
        */}
        {/* Selected Category Playlists - COMMENTED OUT */}
        {/*
        {(selectedCategories.includes("all")
          ? Object.keys(CATEGORY_APIS)
          : selectedCategories
        ).map((category) => {
          const playlists = categoryData[category] || [];
          return (
            <Section key={category}>
              <SectionHeader>
                <SectionTitle>
                  {category.charAt(0).toUpperCase() + category.slice(1)}{" "}
                  Playlists
                </SectionTitle>
              </SectionHeader>
              {playlists.length === 0 ? (
                <CategoryPlaylistSkeleton />
              ) : (
                <HorizontalScroll
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  {playlists.map((playlist) => (
                    <Card
                      key={playlist.id}
                      onPress={() => handlePlayPlaylist(playlist)}
                    >
                      <CardImage source={getPlaylistImageSource(playlist)} />
                      <CardTitle numberOfLines={2}>{playlist.name}</CardTitle>
                      <CardMeta>
                        {formatSongCount(playlist.songCount)} •{" "}
                        {playlist.language}
                      </CardMeta>
                    </Card>
                  ))}
                </HorizontalScroll>
              )}
            </Section>
          );
        })}
        */}

        <Section>
          <SectionHeader>
            <SectionTitle>Recommendations</SectionTitle>
          </SectionHeader>
          {loadingYoutubeMix ? (
            <RecommendationsSkeleton />
          ) : youtubeMixTracks.length > 0 ? (
            <RecommendationScroll
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {recommendationColumns.map((column, columnIndex) => (
                <RecommendationColumn key={`rec-col-${columnIndex}`}>
                  {column.map((track) => (
                    <RecommendationItem
                      key={track.id}
                      onPress={() => handlePlaySuggestedTrack(track)}
                    >
                      <GenreRecommendationThumb
                        source={
                          track.thumbnail
                            ? { uri: track.thumbnail }
                            : require("../../assets/StreamifyLogo.png")
                        }
                      />
                      <RecommendationTextWrap>
                        <TopRecommendationTitle numberOfLines={2}>
                          {track.title}
                        </TopRecommendationTitle>
                        <TopRecommendationMeta numberOfLines={1}>
                          {track.artist}
                        </TopRecommendationMeta>
                      </RecommendationTextWrap>
                    </RecommendationItem>
                  ))}
                </RecommendationColumn>
              ))}
            </RecommendationScroll>
          ) : (
            <EmptySectionText>
              Stream a song from YouTube to see recommendations.
            </EmptySectionText>
          )}
        </Section>

        {hasPreviouslyPlayed && (
          <Section>
            <SectionHeader>
              <SectionTitle>Recently Played</SectionTitle>
            </SectionHeader>
            {loadingRecentlyPlayedArtists ? (
              <RecommendationsSkeleton />
            ) : (
              <HorizontalScroll
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {recentlyPlayedArtists.slice(0, 3).map((artist) => (
                  <ArtistTileWrap
                    key={artist.id || `${artist.source}:${artist.title}`}
                    onPress={() => handleArtistPress(artist)}
                  >
                    <ArtistAvatar
                      source={
                        artist.thumbnailUrl
                          ? { uri: artist.thumbnailUrl }
                          : require("../../assets/StreamifyLogo.png")
                      }
                    />
                    <ArtistName numberOfLines={2}>{artist.title}</ArtistName>
                  </ArtistTileWrap>
                ))}
                {previouslyPlayedTracks.map((track) => (
                  <Card key={track.id} onPress={() => handlePlayTrack(track)}>
                    <CardImage
                      source={
                        track.thumbnail
                          ? { uri: track.thumbnail }
                          : require("../../assets/StreamifyLogo.png")
                      }
                    />
                    <CardTitle numberOfLines={2}>{track.title}</CardTitle>
                    <CardMeta>{track.artist}</CardMeta>
                  </Card>
                ))}
              </HorizontalScroll>
            )}
            {!loadingPreviouslyPlayed &&
              previouslyPlayedTracks.length === 0 && (
                <EmptySectionText>
                  Play a song to see your recently played tracks here.
                </EmptySectionText>
              )}
          </Section>
        )}

        {youtubePlayedCount > 0 && (
          <Section>
            <SectionHeader>
              <SectionTitle>
                {topArtistName ? `Top songs • ${topArtistName}` : "Top songs"}
              </SectionTitle>
            </SectionHeader>
            {loadingTopArtistVideos ? (
              <RecommendationsSkeleton />
            ) : topArtistVideos.length > 0 ? (
              <RecommendationScroll
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {topArtistColumns.map((column, columnIndex) => (
                  <RecommendationColumn key={`top-col-${columnIndex}`}>
                    {column.map((track) => (
                      <RecommendationItem
                        key={track.id}
                        onPress={() => handlePlaySuggestedTrack(track)}
                      >
                        <TopRecommendationThumb
                          source={
                            track.thumbnail
                              ? { uri: track.thumbnail }
                              : require("../../assets/StreamifyLogo.png")
                          }
                        />
                        <RecommendationTextWrap>
                          <TopRecommendationTitle numberOfLines={2}>
                            {track.title}
                          </TopRecommendationTitle>
                          <TopRecommendationMeta numberOfLines={1}>
                            {track.artist}
                          </TopRecommendationMeta>
                        </RecommendationTextWrap>
                      </RecommendationItem>
                    ))}
                  </RecommendationColumn>
                ))}
              </RecommendationScroll>
            ) : (
              <EmptySectionText>
                Play a song from YouTube to see top songs by the artist.
              </EmptySectionText>
            )}
          </Section>
        )}

        <Section>
          <SectionHeader>
            <SectionTitle>
              {soundcloudGenre
                ? `Similar genres to your taste • ${soundcloudGenre}`
                : "Similar genres to your taste"}
            </SectionTitle>
          </SectionHeader>
          {loadingSoundcloudGenreTracks ? (
            <RecommendationsSkeleton />
          ) : soundcloudGenreTracks.length > 0 ? (
            <RecommendationScroll
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {soundcloudGenreColumns.map((column, columnIndex) => (
                <RecommendationColumn key={`genre-col-${columnIndex}`}>
                  {column.map((track) => (
                    <RecommendationItem
                      key={track.id}
                      onPress={() => handlePlaySuggestedTrack(track)}
                    >
                      <GenreRecommendationThumb
                        source={
                          track.thumbnail
                            ? { uri: track.thumbnail }
                            : require("../../assets/StreamifyLogo.png")
                        }
                      />
                      <RecommendationTextWrap>
                        <TopRecommendationTitle numberOfLines={2}>
                          {track.title}
                        </TopRecommendationTitle>
                        <TopRecommendationMeta numberOfLines={1}>
                          {track.artist}
                        </TopRecommendationMeta>
                      </RecommendationTextWrap>
                    </RecommendationItem>
                  ))}
                </RecommendationColumn>
              ))}
            </RecommendationScroll>
          ) : soundcloudPlayedCount === 0 ? (
            <EmptySectionText>
              Play a song from SoundCloud to see this section.
            </EmptySectionText>
          ) : null}
        </Section>

        {/*
          <Section>
            <SectionHeader>
              <SectionTitle>Recommended for You</SectionTitle>
            </SectionHeader>
            {loadingJiosaavnSuggestions ? (
              <YouTubeMixSkeleton />
            ) : (
              <HorizontalScroll
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {jiosaavnSuggestions.map((track) => (
                  <Card
                    key={track.id}
                    onPress={() => handlePlaySuggestedTrack(track)}
                  >
                    <CardImage
                      source={
                        track.thumbnail
                          ? { uri: track.thumbnail }
                          : require("../../assets/StreamifyLogo.png")
                      }
                    />
                    <CardTitle numberOfLines={2}>{track.title}</CardTitle>
                    <CardMeta>{track.artist}</CardMeta>
                  </Card>
                ))}
              </HorizontalScroll>
            )}
          </Section>
        */}
      </ScrollView>
    </SafeArea>
  );
}
