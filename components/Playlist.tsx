import React from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Entypo, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer } from "../contexts/PlayerContext";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { sanitizeImageUrl } from "./core/image";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { BodyText, MutedText, TitleText } from "./ui/Text";

interface PlaylistProps {
  title: string; // e.g., "Justice"
  headerTitle?: string;
  kindLabel?: string;
  artist?: string; // e.g., "Justin Bieber"
  albumArtUrl: string; // URL for the main album cover
  libraryCover?: "liked" | "previously-played"; // Use library covers instead of album art
  songs: any[];
  onBack?: () => void;
  onPlayAll?: () => void;
  onShuffle?: () => void;
  onSongOptionsPress?: (song: any) => void;
  onHeaderOptionsPress?: () => void;
  contentContainerStyle?: any;
  emptyMessage?: string;
  emptySubMessage?: string;
  emptyIcon?: string;
  showSongOptions?: boolean; // Whether to show the options button for songs
  showHeaderOptions?: boolean; // Whether to show the header options button
  type?: "album" | "playlist"; // Type of content being displayed
}

export const Playlist: React.FC<PlaylistProps> = ({
  title,
  headerTitle,
  kindLabel,
  artist,
  albumArtUrl,
  libraryCover,
  songs,
  onBack,
  onPlayAll,
  onShuffle,
  onSongOptionsPress,
  onHeaderOptionsPress,
  contentContainerStyle,
  emptyMessage = "No songs found",
  emptySubMessage = "This album is currently empty.",
  emptyIcon = "musical-notes-outline",
  showSongOptions,
  showHeaderOptions = true, // Default to true for backward compatibility
  type = "album", // Default to album for backward compatibility
}) => {
  const { playTrack } = usePlayer();
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const resolvedKindLabel =
    kindLabel || (type === "playlist" ? "Playlist" : "Album");
  const resolvedHeaderTitle = headerTitle || resolvedKindLabel;
  const headerArtworkOffset = insets.top + 56;
  const normalizedAlbumArtUrl = sanitizeImageUrl(albumArtUrl);

  const handlePlaySong = (song: any, index: number) => {
    playTrack(song, songs, index);
  };

  const renderSongItem = ({ item, index }: { item: any; index: number }) => (
    <TouchableOpacity
      onPress={() => handlePlaySong(item, index)}
      activeOpacity={0.88}
      style={[
        styles.songItem,
        {
          flexDirection: isRtl ? "row-reverse" : "row",
          borderBottomColor: colors.borderSubtle,
        },
      ]}
    >
      <BodyText
        style={[
          styles.songNumber,
          {
            color: colors.muted,
            marginRight: isRtl ? 0 : 12,
            marginLeft: isRtl ? 12 : 0,
          },
        ]}
      >
        {index + 1}
      </BodyText>
      {sanitizeImageUrl(item.thumbnail || "") ? (
        <SongThumbnail
          source={{ uri: sanitizeImageUrl(item.thumbnail || "") }}
          isRtl={isRtl}
        />
      ) : null}
      <View
        style={[
          styles.songInfo,
          { alignItems: isRtl ? "flex-end" : "flex-start" },
        ]}
      >
        <TitleText
          numberOfLines={1}
          style={[
            styles.songTitle,
            {
              fontFamily: getAppFontFamily(isRtl, "semibold"),
              ...getTextDirectionStyle(isRtl),
            },
          ]}
        >
          {item.title}
        </TitleText>
        {item.artist && (
          <MutedText
            numberOfLines={1}
            style={[
              styles.songArtist,
              {
                fontFamily: getAppFontFamily(isRtl, "regular"),
                ...getTextDirectionStyle(isRtl),
              },
            ]}
          >
            {item.artist}
          </MutedText>
        )}
      </View>
      <View
        style={[
          styles.songActions,
          { marginLeft: isRtl ? 0 : 8, marginRight: isRtl ? 8 : 0 },
        ]}
      >
        {showSongOptions !== false && onSongOptionsPress && (
          <TouchableOpacity
            onPress={() => onSongOptionsPress(item)}
            style={styles.actionButton}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name={emptyIcon as any} size={64} color={colors.surface3} />
      <TitleText style={styles.emptyTitle}>{emptyMessage}</TitleText>
      <MutedText style={styles.emptySubtitle}>{emptySubMessage}</MutedText>
    </View>
  );

  const ListHeader = () => (
    <>
      <View
        style={[styles.albumArtContainer, { marginTop: headerArtworkOffset }]}
      >
        {libraryCover ? (
          libraryCover === "liked" ? (
            <View
              style={[
                styles.libraryCoverWrapper,
                { shadowColor: colors.foreground },
              ]}
            >
              <LinearGradient
                style={styles.libraryCoverGradient}
                colors={[colors.accent, colors.heroMid, colors.heroEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Entypo name="heart" size={64} color="white" />
              </LinearGradient>
            </View>
          ) : (
            <View
              style={[
                styles.libraryCoverWrapper,
                { shadowColor: colors.foreground },
              ]}
            >
              <LinearGradient
                style={styles.libraryCoverGradient}
                colors={[colors.surface2, colors.surface1, colors.heroEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Entypo name="back-in-time" size={64} color="white" />
              </LinearGradient>
            </View>
          )
        ) : normalizedAlbumArtUrl ? (
          <Image
            source={{ uri: normalizedAlbumArtUrl }}
            style={[
              styles.albumCover,
              {
                backgroundColor: colors.surface2,
                borderColor: colors.borderSubtle,
                shadowColor: colors.foreground,
              },
            ]}
          />
        ) : (
          <View
            style={[
              styles.libraryCoverWrapper,
              {
                backgroundColor: colors.surface2,
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: colors.foreground,
              },
            ]}
          >
            <Ionicons
              name="musical-notes-outline"
              size={64}
              color={withOpacity(colors.foreground, 0.72)}
            />
          </View>
        )}
        <TouchableOpacity
          onPress={onPlayAll || (() => handlePlaySong(songs[0], 0))}
          disabled={songs.length === 0}
          activeOpacity={0.9}
          style={[
            styles.floatingPlayButton,
            {
              backgroundColor: colors.accent,
              shadowColor: "#000000",
              right: isRtl ? undefined : 36,
              left: isRtl ? 36 : undefined,
              opacity: songs.length === 0 ? 0.55 : 1,
            },
          ]}
        >
          <Ionicons name="play" size={24} color={colors.accentContrast} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.albumInfoContainer,
          {
            flexDirection: isRtl ? "row-reverse" : "row",
            backgroundColor: withOpacity(colors.surface1, 0.94),
            borderColor: colors.borderSubtle,
          },
        ]}
      >
        <View
          style={{
            flex: 1,
            paddingRight: isRtl ? 0 : 16,
            paddingLeft: isRtl ? 16 : 0,
          }}
        >
          <MutedText
            style={[
              styles.kindLabel,
              {
                color: withOpacity(colors.foreground, 0.72),
                fontFamily: getAppFontFamily(isRtl, "semibold"),
                ...getTextDirectionStyle(isRtl),
              },
            ]}
          >
            {resolvedKindLabel}
          </MutedText>
          <TitleText
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.albumTitle,
              {
                fontFamily: getAppFontFamily(isRtl, "bold"),
                ...getTextDirectionStyle(isRtl),
              },
            ]}
          >
            {title}
          </TitleText>
          {artist && (
            <MutedText
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.albumArtist,
                {
                  fontFamily: getAppFontFamily(isRtl, "regular"),
                  ...getTextDirectionStyle(isRtl),
                },
              ]}
            >
              {artist}
            </MutedText>
          )}
        </View>
        <TouchableOpacity
          onPress={onShuffle}
          activeOpacity={0.88}
          style={[
            styles.shuffleButton,
            {
              backgroundColor: colors.surface1,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Ionicons name="shuffle" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            top: insets.top + 8,
            flexDirection: isRtl ? "row-reverse" : "row",
          },
        ]}
      >
        <TouchableOpacity
          onPress={onBack}
          style={[
            styles.headerButton,
            {
              backgroundColor: withOpacity(colors.surface1, 0.92),
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Ionicons
            name={isRtl ? "chevron-forward" : "chevron-back"}
            size={24}
            color={colors.foreground}
          />
        </TouchableOpacity>
        <TitleText
          style={[
            styles.headerTitle,
            {
              fontFamily: getAppFontFamily(isRtl, "semibold"),
              ...getTextDirectionStyle(isRtl, "center"),
            },
          ]}
        >
          {resolvedHeaderTitle}
        </TitleText>
        {showHeaderOptions && onHeaderOptionsPress && (
          <TouchableOpacity
            onPress={onHeaderOptionsPress}
            style={[
              styles.headerButton,
              {
                backgroundColor: withOpacity(colors.surface1, 0.92),
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <Ionicons
              name="ellipsis-vertical"
              size={20}
              color={colors.foreground}
            />
          </TouchableOpacity>
        )}
        {!showHeaderOptions && <View style={styles.headerSpacer} />}
      </View>

      <FlatList
        data={songs}
        renderItem={renderSongItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={songs.length > 0 ? ListHeader : null}
        ListEmptyComponent={
          <>
            <ListHeader />
            {renderEmptyState()}
          </>
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.listContent,
          contentContainerStyle || null,
        ]}
      />
    </View>
  );
};

const SongThumbnail = ({
  source,
  isRtl,
}: {
  source: { uri: string };
  isRtl: boolean;
}) => {
  const { colors } = useTheme();

  return (
    <Image
      source={source}
      style={[
        styles.songThumbnail,
        {
          backgroundColor: colors.surface2,
          marginRight: isRtl ? 0 : 12,
          marginLeft: isRtl ? 12 : 0,
        },
      ]}
    />
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    lineHeight: 22,
    flex: 1,
    marginHorizontal: 12,
  },
  headerSpacer: {
    width: 42,
  },
  listContent: {
    paddingBottom: 128,
  },
  albumArtContainer: {
    paddingHorizontal: 20,
    marginTop: 0,
    marginBottom: 24,
  },
  albumCover: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 24,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 6,
  },
  libraryCoverWrapper: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 24,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 6,
  },
  libraryCoverGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingPlayButton: {
    position: "absolute",
    bottom: -24,
    width: 60,
    height: 60,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 8,
  },
  albumInfoContainer: {
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginHorizontal: 20,
    marginBottom: 22,
    borderRadius: 24,
    borderWidth: 1,
  },
  kindLabel: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  albumTitle: {
    marginTop: 8,
    fontSize: 26,
    lineHeight: 31,
  },
  albumArtist: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 20,
  },
  shuffleButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  songItem: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  songNumber: {
    width: 24,
    fontSize: 14,
    lineHeight: 18,
  },
  songThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 10,
  },
  songInfo: {
    flex: 1,
  },
  songTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  songArtist: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  songActions: {
    alignItems: "center",
    justifyContent: "center",
  },
  actionButton: {
    padding: 8,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 40,
  },
  emptyTitle: {
    marginTop: 16,
    fontSize: 16,
    lineHeight: 20,
    textAlign: "center",
  },
  emptySubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 18,
    textAlign: "center",
  },
});

export default Playlist;
