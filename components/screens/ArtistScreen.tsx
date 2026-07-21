import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer } from "../../contexts/PlayerContext";
import { Screen } from "../ui/Screen";
import { BodyText, MutedText, TitleText } from "../ui/Text";
import { ImageWithSkeleton } from "../ui/ImageWithSkeleton";
import { SkeletonLoader } from "../SkeletonLoader";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../../utils/fonts";
import { fetchWithRetry } from "../core/api";
import {
  buildProviderUrlCandidates,
  getProviderEndpoints,
} from "../../lib/provider-endpoints";

const HEADER_HEIGHT = 330;
const MAX_VISIBLE_SONGS = 20;
const HEADER_TOP_RESERVED_SPACE = 84;
const ABSOLUTE_FILL = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

interface ArtistScreenProps {
  navigation: any;
  route: any;
}

type ArtistSource = "youtube" | "jiosaavn";

interface Artist {
  id: string;
  name: string;
  image: string;
  banner?: string;
  monthlyListeners?: number;
  verified?: boolean;
  description?: string;
  source?: ArtistSource;
  url?: string;
}

interface Song {
  id: string;
  title: string;
  thumbnail: string;
  playCount: number;
  duration?: number;
  artist?: string;
  url?: string;
  source?: ArtistSource;
  _isJioSaavn?: boolean;
}

interface CollectionItem {
  id: string;
  title: string;
  year?: string;
  thumbnail: string;
  videoCount?: number;
  songCount?: number;
  url?: string;
  type: "album" | "playlist";
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^0-9-]/g, ""), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function toRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function toArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeYouTubeChannelId(value: string): string {
  const rawValue = value.trim();
  if (!rawValue) {
    return "";
  }

  if (/^https?:\/\//i.test(rawValue)) {
    try {
      const parsed = new URL(rawValue);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments[0] === "channel" && segments[1]) {
        return segments[1];
      }
    } catch {}
  }

  const normalized = rawValue.replace(/^\/+/, "");
  const channelMatch = normalized.match(/^channel\/([^/?#]+)/i);
  if (channelMatch?.[1]) {
    return channelMatch[1];
  }

  return normalized;
}

function isYouTubeChannelId(id: string): boolean {
  return id.startsWith("UC") || id.startsWith("U") || id.length === 24;
}

function absolutizeUrl(url: string, base: string): string {
  if (!url) {
    return "";
  }
  if (url.startsWith("https://") || url.startsWith("http://")) {
    return url;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  if (url.startsWith("/")) {
    return `${base}${url}`;
  }
  return url;
}

function pickBestImageUrl(arr: unknown, base: string): string {
  const entries = toArray<Record<string, unknown>>(arr);
  if (entries.length === 0) {
    return "";
  }

  const sorted = [...entries].sort(
    (left, right) => safeNumber(right.width) - safeNumber(left.width),
  );
  return absolutizeUrl(safeString(sorted[0]?.url), base);
}

function qualityScore(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const match = value.match(/(\d+)/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return 0;
}

function pickJioSaavnImage(arr: unknown): string {
  const entries = toArray<Record<string, unknown>>(arr);
  if (entries.length === 0) {
    return "";
  }

  const sorted = [...entries].sort(
    (left, right) =>
      qualityScore(right.quality || right.size) -
      qualityScore(left.quality || left.size),
  );

  for (const image of sorted) {
    const url = safeString(image.url || image.link);
    if (url) {
      return url;
    }
  }

  return "";
}

function pickJioSaavnArtistNames(value: unknown): string {
  const artists = toRecord(value);
  const candidateGroups = [artists.primary, artists.featured, artists.all];

  for (const group of candidateGroups) {
    const names = toArray<Record<string, unknown>>(group)
      .map((entry) => safeString(entry.name))
      .filter(Boolean);

    if (names.length > 0) {
      return names.join(", ");
    }
  }

  return "";
}

function isAutoGeneratedAlbumPlaylistId(playlistId: string): boolean {
  return playlistId.startsWith("OLAK5uy") || playlistId.startsWith("MPREb_");
}

function shortenDescription(value?: string, maxLength = 220): string {
  const normalized = value?.replace(/\s+/g, " ").trim() || "";
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  const safeText =
    lastSpaceIndex > Math.floor(maxLength * 0.6)
      ? truncated.slice(0, lastSpaceIndex)
      : truncated;

  return `${safeText.trimEnd()}...`;
}

function ArtistScreenSkeleton({
  colors,
  insets,
  isRtl,
  onBack,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  insets: ReturnType<typeof useSafeAreaInsets>;
  isRtl: boolean;
  onBack: () => void;
}) {
  const titleSpacing = isRtl
    ? { marginRight: 10, marginLeft: 0 }
    : { marginLeft: 10, marginRight: 0 };
  const chipSpacing = isRtl
    ? { marginLeft: 8, marginRight: 0 }
    : { marginLeft: 0, marginRight: 8 };

  return (
    <Screen padded={false} safeEdges={["left", "right"]}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.headerSection}>
            <SkeletonLoader
              style={[styles.headerImage, { width: "100%", height: "100%" }]}
            />
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onBack}
              style={[
                styles.backButton,
                {
                  top: insets.top + 12,
                  left: 16,
                  right: undefined,
                  backgroundColor: withOpacity(colors.background, 0.48),
                },
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={colors.foreground}
              />
            </TouchableOpacity>
            <View
              style={[
                styles.headerContent,
                { top: insets.top + HEADER_TOP_RESERVED_SPACE },
              ]}
            >
              <View
                style={[
                  styles.headerBadgeRow,
                  { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                <SkeletonLoader
                  width={72}
                  height={28}
                  style={[{ borderRadius: 999 }, chipSpacing]}
                />
                <SkeletonLoader
                  width={88}
                  height={28}
                  style={{ borderRadius: 999 }}
                />
              </View>
              <View
                style={[
                  styles.artistTitleRow,
                  { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                <SkeletonLoader
                  width={72}
                  height={72}
                  style={{ borderRadius: 999 }}
                />
                <View style={[styles.artistName, titleSpacing]}>
                  <View
                    style={{ alignItems: isRtl ? "flex-end" : "flex-start" }}
                  >
                    <SkeletonLoader
                      height={34}
                      style={{
                        width: "72%",
                        borderRadius: 12,
                        marginBottom: 10,
                      }}
                    />
                    <SkeletonLoader
                      height={24}
                      style={{ width: "48%", borderRadius: 10 }}
                    />
                  </View>
                </View>
              </View>
              <View
                style={[
                  styles.metaChipRow,
                  { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                <SkeletonLoader
                  width={124}
                  height={30}
                  style={[{ borderRadius: 999 }, chipSpacing]}
                />
                <SkeletonLoader
                  width={92}
                  height={30}
                  style={[{ borderRadius: 999 }, chipSpacing]}
                />
                <SkeletonLoader
                  width={84}
                  height={30}
                  style={{ borderRadius: 999 }}
                />
              </View>
              <SkeletonLoader
                height={18}
                style={{
                  width: "88%",
                  borderRadius: 8,
                  marginTop: 8,
                  alignSelf: isRtl ? "flex-end" : "flex-start",
                }}
              />
              <SkeletonLoader
                height={18}
                style={{
                  width: "74%",
                  borderRadius: 8,
                  marginTop: 8,
                  alignSelf: isRtl ? "flex-end" : "flex-start",
                }}
              />
            </View>
          </View>

          <View
            style={[
              styles.contentContainer,
              { backgroundColor: colors.background },
            ]}
          >
            <View
              style={[
                styles.actionsRow,
                { flexDirection: isRtl ? "row-reverse" : "row" },
              ]}
            >
              <SkeletonLoader
                width={120}
                height={48}
                style={{ borderRadius: 999 }}
              />
              <SkeletonLoader
                width={48}
                height={48}
                style={{
                  borderRadius: 999,
                  marginLeft: isRtl ? 0 : 12,
                  marginRight: isRtl ? 12 : 0,
                }}
              />
            </View>
            <View
              style={[
                styles.mainCard,
                {
                  backgroundColor: colors.surface1,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <SkeletonLoader
                height={220}
                style={{ width: "100%", borderRadius: 0 }}
              />
              <View style={styles.sectionBlock}>
                <SkeletonLoader
                  width={148}
                  height={28}
                  style={{
                    borderRadius: 10,
                    marginBottom: 14,
                    alignSelf: isRtl ? "flex-end" : "flex-start",
                  }}
                />
                {Array.from({ length: 4 }, (_, index) => (
                  <View
                    key={`artist-song-skeleton-${index}`}
                    style={[
                      styles.songRow,
                      {
                        backgroundColor: colors.surface2,
                        borderColor: colors.borderSubtle,
                        flexDirection: isRtl ? "row-reverse" : "row",
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.trackIndexWrap,
                        {
                          marginRight: isRtl ? 0 : 14,
                          marginLeft: isRtl ? 14 : 0,
                        },
                      ]}
                    >
                      <SkeletonLoader
                        width={16}
                        height={18}
                        style={{ borderRadius: 6 }}
                      />
                    </View>
                    <SkeletonLoader
                      width={56}
                      height={56}
                      style={{
                        borderRadius: 14,
                        marginRight: isRtl ? 0 : 14,
                        marginLeft: isRtl ? 14 : 0,
                      }}
                    />
                    <View
                      style={[
                        styles.songMeta,
                        { alignItems: isRtl ? "flex-end" : "flex-start" },
                      ]}
                    >
                      <SkeletonLoader
                        height={20}
                        style={{
                          width: "82%",
                          borderRadius: 8,
                          marginBottom: 8,
                        }}
                      />
                      <SkeletonLoader
                        height={18}
                        style={{ width: "58%", borderRadius: 8 }}
                      />
                    </View>
                    <View
                      style={[
                        styles.songEndMeta,
                        { alignItems: isRtl ? "flex-start" : "flex-end" },
                      ]}
                    >
                      <SkeletonLoader
                        width={52}
                        height={16}
                        style={{ borderRadius: 7 }}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}

const ArtistScreen: React.FC<ArtistScreenProps> = ({ navigation, route }) => {
  const { colors, isLight } = useTheme();
  const { t, isRtl } = useAppLanguage();
  const { playTrack } = usePlayer();
  const insets = useSafeAreaInsets();
  const [artistData, setArtistData] = useState<Artist | null>(null);
  const [popularSongs, setPopularSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<CollectionItem[]>([]);
  const [playlists, setPlaylists] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    artistId,
    artistName,
    artistImage,
    source: routeSource,
  } = route.params || {};

  const normalizedArtistId = useMemo(
    () => normalizeYouTubeChannelId(String(artistId || "")),
    [artistId],
  );
  const resolvedSource = useMemo<ArtistSource>(() => {
    if (routeSource === "jiosaavn") {
      return "jiosaavn";
    }
    return isYouTubeChannelId(normalizedArtistId) ? "youtube" : "jiosaavn";
  }, [normalizedArtistId, routeSource]);
  const isYouTubeChannel = resolvedSource === "youtube";

  const artistNameFontSize = useMemo(() => {
    const name = artistData?.name || artistName || "";
    if (name.length <= 14) {
      return 42;
    }
    if (name.length <= 22) {
      return 34;
    }
    return 28;
  }, [artistData?.name, artistName]);

  const formatCompactNumber = useCallback((count: number) => {
    if (count >= 1000000000) {
      return `${(count / 1000000000).toFixed(1).replace(".0", "")}B`;
    }
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1).replace(".0", "")}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1).replace(".0", "")}K`;
    }
    return String(count);
  }, []);

  const formatDuration = useCallback((duration?: number) => {
    if (!duration || Number.isNaN(duration)) {
      return "";
    }
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, []);
  const buildSongSubtitle = useCallback(
    (song: Song) => {
      const parts = [
        song.artist || artistData?.name || "",
        song.duration ? formatDuration(song.duration) : "",
      ].filter(Boolean);

      return parts.join(" · ");
    },
    [artistData?.name, formatDuration],
  );

  const fetchJsonFromCandidates = useCallback(async (urls: string[]) => {
    const errors: string[] = [];

    for (const url of urls) {
      try {
        return await fetchWithRetry<any>(
          url,
          {
            headers: {
              Accept: "application/json",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          },
          2,
          350,
        );
      } catch (fetchError) {
        errors.push(
          fetchError instanceof Error ? fetchError.message : String(fetchError),
        );
      }
    }

    throw new Error(errors.join(" | ") || "All requests failed");
  }, []);

  const fetchFirstSuccessfulInvidiousJson = useCallback(
    async (buildUrl: (instance: string) => string) => {
      const providerEndpoints = await getProviderEndpoints();
      const errors: string[] = [];

      for (const instance of providerEndpoints.instances.invidious) {
        try {
          const payload = await fetchWithRetry<any>(
            buildUrl(instance),
            {
              headers: {
                Accept: "application/json",
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            },
            2,
            350,
          );
          return { payload, base: instance, providerEndpoints };
        } catch (fetchError) {
          errors.push(
            fetchError instanceof Error
              ? fetchError.message
              : String(fetchError),
          );
        }
      }

      throw new Error(errors.join(" | ") || "All Invidious requests failed");
    },
    [],
  );

  const fetchArtistData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (resolvedSource === "youtube") {
        const channelId = normalizedArtistId || String(artistId || "");
        if (!channelId) {
          throw new Error("Missing channel id");
        }

        const [channelResult, videosResult, playlistsResult] =
          await Promise.all([
            fetchFirstSuccessfulInvidiousJson(
              (instance) =>
                `${instance}/api/v1/channels/${encodeURIComponent(channelId)}`,
            ).catch(() => null),
            fetchFirstSuccessfulInvidiousJson(
              (instance) =>
                `${instance}/api/v1/channels/${encodeURIComponent(channelId)}/videos`,
            ).catch(() => null),
            fetchFirstSuccessfulInvidiousJson(
              (instance) =>
                `${instance}/api/v1/channels/${encodeURIComponent(channelId)}/playlists`,
            ).catch(() => null),
          ]);

        const providerEndpoints =
          channelResult?.providerEndpoints ||
          videosResult?.providerEndpoints ||
          playlistsResult?.providerEndpoints ||
          (await getProviderEndpoints());
        const invidiousBase =
          channelResult?.base ||
          videosResult?.base ||
          playlistsResult?.base ||
          providerEndpoints.instances.invidious[0] ||
          "";

        const invidiousChannel = toRecord(channelResult?.payload);
        const latestVideos = toArray<Record<string, unknown>>(
          invidiousChannel.latestVideos,
        );
        const videosFallback = Array.isArray(videosResult?.payload)
          ? (videosResult?.payload as Array<Record<string, unknown>>)
          : toArray<Record<string, unknown>>(
              toRecord(videosResult?.payload).videos,
            );
        const videosToUse =
          latestVideos.length > 0 ? latestVideos : videosFallback;

        if (!Object.keys(invidiousChannel).length && videosToUse.length === 0) {
          throw new Error("Failed to load artist");
        }

        const youtubeWebBase = providerEndpoints.providers.youtube.webBase;
        const name =
          safeString(invidiousChannel.author || invidiousChannel.name)
            .replace(/\s*-\s*Topic$/i, "")
            .trim() ||
          safeString(videosToUse[0]?.author)
            .replace(/\s*-\s*Topic$/i, "")
            .trim() ||
          String(artistName || "Artist");

        const nextArtist: Artist = {
          id: channelId,
          name,
          image:
            pickBestImageUrl(
              invidiousChannel.authorThumbnails,
              invidiousBase,
            ) || String(artistImage || ""),
          banner:
            pickBestImageUrl(invidiousChannel.authorBanners, invidiousBase) ||
            pickBestImageUrl(
              invidiousChannel.authorThumbnails,
              invidiousBase,
            ) ||
            String(artistImage || ""),
          monthlyListeners: safeNumber(invidiousChannel.subCount),
          verified: Boolean(invidiousChannel.verified),
          description: safeString(invidiousChannel.description),
          source: "youtube",
          url: `${youtubeWebBase}/channel/${encodeURIComponent(channelId)}`,
        };

        const nextSongs: Song[] = videosToUse
          .map((video, index) => ({
            id:
              safeString(video.videoId) ||
              safeString(video.id) ||
              `video_${index}`,
            title: safeString(video.title) || t("screens.artist.unknown_title"),
            thumbnail:
              pickBestImageUrl(video.videoThumbnails, invidiousBase) ||
              safeString(video.thumbnail),
            playCount: safeNumber(video.viewCount),
            duration: safeNumber(video.lengthSeconds),
            artist: name,
            url: safeString(video.url),
            source: "youtube" as const,
            _isJioSaavn: false,
          }))
          .filter((song) => song.id);

        const playlistEntries = Array.isArray(playlistsResult?.payload)
          ? (playlistsResult?.payload as Array<Record<string, unknown>>)
          : toArray<Record<string, unknown>>(
              toRecord(playlistsResult?.payload).playlists,
            );

        const nextAlbums: CollectionItem[] = [];
        const nextPlaylists: CollectionItem[] = [];

        for (const playlist of playlistEntries) {
          const playlistId =
            safeString(playlist.playlistId) || safeString(playlist.id);
          if (!playlistId) {
            continue;
          }

          const normalizedItem: CollectionItem = {
            id: playlistId,
            title:
              safeString(playlist.title) ||
              t("screens.artist.unknown_playlist"),
            thumbnail: absolutizeUrl(
              safeString(playlist.playlistThumbnail),
              invidiousBase,
            ),
            videoCount: safeNumber(playlist.videoCount),
            type: isAutoGeneratedAlbumPlaylistId(playlistId)
              ? "album"
              : "playlist",
          };

          if (normalizedItem.type === "album") {
            nextAlbums.push(normalizedItem);
          } else {
            nextPlaylists.push(normalizedItem);
          }
        }

        setArtistData(nextArtist);
        setPopularSongs(nextSongs);
        setAlbums(nextAlbums);
        setPlaylists(nextPlaylists);
        return;
      }

      const providerEndpoints = await getProviderEndpoints();
      const jiosaavnApiBase = providerEndpoints.providers.jiosaavn.apiBase;
      const [artistPayload, songsPayload, albumsPayload] = await Promise.all([
        fetchJsonFromCandidates(
          buildProviderUrlCandidates(jiosaavnApiBase, [
            `/api/artists/${encodeURIComponent(String(artistId || ""))}`,
            `/artists/${encodeURIComponent(String(artistId || ""))}`,
          ]),
        ),
        fetchJsonFromCandidates(
          buildProviderUrlCandidates(jiosaavnApiBase, [
            `/api/artists/${encodeURIComponent(String(artistId || ""))}/songs`,
            `/artists/${encodeURIComponent(String(artistId || ""))}/songs`,
          ]),
        ).catch(() => null),
        fetchJsonFromCandidates(
          buildProviderUrlCandidates(jiosaavnApiBase, [
            `/api/artists/${encodeURIComponent(String(artistId || ""))}/albums`,
            `/artists/${encodeURIComponent(String(artistId || ""))}/albums`,
          ]),
        ).catch(() => null),
      ]);

      const artistEnvelope = toRecord(artistPayload);
      const artistCore =
        toRecord(artistEnvelope.data).name || toRecord(artistEnvelope.data).id
          ? toRecord(artistEnvelope.data)
          : artistEnvelope;
      const songsEnvelope = toRecord(songsPayload);
      const songsData = toRecord(songsEnvelope.data);
      const albumsEnvelope = toRecord(albumsPayload);
      const albumsData = toRecord(albumsEnvelope.data);

      const topSongs = toArray(artistCore.topSongs);
      const songsFromEndpoint = toArray(songsData.songs);
      const songsArray =
        songsFromEndpoint.length > 0
          ? songsFromEndpoint
          : Array.isArray(songsEnvelope.data)
            ? (songsEnvelope.data as any[])
            : topSongs;
      const albumsArray =
        toArray(albumsData.albums).length > 0
          ? toArray(albumsData.albums)
          : Array.isArray(albumsEnvelope.data)
            ? (albumsEnvelope.data as any[])
            : toArray(albumsEnvelope.albums);

      const nextArtist: Artist = {
        id: safeString(artistCore.id) || String(artistId || ""),
        name:
          safeString(artistCore.name)
            .replace(/\s*-\s*Topic$/i, "")
            .trim() || String(artistName || "Artist"),
        image: String(artistImage || "") || pickJioSaavnImage(artistCore.image),
        banner:
          pickJioSaavnImage(artistCore.image) ||
          String(artistImage || "") ||
          pickJioSaavnImage(songsArray[0] && toRecord(songsArray[0]).image),
        monthlyListeners:
          safeNumber(artistCore.followerCount) ||
          safeNumber(artistCore.fanCount),
        verified: Boolean(artistCore.isVerified),
        description:
          safeString(artistCore.dominantType) ||
          toArray(artistCore.bio)
            .map((entry) => safeString(toRecord(entry).text || entry))
            .filter(Boolean)
            .join(" "),
        source: "jiosaavn",
        url: safeString(artistCore.url),
      };

      const nextSongs: Song[] = songsArray
        .map((song, index) => {
          const record = toRecord(song);
          return {
            id:
              safeString(
                record.id || record.songId || record.songid || record.url,
              ) || `song_${index}`,
            title:
              safeString(record.title || record.name || record.song) ||
              t("screens.artist.unknown_title"),
            thumbnail:
              pickJioSaavnImage(record.image) || safeString(record.thumbnail),
            playCount:
              safeNumber(record.playCount) || safeNumber(record.playcount),
            duration: safeNumber(record.duration),
            artist: pickJioSaavnArtistNames(record.artists) || nextArtist.name,
            url: safeString(record.url),
            source: "jiosaavn" as const,
            _isJioSaavn: true,
          };
        })
        .filter((song) => song.id);

      const nextAlbums: CollectionItem[] = albumsArray
        .map((album, index) => {
          const record = toRecord(album);
          return {
            id:
              safeString(record.id || record.albumId || record.url) ||
              `album_${index}`,
            title:
              safeString(record.title || record.name) ||
              t("screens.artist.unknown_album"),
            year: safeString(record.year || record.releaseYear),
            thumbnail:
              pickJioSaavnImage(record.image) || safeString(record.thumbnail),
            videoCount: safeNumber(record.songCount),
            songCount: safeNumber(record.songCount),
            url: safeString(record.url),
            type: "album" as const,
          };
        })
        .filter((album) => album.id);

      setArtistData(nextArtist);
      setPopularSongs(nextSongs);
      setAlbums(nextAlbums);
      setPlaylists([]);
    } catch (fetchError) {
      console.error("Error fetching artist data:", fetchError);
      setError(t("screens.artist.load_error"));
      setArtistData(null);
      setPopularSongs([]);
      setAlbums([]);
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, [
    artistId,
    artistImage,
    artistName,
    fetchFirstSuccessfulInvidiousJson,
    fetchJsonFromCandidates,
    normalizedArtistId,
    resolvedSource,
    t,
  ]);

  useEffect(() => {
    void fetchArtistData();
  }, [fetchArtistData]);

  const visibleSongs = useMemo(
    () => popularSongs.slice(0, MAX_VISIBLE_SONGS),
    [popularSongs],
  );

  const featuredSong = useMemo(() => {
    if (popularSongs.length === 0) {
      return null;
    }

    return popularSongs.reduce((best, song) =>
      song.playCount > best.playCount ? song : best,
    );
  }, [popularSongs]);

  const handlePlaySong = useCallback(
    (song: Song, index: number) => {
      const queue = popularSongs.map((item) => ({
        id: item.id,
        title: item.title,
        artist:
          item.artist || artistData?.name || t("screens.artist.unknown_artist"),
        artistId: artistData?.id,
        artistImage: artistData?.image || artistData?.banner || "",
        artistSource: artistData?.source || resolvedSource,
        thumbnail: item.thumbnail,
        duration: item.duration,
        audioUrl: item.url,
        source: item.source || resolvedSource,
        _isJioSaavn: item._isJioSaavn || item.source === "jiosaavn",
      }));

      const track = queue[index] || queue[0];
      if (!track) {
        return;
      }

      void playTrack(track, queue, Math.max(index, 0));
    },
    [artistData?.name, playTrack, popularSongs, resolvedSource, t],
  );

  const handlePlayAll = useCallback(() => {
    if (popularSongs.length > 0) {
      handlePlaySong(popularSongs[0], 0);
    }
  }, [handlePlaySong, popularSongs]);

  const handleShuffle = useCallback(() => {
    if (popularSongs.length > 0) {
      const randomIndex = Math.floor(Math.random() * popularSongs.length);
      handlePlaySong(popularSongs[randomIndex], randomIndex);
    }
  }, [handlePlaySong, popularSongs]);

  const openCollection = useCallback(
    (item: CollectionItem) => {
      navigation.navigate("AlbumPlaylist", {
        albumId: item.id,
        albumName: item.title,
        albumArtist: artistData?.name || t("screens.artist.unknown_artist"),
        source: item.type === "playlist" ? "youtube" : resolvedSource,
      });
    },
    [artistData?.name, navigation, resolvedSource, t],
  );

  const headerImage =
    artistData?.banner || artistData?.image || String(artistImage || "");
  const sourceLabel =
    artistData?.source === "jiosaavn" ? "JioSaavn" : "YouTube";
  const titleSpacing = isRtl
    ? { marginRight: 10, marginLeft: 0 }
    : { marginLeft: 10, marginRight: 0 };

  if (loading) {
    return (
      <ArtistScreenSkeleton
        colors={colors}
        insets={insets}
        isRtl={isRtl}
        onBack={() => navigation.goBack()}
      />
    );
  }

  if (error) {
    return (
      <Screen padded={false} safeEdges={["left", "right"]}>
        <View
          style={[
            styles.centeredState,
            styles.statePadding,
            { backgroundColor: colors.background },
          ]}
        >
          <BodyText style={styles.errorText}>{error}</BodyText>
          <TouchableOpacity
            onPress={() => {
              void fetchArtistData();
            }}
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
          >
            <TitleText
              style={[styles.retryButtonText, { color: colors.accentContrast }]}
            >
              {t("screens.artist.retry")}
            </TitleText>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  if (!artistData) {
    return (
      <Screen padded={false} safeEdges={["left", "right"]}>
        <View
          style={[
            styles.centeredState,
            styles.statePadding,
            { backgroundColor: colors.background },
          ]}
        >
          <BodyText style={styles.errorText}>
            {t("screens.artist.artist_not_found")}
          </BodyText>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
          >
            <TitleText
              style={[styles.retryButtonText, { color: colors.accentContrast }]}
            >
              {t("screens.artist.go_back")}
            </TitleText>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} safeEdges={["left", "right"]}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.headerSection}>
            {headerImage ? (
              <ImageWithSkeleton
                source={{ uri: headerImage }}
                resizeMode="cover"
                containerStyle={styles.headerImage}
              />
            ) : (
              <View
                style={[
                  styles.headerFallback,
                  { backgroundColor: colors.surface2 },
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={92}
                  color={colors.muted}
                />
              </View>
            )}
            <LinearGradient
              colors={[
                withOpacity("#000000", 0.08),
                withOpacity("#000000", 0.32),
                withOpacity(colors.background, 0.92),
                colors.background,
              ]}
              locations={[0, 0.4, 0.78, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={ABSOLUTE_FILL}
            />
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={[
                styles.backButton,
                {
                  top: insets.top + 12,
                  left: 16,
                  right: undefined,
                  backgroundColor: withOpacity(colors.background, 0.48),
                },
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={colors.foreground}
              />
            </TouchableOpacity>
            <View
              style={[
                styles.headerContent,
                { top: insets.top + HEADER_TOP_RESERVED_SPACE },
              ]}
            >
              <View
                style={[
                  styles.headerBadgeRow,
                  { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                <View
                  style={[
                    styles.headerBadge,
                    {
                      backgroundColor: withOpacity("#000000", 0.26),
                      borderColor: withOpacity("#ffffff", 0.14),
                    },
                  ]}
                >
                  <MutedText style={styles.headerBadgeText}>
                    {sourceLabel}
                  </MutedText>
                </View>
                {artistData.verified ? (
                  <View
                    style={[
                      styles.headerBadge,
                      {
                        backgroundColor: withOpacity(colors.accent, 0.2),
                        borderColor: withOpacity(colors.accent, 0.4),
                      },
                    ]}
                  >
                    <MaterialIcons
                      name="verified"
                      size={14}
                      color={colors.accent}
                      style={{
                        marginRight: isRtl ? 0 : 6,
                        marginLeft: isRtl ? 6 : 0,
                      }}
                    />
                    <MutedText style={styles.headerBadgeText}>
                      Verified
                    </MutedText>
                  </View>
                ) : null}
              </View>

              <View
                style={[
                  styles.artistTitleRow,
                  { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                {artistData.image ? (
                  <ImageWithSkeleton
                    source={{ uri: artistData.image }}
                    containerStyle={styles.artistAvatar}
                  />
                ) : null}
                <TitleText
                  numberOfLines={2}
                  style={[
                    styles.artistName,
                    {
                      color: "#ffffff",
                      fontSize: artistNameFontSize,
                      lineHeight: artistNameFontSize + 4,
                    },
                    titleSpacing,
                  ]}
                >
                  {artistData.name}
                </TitleText>
              </View>

              <View
                style={[
                  styles.metaChipRow,
                  { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                {artistData.monthlyListeners ? (
                  <View
                    style={[
                      styles.metaChip,
                      { backgroundColor: withOpacity("#000000", 0.22) },
                    ]}
                  >
                    <MutedText style={styles.metaChipText}>
                      {formatCompactNumber(artistData.monthlyListeners)}{" "}
                      {t("screens.artist.monthly_listeners")}
                    </MutedText>
                  </View>
                ) : null}
                {popularSongs.length > 0 ? (
                  <View
                    style={[
                      styles.metaChip,
                      { backgroundColor: withOpacity("#000000", 0.22) },
                    ]}
                  >
                    <MutedText style={styles.metaChipText}>
                      {popularSongs.length}{" "}
                      {isYouTubeChannel
                        ? t("screens.artist.videos")
                        : t("screens.artist.songs")}
                    </MutedText>
                  </View>
                ) : null}
                {playlists.length > 0 ? (
                  <View
                    style={[
                      styles.metaChip,
                      { backgroundColor: withOpacity("#000000", 0.22) },
                    ]}
                  >
                    <MutedText style={styles.metaChipText}>
                      {playlists.length} {t("screens.artist.playlists")}
                    </MutedText>
                  </View>
                ) : null}
              </View>

              {artistData.description ? (
                <MutedText
                  numberOfLines={3}
                  style={[
                    styles.descriptionText,
                    {
                      color: withOpacity(
                        colors.foreground,
                        isLight ? 0.98 : 0.72,
                      ),
                    },
                  ]}
                >
                  {shortenDescription(artistData.description)}
                </MutedText>
              ) : null}
            </View>
          </View>

          <View
            style={[
              styles.contentContainer,
              { backgroundColor: colors.background },
            ]}
          >
            <View
              style={[
                styles.actionsRow,
                { flexDirection: isRtl ? "row-reverse" : "row" },
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={handlePlayAll}
                style={[
                  styles.primaryActionButton,
                  {
                    backgroundColor: colors.accent,
                    shadowColor: "#000000",
                    flexDirection: isRtl ? "row-reverse" : "row",
                  },
                ]}
              >
                <Ionicons name="play" size={18} color={colors.accentContrast} />
                <TitleText
                  style={[
                    styles.primaryActionText,
                    {
                      color: colors.accentContrast,
                      marginLeft: isRtl ? 0 : 8,
                      marginRight: isRtl ? 8 : 0,
                    },
                  ]}
                >
                  {t("common.play")}
                </TitleText>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.88}
                onPress={handleShuffle}
                style={[
                  styles.secondaryActionButton,
                  {
                    backgroundColor: colors.surface1,
                    borderColor: colors.borderSubtle,
                    marginLeft: isRtl ? 0 : 12,
                    marginRight: isRtl ? 12 : 0,
                  },
                ]}
              >
                <Ionicons name="shuffle" size={18} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.mainCard,
                {
                  backgroundColor: colors.surface1,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              {featuredSong ? (
                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={() => {
                    const featuredIndex = popularSongs.findIndex(
                      (song) => song.id === featuredSong.id,
                    );
                    handlePlaySong(
                      featuredSong,
                      featuredIndex >= 0 ? featuredIndex : 0,
                    );
                  }}
                  style={[
                    styles.featuredCard,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  {featuredSong.thumbnail ? (
                    <ImageWithSkeleton
                      source={{ uri: featuredSong.thumbnail }}
                      resizeMode="cover"
                      containerStyle={styles.featuredImage}
                    />
                  ) : null}
                  <LinearGradient
                    colors={[
                      withOpacity("#000000", 0.15),
                      withOpacity("#000000", 0.52),
                      withOpacity("#000000", 0.88),
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={ABSOLUTE_FILL}
                  />
                  <View style={styles.featuredContent}>
                    <MutedText style={styles.featuredEyebrow}>
                      {isYouTubeChannel
                        ? t("screens.artist.videos")
                        : t("screens.artist.songs")}
                    </MutedText>
                    <TitleText numberOfLines={2} style={styles.featuredTitle}>
                      {featuredSong.title}
                    </TitleText>
                    <MutedText
                      numberOfLines={1}
                      style={styles.featuredSubtitle}
                    >
                      {featuredSong.artist || artistData.name}
                    </MutedText>
                    <View
                      style={[
                        styles.featuredMetaRow,
                        { flexDirection: isRtl ? "row-reverse" : "row" },
                      ]}
                    >
                      {featuredSong.playCount > 0 ? (
                        <View
                          style={[
                            styles.featuredMetaChip,
                            { backgroundColor: withOpacity("#000000", 0.24) },
                          ]}
                        >
                          <MutedText style={styles.featuredMetaText}>
                            {formatCompactNumber(featuredSong.playCount)}{" "}
                            {t("screens.artist.plays")}
                          </MutedText>
                        </View>
                      ) : null}
                      {featuredSong.duration ? (
                        <View
                          style={[
                            styles.featuredMetaChip,
                            { backgroundColor: withOpacity("#000000", 0.24) },
                          ]}
                        >
                          <MutedText style={styles.featuredMetaText}>
                            {formatDuration(featuredSong.duration)}
                          </MutedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              ) : null}

              <View style={styles.sectionBlock}>
                <View
                  style={[
                    styles.sectionHeaderRow,
                    { flexDirection: isRtl ? "row-reverse" : "row" },
                  ]}
                >
                  <TitleText style={styles.sectionTitle}>
                    {isYouTubeChannel
                      ? t("screens.artist.videos")
                      : t("screens.artist.songs")}
                  </TitleText>
                  {visibleSongs.length > 0 ? (
                    <MutedText style={styles.sectionMeta}>
                      {visibleSongs.length}
                    </MutedText>
                  ) : null}
                </View>

                {visibleSongs.length > 0 ? (
                  visibleSongs.map((song, index) => (
                    <TouchableOpacity
                      key={`${song.id}-${index}`}
                      activeOpacity={0.88}
                      onPress={() => handlePlaySong(song, index)}
                      style={[
                        styles.songRow,
                        {
                          backgroundColor: colors.surface2,
                          borderColor: colors.borderSubtle,
                          flexDirection: isRtl ? "row-reverse" : "row",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.trackIndexWrap,
                          {
                            marginRight: isRtl ? 0 : 14,
                            marginLeft: isRtl ? 14 : 0,
                          },
                        ]}
                      >
                        <BodyText
                          style={[styles.trackIndex, { color: colors.muted }]}
                        >
                          {index + 1}
                        </BodyText>
                      </View>

                      {song.thumbnail ? (
                        <ImageWithSkeleton
                          source={{ uri: song.thumbnail }}
                          containerStyle={[
                            styles.songThumb,
                            {
                              marginRight: isRtl ? 0 : 14,
                              marginLeft: isRtl ? 14 : 0,
                            },
                          ]}
                          fallback={
                            <View
                              style={[
                                styles.songThumb,
                                styles.songThumbFallback,
                                {
                                  backgroundColor: colors.surface3,
                                  marginRight: isRtl ? 0 : 14,
                                  marginLeft: isRtl ? 14 : 0,
                                },
                              ]}
                            >
                              <Ionicons
                                name="musical-notes-outline"
                                size={20}
                                color={colors.muted}
                              />
                            </View>
                          }
                        />
                      ) : (
                        <View
                          style={[
                            styles.songThumb,
                            styles.songThumbFallback,
                            {
                              backgroundColor: colors.surface3,
                              marginRight: isRtl ? 0 : 14,
                              marginLeft: isRtl ? 14 : 0,
                            },
                          ]}
                        >
                          <Ionicons
                            name="musical-notes-outline"
                            size={20}
                            color={colors.muted}
                          />
                        </View>
                      )}

                      <View style={styles.songMeta}>
                        <TitleText numberOfLines={1} style={styles.songTitle}>
                          {song.title}
                        </TitleText>
                        <MutedText
                          numberOfLines={1}
                          style={styles.songSubtitle}
                        >
                          {buildSongSubtitle(song)}
                        </MutedText>
                      </View>

                      <View style={styles.songEndMeta}>
                        {song.playCount > 0 ? (
                          <MutedText
                            numberOfLines={1}
                            style={styles.songEndMetaText}
                          >
                            {formatCompactNumber(song.playCount)}{" "}
                            {t("screens.artist.plays")}
                          </MutedText>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  ))
                ) : (
                  <MutedText>{t("common.noneYet")}</MutedText>
                )}
              </View>

              {albums.length > 0 ? (
                <View style={styles.sectionBlock}>
                  <View
                    style={[
                      styles.sectionHeaderRow,
                      { flexDirection: isRtl ? "row-reverse" : "row" },
                    ]}
                  >
                    <TitleText style={styles.sectionTitle}>
                      {t("screens.artist.albums")}
                    </TitleText>
                    <MutedText style={styles.sectionMeta}>
                      {albums.length}
                    </MutedText>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={isRtl ? styles.rtlScroll : null}
                    contentContainerStyle={[
                      styles.horizontalListContent,
                      isRtl ? styles.horizontalListContentRtl : null,
                    ]}
                  >
                    {albums.map((album) => (
                      <TouchableOpacity
                        key={album.id}
                        activeOpacity={0.9}
                        onPress={() => openCollection(album)}
                        style={[
                          styles.collectionCard,
                          { marginRight: 14 },
                          isRtl ? styles.rtlScrollItem : null,
                        ]}
                      >
                        {album.thumbnail ? (
                          <ImageWithSkeleton
                            source={{ uri: album.thumbnail }}
                            containerStyle={styles.collectionImage}
                            fallback={
                              <View
                                style={[
                                  styles.collectionImage,
                                  styles.collectionFallback,
                                  { backgroundColor: colors.surface2 },
                                ]}
                              >
                                <Ionicons
                                  name="disc-outline"
                                  size={28}
                                  color={colors.muted}
                                />
                              </View>
                            }
                          />
                        ) : (
                          <View
                            style={[
                              styles.collectionImage,
                              styles.collectionFallback,
                              { backgroundColor: colors.surface2 },
                            ]}
                          >
                            <Ionicons
                              name="disc-outline"
                              size={28}
                              color={colors.muted}
                            />
                          </View>
                        )}
                        <TitleText
                          numberOfLines={1}
                          style={[
                            styles.collectionTitle,
                            {
                              fontFamily: getAppFontFamily(isRtl, "semibold"),
                              ...getTextDirectionStyle(isRtl),
                            },
                          ]}
                        >
                          {album.title}
                        </TitleText>
                        <MutedText
                          numberOfLines={1}
                          style={[
                            styles.collectionSubtitle,
                            {
                              fontFamily: getAppFontFamily(isRtl, "regular"),
                              ...getTextDirectionStyle(isRtl),
                            },
                          ]}
                        >
                          {album.year ||
                            (album.songCount
                              ? `${album.songCount} ${t("screens.artist.songs")}`
                              : album.videoCount
                                ? `${album.videoCount} ${t("screens.artist.videos")}`
                                : t("common.noneYet"))}
                        </MutedText>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {playlists.length > 0 ? (
                <View style={styles.sectionBlock}>
                  <View
                    style={[
                      styles.sectionHeaderRow,
                      { flexDirection: isRtl ? "row-reverse" : "row" },
                    ]}
                  >
                    <TitleText style={styles.sectionTitle}>
                      {t("screens.artist.playlists")}
                    </TitleText>
                    <MutedText style={styles.sectionMeta}>
                      {playlists.length}
                    </MutedText>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={isRtl ? styles.rtlScroll : null}
                    contentContainerStyle={[
                      styles.horizontalListContent,
                      isRtl ? styles.horizontalListContentRtl : null,
                    ]}
                  >
                    {playlists.map((playlist) => (
                      <TouchableOpacity
                        key={playlist.id}
                        activeOpacity={0.9}
                        onPress={() => openCollection(playlist)}
                        style={[
                          styles.collectionCard,
                          { marginRight: 14 },
                          isRtl ? styles.rtlScrollItem : null,
                        ]}
                      >
                        {playlist.thumbnail ? (
                          <ImageWithSkeleton
                            source={{ uri: playlist.thumbnail }}
                            containerStyle={styles.collectionImage}
                            fallback={
                              <View
                                style={[
                                  styles.collectionImage,
                                  styles.collectionFallback,
                                  { backgroundColor: colors.surface2 },
                                ]}
                              >
                                <Ionicons
                                  name="list-outline"
                                  size={28}
                                  color={colors.muted}
                                />
                              </View>
                            }
                          />
                        ) : (
                          <View
                            style={[
                              styles.collectionImage,
                              styles.collectionFallback,
                              { backgroundColor: colors.surface2 },
                            ]}
                          >
                            <Ionicons
                              name="list-outline"
                              size={28}
                              color={colors.muted}
                            />
                          </View>
                        )}
                        <TitleText
                          numberOfLines={1}
                          style={[
                            styles.collectionTitle,
                            {
                              fontFamily: getAppFontFamily(isRtl, "semibold"),
                              ...getTextDirectionStyle(isRtl),
                            },
                          ]}
                        >
                          {playlist.title}
                        </TitleText>
                        <MutedText
                          numberOfLines={1}
                          style={[
                            styles.collectionSubtitle,
                            {
                              fontFamily: getAppFontFamily(isRtl, "regular"),
                              ...getTextDirectionStyle(isRtl),
                            },
                          ]}
                        >
                          {playlist.videoCount
                            ? `${playlist.videoCount} ${t("screens.artist.videos")}`
                            : t("common.noneYet")}
                        </MutedText>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
};

export default ArtistScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  statePadding: {
    paddingHorizontal: 24,
  },
  errorText: {
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  retryButtonText: {
    fontSize: 16,
    lineHeight: 20,
  },
  headerSection: {
    height: HEADER_HEIGHT,
    position: "relative",
    justifyContent: "flex-end",
  },
  headerImage: {
    ...ABSOLUTE_FILL,
    width: "100%",
    height: "100%",
  },
  headerFallback: {
    ...ABSOLUTE_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    position: "absolute",
    top: 18,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  headerContent: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 20,
    paddingBottom: 18,
    zIndex: 1,
  },
  headerBadgeRow: {
    alignItems: "center",
    marginBottom: 14,
  },
  headerBadge: {
    minHeight: 28,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginRight: 8,
  },
  headerBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    lineHeight: 14,
  },
  artistTitleRow: {
    alignItems: "center",
  },
  artistAvatar: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  artistName: {
    flex: 1,
  },
  metaChipRow: {
    flexWrap: "wrap",
    marginTop: 12,
  },
  metaChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
  },
  metaChipText: {
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 16,
  },
  descriptionText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 19,
  },
  contentContainer: {
    marginTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  actionsRow: {
    alignItems: "center",
    marginBottom: 16,
  },
  primaryActionButton: {
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 8,
  },
  primaryActionText: {
    fontSize: 15,
    lineHeight: 18,
  },
  secondaryActionButton: {
    width: 48,
    height: 48,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mainCard: {
    borderRadius: 26,
    overflow: "hidden",
  },
  featuredCard: {
    height: 220,
    borderBottomWidth: 1,
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 26,
  },
  featuredImage: {
    ...ABSOLUTE_FILL,
    width: "100%",
    height: "100%",
  },
  featuredContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 18,
  },
  featuredEyebrow: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    lineHeight: 16,
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  featuredTitle: {
    marginTop: 10,
    color: "#ffffff",
    fontSize: 28,
    lineHeight: 32,
  },
  featuredSubtitle: {
    marginTop: 6,
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 18,
  },
  featuredMetaRow: {
    flexWrap: "wrap",
    marginTop: 12,
  },
  featuredMetaChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  featuredMetaText: {
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 16,
  },
  sectionBlock: {
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionHeaderRow: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 28,
  },
  sectionMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  songRow: {
    borderWidth: 0.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  trackIndexWrap: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  trackIndex: {
    fontSize: 13,
    lineHeight: 18,
  },
  songThumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
  },
  songThumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  songMeta: {
    flex: 1,
    justifyContent: "center",
  },
  songTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  songSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  songEndMeta: {
    marginLeft: 12,
    alignItems: "flex-end",
    maxWidth: 92,
  },
  songEndMetaText: {
    fontSize: 12,
    lineHeight: 16,
  },
  horizontalListContent: {
    paddingHorizontal: 16,
    minWidth: "100%",
  },
  horizontalListContentRtl: {
    paddingLeft: 16,
    paddingRight: 30,
  },
  rtlScroll: {
    transform: [{ scaleX: -1 }],
  },
  rtlScrollItem: {
    transform: [{ scaleX: -1 }],
  },
  collectionCard: {
    width: 172,
  },
  collectionImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 18,
  },
  collectionFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  collectionTitle: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 18,
  },
  collectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
});
