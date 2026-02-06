import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  memo,
} from "react";
import {
  Keyboard,
  TouchableOpacity,
  View,
  TouchableWithoutFeedback,
  Platform,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Text,
} from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { default as StreamItem } from "../StreamItem";
import { searchAPI } from "../../modules/searchAPI";
import { SafeArea } from "../SafeArea";
import { usePlayer } from "../../contexts/PlayerContext";
import { t } from "../../utils/localization";

const { Animated } = require("react-native");

// --- Optimized Search Section Component ---

interface SearchSectionProps {
  items: any[];
  title: string;
  searchQuery: string;
  onItemPress: (item: any) => void;
  navigation: any;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  playTrack: (track: any, playlist: any[], index: number) => Promise<void>;
  searchResults: any[];
  selectedFilter?: string;
  selectedSource?: string;
}

// Helper function for formatting duration
const formatDuration = (seconds: number, source?: string): string => {
  if (seconds === 0) {
    // Never show LIVE badge for any source when duration is 0
    return "";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

// --- Styled Components ---

const Header = styled.View`
  padding: 16px;
  flex-direction: row;
  align-items: center;
`;

const SearchContainer = styled.View`
  flex: 1;
  flex-direction: row;
  align-items: center;
  background-color: #262626;
  border-radius: 24px;
  padding-right: 8px;
`;

const SearchInput = styled.TextInput`
  flex: 1;
  height: 48px;
  padding-horizontal: 16px;
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansRegular;
  text-align-vertical: center;
  include-font-padding: false;
  vertical-align: middle;
`;

const ClearButton = styled.TouchableOpacity`
  padding: 8px;
  margin-right: 4px;
  opacity: ${(props) => (props.disabled ? 0.3 : 1)};
`;

const ResultsContainer = styled.ScrollView`
  flex: 1;
  padding: 0px 10px 0px 10px;
`;

const SkeletonRow = styled.View`
  flex-direction: row;
  padding-vertical: 10px;
  align-items: center;
`;

const SkeletonThumbnail = styled.View`
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background-color: #404040;
  margin-right: 12px;
`;

const SkeletonTextBlock = styled.View`
  flex: 1;
`;

const SkeletonLinePrimary = styled.View`
  width: 100%;
  height: 16px;
  border-radius: 8px;
  background-color: #404040;
  margin-bottom: 6px;
`;

const SkeletonLineSecondary = styled.View`
  height: 12px;
  border-radius: 6px;
  background-color: #262626;
  width: 100%;
`;

const NoResultsText = styled.Text`
  color: #a3a3a3;
  text-align: center;
  margin-top: 32px;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const SourceButton = styled.TouchableOpacity<{
  active?: boolean;
  color?: string;
}>`
  padding: 8px 20px;
  height: 36px;
  border-radius: 18px; /* Full Pill Shape */
  background-color: ${(p) => (p.active ? p.color || "#fff" : "#262626")};
  margin-right: 8px;
  align-items: center;
  justify-content: center;
`;

const SourceButtonText = styled.Text<{ active?: boolean }>`
  color: ${(p) =>
    p.active ? "#000" : "#a3a3a3"}; /* Black text on active color */
  font-size: 13px;
  text-transform: uppercase;
  font-family: GoogleSansBold;
  line-height: 13px;
`;

// --- FIXED: Sub-Filter Styles ---
const FilterContainer = styled.ScrollView`
  max-height: 50px;
  margin-bottom: 8px;
`;

const FilterButton = styled.TouchableOpacity<{ active?: boolean }>`
  padding: 6px 18px;
  height: 32px;
  border-radius: 16px; /* Consistent Pill Shape */
  /* Active = White, Inactive = Dark Grey (Cleaner than border) */
  background-color: ${(p) => (p.active ? "#fff" : "#262626")};
  margin-right: 8px;
  align-items: center;
  justify-content: center;
  min-width: 50px; /* Prevents "All" from looking squashed */
`;

const FilterButtonText = styled.Text<{ active?: boolean }>`
  color: ${(p) => (p.active ? "#000" : "#fff")}; /* High contrast */
  font-size: 13px;
  text-transform: uppercase;
  font-family: GoogleSansBold;
  line-height: 14px;
  text-align: center;
  include-font-padding: false;
`;

// --- SECTION STYLES ---
const SectionContainer = styled.View`
  margin-bottom: 16px;
`;

const SectionTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  margin-left: 16px;
  font-family: GoogleSansBold;
`;

const SuggestionsOverlay = styled.View`
  position: absolute;
  top: 110px;
  left: 16px;
  right: 16px;
  background-color: #262626;
  border-radius: 12px;
  z-index: 100;
  elevation: 5;
  overflow: hidden;
`;

const SuggestionItem = styled.TouchableOpacity`
  padding: 14px 16px;
  border-bottom-width: 1px;
  border-bottom-color: #404040;
  flex-direction: row;
  align-items: center;
`;

const SuggestionText = styled.Text`
  color: #fff;
  font-size: 16px;
  margin-left: 10px;
  font-family: GoogleSansRegular;
`;

const SuggestionIcon = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
  font-family: GoogleSansRegular;
`;

// --- OPTIMIZED MEMOIZED COMPONENTS ---

const MemoizedStreamItem = memo(StreamItem);

interface SearchSectionProps {
  items: any[];
  title: string;
  searchQuery: string;
  onItemPress: (item: any) => void;
  navigation: any;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  playTrack: (track: any, playlist: any[], index: number) => Promise<void>;
  searchResults: any[];
}

const SearchSection = memo(
  ({
    items,
    title,
    searchQuery,
    onItemPress,
    navigation,
    showSuggestions,
    setShowSuggestions,
    playTrack,
    searchResults,
    selectedFilter,
    selectedSource,
  }: SearchSectionProps) => {
    if (items.length === 0) {
      return null;
    }

    const renderItem = useCallback(
      ({ item }: { item: any }) => (
        <TouchableOpacity
          key={`${item.source || "yt"}-${item.id}`}
          onPress={() => onItemPress(item)}
        >
          <MemoizedStreamItem
            id={item.id}
            title={item.title}
            author={item.author}
            duration={formatDuration(parseInt(item.duration) || 0, item.source)}
            views={
              item.source === "jiosaavn" ||
              (selectedSource === "youtubemusic" &&
                selectedFilter === "songs") ||
              item.views === "-1" ||
              item.views === "0"
                ? undefined
                : item.views
            }
            videoCount={item.videoCount}
            uploaded={item.uploaded}
            thumbnailUrl={item.thumbnailUrl}
            isAlbum={!!item.albumId}
            albumYear={item.albumYear}
            source={item.source}
            type={item.type}
            channelDescription={item.description}
            verified={item.verified}
            searchFilter={selectedFilter}
            searchSource={selectedSource}
          />
        </TouchableOpacity>
      ),
      [onItemPress]
    );

    return (
      <SectionContainer>
        <SectionTitle>{title}</SectionTitle>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.source || "yt"}-${item.id}`}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          windowSize={5}
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          removeClippedSubviews={true}
          getItemLayout={(data, index) => ({
            length: 80,
            offset: 80 * index,
            index,
          })}
        />
      </SectionContainer>
    );
  }
);

type SourceType =
  | "youtube"
  | "youtubemusic"
  | "soundcloud"
  | "spotify"
  | "jiosaavn";

// --- Interfaces ---

interface SearchResult {
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
  source?:
    | "youtube"
    | "soundcloud"
    | "jiosaavn"
    | "youtube_channel"
    | "youtubemusic";
  type?: "song" | "album" | "artist" | "playlist" | "unknown";
  albumId?: string;
  albumName?: string;
  albumYear?: string;
}

const sourceFilters: { id: SourceType; label: string; color: string }[] = [
  { id: "youtube", label: "YouTube", color: "#ff0000" }, // YouTube Red
  { id: "youtubemusic", label: "YouTube Music", color: "#ff0000" }, // YouTube Red
  { id: "soundcloud", label: "SoundCloud", color: "#ff7700" }, // SC Orange
  { id: "spotify", label: "Spotify", color: "#1db954" }, // Spotify Green
  { id: "jiosaavn", label: "JioSaavn", color: "#1fa18a" }, // JioSaavn Orange
];

const searchFilters = [
  { value: "", label: "All" },
  { value: "videos", label: "Videos" },
  { value: "channels", label: "Channels" },
  { value: "playlists", label: "Playlists" },
];

const youtubeMusicFilters = [
  { value: "songs", label: "Songs" },
  { value: "videos", label: "Videos" },
  { value: "albums", label: "Albums" },
  { value: "playlists", label: "Playlists" },
  { value: "channels", label: "Artists" },
];

const soundCloudFilters = [
  { value: "tracks", label: "Tracks" },
  { value: "playlists", label: "Playlists" },
  { value: "albums", label: "Albums" },
];

const jioSaavnFilters = [
  { value: "", label: "All" },
  { value: "songs", label: "Songs" },
  { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists" },
];

// --- Main Component ---

export default function SearchScreen({ navigation }: any) {
  // Enable layout animations
  useEffect(() => {
    if (Platform.OS === "android") {
      // Layout animation is enabled by default in modern React Native
    }
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { playTrack } = usePlayer();

  // Ref for preserving scroll position during load more
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Restore search results when returning from PlayerScreen
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      // Don't clear results when returning from PlayerScreen
      if (searchResults.length === 0 && searchQuery.trim()) {
        handleSearch(searchQuery);
      }
    });

    return unsubscribe;
  }, [navigation, searchResults.length, searchQuery]);

  // State for source filters with reordering
  const [sourceFilters, setSourceFilters] = useState([
    { id: "youtube" as SourceType, label: "YouTube", color: "#ff0000" },
    {
      id: "youtubemusic" as SourceType,
      label: "YouTube Music",
      color: "#ff0000",
    },
    { id: "soundcloud" as SourceType, label: "SoundCloud", color: "#ff7700" },
    { id: "jiosaavn" as SourceType, label: "JioSaavn", color: "#1fa18a" },
    { id: "spotify" as SourceType, label: "Spotify", color: "#1db954" },
  ]);

  const [selectedSource, setSelectedSource] = useState<SourceType>("youtube");
  const [selectedFilter, setSelectedFilter] = useState("");

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const filterChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSearchRef = useRef<{
    query: string;
    source: SourceType;
    filter: string;
  } | null>(null);
  const paginationRef = useRef({
    page: 1,
    hasMore: true,
    isLoadingMore: false,
    nextpage: null as string | null,
  });

  const retryRef = useRef({
    attempts: 0,
    maxAttempts: 3,
  });

  const skeletonPulse = useRef(new Animated.Value(0)).current;
  const skeletonAnimationRef = useRef<any>(null);

  useEffect(() => {
    if (isLoading) {
      if (skeletonAnimationRef.current) {
        skeletonAnimationRef.current.stop();
      }
      skeletonPulse.setValue(0);
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(skeletonPulse, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(skeletonPulse, {
            toValue: 0,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      skeletonAnimationRef.current = animation;
      animation.start();
    } else {
      if (skeletonAnimationRef.current) {
        skeletonAnimationRef.current.stop();
        skeletonAnimationRef.current = null;
      }
    }
  }, [isLoading, skeletonPulse]);

  // --- Helper Functions ---

  function shortCount(num: number | string): string {
    const n = typeof num === "string" ? parseInt(num, 10) : num;
    if (Number.isNaN(n)) {
      return "";
    }
    if (n < 1000) {
      return n.toString();
    }
    if (n < 1000000) {
      return `${(n / 1000).toFixed(1).replace(".0", "")}K`;
    }
    if (n < 1000000000) {
      return `${(n / 1000000).toFixed(1).replace(".0", "")}M`;
    }
    return `${(n / 1000000000).toFixed(1).replace(".0", "")}B`;
  }

  const skeletonOpacity = skeletonPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  // --- Search Handling ---

  const handleSearch = useCallback(
    async (manualQuery?: string, loadMore: boolean = false) => {
      const queryToUse = manualQuery || searchQuery;

      if (!queryToUse.trim()) {
        return;
      }

      const last = lastSearchRef.current;

      // For new searches (not load more), check if we're repeating the same search
      if (
        !loadMore &&
        searchResults.length > 0 &&
        last &&
        last.query === queryToUse &&
        last.source === selectedSource &&
        last.filter === selectedFilter
      ) {
        return;
      }

      setShowSuggestions(false);

      if (loadMore) {
        setIsLoadingMore(true);
        console.log(
          "[Search] Loading more results for page:",
          paginationRef.current.page,
          "current results:",
          searchResults.length
        );
      } else {
        setIsLoading(true);
        // Reset pagination for new searches
        setCurrentPage(1);
        setHasMoreResults(true);
        paginationRef.current = {
          page: 1,
          hasMore: true,
          isLoadingMore: false,
          nextpage: null,
        };
        // Reset retry counter for new searches
        retryRef.current.attempts = 0;
        console.log("[Search] Starting new search for query:", queryToUse);
      }

      // Only clear results if we're doing a new search (not loading more)
      if (
        !loadMore &&
        (searchQuery !== queryToUse || searchResults.length === 0)
      ) {
        setSearchResults([]);
      }

      try {
        let results: any[] = [];

        console.log(
          `[Search] Making API call with page: ${paginationRef.current.page}, limit: 20`
        );

        if (selectedSource === "soundcloud") {
          // SoundCloud Search
          results = await searchAPI.searchWithSoundCloud(
            queryToUse,
            selectedFilter,
            paginationRef.current.page,
            20
          );
        } else if (selectedSource === "jiosaavn") {
          // JioSaavn Search
          results = await searchAPI.searchWithJioSaavn(
            queryToUse,
            selectedFilter,
            paginationRef.current.page,
            20
          );
        } else if (selectedSource === "spotify") {
          // Placeholder for Spotify
          console.log(t("search.spotify_not_implemented"));
          results = [];
        } else if (selectedSource === "youtubemusic") {
          const youtubeMusicResponse = await searchAPI.searchWithYouTubeMusic(
            queryToUse,
            selectedFilter,
            paginationRef.current.page,
            20,
            paginationRef.current.nextpage || undefined
          );
          if (youtubeMusicResponse.nextpage) {
            paginationRef.current.nextpage = youtubeMusicResponse.nextpage;
          } else {
            paginationRef.current.nextpage = null;
          }
          results = youtubeMusicResponse.items || [];
        } else {
          // YouTube (Default)
          if (selectedFilter === "date" || selectedFilter === "views") {
            results = await searchAPI.searchWithInvidious(
              queryToUse,
              selectedFilter,
              paginationRef.current.page,
              20
            );
          } else {
            // Handle Piped API response which returns {items, nextpage}
            const pipedResponse = await searchAPI.searchWithPiped(
              queryToUse,
              selectedFilter,
              paginationRef.current.page,
              20,
              paginationRef.current.nextpage || undefined
            );
            // Extract nextpage token for future pagination
            if (pipedResponse.nextpage) {
              paginationRef.current.nextpage = pipedResponse.nextpage;
              console.log(
                `[Search] Extracted nextpage token: ${pipedResponse.nextpage.substring(0, 50)}...`
              );
            } else {
              paginationRef.current.nextpage = null;
              console.log("[Search] No nextpage token in response");
            }
            results = pipedResponse.items;
          }
        }

        console.log(`[Search] API returned ${results.length} results`);
        console.log(
          "[Search] First few API results:",
          results.slice(0, 3).map((item) => ({
            id: item.videoId || item.id,
            title: item.title,
          }))
        );

        // Common formatter (only format if not already formatted)
        let formattedResults = results;

        // Only format if results are not already formatted (SoundCloud and JioSaavn results are pre-formatted)
        if (
          selectedSource !== "soundcloud" &&
          selectedSource !== "jiosaavn" &&
          results.length > 0 &&
          !results[0].source
        ) {
          formattedResults = searchAPI.formatSearchResults(results);
        }

        // Apply display formatting
        formattedResults = formattedResults.map((r) => ({
          ...r,
          views:
            selectedSource === "youtubemusic" &&
            (selectedFilter === "songs" ||
              selectedFilter === "all" ||
              r.type === "song")
              ? undefined
              : r.views
                ? shortCount(r.views) + " views"
                : undefined,
          // Remove YouTube-specific noise from upload string
          uploaded:
            r.uploaded && typeof r.uploaded === "string"
              ? r.uploaded.replace(/(\[\d.\]+\['MKB'\]?)\s*views?\s*•?\s*/i, "")
              : r.uploaded,
        }));

        // Sort results for YouTube and YouTube Music
        if (selectedSource === "youtube" || selectedSource === "youtubemusic") {
          // Pre-define type priority function for better performance
          const getTypePriority = (item: any) => {
            if (selectedSource === "youtube") {
              if (
                (item.source === "youtube" ||
                  item.source === "youtube_channel") &&
                (item.href?.includes("/channel/") || item.type === "channel")
              ) {
                return 0;
              } // channels
              if (item.type === "playlist" || item.href?.includes("&list=")) {
                return 2;
              } // playlists
              return 1; // videos
            } else {
              // youtubemusic
              if (
                (item.source === "youtubemusic" ||
                  item.source === "youtube_channel") &&
                (item.href?.includes("/channel/") || item.type === "channel")
              ) {
                return 0;
              } // artists/channels
              if (item.type === "playlist" || item.href?.includes("&list=")) {
                return 2;
              } // playlists
              return 1; // videos
            }
          };

          formattedResults = formattedResults.sort((a, b) => {
            const priorityA = getTypePriority(a);
            const priorityB = getTypePriority(b);

            if (priorityA !== priorityB) {
              return priorityA - priorityB;
            }

            // If same type, sort by views or title
            if (a.views && b.views) {
              return parseInt(b.views) - parseInt(a.views);
            }
            return (a.title || "").localeCompare(b.title || "");
          });
        }

        // Handle pagination - append results if loading more, replace if new search
        if (loadMore) {
          console.log(
            "[Search] Appending results:",
            formattedResults.length,
            "new items to existing",
            searchResults.length,
            "items"
          );
          console.log(
            "[Search] First few new items:",
            formattedResults
              .slice(0, 3)
              .map((item) => ({ id: item.id, title: item.title }))
          );
          // Deduplicate results by ID to prevent duplicates
          setSearchResults((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const newItems = formattedResults.filter(
              (item) => !existingIds.has(item.id)
            );
            console.log(
              "[Search] Deduplication: removed",
              formattedResults.length - newItems.length,
              "duplicates"
            );
            console.log("[Search] Adding", newItems.length, "unique items");

            // Check if all results were duplicates (no unique items found)
            if (newItems.length === 0 && formattedResults.length > 0) {
              if (retryRef.current.attempts < retryRef.current.maxAttempts) {
                retryRef.current.attempts++;
                console.log(
                  `[Search] ⚠️ All results were duplicates! Retrying with next page... (Attempt ${retryRef.current.attempts}/${retryRef.current.maxAttempts})`
                );
                // Don't update the results, stay in loading state and retry
                setTimeout(() => {
                  const nextRetryPage = paginationRef.current.page + 1;
                  console.log(
                    `[Search] 🔄 Retrying load more with page: ${nextRetryPage}`
                  );
                  paginationRef.current.page = nextRetryPage;
                  handleSearch(searchQuery, true);
                }, 500); // Small delay before retry
                return prev; // Return previous results without changes
              } else {
                console.log(
                  "[Search] ❌ Max retry attempts reached. Stopping pagination."
                );
                // Reset retry counter and stop pagination
                retryRef.current.attempts = 0;
                const hasMore = false;
                setHasMoreResults(hasMore);
                paginationRef.current.hasMore = hasMore;
                paginationRef.current.isLoadingMore = false;
                return prev;
              }
            } else if (newItems.length > 0) {
              // Reset retry counter when we find unique results
              retryRef.current.attempts = 0;
            }

            return [...prev, ...newItems];
          });
          // Check if we have a nextpage token for pagination (Piped API uses nextpage tokens)
          const hasMore = paginationRef.current.nextpage
            ? true
            : formattedResults.length >= 20 && formattedResults.length > 0;
          setHasMoreResults(hasMore);
          paginationRef.current.hasMore = hasMore;
          paginationRef.current.isLoadingMore = false;
          console.log(
            "[Search] Load more complete. Total results now:",
            searchResults.length + formattedResults.length,
            "Has more:",
            hasMore
          );
        } else {
          setSearchResults(formattedResults);
          const hasMore = paginationRef.current.nextpage
            ? true
            : formattedResults.length >= 20 && formattedResults.length > 0;
          setHasMoreResults(hasMore);
          paginationRef.current.hasMore = hasMore;
          console.log(
            "[Search] New search complete. Results:",
            formattedResults.length,
            "Has more:",
            hasMore
          );
        }
      } catch (error) {
        console.error("Search error:", error);
        if (!loadMore) {
          setSearchResults([]);
        }
        setHasMoreResults(false);
        paginationRef.current.hasMore = false;
        lastSearchRef.current = {
          query: queryToUse,
          source: selectedSource,
          filter: selectedFilter,
        };
      } finally {
        if (loadMore) {
          setIsLoadingMore(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [searchQuery, selectedFilter, selectedSource, searchResults.length]
  );

  // Load more results for pagination
  const loadMoreResults = useCallback(async () => {
    if (isLoadingMore || !hasMoreResults || !searchQuery.trim()) {
      console.log("[LoadMore] Blocked:", {
        isLoadingMore,
        hasMoreResults,
        query: searchQuery.trim(),
      });
      return;
    }

    // Check if already loading more or no more results
    if (paginationRef.current.isLoadingMore || !paginationRef.current.hasMore) {
      console.log("[LoadMore] Blocked by pagination:", {
        isLoadingMore: paginationRef.current.isLoadingMore,
        hasMore: paginationRef.current.hasMore,
      });
      return;
    }

    const nextPage = currentPage + 1;
    console.log("[LoadMore] Starting load more for page:", nextPage);

    // Update both state and ref immediately
    setCurrentPage(nextPage);
    paginationRef.current.page = nextPage;
    paginationRef.current.isLoadingMore = true;

    // Call handleSearch with loadMore flag set to true
    await handleSearch(searchQuery, true);
  }, [isLoadingMore, hasMoreResults, searchQuery, currentPage, handleSearch]);

  // Auto-trigger search when switching Sources/Filters if we have a query
  useEffect(() => {
    // Clear any existing filter change timeout
    if (filterChangeTimeoutRef.current) {
      clearTimeout(filterChangeTimeoutRef.current);
    }

    // Debounce filter/source changes to prevent rapid API calls
    filterChangeTimeoutRef.current = setTimeout(() => {
      if (searchQuery.trim().length > 0) {
        handleSearch();
      }
    }, 300); // 300ms delay for filter changes

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource, selectedFilter]);

  // Reset filters when switching sources (e.g. "Videos" filter doesn't apply to SoundCloud)
  useEffect(() => {
    // Set appropriate default filter for each source
    if (selectedSource === "soundcloud") {
      setSelectedFilter("tracks");
    } else if (selectedSource === "youtubemusic") {
      setSelectedFilter("songs"); // Default to "Songs" for YouTube Music
    } else if (selectedSource === "youtube") {
      setSelectedFilter(""); // "All" filter for YouTube
    } else {
      setSelectedFilter(""); // Default to "All" for other sources
    }
  }, [selectedSource]);

  // Cleanup timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (filterChangeTimeoutRef.current) {
        clearTimeout(filterChangeTimeoutRef.current);
      }
    };
  }, []);

  // Memoized filtering functions for better performance
  const filteredResults = useMemo(() => {
    if (!searchResults.length) {
      return { topResults: [], artists: [], albums: [], songs: [] };
    }

    // Pre-calculate collaboration check for better performance
    const isSearchingForIndividualArtist =
      !searchQuery.includes("&") &&
      !searchQuery.toLowerCase().includes(" and ");

    const isCollaboration = (text: string) => {
      const lowerText = text.toLowerCase().trim();
      return (
        lowerText.includes("&") ||
        lowerText.includes(" and ") ||
        lowerText.includes(" feat ") ||
        lowerText.includes(" ft ")
      );
    };

    const topResults = searchResults.filter((item) => item.type === "unknown");

    const artists = searchResults
      .filter((item) => {
        if (item.type !== "artist") {
          return false;
        }

        // Skip collaboration artists for individual searches
        if (isSearchingForIndividualArtist && isCollaboration(item.title)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Prioritize exact matches
        const queryLower = searchQuery.toLowerCase().trim();
        const aIsExact = a.title.toLowerCase().trim() === queryLower;
        const bIsExact = b.title.toLowerCase().trim() === queryLower;

        if (aIsExact && !bIsExact) {
          return -1;
        }
        if (!aIsExact && bIsExact) {
          return 1;
        }
        return 0;
      });

    const albums = searchResults.filter((item) => {
      // Filter out albums for YouTube and YouTube Music sources
      if (
        item.type === "album" &&
        (item.source === "youtube" || item.source === "youtubemusic")
      ) {
        return false;
      }
      return item.type === "album";
    });
    const playlists = searchResults.filter(
      (item) => item.type === "playlist" || item.href?.includes("&list=")
    );

    const songs = searchResults.filter((item) => {
      // Filter songs by type - combine both conditions in one filter
      if (item.type && item.type !== "song") {
        return false;
      }

      // For items without explicit type, check if they have duration (indicating they're songs)
      if (!item.type && !item.duration) {
        return false;
      }

      // Skip collaboration songs for individual artist searches
      if (
        isSearchingForIndividualArtist &&
        item.author &&
        isCollaboration(item.author)
      ) {
        return false;
      }

      return true;
    });

    // Debug logging for categories
    console.log("[Filter] Total results:", searchResults.length);
    console.log("[Filter] Top results:", topResults.length);
    console.log("[Filter] Artists:", artists.length);
    console.log("[Filter] Albums:", albums.length);
    console.log("[Filter] Playlists:", playlists.length);
    console.log("[Filter] Songs:", songs.length);
    if (searchResults.length > 0) {
      console.log(
        "[Filter] Sample IDs:",
        searchResults
          .slice(0, 3)
          .map((item) => ({ id: item.id, type: item.type, title: item.title }))
      );
    }

    return { topResults, artists, albums, playlists, songs };
  }, [searchResults, searchQuery]);

  // Optimized item press handlers
  const handleTopResultPress = useCallback(
    async (item: any) => {
      // If suggestions are open, just close them without playing
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }

      // Check if this is a channel/artist - navigate to ArtistScreen instead of playing
      if (item.source === "youtube_channel" || item.type === "artist") {
        navigation.navigate("Artist", {
          artistId: item.id,
          artistName: item.title || item.author,
        });
        return;
      }

      // Play track using player context (for regular songs/videos)
      const track = {
        id: item.id,
        title: item.title,
        artist: item.author,
        duration: parseInt(item.duration) || 0,
        thumbnail: item.thumbnailUrl || item.img,
        audioUrl: undefined,
        source: item.source || "youtube",
        _isSoundCloud: item.source === "soundcloud",
        _isJioSaavn: item.source === "jiosaavn",
      };

      await playTrack(
        track,
        searchResults.map((result: any) => ({
          id: result.id,
          title: result.title,
          artist: result.author,
          duration: parseInt(result.duration) || 0,
          thumbnail: result.thumbnailUrl || result.img,
          audioUrl: undefined,
          source: result.source || "youtube",
          _isSoundCloud: result.source === "soundcloud",
          _isJioSaavn: result.source === "jiosaavn",
        })),
        searchResults.indexOf(item)
      );
    },
    [showSuggestions, setShowSuggestions, navigation, playTrack, searchResults]
  );

  const handleArtistPress = useCallback(
    (item: any) => {
      navigation.navigate("Artist", {
        artistId: item.id,
        artistName: item.title,
      });
    },
    [navigation]
  );

  const handleAlbumPress = useCallback(
    async (item: any) => {
      // Navigate to album playlist screen
      if (item.source === "jiosaavn") {
        navigation.navigate("AlbumPlaylist", {
          albumId: item.id,
          albumName: item.title,
          albumArtist: item.author,
          source: item.source,
        });
      } else if (item.source === "youtube" || item.source === "youtubemusic") {
        // Handle YouTube/YouTube Music playlists
        navigation.navigate("AlbumPlaylist", {
          albumId: item.id,
          albumName: item.title,
          albumArtist: item.author,
          source: item.source,
          videoCount: item.videoCount,
        });
      }
    },
    [navigation]
  );

  // Handle JioSaavn album songs - open album playlist
  const handleJioSaavnAlbumSong = useCallback(
    async (item: any) => {
      if (!item.albumId || !item.albumName) {
        return false; // Play directly
      }

      try {
        // Fetch album details to get all songs
        const { searchAPI } = await import("../../modules/searchAPI");
        const albumDetails = await searchAPI.getJioSaavnAlbumDetails(
          item.albumId,
          item.albumName
        );

        if (
          albumDetails &&
          albumDetails.songs &&
          albumDetails.songs.length > 0
        ) {
          // Create playlist from album songs
          const albumPlaylist = albumDetails.songs.map((song: any) => ({
            id: String(song.id),
            title:
              song.name ||
              song.title ||
              song.song ||
              t("screens.artist.unknown_title"),
            artist:
              song.artists?.primary
                ?.map((artist: any) =>
                  artist.name?.replace(/\s*-\s*Topic$/i, "")
                )
                .join(", ") ||
              song.singers?.replace(/\s*-\s*Topic$/i, "") ||
              t("screens.artist.unknown_artist"),
            duration: song.duration || 0,
            thumbnail:
              song.image?.find((img: any) => img.quality === "500x500")?.url ||
              song.image?.[0]?.url ||
              "",
            source: "jiosaavn",
            _isJioSaavn: true,
            albumId: item.albumId,
            albumName: item.albumName,
          }));

          // Find the index of the selected song in the album
          const selectedIndex = albumPlaylist.findIndex(
            (song: any) => song.id === item.id
          );

          // Open the album playlist without auto-playing

          navigation.navigate("PlayerScreen", {
            playlist: albumPlaylist,
            currentIndex: selectedIndex,
            autoPlay: false, // Don't auto-play, just show the playlist
            highlightTrack: item.id, // Highlight the selected track
          });

          return true; // Album playlist opened
        }
      } catch (error) {}

      return false; // Fallback to direct play
    },
    [navigation]
  );

  const handleSongPress = useCallback(
    async (item: any) => {
      // If suggestions are open, just close them without playing
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }

      // Handle JioSaavn album songs
      if (item.source === "jiosaavn" && item.albumId) {
        const albumOpened = await handleJioSaavnAlbumSong(item);
        if (albumOpened) {
          return; // Album playlist opened, don't play directly
        }
      }

      // Play track using player context
      const track = {
        id: item.id,
        title: item.title,
        artist: item.author,
        duration: parseInt(item.duration) || 0,
        thumbnail: item.thumbnailUrl || item.img,
        audioUrl: undefined,
        source: item.source || "youtube",
        _isSoundCloud: item.source === "soundcloud",
        _isJioSaavn: item.source === "jiosaavn",
      };

      await playTrack(
        track,
        searchResults.map((result: any) => ({
          id: result.id,
          title: result.title,
          artist: result.author,
          duration: parseInt(result.duration) || 0,
          thumbnail: result.thumbnailUrl || result.img,
          audioUrl: undefined,
          source: result.source || "youtube",
          _isSoundCloud: result.source === "soundcloud",
          _isJioSaavn: result.source === "jiosaavn",
        })),
        searchResults.indexOf(item)
      );
    },
    [
      showSuggestions,
      setShowSuggestions,
      handleJioSaavnAlbumSong,
      playTrack,
      searchResults,
    ]
  );

  const handleTextChange = useCallback(
    (text: string) => {
      setSearchQuery(text);

      // Clear existing timeouts
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (filterChangeTimeoutRef.current) {
        clearTimeout(filterChangeTimeoutRef.current);
      }

      if (text.trim().length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        // Don't clear search results unless the text is completely empty
        if (text.length === 0 && searchResults.length > 0) {
          setSearchResults([]);
        }
        return;
      }

      // Debounce suggestions (200ms - faster suggestions)
      typingTimeoutRef.current = setTimeout(async () => {
        try {
          const newSuggestions = await searchAPI.getSuggestions(
            text,
            selectedSource
          );

          setSuggestions(newSuggestions.slice(0, 5));
          setShowSuggestions(true);
        } catch (e) {
          console.log("Suggestion error", e);
        }
      }, 200);

      // Debounce search separately (300ms - faster response for better UX)
      searchTimeoutRef.current = setTimeout(() => {
        if (text.trim().length >= 2) {
          handleSearch(text);
        }
      }, 300); // 300ms delay for faster search response
    },
    [selectedSource, searchResults.length]
  );

  const handleSourceSelect = useCallback((sourceId: SourceType) => {
    // Configure layout animation for smooth reordering
    // Layout animation is handled by React Native's built-in animations

    // Reorder sources - move selected to first position
    setSourceFilters((prevFilters) => {
      const selectedFilter = prevFilters.find((f) => f.id === sourceId);
      if (!selectedFilter) {
        return prevFilters;
      }

      const otherFilters = prevFilters.filter((f) => f.id !== sourceId);
      return [selectedFilter, ...otherFilters];
    });

    setSelectedSource(sourceId);
  }, []);

  const onSuggestionPress = (item: string) => {
    setSearchQuery(item);
    setShowSuggestions(false);
    handleSearch(item);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    setSearchResults([]);
    // Clear any pending timeouts
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    if (filterChangeTimeoutRef.current) {
      clearTimeout(filterChangeTimeoutRef.current);
    }
  };

  const handleOutsidePress = () => {
    if (showSuggestions) {
      setShowSuggestions(false);
    }
    Keyboard.dismiss();
  };

  return (
    <TouchableWithoutFeedback onPress={handleOutsidePress}>
      <SafeArea>
        <Header>
          <SearchContainer>
            <SearchInput
              placeholder={`Search ${
                sourceFilters.find((s) => s.id === selectedSource)?.label
              }...`}
              placeholderTextColor="#a3a3a3"
              value={searchQuery}
              onChangeText={handleTextChange}
              onSubmitEditing={() => handleSearch()}
              returnKeyType="search"
              onFocus={() => {
                if (suggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
            />
            {searchQuery.length > 0 && (
              <ClearButton onPress={clearSearch} disabled={!searchQuery}>
                <Ionicons name="close-circle" size={20} color="#a3a3a3" />
              </ClearButton>
            )}
          </SearchContainer>
        </Header>

        {/* 1. Source Selectors (YouTube / SoundCloud / Spotify) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ maxHeight: 52 }} // Button height (36px) + padding (8px top + 8px bottom)
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          <View style={{ flexDirection: "row" }}>
            {sourceFilters.map((source) => (
              <SourceButton
                key={source.id}
                active={selectedSource === source.id}
                color={source.color}
                onPress={() => {
                  // Disable Spotify for now
                  if (source.id === "spotify") {
                    return;
                  }
                  handleSourceSelect(source.id);
                }}
                disabled={source.id === "spotify"}
                style={{
                  opacity: source.id === "spotify" ? 0.5 : 1,
                }}
              >
                <SourceButtonText active={selectedSource === source.id}>
                  {source.label}
                </SourceButtonText>
              </SourceButton>
            ))}
          </View>
        </ScrollView>

        {/* 2. Sub-Filters for YouTube, YouTube Music, SoundCloud, and JioSaavn */}
        {(selectedSource === "youtube" ||
          selectedSource === "youtubemusic" ||
          selectedSource === "soundcloud" ||
          selectedSource === "jiosaavn") && (
          <FilterContainer
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {(selectedSource === "youtube"
              ? searchFilters
              : selectedSource === "youtubemusic"
                ? youtubeMusicFilters
                : selectedSource === "jiosaavn"
                  ? jioSaavnFilters
                  : soundCloudFilters
            ).map((filter) => (
              <FilterButton
                key={filter.value}
                active={selectedFilter === filter.value}
                onPress={() => setSelectedFilter(filter.value)}
              >
                <FilterButtonText active={selectedFilter === filter.value}>
                  {filter.label}
                </FilterButtonText>
              </FilterButton>
            ))}
          </FilterContainer>
        )}

        {/* Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <SuggestionsOverlay>
            {suggestions.map((item, index) => (
              <SuggestionItem
                key={index}
                onPress={() => onSuggestionPress(item)}
              >
                <SuggestionIcon>🔍</SuggestionIcon>
                <SuggestionText>{item}</SuggestionText>
              </SuggestionItem>
            ))}
          </SuggestionsOverlay>
        )}

        {/* Results List */}
        <ResultsContainer
          ref={scrollViewRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 120 }} // Increased padding for last items accessibility
          onScroll={(event) => {
            scrollPositionRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          {isLoading &&
            [...Array(6)].map((_, index) => (
              <Animated.View
                key={`skeleton-${index}`}
                style={{ opacity: skeletonOpacity }}
              >
                <SkeletonRow>
                  <SkeletonThumbnail />
                  <SkeletonTextBlock>
                    <SkeletonLinePrimary />
                    <SkeletonLineSecondary />
                  </SkeletonTextBlock>
                </SkeletonRow>
              </Animated.View>
            ))}

          {!isLoading && searchResults.length === 0 && (
            <NoResultsText>
              Start searching for artists, albums, or songs
            </NoResultsText>
          )}

          {!isLoading && searchResults.length > 0 && (
            <>
              {/* Top Query Results */}
              {filteredResults.topResults.length > 0 && (
                <SearchSection
                  items={filteredResults.topResults}
                  title="Top Result"
                  onItemPress={handleTopResultPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                />
              )}

              {/* Artists Section */}
              {filteredResults.artists.length > 0 && (
                <SearchSection
                  items={filteredResults.artists}
                  title="Artists"
                  onItemPress={handleArtistPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                />
              )}

              {/* Albums Section - Hide for YouTube and YouTube Music */}
              {filteredResults.albums.length > 0 &&
                selectedSource !== "youtube" &&
                selectedSource !== "youtubemusic" && (
                  <SearchSection
                    items={filteredResults.albums}
                    title="Albums"
                    onItemPress={handleAlbumPress}
                    searchQuery={searchQuery}
                    showSuggestions={showSuggestions}
                    setShowSuggestions={setShowSuggestions}
                    navigation={navigation}
                    playTrack={playTrack}
                    searchResults={searchResults}
                  />
                )}

              {/* Playlists Section */}
              {filteredResults.playlists.length > 0 && (
                <SearchSection
                  items={filteredResults.playlists}
                  title="Playlists"
                  onItemPress={handleAlbumPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                />
              )}

              {/* Songs Section */}
              {filteredResults.songs.length > 0 && (
                <SearchSection
                  items={filteredResults.songs}
                  title="Songs"
                  onItemPress={handleSongPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                />
              )}

              {/* Load More Button or End of Results - Only at the end of all content */}
              {!hasMoreResults && searchResults.length > 0 ? (
                <View style={{ paddingVertical: 20, alignItems: "center" }}>
                  <Text style={{ color: "#a3a3a3", fontSize: 14 }}>
                    End of search results
                  </Text>
                </View>
              ) : (
                hasMoreResults && (
                  <View style={{ paddingVertical: 20, alignItems: "center" }}>
                    {isLoadingMore ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <TouchableOpacity
                        onPress={loadMoreResults}
                        style={{
                          backgroundColor: "#333",
                          paddingHorizontal: 20,
                          paddingVertical: 10,
                          borderRadius: 20,
                        }}
                      >
                        <Text style={{ color: "#fff", fontSize: 14 }}>
                          Load More
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )
              )}
            </>
          )}
        </ResultsContainer>
      </SafeArea>
    </TouchableWithoutFeedback>
  );
}
