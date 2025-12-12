import React, { useState, useCallback, useRef } from "react";
import { Keyboard, ScrollView, ScrollViewProps } from "react-native";
import styled from "styled-components/native";
import StreamItem from "../StreamItem";
import { searchAPI } from "../../lib/searchAPI";
import { SafeArea } from "../SafeArea";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

const Header = styled.View`
  padding: 16px;
  flex-direction: row;
  align-items: center;
  background-color: #171717;
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

const SearchButton = styled.TouchableOpacity`
  margin-left: 12px;
  width: 48px;
  height: 48px;
  border-radius: 24px;
  background-color: #a3e635;
  align-items: center;
  justify-content: center;
`;

const SearchButtonText = styled.Text`
  color: #000;
  font-size: 18px;
  font-weight: 600;
`;

// CHANGED: View -> ScrollView
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

// CHANGED: View -> ScrollView (Horizontal)
const FilterContainer = styled.ScrollView`
  background-color: #171717;
  max-height: 60px;
`;

const FilterButton = styled.TouchableOpacity<{ active?: boolean }>`
  padding: 8px 16px;
  border-radius: 20px;
  background-color: ${(p: { active?: boolean }) =>
    p.active ? "#a3e635" : "#262626"};
  margin-right: 8px;
`;

const FilterButtonText = styled.Text<{ active?: boolean }>`
  color: ${(p: { active?: boolean }) => (p.active ? "#000" : "#fff")};
  font-size: 14px;
  font-weight: 600;
`;
const SuggestionsOverlay = styled.View`
  position: absolute;
  top: 80px; /* Header height (16pad + 48input + 16pad) */
  left: 16px;
  right: 16px;
  background-color: #262626;
  border-radius: 12px;
  z-index: 100; /* Ensure it floats on top */
  elevation: 5; /* Android shadow */
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
}

const searchFilters = [
  { value: "", label: "All" },
  { value: "music_songs", label: "Songs" },
  { value: "videos", label: "Videos" },
  { value: "date", label: "Latest" },
  { value: "views", label: "Popular" },
];

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState("");

  // Debounce timeout ref
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Updated to accept an optional argument for immediate search
  function shortCount(num: number | string): string {
    const n = typeof num === "string" ? parseInt(num, 10) : num;
    if (Number.isNaN(n)) return "";
    if (n < 1_000) return n.toString();
    if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(".0", "")}K`;
    if (n < 1_000_000_000)
      return `${(n / 1_000_000).toFixed(1).replace(".0", "")}M`;
    return `${(n / 1_000_000_000).toFixed(1).replace(".0", "")}B`;
  }

  function timeAgo(ts: number | string): string {
    const s = typeof ts === "string" ? parseInt(ts, 10) : ts;
    const seconds = Date.now() / 1000 - s;
    const units = [
      { label: "year", div: 31_536_000 },
      { label: "month", div: 2_592_000 },
      { label: "week", div: 604_800 },
      { label: "day", div: 86_400 },
      { label: "hour", div: 3_600 },
      { label: "minute", div: 60 },
    ];
    for (const u of units) {
      const val = Math.floor(seconds / u.div);
      if (val >= 1) return `${val} ${u.label}${val > 1 ? "s" : ""} ago`;
    }
    return "just now";
  }
  /* --------------------------------- */

  const handleSearch = useCallback(
    async (manualQuery?: string) => {
      const queryToUse = manualQuery || searchQuery;
      if (!queryToUse.trim()) return;

      setShowSuggestions(false);
      Keyboard.dismiss();
      setIsLoading(true);

      try {
        const results =
          selectedFilter === "date" || selectedFilter === "views"
            ? await searchAPI.searchWithInvidious(queryToUse, selectedFilter)
            : await searchAPI.searchWithPiped(queryToUse, selectedFilter);

        const formattedResults = searchAPI
          .formatSearchResults(results)
          .map((r) => ({
            ...r,
            views: r.views ? shortCount(r.views) + " views" : undefined,
            // keep the text we got, but drop the duplicate view-count part
            uploaded: r.uploaded?.replace(
              /([\d.]+[MKB]?)\s*views?\s*•?\s*/i,
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
    [searchQuery, selectedFilter]
  );

  const handleTextChange = (text: string) => {
    setSearchQuery(text);

    // Clear previous timeout
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    if (text.length > 1) {
      // Set new timeout to fetch suggestions (Debounce 300ms)
      typingTimeoutRef.current = setTimeout(async () => {
        try {
          const newSuggestions = await searchAPI.getSuggestions(text);
          setSuggestions(newSuggestions.slice(0, 5)); // Limit to 5
          setShowSuggestions(true);
        } catch (error) {
          console.log("Suggestion error", error);
        }
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const onSuggestionPress = (item: string) => {
    setSearchQuery(item);
    handleSearch(item); // Pass item directly to avoid state lag
  };

  const formatDuration = (seconds: number): string => {
    if (seconds === 0) return "LIVE";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0)
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <SafeArea>
      <Header>
        <SearchInput
          placeholder="Search for songs, artists, or albums..."
          placeholderTextColor="#a3a3a3"
          value={searchQuery}
          onChangeText={handleTextChange}
          onSubmitEditing={() => handleSearch()}
          returnKeyType="search"
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
          }}
        />
        <SearchButton onPress={() => handleSearch()}>
          <SearchButtonText>🔍</SearchButtonText>
        </SearchButton>
      </Header>

      {/* SUGGESTIONS OVERLAY */}
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

      <FilterContainer
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
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

      <ResultsContainer
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {isLoading && <LoadingText>Searching...</LoadingText>}
        {!isLoading &&
          searchResults.length === 0 &&
          searchQuery.trim() !== "" && (
            <NoResultsText>No results found for "{searchQuery}"</NoResultsText>
          )}
        {!isLoading &&
          searchResults.map((item) => (
            <StreamItem
              key={item.id}
              id={item.id}
              title={item.title}
              author={item.author}
              duration={formatDuration(parseInt(item.duration) || 0)}
              views={item.views}
              uploaded={item.uploaded}
              thumbnailUrl={item.thumbnailUrl}
            />
          ))}
      </ResultsContainer>
    </SafeArea>
  );
}
