import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  FlatList,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer } from "../../contexts/PlayerContext";
import { SafeArea } from "../SafeArea";
import { t } from "../../utils/localization";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
const HEADER_HEIGHT = screenHeight * 0.45;

// Styled Components
const Container = styled.View`
  flex: 1;
  background-color: #000;
`;

const HeaderBackground = styled.ImageBackground`
  width: ${screenWidth}px;
  height: ${HEADER_HEIGHT}px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
`;

const HeaderGradient = styled(LinearGradient)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const HeaderContent = styled.View`
  flex: 1;
  justify-content: flex-end;
  padding: 24px;
  padding-bottom: 0px;
`;

const BackButton = styled.TouchableOpacity`
  position: absolute;
  top: 20px;
  left: 16px;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: rgba(0, 0, 0, 0.5);
  justify-content: center;
  align-items: center;
  z-index: 10;
`;

const ArtistName = styled.Text`
  color: #fff;
  font-size: 64px;
  margin-bottom: 8px;
  font-family: GoogleSansBold;
  line-height: 68px;
`;

const MonthlyListeners = styled.Text`
  color: #a3a3a3;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const ContentContainer = styled.View`
  flex: 1;
  background-color: #000;
  padding-top: 16px;
  padding-bottom: 120px;
`;

const ActionButtonsRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  margin-bottom: 18px;
`;

const LeftButtons = styled.View`
  flex-direction: row;
  align-items: center;
`;

const FollowButton = styled.TouchableOpacity`
  padding: 12px 24px;
  border-radius: 25px;
  border: 1px solid #a3a3a3;
  background-color: transparent;
  margin-right: 16px;
`;

const FollowButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansMedium;
  line-height: 20px;
`;

const MoreOptionsButton = styled.TouchableOpacity`
  padding: 8px;
`;

const PlayShuffleButton = styled.TouchableOpacity`
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background-color: #1db954;
  justify-content: center;
  align-items: center;
  position: relative;
`;

const ShuffleIconContainer = styled.View`
  position: absolute;
  bottom: -4px;
  right: -4px;
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background-color: #fff;
  justify-content: center;
  align-items: center;
`;

const PopularSection = styled.View`
  padding: 0 24px;
`;

const PopularTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  margin-bottom: 16px;
  font-family: GoogleSansBold;
  line-height: 28px;
`;

const SongItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding: 12px 0;
`;

const TrackNumber = styled.Text`
  color: #a3a3a3;
  font-size: 16px;
  width: 30px;
  text-align: center;
  margin-right: 16px;
`;

const SongThumbnail = styled.Image`
  width: 56px;
  height: 56px;
  border-radius: 4px;
  background-color: #333;
  margin-right: 16px;
`;

const SongDetails = styled.View`
  flex: 1;
  justify-content: center;
`;

const SongTitle = styled.Text`
  color: #fff;
  font-size: 16px;
  margin-bottom: 4px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const PlayCount = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const MoreOptionsIcon = styled.TouchableOpacity`
  padding: 8px;
`;

const AlbumsSection = styled.View`
  padding: 0 24px;
`;

const AlbumsTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  margin-bottom: 16px;
  font-family: GoogleSansBold;
  line-height: 28px;
`;

const AlbumsGrid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
`;

const AlbumItem = styled.TouchableOpacity`
  width: 48%;
  margin-bottom: 16px;
`;

const AlbumImage = styled.Image`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  background-color: #333;
`;

const AlbumTitle = styled.Text`
  color: #fff;
  font-size: 14px;
  margin-top: 8px;
  font-family: GoogleSansMedium;
  line-height: 18px;
`;

const AlbumYear = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const LoadingContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #000;
`;

const ErrorContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #000;
  padding: 24px;
`;

const ErrorText = styled.Text`
  color: #fff;
  font-size: 16px;
  text-align: center;
  margin-bottom: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const RetryButton = styled.TouchableOpacity`
  background-color: #1db954;
  padding: 12px 24px;
  border-radius: 25px;
`;

const RetryButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansSemiBold;
  line-height: 20px;
`;

// Category Tabs
const CategoryTabs = styled.View`
  flex-direction: row;
  padding: 0 24px;
  margin-bottom: 24px;
  border-bottom-width: 1px;
  border-bottom-color: #333;
`;

const CategoryTab = styled.TouchableOpacity<{ isActive: boolean }>`
  padding: 12px 16px;
  margin-right: 8px;
  border-bottom-width: 2px;
  border-bottom-color: ${(props) =>
    props.isActive ? "#1db954" : "transparent"};
`;

const CategoryTabText = styled.Text<{ isActive: boolean }>`
  color: ${(props) => (props.isActive ? "#fff" : "#a3a3a3")};
  font-size: 16px;
  font-family: ${(props) =>
    props.isActive ? "GoogleSansMedium" : "GoogleSansRegular"};
  line-height: 20px;
`;

// Interfaces
interface ArtistScreenProps {
  navigation: any;
  route: any;
}

interface Artist {
  id: string;
  name: string;
  image: string;
  monthlyListeners?: number;
}

interface Song {
  id: string;
  title: string;
  thumbnail: string;
  playCount: number;
  source?: string;
  _isJioSaavn?: boolean;
}

interface Album {
  id: string;
  title: string;
  year: string;
  thumbnail: string;
}

const ArtistScreen: React.FC<ArtistScreenProps> = ({ navigation, route }) => {
  const { playTrack } = usePlayer();
  const [artistData, setArtistData] = useState<Artist | null>(null);
  const [popularSongs, setPopularSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<
    "songs" | "albums" | "playlists"
  >("songs");
  const [isYouTubeChannel, setIsYouTubeChannel] = useState(false);

  const { artistId, artistName } = route.params;

  // Function to fetch YouTube albums for a channel
  const fetchYouTubeAlbums = async (channelId: string) => {
    try {
      // First, try to get the channel data to access tabs
      const channelResponse = await fetch(
        `https://api.piped.private.coffee/channel/${channelId}`
      );
      const channelData = await channelResponse.json();

      console.log("Channel tabs data for albums:", channelData.tabs);

      // Look for albums tab data
      const albumsTab = channelData.tabs?.find(
        (tab: any) => tab.name === "albums"
      );
      if (albumsTab && albumsTab.data) {
        try {
          // Use the correct GET format for the tabs endpoint
          const albumsTabData = JSON.parse(albumsTab.data);
          const encodedData = encodeURIComponent(JSON.stringify(albumsTabData));
          const albumsResponse = await fetch(
            `https://api.piped.private.coffee/channels/tabs?data=${encodedData}`
          );

          if (albumsResponse.ok) {
            const albumsData = await albumsResponse.json();
            console.log("Albums data fetched successfully:", albumsData);

            // Process the albums data
            if (albumsData.content && Array.isArray(albumsData.content)) {
              return albumsData.content.map((album: any, index: number) => ({
                id: album.url || `album_${index}`,
                title:
                  album.name ||
                  album.title ||
                  t("screens.artist.unknown_album"),
                thumbnail:
                  album.thumbnail ||
                  "https://via.placeholder.com/160x160/333/ffffff?text=Album",
                year: album.year || "",
                type: "album",
                songCount: album.videos || 0,
              }));
            }
          }
        } catch (apiError) {
          console.log(
            "Failed to fetch albums from tabs endpoint, using fallback:",
            apiError
          );
        }
      }

      // Fallback: Create albums from relatedStreams data by grouping by upload date
      const relatedStreams = channelData.relatedStreams || [];

      // Group videos by upload year to create "albums"
      const yearGroups = relatedStreams.reduce((groups: any, video: any) => {
        const year = new Date(video.uploaded).getFullYear();
        if (!groups[year]) {
          groups[year] = [];
        }
        groups[year].push(video);
        return groups;
      }, {});

      // Create albums from year groups
      const albums = Object.keys(yearGroups)
        .map((year, index) => ({
          id: `album_${year}`,
          title: `${year} Releases`,
          thumbnail:
            yearGroups[year][0]?.thumbnail ||
            "https://via.placeholder.com/160x160/333/ffffff?text=Album",
          year: year,
          type: "album",
          songCount: yearGroups[year].length,
        }))
        .sort((a, b) => parseInt(b.year) - parseInt(a.year));

      return albums;
    } catch (error) {
      console.error("Error fetching YouTube albums:", error);
      return [];
    }
  };

  // Function to fetch YouTube playlists for a channel
  const fetchYouTubePlaylists = async (channelId: string) => {
    try {
      // First, try to get the channel data to access tabs
      const channelResponse = await fetch(
        `https://api.piped.private.coffee/channel/${channelId}`
      );
      const channelData = await channelResponse.json();

      console.log("Channel tabs data:", channelData.tabs);

      // Look for playlists tab data
      const playlistsTab = channelData.tabs?.find(
        (tab: any) => tab.name === "playlists"
      );
      if (playlistsTab && playlistsTab.data) {
        try {
          // Use the correct GET format for the tabs endpoint
          const playlistsTabData = JSON.parse(playlistsTab.data);
          const encodedData = encodeURIComponent(
            JSON.stringify(playlistsTabData)
          );
          const playlistsResponse = await fetch(
            `https://api.piped.private.coffee/channels/tabs?data=${encodedData}`
          );

          if (playlistsResponse.ok) {
            const playlistsData = await playlistsResponse.json();
            console.log("Playlists data fetched successfully:", playlistsData);

            // Process the playlists data
            if (playlistsData.content && Array.isArray(playlistsData.content)) {
              return playlistsData.content.map(
                (playlist: any, index: number) => ({
                  id: playlist.url || `playlist_${index}`,
                  title:
                    playlist.name ||
                    playlist.title ||
                    t("screens.artist.unknown_playlist"),
                  thumbnail:
                    playlist.thumbnail ||
                    "https://via.placeholder.com/160x160/333/ffffff?text=Playlist",
                  videoCount: playlist.videos || playlist.videoCount || 0,
                  type: "playlist",
                })
              );
            }
          }
        } catch (apiError) {
          console.log(
            "Failed to fetch playlists from tabs endpoint, using fallback:",
            apiError
          );
        }
      }

      // Fallback: Create playlists from relatedStreams data by grouping similar content
      const relatedStreams = channelData.relatedStreams || [];

      // Group videos by common themes or upload dates
      const playlists = [
        {
          id: "recent_videos",
          title: t("screens.artist.recent_videos"),
          thumbnail:
            relatedStreams[0]?.thumbnail ||
            "https://via.placeholder.com/160x160/333/ffffff?text=Recent",
          videoCount: Math.min(relatedStreams.length, 10),
          type: "playlist",
        },
        {
          id: "popular_videos",
          title: t("screens.artist.popular_videos"),
          thumbnail:
            relatedStreams.find((v: any) => v.views > 1000000)?.thumbnail ||
            "https://via.placeholder.com/160x160/333/ffffff?text=Popular",
          videoCount:
            relatedStreams.filter((v: any) => v.views > 1000000).length || 5,
          type: "playlist",
        },
        {
          id: "official_audio",
          title: t("screens.artist.official_audio"),
          thumbnail:
            relatedStreams.find((v: any) => v.title?.includes("Official Audio"))
              ?.thumbnail ||
            "https://via.placeholder.com/160x160/333/ffffff?text=Audio",
          videoCount:
            relatedStreams.filter((v: any) =>
              v.title?.includes("Official Audio")
            ).length || 5,
          type: "playlist",
        },
      ].filter((playlist) => playlist.videoCount > 0);

      return playlists;
    } catch (error) {
      console.error("Error fetching YouTube playlists:", error);
      return [];
    }
  };

  useEffect(() => {
    fetchArtistData();
  }, [artistId]);

  const fetchArtistData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if this is a YouTube channel (ID starts with "UC" or similar YouTube channel pattern)
      const isYouTubeChannel =
        artistId.startsWith("UC") ||
        artistId.startsWith("U") ||
        artistId.length === 24;

      setIsYouTubeChannel(isYouTubeChannel);

      if (isYouTubeChannel) {
        // Use Piped API for YouTube channels
        const channelResponse = await fetch(
          `https://api.piped.private.coffee/channel/${artistId}`
        );
        const channelData = await channelResponse.json();
        console.log("YouTube channel API response:", channelData);

        // Process YouTube channel data
        const processedArtist: Artist = {
          id: artistId,
          name: channelData.name || artistName,
          image:
            channelData.avatarUrl ||
            "https://via.placeholder.com/500x500/1a1a1a/ffffff?text=Artist",
          monthlyListeners: channelData.subscribers || 0,
        };

        // Process channel videos as songs - show all available videos
        const processedSongs: Song[] = (channelData.relatedStreams || []).map(
          (video: any, index: number) => ({
            id: video.url?.split("v=")[1] || video.id || `video_${index}`,
            title: video.title || t("screens.artist.unknown_title"),
            thumbnail:
              video.thumbnail ||
              "https://via.placeholder.com/56x56/333/ffffff?text=V",
            playCount: video.views || 0,
            source: "youtube",
            _isJioSaavn: false,
          })
        );

        // Process channel tabs data for albums and playlists
        const tabsData = channelData.tabs || [];
        console.log("Available tabs from channel:", tabsData);

        // Process albums from tabs data
        const processedAlbums = await fetchYouTubeAlbums(artistId);

        // Process playlists from tabs data
        const processedPlaylists = await fetchYouTubePlaylists(artistId);

        setArtistData(processedArtist);
        setPopularSongs(processedSongs);
        setAlbums(processedAlbums);
        setPlaylists(processedPlaylists);
        setLoading(false);
        return;

        // YouTube channels don't have traditional albums, but we could show playlists if needed
        // For now, we'll leave albums empty for YouTube channels

        setArtistData(processedArtist);
        setPopularSongs(processedSongs);
        setAlbums(processedAlbums);
        setLoading(false);
        return;
      }

      // Original JioSaavn API logic for non-YouTube artists
      // Fetch artist info
      const artistResponse = await fetch(
        `https://streamifyjiosaavn.vercel.app/api/artists/${artistId}`
      );
      const artistInfo = await artistResponse.json();
      console.log("Artist info API response:", artistInfo);

      // Validate artist response
      const artistData = artistInfo.data || artistInfo;
      if (!artistData || (!artistData.name && !artistName)) {
        throw new Error("Invalid artist data received");
      }

      // Fetch artist songs
      const songsResponse = await fetch(
        `https://streamifyjiosaavn.vercel.app/api/artists/${artistId}/songs?page=0`
      );
      let songsData;
      try {
        songsData = await songsResponse.json();
        console.log("Songs API response:", songsData);
      } catch (e) {
        console.warn("Failed to parse songs JSON, using empty array");
        songsData = [];
      }

      // Fetch artist albums
      const albumsResponse = await fetch(
        `https://streamifyjiosaavn.vercel.app/api/artists/${artistId}/albums?page=0`
      );
      let albumsData;
      try {
        albumsData = await albumsResponse.json();
        console.log("Albums API response:", albumsData);
      } catch (e) {
        console.warn("Failed to parse albums JSON, using empty array");
        albumsData = [];
      }

      // Process artist data - use best quality image available
      const getBestQualityImage = (images: any[]): string => {
        if (!images || images.length === 0) {
          return "https://via.placeholder.com/500x500/1a1a1a/ffffff?text=Artist";
        }

        // Priority order for image qualities (best to worst)
        const qualityPriority = [
          "1500x1500",
          "1000x1000",
          "800x800",
          "500x500",
          "400x400",
          "300x300",
          "200x200",
          "150x150",
          "100x100",
          "50x50",
        ];

        // Try to find the best quality image
        for (const quality of qualityPriority) {
          const image = images.find((img: any) => img.quality === quality);
          if (image && image.url) {
            return image.url;
          }
        }

        // Fallback to first available image
        return (
          images[0]?.url ||
          "https://via.placeholder.com/500x500/1a1a1a/ffffff?text=Artist"
        );
      };

      const processedArtist: Artist = {
        id: artistId,
        name: artistData.name || artistName,
        image: getBestQualityImage(artistData.image),
        monthlyListeners: artistData.followers || artistData.followerCount || 0,
      };

      // Process songs - handle different response structures
      const songsArray = Array.isArray(songsData)
        ? songsData
        : songsData.data?.songs || songsData.data || songsData.songs || [];

      const processedSongs: Song[] = songsArray
        .slice(0, 5)
        .map((song: any, index: number) => ({
          id: String(song.id || song.songId),
          title: song.title || song.name || t("screens.artist.unknown_title"),
          thumbnail:
            song.image?.find((img: any) => img.quality === "500x500")?.url ||
            song.image?.[0]?.url ||
            song.thumbnail ||
            "https://via.placeholder.com/56x56/333/ffffff?text=" + (index + 1),
          playCount:
            parseInt(song.playCount) ||
            parseInt(song.playcount) ||
            Math.floor(Math.random() * 1000000000),
          // Add JioSaavn metadata for proper playback
          source: "jiosaavn",
          _isJioSaavn: true,
        }));

      // Process albums - handle different response structures
      const albumsArray = Array.isArray(albumsData)
        ? albumsData
        : albumsData.data?.albums || albumsData.data || albumsData.albums || [];

      console.log("Processing albums array:", albumsArray);

      const processedAlbums: Album[] = albumsArray
        .slice(0, 6)
        .map((album: any) => {
          console.log("Processing individual album:", album);
          return {
            id: String(album.id || album.albumId),
            title:
              album.title || album.name || t("screens.artist.unknown_album"),
            year: album.year || album.releaseYear || "",
            thumbnail:
              album.image?.find((img: any) => img.quality === "500x500")?.url ||
              album.image?.[0]?.url ||
              album.thumbnail ||
              "https://via.placeholder.com/160x160/333/ffffff?text=Album",
          };
        });

      setArtistData(processedArtist);
      setPopularSongs(processedSongs);
      setAlbums(processedAlbums);
    } catch (err) {
      console.error("Error fetching artist data:", err);
      setError("Failed to load artist data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePlaySong = (song: Song, index: number) => {
    // Convert to track format for player
    const track = {
      id: song.id,
      title: song.title,
      artist: artistData?.name || t("screens.artist.unknown_artist"),
      thumbnail: song.thumbnail,
      duration: 0,
      url: "",
      // Use the song's source if available (YouTube), otherwise default to JioSaavn
      source: song.source || "jiosaavn",
      _isJioSaavn: song._isJioSaavn || false,
    };
    playTrack(
      track,
      popularSongs.map((s) => ({
        id: s.id,
        title: s.title,
        artist: artistData?.name || t("screens.artist.unknown_artist"),
        thumbnail: s.thumbnail,
        duration: 0,
        url: "",
        // Use the song's source if available (YouTube), otherwise default to JioSaavn
        source: s.source || "jiosaavn",
        _isJioSaavn: s._isJioSaavn || false,
      })),
      index
    );
  };

  const handlePlayAll = () => {
    if (popularSongs.length > 0) {
      handlePlaySong(popularSongs[0], 0);
    }
  };

  const handleShuffle = () => {
    if (popularSongs.length > 0) {
      const randomIndex = Math.floor(Math.random() * popularSongs.length);
      handlePlaySong(popularSongs[randomIndex], randomIndex);
    }
  };

  const handleFollow = () => {
    setIsFollowing(!isFollowing);
  };

  const formatPlayCount = (count: number) => {
    if (count >= 1000000000) {
      return `${(count / 1000000000).toFixed(1)}B`;
    } else if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const formatMonthlyListeners = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  if (loading) {
    return (
      <SafeArea>
        <LoadingContainer>
          <ActivityIndicator size="large" color="#1db954" />
        </LoadingContainer>
      </SafeArea>
    );
  }

  if (error) {
    return (
      <SafeArea>
        <ErrorContainer>
          <ErrorText>{error}</ErrorText>
          <RetryButton onPress={fetchArtistData}>
            <RetryButtonText>{t("screens.artist.retry")}</RetryButtonText>
          </RetryButton>
        </ErrorContainer>
      </SafeArea>
    );
  }

  if (!artistData) {
    return (
      <SafeArea>
        <ErrorContainer>
          <ErrorText>{t("screens.artist.artist_not_found")}</ErrorText>
          <RetryButton onPress={() => navigation.goBack()}>
            <RetryButtonText>{t("screens.artist.go_back")}</RetryButtonText>
          </RetryButton>
        </ErrorContainer>
      </SafeArea>
    );
  }

  const renderSongItem = ({ item, index }: { item: Song; index: number }) => (
    <SongItem onPress={() => handlePlaySong(item, index)}>
      <TrackNumber>{index + 1}</TrackNumber>
      <SongThumbnail source={{ uri: item.thumbnail }} />
      <SongDetails>
        <SongTitle numberOfLines={1}>{item.title}</SongTitle>
        <PlayCount>
          {formatPlayCount(item.playCount)} {t("screens.artist.plays")}
        </PlayCount>
      </SongDetails>
      <MoreOptionsIcon>
        <Ionicons name="ellipsis-horizontal" size={20} color="#a3a3a3" />
      </MoreOptionsIcon>
    </SongItem>
  );

  const renderAlbumItem = ({ item }: { item: Album }) => (
    <AlbumItem
      onPress={() =>
        navigation.navigate("AlbumPlaylist", {
          albumId: item.id,
          albumName: item.title,
          source: "jiosaavn", // Add source parameter for proper JioSaavn album handling
        })
      }
    >
      <AlbumImage source={{ uri: item.thumbnail }} />
      <AlbumTitle numberOfLines={1}>{item.title}</AlbumTitle>
      <AlbumYear>{item.year}</AlbumYear>
    </AlbumItem>
  );

  return (
    <SafeArea>
      <Container>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Header Section */}
          <View style={{ height: HEADER_HEIGHT, position: "relative" }}>
            <HeaderBackground source={{ uri: artistData.image }}>
              <HeaderGradient
                colors={[
                  "transparent",
                  "rgba(0, 0, 0, 0.7)",
                  "rgba(0, 0, 0, 0.9)",
                  "#000",
                ]}
                locations={[0, 0.5, 0.8, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
              />
            </HeaderBackground>
            <BackButton onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </BackButton>
            <HeaderContent>
              <ArtistName>{artistData.name}</ArtistName>
              {artistData.monthlyListeners && (
                <MonthlyListeners>
                  {formatMonthlyListeners(artistData.monthlyListeners)}{" "}
                  {t("screens.artist.monthly_listeners")}
                </MonthlyListeners>
              )}
            </HeaderContent>
          </View>

          {/* Content Section */}
          <ContentContainer>
            {/* Action Buttons Row */}
            <ActionButtonsRow>
              <LeftButtons>
                <FollowButton onPress={handleFollow}>
                  <FollowButtonText>
                    {isFollowing
                      ? t("screens.artist.following")
                      : t("screens.artist.follow")}
                  </FollowButtonText>
                </FollowButton>
                <MoreOptionsButton>
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={24}
                    color="#a3a3a3"
                  />
                </MoreOptionsButton>
              </LeftButtons>

              <PlayShuffleButton onPress={handlePlayAll}>
                <Ionicons name="play" size={24} color="#000" />
                <ShuffleIconContainer>
                  <Ionicons name="shuffle" size={12} color="#000" />
                </ShuffleIconContainer>
              </PlayShuffleButton>
            </ActionButtonsRow>

            {/* Category Tabs - Show for all sources */}
            <CategoryTabs>
              <CategoryTab
                isActive={activeCategory === "songs"}
                onPress={() => setActiveCategory("songs")}
              >
                <CategoryTabText isActive={activeCategory === "songs"}>
                  {t("screens.artist.songs")}
                </CategoryTabText>
              </CategoryTab>
              <CategoryTab
                isActive={activeCategory === "albums"}
                onPress={() => setActiveCategory("albums")}
              >
                <CategoryTabText isActive={activeCategory === "albums"}>
                  {t("screens.artist.albums")}
                </CategoryTabText>
              </CategoryTab>
              {isYouTubeChannel && (
                <CategoryTab
                  isActive={activeCategory === "playlists"}
                  onPress={() => setActiveCategory("playlists")}
                >
                  <CategoryTabText isActive={activeCategory === "playlists"}>
                    {t("screens.artist.playlists")}
                  </CategoryTabText>
                </CategoryTab>
              )}
            </CategoryTabs>

            {/* Content based on active category */}
            {activeCategory === "songs" && (
              <PopularSection>
                <PopularTitle>
                  {isYouTubeChannel ? t("screens.artist.videos") : "Popular"}
                </PopularTitle>
                <FlatList
                  data={popularSongs}
                  renderItem={renderSongItem}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  showsVerticalScrollIndicator={false}
                />
              </PopularSection>
            )}
            {activeCategory === "albums" && (
              <AlbumsSection>
                <AlbumsTitle>Albums</AlbumsTitle>
                <AlbumsGrid>
                  {albums.map((album) => (
                    <AlbumItem
                      key={album.id}
                      onPress={() => {
                        console.log("Navigating to album:", {
                          albumId: album.id,
                          albumName: album.title,
                          albumArtist:
                            artistData?.name ||
                            t("screens.artist.unknown_artist"),
                          source: isYouTubeChannel ? "youtube" : "jiosaavn",
                        });
                        navigation.navigate("AlbumPlaylist", {
                          albumId: album.id,
                          albumName: album.title,
                          albumArtist:
                            artistData?.name ||
                            t("screens.artist.unknown_artist"),
                          source: isYouTubeChannel ? "youtube" : "jiosaavn",
                        });
                      }}
                    >
                      <AlbumImage source={{ uri: album.thumbnail }} />
                      <AlbumTitle numberOfLines={1}>{album.title}</AlbumTitle>
                      <AlbumYear>{album.year}</AlbumYear>
                    </AlbumItem>
                  ))}
                </AlbumsGrid>
              </AlbumsSection>
            )}
            {activeCategory === "playlists" && isYouTubeChannel && (
              <AlbumsSection>
                <AlbumsTitle>Playlists</AlbumsTitle>
                <AlbumsGrid>
                  {playlists.map((playlist) => (
                    <AlbumItem
                      key={playlist.id}
                      onPress={() => {
                        console.log("Navigating to playlist:", {
                          playlistId: playlist.id,
                          playlistName: playlist.title,
                        });
                        navigation.navigate("AlbumPlaylist", {
                          albumId: playlist.id,
                          albumName: playlist.title,
                          albumArtist:
                            artistData?.name ||
                            t("screens.artist.unknown_artist"),
                          source: "youtube",
                        });
                      }}
                    >
                      <AlbumImage source={{ uri: playlist.thumbnail }} />
                      <AlbumTitle numberOfLines={1}>
                        {playlist.title}
                      </AlbumTitle>
                      <AlbumYear>{playlist.videoCount} videos</AlbumYear>
                    </AlbumItem>
                  ))}
                </AlbumsGrid>
              </AlbumsSection>
            )}
          </ContentContainer>
        </ScrollView>
      </Container>
    </SafeArea>
  );
};

export default ArtistScreen;
