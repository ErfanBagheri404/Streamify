import React from "react";
import {
  Animated,
  FlatList,
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
import { ImageWithSkeleton } from "./ui/ImageWithSkeleton";
import { SkeletonLoader } from "./SkeletonLoader";

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
  onAddSongPress?: () => void;
  canReorder?: boolean; // Enable drag-to-reorder (user playlists)
  isReorderMode?: boolean; // Controlled reorder mode state
  onToggleReorder?: () => void; // Toggle reorder mode (from the options menu)
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onSongPress?: (song: any, index: number) => void;
  contentContainerStyle?: any;
  emptyMessage?: string;
  emptySubMessage?: string;
  emptyIcon?: string;
  showSongOptions?: boolean; // Whether to show the options button for songs
  showHeaderOptions?: boolean; // Whether to show the header options button
  type?: "album" | "playlist"; // Type of content being displayed
  isLoading?: boolean;
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
  onAddSongPress,
  canReorder = false,
  isReorderMode = false,
  onToggleReorder,
  onReorder,
  onSongPress,
  contentContainerStyle,
  emptyMessage = "No songs found",
  emptySubMessage = "This album is currently empty.",
  emptyIcon = "musical-notes-outline",
  showSongOptions,
  showHeaderOptions = true, // Default to true for backward compatibility
  type = "album", // Default to album for backward compatibility
  isLoading = false,
}) => {
  const [localSongs, setLocalSongs] = React.useState<any[] | null>(null);
  const { playTrack } = usePlayer();
  const { colors } = useTheme();
  const { isRtl, t } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const resolvedKindLabel =
    kindLabel ||
    (type === "playlist" ? t("screens.library.playlist") : t("library.album"));
  const resolvedHeaderTitle = headerTitle || resolvedKindLabel;
  const headerArtworkOffset = insets.top + 100;
  const normalizedAlbumArtUrl = sanitizeImageUrl(albumArtUrl);

  const entranceOpacity = React.useRef(new Animated.Value(0)).current;
  const entranceTranslateY = React.useRef(new Animated.Value(10)).current;

  React.useEffect(() => {
    entranceOpacity.setValue(0);
    entranceTranslateY.setValue(10);
    Animated.parallel([
      Animated.timing(entranceOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(entranceTranslateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [entranceOpacity, entranceTranslateY]);

  const activeSongs = localSongs ?? songs;

  React.useEffect(() => {
    setLocalSongs(null);
  }, [songs]);

  const handlePlaySong = (song: any, index: number) => {
    playTrack(song, activeSongs, index);
  };

  const moveSong = React.useCallback(
    (fromIndex: number, toIndex: number) => {
      if (
        fromIndex === toIndex ||
        toIndex < 0 ||
        toIndex >= activeSongs.length
      ) {
        return;
      }

      const next = [...activeSongs];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setLocalSongs(next);

      if (onReorder) {
        onReorder(fromIndex, toIndex);
      }
    },
    [activeSongs, onReorder],
  );

  const renderSongItem = ({ item, index }: { item: any; index: number }) => {
    const showReorderControls = canReorder && isReorderMode === true;

    const numberOrHandle = showReorderControls ? (
      <View
        style={[
          styles.reorderControls,
          {
            flexDirection: isRtl ? "row-reverse" : "row",
            marginRight: isRtl ? 0 : 6,
            marginLeft: isRtl ? 6 : 0,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => moveSong(index, index - 1)}
          disabled={index === 0}
          hitSlop={8}
          style={[
            styles.reorderButton,
            index === 0 && styles.reorderButtonDisabled,
          ]}
        >
          <Ionicons
            name="arrow-up"
            size={18}
            color={index === 0 ? colors.surface3 : colors.foreground}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => moveSong(index, index + 1)}
          disabled={index === activeSongs.length - 1}
          hitSlop={8}
          style={[
            styles.reorderButton,
            index === activeSongs.length - 1 && styles.reorderButtonDisabled,
          ]}
        >
          <Ionicons
            name="arrow-down"
            size={18}
            color={
              index === activeSongs.length - 1
                ? colors.surface3
                : colors.foreground
            }
          />
        </TouchableOpacity>
      </View>
    ) : (
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
    );

    return (
      <TouchableOpacity
        onPress={() => handlePlaySong(item, index)}
        activeOpacity={0.88}
        style={[
          styles.songItem,
          {
            flexDirection: isRtl ? "row-reverse" : "row",
          },
        ]}
      >
        {numberOrHandle}
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
              <Ionicons
                name="ellipsis-vertical"
                size={20}
                color={colors.muted}
              />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name={emptyIcon as any} size={64} color={colors.surface3} />
      <TitleText style={styles.emptyTitle}>{emptyMessage}</TitleText>
      <MutedText style={styles.emptySubtitle}>{emptySubMessage}</MutedText>
    </View>
  );

  const renderLoadingSongItem = ({ index }: { index: number }) => (
    <View
      style={[
        styles.songItem,
        {
          flexDirection: isRtl ? "row-reverse" : "row",
        },
      ]}
      // #region debug-point A:loading-row-layout
      onLayout={(event) => {
        const { x, y, width, height } = event.nativeEvent.layout;
        fetch("http://192.168.1.101:7777/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "playlist-cover-skeleton",
            runId: "pre-fix",
            hypothesisId: "A",
            location: "components/Playlist.tsx:renderLoadingSongItem:row",
            msg: "[DEBUG] Playlist loading row layout measured",
            data: { index, x, y, width, height, isRtl },
            ts: Date.now(),
          }),
        }).catch(() => {});
      }}
      // #endregion
    >
      <SkeletonLoader
        width={24}
        height={18}
        style={{
          borderRadius: 6,
          marginRight: isRtl ? 0 : 12,
          marginLeft: isRtl ? 12 : 0,
        }}
      />
      <SkeletonLoader
        style={[
          styles.songThumbnail,
          {
            marginRight: isRtl ? 0 : 12,
            marginLeft: isRtl ? 12 : 0,
            backgroundColor: withOpacity(colors.foreground, 0.14),
          },
        ]}
      />
      <View
        style={[
          styles.songInfo,
          { alignItems: isRtl ? "flex-end" : "flex-start" },
        ]}
      >
        <SkeletonLoader
          height={20}
          style={{
            width: "72%",
            borderRadius: 8,
            marginBottom: 8,
            alignSelf: isRtl ? "flex-end" : "flex-start",
          }}
        />
        <SkeletonLoader
          height={16}
          style={{
            width: "46%",
            borderRadius: 7,
            alignSelf: isRtl ? "flex-end" : "flex-start",
          }}
        />
      </View>
      <View
        style={[
          styles.songActions,
          { marginLeft: isRtl ? 0 : 8, marginRight: isRtl ? 8 : 0 },
        ]}
      >
        <SkeletonLoader width={28} height={28} style={{ borderRadius: 14 }} />
      </View>
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
                <Entypo name="heart" size={64} color="#ffffff" />
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
                colors={["#2b2b31", "#52525b", "#7c3aed"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Entypo name="back-in-time" size={64} color="white" />
              </LinearGradient>
            </View>
          )
        ) : normalizedAlbumArtUrl ? (
          <ImageWithSkeleton
            source={{ uri: normalizedAlbumArtUrl }}
            containerStyle={[
              styles.albumCover,
              {
                backgroundColor: colors.surface2,
                borderColor: colors.borderSubtle,
                shadowColor: colors.foreground,
              },
            ]}
          />
        ) : isLoading ? (
          <View style={styles.albumCover}>
            <SkeletonLoader
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                borderRadius: 24,
              }}
            />
          </View>
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
          {isLoading ? (
            <>
              <SkeletonLoader
                width={74}
                height={12}
                style={{
                  borderRadius: 6,
                  marginBottom: 10,
                  alignSelf: isRtl ? "flex-end" : "flex-start",
                }}
              />
              <SkeletonLoader
                height={30}
                style={{
                  width: "76%",
                  borderRadius: 10,
                  marginBottom: 10,
                  alignSelf: isRtl ? "flex-end" : "flex-start",
                }}
              />
              <SkeletonLoader
                height={18}
                style={{
                  width: "52%",
                  borderRadius: 8,
                  alignSelf: isRtl ? "flex-end" : "flex-start",
                }}
              />
            </>
          ) : (
            <>
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
              {artist ? (
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
              ) : null}
            </>
          )}
        </View>
        {onShuffle ? (
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
        ) : (
          <View style={styles.shuffleSpacer} />
        )}
      </View>
    </>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Animated.View
        style={[
          styles.screen,
          {
            opacity: entranceOpacity,
            transform: [{ translateY: entranceTranslateY }],
          },
        ]}
      >
        <View
          style={[
            styles.header,
            {
              top: insets.top + 8,
              flexDirection: "row",
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
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
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
          data={
            isLoading
              ? Array.from({ length: 6 }, (_, index) => ({
                  id: `playlist-skeleton-${index}`,
                }))
              : activeSongs
          }
          renderItem={isLoading ? renderLoadingSongItem : renderSongItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={isLoading ? null : renderEmptyState()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.listContent,
            contentContainerStyle || null,
          ]}
        />
      </Animated.View>
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
    <ImageWithSkeleton
      source={source}
      containerStyle={[
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
    marginBottom: 30,
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
    marginBottom: 38,
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
  shuffleSpacer: {
    width: 44,
    height: 44,
  },
  songItem: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 0,
  },
  reorderControls: {
    alignItems: "center",
  },
  reorderButton: {
    width: 28,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderButtonDisabled: {
    opacity: 0.35,
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
