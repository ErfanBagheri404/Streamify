import React, { useEffect, useState } from "react";
import { SafeArea } from "../SafeArea";
import { usePlayer } from "../../contexts/PlayerContext";
import Playlist from "../Playlist";

interface LikedSongsScreenProps {
  navigation: any;
}

export const LikedSongsScreen: React.FC<LikedSongsScreenProps> = ({
  navigation,
}) => {
  console.log("[LikedSongsScreen] Component rendered");
  const { likedSongs } = usePlayer();

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

  if (isLoading) {
    return (
      <SafeArea>
        <Playlist
          title="Liked Songs"
          albumArtUrl={albumArtUrl}
          libraryCover="liked"
          songs={[]}
          onBack={handleGoBack}
          emptyMessage="Loading..."
          emptySubMessage=""
          showSongOptions={false}
          showHeaderOptions={false}
          type="playlist"
        />
      </SafeArea>
    );
  }

  return (
    <SafeArea>
      <Playlist
        title="Liked Songs"
        artist={`${likedSongs.length} songs`}
        albumArtUrl={albumArtUrl}
        libraryCover="liked"
        songs={likedSongs}
        onBack={handleGoBack}
        emptyMessage="No liked songs yet"
        emptySubMessage="Like songs from the player to see them here"
        emptyIcon="heart"
        showSongOptions={false}
        showHeaderOptions={false}
        type="playlist"
      />
    </SafeArea>
  );
};

export default LikedSongsScreen;
