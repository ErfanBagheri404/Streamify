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
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Image,
} from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { default as StreamItem } from "../StreamItem";
import { searchAPI } from "../../modules/searchAPI";
import { Screen } from "../ui/Screen";
import { Chip } from "../ui/Chip";
import { AccentButton } from "../ui/Button";
import { MutedText } from "../ui/Text";
import { SectionHeader } from "../ui/SectionHeader";
import { usePlayer } from "../../contexts/PlayerContext";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useAppSettings } from "../../hooks/useAppSettings";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { StorageService } from "../../utils/storage";
import { getAppFontFamily, getTextDirectionStyle } from "../../utils/fonts";
import { type PreferredSearchSource } from "../../lib/app-settings";
import {
  getCachedSearchCategoryPlaylistsSnapshot,
  getSearchCategoryPlaylists,
  getSearchCategoryPlaylistId,
  type SearchCategoryPlaylist,
} from "../../lib/search-category-playlists";
import FilterIcon from "../../assets/Filter.svg";

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

const isPlayableSearchResult = (item: any): boolean => {
  return (
    item?.type === "song" ||
    item?.type === "video" ||
    item?.type === "stream" ||
    (!item?.type && Boolean(item?.duration))
  );
};

const toPlayableSearchTrack = (item: any) => ({
  id: item.id,
  title: item.title,
  artist: item.author,
  artistId: item.artistId,
  artistImage: item.artistImage || item.thumbnailUrl || item.img,
  artistSource: item.artistSource || item.source || "youtube",
  duration: parseInt(item.duration) || 0,
  thumbnail: item.thumbnailUrl || item.img,
  audioUrl: undefined,
  url: item.href,
  source: item.source || "youtube",
  _isSoundCloud: item.source === "soundcloud",
  _isJioSaavn: item.source === "jiosaavn",
});

const getDefaultFilterForSource = (source: SourceType): string => {
  if (source === "mixed") {
    return "all";
  }

  if (source === "soundcloud") {
    return "tracks";
  }

  if (source === "youtubemusic") {
    return "songs";
  }

  return "all";
};

interface SearchFilterOption {
  value: string;
  labelKey: string;
}

interface SearchSourceOption {
  id: SourceType;
  labelKey: string;
  color: string;
}

const normalizeSearchSource = (
  source: string | undefined,
  fallback: SourceType
): SourceType => {
  const validSources: SourceType[] = [
    "mixed",
    "youtube",
    "youtubemusic",
    "soundcloud",
    "jiosaavn",
  ];

  return validSources.includes(source as SourceType)
    ? (source as SourceType)
    : fallback;
};

const normalizePreferredSource = (
  source: PreferredSearchSource
): SourceType => {
  return source as SourceType;
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

const SearchIconWrapper = styled.View`
  padding-left: 12px;
  padding-right: 4px;
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

// --- SECTION STYLES ---
const SectionContainer = styled.View`
  margin-bottom: 16px;
`;

const SuggestionsOverlay = styled.View`
  position: absolute;
  top: 84px;
  left: 16px;
  right: 16px;
  background-color: #262626;
  border-radius: 12px;
  z-index: 100;
  elevation: 5;
  overflow: hidden;
`;

const SuggestionsHeader = styled.View`
  padding: 10px 12px;
  border-bottom-width: 1px;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
`;

const SuggestionsCloseButton = styled.TouchableOpacity`
  padding: 6px 10px;
  border-radius: 999px;
`;

const SuggestionItem = styled.TouchableOpacity`
  padding: 14px 16px;
  border-bottom-width: 1px;
  border-bottom-color: #404040;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const SuggestionText = styled.Text`
  color: #fff;
  font-size: 16px;
  flex: 1;
  font-family: GoogleSansRegular;
`;

const SuggestionMeta = styled.Text`
  color: #a3a3a3;
  font-size: 11px;
  font-family: GoogleSansMedium;
  text-transform: uppercase;
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

    return (
      <SectionContainer>
        <SectionHeader title={title} style={{ paddingHorizontal: 16 }} />
        {items.map((item) => (
          <TouchableOpacity
            key={`${item.source || "yt"}-${item.id}`}
            onPress={() => onItemPress(item)}
          >
            <MemoizedStreamItem
              id={item.id}
              title={item.title}
              author={item.author}
              duration={formatDuration(
                parseInt(item.duration) || 0,
                item.source
              )}
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
              thumbnailUrl={item.thumbnailUrl || item.artworkUrl || item.img}
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
        ))}
      </SectionContainer>
    );
  }
);

type SourceType =
  | "mixed"
  | "youtube"
  | "youtubemusic"
  | "soundcloud"
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

const SEARCH_SOURCE_OPTIONS: SearchSourceOption[] = [
  { id: "mixed", labelKey: "source.mixed", color: "#1ed760" },
  { id: "youtube", labelKey: "source.youtube", color: "#ff0000" },
  { id: "youtubemusic", labelKey: "source.youtubemusic", color: "#ff0000" },
  { id: "soundcloud", labelKey: "source.soundcloud", color: "#ff7700" },
  { id: "jiosaavn", labelKey: "source.jiosaavn", color: "#1fa18a" },
];

const SEARCH_CATEGORY_IMAGES = {
  Alternative: require("../../assets/categories/Alternative.jpg"),
  Electronic: require("../../assets/categories/Electronic.jpg"),
  "Heavy Metal": require("../../assets/categories/Heavy Metal.jpg"),
  "Hip-Hop": require("../../assets/categories/Hip-Hop.jpg"),
  Jazz: require("../../assets/categories/Jazz.jpg"),
  "K-Pop": require("../../assets/categories/K-Pop.jpg"),
  "LO-FI": require("../../assets/categories/LO-FI.jpg"),
  Metal: require("../../assets/categories/Metal.jpg"),
  OST: require("../../assets/categories/OST.jpg"),
  Persian: require("../../assets/categories/Persian.jpg"),
  Phonk: require("../../assets/categories/Phonk.jpg"),
  Pop: require("../../assets/categories/Pop.jpg"),
  "R&B": require("../../assets/categories/RNB.jpg"),
  Rock: require("../../assets/categories/Rock.jpg"),
  Synthwave: require("../../assets/categories/Synthwave.jpg"),
} as const;

const DEFAULT_SEARCH_CATEGORY_CARDS: SearchCategoryPlaylist[] = [
  {
    category: "Alternative",
    imageFileName: "Alternative.jpg",
    playlistTitle: "",
  },
  {
    category: "Electronic",
    imageFileName: "Electronic.jpg",
    playlistTitle: "",
  },
  {
    category: "Heavy Metal",
    imageFileName: "Heavy Metal.jpg",
    playlistTitle: "",
  },
  { category: "Hip-Hop", imageFileName: "Hip-Hop.jpg", playlistTitle: "" },
  { category: "Jazz", imageFileName: "Jazz.jpg", playlistTitle: "" },
  { category: "K-Pop", imageFileName: "K-Pop.jpg", playlistTitle: "" },
  { category: "LO-FI", imageFileName: "LO-FI.jpg", playlistTitle: "" },
  { category: "Metal", imageFileName: "Metal.jpg", playlistTitle: "" },
  { category: "OST", imageFileName: "OST.jpg", playlistTitle: "" },
  { category: "Persian", imageFileName: "Persian.jpg", playlistTitle: "" },
  { category: "Phonk", imageFileName: "Phonk.jpg", playlistTitle: "" },
  { category: "Pop", imageFileName: "Pop.jpg", playlistTitle: "" },
  { category: "R&B", imageFileName: "RNB.jpg", playlistTitle: "" },
  { category: "Rock", imageFileName: "Rock.jpg", playlistTitle: "" },
  { category: "Synthwave", imageFileName: "Synthwave.jpg", playlistTitle: "" },
];

const MIXED_FILTER_OPTIONS: SearchFilterOption[] = [
  { value: "all", labelKey: "search.all" },
  { value: "playlists", labelKey: "search.playlists" },
];

const YOUTUBE_FILTER_OPTIONS: SearchFilterOption[] = [
  { value: "all", labelKey: "search.all" },
  { value: "videos", labelKey: "search.videos" },
  { value: "channels", labelKey: "search.artists" },
  { value: "playlists", labelKey: "search.playlists" },
];

const YOUTUBE_MUSIC_FILTER_OPTIONS: SearchFilterOption[] = [
  { value: "songs", labelKey: "search.songs" },
  { value: "videos", labelKey: "search.videos" },
  { value: "albums", labelKey: "search.albums" },
  { value: "playlists", labelKey: "search.playlists" },
  { value: "channels", labelKey: "search.artists" },
];

const SOUNDCLOUD_FILTER_OPTIONS: SearchFilterOption[] = [
  { value: "tracks", labelKey: "search.tracks" },
  { value: "playlists", labelKey: "search.playlists" },
  { value: "albums", labelKey: "search.albums" },
];

const JIOSAAVN_FILTER_OPTIONS: SearchFilterOption[] = [
  { value: "all", labelKey: "search.all" },
  { value: "songs", labelKey: "search.songs" },
  { value: "albums", labelKey: "search.albums" },
  { value: "artists", labelKey: "search.artists" },
];

function getFiltersForSource(source: SourceType): SearchFilterOption[] {
  switch (source) {
    case "mixed":
      return MIXED_FILTER_OPTIONS;
    case "youtube":
      return YOUTUBE_FILTER_OPTIONS;
    case "youtubemusic":
      return YOUTUBE_MUSIC_FILTER_OPTIONS;
    case "soundcloud":
      return SOUNDCLOUD_FILTER_OPTIONS;
    case "jiosaavn":
      return JIOSAAVN_FILTER_OPTIONS;
    default:
      return [];
  }
}

function normalizeFilterForSource(
  source: SourceType,
  filterValue: string | undefined
): string {
  const options = getFiltersForSource(source);
  if (options.some((option) => option.value === filterValue)) {
    return filterValue || "";
  }

  return getDefaultFilterForSource(source);
}

// --- Main Component ---

export default function SearchScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { t, isRtl } = useAppLanguage();

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [categoryPlaylists, setCategoryPlaylists] = useState<
    SearchCategoryPlaylist[]
  >([]);
  const { playTrack } = usePlayer();
  const { settings, hasHydratedSettings } = useAppSettings();

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

  const [selectedSource, setSelectedSource] = useState<SourceType>("mixed");
  const [selectedFilter, setSelectedFilter] = useState(
    getDefaultFilterForSource("mixed")
  );
  const activeSourceOption =
    SEARCH_SOURCE_OPTIONS.find((source) => source.id === selectedSource) ||
    SEARCH_SOURCE_OPTIONS[0];
  const activeFilterOptions = useMemo(
    () => getFiltersForSource(selectedSource),
    [selectedSource]
  );
  const visibleCategoryPlaylists = useMemo(
    () =>
      categoryPlaylists.length > 0
        ? categoryPlaylists
        : DEFAULT_SEARCH_CATEGORY_CARDS,
    [categoryPlaylists]
  );
  const orderedSourceOptions = useMemo(() => {
    const selectedOption = SEARCH_SOURCE_OPTIONS.find(
      (option) => option.id === selectedSource
    );

    if (!selectedOption) {
      return SEARCH_SOURCE_OPTIONS;
    }

    return [
      selectedOption,
      ...SEARCH_SOURCE_OPTIONS.filter((option) => option.id !== selectedSource),
    ];
  }, [selectedSource]);
  const filtersAnimation = useRef(new Animated.Value(0)).current;
  const filterPanelHeight = activeFilterOptions.length > 0 ? 92 : 48;

  const copy = useMemo(
    () => ({
      noResults: t("search.noResults"),
      topResult: t("search.topResult"),
      endResults: t("search.endResults"),
      loadMore: t("common.loadMore"),
    }),
    [t]
  );
  const handleCategorySelect = useCallback(
    (category: SearchCategoryPlaylist) => {
      const playlistId = getSearchCategoryPlaylistId(category);
      const source = category.source || "youtube";

      if (!playlistId) {
        return;
      }

      navigation.navigate("AlbumPlaylist", {
        albumId: playlistId,
        albumName: category.playlistTitle,
        albumArtist: category.category,
        source,
      });
    },
    [navigation]
  );
  const localizedTextStyle = useMemo(
    () => ({
      fontFamily: getAppFontFamily(isRtl, "regular"),
      ...getTextDirectionStyle(isRtl),
    }),
    [isRtl]
  );
  const centeredLocalizedTextStyle = useMemo(
    () => ({
      fontFamily: getAppFontFamily(isRtl, "regular"),
      ...getTextDirectionStyle(isRtl, "center"),
    }),
    [isRtl]
  );
  const centeredCategoryTextStyle = useMemo(
    () => ({
      fontFamily: getAppFontFamily(isRtl, "black"),
      ...getTextDirectionStyle(isRtl, "center"),
    }),
    [isRtl]
  );
  const trimmedSearchQuery = searchQuery.trim();

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const filterChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeSearchRequestRef = useRef(0);
  const hasRestoredSearchRef = useRef(false);
  const isRestoringSearchStateRef = useRef(false);
  const pendingRestoreQueryRef = useRef<string | null>(null);
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
    let cancelled = false;

    const loadCategoryPlaylists = async () => {
      const cachedPlaylists = await getCachedSearchCategoryPlaylistsSnapshot();
      if (!cancelled && cachedPlaylists.length > 0) {
        setCategoryPlaylists(cachedPlaylists);
      }

      const latestPlaylists = await getSearchCategoryPlaylists({
        revalidate: true,
      });
      if (!cancelled && latestPlaylists.length > 0) {
        setCategoryPlaylists(latestPlaylists);
      }
    };

    void loadCategoryPlaylists();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    Animated.timing(filtersAnimation, {
      toValue: showFilters ? 1 : 0,
      duration: settings.disableAnimations ? 0 : 220,
      useNativeDriver: false,
    }).start();
  }, [filtersAnimation, settings.disableAnimations, showFilters]);

  useEffect(() => {
    if (!hasHydratedSettings || hasRestoredSearchRef.current) {
      return;
    }

    hasRestoredSearchRef.current = true;
    let cancelled = false;

    const restoreSearchState = async () => {
      const preferredSource = normalizePreferredSource(
        settings.preferredSearchSource
      );

      if (!settings.rememberLastSearch) {
        await StorageService.clearLastSearchState();
        if (!cancelled) {
          setSelectedSource(preferredSource);
          setSelectedFilter(
            normalizeFilterForSource(preferredSource, undefined)
          );
        }
        return;
      }

      const lastSearchState = await StorageService.loadLastSearchState();
      if (cancelled) {
        return;
      }

      if (!lastSearchState?.query?.trim()) {
        setSelectedSource(preferredSource);
        setSelectedFilter(normalizeFilterForSource(preferredSource, undefined));
        return;
      }

      const restoredSource = normalizeSearchSource(
        lastSearchState.source,
        preferredSource
      );
      const restoredFilter = normalizeFilterForSource(
        restoredSource,
        lastSearchState.filter
      );
      const restoredResults = Array.isArray(lastSearchState.results)
        ? (lastSearchState.results as SearchResult[])
        : [];

      isRestoringSearchStateRef.current = true;
      setSearchQuery(lastSearchState.query);
      setSelectedSource(restoredSource);
      setSelectedFilter(restoredFilter);
      if (restoredResults.length > 0) {
        setSearchResults(restoredResults);
        setHasSearched(true);
        setHasMoreResults(false);
        setCurrentPage(1);
        paginationRef.current = {
          page: 1,
          hasMore: false,
          isLoadingMore: false,
          nextpage: null,
        };
      }
      pendingRestoreQueryRef.current = lastSearchState.query;
    };

    void restoreSearchState();

    return () => {
      cancelled = true;
    };
  }, [
    hasHydratedSettings,
    settings.preferredSearchSource,
    settings.rememberLastSearch,
  ]);

  useEffect(() => {
    if (!hasHydratedSettings || settings.rememberLastSearch) {
      return;
    }

    void StorageService.clearLastSearchState();
  }, [hasHydratedSettings, settings.rememberLastSearch]);

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
      const trimmedQuery = queryToUse.trim();

      if (!trimmedQuery) {
        return;
      }

      const requestId = ++activeSearchRequestRef.current;
      const requestSource = selectedSource;
      const requestFilter = selectedFilter;

      const last = lastSearchRef.current;

      // For new searches (not load more), check if we're repeating the same search
      if (
        !loadMore &&
        searchResults.length > 0 &&
        last &&
        last.query === trimmedQuery &&
        last.source === requestSource &&
        last.filter === requestFilter
      ) {
        return;
      }

      setShowSuggestions(false);
      setHasSearched(true);

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

        if (requestSource === "mixed") {
          results = await searchAPI.searchMixed(
            trimmedQuery,
            requestFilter,
            paginationRef.current.page,
            20
          );
          paginationRef.current.nextpage = null;
        } else if (requestSource === "soundcloud") {
          // SoundCloud Search
          results = await searchAPI.searchWithSoundCloud(
            trimmedQuery,
            requestFilter,
            paginationRef.current.page,
            20
          );
        } else if (requestSource === "jiosaavn") {
          // JioSaavn Search
          console.log("[SearchScreen] Starting JioSaavn search");
          results = await searchAPI.searchWithJioSaavn(
            trimmedQuery,
            requestFilter,
            paginationRef.current.page,
            20
          );
        } else if (requestSource === "youtubemusic") {
          const youtubeMusicResponse = await searchAPI.searchWithYouTubeMusic(
            trimmedQuery,
            requestFilter,
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
          // YouTube (Default) - Use consistent Piped API approach like YouTube Music
          const youtubeResponse = await searchAPI.searchYouTubeWithFallback(
            trimmedQuery,
            requestFilter,
            paginationRef.current.page,
            20,
            paginationRef.current.nextpage || undefined
          );
          if (youtubeResponse.nextpage) {
            paginationRef.current.nextpage = youtubeResponse.nextpage;
            console.log(
              `[Search] Extracted nextpage token: ${youtubeResponse.nextpage.substring(0, 50)}...`
            );
          } else {
            paginationRef.current.nextpage = null;
            console.log("[Search] No nextpage token in response");
          }
          results = youtubeResponse.items || [];
        }

        console.log(`[Search] API returned ${results.length} results`);
        console.log(
          "[Search] First few API results:",
          results.slice(0, 3).map((item) => ({
            id: item.videoId || item.id,
            title: item.title,
          }))
        );

        if (requestId !== activeSearchRequestRef.current) {
          return;
        }

        // Common formatter (only format if not already formatted)
        let formattedResults = results;

        // YouTube Music still returns raw Piped-style items and needs the shared formatter.
        if (
          results.length > 0 &&
          (requestSource === "youtube" ||
            requestSource === "youtubemusic" ||
            !results[0].source)
        ) {
          formattedResults = searchAPI.formatSearchResults(results);
        }

        // Apply display formatting
        formattedResults = formattedResults.map((r) => ({
          ...r,
          views:
            r.source === "jiosaavn" ||
            (r.source === "youtubemusic" &&
              (r.type === "song" ||
                requestFilter === "songs" ||
                (requestSource === "youtubemusic" && requestFilter === "all")))
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
        if (requestSource === "youtube" || requestSource === "youtubemusic") {
          // Pre-define type priority function for better performance
          const getTypePriority = (item: any) => {
            if (requestSource === "youtube") {
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

        const existingIds = new Set(searchResults.map((item) => item.id));
        const uniqueNewItems = formattedResults.filter(
          (item) => !existingIds.has(item.id)
        );
        const persistedResults = loadMore
          ? [...searchResults, ...uniqueNewItems]
          : formattedResults;

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
              if (
                (requestSource === "youtube" ||
                  requestSource === "youtubemusic") &&
                paginationRef.current.nextpage
              ) {
                console.log(
                  "[Search] All results were duplicates but nextpage exists, keeping pagination alive"
                );
              } else if (
                retryRef.current.attempts < retryRef.current.maxAttempts
              ) {
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
          const hasMore =
            requestSource === "mixed"
              ? false
              : requestSource === "youtube" || requestSource === "youtubemusic"
                ? !!paginationRef.current.nextpage
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
          const hasMore =
            requestSource === "mixed"
              ? false
              : requestSource === "youtube" || requestSource === "youtubemusic"
                ? !!paginationRef.current.nextpage
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

        lastSearchRef.current = {
          query: trimmedQuery,
          source: requestSource,
          filter: requestFilter,
        };

        if (settings.rememberLastSearch) {
          void StorageService.saveLastSearchState({
            query: trimmedQuery,
            source: requestSource,
            filter: requestFilter,
            results: persistedResults,
          });
        }
      } catch (error) {
        if (requestId !== activeSearchRequestRef.current) {
          return;
        }
        console.error("Search error:", error);
        if (!loadMore) {
          setSearchResults([]);
        }
        setHasMoreResults(false);
        paginationRef.current.hasMore = false;
        lastSearchRef.current = {
          query: trimmedQuery,
          source: requestSource,
          filter: requestFilter,
        };
      } finally {
        if (requestId !== activeSearchRequestRef.current) {
          return;
        }
        if (loadMore) {
          setIsLoadingMore(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [
      searchQuery,
      selectedFilter,
      selectedSource,
      searchResults,
      settings.rememberLastSearch,
    ]
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

  useEffect(() => {
    if (!pendingRestoreQueryRef.current || !hasHydratedSettings) {
      return;
    }

    const restoredQuery = pendingRestoreQueryRef.current;
    pendingRestoreQueryRef.current = null;

    const timeout = setTimeout(() => {
      handleSearch(restoredQuery);
    }, 0);

    return () => clearTimeout(timeout);
  }, [handleSearch, hasHydratedSettings, selectedFilter, selectedSource]);

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

    const albums = searchResults.filter((item) => item.type === "album");
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

  const playableSearchQueue = useMemo(
    () => searchResults.filter(isPlayableSearchResult).map(toPlayableSearchTrack),
    [searchResults]
  );

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
          artistImage: item.thumbnailUrl || item.img || "",
          source: item.source === "jiosaavn" ? "jiosaavn" : "youtube",
        });
        return;
      }

      // Play track using player context (for regular songs/videos)
      const track = toPlayableSearchTrack(item);
      const currentIndex = playableSearchQueue.findIndex(
        (result) => result.id === item.id
      );

      await playTrack(
        track,
        playableSearchQueue,
        currentIndex >= 0 ? currentIndex : 0
      );
    },
    [
      showSuggestions,
      setShowSuggestions,
      navigation,
      playTrack,
      playableSearchQueue,
    ]
  );

  const handleArtistPress = useCallback(
    (item: any) => {
      // If suggestions are open, just close them without navigating
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }

      navigation.navigate("Artist", {
        artistId: item.id,
        artistName: item.title,
        artistImage: item.thumbnailUrl || item.img || "",
        source: item.source === "jiosaavn" ? "jiosaavn" : "youtube",
      });
    },
    [navigation, showSuggestions, setShowSuggestions]
  );

  const handleAlbumPress = useCallback(
    async (item: any) => {
      // If suggestions are open, just close them without navigating
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }

      // Navigate to album playlist screen
      if (item.source === "soundcloud") {
        navigation.navigate("AlbumPlaylist", {
          albumId: item.id,
          albumName: item.title,
          albumArtist: item.author,
          source: item.source,
          href: item.href,
          type: item.type,
        });
      } else if (item.source === "jiosaavn") {
        navigation.navigate("AlbumPlaylist", {
          albumId: item.id,
          albumName: item.title,
          albumArtist: item.author,
          source: item.source,
        });
      } else if (item.source === "youtube" || item.source === "youtubemusic") {
        const hrefList =
          typeof item.href === "string"
            ? item.href.match(/[?&]list=([^&]+)/)?.[1]
            : undefined;
        const rawId = hrefList || item.id;
        const cleanedId =
          typeof rawId === "string" ? rawId.split("&")[0] : rawId;
        const isMix =
          /^Mix\s*-/i.test(item.title || "") ||
          (typeof item.href === "string" && item.href.includes("/mix?list=")) ||
          (typeof cleanedId === "string" && cleanedId.startsWith("RD"));
        const normalizedId =
          isMix && typeof cleanedId === "string" && !cleanedId.startsWith("RD")
            ? `RD${cleanedId}`
            : cleanedId;

        navigation.navigate("AlbumPlaylist", {
          albumId: normalizedId,
          albumName: item.title,
          albumArtist: item.author,
          source: item.source,
          videoCount: item.videoCount,
        });
      }
    },
    [navigation, showSuggestions, setShowSuggestions]
  );

  // Handle JioSaavn album songs - open album playlist
  const handleJioSaavnAlbumSong = useCallback(
    async (item: any) => {
      if (!item.albumId || !item.albumName) {
        return false; // Play directly
      }

      try {
        const albumDetails = await searchAPI.getJioSaavnAlbumDetails(
          String(item.albumId),
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
      const track = toPlayableSearchTrack(item);
      const currentIndex = playableSearchQueue.findIndex(
        (result) => result.id === item.id
      );

      await playTrack(
        track,
        playableSearchQueue,
        currentIndex >= 0 ? currentIndex : 0
      );
    },
    [
      showSuggestions,
      setShowSuggestions,
      handleJioSaavnAlbumSong,
      playTrack,
      playableSearchQueue,
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
        activeSearchRequestRef.current += 1;
        setSuggestions([]);
        setShowSuggestions(false);
        setIsLoadingSuggestions(false);
        setIsLoading(false);
        setIsLoadingMore(false);
        paginationRef.current.isLoadingMore = false;
        if (text.length === 0) {
          setHasSearched(false);
          setHasMoreResults(false);
          paginationRef.current.hasMore = false;
          paginationRef.current.nextpage = null;
          lastSearchRef.current = null;
        }
        // Don't clear search results unless the text is completely empty
        if (text.length === 0 && searchResults.length > 0) {
          setSearchResults([]);
        }
        return;
      }

      // Debounce suggestions (200ms - faster suggestions)
      typingTimeoutRef.current = setTimeout(async () => {
        try {
          setIsLoadingSuggestions(true);
          setShowSuggestions(true);
          const newSuggestions = await searchAPI.getSuggestions(
            text,
            selectedSource
          );

          setSuggestions(newSuggestions.slice(0, 5));
          setShowSuggestions(true);
        } catch (e) {
          console.log("Suggestion error", e);
          setSuggestions([]);
        } finally {
          setIsLoadingSuggestions(false);
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
    if (isRestoringSearchStateRef.current) {
      isRestoringSearchStateRef.current = false;
    }

    setSelectedSource(sourceId);
    setSelectedFilter(normalizeFilterForSource(sourceId, undefined));
  }, []);

  const onSuggestionPress = (item: string) => {
    setSearchQuery(item);
    setShowSuggestions(false);
    setIsLoadingSuggestions(false);
    handleSearch(item);
  };

  const clearSearch = () => {
    activeSearchRequestRef.current += 1;
    setSearchQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    setIsLoadingSuggestions(false);
    setSearchResults([]);
    setHasSearched(false);
    setHasMoreResults(false);
    setIsLoading(false);
    setIsLoadingMore(false);
    paginationRef.current.hasMore = false;
    paginationRef.current.isLoadingMore = false;
    paginationRef.current.nextpage = null;
    lastSearchRef.current = null;
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

    if (settings.rememberLastSearch) {
      void StorageService.clearLastSearchState();
    }
  };

  const handleOutsidePress = () => {
    if (showSuggestions) {
      setShowSuggestions(false);
    }
    Keyboard.dismiss();
  };

  return (
    <Screen padded={false}>
      <Header style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
        <SearchContainer
          style={{
            flexDirection: isRtl ? "row-reverse" : "row",
            backgroundColor: colors.surface1,
            borderColor: colors.borderSubtle,
            borderWidth: 1,
            paddingRight: isRtl ? 0 : 8,
            paddingLeft: isRtl ? 8 : 0,
          }}
        >
          <SearchIconWrapper
            style={{
              paddingLeft: isRtl ? 4 : 12,
              paddingRight: isRtl ? 12 : 4,
            }}
          >
            <Ionicons name="search" size={18} color={colors.muted} />
          </SearchIconWrapper>
          <SearchInput
            placeholder={t("search.placeholder", {
              source: t(activeSourceOption.labelKey),
            })}
            placeholderTextColor={colors.muted}
            value={searchQuery}
            onChangeText={handleTextChange}
            onSubmitEditing={() => handleSearch()}
            returnKeyType="search"
            style={[localizedTextStyle, { color: colors.foreground }]}
            textAlign={isRtl ? "right" : "left"}
            onFocus={() => {
              if (suggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
          />
          {searchQuery.length > 0 && (
            <ClearButton
              onPress={clearSearch}
              disabled={!searchQuery}
              style={{
                marginRight: isRtl ? 0 : 4,
                marginLeft: isRtl ? 4 : 0,
              }}
            >
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </ClearButton>
          )}
        </SearchContainer>
        <TouchableOpacity
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t("search.toggleFilters")}
          onPress={() => setShowFilters((current) => !current)}
          style={[
            styles.filterToggleButton,
            { marginLeft: isRtl ? 0 : 12, marginRight: isRtl ? 12 : 0 },
            {
              backgroundColor: colors.surface1,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <FilterIcon
            width={20}
            height={20}
            color={colors.muted}
            stroke={colors.muted}
          />
        </TouchableOpacity>
      </Header>

      <Animated.View
        pointerEvents={showFilters ? "auto" : "none"}
        style={[
          styles.filterPanel,
          {
            opacity: filtersAnimation,
            maxHeight: filtersAnimation.interpolate({
              inputRange: [0, 1],
              outputRange: [0, filterPanelHeight],
            }),
            marginBottom: filtersAnimation.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 12],
            }),
            transform: [
              {
                translateY: filtersAnimation.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-8, 0],
                }),
              },
            ],
          },
        ]}
      >
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={[
              styles.filterRowContent,
              {
                flexGrow: 1,
                flexDirection: isRtl ? "row-reverse" : "row",
                justifyContent: "flex-start",
              },
            ]}
          >
            {orderedSourceOptions.map((source) => (
              <Chip
                key={source.id}
                label={t(source.labelKey)}
                selected={selectedSource === source.id}
                onPress={() => handleSourceSelect(source.id)}
                chipStyle={[
                  styles.searchChip,
                  {
                    marginRight: isRtl ? 0 : 8,
                    marginLeft: isRtl ? 8 : 0,
                  },
                ]}
                textStyle={[
                  styles.searchChipText,
                  isRtl ? styles.searchChipTextRtl : null,
                ]}
                selectedBackgroundColor={source.color}
                selectedBorderColor={source.color}
                selectedTextColor="#000000"
                unselectedTextColor={colors.muted}
              />
            ))}
          </ScrollView>
          {activeFilterOptions.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterRowSpacing}
              contentContainerStyle={[
                styles.filterRowContent,
                {
                  flexGrow: 1,
                  flexDirection: isRtl ? "row-reverse" : "row",
                  justifyContent: "flex-start",
                },
              ]}
            >
              {activeFilterOptions.map((filter) => (
                <Chip
                  key={filter.value || "all"}
                  label={t(filter.labelKey)}
                  selected={selectedFilter === filter.value}
                  onPress={() => setSelectedFilter(filter.value)}
                  chipStyle={[
                    styles.searchChip,
                    {
                      marginRight: isRtl ? 0 : 8,
                      marginLeft: isRtl ? 8 : 0,
                    },
                  ]}
                  textStyle={[
                    styles.searchChipText,
                    isRtl ? styles.searchChipTextRtl : null,
                  ]}
                  unselectedTextColor={colors.muted}
                />
              ))}
            </ScrollView>
          ) : null}
        </>
      </Animated.View>

      {/* Suggestions Dropdown */}
      {showSuggestions && (suggestions.length > 0 || isLoadingSuggestions) && (
        <SuggestionsOverlay
          style={{
            backgroundColor: colors.surface1,
            borderColor: colors.borderSubtle,
            borderWidth: 1,
          }}
        >
          <SuggestionsHeader style={{ borderBottomColor: colors.borderSubtle }}>
            <SuggestionsCloseButton
              onPress={() => {
                setShowSuggestions(false);
                setIsLoadingSuggestions(false);
              }}
              style={{ backgroundColor: withOpacity(colors.foreground, 0.06) }}
            >
              <MutedText
                style={{
                  color: colors.muted,
                  fontSize: 11,
                  letterSpacing: 1.8,
                  textTransform: "uppercase",
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                }}
              >
                {t("common.close")}
              </MutedText>
            </SuggestionsCloseButton>
          </SuggestionsHeader>

          {isLoadingSuggestions && suggestions.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            suggestions.map((item, index) => (
              <SuggestionItem
                key={`${item}-${index}`}
                onPress={() => onSuggestionPress(item)}
                style={{
                  flexDirection: isRtl ? "row-reverse" : "row",
                  borderBottomColor:
                    index === suggestions.length - 1
                      ? "transparent"
                      : colors.borderSubtle,
                }}
              >
                <SuggestionText
                  numberOfLines={1}
                  style={[
                    { color: colors.foreground },
                    localizedTextStyle,
                    isRtl ? styles.suggestionTextRtl : null,
                  ]}
                >
                  {item}
                </SuggestionText>
                <SuggestionMeta
                  style={{ color: withOpacity(colors.foreground, 0.32) }}
                >
                  {String(index + 1).padStart(2, "0")}
                </SuggestionMeta>
              </SuggestionItem>
            ))
          )}
        </SuggestionsOverlay>
      )}

      {/* Results List */}
      <ResultsContainer
        ref={scrollViewRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 }}
        onScrollBeginDrag={handleOutsidePress}
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
              <SkeletonRow
                style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
              >
                <SkeletonThumbnail
                  style={{
                    backgroundColor: withOpacity(colors.foreground, 0.12),
                    marginRight: isRtl ? 0 : 12,
                    marginLeft: isRtl ? 12 : 0,
                  }}
                />
                <SkeletonTextBlock>
                  <SkeletonLinePrimary
                    style={{
                      backgroundColor: withOpacity(colors.foreground, 0.12),
                    }}
                  />
                  <SkeletonLineSecondary
                    style={{
                      backgroundColor: withOpacity(colors.foreground, 0.08),
                    }}
                  />
                </SkeletonTextBlock>
              </SkeletonRow>
            </Animated.View>
          ))}

        {!isLoading && !trimmedSearchQuery && (
          <View style={styles.categoryGrid}>
            {visibleCategoryPlaylists.map((category) => {
              const imageSource =
                SEARCH_CATEGORY_IMAGES[
                  category.category as keyof typeof SEARCH_CATEGORY_IMAGES
                ];
              const isWideCategory = category.category === "Synthwave";
              const hasPlaylistTarget = Boolean(
                getSearchCategoryPlaylistId(category)
              );

              return (
                <TouchableOpacity
                  key={category.category}
                  activeOpacity={0.9}
                  style={[
                    styles.categoryCard,
                    isWideCategory ? styles.categoryCardWide : null,
                  ]}
                  onPress={() => handleCategorySelect(category)}
                >
                  <View
                    style={[
                      styles.categoryCardImage,
                      isWideCategory ? styles.categoryCardImageWide : null,
                    ]}
                  >
                    <Image
                      source={imageSource}
                      resizeMode="cover"
                      style={styles.categoryCardImageInner}
                    />
                    <View style={styles.categoryCardOverlay} />
                    <MutedText
                      style={[
                        styles.categoryCardLabel,
                        centeredCategoryTextStyle,
                      ]}
                    >
                      {t(`search.category.${category.category}`)}
                    </MutedText>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {!isLoading &&
          trimmedSearchQuery.length > 0 &&
          hasSearched &&
          searchResults.length === 0 && (
            <NoResultsText
              style={[{ color: colors.muted }, centeredLocalizedTextStyle]}
            >
              {copy.noResults}
            </NoResultsText>
          )}

        {!isLoading &&
          trimmedSearchQuery.length > 0 &&
          searchResults.length > 0 && (
            <>
              {/* Top Query Results */}
              {filteredResults.topResults.length > 0 && (
                <SearchSection
                  items={filteredResults.topResults}
                  title={copy.topResult}
                  onItemPress={handleTopResultPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                  selectedFilter={selectedFilter}
                  selectedSource={selectedSource}
                />
              )}

              {/* Artists Section */}
              {filteredResults.artists.length > 0 && (
                <SearchSection
                  items={filteredResults.artists}
                  title={t("search.artists")}
                  onItemPress={handleArtistPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                  selectedFilter={selectedFilter}
                  selectedSource={selectedSource}
                />
              )}

              {/* Albums Section - Hide for YouTube and YouTube Music */}
              {filteredResults.albums.length > 0 &&
                selectedSource !== "youtube" &&
                selectedSource !== "youtubemusic" && (
                  <SearchSection
                    items={filteredResults.albums}
                    title={t("search.albums")}
                    onItemPress={handleAlbumPress}
                    searchQuery={searchQuery}
                    showSuggestions={showSuggestions}
                    setShowSuggestions={setShowSuggestions}
                    navigation={navigation}
                    playTrack={playTrack}
                    searchResults={searchResults}
                    selectedFilter={selectedFilter}
                    selectedSource={selectedSource}
                  />
                )}

              {/* Playlists Section */}
              {filteredResults.playlists.length > 0 && (
                <SearchSection
                  items={filteredResults.playlists}
                  title={t("search.playlists")}
                  onItemPress={handleAlbumPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                  selectedFilter={selectedFilter}
                  selectedSource={selectedSource}
                />
              )}

              {/* Songs Section */}
              {filteredResults.songs.length > 0 && (
                <SearchSection
                  items={filteredResults.songs}
                  title={t("search.songs")}
                  onItemPress={handleSongPress}
                  searchQuery={searchQuery}
                  showSuggestions={showSuggestions}
                  setShowSuggestions={setShowSuggestions}
                  navigation={navigation}
                  playTrack={playTrack}
                  searchResults={searchResults}
                  selectedFilter={selectedFilter}
                  selectedSource={selectedSource}
                />
              )}

              {/* Load More Button or End of Results - Only at the end of all content */}
              {!hasMoreResults && searchResults.length > 0 ? (
                <View style={{ paddingVertical: 20, alignItems: "center" }}>
                  <MutedText>{copy.endResults}</MutedText>
                </View>
              ) : (
                hasMoreResults && (
                  <View style={{ paddingVertical: 20, alignItems: "center" }}>
                    {isLoadingMore ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <AccentButton
                        title={copy.loadMore}
                        onPress={loadMoreResults}
                      />
                    )}
                  </View>
                )
              )}
            </>
          )}
      </ResultsContainer>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterPanel: {
    overflow: "hidden",
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    paddingTop: 4,
    paddingBottom: 16,
  },
  categoryCard: {
    width: "48.5%",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 8,
  },
  categoryCardWide: {
    width: "100%",
  },
  categoryCardImage: {
    aspectRatio: 1.5,
    justifyContent: "flex-end",
    position: "relative",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  categoryCardImageWide: {
    aspectRatio: 3.1,
  },
  categoryCardImageInner: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
  categoryCardOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
  categoryCardLabel: {
    color: "#ffffff",
    fontSize: 18,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontFamily: "GoogleSansBold",
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  filterToggleButton: {
    width: 48,
    height: 48,
    marginLeft: 12,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: {
    marginHorizontal: 16,
    marginBottom: 0,
    maxHeight: 36,
  },
  filterRowContent: {
    paddingHorizontal: 0,
    alignItems: "center",
  },
  filterRowSpacing: {
    marginHorizontal: 16,
    marginTop: 8,
    maxHeight: 36,
  },
  searchChip: {
    height: 32,
    minHeight: 32,
    marginRight: 8,
    paddingHorizontal: 12,
    alignSelf: "center",
  },
  searchChipText: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: "GoogleSansSemiBold",
    textTransform: "uppercase",
  },
  searchChipTextRtl: {
    fontFamily: "YekanBakhBold",
    textTransform: "none",
  },
  suggestionTextRtl: {
    marginLeft: 0,
    marginRight: 10,
  },
});
