import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Screen } from "../ui/Screen";
import { SectionHeader as UiSectionHeader } from "../ui/SectionHeader";
import { BodyText, MutedText, TitleText } from "../ui/Text";
import { usePlayer, type Track } from "../../contexts/PlayerContext";
import {
  extractYouTubeVideoId,
  fetchJioSaavnSuggestions,
  fetchWithRetry,
  fetchYouTubeMix,
  getPrimaryInvidiousInstance,
  getPrimaryPipedInstance,
  getTrackSource,
} from "../core/api";
import { getProviderEndpoints } from "../../lib/provider-endpoints";
import { StorageService } from "../../utils/storage";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { useAuth } from "../../hooks/useAuth";
import { getAppFontFamily, getTextDirectionStyle } from "../../utils/fonts";
import {
  pickBestImageUrl as pickBestArtworkUrl,
  sanitizeImageUrl,
} from "../core/image";
import { SkeletonLoader } from "../SkeletonLoader";

interface SuggestedTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
  source: "youtube" | "jiosaavn" | "soundcloud";
}

interface PlayedArtistSummary {
  key: string;
  name: string;
  artistId?: string;
  image?: string;
  banner?: string;
  source: "youtube" | "jiosaavn" | "soundcloud";
  count: number;
  songs: Track[];
  playCountLabel: string;
}

type HeroBannerCache = Record<
  string,
  {
    banner: string;
    cachedAt: number;
  }
>;

const HOME_HERO_BANNER_CACHE_KEY = "@home_hero_artist_banners";

function getUserDisplayName(
  user: { email?: string | null; user_metadata?: any } | null,
) {
  if (!user) {
    return "";
  }

  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.user_metadata?.preferred_username ||
    user.email ||
    ""
  );
}

function getUserAvatarUrl(user: { user_metadata?: any } | null) {
  if (!user) {
    return "";
  }

  return sanitizeImageUrl(
    user.user_metadata?.avatar_url ||
      user.user_metadata?.picture ||
      user.user_metadata?.image ||
      "",
  );
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

function formatDuration(seconds: number | undefined, fallback: string): string {
  if (!seconds || Number.isNaN(seconds)) {
    return fallback;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function shortenLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function pickBestImageUrl(value: unknown, base: string): string {
  return pickBestArtworkUrl(value, base);
}

function prefetchImage(url: string) {
  const prefetch = (
    Image as typeof Image & {
      prefetch?: (uri: string) => Promise<boolean>;
    }
  ).prefetch;
  if (url && typeof prefetch === "function") {
    void prefetch(url);
  }
}

async function readHomeHeroBannerCache(): Promise<HeroBannerCache> {
  try {
    const raw = await StorageService.getItem(HOME_HERO_BANNER_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as HeroBannerCache;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

async function writeHomeHeroBannerCache(cache: HeroBannerCache): Promise<void> {
  try {
    await StorageService.setItem(
      HOME_HERO_BANNER_CACHE_KEY,
      JSON.stringify(cache),
    );
  } catch {}
}

function normalizeArtistSource(
  source?: string,
): "youtube" | "jiosaavn" | "soundcloud" {
  const normalized = source?.trim().toLowerCase();
  if (normalized === "jiosaavn") {
    return "jiosaavn";
  }
  if (normalized === "soundcloud") {
    return "soundcloud";
  }
  return "youtube";
}

function canOpenArtistRoute(artist: {
  artistId?: string;
  source?: string;
}): boolean {
  if (!artist.artistId?.trim()) {
    return false;
  }

  const source = normalizeArtistSource(artist.source);
  return source === "youtube" || source === "jiosaavn";
}

function toPlayableTrack(track: SuggestedTrack): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    thumbnail: track.thumbnail,
    duration: track.duration,
    source: track.source,
    _isJioSaavn: track.source === "jiosaavn",
    _isSoundCloud: track.source === "soundcloud",
  };
}

function toSuggestedTrack(track: Track): SuggestedTrack | null {
  if (!track?.id || !track.title) {
    return null;
  }

  return {
    id: track.id,
    title: track.title,
    artist: track.artist || "Unknown Artist",
    thumbnail: track.thumbnail || track.artistImage || "",
    duration: track.duration,
    source:
      getTrackSource(track) === "youtube"
        ? "youtube"
        : track._isSoundCloud || track.source === "soundcloud"
          ? "soundcloud"
          : "jiosaavn",
  };
}

function rankMadeForYouCandidates(tracks: Track[]): Track[] {
  const artistCounts = new Map<string, number>();

  for (const track of tracks) {
    const artistKey = track.artist?.trim().toLowerCase();
    if (!artistKey) {
      continue;
    }

    artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
  }

  return dedupeTracksById(tracks)
    .filter((track) => {
      const source = getTrackSource(track);
      return source === "youtube" || source === "jiosaavn";
    })
    .sort((left, right) => {
      const sourceScore = (track: Track) => {
        const source = getTrackSource(track);
        if (source === "youtube") {
          return 30;
        }
        if (source === "jiosaavn") {
          return 18;
        }
        return 0;
      };

      const artistScore = (track: Track) => {
        const artistKey = track.artist?.trim().toLowerCase() || "";
        return artistCounts.get(artistKey) || 0;
      };

      return (
        sourceScore(right) +
        artistScore(right) -
        (sourceScore(left) + artistScore(left))
      );
    })
    .slice(0, 6);
}

function HeroCard({
  title,
  image,
  colors,
  isLight,
  playLabel,
  onPressPlay,
  empty,
  eyebrow,
  description,
}: {
  title: string;
  image?: string;
  colors: ReturnType<typeof useTheme>["colors"];
  isLight: boolean;
  playLabel: string;
  onPressPlay?: () => void;
  empty?: boolean;
  eyebrow?: string;
  description?: string;
}) {
  const { isRtl } = useAppLanguage();

  if (empty) {
    return (
      <View
        style={[
          styles.emptyHero,
          {
            backgroundColor: colors.surface1,
            borderColor: colors.borderSubtle,
          },
        ]}
      >
        {eyebrow ? (
          <MutedText style={styles.emptyHeroEyebrow}>{eyebrow}</MutedText>
        ) : null}
        <TitleText style={styles.emptyHeroTitle}>{title}</TitleText>
        {description ? (
          <MutedText style={styles.emptyHeroDescription}>
            {description}
          </MutedText>
        ) : null}
      </View>
    );
  }

  const absoluteFill = {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  const overlayColors: [string, string, string] = image
    ? [
        withOpacity("#000000", 0.12),
        withOpacity("#000000", 0.4),
        withOpacity("#000000", 0.88),
      ]
    : [colors.heroStart, colors.heroMid, colors.heroEnd];

  return (
    <View
      style={[
        styles.heroCard,
        {
          backgroundColor: colors.surface1,
          borderColor: image ? "transparent" : colors.borderSubtle,
        },
      ]}
    >
      {image ? (
        <Image
          source={{ uri: image, cache: "force-cache" }}
          resizeMode="cover"
          style={[absoluteFill, styles.heroImage]}
        />
      ) : null}
      <LinearGradient
        colors={overlayColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={absoluteFill}
      />
      {onPressPlay ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onPressPlay}
          accessibilityRole="button"
          accessibilityLabel={playLabel}
          style={[
            styles.heroPlayButton,
            {
              backgroundColor: colors.accent,
              shadowColor: isLight ? colors.foreground : "#000000",
            },
          ]}
        >
          <Ionicons name="play" size={28} color={colors.accentContrast} />
        </TouchableOpacity>
      ) : null}
      <View style={styles.heroContent}>
        <TitleText
          style={[
            styles.heroTitle,
            {
              textAlign: isRtl ? "right" : "left",
              fontFamily: getAppFontFamily(isRtl, "bold"),
            },
          ]}
        >
          {title}
        </TitleText>
      </View>
    </View>
  );
}

function SongCard({
  title,
  subtitle,
  durationLabel,
  image,
  colors,
  onPress,
}: {
  title: string;
  subtitle: string;
  durationLabel: string;
  image?: string;
  colors: ReturnType<typeof useTheme>["colors"];
  onPress: () => void;
}) {
  const { isRtl } = useAppLanguage();

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.songCard]}
    >
      <View
        style={[
          styles.songArtworkFrame,
          {
            backgroundColor: colors.surface1,
            shadowColor: "#000000",
          },
        ]}
      >
        {image ? (
          <Image source={{ uri: image }} style={styles.songArtwork} />
        ) : (
          <View
            style={[
              styles.songArtwork,
              styles.songArtworkFallback,
              { backgroundColor: colors.surface3 },
            ]}
          >
            <Ionicons
              name="musical-notes-outline"
              size={28}
              color={colors.muted}
            />
          </View>
        )}
        <View
          style={[
            styles.songPlayBadge,
            {
              backgroundColor: colors.accent,
              shadowColor: "#000000",
              right: isRtl ? undefined : 12,
              left: isRtl ? 12 : undefined,
            },
          ]}
        >
          <Ionicons
            name="play"
            size={18}
            color={colors.accentContrast}
            style={{ marginLeft: 1 }}
          />
        </View>
      </View>
      <TitleText
        numberOfLines={1}
        style={[styles.songTitle, { textAlign: isRtl ? "right" : "left" }]}
      >
        {title}
      </TitleText>
      <MutedText
        numberOfLines={1}
        style={[styles.songSubtitle, { textAlign: isRtl ? "right" : "left" }]}
      >
        {subtitle}
      </MutedText>
      <MutedText
        numberOfLines={1}
        style={[styles.songMeta, { textAlign: isRtl ? "right" : "left" }]}
      >
        {durationLabel}
      </MutedText>
    </TouchableOpacity>
  );
}

function ArtistCard({
  artist,
  colors,
  onPress,
  playLabel,
}: {
  artist: PlayedArtistSummary;
  colors: ReturnType<typeof useTheme>["colors"];
  onPress: () => void;
  playLabel: string;
}) {
  const { isRtl } = useAppLanguage();

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={playLabel}
      style={[styles.artistCard]}
    >
      <View
        style={[
          styles.artistArtworkFrame,
          {
            backgroundColor: colors.surface1,
            shadowColor: "#000000",
          },
        ]}
      >
        {artist.image ? (
          <Image source={{ uri: artist.image }} style={styles.artistArtwork} />
        ) : (
          <View
            style={[
              styles.artistArtwork,
              styles.songArtworkFallback,
              { backgroundColor: colors.surface3 },
            ]}
          >
            <Ionicons name="person-outline" size={36} color={colors.muted} />
          </View>
        )}
      </View>
      <TitleText numberOfLines={1} style={styles.artistTitle}>
        {artist.name}
      </TitleText>
      <MutedText numberOfLines={1} style={styles.artistSubtitle}>
        {artist.playCountLabel}
      </MutedText>
    </TouchableOpacity>
  );
}

function EmptyStateCard({
  label,
  colors,
}: {
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View
      style={[
        styles.emptyStateCard,
        {
          backgroundColor: colors.surface3,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <MutedText style={styles.emptyStateText}>{label}</MutedText>
    </View>
  );
}

function HorizontalSongSkeletonList({ count = 3 }: { count?: number }) {
  const { isRtl } = useAppLanguage();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.horizontalListContent,
        isRtl ? styles.horizontalListContentRtl : null,
      ]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={`home-song-skeleton-${index}`}
          style={[
            styles.songCard,
            { alignItems: isRtl ? "flex-end" : "flex-start" },
          ]}
        >
          <SkeletonLoader
            width={168}
            height={168}
            style={{ borderRadius: 22 }}
          />
          <SkeletonLoader
            height={20}
            style={{ width: "78%", borderRadius: 8, marginTop: 12 }}
          />
          <SkeletonLoader
            height={18}
            style={{ width: "62%", borderRadius: 8, marginTop: 6 }}
          />
          <SkeletonLoader
            height={16}
            style={{ width: "38%", borderRadius: 7, marginTop: 4 }}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function HorizontalArtistSkeletonList({ count = 3 }: { count?: number }) {
  const { isRtl } = useAppLanguage();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.horizontalListContent,
        isRtl ? styles.horizontalListContentRtl : null,
      ]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={`home-artist-skeleton-${index}`}
          style={[
            styles.artistCard,
            { alignItems: isRtl ? "flex-end" : "center" },
          ]}
        >
          <SkeletonLoader
            width={168}
            height={168}
            style={{ borderRadius: 999 }}
          />
          <SkeletonLoader
            width={120}
            height={20}
            style={{ borderRadius: 8, marginTop: 12 }}
          />
          <SkeletonLoader
            width={88}
            height={18}
            style={{ borderRadius: 8, marginTop: 6 }}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function HeaderPillButton({
  label,
  colors,
  onPress,
  filled = false,
  emphasized = false,
}: {
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
  onPress: () => void;
  filled?: boolean;
  emphasized?: boolean;
}) {
  const { isRtl } = useAppLanguage();

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.headerPillButton,
        {
          backgroundColor: filled ? colors.accent : colors.surface3,
          borderColor: filled ? colors.accent : colors.borderSubtle,
        },
      ]}
    >
      <BodyText
        numberOfLines={1}
        style={[
          styles.headerPillButtonText,
          {
            color: filled ? colors.accentContrast : colors.foreground,
            fontFamily: isRtl
              ? emphasized
                ? "YekanBakhBold"
                : "YekanBakhRegular"
              : emphasized
                ? "GoogleSansBold"
                : "GoogleSansMedium",
            fontWeight: emphasized ? "700" : "500",
          },
        ]}
      >
        {label}
      </BodyText>
    </TouchableOpacity>
  );
}

function AccountPillButton({
  label,
  avatarUrl,
  fallback,
  colors,
  onPress,
  isRtl,
}: {
  label: string;
  avatarUrl?: string;
  fallback: string;
  colors: ReturnType<typeof useTheme>["colors"];
  onPress: () => void;
  isRtl: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.accountPillButton,
        {
          backgroundColor: colors.surface3,
          borderColor: colors.borderSubtle,
          flexDirection: isRtl ? "row-reverse" : "row",
        },
      ]}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={styles.accountPillAvatarImage}
        />
      ) : (
        <View
          style={[
            styles.accountPillAvatarFallback,
            {
              backgroundColor: colors.surface2,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <BodyText style={styles.accountPillAvatarFallbackText}>
            {fallback}
          </BodyText>
        </View>
      )}
      <BodyText numberOfLines={1} style={styles.accountPillButtonText}>
        {label}
      </BodyText>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }: any) {
  const { colors, isLight } = useTheme();
  const { isRtl, t } = useAppLanguage();
  const { playTrack } = usePlayer();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [playedArtists, setPlayedArtists] = useState<PlayedArtistSummary[]>([]);
  const [isLoadingArtists, setIsLoadingArtists] = useState(false);
  const [madeForYouSeedTrack, setMadeForYouSeedTrack] = useState<Track | null>(
    null,
  );
  const [madeForYouTracks, setMadeForYouTracks] = useState<SuggestedTrack[]>(
    [],
  );
  const [isLoadingMadeForYou, setIsLoadingMadeForYou] = useState(false);
  const [heroTracks, setHeroTracks] = useState<SuggestedTrack[]>([]);
  const [isLoadingHeroTracks, setIsLoadingHeroTracks] = useState(false);

  useEffect(() => {
    const syncCurrentHour = () => {
      setCurrentHour(new Date().getHours());
    };

    syncCurrentHour();

    const interval = setInterval(syncCurrentHour, 60 * 1000);
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextAppState) => {
        if (nextAppState === "active") {
          syncCurrentHour();
        }
      },
    );

    return () => {
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, []);

  const greeting = useMemo(() => {
    if (currentHour < 12) {
      return t("home.greetingMorning");
    }
    if (currentHour < 18) {
      return t("home.greetingAfternoon");
    }
    return t("home.greetingEvening");
  }, [currentHour, t]);

  const uniqueRecentSongs = useMemo(
    () => dedupeTracksById(historyTracks).slice(0, 12),
    [historyTracks],
  );

  const mostPlayedYoutubeArtist = useMemo(() => {
    return (
      playedArtists
        .filter(
          (artist) =>
            artist.source === "youtube" &&
            !artist.name.toLowerCase().includes("- topic"),
        )
        .sort((left, right) => right.count - left.count)[0] || null
    );
  }, [playedArtists]);

  const navigablePlayedArtists = useMemo(
    () => playedArtists.filter((artist) => canOpenArtistRoute(artist)),
    [playedArtists],
  );

  const historyHeroSongs = useMemo(() => {
    if (!mostPlayedYoutubeArtist) {
      return [];
    }

    return dedupeTracksById(
      mostPlayedYoutubeArtist.songs.filter(
        (track) => getTrackSource(track) === "youtube",
      ),
    );
  }, [mostPlayedYoutubeArtist]);

  const playQueue = useCallback(
    async (queue: Track[], track: Track) => {
      const currentIndex = Math.max(
        queue.findIndex((entry) => entry.id === track.id),
        0,
      );
      await playTrack(track, queue, currentIndex);
    },
    [playTrack],
  );

  const playSuggestedQueue = useCallback(
    async (queue: SuggestedTrack[], track: SuggestedTrack) => {
      const playableQueue = queue.map(toPlayableTrack);
      const currentIndex = Math.max(
        playableQueue.findIndex((entry) => entry.id === track.id),
        0,
      );
      await playTrack(playableQueue[currentIndex], playableQueue, currentIndex);
    },
    [playTrack],
  );

  const resolveYouTubeVideoId = useCallback((track: Track): string => {
    let videoId = track.id;

    if (!videoId || videoId.length !== 11) {
      if (videoId && videoId.startsWith("RD") && videoId.length > 11) {
        videoId = videoId.slice(2);
      }

      if (track.audioUrl) {
        const extractedId = extractYouTubeVideoId(track.audioUrl);
        if (extractedId) {
          videoId = extractedId;
        }
      }
    }

    return videoId && videoId.length === 11 ? videoId : "";
  }, []);

  const loadPlayedArtists = useCallback(
    async (tracks: Track[]) => {
      if (tracks.length === 0) {
        setPlayedArtists([]);
        setIsLoadingArtists(false);
        return;
      }

      const artistMap = new Map<string, PlayedArtistSummary>();
      const bannerCache = await readHomeHeroBannerCache();

      for (const track of tracks) {
        const artistName = track.artist?.trim();
        if (!artistName) {
          continue;
        }

        const normalizedSource =
          getTrackSource(track) === "youtube"
            ? "youtube"
            : track._isSoundCloud || track.source === "soundcloud"
              ? "soundcloud"
              : "jiosaavn";
        const artistId = track.artistId?.trim() || undefined;
        const key = artistId
          ? `${normalizedSource}:${artistId}`
          : `${normalizedSource}:${artistName.toLowerCase()}`;
        const existing = artistMap.get(key);

        if (existing) {
          existing.count += 1;
          existing.songs.push(track);
          if (!existing.image) {
            existing.image = track.artistImage || track.thumbnail;
          }
          if (!existing.artistId && artistId) {
            existing.artistId = artistId;
          }
          continue;
        }

        // Skip YouTube "Topic" auto-generated channels (e.g. "Artist Name - Topic")
        // Same filter as streamifyweb-player hero
        const isTopicChannel =
          normalizedSource === "youtube" &&
          artistName.toLowerCase().includes("- topic");
        if (isTopicChannel) {
          continue;
        }

        artistMap.set(key, {
          key,
          name: artistName,
          artistId,
          image: track.artistImage || track.thumbnail,
          source: normalizedSource,
          count: 1,
          songs: [track],
          playCountLabel: t("home.play", { count: 1 }),
        });
      }

      for (const artist of artistMap.values()) {
        if (artist.source === "youtube" && artist.artistId) {
          const cachedBanner = sanitizeImageUrl(
            bannerCache[artist.artistId]?.banner || "",
          );
          if (cachedBanner) {
            artist.banner = cachedBanner;
            prefetchImage(cachedBanner);
          }
        }
        artist.playCountLabel = t("home.play", { count: artist.count });
      }

      setPlayedArtists(
        [...artistMap.values()].sort((left, right) => right.count - left.count),
      );
      setIsLoadingArtists(false);
    },
    [t],
  );

  const loadMadeForYou = useCallback(
    async (tracks: Track[]) => {
      const candidates = rankMadeForYouCandidates(tracks);

      if (candidates.length === 0) {
        setMadeForYouSeedTrack(null);
        setMadeForYouTracks([]);
        setIsLoadingMadeForYou(false);
        return;
      }

      setIsLoadingMadeForYou(true);

      try {
        for (const candidate of candidates) {
          const source = getTrackSource(candidate);
          if (source === "youtube") {
            const videoId = resolveYouTubeVideoId(candidate);
            if (!videoId) {
              continue;
            }

            const mixData = await fetchYouTubeMix(videoId);
            const videos = Array.isArray(mixData?.videos) ? mixData.videos : [];
            const nextTracks = videos
              .filter((video: any) => (video.lengthSeconds || 0) > 0)
              .slice(0, 12)
              .map((video: any) => {
                const thumbnails = Array.isArray(video.videoThumbnails)
                  ? video.videoThumbnails
                  : [];
                const thumbnail =
                  thumbnails[thumbnails.length - 1]?.url ||
                  video.thumbnail ||
                  video.thumbnailUrl ||
                  "";

                return {
                  id: String(
                    video.videoId || video.id || video.url || video.title,
                  ),
                  title: video.title,
                  artist: video.author || t("home.unknownArtist"),
                  thumbnail,
                  duration: video.lengthSeconds || video.duration || 0,
                  source: "youtube" as const,
                };
              });

            if (nextTracks.length > 0) {
              setMadeForYouSeedTrack(candidate);
              setMadeForYouTracks(nextTracks);
              return;
            }
          }

          if (source === "jiosaavn") {
            const suggestionsData = await fetchJioSaavnSuggestions(
              candidate.id,
            );
            const nextTracks = Array.isArray(suggestionsData?.data)
              ? suggestionsData.data.slice(0, 12).map((song: any) => ({
                  id: String(song.id || song.url || song.name),
                  title: song.name || song.title,
                  artist:
                    song.primaryArtists ||
                    song.artist ||
                    t("home.unknownArtist"),
                  thumbnail: song.image?.[0]?.url || song.thumbnail || "",
                  duration: song.duration,
                  source: "jiosaavn" as const,
                }))
              : [];

            if (nextTracks.length > 0) {
              setMadeForYouSeedTrack(candidate);
              setMadeForYouTracks(nextTracks);
              return;
            }
          }
        }

        setMadeForYouSeedTrack(candidates[0] || null);
        setMadeForYouTracks([]);
      } catch (error) {
        setMadeForYouTracks([]);
      } finally {
        setIsLoadingMadeForYou(false);
      }
    },
    [resolveYouTubeVideoId, t],
  );

  const loadHeroTracks = useCallback(
    async (artist: PlayedArtistSummary | null) => {
      if (!artist?.artistId) {
        setHeroTracks(
          dedupeTracksById(artist?.songs || [])
            .map((track) => toSuggestedTrack(track))
            .filter((track): track is SuggestedTrack =>
              Boolean(track?.id && track.title),
            )
            .slice(0, 12),
        );
        setIsLoadingHeroTracks(false);
        return;
      }

      setIsLoadingHeroTracks(true);

      try {
        const bannerCache = await readHomeHeroBannerCache();
        const cachedBanner = sanitizeImageUrl(
          bannerCache[artist.artistId]?.banner || "",
        );
        let nextBanner = cachedBanner || artist.banner || "";
        let nextHeroTracks: SuggestedTrack[] = [];

        if (cachedBanner) {
          prefetchImage(cachedBanner);
          if (cachedBanner !== artist.banner) {
            setPlayedArtists((current) =>
              current.map((entry) =>
                entry.key === artist.key
                  ? { ...entry, banner: cachedBanner }
                  : entry,
              ),
            );
          }
        }

        const providerEndpoints = await getProviderEndpoints();
        const invidiousBases = [
          getPrimaryInvidiousInstance(),
          ...providerEndpoints.instances.invidious,
        ].filter((value, index, array): value is string => {
          return Boolean(value) && array.indexOf(value) === index;
        });

        let invidiousBase = "";

        for (const candidateBase of invidiousBases) {
          try {
            const channelData = await fetchWithRetry<any>(
              `${candidateBase}/api/v1/channels/${encodeURIComponent(
                artist.artistId,
              )}`,
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

            invidiousBase = candidateBase;
            const latestVideos = Array.isArray(channelData?.latestVideos)
              ? channelData.latestVideos
              : [];
            nextBanner =
              pickBestImageUrl(channelData?.authorBanners, invidiousBase) ||
              nextBanner;

            nextHeroTracks = latestVideos
              .slice(0, 12)
              .map((video: any) => {
                const thumbnails = Array.isArray(video?.videoThumbnails)
                  ? video.videoThumbnails
                  : [];
                const thumbnail =
                  pickBestImageUrl(thumbnails, invidiousBase) ||
                  video?.thumbnail ||
                  video?.thumbnailUrl ||
                  "";

                return {
                  id: String(video?.videoId || video?.id || video?.title || ""),
                  title: video?.title,
                  artist: artist.name,
                  thumbnail,
                  duration: video?.lengthSeconds || video?.duration || 0,
                  source: "youtube" as const,
                };
              })
              .filter((track) => track.id && track.title);
            break;
          } catch {}
        }

        if (nextHeroTracks.length === 0) {
          const pipedBases = [
            getPrimaryPipedInstance(),
            ...providerEndpoints.instances.piped,
          ].filter((value, index, array): value is string => {
            return Boolean(value) && array.indexOf(value) === index;
          });

          for (const pipedBase of pipedBases) {
            try {
              const channelData = await fetchWithRetry<any>(
                `${pipedBase}/channel/${artist.artistId}`,
                {},
                3,
                1000,
              );

              const streams = Array.isArray(channelData?.relatedStreams)
                ? channelData.relatedStreams
                : [];
              nextBanner =
                channelData?.bannerUrl ||
                channelData?.avatarBannerUrl ||
                nextBanner;
              const getViewCount = (value: unknown) => {
                if (typeof value === "number") {
                  return value;
                }
                if (typeof value === "string") {
                  const parsed = Number(value.replace(/[^0-9]/g, ""));
                  return Number.isNaN(parsed) ? 0 : parsed;
                }
                return 0;
              };

              nextHeroTracks = streams
                .slice()
                .sort(
                  (left: any, right: any) =>
                    getViewCount(right.views) - getViewCount(left.views),
                )
                .slice(0, 12)
                .map((video: any) => {
                  const thumbnails = Array.isArray(video.videoThumbnails)
                    ? video.videoThumbnails
                    : [];
                  const thumbnail =
                    thumbnails[thumbnails.length - 1]?.url ||
                    video.thumbnail ||
                    video.thumbnailUrl ||
                    "";
                  const id =
                    (typeof video.url === "string" &&
                      video.url.split("v=")[1]) ||
                    video.videoId ||
                    video.id ||
                    video.title;

                  return {
                    id: String(id),
                    title: video.title,
                    artist: artist.name,
                    thumbnail,
                    duration: video.lengthSeconds || video.duration || 0,
                    source: "youtube" as const,
                  };
                })
                .filter((track) => track.id && track.title);
              if (nextHeroTracks.length > 0 || nextBanner) {
                break;
              }
            } catch {}
          }
        }

        if (nextBanner && nextBanner !== artist.banner) {
          const cleanBanner = sanitizeImageUrl(nextBanner);
          prefetchImage(cleanBanner);
          bannerCache[artist.artistId] = {
            banner: cleanBanner,
            cachedAt: Date.now(),
          };
          void writeHomeHeroBannerCache(bannerCache);
          setPlayedArtists((current) =>
            current.map((entry) =>
              entry.key === artist.key
                ? { ...entry, banner: cleanBanner }
                : entry,
            ),
          );
        }

        setHeroTracks(nextHeroTracks);
      } catch (error) {
        setHeroTracks([]);
      } finally {
        setIsLoadingHeroTracks(false);
      }
    },
    [],
  );

  const loadHome = useCallback(async () => {
    setIsLoadingHistory(true);

    try {
      const storedHistory = await StorageService.loadPreviouslyPlayedSongs();
      const nextHistory = Array.isArray(storedHistory) ? storedHistory : [];
      setHistoryTracks(nextHistory);
      await Promise.all([
        loadPlayedArtists(nextHistory),
        loadMadeForYou(nextHistory),
      ]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [loadMadeForYou, loadPlayedArtists]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      void loadHome();
    });
    void loadHome();
    return unsubscribe;
  }, [loadHome, navigation]);

  useEffect(() => {
    void loadHeroTracks(mostPlayedYoutubeArtist);
  }, [loadHeroTracks, mostPlayedYoutubeArtist]);

  const heroQueue = useMemo(() => {
    if (historyHeroSongs.length > 0) {
      return historyHeroSongs;
    }
    return heroTracks.map(toPlayableTrack);
  }, [heroTracks, historyHeroSongs]);

  const heroTitle = mostPlayedYoutubeArtist?.name || t("home.emptyHeroTitle");
  const heroImage = sanitizeImageUrl(mostPlayedYoutubeArtist?.banner || "");
  const handleOpenSettings = useCallback(() => {
    navigation.navigate("Settings");
  }, [navigation]);
  const handleOpenSignUp = useCallback(() => {
    navigation.navigate("SignUp");
  }, [navigation]);
  const handleOpenSignIn = useCallback(() => {
    navigation.navigate("SignIn");
  }, [navigation]);
  const accountDisplayName = getUserDisplayName(user);
  const accountAvatarUrl = getUserAvatarUrl(user);
  const accountInitial =
    accountDisplayName.charAt(0).toUpperCase() ||
    user?.email?.charAt(0).toUpperCase() ||
    "U";

  const accountButtons = useMemo(() => {
    if (isAuthLoading) {
      return [
        <HeaderPillButton
          key="loading"
          label={t("settings.accountLoading")}
          colors={colors}
          onPress={handleOpenSettings}
        />,
      ];
    }

    if (!user) {
      return [
        <HeaderPillButton
          key="signup"
          label={t("home.signUp")}
          colors={colors}
          filled
          emphasized
          onPress={handleOpenSignUp}
        />,
        <HeaderPillButton
          key="signin"
          label={t("home.signIn")}
          colors={colors}
          emphasized
          onPress={handleOpenSignIn}
        />,
      ];
    }

    return [
      <AccountPillButton
        key="account"
        label={accountDisplayName || t("settings.account")}
        avatarUrl={accountAvatarUrl}
        fallback={accountInitial}
        colors={colors}
        onPress={handleOpenSettings}
        isRtl={isRtl}
      />,
    ];
  }, [
    accountAvatarUrl,
    accountDisplayName,
    accountInitial,
    colors,
    handleOpenSignIn,
    handleOpenSettings,
    handleOpenSignUp,
    isAuthLoading,
    isRtl,
    t,
    user,
  ]);

  return (
    <Screen padded={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.contentContainer}
      >
        <View
          style={[
            styles.header,
            { flexDirection: isRtl ? "row-reverse" : "row" },
          ]}
        >
          <View
            style={[
              styles.headerTextBlock,
              {
                alignItems: isRtl ? "flex-end" : "flex-start",
              },
            ]}
          >
            <TitleText
              style={[
                styles.greeting,
                {
                  fontFamily: getAppFontFamily(isRtl, "bold"),
                  ...getTextDirectionStyle(isRtl),
                },
              ]}
            >
              {greeting}
            </TitleText>
          </View>
          <View
            style={[
              styles.headerActions,
              { flexDirection: isRtl ? "row-reverse" : "row" },
            ]}
          >
            {accountButtons}
          </View>
        </View>

        <View style={styles.section}>
          <HeroCard
            title={heroTitle}
            image={heroImage || undefined}
            colors={colors}
            isLight={isLight}
            playLabel={
              mostPlayedYoutubeArtist
                ? t("home.playSongsBy", { name: mostPlayedYoutubeArtist.name })
                : t("home.emptyHeroTitle")
            }
            onPressPlay={
              heroQueue.length > 0
                ? () => {
                    void playQueue(heroQueue, heroQueue[0]);
                  }
                : undefined
            }
            empty={!mostPlayedYoutubeArtist}
            eyebrow={t("home.emptyHeroEyebrow")}
            description={t("home.emptyHeroDescription")}
          />
        </View>

        <View style={styles.section}>
          <UiSectionHeader
            title={t("home.recentlyPlayed")}
            style={styles.sectionHeader}
          />
          {uniqueRecentSongs.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.horizontalListContent,
                isRtl ? styles.horizontalListContentRtl : null,
              ]}
            >
              {uniqueRecentSongs.map((track) => (
                <SongCard
                  key={track.id}
                  title={track.title}
                  subtitle={track.artist || t("home.unknownArtist")}
                  durationLabel={formatDuration(
                    track.duration,
                    t("home.recentlyPlayedFallback"),
                  )}
                  image={track.thumbnail}
                  colors={colors}
                  onPress={() => {
                    void playQueue(uniqueRecentSongs, track);
                  }}
                />
              ))}
            </ScrollView>
          ) : isLoadingHistory ? (
            <HorizontalSongSkeletonList />
          ) : (
            <EmptyStateCard label={t("home.noRecentSongs")} colors={colors} />
          )}
        </View>

        <View style={styles.section}>
          <UiSectionHeader
            title={t("home.madeForYou")}
            subtitle={
              madeForYouSeedTrack
                ? t("home.basedOn", {
                    title: shortenLabel(madeForYouSeedTrack.title, 22),
                  })
                : undefined
            }
            subtitleNumberOfLines={1}
            style={styles.sectionHeader}
          />
          {madeForYouTracks.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.horizontalListContent,
                isRtl ? styles.horizontalListContentRtl : null,
              ]}
            >
              {madeForYouTracks.map((track) => (
                <SongCard
                  key={track.id}
                  title={track.title}
                  subtitle={track.artist}
                  durationLabel={formatDuration(
                    track.duration,
                    t("home.recentlyPlayedFallback"),
                  )}
                  image={track.thumbnail}
                  colors={colors}
                  onPress={() => {
                    void playSuggestedQueue(madeForYouTracks, track);
                  }}
                />
              ))}
            </ScrollView>
          ) : isLoadingMadeForYou ? (
            <HorizontalSongSkeletonList />
          ) : (
            <EmptyStateCard
              label={t("home.playYoutubeToBuildMix")}
              colors={colors}
            />
          )}
        </View>

        <View style={styles.section}>
          <UiSectionHeader
            title={t("home.playedArtists")}
            style={styles.sectionHeader}
          />
          {navigablePlayedArtists.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.horizontalListContent,
                isRtl ? styles.horizontalListContentRtl : null,
              ]}
            >
              {navigablePlayedArtists.map((artist) => (
                <ArtistCard
                  key={artist.key}
                  artist={artist}
                  colors={colors}
                  playLabel={t("home.playSongsBy", { name: artist.name })}
                  onPress={() => {
                    navigation.navigate("Artist", {
                      artistId: artist.artistId,
                      artistName: artist.name,
                      artistImage: artist.image || "",
                      source: normalizeArtistSource(artist.source),
                    });
                  }}
                />
              ))}
            </ScrollView>
          ) : isLoadingArtists ? (
            <HorizontalArtistSkeletonList />
          ) : (
            <EmptyStateCard label={t("home.noRecentArtists")} colors={colors} />
          )}
        </View>

        {mostPlayedYoutubeArtist && heroTracks.length > 0 ? (
          <View style={styles.section}>
            <UiSectionHeader
              title={t("home.playSongsBy", {
                name: mostPlayedYoutubeArtist.name,
              })}
              style={styles.sectionHeader}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.horizontalListContent,
                isRtl ? styles.horizontalListContentRtl : null,
              ]}
            >
              {heroTracks.map((track) => (
                <SongCard
                  key={track.id}
                  title={track.title}
                  subtitle={track.artist}
                  durationLabel={formatDuration(
                    track.duration,
                    t("home.recentlyPlayedFallback"),
                  )}
                  image={track.thumbnail}
                  colors={colors}
                  onPress={() => {
                    void playSuggestedQueue(heroTracks, track);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : isLoadingHeroTracks ? (
          <View style={styles.section}>
            <UiSectionHeader
              title={t("home.playSongsBy", {
                name: mostPlayedYoutubeArtist?.name || t("home.unknownArtist"),
              })}
              style={styles.sectionHeader}
            />
            <HorizontalSongSkeletonList />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 140,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
  },
  headerTextBlock: {
    flex: 1,
  },
  greeting: {
    fontSize: 24,
    lineHeight: 30,
  },
  headerActions: {
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  headerPillButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerPillButtonText: {
    fontSize: 13,
    lineHeight: 16,
  },
  accountPillButton: {
    minHeight: 40,
    maxWidth: 220,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    gap: 8,
  },
  accountPillAvatarImage: {
    width: 32,
    height: 32,
    borderRadius: 999,
  },
  accountPillAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  accountPillAvatarFallbackText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "700",
  },
  accountPillButtonText: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "600",
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  heroCard: {
    minHeight: 220,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
  },
  heroImage: {
    borderRadius: 24,
  },
  heroContent: {
    flex: 1,
    padding: 18,
    justifyContent: "flex-start",
    alignItems: "flex-start",
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 24,
    lineHeight: 30,
  },
  heroPlayButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 64,
    height: 64,
    marginLeft: -32,
    marginTop: -32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 10,
  },
  emptyHero: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  emptyHeroEyebrow: {
    fontSize: 12,
    lineHeight: 16,
    textTransform: "uppercase",
    letterSpacing: 2.2,
  },
  emptyHeroTitle: {
    marginTop: 12,
    fontSize: 30,
    lineHeight: 36,
  },
  emptyHeroDescription: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
  },
  horizontalListContent: {
    paddingHorizontal: 16,
  },
  horizontalListContentRtl: {
    flexDirection: "row-reverse",
  },
  songCard: {
    width: 168,
    marginRight: 16,
  },
  songArtworkFrame: {
    aspectRatio: 1,
    borderRadius: 22,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 8,
  },
  songArtwork: {
    width: "100%",
    height: "100%",
  },
  songArtworkFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  songPlayBadge: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  songTitle: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 20,
  },
  songSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  songMeta: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  artistCard: {
    width: 168,
    marginRight: 16,
    alignItems: "center",
  },
  artistArtworkFrame: {
    width: 168,
    height: 168,
    borderRadius: 999,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 8,
  },
  artistArtwork: {
    width: "100%",
    height: "100%",
  },
  artistTitle: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
  },
  artistSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  emptyStateCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  emptyStateText: {
    textAlign: "center",
  },
});
