import React, { useEffect, useRef, useState } from "react";
const { Animated, PanResponder, Dimensions } = require("react-native");
import { Modal, View, TextInput, Text, TouchableOpacity } from "react-native";
import { usePlayer } from "../../contexts/PlayerContext";
import Playlist from "../Playlist";
import { StorageService } from "../../utils/storage";
import { searchAPI } from "../../modules/searchAPI";
import { SliderSheet } from "../SliderSheet";
import { Track } from "../../contexts/PlayerContext";
import { getBeatseekApiBase } from "../core/api";
import { pickBestImageUrl, sanitizeImageUrl } from "../core/image";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { getAppFontFamily } from "../../utils/fonts";

interface AlbumPlaylistScreenProps {
  navigation: any;
  route: any;
}

const { height } = Dimensions.get("window");
const SHEET_HEIGHT = height * 0.5;
const SHEET_CLOSED_TOP = height;
const SHEET_HALF_TOP = height - SHEET_HEIGHT;

export const AlbumPlaylistScreen: React.FC<AlbumPlaylistScreenProps> = ({
  navigation,
  route,
}) => {
  console.log("[AlbumPlaylistScreen] Component rendered");
  const { playTrack } = usePlayer();
  const { t, isRtl } = useAppLanguage();
  const { colors } = useTheme();
  const [albumSongs, setAlbumSongs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [albumTitle, setAlbumTitle] = useState("");
  const [albumArtist, setAlbumArtist] = useState("");
  const [albumArtUrl, setAlbumArtUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Debug logging for state changes
  useEffect(() => {
    console.log("[AlbumPlaylistScreen] State updated:", {
      albumSongsLength: albumSongs.length,
      albumTitle,
      albumArtist,
      albumArtUrl,
      errorMessage,
      isLoading,
    });
  }, [
    albumSongs,
    albumTitle,
    albumArtist,
    albumArtUrl,
    errorMessage,
    isLoading,
  ]);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // Song action sheet state
  const [showSongActionSheet, setShowSongActionSheet] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [sheetMode, setSheetMode] = useState<"playlist" | "playlist-song">(
    "playlist-song"
  );
  const sheetTop = useRef(new Animated.Value(SHEET_CLOSED_TOP)).current;
  const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHT);
  const sheetStateRef = useRef<"closed" | "half" | "full">("closed");

  const animateSheet = (state: "closed" | "half" | "full") => {
    let toValue = SHEET_CLOSED_TOP;
    if (state === "closed") {
      setSheetHeight(SHEET_HEIGHT);
      toValue = SHEET_CLOSED_TOP;
    } else if (state === "half") {
      setSheetHeight(SHEET_HEIGHT);
      toValue = SHEET_HALF_TOP;
    } else if (state === "full") {
      setSheetHeight(height);
      toValue = 0;
    }

    Animated.timing(sheetTop, {
      toValue,
      duration: 250,
      useNativeDriver: false,
    }).start(() => {
      sheetStateRef.current = state;
      if (state === "closed") {
        setShowSongActionSheet(false);
        setSelectedTrack(null);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_: any, gestureState: any) =>
        Math.abs(gestureState.dy) > 2,
      onPanResponderMove: (_: any, gestureState: any) => {
        const base =
          sheetStateRef.current === "full"
            ? 0
            : sheetStateRef.current === "half"
              ? SHEET_HALF_TOP
              : SHEET_CLOSED_TOP;
        let next = base + gestureState.dy;
        if (next < 0) {
          next = 0;
        }
        if (next > SHEET_CLOSED_TOP) {
          next = SHEET_CLOSED_TOP;
        }
        sheetTop.setValue(next);
      },
      onPanResponderRelease: (_: any, gestureState: any) => {
        const { dy, vy } = gestureState;
        let target: "closed" | "half" | "full" = sheetStateRef.current;

        if (sheetStateRef.current === "half") {
          if (dy > 60 || vy > 0.5) {
            target = "closed";
          } else if (dy < -60 || vy < -0.5) {
            target = "full";
          } else {
            target = "half";
          }
        } else if (sheetStateRef.current === "full") {
          if (dy > 60 || vy > 0.5) {
            target = "half";
          } else {
            target = "full";
          }
        }

        animateSheet(target);
      },
    })
  ).current;

  const closeSongActionSheet = () => {
    animateSheet("closed");
  };

  const openSongActionSheet = (song: any) => {
    setSheetMode("playlist-song");
    setSelectedTrack(song);
    setShowSongActionSheet(true);
    animateSheet("half");
  };

  const handleHeaderOptionsPress = () => {
    setSheetMode("playlist");
    setShowSongActionSheet(true);
    animateSheet("half");
  };

  const handleSheetOptionPress = async (option: string) => {
    if (!albumId || source !== "user-playlist") {
      closeSongActionSheet();
      return;
    }

    if (sheetMode === "playlist") {
      if (option === "Remove playlist") {
        await StorageService.deletePlaylist(albumId);
        closeSongActionSheet();
        navigation.goBack();
        return;
      }

      if (option === "Rename playlist") {
        setRenameValue(albumTitle);
        closeSongActionSheet();
        setShowRenameModal(true);
        return;
      }
    }

    if (sheetMode === "playlist-song" && option === "Download") {
      console.log("Download song:", selectedTrack?.title);
      // Add download logic here
      closeSongActionSheet();
      return;
    }

    if (
      sheetMode === "playlist-song" &&
      option === "Remove song from playlist"
    ) {
      const playlists = await StorageService.loadPlaylists();
      const playlist = playlists.find((p) => p.id === albumId);
      if (!playlist || !selectedTrack) {
        closeSongActionSheet();
        return;
      }

      const updatedTracks = playlist.tracks.filter(
        (track) => track.id !== selectedTrack.id
      );
      const updatedPlaylist = {
        ...playlist,
        tracks: updatedTracks,
        updatedAt: new Date().toISOString(),
      };
      await StorageService.updatePlaylist(updatedPlaylist);
      setAlbumSongs(updatedTracks);

      if (updatedTracks.length > 0 && updatedTracks[0].thumbnail) {
        setAlbumArtUrl(updatedTracks[0].thumbnail);
      } else if (updatedTracks.length === 0) {
        setAlbumArtUrl("");
      }

      closeSongActionSheet();
      return;
    }

    closeSongActionSheet();
  };

  const handleConfirmRename = async () => {
    if (!albumId || source !== "user-playlist") {
      setShowRenameModal(false);
      return;
    }

    const trimmed = renameValue.trim();
    if (!trimmed) {
      setShowRenameModal(false);
      return;
    }

    const playlists = await StorageService.loadPlaylists();
    const playlist = playlists.find((p) => p.id === albumId);
    if (!playlist) {
      setShowRenameModal(false);
      return;
    }

    const updatedPlaylist = {
      ...playlist,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    };
    await StorageService.updatePlaylist(updatedPlaylist);
    setAlbumTitle(trimmed);
    setShowRenameModal(false);
  };

  const {
    albumId,
    albumName,
    albumArtist: routeArtist,
    source,
  } = route.params || {};
  const translateWithFallback = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const isPlaylistCollection =
    source === "user-playlist" ||
    source === "youtube" ||
    source === "youtubemusic" ||
    source === "soundcloud";
  const collectionFallbackTitle = isPlaylistCollection
    ? translateWithFallback(
        "collection.collection",
        isRtl ? "مجموعه" : "Collection"
      )
    : translateWithFallback(
        "screens.settings.main.library.album",
        isRtl ? "آلبوم" : "Album"
      );
  const collectionKindLabel = isPlaylistCollection
    ? translateWithFallback(
        "screens.library.playlist",
        isRtl ? "لیست پخش" : "Playlist"
      )
    : translateWithFallback(
        "screens.settings.main.library.album",
        isRtl ? "آلبوم" : "Album"
      );
  const collectionType = isPlaylistCollection ? "playlist" : "album";

  console.log("[AlbumPlaylistScreen] Received params:", {
    albumId,
    albumName,
    routeArtist,
    source,
  });

  useEffect(() => {
    loadAlbumSongs();

    // Refresh playlist when screen comes into focus (for user playlists)
    const unsubscribe = navigation.addListener("focus", () => {
      if (source === "user-playlist") {
        console.log(
          "[AlbumPlaylistScreen] Screen focused, refreshing playlist"
        );
        loadAlbumSongs();
      }
    });

    return unsubscribe;
  }, [albumId, albumName, source, navigation]);

  const loadAlbumSongs = async () => {
    console.log("[AlbumPlaylistScreen] === STARTING loadAlbumSongs ===");
    console.log("[AlbumPlaylistScreen] Loading album songs for:", {
      albumId,
      albumName,
      source,
    });

    if (!albumId || !albumName) {
      console.log("[AlbumPlaylistScreen] Missing required params, aborting");
      setErrorMessage("Missing album information");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      if (source === "jiosaavn") {
        const albumDetails = await searchAPI.getJioSaavnAlbumDetails(
          String(albumId),
          albumName
        );

        if (
          albumDetails &&
          albumDetails.songs &&
          albumDetails.songs.length > 0
        ) {
          console.log(
            `[AlbumPlaylistScreen] Found ${albumDetails.songs.length} songs in album`
          );
          const songs = albumDetails.songs.map((song: any) => ({
            id: String(song.id),
            title: song.name || song.title || song.song || "Unknown Title",
            artist:
              song.artists?.primary
                ?.map((artist: any) => artist.name)
                .join(", ") ||
              song.singers ||
              routeArtist ||
              "Unknown Artist",
            duration: song.duration || 0,
            thumbnail:
              song.image?.find((img: any) => img.quality === "500x500")?.url ||
              song.image?.[0]?.url ||
              "",
            source: "jiosaavn",
            _isJioSaavn: true,
            albumId: albumId,
            albumName: albumName,
          }));

          setAlbumSongs(songs);
          setAlbumTitle(albumName);
          setAlbumArtist(routeArtist || "Various Artists");

          // Extract album art from the first song or album details
          const albumArt =
            albumDetails.image?.find((img: any) => img.quality === "500x500")
              ?.url ||
            albumDetails.image?.[0]?.url ||
            songs[0]?.thumbnail ||
            "";
          setAlbumArtUrl(albumArt);
        } else {
          setAlbumSongs([]);
          setAlbumTitle(albumName);
          setAlbumArtist(routeArtist || "Unknown Artist");
          setAlbumArtUrl("");
          setErrorMessage("Failed to load JioSaavn album");
        }
      } else if (source === "user-playlist") {
        // Handle user playlists
        console.log("[AlbumPlaylistScreen] Loading user playlist");
        try {
          const allPlaylists = await StorageService.loadPlaylists();
          const playlist = allPlaylists.find((p) => p.id === albumId);

          if (playlist) {
            console.log(
              `[AlbumPlaylistScreen] Found playlist with ${playlist.tracks.length} songs`
            );
            setAlbumSongs(playlist.tracks);
            setAlbumTitle(playlist.name);
            setAlbumArtist(
              `${playlist.tracks.length} ${
                playlist.tracks.length === 1 ? "song" : "songs"
              }`
            );
            // Use first song's thumbnail as album art if available
            if (playlist.tracks.length > 0 && playlist.tracks[0].thumbnail) {
              setAlbumArtUrl(playlist.tracks[0].thumbnail);
            }
          } else {
            console.warn("[AlbumPlaylistScreen] Playlist not found");
            setAlbumSongs([]);
            setAlbumTitle(albumName);
            setAlbumArtist(routeArtist || "Unknown Artist");
            setErrorMessage("Playlist not found");
          }
        } catch (error) {
          console.error("[AlbumPlaylistScreen] Error loading playlist:", error);
          setAlbumSongs([]);
          setAlbumTitle(albumName);
          setAlbumArtist(routeArtist || "Unknown Artist");
          setErrorMessage("Failed to load playlist");
        }
      } else if (source === "soundcloud") {
        try {
          const beatseekApiBase = getBeatseekApiBase();
          if (!beatseekApiBase) {
            throw new Error("Beatseek API base is not configured");
          }
          const playlistUrlParam =
            typeof albumId === "string" ? albumId : String(albumId);
          const endpoint = `${beatseekApiBase}/playlist?url=${encodeURIComponent(
            playlistUrlParam
          )}`;
          const res = await fetch(endpoint, {
            headers: {
              Accept: "application/json",
            },
          });
          if (!res.ok) {
            setAlbumSongs([]);
            setAlbumTitle(albumName);
            setAlbumArtist(routeArtist || "Unknown Artist");
            setErrorMessage("Failed to load SoundCloud playlist");
          } else {
            const data = await res.json();
            const tracks: any[] = Array.isArray(data?.tracks)
              ? data.tracks
              : [];
            const songs = tracks.map((t: any) => {
              const artwork = t.artwork_url
                ? t.artwork_url.replace("large.jpg", "t500x500.jpg")
                : t.user?.avatar_url || "";
              return {
                id: String(t.id || t.track_id || t.permalink || t.url || ""),
                title: t.title || "Unknown Title",
                artist:
                  t.user?.username ||
                  t.artist ||
                  routeArtist ||
                  "Unknown Artist",
                duration: t.duration ? Math.floor(t.duration / 1000) : 0,
                thumbnail: artwork,
                source: "soundcloud",
                _isSoundCloud: true,
                albumId: playlistUrlParam,
                albumName: albumName,
              };
            });
            setAlbumSongs(songs);
            setAlbumTitle(data?.title || albumName);
            setAlbumArtist(
              routeArtist ||
                data?.artist ||
                data?.user?.username ||
                "Unknown Artist"
            );
            const cover =
              data?.artwork ||
              data?.image ||
              data?.thumbnail ||
              songs[0]?.thumbnail ||
              "";
            setAlbumArtUrl(cover || "");
            setErrorMessage("");
          }
        } catch (err) {
          setAlbumSongs([]);
          setAlbumTitle(albumName);
          setAlbumArtist(routeArtist || "Unknown Artist");
          setErrorMessage("Failed to load SoundCloud playlist");
        }
      } else if (source === "youtube" || source === "youtubemusic") {
        // Handle YouTube/YouTube Music playlists
        console.log(
          "[AlbumPlaylistScreen] Fetching YouTube/YouTube Music playlist details"
        );
        console.log(
          `[AlbumPlaylistScreen] Playlist ID: ${albumId}, Source: ${source}`
        );

        try {
          const { searchAPI } = await import("../../modules/searchAPI");
          console.log(
            `[AlbumPlaylistScreen] Calling getYouTubePlaylistDetails for ID: ${albumId}`
          );
          const playlistDetails =
            await searchAPI.getYouTubePlaylistDetails(albumId);
          console.log(
            "[AlbumPlaylistScreen] Playlist details response:",
            playlistDetails
          );

          if (
            playlistDetails &&
            playlistDetails.videos &&
            playlistDetails.videos.length > 0
          ) {
            console.log(
              `[AlbumPlaylistScreen] SUCCESS: Found ${playlistDetails.videos.length} videos in YouTube playlist`
            );
            console.log(
              "[AlbumPlaylistScreen] First video:",
              playlistDetails.videos[0]
            );
            const songs = playlistDetails.videos.map((video: any) => ({
              id: String(video.id),
              title:
                (typeof video.title === "string" && video.title.trim()) ||
                "Unknown Title",
              artist: video.artist || routeArtist || "Unknown Artist",
              duration: video.duration || 0,
              thumbnail:
                pickBestImageUrl(video) ||
                sanitizeImageUrl(video.thumbnail || video.thumbnailUrl || ""),
              source: source,
              _isYouTube: true,
              albumId: albumId,
              albumName: albumName,
            }));

            console.log(
              `[AlbumPlaylistScreen] SUCCESS: Mapped ${songs.length} songs, first song:`,
              songs[0]
            );
            setAlbumSongs(songs);
            setAlbumTitle(playlistDetails.name || albumName);
            setAlbumArtist(routeArtist || "Various Artists");
            setAlbumArtUrl(
              pickBestImageUrl(playlistDetails) ||
                sanitizeImageUrl(playlistDetails.thumbnail || "")
            );
            setErrorMessage(""); // Clear any previous error message
            console.log("[AlbumPlaylistScreen] State updated successfully");
          } else {
            console.error(
              "[AlbumPlaylistScreen] FAIL: No videos found in YouTube playlist"
            );
            console.error(
              "[AlbumPlaylistScreen] playlistDetails:",
              playlistDetails
            );

            // Enhanced error message based on the response
            let errorMsg = "No videos found in this playlist";
            if (!playlistDetails) {
              errorMsg =
                "Unable to fetch playlist. The service may be temporarily unavailable.";
            } else if (!playlistDetails.videos) {
              errorMsg = "This playlist appears to be empty or unavailable.";
            }

            setAlbumSongs([]);
            setAlbumTitle(albumName);
            setAlbumArtist(routeArtist || "Unknown Artist");
            setErrorMessage(errorMsg);
            console.log(
              "[AlbumPlaylistScreen] State set to empty with error message"
            );
          }
        } catch (error) {
          console.error(
            "[AlbumPlaylistScreen] ERROR: Exception while loading YouTube playlist:",
            error
          );
          setAlbumSongs([]);
          setAlbumTitle(albumName);
          setAlbumArtist(routeArtist || "Unknown Artist");

          setErrorMessage(
            "Failed to load YouTube playlist. Please check your internet connection or try again later."
          );
          console.log("[AlbumPlaylistScreen] State set to empty due to error");
        }
      } else {
        // For other sources, we might need different API calls
        // For now, show empty state for non-JioSaavn albums
        setAlbumSongs([]);
        setAlbumTitle(albumName);
        setAlbumArtist(routeArtist || "Unknown Artist");
      }
    } catch (error) {
      console.error("[AlbumPlaylistScreen] Error loading album songs:", error);
      setAlbumSongs([]);
      setAlbumTitle(albumName);
      setAlbumArtist(routeArtist || "Unknown Artist");
      setAlbumArtUrl(""); // Clear album art on error
      setErrorMessage(
        error instanceof Error
          ? `Failed to load album: ${error.message}`
          : "Failed to load album tracks. This album may not be available or the service is temporarily unavailable."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handlePlayAll = () => {
    if (albumSongs.length > 0) {
      playTrack(albumSongs[0], albumSongs, 0);
      navigation.goBack();
    }
  };

  if (isLoading) {
    return (
      <>
        <Playlist
          title={albumTitle || collectionFallbackTitle}
          headerTitle={collectionFallbackTitle}
          kindLabel={collectionKindLabel}
          albumArtUrl={albumArtUrl}
          songs={[]}
          onBack={handleGoBack}
          onHeaderOptionsPress={handleHeaderOptionsPress}
          emptyMessage={translateWithFallback(
            "screens.album_playlist.loading_album",
            isRtl ? "در حال بارگذاری آلبوم..." : "Loading album..."
          )}
          emptySubMessage=""
          type={collectionType}
        />
      </>
    );
  }

  if (errorMessage) {
    return (
      <>
        <Playlist
          title={albumTitle || collectionFallbackTitle}
          headerTitle={collectionFallbackTitle}
          kindLabel={collectionKindLabel}
          artist={albumArtist}
          albumArtUrl={albumArtUrl}
          songs={[]}
          onBack={handleGoBack}
          onHeaderOptionsPress={handleHeaderOptionsPress}
          emptyMessage={errorMessage}
          emptySubMessage={translateWithFallback(
            "screens.album_playlist.try_refreshing",
            isRtl
              ? "تلاش برای بارگذاری مجدد یا بررسی اتصال اینترنت خود"
              : "Try refreshing or check your internet connection"
          )}
          emptyIcon="error-outline"
          type={collectionType}
        />
      </>
    );
  }

  return (
    <>
      <Playlist
        title={albumTitle || collectionFallbackTitle}
        headerTitle={collectionFallbackTitle}
        kindLabel={collectionKindLabel}
        artist={albumArtist}
        albumArtUrl={albumArtUrl}
        songs={albumSongs}
        onBack={handleGoBack}
        onPlayAll={handlePlayAll}
        onSongOptionsPress={openSongActionSheet}
        onHeaderOptionsPress={handleHeaderOptionsPress}
        emptyMessage={translateWithFallback(
          "screens.album_playlist.no_songs_found",
          isRtl ? "هیچ آهنگی یافت نشد" : "No songs found"
        )}
        emptySubMessage={translateWithFallback(
          "screens.album_playlist.album_empty",
          isRtl ? "این آلبوم خالی است" : "This album is empty"
        )}
        emptyIcon="albums"
        type={collectionType}
      />

      <SliderSheet
        visible={showSongActionSheet}
        onClose={closeSongActionSheet}
        sheetTop={sheetTop}
        sheetHeight={sheetHeight}
        panHandlers={panResponder.panHandlers}
        currentTrack={
          sheetMode === "playlist"
            ? {
                title: albumTitle || "Playlist",
                artist: `${albumSongs.length} ${
                  albumSongs.length === 1 ? "song" : "songs"
                }`,
                thumbnail: albumArtUrl || "",
              }
            : selectedTrack || { title: "", artist: "", thumbnail: "" }
        }
        options={
          sheetMode === "playlist"
            ? [
                {
                  key: "Rename playlist",
                  label: "Rename playlist",
                  icon: "create-outline",
                },
                {
                  key: "Remove playlist",
                  label: "Remove playlist",
                  icon: "trash-outline",
                },
              ]
            : [
                {
                  key: "Download",
                  label: "Download",
                  icon: "cloud-download-outline",
                },
                {
                  key: "Share",
                  label: "Share",
                  icon: "share-outline",
                },
                {
                  key: "Add to other playlist",
                  label: "Add to other playlist",
                  icon: "add-circle-outline",
                },
                {
                  key: "Go to album",
                  label: "Go to album",
                  icon: "albums-outline",
                },
                {
                  key: "Go to artists",
                  label: "Go to artists",
                  icon: "people-outline",
                },
                {
                  key: "Sleep timer",
                  label: "Sleep timer",
                  icon: "time-outline",
                },
                {
                  key: "Go to song radio",
                  label: "Go to song radio",
                  icon: "radio-outline",
                },
                {
                  key: "Remove song from playlist",
                  label: "Remove from playlist",
                  icon: "trash-outline",
                },
              ]
        }
        onOptionPress={handleSheetOptionPress}
      />

      <Modal
        visible={showRenameModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowRenameModal(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: withOpacity("#000000", 0.6),
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: "85%",
              backgroundColor: colors.surface1,
              borderRadius: 16,
              padding: 20,
              borderWidth: 1,
              borderColor: colors.borderSubtle,
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontSize: 18,
                fontFamily: getAppFontFamily(isRtl, "semibold"),
                marginBottom: 12,
                textAlign: isRtl ? "right" : "left",
              }}
            >
              Rename playlist
            </Text>
            <TextInput
              style={{
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: colors.foreground,
                backgroundColor: colors.surface2,
                fontFamily: getAppFontFamily(isRtl, "regular"),
                marginBottom: 16,
                textAlign: isRtl ? "right" : "left",
              }}
              placeholder={t("actions.playlist_name")}
              placeholderTextColor={colors.muted}
              value={renameValue}
              onChangeText={setRenameValue}
            />
            <View
              style={{
                flexDirection: isRtl ? "row-reverse" : "row",
                justifyContent: "flex-end",
              }}
            >
              <TouchableOpacity
                onPress={() => setShowRenameModal(false)}
                style={{ paddingVertical: 8, paddingHorizontal: 12 }}
              >
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: 14,
                    fontFamily: getAppFontFamily(isRtl, "semibold"),
                  }}
                >
                  {t("actions.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmRename}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  backgroundColor: colors.accent,
                  borderRadius: 999,
                  marginLeft: isRtl ? 0 : 8,
                  marginRight: isRtl ? 8 : 0,
                }}
              >
                <Text
                  style={{
                    color: colors.accentContrast,
                    fontSize: 14,
                    fontFamily: getAppFontFamily(isRtl, "semibold"),
                  }}
                >
                  {t("actions.save")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

export default AlbumPlaylistScreen;
