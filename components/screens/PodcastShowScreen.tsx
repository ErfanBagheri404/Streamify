/**
 * PodcastShowScreen — episodes of one subscribed show (#30).
 *
 * Uses the shared `Playlist` list surface, so episodes get the same header,
 * artwork, and play-all affordances as albums. Episode rows are plain Tracks
 * flagged direct-play; the queue is the episode list, which is what makes
 * "listen to the next one" work without a bespoke player.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import Playlist from "../Playlist";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { usePlayer } from "../../contexts/PlayerContext";
import {
  loadPodcastEpisodes,
  loadPodcastShows,
  unsubscribeFromPodcast,
} from "../../utils/storage";
import { podcastEpisodeToTrack } from "../../modules/podcastService";
import type { PodcastEpisode, PodcastShow } from "../../modules/podcastFeed";

interface PodcastShowScreenProps {
  navigation: any;
  route: { params?: { showId?: string } };
}

export const PodcastShowScreen: React.FC<PodcastShowScreenProps> = ({
  navigation,
  route,
}) => {
  const { t, isRtl } = useAppLanguage();
  const { playTrack } = usePlayer();
  const showId = route.params?.showId;

  const [show, setShow] = useState<PodcastShow | null>(null);
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigatingBack, setIsNavigatingBack] = useState(false);

  const load = useCallback(async () => {
    if (!showId) {
      setIsLoading(false);
      return;
    }
    const [shows, allEpisodes] = await Promise.all([
      loadPodcastShows(),
      loadPodcastEpisodes(),
    ]);
    setShow(shows.find((item) => item.id === showId) ?? null);
    setEpisodes(
      allEpisodes
        .filter((episode) => episode.showId === showId)
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
    );
    setIsLoading(false);
  }, [showId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGoBack = useCallback(() => {
    if (isNavigatingBack) return;
    setIsNavigatingBack(true);
    setTimeout(() => navigation.goBack(), 50);
  }, [isNavigatingBack, navigation]);

  const tracks = episodes.map((episode) => podcastEpisodeToTrack(episode, show ?? undefined));

  const handlePlayAll = useCallback(async () => {
    if (!tracks.length) return;
    await playTrack(tracks[0], tracks, 0);
  }, [playTrack, tracks]);

  const handleEpisodePress = useCallback(
    async (_song: any, index: number) => {
      const picked = tracks[index];
      if (picked) {
        // The full episode list is the queue, so next/previous walk the show.
        await playTrack(picked, tracks, index);
      }
    },
    [playTrack, tracks],
  );

  const handleHeaderOptions = useCallback(() => {
    if (!show) return;
    Alert.alert(show.title, isRtl ? "گزینه‌ها" : "Options", [
      {
        text: isRtl ? "لغو اشتراک" : "Unsubscribe",
        style: "destructive",
        onPress: () => {
          void unsubscribeFromPodcast(show.id).then(() => navigation.goBack());
        },
      },
      { text: isRtl ? "انصراف" : "Cancel", style: "cancel" },
    ]);
  }, [isRtl, navigation, show]);

  if (!showId) return null;

  return (
    <View style={{ flex: 1 }}>
      <Playlist
        title={show?.title ?? (isRtl ? "پادکست" : "Podcast")}
        artist={
          show?.author ||
          (isRtl ? "پادکست" : `${episodes.length} episodes`)
        }
        albumArtUrl={show?.artworkUrl ?? ""}
        kindLabel={isRtl ? "پادکست" : "Podcast"}
        songs={tracks}
        onBack={handleGoBack}
        onPlayAll={() => void handlePlayAll()}
        onSongPress={handleEpisodePress}
        showHeaderOptions={!!show}
        onHeaderOptionsPress={handleHeaderOptions}
        isLoading={isLoading}
        emptyMessage={isRtl ? "هنوز قسمتی نیست" : "No episodes yet"}
        emptySubMessage={
          isRtl
            ? "برای بروزرسانی، پادکست را دوباره باز کن"
            : "Reopen this show to refresh its feed"
        }
        emptyIcon="mic-outline"
      />
    </View>
  );
};
