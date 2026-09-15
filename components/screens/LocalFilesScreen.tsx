/********************************************************************
 *  LocalFilesScreen — pinned "Local files" collection in Library.
 *
 *  Opens, requests the OS storage permission if it has not been
 *  granted (literally triggers the system dialog), then scans
 *  MediaStore and shows every device audio file as a playlist.
 *******************************************************************/
import React, { useCallback, useEffect, useState } from "react";
import { Platform, TouchableOpacity } from "react-native";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import styled from "styled-components/native";
import Playlist from "../Playlist";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme } from "../../hooks/useTheme";
import { usePlayer } from "../../contexts/PlayerContext";
import {
  isLocalMediaSupported,
  requestStoragePermission,
  scanLocalTracks,
  type LocalTrack,
} from "../../modules/localMedia";

interface LocalFilesScreenProps {
  navigation: any;
}

/* Permission notice styling kept for reference — the notice is now
   rendered inline via emptyMessage when permission is denied. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const NoticeRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
`;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const NoticeText = styled.Text`
  flex: 1;
  font-size: 13px;
`;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const NoticeButton = styled.Text`
  font-size: 13px;
  font-weight: 700;
`;

/** Map a MediaStore row onto the player's Track shape. */
function toPlayableTrack(local: LocalTrack) {
  return {
    // "local-" prefix is what waveform / ReplayGain resolution expects.
    id: `local-${local.id}`,
    title: local.title,
    artist: local.artist,
    album: local.album,
    albumName: local.album,
    duration: Math.round(local.durationMs / 1000),
    url: local.contentUri || local.streamUrl,
    audioUrl: local.contentUri || local.streamUrl,
    artwork: local.artworkUri ?? "",
    thumbnail: local.artworkUri ?? "",
    source: "local",
    _isLocal: true,
  } as any;
}

export const LocalFilesScreen: React.FC<LocalFilesScreenProps> = ({
  navigation,
}) => {
  const { t, isRtl } = useAppLanguage();
  const { colors } = useTheme();
  const { playTrack } = usePlayer();

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigatingBack, setIsNavigatingBack] = useState(false);

  const load = useCallback(async () => {
    if (!isLocalMediaSupported) {
      setIsLoading(false);
      setPermissionGranted(false);
      return;
    }
    setIsLoading(true);
    // Triggers the native permission request, which surfaces the OS dialog
    // the first time (and only the first time) the screen is opened.
    const granted = await requestStoragePermission();
    setPermissionGranted(granted);
    if (granted) {
      setTracks(await scanLocalTracks(1000));
    } else {
      setTracks([]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGoBack = () => {
    if (isNavigatingBack) {
      return;
    }
    setIsNavigatingBack(true);
    setTimeout(() => navigation.goBack(), 50);
  };

  const songs = tracks.map(toPlayableTrack);
  const songCountLabel = `${tracks.length} ${t("search.songs")}`;

  const handlePlayAll = async () => {
    if (!songs.length) {
      return;
    }
    await playTrack(songs[0], songs, 0);
  };

  const handleSongPress = async (_song: any, index: number) => {
    const picked = songs[index];
    if (picked) {
      // Pass the whole list so next/previous navigate the local queue.
      await playTrack(picked, songs, index);
    }
  };

  const openAppSettings = () => {
    if (Platform.OS === "android") {
      void Linking.openSettings();
    }
  };

  // Permission notice: rendered as empty state message when denied,
  // so the user immediately sees why the list is empty + an action hint.
  const permissionNotice = permissionGranted === false;
  const openNotice = () => void openAppSettings();

  return (
    <Playlist
      title={isRtl ? "فایل‌های محلی" : "Local files"}
      artist={songCountLabel}
      albumArtUrl=""
      songs={songs}
      onBack={handleGoBack}
      onPlayAll={() => void handlePlayAll()}
      onSongPress={handleSongPress}

      emptyMessage={
        isLoading
          ? t("common.loading")
          : permissionNotice
            ? (isRtl
              ? "دسترسی فایل‌ها فعال نیست"
              : "File access permission required")
            : isRtl
              ? "آهنگی روی این دستگاه پیدا نشد"
              : "No songs found on this device"
      }
      emptySubMessage={
        permissionNotice
          ? (isRtl
            ? "برای اسکن موزیک دستگاه، فعال کردن فایل‌ها لازم است"
            : "Allow file access to scan music on this device. Tap Enable in Settings.")
          : isRtl
            ? "موسیقی را روی حافظه دستگاه بریزید"
            : "Put some music on the device storage first"
      }
      emptyIcon="musical-notes"
      showSongOptions={false}
      showHeaderOptions={permissionNotice}
      onHeaderOptionsPress={permissionNotice ? openNotice : undefined}
      type="playlist"
      isLoading={isLoading}
    />
  );
};

export default LocalFilesScreen;
