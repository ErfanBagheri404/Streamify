import React, { useEffect, useRef, useState } from "react";
const { Animated, PanResponder, Dimensions } = require("react-native");
import {
  Modal,
  View,
  TextInput,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
} from "react-native";
import { SafeArea } from "../SafeArea";
import { usePlayer } from "../../contexts/PlayerContext";
import Playlist from "../Playlist";
import { StorageService } from "../../utils/storage";
import { Playlist as PlaylistInterface } from "../../utils/storage";
import { SliderSheet } from "../SliderSheet";
import { Track } from "../../contexts/PlayerContext";
import { t } from "../../utils/localization";

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
  const [albumSongs, setAlbumSongs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [albumTitle, setAlbumTitle] = useState("");
  const [albumArtist, setAlbumArtist] = useState("");
  const [albumArtUrl, setAlbumArtUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isInLibrary, setIsInLibrary] = useState(false);
  const [isUserCreated, setIsUserCreated] = useState(false);

  // Playlist selection state for "Add to other playlist"
  const [showPlaylistSelection, setShowPlaylistSelection] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<PlaylistInterface[]>([]);

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

  const checkIfInLibrary = async () => {
    if (source === "user-playlist") {
      setIsUserCreated(true);
      setIsInLibrary(true);
      return;
    }

    try {
      const playlists = await StorageService.loadPlaylists();
      const exists = playlists.some((p) => p.id === albumId);
      setIsInLibrary(exists);
      setIsUserCreated(false);
    } catch (error) {
      console.error("Error checking library status:", error);
      setIsInLibrary(false);
      setIsUserCreated(false);
    }
  };

  const loadUserPlaylists = async () => {
    try {
      console.log("[AlbumPlaylistScreen] Loading user playlists...");
      const allPlaylists = await StorageService.loadPlaylists();
      console.log(
        "[AlbumPlaylistScreen] Loaded playlists:",
        allPlaylists.length,
        "playlists"
      );
      console.log(
        "[AlbumPlaylistScreen] Playlist details:",
        allPlaylists.map((p) => ({
          id: p.id,
          name: p.name,
          thumbnail: p.thumbnail,
          tracks: p.tracks.length,
        }))
      );
      setUserPlaylists(allPlaylists);
    } catch (error) {
      console.error("[AlbumPlaylistScreen] Error loading playlists:", error);
      setUserPlaylists([]);
    }
  };

  const handlePlaylistSelect = async (playlist: PlaylistInterface) => {
    if (!selectedTrack) {
      console.warn("[AlbumPlaylistScreen] No selected track to add");
      return;
    }

    try {
      // Check if song is already in playlist
      const isAlreadyInPlaylist = playlist.tracks.some(
        (track) => track.id === selectedTrack.id
      );

      if (isAlreadyInPlaylist) {
        console.log("[AlbumPlaylistScreen] Song already in playlist");
        setShowPlaylistSelection(false);
        return;
      }

      // Add selected track to playlist
      const updatedPlaylist = {
        ...playlist,
        tracks: [...playlist.tracks, selectedTrack],
        updatedAt: new Date().toISOString(),
      };

      await StorageService.updatePlaylist(updatedPlaylist);
      console.log(
        "[AlbumPlaylistScreen] Song added to playlist:",
        playlist.name
      );

      setShowPlaylistSelection(false);
    } catch (error) {
      console.error(
        "[AlbumPlaylistScreen] Error adding song to playlist:",
        error
      );
    }
  };

  const handleAddToLibrary = async () => {
    if (!albumId || !albumTitle) return;

    try {
      const playlists = await StorageService.loadPlaylists();
      const newPlaylist = {
        id: albumId,
        name: albumTitle,
        tracks: albumSongs,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        thumbnail: albumArtUrl || undefined,
      };

      await StorageService.addPlaylist(newPlaylist);
      setIsInLibrary(true);
      setIsUserCreated(true);
    } catch (error) {
      console.error("Error adding to library:", error);
    }
  };

  const handleRemoveFromLibrary = async () => {
    if (!albumId) return;

    try {
      await StorageService.deletePlaylist(albumId);
      setIsInLibrary(false);
      setIsUserCreated(false);
    } catch (error) {
      console.error("Error removing from library:", error);
    }
  };

  const handleSheetOptionPress = async (option: string) => {
    if (sheetMode === "playlist") {
      if (option === "Add to library") {
        await handleAddToLibrary();
        closeSongActionSheet();
        return;
      }

      if (option === "Remove from library") {
        await handleRemoveFromLibrary();
        closeSongActionSheet();
        navigation.goBack();
        return;
      }

      if (option === "Rename playlist" && isUserCreated) {
        setRenameValue(albumTitle);
        closeSongActionSheet();
        setShowRenameModal(true);
        return;
      }

      if (option === "Remove playlist" && isUserCreated) {
        await StorageService.deletePlaylist(albumId);
        closeSongActionSheet();
        navigation.goBack();
        return;
      }
    }

    if (sheetMode === "playlist-song" && option === "Download") {
      console.log("Download song:", selectedTrack?.title);
      // Add download logic here
      closeSongActionSheet();
      return;
    }

    if (sheetMode === "playlist-song" && option === "Add to other playlist") {
      console.log("[AlbumPlaylistScreen] Opening playlist selection modal");
      console.log("[AlbumPlaylistScreen] Current sheetMode:", sheetMode);
      console.log(
        "[AlbumPlaylistScreen] Selected track:",
        selectedTrack?.title
      );
      console.log(
        "[AlbumPlaylistScreen] Album ID:",
        albumId,
        "Album Title:",
        albumTitle
      );
      console.log(
        "[AlbumPlaylistScreen] Is in library:",
        isInLibrary,
        "Is user created:",
        isUserCreated
      );

      // Load playlists and show modal
      loadUserPlaylists();
      setShowPlaylistSelection(true);
      closeSongActionSheet();

      // Add a small delay to ensure modal opens properly
      setTimeout(() => {
        console.log(
          "[AlbumPlaylistScreen] Modal state after opening:",
          showPlaylistSelection
        );
      }, 100);

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

  console.log("[AlbumPlaylistScreen] Received params:", {
    albumId,
    albumName,
    routeArtist,
    source,
  });

  useEffect(() => {
    loadAlbumSongs();
    checkIfInLibrary();

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

  // Track modal visibility changes
  useEffect(() => {
    console.log(
      "[AlbumPlaylistScreen] Modal visibility changed:",
      showPlaylistSelection
    );
    if (showPlaylistSelection) {
      console.log("[AlbumPlaylistScreen] Modal is now visible");
    } else {
      console.log("[AlbumPlaylistScreen] Modal is now hidden");
    }
  }, [showPlaylistSelection]);

  const loadAlbumSongs = async () => {
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
        console.log("[AlbumPlaylistScreen] Fetching JioSaavn album details");
        const { searchAPI } = await import("../../modules/searchAPI");
        const albumDetails = await searchAPI.getJioSaavnAlbumDetails(
          albumId,
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
            title:
              song.name ||
              song.title ||
              song.song ||
              t("screens.artist.unknown_title"),
            artist:
              song.artists?.primary
                ?.map((artist: any) => artist.name)
                .join(", ") ||
              song.singers ||
              routeArtist ||
              t("screens.artist.unknown_artist"),
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
        }
      } else if (source === "youtube") {
        // Handle YouTube albums/playlists
        console.log("[AlbumPlaylistScreen] Loading YouTube playlist/album");
        try {
          // Extract playlist ID from URL if needed (e.g., /playlist?list=ID)
          let playlistId = albumId;
          if (albumId.includes("list=")) {
            const match = albumId.match(/list=([^&]+)/);
            if (match && match[1]) {
              playlistId = match[1];
            }
          }

          // Fetch playlist details from Piped API
          const playlistResponse = await fetch(
            `https://api.piped.private.coffee/playlists/${playlistId}`
          );

          if (playlistResponse.ok) {
            const playlistData = await playlistResponse.json();
            console.log(
              "[AlbumPlaylistScreen] YouTube playlist data:",
              playlistData
            );

            if (
              playlistData.relatedStreams &&
              Array.isArray(playlistData.relatedStreams)
            ) {
              const songs = playlistData.relatedStreams.map(
                (stream: any, index: number) => ({
                  id: String(stream.url || `youtube_${index}`),
                  title: stream.title || t("screens.artist.unknown_title"),
                  artist:
                    stream.uploaderName ||
                    playlistData.uploader ||
                    routeArtist ||
                    t("screens.artist.unknown_artist"),
                  duration: stream.duration || 0,
                  thumbnail: stream.thumbnail || "",
                  source: "youtube",
                  _isYouTube: true,
                  albumId: albumId,
                  albumName: albumName,
                })
              );

              setAlbumSongs(songs);
              setAlbumTitle(playlistData.name || albumName);
              setAlbumArtist(
                playlistData.uploader ||
                  routeArtist ||
                  t("screens.artist.unknown_artist")
              );

              // Use playlist thumbnail as album art
              const albumArt =
                playlistData.thumbnailUrl ||
                playlistData.relatedStreams[0]?.thumbnail ||
                "";
              setAlbumArtUrl(albumArt);
            } else {
              console.warn(
                "[AlbumPlaylistScreen] No related streams found in YouTube playlist"
              );
              setAlbumSongs([]);
              setAlbumTitle(albumName);
              setAlbumArtist(routeArtist || t("screens.artist.unknown_artist"));
              setErrorMessage("No songs found in this playlist");
            }
          } else {
            console.warn(
              "[AlbumPlaylistScreen] Failed to fetch YouTube playlist"
            );
            setAlbumSongs([]);
            setAlbumTitle(albumName);
            setAlbumArtist(routeArtist || "Unknown Artist");
            setErrorMessage("Failed to load YouTube playlist");
          }
        } catch (error) {
          console.error(
            "[AlbumPlaylistScreen] Error loading YouTube playlist:",
            error
          );
          setAlbumSongs([]);
          setAlbumTitle(albumName);
          setAlbumArtist(routeArtist || "Unknown Artist");
          setErrorMessage("Failed to load YouTube playlist");
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
      <SafeArea>
        <Playlist
          title={albumTitle || t("screens.album_playlist.album")}
          albumArtUrl={albumArtUrl}
          songs={[]}
          onBack={handleGoBack}
          onHeaderOptionsPress={handleHeaderOptionsPress}
          emptyMessage={t("screens.album_playlist.loading_album")}
          emptySubMessage=""
          type={source === "user-playlist" ? "playlist" : "album"}
        />
      </SafeArea>
    );
  }

  if (errorMessage) {
    return (
      <SafeArea>
        <Playlist
          title={albumTitle || t("screens.album_playlist.album")}
          artist={albumArtist}
          albumArtUrl={albumArtUrl}
          songs={[]}
          onBack={handleGoBack}
          onHeaderOptionsPress={handleHeaderOptionsPress}
          emptyMessage={errorMessage}
          emptySubMessage={t("screens.album_playlist.refresh_error")}
          emptyIcon="error-outline"
          type={source === "user-playlist" ? "playlist" : "album"}
        />
      </SafeArea>
    );
  }

  return (
    <SafeArea>
      <Playlist
        title={albumTitle || t("screens.album_playlist.album")}
        artist={albumArtist}
        albumArtUrl={albumArtUrl}
        songs={albumSongs}
        onBack={handleGoBack}
        onPlayAll={handlePlayAll}
        onSongOptionsPress={openSongActionSheet}
        onHeaderOptionsPress={handleHeaderOptionsPress}
        emptyMessage={t("screens.album_playlist.no_songs_found")}
        emptySubMessage={t("screens.album_playlist.album_empty")}
        emptyIcon="albums"
        type={source === "user-playlist" ? "playlist" : "album"}
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
            ? isUserCreated
              ? [
                  {
                    key: "Rename playlist",
                    label: t("actions.rename_playlist"),
                    icon: "create-outline",
                  },
                  {
                    key: "Remove playlist",
                    label: t("actions.remove_playlist"),
                    icon: "trash-outline",
                  },
                ]
              : [
                  ...(isInLibrary
                    ? [
                        {
                          key: "Remove from library",
                          label: t(
                            "screens.album_playlist.remove_from_library"
                          ),
                          icon: "remove-circle-outline",
                        },
                      ]
                    : [
                        {
                          key: "Add to library",
                          label: t("screens.album_playlist.add_to_library"),
                          icon: "add-circle-outline",
                        },
                      ]),
                ]
            : [
                {
                  key: "Download",
                  label: t("actions.download"),
                  icon: "cloud-download-outline",
                },
                {
                  key: "Share",
                  label: t("actions.share"),
                  icon: "share-outline",
                },
                {
                  key: "Add to other playlist",
                  label: t("actions.add_to_other_playlist"),
                  icon: "add-circle-outline",
                },
                {
                  key: "Go to album",
                  label: t("actions.go_to_album"),
                  icon: "albums-outline",
                },
                {
                  key: "Go to artists",
                  label: t("actions.go_to_artists"),
                  icon: "people-outline",
                },
                {
                  key: "Sleep timer",
                  label: t("actions.sleep_timer"),
                  icon: "time-outline",
                },
                {
                  key: "Go to song radio",
                  label: t("actions.go_to_song_radio"),
                  icon: "radio-outline",
                },
                {
                  key: "Remove song from playlist",
                  label: t("actions.remove_song_from_playlist"),
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
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: "85%",
              backgroundColor: "#111827",
              borderRadius: 16,
              padding: 20,
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 18,
                fontFamily: "GoogleSansSemiBold",
                marginBottom: 12,
              }}
            >
              {t("actions.rename_playlist")}
            </Text>
            <TextInput
              style={{
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "#374151",
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "#fff",
                fontFamily: "GoogleSansRegular",
                marginBottom: 16,
              }}
              placeholder={t("actions.playlist_name")}
              placeholderTextColor="#6b7280"
              value={renameValue}
              onChangeText={setRenameValue}
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
              }}
            >
              <TouchableOpacity
                onPress={() => setShowRenameModal(false)}
                style={{ paddingVertical: 8, paddingHorizontal: 12 }}
              >
                <Text
                  style={{
                    color: "#9ca3af",
                    fontSize: 14,
                    fontFamily: "GoogleSansSemiBold",
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
                  backgroundColor: "#3d02ae",
                  borderRadius: 999,
                  marginLeft: 8,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 14,
                    fontFamily: "GoogleSansSemiBold",
                  }}
                >
                  {t("actions.save")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Playlist Selection Modal */}
      <Modal
        visible={showPlaylistSelection}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          console.log("[AlbumPlaylistScreen] Modal closed by user");
          setShowPlaylistSelection(false);
        }}
        onShow={() => {
          console.log("[AlbumPlaylistScreen] Playlist modal shown");
          console.log(
            "[AlbumPlaylistScreen] Modal visibility:",
            showPlaylistSelection
          );
          console.log(
            "[AlbumPlaylistScreen] Number of playlists:",
            userPlaylists.length
          );
          console.log(
            "[AlbumPlaylistScreen] First few playlists:",
            userPlaylists.slice(0, 3).map((p) => ({ id: p.id, name: p.name }))
          );
        }}
        statusBarTranslucent={true}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.8)",
            justifyContent: "flex-end",
            zIndex: 1000,
          }}
        >
          <View
            style={{
              backgroundColor: "#1a1a1a",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: 20,
              paddingBottom: 32,
              maxHeight: "85%",
              minHeight: 200,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingHorizontal: 20,
                paddingBottom: 16,
                borderBottomWidth: 1,
                borderBottomColor: "#333",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 18, fontWeight: "600" }}>
                {t("actions.select_playlist")}
              </Text>
              <TouchableOpacity
                onPress={() => setShowPlaylistSelection(false)}
                style={{ padding: 8 }}
              >
                <Text style={{ color: "#9ca3af", fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 20 }}
            >
              {userPlaylists.map((playlist) => (
                <TouchableOpacity
                  key={playlist.id}
                  onPress={() => {
                    console.log(
                      "[AlbumPlaylistScreen] Playlist selected:",
                      playlist.name,
                      "ID:",
                      playlist.id
                    );
                    handlePlaylistSelect(playlist);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: "#333",
                    backgroundColor: "#1a1a1a",
                  }}
                  activeOpacity={0.7}
                >
                  {playlist.thumbnail ? (
                    <Image
                      source={{ uri: playlist.thumbnail }}
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 8,
                        marginRight: 12,
                      }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      style={{
                        width: 50,
                        height: 50,
                        backgroundColor: "#333",
                        borderRadius: 8,
                        marginRight: 12,
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: "#fff", fontSize: 20 }}>♪</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontSize: 16 }}>
                      {playlist.name}
                    </Text>
                    <Text style={{ color: "#9ca3af", fontSize: 14 }}>
                      {playlist.tracks.length} songs
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}

              {userPlaylists.length === 0 && (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <Text style={{ color: "#888", fontSize: 16 }}>
                    {t("actions.no_playlists_found")}
                  </Text>
                  <Text style={{ color: "#666", fontSize: 14, marginTop: 8 }}>
                    {t("actions.create_playlist_first")}
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeArea>
  );
};

export default AlbumPlaylistScreen;
