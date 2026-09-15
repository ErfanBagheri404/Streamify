/********************************************************************
 *  LyricsSearchSheet.tsx - Fuzzy LRCLIB /search picker for the playing track
 *
 *  Lets a user find synced lyrics when the automatic exact-match lookup fails
 *  (YouTube titles with "(Official Video)", remix tags, casing, etc).
 *
 *  Perf contract: no timers, no listeners, no polling. One search request per
 *  tap on Search (debounced at 0ms — user-triggered only). The result list is
 *  a plain map over <= 10 items, so no FlatList virtualization is needed.
 *  Nothing renders unless `visible` is true.
 *******************************************************************/
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, TouchableOpacity, Text, TextInput } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { t } from "../utils/localization";
import { lyricsService, type LyricsSearchResult } from "../modules/lyricsService";
import type { Track } from "../contexts/PlayerContext";

interface LyricsSearchSheetProps {
  visible: boolean;
  track: Track | null;
  onClose: () => void;
  onApply: (result: LyricsSearchResult) => void;
}

const SheetBackdrop = styled(TouchableOpacity)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.6);
`;

const SheetBody = styled.View`
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 20px 18px 28px 18px;
  max-height: 560px;
`;

const SheetHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const SheetTitle = styled.Text`
  font-size: 17px;
`;

const SearchRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
`;

const SearchInput = styled(TextInput)`
  flex: 1;
  min-height: 44px;
  border-radius: 12px;
  border-width: 1px;
  padding-horizontal: 14px;
  font-size: 15px;
`;

const ResultRow = styled(TouchableOpacity)`
  padding-vertical: 12px;
  padding-horizontal: 4px;
  border-bottom-width: 1px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const formatDuration = (seconds?: number): string => {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
};

export const LyricsSearchSheet: React.FC<LyricsSearchSheetProps> = ({
  visible,
  track,
  onClose,
  onApply,
}) => {
  const { colors } = useTheme();
  const { isRtl, language } = useAppLanguage();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LyricsSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Pre-fill with the playing track each time the sheet opens; cleared on close.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const artist = track?.artist?.trim() || "";
    const title = track?.title?.trim() || "";
    const initial = [artist, title].filter(Boolean).join(" ");
    setQuery(initial);
    setResults([]);
    setSearched(false);
  }, [visible, track?.artist, track?.title]);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setIsSearching(true);
    try {
      const found = await lyricsService.searchLyrics(trimmed, 10);
      setResults(found);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setIsSearching(false);
    }
  }, [query]);

  if (!visible) {
    return null;
  }

  const mutedTextColor = withOpacity(colors.foreground, 0.6);
  const accent = colors.accent;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SheetBackdrop activeOpacity={1} onPress={onClose} />
      <SheetBody style={{ backgroundColor: colors.background }}>
        <SheetHeader>
          <SheetTitle
            style={{
              color: colors.foreground,
              fontFamily: getAppFontFamily(isRtl, "bold"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {t("lyricsSearch.title") || "Search lyrics"}
          </SheetTitle>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={mutedTextColor} />
          </TouchableOpacity>
        </SheetHeader>

        <SearchRow style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("lyricsSearch.placeholder") || "Artist and song name"}
            placeholderTextColor={withOpacity(mutedTextColor, 0.7)}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void runSearch()}
            style={{
              borderColor: colors.borderSubtle,
              backgroundColor: withOpacity(colors.surface2, 0.8),
              color: colors.foreground,
              fontFamily: getAppFontFamily(isRtl, "regular"),
              ...getTextDirectionStyle(isRtl),
            }}
          />
          <TouchableOpacity
            activeOpacity={0.88}
            disabled={isSearching || !query.trim()}
            onPress={() => void runSearch()}
            style={{
              minHeight: 44,
              paddingHorizontal: 18,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.foreground,
              opacity: isSearching || !query.trim() ? 0.5 : 1,
            }}
          >
            {isSearching ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Text
                style={{
                  color: colors.background,
                  fontSize: 14,
                  fontFamily: getAppFontFamily(isRtl, "semibold"),
                }}
              >
                {t("lyricsSearch.search") || "Search"}
              </Text>
            )}
          </TouchableOpacity>
        </SearchRow>

        {searched && results.length === 0 && !isSearching && (
          <Text
            style={{
              color: mutedTextColor,
              fontSize: 13,
              paddingVertical: 16,
              fontFamily: getAppFontFamily(isRtl, "regular"),
              ...getTextDirectionStyle(isRtl, "center"),
            }}
          >
            {t("lyricsSearch.empty") || "No lyrics found for that search."}
          </Text>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingBottom: 4 }}
        >
          {results.map((result, index) => (
            <ResultRow
              key={`${result.id ?? index}-${result.trackName}`}
              borderColor={colors.borderSubtle}
              onPress={() => {
                onApply(result);
                onClose();
              }}
            >
              <Text
                numberOfLines={2}
                style={{
                  flex: 1,
                  color: colors.foreground,
                  fontSize: 14,
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                  ...getTextDirectionStyle(isRtl),
                }}
              >
                {`${result.trackName} — ${result.artistName}`}
              </Text>
              <Text
                style={{
                  marginLeft: 10,
                  marginRight: 10,
                  color: result.isSynced ? accent : mutedTextColor,
                  fontSize: 12,
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                }}
              >
                {result.isSynced
                  ? t("lyricsSearch.synced") || "Synced"
                  : t("lyricsSearch.plain") || "Plain"}
              </Text>
              {!!formatDuration(result.duration) && (
                <Text
                  style={{
                    color: mutedTextColor,
                    fontSize: 12,
                    fontFamily: getAppFontFamily(isRtl, "regular"),
                  }}
                >
                  {formatDuration(result.duration)}
                </Text>
              )}
            </ResultRow>
          ))}
        </ScrollView>

        {language === "fa" && null}
      </SheetBody>
    </Modal>
  );
};

export default LyricsSearchSheet;
