import React, { useEffect, useState } from "react";
import { SafeArea } from "../SafeArea";
import { usePlayer } from "../../contexts/PlayerContext";
import Playlist from "../Playlist";

interface PreviouslyPlayedScreenProps {
  navigation: any;
}

export const PreviouslyPlayedScreen: React.FC<PreviouslyPlayedScreenProps> = ({
  navigation,
}) => {
  const { previouslyPlayedSongs } = usePlayer();
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
          title="Previously Played"
          subtitle="Loading..."
          songs={[]}
          onBack={handleGoBack}
          emptyMessage="Loading..."
          emptySubMessage=""
        />
      </SafeArea>
    );
  }

  return (
    <SafeArea>
      <Playlist
        title="Previously Played"
        subtitle={`${previouslyPlayedSongs.length} songs`}
        songs={previouslyPlayedSongs}
        onBack={handleGoBack}
        emptyMessage="No previously played songs"
        emptySubMessage="Play some songs to see them here"
        emptyIcon="time"
      />
    </SafeArea>
  );
};

export default PreviouslyPlayedScreen;
