import React, { useEffect, useState } from "react";
import { usePlayer } from "../../contexts/PlayerContext";
import Playlist from "../Playlist";
import { useAppLanguage } from "../../hooks/useAppLanguage";

interface PreviouslyPlayedScreenProps {
  navigation: any;
}

export const PreviouslyPlayedScreen: React.FC<PreviouslyPlayedScreenProps> = ({
  navigation,
}) => {
  console.log("[PreviouslyPlayedScreen] Component rendered");
  const { previouslyPlayedSongs } = usePlayer();
  const { t, isRtl } = useAppLanguage();

  // Use library cover instead of album art for Previously Played
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

  const title = t("screens.previously_played.title");
  const songCountLabel =
    isRtl || previouslyPlayedSongs.length !== 1
      ? `${previouslyPlayedSongs.length} ${t("search.songs")}`
      : `${previouslyPlayedSongs.length} song`;

  if (isLoading) {
    return (
      <Playlist
        title={title}
        albumArtUrl={albumArtUrl}
        libraryCover="previously-played"
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
      libraryCover="previously-played"
      songs={previouslyPlayedSongs}
      onBack={handleGoBack}
      emptyMessage={
        isRtl ? "هنوز آهنگی قبلا پخش نشده است" : "No previously played songs"
      }
      emptySubMessage={
        isRtl
          ? "چند آهنگ پخش کنید تا اینجا نمایش داده شوند"
          : "Play some songs to see them here"
      }
      emptyIcon="time"
      showSongOptions={false}
      showHeaderOptions={false}
      type="playlist"
    />
  );
};

export default PreviouslyPlayedScreen;
