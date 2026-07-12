import React, { useRef, useState } from "react";
const { Animated, PanResponder, Dimensions } = require("react-native");
import { Image, View, TouchableOpacity, Text, TextInput } from "react-native";
import styled from "styled-components/native";
import { LinearGradient } from "expo-linear-gradient";
import AntDesign from "@expo/vector-icons/AntDesign";
import Entypo from "@expo/vector-icons/Entypo";
import {
  FontAwesome5,
  FontAwesome6,
  Fontisto,
  Ionicons,
} from "@expo/vector-icons";
import { usePlayer } from "../../contexts/PlayerContext";
import {
  StorageService,
  Playlist,
  subscribeToLibraryUpdates,
} from "../../utils/storage";
import { SliderSheet } from "../SliderSheet";
import { Track } from "../../contexts/PlayerContext";
import { Screen as UiScreen } from "../ui/Screen";
import { Chip as UiChip } from "../ui/Chip";
import { SectionHeader as UiSectionHeader } from "../ui/SectionHeader";
import { MutedText } from "../ui/Text";
import { AccentButton } from "../ui/Button";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { PlaylistCreateModal } from "../PlaylistCreateModal";
import { sanitizeImageUrl } from "../core/image";
import { getAppFontFamily, getTextDirectionStyle } from "../../utils/fonts";
import { useAuth } from "../../hooks/useAuth";
import { syncCloudLibrarySnapshot } from "../../lib/cloud-library-sync";

const LibraryShell = styled.View`
  flex: 1;
  background-color: #000;
`;

const { height } = Dimensions.get("window");
const SHEET_HEIGHT = height * 0.5;
const SHEET_CLOSED_TOP = height;
const SHEET_HALF_TOP = height - SHEET_HEIGHT;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
`;

const HeaderLeft = styled.View`
  flex-direction: row;
  align-items: center;
`;

const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 22px;
  font-family: GoogleSansBold;
  line-height: 26px;
`;

const HeaderActions = styled.View`
  flex-direction: row;
  align-items: center;
`;

const HeaderIconButton = styled.TouchableOpacity`
  padding: 8px;
  margin-left: 8px;
`;

const HeaderIconText = styled.Text`
  color: #fff;
  font-size: 20px;
  font-family: GoogleSansRegular;
`;

const FilterChipsRow = styled.ScrollView`
  margin-bottom: 12px;
  max-height: 32px;
`;

const SortRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  margin-bottom: 12px;
`;

const SortLeft = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
`;

const SortIcon = styled.Text`
  color: #a3a3a3;
  font-size: 16px;
  margin-right: 8px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const SortLabel = styled.Text`
  color: #fff;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const LayoutToggle = styled.TouchableOpacity`
  padding: 6px;
`;

const LayoutIcon = styled.Text`
  color: #a3a3a3;
  font-size: 18px;
  font-family: GoogleSansRegular;
  line-height: 22px;
`;

const Grid = styled.ScrollView`
  flex: 1;
  padding: 0 0 120px 0;
`;

const GridRow = styled.View`
  flex-direction: row;
  justify-content: flex-start;
  margin-bottom: 16px;
`;

const CollectionCard = styled.TouchableOpacity`
  width: 50%;
  padding-horizontal: 8px;
`;

const CollectionCover = styled.Image`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  background-color: #262626;
`;

const DownloadingCoverWrapper = styled.View`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background-color: #262626;
`;

const DownloadingCoverFill = styled.View`
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  background-color: rgba(0, 0, 0, 0.55);
`;

const StopCachingOverlay = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.35);
`;

const StopCachingButton = styled.TouchableOpacity`
  padding: 10px 12px;
  border-radius: 10px;
  background-color: rgba(0, 0, 0, 0.75);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.15);
`;

const StopCachingText = styled.Text`
  color: #fff;
  font-size: 13px;
  font-family: GoogleSansMedium;
  line-height: 16px;
`;

const LikedCoverWrapper = styled.View`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
`;

const LikedCoverGradient = styled(LinearGradient)`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const CollectionTitle = styled.Text`
  color: #fff;
  font-size: 14px;
  margin-top: 8px;
  font-family: GoogleSansSemiBold;
  line-height: 18px;
`;

const CollectionMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const PinRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 2px;
`;

const PinIcon = styled.Text`
  color: #22c55e;
  margin-right: 4px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const PinLabel = styled.Text`
  color: #22c55e;
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 12px;
`;

const PinDot = styled.Text`
  color: #a3a3a3;
  margin: 0 4px;
  font-family: GoogleSansRegular;
  line-height: 12px;
`;

type LibrarySection = "Playlists" | "Artists" | "Downloaded" | "Downloading";
type LibrarySortMode = "recents" | "alphabetical" | "creator";
type LibraryViewMode = "grid" | "list";
type LibraryArtworkKind =
  | "liked"
  | "history"
  | "music"
  | "playlist"
  | "image"
  | "artist";

type LibraryDisplayItem = {
  id: string;
  trackId?: string;
  title: string;
  subtitle: string;
  meta: string;
  searchText: string;
  artworkKind: LibraryArtworkKind;
  itemType?: "artist" | "collection";
  pinOrder?: number;
  imageUri?: string;
  imageShape?: "rounded" | "circle";
  artistId?: string;
  artistSource?: "youtube" | "jiosaavn";
  artistCount?: number;
  progress?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
};

const sections: LibrarySection[] = [
  "Playlists",
  "Artists",
  "Downloaded",
  "Downloading",
];
const sortModes: LibrarySortMode[] = ["recents", "alphabetical", "creator"];

function getPlaylistArtworkUri(playlist: Playlist) {
  return sanitizeImageUrl(
    playlist.tracks.find((track) => track.thumbnail?.trim())?.thumbnail || ""
  );
}

function formatTrackDuration(seconds?: number): string {
  if (!seconds || Number.isNaN(seconds)) {
    return "";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function dedupeTracksById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const output: Track[] = [];

  for (const track of tracks) {
    if (!track?.id || seen.has(track.id)) {
      continue;
    }

    seen.add(track.id);
    output.push(track);
  }

  return output;
}

function interleaveItems<T>(left: T[], right: T[]): T[] {
  const output: T[] = [];
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (left[index]) {
      output.push(left[index]);
    }
    if (right[index]) {
      output.push(right[index]);
    }
  }

  return output;
}

function normalizeArtistSource(
  track: Pick<Track, "artistSource" | "source" | "_isJioSaavn">
): "youtube" | "jiosaavn" | "soundcloud" {
  if (track._isJioSaavn || track.artistSource === "jiosaavn") {
    return "jiosaavn";
  }

  const source = (track.artistSource || track.source || "")
    .trim()
    .toLowerCase();
  if (source === "jiosaavn") {
    return "jiosaavn";
  }
  if (source === "soundcloud") {
    return "soundcloud";
  }
  return "youtube";
}

function canOpenArtistRoute(artistId?: string, source?: string): boolean {
  if (!artistId?.trim()) {
    return false;
  }

  return source === "youtube" || source === "jiosaavn";
}

export default function LibraryScreen({ navigation }: { navigation: any }) {
  const { colors } = useTheme();
  const { t, language, isRtl } = useAppLanguage();
  const { user, isConfigured } = useAuth();
  const [activeSection, setActiveSection] =
    React.useState<LibrarySection | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [sortMode, setSortMode] = useState<LibrarySortMode>("recents");
  const [viewMode, setViewMode] = useState<LibraryViewMode>("grid");
  const [playlists, setPlaylists] = React.useState<Playlist[]>([]);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] =
    React.useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDescription, setNewPlaylistDescription] = useState("");
  const {
    playTrack,
    likedSongs,
    previouslyPlayedSongs,
    getCacheInfo,
    cacheProgress,
    stopCachingAndUnlike,
  } = usePlayer();
  const [downloadingTracks, setDownloadingTracks] = React.useState<
    { track: Track; percentage: number; status: "caching" | "queued" }[]
  >([]);
  const [downloadedTracks, setDownloadedTracks] = React.useState<Track[]>([]);

  const [showSongActionSheet, setShowSongActionSheet] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
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
        if (next < 0) next = 0;
        if (next > SHEET_CLOSED_TOP) next = SHEET_CLOSED_TOP;
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
          }
        } else if (sheetStateRef.current === "full" && (dy > 60 || vy > 0.5)) {
          target = "half";
        }

        animateSheet(target);
      },
    })
  ).current;

  const closeSongActionSheet = () => {
    animateSheet("closed");
  };

  const openSongActionSheet = (track: Track) => {
    setSelectedTrack(track);
    setShowSongActionSheet(true);
    animateSheet("half");
  };

  const handleLikedSongsPress = () => {
    navigation.navigate("LikedSongs");
  };

  const handlePreviouslyPlayedPress = () => {
    navigation.navigate("PreviouslyPlayed");
  };

  const handleUserPlaylistPress = (playlist: Playlist) => {
    navigation.navigate("AlbumPlaylist", {
      albumId: playlist.id,
      albumName: playlist.name,
      albumArtist: `${playlist.tracks.length} ${
        playlist.tracks.length === 1 ? "song" : "songs"
      }`,
      source: "user-playlist",
      tracks: playlist.tracks,
    });
  };

  const loadPlaylists = async () => {
    try {
      const loadedPlaylists = await StorageService.loadPlaylists();
      setPlaylists(loadedPlaylists);
    } catch (error) {
      console.error("Error loading playlists:", error);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) {
      console.warn("Please enter a playlist name");
      return;
    }

    try {
      const newPlaylist: Playlist = {
        id: Date.now().toString(),
        name: newPlaylistName.trim(),
        description: newPlaylistDescription.trim(),
        tracks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await StorageService.addPlaylist(newPlaylist);
      setPlaylists((current) => [...current, newPlaylist]);
      setNewPlaylistName("");
      setNewPlaylistDescription("");
      setShowCreatePlaylistModal(false);
    } catch (error) {
      console.error("Error creating playlist:", error);
      console.warn("Failed to create playlist");
    }
  };

  React.useEffect(() => {
    loadPlaylists();
    const unsubscribe = navigation.addListener("focus", () => {
      loadPlaylists();
    });
    const unsubscribeLibraryUpdates = subscribeToLibraryUpdates(() => {
      void loadPlaylists();
    });
    return () => {
      unsubscribe();
      unsubscribeLibraryUpdates();
    };
  }, [navigation]);

  const loadDownloadingTracks = React.useCallback(async () => {
    const candidates = new Map<string, Track>();
    likedSongs.forEach((track) => {
      if (track?.id && !candidates.has(track.id)) {
        candidates.set(track.id, track);
      }
    });

    const results = await Promise.all(
      Array.from(candidates.values()).map(async (track) => {
        try {
          const info = await getCacheInfo(track.id);
          const percentage = info?.percentage ?? 0;
          if (!info?.isFullyCached) {
            const isActivelyCaching =
              info?.isDownloading || cacheProgress?.trackId === track.id;
            return {
              track,
              percentage,
              status: isActivelyCaching ? "caching" : "queued",
            };
          }
        } catch (error) {
          return null;
        }
        return null;
      })
    );

    setDownloadingTracks(
      results.filter(
        (
          item
        ): item is {
          track: Track;
          percentage: number;
          status: "caching" | "queued";
        } => Boolean(item)
      )
    );
  }, [cacheProgress?.trackId, getCacheInfo, likedSongs]);

  const loadDownloadedTracks = React.useCallback(async () => {
    const candidates = new Map<string, Track>();
    likedSongs.forEach((track) => {
      if (track?.id && !candidates.has(track.id)) {
        candidates.set(track.id, track);
      }
    });

    const results = await Promise.all(
      Array.from(candidates.values()).map(async (track) => {
        try {
          const info = await getCacheInfo(track.id);
          if (info?.isFullyCached) {
            return track;
          }
        } catch (error) {
          return null;
        }
        return null;
      })
    );

    setDownloadedTracks(results.filter((item): item is Track => Boolean(item)));
  }, [getCacheInfo, likedSongs]);

  React.useEffect(() => {
    loadDownloadingTracks();
    loadDownloadedTracks();
    const unsubscribe = navigation.addListener("focus", () => {
      loadDownloadingTracks();
      loadDownloadedTracks();
    });
    return unsubscribe;
  }, [loadDownloadingTracks, loadDownloadedTracks, navigation]);

  React.useEffect(() => {
    loadDownloadingTracks();
    loadDownloadedTracks();
  }, [
    cacheProgress?.percentage,
    cacheProgress?.trackId,
    loadDownloadingTracks,
    loadDownloadedTracks,
  ]);

  React.useEffect(() => {
    if (likedSongs.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      void loadDownloadingTracks();
      void loadDownloadedTracks();
    }, 1000);

    return () => clearInterval(interval);
  }, [likedSongs.length, loadDownloadingTracks, loadDownloadedTracks]);

  const copy = React.useMemo(
    () => ({
      libraryTitle: t("screens.library.title"),
      recents: t("screens.library.recents"),
      alphabetical: language === "fa" ? "الفبایی" : "Alphabetical",
      creator: language === "fa" ? "سازنده" : "Creator",
      createPlaylist: t("library.createPlaylistModalTitle"),
      createPlaylistDescription: t("library.createPlaylistModalDescription"),
      downloadingEmpty:
        language === "fa"
          ? "در حال حاضر آهنگی در حال کش شدن نیست."
          : "No songs are caching right now.",
      cachingLabel: language === "fa" ? "در حال کش شدن" : "Caching",
      queuedLabel: language === "fa" ? "در صف کش" : "Queued",
      downloadedEmpty:
        language === "fa"
          ? "هنوز آهنگ دانلودشده‌ای ندارید."
          : "No downloaded songs yet.",
      playlistsEmpty:
        language === "fa"
          ? "هنوز چیزی در کتابخانه ندارید."
          : "No saved playlists yet.",
      likedSongs: t("screens.liked_songs.title"),
      previouslyPlayed: t("screens.previously_played.title"),
      playlist: t("screens.library.playlist"),
      stopCaching: language === "fa" ? "توقف کش" : "Stop caching",
      downloaded: language === "fa" ? "دانلود شده" : "Downloaded",
      artistsEmpty:
        language === "fa"
          ? "هنوز هنرمندی برای نمایش وجود ندارد."
          : "No artists to show yet.",
      songs: language === "fa" ? "آهنگ" : "songs",
      items: language === "fa" ? "آیتم" : "items",
      results: language === "fa" ? "نتیجه" : "results",
      searchInLibrary:
        language === "fa" ? "جستجو در کتابخانه" : "Search in Your Library",
      gridView: language === "fa" ? "نمای شبکه ای" : "Grid view",
      listView: language === "fa" ? "نمای فهرست" : "List view",
      share: t("actions.menu_watch_on", { value: "" }).trim() || "Share",
      addToPlaylist:
        language === "fa" ? "افزودن به پلی‌لیست دیگر" : "Add to other playlist",
      goToAlbum: language === "fa" ? "رفتن به آلبوم" : "Go to album",
      goToArtists: language === "fa" ? "رفتن به هنرمندان" : "Go to artists",
      sleepTimer: language === "fa" ? "تایمر خواب" : "Sleep timer",
      songRadio: language === "fa" ? "رفتن به رادیوی آهنگ" : "Go to song radio",
    }),
    [language, t]
  );

  const formatSongCount = React.useCallback(
    (count: number) =>
      language === "fa"
        ? `${count} ${copy.songs}`
        : `${count} ${count === 1 ? "song" : copy.songs}`,
    [copy.songs, language]
  );

  const sectionLabels = React.useMemo(
    () =>
      ({
        Playlists: t("screens.library.sections.playlists"),
        Artists: t("library.artists"),
        Downloaded: t("screens.library.sections.downloaded"),
        Downloading: language === "fa" ? "در حال دانلود" : "Downloading",
      }) as Record<LibrarySection, string>,
    [language, t]
  );

  const cycleSortMode = React.useCallback(() => {
    setSortMode((current) => {
      const index = sortModes.indexOf(current);
      return sortModes[(index + 1) % sortModes.length];
    });
  }, []);

  const handleSyncLibrary = React.useCallback(async () => {
    if (!isConfigured) {
      setSyncFeedback(
        "Cloud sync is unavailable until Supabase environment variables are configured."
      );
      return;
    }

    if (!user) {
      setSyncFeedback(
        language === "fa" ? "ابتدا وارد شوید" : "Sign in to sync"
      );
      return;
    }

    setIsSyncing(true);
    setSyncFeedback(
      language === "fa" ? "در حال همگام سازی..." : "Syncing library..."
    );

    try {
      const result = await syncCloudLibrarySnapshot();

      if (result.source === "empty") {
        setSyncFeedback(
          language === "fa"
            ? "کتابخانه شما برای همگام سازی خالی است"
            : "Your library is empty"
        );
        return;
      }

      setSyncFeedback(
        language === "fa"
          ? `${result.syncedPlaylists ?? 0} پلی‌لیست و ${result.syncedLikes ?? 0} لایک همگام شد`
          : `Synced ${result.syncedPlaylists ?? 0} playlists and ${result.syncedLikes ?? 0} likes`
      );
    } catch (error) {
      setSyncFeedback(
        error instanceof Error
          ? error.message
          : language === "fa"
            ? "همگام سازی انجام نشد"
            : "Sync failed"
      );
    } finally {
      setIsSyncing(false);
    }
  }, [isConfigured, language, user]);

  const sortLabel = React.useMemo(() => {
    if (sortMode === "alphabetical") return copy.alphabetical;
    if (sortMode === "creator") return copy.creator;
    return copy.recents;
  }, [copy.alphabetical, copy.creator, copy.recents, sortMode]);
  const showSortIcon = true;

  const downloadedTrackIds = React.useMemo(
    () => new Set(downloadedTracks.map((track) => track.id).filter(Boolean)),
    [downloadedTracks]
  );

  const downloadingProgressByTrackId = React.useMemo(() => {
    const progressById = new Map<string, number>();
    downloadingTracks.forEach(({ track, percentage }) => {
      if (track.id) {
        progressById.set(track.id, percentage);
      }
    });
    return progressById;
  }, [downloadingTracks]);

  const downloadingStatusByTrackId = React.useMemo(() => {
    const statusById = new Map<string, "caching" | "queued">();
    downloadingTracks.forEach(({ track, status }) => {
      if (track.id) {
        statusById.set(track.id, status);
      }
    });
    return statusById;
  }, [downloadingTracks]);

  const topArtistItems = React.useMemo<LibraryDisplayItem[]>(() => {
    const artistMap = new Map<string, LibraryDisplayItem>();

    for (const track of previouslyPlayedSongs) {
      const artistName = track.artist?.trim();
      if (!artistName) {
        continue;
      }

      const artistId = track.artistId?.trim();
      const source = normalizeArtistSource(track);
      if (!canOpenArtistRoute(artistId, source)) {
        continue;
      }

      const key = `${source}:${artistId}`;
      const existing = artistMap.get(key);

      artistMap.set(key, {
        id: key,
        title: artistName,
        subtitle: t("library.artist"),
        meta: t("home.play", { count: (existing?.artistCount ?? 0) + 1 }),
        searchText: [artistName, t("library.artist")].join(" "),
        artworkKind: track.artistImage || track.thumbnail ? "image" : "artist",
        itemType: "artist",
        imageShape: "circle",
        imageUri: existing?.imageUri || track.artistImage || track.thumbnail,
        artistId,
        artistSource: source === "jiosaavn" ? "jiosaavn" : "youtube",
        artistCount: (existing?.artistCount ?? 0) + 1,
        onPress: () =>
          navigation.navigate("Artist", {
            artistId,
            artistName,
            artistImage:
              existing?.imageUri || track.artistImage || track.thumbnail || "",
            source,
          }),
      });
    }

    return [...artistMap.values()]
      .sort((left, right) => (right.artistCount || 0) - (left.artistCount || 0))
      .slice(0, 8);
  }, [navigation, previouslyPlayedSongs, t]);

  const recentPlayedItems = React.useMemo<LibraryDisplayItem[]>(() => {
    const queue = dedupeTracksById(previouslyPlayedSongs).slice(0, 10);

    return queue.map((track) => {
      const cacheProgress = downloadingProgressByTrackId.get(track.id);
      const cacheStatus = downloadingStatusByTrackId.get(track.id);
      const clampedProgress =
        typeof cacheProgress === "number"
          ? Math.min(100, Math.max(0, cacheProgress))
          : null;
      const meta = downloadedTrackIds.has(track.id)
        ? copy.downloaded
        : cacheStatus === "caching" && clampedProgress !== null
          ? language === "fa"
            ? `${Math.round(clampedProgress)}٪ ${copy.cachingLabel}`
            : `${copy.cachingLabel} ${Math.round(clampedProgress)}%`
          : cacheStatus === "queued"
            ? clampedProgress && clampedProgress > 0
              ? language === "fa"
                ? `${Math.round(clampedProgress)}٪ ${copy.queuedLabel}`
                : `${copy.queuedLabel} ${Math.round(clampedProgress)}%`
              : copy.queuedLabel
            : formatTrackDuration(track.duration) || copy.previouslyPlayed;

      return {
        id: `history-track-${track.id}`,
        trackId: track.id,
        title: track.title,
        subtitle: track.artist || t("home.unknownArtist"),
        meta,
        searchText: [track.title, track.artist, copy.previouslyPlayed]
          .filter(Boolean)
          .join(" "),
        artworkKind: track.thumbnail ? "image" : "music",
        itemType: "collection",
        imageShape: "rounded",
        imageUri: track.thumbnail,
        onPress: () => {
          const currentIndex = queue.findIndex((item) => item.id === track.id);
          void playTrack(
            queue[currentIndex >= 0 ? currentIndex : 0],
            queue,
            currentIndex >= 0 ? currentIndex : 0
          );
        },
        onLongPress: () => openSongActionSheet(track),
      };
    });
  }, [
    copy.cachingLabel,
    copy.downloaded,
    copy.previouslyPlayed,
    copy.queuedLabel,
    downloadedTrackIds,
    downloadingProgressByTrackId,
    downloadingStatusByTrackId,
    language,
    openSongActionSheet,
    playTrack,
    previouslyPlayedSongs,
    t,
  ]);

  const mixedLibraryItems = React.useMemo<LibraryDisplayItem[]>(
    () => interleaveItems(recentPlayedItems, topArtistItems),
    [recentPlayedItems, topArtistItems]
  );

  const playlistItems = React.useMemo<LibraryDisplayItem[]>(
    () => [
      {
        id: "liked",
        title: copy.likedSongs,
        subtitle: copy.playlist,
        meta: formatSongCount(likedSongs.length),
        itemType: "collection",
        imageShape: "rounded",
        pinOrder: 0,
        searchText: [
          copy.likedSongs,
          likedSongs.map((track) => track.title).join(" "),
        ]
          .filter(Boolean)
          .join(" "),
        artworkKind: "liked",
        onPress: handleLikedSongsPress,
      },
      {
        id: "previously-played",
        title: copy.previouslyPlayed,
        subtitle: copy.playlist,
        meta: formatSongCount(previouslyPlayedSongs.length),
        itemType: "collection",
        imageShape: "rounded",
        pinOrder: 1,
        searchText: [
          copy.previouslyPlayed,
          previouslyPlayedSongs.map((track) => track.title).join(" "),
        ]
          .filter(Boolean)
          .join(" "),
        artworkKind: "history",
        onPress: handlePreviouslyPlayedPress,
      },
      ...mixedLibraryItems,
      ...playlists.map((playlist) => {
        const artworkUri = getPlaylistArtworkUri(playlist);
        return {
          id: playlist.id,
          title: playlist.name,
          subtitle: playlist.description?.trim() || copy.playlist,
          meta: formatSongCount(playlist.tracks.length),
          itemType: "collection" as const,
          imageShape: "rounded" as const,
          searchText: [
            playlist.name,
            playlist.description,
            playlist.tracks
              .map((track) =>
                [track.title, track.artist].filter(Boolean).join(" ")
              )
              .join(" "),
          ]
            .filter(Boolean)
            .join(" "),
          artworkKind: artworkUri ? ("image" as const) : ("playlist" as const),
          imageUri: artworkUri,
          onPress: () => handleUserPlaylistPress(playlist),
        };
      }),
    ],
    [
      copy.likedSongs,
      copy.playlist,
      copy.previouslyPlayed,
      formatSongCount,
      likedSongs,
      mixedLibraryItems,
      playlists,
      previouslyPlayedSongs,
    ]
  );

  const downloadedItems = React.useMemo<LibraryDisplayItem[]>(
    () =>
      downloadedTracks.map((track) => ({
        id: `downloaded-${track.id}`,
        trackId: track.id,
        title: track.title,
        subtitle: track.artist || t("home.unknownArtist"),
        meta: copy.downloaded,
        searchText: [track.title, track.artist, copy.downloaded]
          .filter(Boolean)
          .join(" "),
        artworkKind: track.thumbnail ? "image" : "music",
        itemType: "collection",
        imageShape: "rounded",
        imageUri: track.thumbnail,
        onPress: () => {
          const queue = dedupeTracksById(downloadedTracks);
          const currentIndex = queue.findIndex((item) => item.id === track.id);
          void playTrack(
            queue[currentIndex >= 0 ? currentIndex : 0],
            queue,
            currentIndex >= 0 ? currentIndex : 0
          );
        },
        onLongPress: () => openSongActionSheet(track),
      })),
    [copy.downloaded, downloadedTracks, openSongActionSheet, playTrack, t]
  );

  const downloadingItems = React.useMemo<LibraryDisplayItem[]>(
    () =>
      downloadingTracks.map(({ track, percentage, status }) => {
        const clamped = Math.min(100, Math.max(0, percentage));
        const rounded = Math.round(clamped);
        const meta =
          status === "caching"
            ? language === "fa"
              ? `${rounded}٪ ${copy.cachingLabel}`
              : `${copy.cachingLabel} ${rounded}%`
            : clamped > 0
              ? language === "fa"
                ? `${rounded}٪ ${copy.queuedLabel}`
                : `${copy.queuedLabel} ${rounded}%`
              : copy.queuedLabel;
        return {
          id: `downloading-${track.id}`,
          trackId: track.id,
          title: track.title,
          subtitle: track.artist || sectionLabels.Downloading,
          meta,
          searchText: [track.title, track.artist, sectionLabels.Downloading]
            .filter(Boolean)
            .join(" "),
          artworkKind: track.thumbnail ? "image" : "music",
          itemType: "collection",
          imageShape: "rounded",
          imageUri: track.thumbnail,
          progress: clamped > 0 ? clamped : undefined,
          onPress: () => openSongActionSheet(track),
          onLongPress: () => openSongActionSheet(track),
          onSecondaryAction: () => {
            stopCachingAndUnlike(track.id);
            void loadDownloadingTracks();
            void loadDownloadedTracks();
          },
          secondaryActionLabel: copy.stopCaching,
        };
      }),
    [
      copy.cachingLabel,
      copy.queuedLabel,
      copy.stopCaching,
      language,
      loadDownloadedTracks,
      loadDownloadingTracks,
      sectionLabels.Downloading,
      stopCachingAndUnlike,
      downloadingTracks,
    ]
  );

  const extraCacheItems = React.useMemo<LibraryDisplayItem[]>(() => {
    const existingTrackIds = new Set(
      playlistItems
        .map((item) => item.trackId)
        .filter((trackId): trackId is string => Boolean(trackId))
    );
    const downloadedIds = new Set(
      downloadedItems
        .map((item) => item.trackId)
        .filter((trackId): trackId is string => Boolean(trackId))
    );

    return [
      ...downloadedItems.filter(
        (item) => !item.trackId || !existingTrackIds.has(item.trackId)
      ),
      ...downloadingItems.filter(
        (item) =>
          (!item.trackId || !existingTrackIds.has(item.trackId)) &&
          (!item.trackId || !downloadedIds.has(item.trackId))
      ),
    ];
  }, [downloadedItems, downloadingItems, playlistItems]);

  const activeItems = React.useMemo<LibraryDisplayItem[]>(() => {
    if (activeSection === null) {
      return [...playlistItems, ...extraCacheItems];
    }
    if (activeSection === "Artists") return topArtistItems;
    if (activeSection === "Downloaded") return downloadedItems;
    if (activeSection === "Downloading") return downloadingItems;
    return playlistItems;
  }, [
    activeSection,
    downloadedItems,
    downloadingItems,
    extraCacheItems,
    playlistItems,
    topArtistItems,
  ]);

  const displayedItems = React.useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const filtered = query
      ? activeItems.filter((item) =>
          [item.title, item.subtitle, item.meta, item.searchText]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : activeItems;

    if (sortMode === "recents") return filtered;

    const sorted = [...filtered];
    sorted.sort((left, right) => {
      const leftPinOrder =
        activeSection === "Playlists" || activeSection === null
          ? (left.pinOrder ?? Number.MAX_SAFE_INTEGER)
          : 0;
      const rightPinOrder =
        activeSection === "Playlists" || activeSection === null
          ? (right.pinOrder ?? Number.MAX_SAFE_INTEGER)
          : 0;

      if (leftPinOrder !== rightPinOrder) {
        return leftPinOrder - rightPinOrder;
      }

      const leftValue =
        sortMode === "creator" ? left.subtitle || left.title : left.title;
      const rightValue =
        sortMode === "creator" ? right.subtitle || right.title : right.title;
      return leftValue.localeCompare(rightValue, undefined, {
        sensitivity: "base",
      });
    });
    return sorted;
  }, [activeItems, activeSection, libraryQuery, sortMode]);

  const librarySummary = React.useMemo(() => {
    if (libraryQuery.trim()) {
      return `${displayedItems.length} ${copy.results}`;
    }

    if (activeSection === null) {
      return language === "fa"
        ? `${displayedItems.length} آیتم`
        : `${displayedItems.length} items`;
    }

    if (activeSection === "Playlists") {
      return language === "fa"
        ? `${playlists.length + 2} پلی‌لیست • ${formatSongCount(likedSongs.length)}`
        : `${playlists.length + 2} playlists • ${formatSongCount(
            likedSongs.length
          )}`;
    }

    if (activeSection === "Artists") {
      return language === "fa"
        ? `${activeItems.length} هنرمند`
        : `${activeItems.length} artists`;
    }

    return `${activeItems.length} ${copy.items}`;
  }, [
    activeItems.length,
    activeSection,
    copy.items,
    copy.results,
    displayedItems.length,
    formatSongCount,
    language,
    libraryQuery,
    likedSongs.length,
    playlists.length,
  ]);

  const renderArtwork = React.useCallback(
    (item: LibraryDisplayItem, size: number | "full") => {
      const borderRadius =
        item.imageShape === "circle" ? 999 : viewMode === "list" ? 12 : 14;
      const isFullWidth = size === "full";
      const iconSize = Math.max(
        26,
        Math.round((typeof size === "number" ? size : 160) * 0.34)
      );
      const boxStyle = {
        width: isFullWidth ? "100%" : size,
        height: isFullWidth ? undefined : size,
        aspectRatio: 1 as const,
        borderRadius,
        overflow: "hidden" as const,
        backgroundColor: colors.surface2,
      };

      const fallback = (
        <LinearGradient
          colors={
            item.artworkKind === "liked"
              ? [colors.accent, colors.heroMid, colors.heroEnd]
              : item.artworkKind === "artist"
                ? [colors.surface1, colors.surface2, colors.surface3]
                : item.artworkKind === "playlist"
                  ? [colors.accent, colors.heroMid, colors.heroEnd]
                  : ["#1a1a1a", "#404040", "#525252"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            boxStyle,
            {
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          {item.artworkKind === "playlist" ? (
            <Ionicons
              name="folder-open-outline"
              size={iconSize}
              color={colors.accentContrast}
            />
          ) : item.artworkKind === "artist" ? (
            <Ionicons
              name="person-outline"
              size={iconSize}
              color={colors.foreground}
            />
          ) : (
            <Entypo
              name={
                item.artworkKind === "liked"
                  ? "heart"
                  : item.artworkKind === "history"
                    ? "back-in-time"
                    : "music"
              }
              size={iconSize}
              color="white"
            />
          )}
        </LinearGradient>
      );

      const baseContent =
        item.artworkKind === "image" &&
        sanitizeImageUrl(item.imageUri || "") ? (
          <Image
            source={{ uri: sanitizeImageUrl(item.imageUri || "") }}
            style={boxStyle}
          />
        ) : (
          fallback
        );

      if (item.progress === undefined) {
        return baseContent;
      }

      return (
        <View style={boxStyle}>
          {baseContent}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: `${item.progress}%`,
              backgroundColor: "rgba(0, 0, 0, 0.55)",
            }}
          />
        </View>
      );
    },
    [
      colors.accent,
      colors.accentContrast,
      colors.foreground,
      colors.heroEnd,
      colors.heroMid,
      colors.surface1,
      colors.surface2,
      colors.surface3,
      viewMode,
    ]
  );

  return (
    <UiScreen padded={false}>
      <LibraryShell style={{ backgroundColor: colors.background }}>
        <Header style={{ paddingBottom: 12 }}>
          <HeaderLeft style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
            <HeaderTitle
              style={{
                color: colors.foreground,
                fontFamily: getAppFontFamily(isRtl, "bold"),
                ...getTextDirectionStyle(isRtl),
              }}
            >
              {copy.libraryTitle}
            </HeaderTitle>
          </HeaderLeft>
          <HeaderActions
            style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
          >
            {user ? (
              <HeaderIconButton
                disabled={isSyncing}
                onPress={() => {
                  void handleSyncLibrary();
                }}
                style={{
                  marginLeft: isRtl ? 0 : 8,
                  marginRight: isRtl ? 8 : 0,
                  opacity: isSyncing ? 0.6 : 1,
                }}
              >
                <HeaderIconText>
                  <Ionicons
                    name="sync-outline"
                    size={20}
                    color={colors.foreground}
                  />
                </HeaderIconText>
              </HeaderIconButton>
            ) : null}
            <HeaderIconButton
              onPress={() => setShowCreatePlaylistModal(true)}
              style={{ marginLeft: isRtl ? 0 : 8, marginRight: isRtl ? 8 : 0 }}
            >
              <HeaderIconText>
                <FontAwesome6 name="add" size={20} color={colors.foreground} />
              </HeaderIconText>
            </HeaderIconButton>
            <HeaderIconButton
              style={{ marginLeft: isRtl ? 0 : 8, marginRight: isRtl ? 8 : 0 }}
              onPress={() =>
                setViewMode((current) => (current === "grid" ? "list" : "grid"))
              }
            >
              <HeaderIconText>
                <AntDesign
                  name={viewMode === "grid" ? "unordered-list" : "appstore"}
                  size={18}
                  color={colors.foreground}
                />
              </HeaderIconText>
            </HeaderIconButton>
            <HeaderIconButton
              onPress={() => navigation.navigate("Settings")}
              style={{ marginLeft: isRtl ? 0 : 8, marginRight: isRtl ? 8 : 0 }}
            >
              <HeaderIconText>
                <FontAwesome6 name="gear" size={20} color={colors.foreground} />
              </HeaderIconText>
            </HeaderIconButton>
          </HeaderActions>
        </Header>

        <FilterChipsRow
          horizontal
          showsHorizontalScrollIndicator={false}
          style={isRtl ? { transform: [{ scaleX: -1 }] } : undefined}
          contentContainerStyle={{
            flexDirection: isRtl ? "row-reverse" : "row",
            paddingLeft: 16,
            paddingRight: 16,
          }}
        >
          {sections.map((label) => {
            const isActive = label === activeSection;
            return (
              <UiChip
                key={label}
                label={sectionLabels[label]}
                selected={isActive}
                onPress={() =>
                  setActiveSection((current) =>
                    current === label ? null : label
                  )
                }
                chipStyle={{
                  marginRight: isRtl ? 0 : 8,
                  marginLeft: isRtl ? 8 : 0,
                  minHeight: 32,
                  paddingHorizontal: 16,
                  backgroundColor: isActive ? colors.surface3 : colors.surface2,
                }}
                style={isRtl ? { transform: [{ scaleX: -1 }] } : undefined}
                selectedBackgroundColor={colors.surface3}
                selectedBorderColor={colors.borderSubtle}
                selectedTextColor={colors.foreground}
                unselectedTextColor={colors.foreground}
                textStyle={{
                  fontSize: 13,
                  lineHeight: 13,
                  fontFamily: getAppFontFamily(
                    isRtl,
                    isActive ? "bold" : "medium"
                  ),
                }}
              />
            );
          })}
        </FilterChipsRow>

        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <View
            style={{
              flexDirection: isRtl ? "row-reverse" : "row",
              alignItems: "center",
            }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: isRtl ? "row-reverse" : "row",
                alignItems: "center",
                minHeight: 44,
                paddingHorizontal: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                backgroundColor: colors.surface1,
              }}
            >
              <Fontisto
                name="search"
                size={14}
                color={withOpacity(colors.foreground, 0.62)}
              />
              <TextInput
                value={libraryQuery}
                onChangeText={setLibraryQuery}
                placeholder={copy.searchInLibrary}
                placeholderTextColor={withOpacity(colors.foreground, 0.48)}
                style={{
                  flex: 1,
                  color: colors.foreground,
                  marginLeft: isRtl ? 0 : 10,
                  marginRight: isRtl ? 10 : 0,
                  fontFamily: getAppFontFamily(isRtl, "regular"),
                  ...getTextDirectionStyle(isRtl),
                }}
              />
              {libraryQuery.length > 0 ? (
                <TouchableOpacity onPress={() => setLibraryQuery("")}>
                  <AntDesign
                    name="close"
                    size={16}
                    color={withOpacity(colors.foreground, 0.58)}
                  />
                </TouchableOpacity>
              ) : null}
            </View>

            <TouchableOpacity
              onPress={cycleSortMode}
              activeOpacity={0.85}
              style={{
                flexDirection: isRtl ? "row-reverse" : "row",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                paddingHorizontal: 14,
                marginLeft: isRtl ? 0 : 10,
                marginRight: isRtl ? 10 : 0,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                backgroundColor: colors.surface1,
              }}
            >
              {showSortIcon ? (
                <AntDesign
                  name="swap"
                  size={14}
                  color={withOpacity(colors.foreground, 0.85)}
                />
              ) : null}
              <SortLabel
                style={{
                  color: colors.foreground,
                  marginLeft: showSortIcon && !isRtl ? 8 : 0,
                  marginRight: showSortIcon && isRtl ? 8 : 0,
                  fontFamily: getAppFontFamily(isRtl, "regular"),
                  ...getTextDirectionStyle(isRtl),
                }}
              >
                {sortLabel}
              </SortLabel>
            </TouchableOpacity>
          </View>

          <View
            style={{
              flexDirection: isRtl ? "row-reverse" : "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 12,
            }}
          >
            <MutedText
              style={{
                fontSize: 12,
                lineHeight: 16,
                textTransform: "uppercase",
                letterSpacing: 1.2,
              }}
            >
              {librarySummary}
            </MutedText>
            <MutedText
              style={{
                fontSize: 12,
                lineHeight: 16,
                textTransform: "uppercase",
                letterSpacing: 1.2,
              }}
            >
              {viewMode === "grid" ? copy.gridView : copy.listView}
            </MutedText>
          </View>
          {syncFeedback ? (
            <MutedText
              style={{
                marginTop: 10,
                fontSize: 12,
                lineHeight: 16,
                color: withOpacity(colors.foreground, 0.78),
                ...getTextDirectionStyle(isRtl),
              }}
            >
              {syncFeedback}
            </MutedText>
          ) : null}
        </View>

        <Grid
          contentContainerStyle={{
            paddingBottom: 156,
            paddingHorizontal: viewMode === "grid" ? 16 : 0,
          }}
        >
          {displayedItems.length === 0 ? (
            <View
              style={{
                marginHorizontal: 16,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: colors.borderSubtle,
                backgroundColor: colors.surface1,
                padding: 18,
              }}
            >
              <MutedText style={{ textAlign: "center" }}>
                {activeSection === "Downloading"
                  ? copy.downloadingEmpty
                  : activeSection === "Artists"
                    ? copy.artistsEmpty
                    : activeSection === "Downloaded"
                      ? copy.downloadedEmpty
                      : activeSection === null
                        ? copy.playlistsEmpty
                        : copy.playlistsEmpty}
              </MutedText>
            </View>
          ) : viewMode === "list" ? (
            <View style={{ paddingHorizontal: 16 }}>
              {displayedItems.map((item, index) => (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.88}
                  onPress={item.onPress}
                  onLongPress={item.onLongPress}
                  style={{
                    flexDirection: isRtl ? "row-reverse" : "row",
                    alignItems: "center",
                    padding: 12,
                    marginBottom: index === displayedItems.length - 1 ? 0 : 10,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: colors.borderSubtle,
                    backgroundColor: colors.surface1,
                  }}
                >
                  {renderArtwork(item, 68)}
                  <View
                    style={{
                      flex: 1,
                      marginLeft: isRtl ? 0 : 12,
                      marginRight: isRtl ? 12 : 0,
                    }}
                  >
                    <CollectionTitle
                      numberOfLines={1}
                      style={{
                        marginTop: 0,
                        color: colors.foreground,
                        fontFamily: getAppFontFamily(isRtl, "semibold"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {item.title}
                    </CollectionTitle>
                    <CollectionMeta
                      numberOfLines={1}
                      style={{
                        color: withOpacity(colors.foreground, 0.76),
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {item.subtitle}
                    </CollectionMeta>
                    <CollectionMeta
                      numberOfLines={1}
                      style={{
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {item.meta}
                    </CollectionMeta>
                  </View>
                  {item.onSecondaryAction ? (
                    <TouchableOpacity
                      onPress={item.onSecondaryAction}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: colors.surface2,
                        borderWidth: 1,
                        borderColor: colors.borderSubtle,
                      }}
                    >
                      <CollectionMeta
                        style={{
                          marginTop: 0,
                          color: colors.foreground,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {item.secondaryActionLabel}
                      </CollectionMeta>
                    </TouchableOpacity>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            Array.from({
              length: Math.ceil(displayedItems.length / 2),
            }).map((_, rowIndex) => {
              const rowItems = displayedItems.slice(
                rowIndex * 2,
                (rowIndex + 1) * 2
              );

              return (
                <GridRow
                  key={`row-${rowIndex}`}
                  style={{
                    flexDirection: isRtl ? "row-reverse" : "row",
                    justifyContent: "space-between",
                    marginHorizontal: 0,
                  }}
                >
                  {rowItems.map((item) => (
                    <CollectionCard
                      key={item.id}
                      activeOpacity={0.88}
                      onPress={item.onPress}
                      onLongPress={item.onLongPress}
                      style={{ width: "48%", paddingHorizontal: 0 }}
                    >
                      <View
                        style={{
                          position: "relative",
                          borderRadius: 14,
                          overflow: "hidden",
                        }}
                      >
                        {renderArtwork(item, "full")}
                        {item.onSecondaryAction ? (
                          <TouchableOpacity
                            onPress={item.onSecondaryAction}
                            style={{
                              position: "absolute",
                              right: isRtl ? undefined : 10,
                              left: isRtl ? 10 : undefined,
                              bottom: 10,
                              paddingHorizontal: 10,
                              paddingVertical: 7,
                              borderRadius: 999,
                              backgroundColor: "rgba(0, 0, 0, 0.72)",
                              borderWidth: 1,
                              borderColor: "rgba(255, 255, 255, 0.14)",
                            }}
                          >
                            <StopCachingText>
                              {item.secondaryActionLabel}
                            </StopCachingText>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <CollectionTitle
                        numberOfLines={2}
                        style={{
                          color: colors.foreground,
                          fontFamily: getAppFontFamily(isRtl, "semibold"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {item.title}
                      </CollectionTitle>
                      <CollectionMeta
                        numberOfLines={1}
                        style={{
                          color: withOpacity(colors.foreground, 0.66),
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {item.subtitle}
                      </CollectionMeta>
                      <CollectionMeta
                        numberOfLines={1}
                        style={{
                          color: withOpacity(colors.foreground, 0.66),
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        }}
                      >
                        {item.meta}
                      </CollectionMeta>
                    </CollectionCard>
                  ))}
                  {rowItems.length === 1 ? (
                    <View style={{ width: "48%" }} />
                  ) : null}
                </GridRow>
              );
            })
          )}
        </Grid>

        <PlaylistCreateModal
          visible={showCreatePlaylistModal}
          name={newPlaylistName}
          description={newPlaylistDescription}
          onNameChange={setNewPlaylistName}
          onDescriptionChange={setNewPlaylistDescription}
          onClose={() => {
            setShowCreatePlaylistModal(false);
            setNewPlaylistName("");
            setNewPlaylistDescription("");
          }}
          onSubmit={handleCreatePlaylist}
          title={copy.createPlaylist}
          subtitle={copy.createPlaylistDescription}
          submitLabel={t("common.create")}
        />

        <SliderSheet
          visible={showSongActionSheet}
          onClose={closeSongActionSheet}
          sheetTop={sheetTop}
          sheetHeight={sheetHeight}
          panHandlers={panResponder.panHandlers}
          currentTrack={
            selectedTrack || { title: "", artist: "", thumbnail: "" }
          }
          options={[
            {
              key: "Share",
              label: copy.share,
              icon: "share-outline",
            },
            {
              key: "Add to other playlist",
              label: copy.addToPlaylist,
              icon: "add-circle-outline",
            },
            {
              key: "Go to album",
              label: copy.goToAlbum,
              icon: "albums-outline",
            },
            {
              key: "Go to artists",
              label: copy.goToArtists,
              icon: "people-outline",
            },
            {
              key: "Sleep timer",
              label: copy.sleepTimer,
              icon: "time-outline",
            },
            {
              key: "Go to song radio",
              label: copy.songRadio,
              icon: "radio-outline",
            },
          ]}
          onOptionPress={(option) => {
            console.log("Song action:", option);
            closeSongActionSheet();
          }}
        />
      </LibraryShell>
    </UiScreen>
  );
}
