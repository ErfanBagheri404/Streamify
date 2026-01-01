import React, { useEffect, useState } from "react";
import { SafeArea } from "../SafeArea";
import { usePlayer } from "../../contexts/PlayerContext";
import Playlist from "../Playlist";

interface AlbumPlaylistScreenProps {
  navigation: any;
  route: any;
}

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
  }, [albumId, albumName, source]);

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
          albumName,
        );

        if (
          albumDetails &&
          albumDetails.songs &&
          albumDetails.songs.length > 0
        ) {
          console.log(
            `[AlbumPlaylistScreen] Found ${albumDetails.songs.length} songs in album`,
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
          : "Failed to load album tracks. This album may not be available or the service is temporarily unavailable.",
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
          title={albumTitle || "Album"}
          albumArtUrl={albumArtUrl}
          songs={[]}
          onBack={handleGoBack}
          emptyMessage="Loading album..."
          emptySubMessage=""
        />
      </SafeArea>
    );
  }

  if (errorMessage) {
    return (
      <SafeArea>
        <Playlist
          title={albumTitle || "Album"}
          artist={albumArtist}
          albumArtUrl={albumArtUrl}
          songs={[]}
          onBack={handleGoBack}
          emptyMessage={errorMessage}
          emptySubMessage="Try refreshing or check your internet connection"
          emptyIcon="error-outline"
        />
      </SafeArea>
    );
  }

  return (
    <SafeArea>
      <Playlist
        title={albumTitle || "Album"}
        artist={albumArtist}
        albumArtUrl={albumArtUrl}
        songs={albumSongs}
        onBack={handleGoBack}
        onPlayAll={handlePlayAll}
        emptyMessage="No songs found"
        emptySubMessage="This album appears to be empty"
        emptyIcon="albums"
      />
    </SafeArea>
  );
};

export default AlbumPlaylistScreen;
