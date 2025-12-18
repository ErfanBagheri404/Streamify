import React, { useState, useCallback, useRef, useEffect } from "react";
import { Keyboard, TouchableOpacity, View } from "react-native";
import styled from "styled-components/native";
import StreamItem from "../StreamItem";
import { searchAPI } from "../../modules/searchAPI";
import { SafeArea } from "../SafeArea";
import { usePlayer } from "../../contexts/PlayerContext";

// --- Styled Components ---

const Header = styled.View`
  padding: 16px;
  flex-direction: row;
  align-items: center;
`;

const SearchInput = styled.TextInput`
  flex: 1;
  height: 48px;
  background-color: #262626;
  border-radius: 24px;
  padding: 0 16px;
  color: #fff;
  font-size: 16px;
`;

const ResultsContainer = styled.ScrollView`
  flex: 1;
`;

const NoResultsText = styled.Text`
  color: #a3a3a3;
  text-align: center;
  margin-top: 32px;
  font-size: 16px;
`;

const LoadingText = styled.Text`
  color: #a3a3a3;
  text-align: center;
  margin-top: 32px;
  font-size: 16px;
`;

// --- NEW: Source Filter Styles (Pill Shape) ---
const SourceContainer = styled.View`
  flex-direction: row;
  padding: 0 16px 12px 16px;
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
  font-weight: 700;
  text-transform: uppercase;
`;

// --- FIXED: Sub-Filter Styles ---
const FilterContainer = styled.ScrollView`
  max-height: 50px;
  margin-bottom: 8px;
`;

const FilterButton = styled.TouchableOpacity<{ active?: boolean }>`
  padding: 8px 18px;
  height: 36px;
  border-radius: 18px; /* Consistent Pill Shape */
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
  font-weight: 600;
`;

const SuggestionsOverlay = styled.View`
  position: absolute;
  top: 80px;
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
`;

const SuggestionIcon = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
`;

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
  source?: "youtube" | "soundcloud";
}

const sourceFilters = [
  { id: "youtube", label: "YouTube", color: "#ff0000" }, // YouTube Red
  { id: "soundcloud", label: "SoundCloud", color: "#ff7700" }, // SC Orange
  { id: "spotify", label: "Spotify", color: "#1db954" }, // Spotify Green
];

const searchFilters = [
  { value: "", label: "All" },
  { value: "music_songs", label: "Songs" },
  { value: "videos", label: "Videos" },
  { value: "date", label: "Latest" },
  { value: "views", label: "Popular" },
];

// --- Main Component ---

export default function SearchScreen({ navigation }: any) {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { playTrack } = usePlayer();

  // Debug: Log when component mounts/unmounts
  useEffect(() => {
    console.log(
      `[Search] SearchScreen mounted/updated. Results: ${searchResults.length}, Query: "${searchQuery}"`
    );
    return () => {
      console.log(
        `[Search] SearchScreen unmounting. Results: ${searchResults.length}, Query: "${searchQuery}"`
      );
      // Clear all timeouts on unmount
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchResults.length, searchQuery]);

  // Restore search results when returning from PlayerScreen
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      console.log(
        `[Search] Screen focused - preserving results: ${searchResults.length} items`
      );
      // Don't clear results when returning from PlayerScreen
      if (searchResults.length === 0 && searchQuery.trim()) {
        console.log(
          `[Search] Results empty but query exists: "${searchQuery}", restoring search`
        );
        handleSearch(searchQuery);
      }
    });

    return unsubscribe;
  }, [navigation, searchResults.length, searchQuery]);

  // State for Filters
  const [selectedSource, setSelectedSource] = useState("youtube");
  const [selectedFilter, setSelectedFilter] = useState("");

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const formatDuration = (seconds: number): string => {
    if (seconds === 0) {
      return "LIVE";
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

  // --- Search Handling ---

  const handleSearch = useCallback(
    async (manualQuery?: string) => {
      const queryToUse = manualQuery || searchQuery;
      console.log(
        `[Search] handleSearch called with query: "${queryToUse}" (manual: ${
          manualQuery || "none"
        })`
      );
      if (!queryToUse.trim()) {
        return;
      }

      // Don't clear results if we're already showing results for the same query
      if (searchResults.length > 0 && searchQuery === queryToUse) {
        console.log(
          `[Search] Query unchanged (${queryToUse}), preserving existing results`
        );
        return;
      }

      setShowSuggestions(false);
      Keyboard.dismiss();
      setIsLoading(true);

      // Only clear results if we're actually changing the search query
      if (searchQuery !== queryToUse || searchResults.length === 0) {
        console.log(
          `[Search] Clearing results for new query: "${queryToUse}" (was: "${searchQuery}")`
        );
        setSearchResults([]);
      } else {
        console.log(
          `[Search] Preserving existing results for same query: "${queryToUse}"`
        );
      }

      try {
        let results: any[] = [];

        if (selectedSource === "soundcloud") {
          // SoundCloud Search
          results = await searchAPI.searchWithSoundCloud(queryToUse);
        } else if (selectedSource === "spotify") {
          // Placeholder for Spotify
          console.log("Spotify search not implemented yet");
          results = [];
        } else {
          // YouTube (Default)
          results =
            selectedFilter === "date" || selectedFilter === "views"
              ? await searchAPI.searchWithInvidious(queryToUse, selectedFilter)
              : await searchAPI.searchWithPiped(queryToUse, selectedFilter);
        }

        // Common formatter (only format if not already formatted)
        let formattedResults = results;

        // Only format if results are not already formatted (SoundCloud results are pre-formatted)
        if (
          selectedSource !== "soundcloud" &&
          results.length > 0 &&
          !results[0].source
        ) {
          formattedResults = searchAPI.formatSearchResults(results);
        }

        // Apply display formatting
        formattedResults = formattedResults.map((r) => ({
          ...r,
          views: r.views ? shortCount(r.views) + " views" : undefined,
          // Remove YouTube-specific noise from upload string
          uploaded: r.uploaded?.replace(
            /(\[\d.\]+\['MKB'\]?)\s*views?\s*•?\s*/i,
            ""
          ),
        }));

        setSearchResults(formattedResults);
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [searchQuery, selectedFilter, selectedSource]
  );

  // Auto-trigger search when switching Sources/Filters if we have a query
  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      handleSearch();
    }
  }, [selectedSource, selectedFilter]);

  // Reset filters when switching sources (e.g. "Videos" filter doesn't apply to SoundCloud)
  useEffect(() => {
    setSelectedFilter("");
  }, [selectedSource]);

  const handleTextChange = (text: string) => {
    console.log(
      `[Search] handleTextChange called with: "${text}" (current: "${searchQuery}")`
    );
    setSearchQuery(text);

    // Clear existing timeouts
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (text.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      // Don't clear search results unless the text is completely empty
      if (text.length === 0 && searchResults.length > 0) {
        console.log("[Search] Clearing search results due to empty query");
        setSearchResults([]);
      }
      return;
    }

    // Debounce suggestions (400ms)
    typingTimeoutRef.current = setTimeout(async () => {
      try {
        console.log(
          `[Search] Getting suggestions for: "${text}" from ${selectedSource}`
        );
        const newSuggestions = await searchAPI.getSuggestions(
          text,
          selectedSource
        );
        console.log(
          `[Search] Received ${newSuggestions.length} suggestions:`,
          newSuggestions
        );
        setSuggestions(newSuggestions.slice(0, 5));
        setShowSuggestions(true);
      } catch (e) {
        console.log("Suggestion error", e);
      }
    }, 400);

    // Debounce search separately (1000ms - longer delay for actual search)
    searchTimeoutRef.current = setTimeout(() => {
      // Auto-trigger search for SoundCloud when user stops typing (3+ characters)
      if (selectedSource === "soundcloud") {
        console.log(`[Search] Auto-searching SoundCloud for: "${text}"`);
        handleSearch(text);
      }
    }, 1000); // 1 second delay for search
  };

  const onSuggestionPress = (item: string) => {
    setSearchQuery(item);
    handleSearch(item);
  };

  return (
    <SafeArea>
      <Header>
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
      </Header>

      {/* 1. Source Selectors (YouTube / SoundCloud / Spotify) */}
      <SourceContainer>
        {sourceFilters.map((source) => (
          <SourceButton
            key={source.id}
            active={selectedSource === source.id}
            color={source.color}
            onPress={() => setSelectedSource(source.id)}
          >
            <SourceButtonText active={selectedSource === source.id}>
              {source.label}
            </SourceButtonText>
          </SourceButton>
        ))}
      </SourceContainer>

      {/* 2. Sub-Filters (Only for YouTube currently) */}
      {selectedSource === "youtube" && (
        <FilterContainer
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {searchFilters.map((filter) => (
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
            <SuggestionItem key={index} onPress={() => onSuggestionPress(item)}>
              <SuggestionIcon>🔍</SuggestionIcon>
              <SuggestionText>{item}</SuggestionText>
            </SuggestionItem>
          ))}
        </SuggestionsOverlay>
      )}

      {/* Results List */}
      <ResultsContainer
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {isLoading && <LoadingText>Searching...</LoadingText>}

        {!isLoading && searchResults.length === 0 && (
          <NoResultsText>
            {searchQuery.trim() === ""
              ? "Search for artists, albums, or songs"
              : `No results found for "${searchQuery}"`}
          </NoResultsText>
        )}

        {!isLoading &&
          searchResults.map((item, index) => (
            <TouchableOpacity
              key={`${item.source || "yt"}-${item.id}`}
              onPress={async () => {
                // Play track using player context instead of navigation
                console.log(
                  `[Search] Playing track: ${item.title} (${item.id})`
                );

                // Format track data for player context
                const track = {
                  id: item.id,
                  title: item.title,
                  artist: item.author,
                  duration: parseInt(item.duration) || 0,
                  thumbnail: item.thumbnailUrl || item.img,
                  audioUrl: undefined, // Will be fetched by player context
                  source: item.source || "youtube",
                  _isSoundCloud: item.source === "soundcloud",
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
                  })),
                  index
                );
              }}
            >
              <StreamItem
                id={item.id}
                title={item.title}
                author={item.author}
                duration={formatDuration(parseInt(item.duration) || 0)}
                views={item.views}
                uploaded={item.uploaded}
                thumbnailUrl={item.thumbnailUrl}
              />
            </TouchableOpacity>
          ))}
      </ResultsContainer>
    </SafeArea>
  );
}
