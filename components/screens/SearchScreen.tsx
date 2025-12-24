import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Keyboard,
  TouchableOpacity,
  View,
  TouchableWithoutFeedback,
  Platform,
  ScrollView,
} from "react-native";
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
  padding: 10px 0px 0px 10px;
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
  font-weight: 700;
  text-transform: uppercase;
`;

// --- SECTION STYLES ---
const SectionContainer = styled.View`
  margin-bottom: 16px;
`;

const SectionTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  margin-left: 16px;
  margin-bottom: 8px;
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
`;

const SuggestionIcon = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
`;

type SourceType = "youtube" | "soundcloud" | "spotify" | "jiosaavn";

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
  source?: "youtube" | "soundcloud" | "jiosaavn";
  type?: "song" | "album" | "artist" | "unknown";
  albumId?: string;
  albumName?: string;
  albumYear?: string;
}

const sourceFilters: { id: SourceType; label: string; color: string }[] = [
  { id: "youtube", label: "YouTube", color: "#ff0000" }, // YouTube Red
  { id: "soundcloud", label: "SoundCloud", color: "#ff7700" }, // SC Orange
  { id: "spotify", label: "Spotify", color: "#1db954" }, // Spotify Green
  { id: "jiosaavn", label: "JioSaavn", color: "#1fa18a" }, // JioSaavn Orange
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
  const { playTrack } = usePlayer();

  useEffect(() => {
    console.log(
      `[Search] SearchScreen mounted/updated. Results: ${searchResults.length}, Query: "${searchQuery}"`
    );
    return () => {
      console.log(
        `[Search] SearchScreen cleanup. Previous results: ${searchResults.length}, Query: "${searchQuery}"`
      );
    };
  }, [searchResults.length, searchQuery]);

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

  // State for source filters with reordering
  const [sourceFilters, setSourceFilters] = useState([
    { id: "youtube" as SourceType, label: "YouTube", color: "#ff0000" },
    { id: "soundcloud" as SourceType, label: "SoundCloud", color: "#ff7700" },
    { id: "spotify" as SourceType, label: "Spotify", color: "#1db954" },
    { id: "jiosaavn" as SourceType, label: "JioSaavn", color: "#1fa18a" },
  ]);

  const [selectedSource, setSelectedSource] = useState<SourceType>("youtube");
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

  const formatDuration = (seconds: number, source?: string): string => {
    if (seconds === 0) {
      // Don't show LIVE for JioSaavn when duration is 0
      if (source === "jiosaavn") {
        return "";
      }
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
        } else if (selectedSource === "jiosaavn") {
          // JioSaavn Search
          results = await searchAPI.searchWithJioSaavn(queryToUse);
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

    if (text.trim().length < 2) {
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
      if (text.trim().length >= 2) {
        console.log(`[Search] Auto-searching ${selectedSource} for: "${text}"`);
        handleSearch(text);
      }
    }, 1000); // 1 second delay for search
  };

  const handleSourceSelect = useCallback((sourceId: SourceType) => {
    console.log(`[Search] Source selected: ${sourceId}`);

    // Configure layout animation for smooth reordering
    // Layout animation is handled by React Native's built-in animations

    // Reorder sources - move selected to first position
    setSourceFilters((prevFilters) => {
      const selectedFilter = prevFilters.find((f) => f.id === sourceId);
      if (!selectedFilter) return prevFilters;

      const otherFilters = prevFilters.filter((f) => f.id !== sourceId);
      return [selectedFilter, ...otherFilters];
    });

    setSelectedSource(sourceId);
  }, []);

  // Handle JioSaavn album songs - open album playlist
  const handleJioSaavnAlbumSong = useCallback(
    async (item: any) => {
      if (!item.albumId || !item.albumName) {
        console.log(
          `[Search] JioSaavn song has no album info, playing directly: ${item.title}`
        );
        return false; // Play directly
      }

      console.log(
        `[Search] Opening JioSaavn album playlist: ${item.albumName} (${item.albumId})`
      );

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
          console.log(
            `[Search] Found ${albumDetails.songs.length} songs in album`
          );

          // Create playlist from album songs
          const albumPlaylist = albumDetails.songs.map((song: any) => ({
            id: String(song.id),
            title: song.name || song.title || song.song || "Unknown Title",
            artist:
              song.artists?.primary
                ?.map((artist: any) => artist.name)
                .join(", ") ||
              song.singers ||
              "Unknown Artist",
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
          console.log(
            `[Search] Opening album playlist at index ${selectedIndex}`
          );
          navigation.navigate("PlayerScreen", {
            playlist: albumPlaylist,
            currentIndex: selectedIndex,
            autoPlay: false, // Don't auto-play, just show the playlist
            highlightTrack: item.id, // Highlight the selected track
          });

          return true; // Album playlist opened
        }
      } catch (error) {
        console.error(`[Search] Error opening JioSaavn album:`, error);
      }

      return false; // Fallback to direct play
    },
    [navigation]
  );

  const onSuggestionPress = (item: string) => {
    setSearchQuery(item);
    setShowSuggestions(false);
    handleSearch(item);
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
                    console.log("[Search] Spotify is currently disabled");
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

        {/* 2. Sub-Filters (Only for YouTube currently) - COMMENTED OUT FOR NOW */}
        {/* {selectedSource === "youtube" && (
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
        )} */}

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
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 120 }} // Increased padding for last items accessibility
        >
          {isLoading && <LoadingText>Searching...</LoadingText>}

          {!isLoading && searchResults.length === 0 && (
            <NoResultsText>
              Start searching for artists, albums, or songs
            </NoResultsText>
          )}

          {!isLoading && searchResults.length > 0 && (
            <>
              {/* Debug: Show what we found */}
              {(() => {
                console.log(
                  `[Search] Search results:`,
                  searchResults.map((item) => ({
                    title: item.title,
                    type: item.type,
                    source: item.source,
                    albumId: item.albumId,
                    id: item.id,
                  }))
                );
                return null;
              })()}

              {/* Group results by type while maintaining API order within each section */}

              {/* Top Query Results */}
              {searchResults.filter((item) => item.type === "unknown").length >
                0 && (
                <SectionContainer>
                  <SectionTitle>Top Result</SectionTitle>
                  {searchResults
                    .filter((item) => item.type === "unknown")
                    .map((item, index) => (
                      <TouchableOpacity
                        key={`top-${item.source || "yt"}-${item.id}`}
                        onPress={async () => {
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
                        }}
                      >
                        <StreamItem
                          id={item.id}
                          title={item.title}
                          author={item.author}
                          duration={formatDuration(
                            parseInt(item.duration) || 0,
                            item.source
                          )}
                          views={
                            item.source === "jiosaavn" ? undefined : item.views
                          }
                          uploaded={item.uploaded}
                          thumbnailUrl={item.thumbnailUrl}
                          isAlbum={!!item.albumId}
                          albumYear={item.albumYear}
                          source={item.source}
                        />
                      </TouchableOpacity>
                    ))}
                </SectionContainer>
              )}

              {/* Artists Section - Show exact matches first, then others */}
              {searchResults.filter((item) => item.type === "artist").length >
                0 && (
                <SectionContainer>
                  <SectionTitle>Artists</SectionTitle>
                  {searchResults
                    .filter((item) => {
                      // Additional filtering for collaborations
                      if (item.type !== "artist") return false;

                      // Skip collaboration artists for individual searches
                      const isSearchingForIndividualArtist =
                        !searchQuery.includes("&") &&
                        !searchQuery.toLowerCase().includes(" and ");

                      if (isSearchingForIndividualArtist) {
                        const artistName = item.title.toLowerCase().trim();
                        if (
                          artistName.includes("&") ||
                          artistName.includes(" and ") ||
                          artistName.includes(" feat ") ||
                          artistName.includes(" ft ")
                        ) {
                          return false; // Skip collaboration artists
                        }
                      }

                      return true;
                    })
                    .filter((item) => item.type === "artist")
                    .sort((a, b) => {
                      // Prioritize exact matches
                      const queryLower = searchQuery.toLowerCase().trim();
                      const aIsExact =
                        a.title.toLowerCase().trim() === queryLower;
                      const bIsExact =
                        b.title.toLowerCase().trim() === queryLower;

                      if (aIsExact && !bIsExact) return -1;
                      if (!aIsExact && bIsExact) return 1;
                      return 0;
                    })
                    .map((item, index) => (
                      <TouchableOpacity
                        key={`artist-${item.source || "yt"}-${item.id}`}
                        onPress={async () => {
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
                        }}
                      >
                        <StreamItem
                          id={item.id}
                          title={item.title}
                          author={item.author}
                          duration={formatDuration(
                            parseInt(item.duration) || 0,
                            item.source
                          )}
                          views={
                            item.source === "jiosaavn" ? undefined : item.views
                          }
                          uploaded={item.uploaded}
                          thumbnailUrl={item.thumbnailUrl}
                          isAlbum={false}
                          albumYear={item.albumYear}
                          source={item.source}
                        />
                      </TouchableOpacity>
                    ))}
                </SectionContainer>
              )}

              {/* Albums Section */}
              {searchResults.filter((item) => item.type === "album").length >
                0 && (
                <SectionContainer>
                  <SectionTitle>Albums</SectionTitle>
                  {searchResults
                    .filter((item) => item.type === "album")
                    .map((item, index) => (
                      <TouchableOpacity
                        key={`album-${item.source || "yt"}-${item.id}`}
                        onPress={async () => {
                          // Navigate to album playlist screen
                          if (item.source === "jiosaavn") {
                            console.log(
                              `[Search] Opening album playlist: ${item.title} (ID: ${item.id}, Artist: ${item.author})`
                            );
                            navigation.navigate("AlbumPlaylist", {
                              albumId: item.id,
                              albumName: item.title,
                              albumArtist: item.author,
                              source: item.source,
                            });
                          } else {
                            console.log(
                              `[Search] Album ${item.title} is not JioSaavn, skipping navigation`
                            );
                          }
                        }}
                      >
                        <StreamItem
                          id={item.id}
                          title={item.title}
                          author={item.author}
                          duration={formatDuration(
                            parseInt(item.duration) || 0,
                            item.source
                          )}
                          views={
                            item.source === "jiosaavn" ? undefined : item.views
                          }
                          uploaded={item.uploaded}
                          thumbnailUrl={item.thumbnailUrl}
                          isAlbum={true}
                          albumYear={item.albumYear}
                          source={item.source}
                        />
                      </TouchableOpacity>
                    ))}
                </SectionContainer>
              )}

              {/* Songs Section */}
              {searchResults.filter(
                (item) => !item.type || item.type === "song"
              ).length > 0 && (
                <SectionContainer>
                  <SectionTitle>Songs</SectionTitle>
                  {searchResults
                    .filter((item) => {
                      // Filter songs by type first
                      if (item.type && item.type !== "song") return false;
                      if (item.type === undefined && item.type !== undefined)
                        return false;

                      // Skip collaboration songs for individual artist searches
                      const isSearchingForIndividualArtist =
                        !searchQuery.includes("&") &&
                        !searchQuery.toLowerCase().includes(" and ");

                      if (isSearchingForIndividualArtist && item.author) {
                        const artistName = item.author.toLowerCase().trim();
                        if (
                          artistName.includes("&") ||
                          artistName.includes(" and ") ||
                          artistName.includes(" feat ") ||
                          artistName.includes(" ft ")
                        ) {
                          return false; // Skip collaboration songs
                        }
                      }

                      return true;
                    })
                    .filter((item) => !item.type || item.type === "song")
                    .map((item, index) => (
                      <TouchableOpacity
                        key={`song-${item.source || "yt"}-${item.id}`}
                        onPress={async () => {
                          // Handle JioSaavn album songs
                          if (item.source === "jiosaavn" && item.albumId) {
                            console.log(
                              `[Search] Checking JioSaavn song for album: ${item.title}`
                            );
                            const albumOpened =
                              await handleJioSaavnAlbumSong(item);
                            if (albumOpened) {
                              return; // Album playlist opened, don't play directly
                            }
                          }

                          // Play track using player context
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
                        }}
                      >
                        <StreamItem
                          id={item.id}
                          title={item.title}
                          author={item.author}
                          duration={formatDuration(
                            parseInt(item.duration) || 0,
                            item.source
                          )}
                          views={
                            item.source === "jiosaavn" ? undefined : item.views
                          }
                          uploaded={item.uploaded}
                          thumbnailUrl={item.thumbnailUrl}
                          isAlbum={!!item.albumId}
                          albumYear={item.albumYear}
                          source={item.source}
                        />
                      </TouchableOpacity>
                    ))}
                </SectionContainer>
              )}
            </>
          )}
        </ResultsContainer>
      </SafeArea>
    </TouchableWithoutFeedback>
  );
}
