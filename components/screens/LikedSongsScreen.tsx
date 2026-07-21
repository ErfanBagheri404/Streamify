import React, { useEffect, useState } from "react";
import { usePlayer } from "../../contexts/PlayerContext";
import Playlist from "../Playlist";
import { useAppLanguage } from "../../hooks/useAppLanguage";

interface LikedSongsScreenProps {
  navigation: any;
}

export const LikedSongsScreen: React.FC<LikedSongsScreenProps> = ({
  navigation,
}) => {
  console.log("[LikedSongsScreen] Component rendered");
  const { likedSongs } = usePlayer();
  const { t, isRtl } = useAppLanguage();

  // Use library cover instead of album art for Liked Songs
  const albumArtUrl = ""; // Empty since we're using library cover
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigatingBack, setIsNavigatingBack] = useState(false);

  useEffect(() => {
    // Add a small delay to prevent flash when component loads
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 50);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Handle back navigation with delay to prevent white flash
  const handleGoBack = () => {
    if (isNavigatingBack) {
      return;
    } // Prevent double navigation
    setIsNavigatingBack(true);

    // Small delay to ensure smooth transition
    setTimeout(() => {
      navigation.goBack();
    }, 50);
  };

  const title = t("screens.liked_songs.title");
  const songCountLabel =
    isRtl || likedSongs.length !== 1
      ? `${likedSongs.length} ${t("search.songs")}`
      : `${likedSongs.length} song`;

  if (isLoading) {
    return (
      <Playlist
        title={title}
        albumArtUrl={albumArtUrl}
        libraryCover="liked"
        songs={[]}
        isLoading
        onBack={handleGoBack}
        emptyMessage={t("common.loading")}
        emptySubMessage=""
        showSongOptions={false}
        showHeaderOptions={false}
        type="playlist"
      />
    );
  }

  return (
    <Playlist
      title={title}
      artist={songCountLabel}
      albumArtUrl={albumArtUrl}
      libraryCover="liked"
      songs={likedSongs}
      onBack={handleGoBack}
      emptyMessage={
        isRtl ? "هنوز آهنگ پسندیده‌ای ندارید" : "No liked songs yet"
      }
      emptySubMessage={
        isRtl
          ? "از پلیر آهنگ‌ها را لایک کنید تا اینجا نمایش داده شوند"
          : "Like songs from the player to see them here"
      }
      emptyIcon="heart"
      showSongOptions={false}
      showHeaderOptions={false}
      type="playlist"
    />
  );
};

export default LikedSongsScreen;
