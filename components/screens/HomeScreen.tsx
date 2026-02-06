import React, { useState, useEffect } from "react";
import { ScrollView } from "react-native";
import styled from "styled-components/native";
import { default as StreamItem } from "../StreamItem";
import { SafeArea } from "../SafeArea";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer } from "../../contexts/PlayerContext";
import {
  FeaturedPlaylistSkeleton,
  CategoryPlaylistSkeleton,
} from "../SkeletonLoader";
import {
  getJioSaavnPlaylistEndpoint,
  getJioSaavnPlaylistByIdEndpoint,
  fetchWithRetry,
} from "../core/api";

// API endpoints for your Lowkey Backend
const CATEGORY_APIS = {
  indie: getJioSaavnPlaylistEndpoint("indie"),
  edm: getJioSaavnPlaylistEndpoint("edm"),
  metal: getJioSaavnPlaylistEndpoint("metal"),
  punk: getJioSaavnPlaylistEndpoint("punk"),
  party: getJioSaavnPlaylistEndpoint("party"),
  jazz: getJioSaavnPlaylistEndpoint("jazz"),
  love: getJioSaavnPlaylistEndpoint("love"),
  rap: getJioSaavnPlaylistEndpoint("rap"),
  workout: getJioSaavnPlaylistEndpoint("workout"),
  pop: getJioSaavnPlaylistEndpoint("pop"),
  hiphop: getJioSaavnPlaylistEndpoint("hiphop"),
  rock: getJioSaavnPlaylistEndpoint("rock"),
  melody: getJioSaavnPlaylistEndpoint("melody"),
  lofi: getJioSaavnPlaylistEndpoint("lofi"),
  chill: getJioSaavnPlaylistEndpoint("chill"),
  focus: getJioSaavnPlaylistEndpoint("focus"),
  instrumental: getJioSaavnPlaylistEndpoint("instrumental"),
  folk: getJioSaavnPlaylistEndpoint("folk"),
  devotional: getJioSaavnPlaylistEndpoint("devotional"),
  ambient: getJioSaavnPlaylistEndpoint("ambient"),
  sleep: getJioSaavnPlaylistEndpoint("sleep"),
  soul: getJioSaavnPlaylistEndpoint("soul"),
};

// Featured playlist IDs
const FEATURED_PLAYLIST_IDS = [
  "1265154514",
  "1223482895",
  "2252904",
  "158206266",
  "1210453303",
];

// Existing styled components
const Section = styled.View`
  margin-bottom: 12px;
  margin-top: 12px;
`;

const ChipsContainer = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 16px 0;
`;

const ProfileContainer = styled(LinearGradient).attrs({
  colors: ["rgba(0, 0, 0, 1)", "rgba(0, 0, 0, 0.3)", "rgba(0, 0, 0, 0.0)"],
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
})`
  width: 28px;
  height: 28px;
  border-radius: 16px;
  margin-left: 16px;
  margin-right: 10px;
  shadow-color: #000;
  shadow-offset: 3px 3px;
  shadow-opacity: 0.4;
  shadow-radius: 6px;
  elevation: 8;
`;

const UserProfileImage = styled.Image`
  width: 100%;
  height: 100%;
  border-radius: 20px;
`;

const ChipsScrollView = styled.ScrollView`
  flex: 1;
  padding-right: 16px;
`;

const ChipsContent = styled.View`
  flex-direction: row;
  align-items: center;
`;

const Chip = styled.TouchableOpacity<{ active?: boolean }>`
  padding: 8px 16px;
  border-radius: 999px;
  background-color: ${(p: { active?: boolean }) =>
    p.active ? "#a3e635" : "#262626"};
  margin-right: 8px;
`;

const ChipText = styled.Text<{ active?: boolean }>`
  color: ${(p: { active?: boolean }) => (p.active ? "#000" : "#fff")};
  font-size: 14px;
  font-family: GoogleSansMedium;
  line-height: 18px;
`;

const SectionHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  margin-bottom: 16px;
`;

const SectionTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  font-family: GoogleSansSemiBold;
  line-height: 22px;
`;

const HorizontalScroll = styled.ScrollView`
  padding: 0 16px;
`;

const Card = styled.TouchableOpacity`
  width: 160px;
  margin-right: 16px;
`;

const CardImage = styled.Image`
  width: 160px;
  height: 160px;
  border-radius: 12px;
`;

const CardTitle = styled.Text`
  color: #fff;
  margin-top: 8px;
  font-size: 14px;
  font-family: GoogleSansMedium;
  line-height: 18px;
`;

const CardMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const Row = styled.View`
  padding: 0 16px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled.Text`
  color: #fff;
  font-size: 18px;
  font-family: GoogleSansSemiBold;
  line-height: 22px;
`;

const SubtitleBtn = styled.TouchableOpacity``;

const SubtitleText = styled.Text`
  color: #a3e635;
  font-family: GoogleSansRegular;
`;

const Horizontal = styled.ScrollView`
  padding: 16px 0 0 16px;
`;

const CollectionWrap = styled.View`
  padding: 0 16px;
  flex-direction: row;
`;

const CollectionCard = styled.View`
  flex: 1;
  flex-direction: row;
  align-items: center;
  background-color: #171717;
  border-radius: 12px;
  padding: 16px;
`;

const CollectionInfo = styled.View`
  flex: 1;
`;

const CollectionTitle = styled.Text`
  color: #fff;
  font-family: GoogleSansSemiBold;
  line-height: 20px;
`;

const CollectionSub = styled.Text`
  color: #a3a3a3;
  margin-top: 4px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const Arrow = styled.Text`
  color: #a3e635;
  margin-top: 8px;
  font-family: GoogleSansMedium;
  line-height: 16px;
`;

const LoadingContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #000;
  padding: 40px 0;
`;

const ErrorText = styled.Text`
  color: #ff4444;
  text-align: center;
  padding: 20px;
  font-family: GoogleSansRegular;
`;

interface Playlist {
  id: string;
  name: string;
  type: string;
  image: Array<{
    quality: string;
    url: string;
  }>;
  url: string;
  songCount: number;
  language: string;
  explicitContent: boolean;
}

export default function HomeScreen({ navigation }: any) {
  const { playTrack } = usePlayer();
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    "all",
  ]);
  const [categoryData, setCategoryData] = useState<{
    [key: string]: Playlist[];
  }>({});
  const [featuredPlaylists, setFeaturedPlaylists] = useState<Playlist[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);

  // Filter out Hindi/Indian playlists
  // Fetch playlist data for a specific category
  const fetchCategoryPlaylists = async (category: string) => {
    try {
      const data = await fetchWithRetry<any>(
        CATEGORY_APIS[category as keyof typeof CATEGORY_APIS],
        {},
        3,
        1000
      );

      if (data.success && data.data?.results) {
        const playlists = data.data.results.slice(0, 6);
        setCategoryData((prev) => ({ ...prev, [category]: playlists }));
      }
    } catch (error) {
      console.error(`Failed to fetch ${category} playlists:`, error);
    }
  };

  // Fetch featured playlist
  const fetchFeaturedPlaylists = async () => {
    try {
      setLoadingFeatured(true);

      // Fetch all featured playlists in parallel for faster loading
      const playlistPromises = FEATURED_PLAYLIST_IDS.map(async (playlistId) => {
        try {
          const data = await fetchWithRetry<any>(
            getJioSaavnPlaylistByIdEndpoint(playlistId),
            {},
            3,
            1000
          );
          console.log(
            `[DEBUG] Playlist ${playlistId} response:`,
            JSON.stringify(data, null, 2)
          );
          if (data.success && data.data) {
            return data.data;
          }
          return null;
        } catch (error) {
          console.error(
            `Failed to fetch featured playlist ${playlistId}:`,
            error
          );
          return null;
        }
      });

      // Wait for all playlists to load in parallel
      const featuredData = await Promise.all(playlistPromises);

      // Filter out any null results (failed fetches)
      const validPlaylists = featuredData.filter(
        (playlist) => playlist !== null
      );

      console.log(`[DEBUG] Valid playlists count: ${validPlaylists.length}`);
      console.log(
        `[DEBUG] First playlist structure:`,
        JSON.stringify(validPlaylists[0], null, 2)
      );

      // Transform playlist data to match expected interface
      const transformedPlaylists = validPlaylists.map((playlist) => {
        try {
          // Handle different possible API response formats
          const playlistData = {
            id: playlist.id || playlist.playlistId || "",
            name:
              playlist.name ||
              playlist.title ||
              playlist.playlistName ||
              "Unknown Playlist",
            type: playlist.type || "playlist",
            image:
              playlist.image || playlist.images || playlist.imageUrl
                ? Array.isArray(playlist.image)
                  ? playlist.image
                  : Array.isArray(playlist.images)
                    ? playlist.images
                    : playlist.imageUrl
                      ? [{ quality: "500x500", url: playlist.imageUrl }]
                      : []
                : [],
            url: playlist.url || playlist.permaUrl || "",
            songCount:
              playlist.songCount ||
              playlist.songsCount ||
              playlist.songs?.length ||
              0,
            language: playlist.language || "Unknown",
            explicitContent: playlist.explicitContent || false,
          };

          // If no images found, add a default one
          if (playlistData.image.length === 0) {
            playlistData.image = [
              {
                quality: "500x500",
                url: "https://via.placeholder.com/500x500.png?text=No+Image",
              },
            ];
          }

          return playlistData;
        } catch (error) {
          console.error(`[DEBUG] Error transforming playlist:`, error);
          // Return a default playlist structure if transformation fails
          return {
            id: "error",
            name: "Error Loading Playlist",
            type: "playlist",
            image: [
              {
                quality: "500x500",
                url: "https://via.placeholder.com/500x500.png?text=Error",
              },
            ],
            url: "",
            songCount: 0,
            language: "Unknown",
            explicitContent: false,
          };
        }
      });

      console.log(
        `[DEBUG] Transformed first playlist:`,
        JSON.stringify(transformedPlaylists[0], null, 2)
      );

      setFeaturedPlaylists(transformedPlaylists);
    } catch (error) {
      console.error("Failed to fetch featured playlists:", error);
    } finally {
      setLoadingFeatured(false);
    }
  };

  // Toggle category selection
  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => {
      // Handle "All" button logic
      if (category === "all") {
        return ["all"];
      }

      // If "All" is currently selected, switch to only the new category
      if (prev.includes("all")) {
        fetchCategoryPlaylists(category);
        return [category];
      }

      // Handle normal category toggling
      const newCategories = prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category];

      // Fetch data for newly selected categories
      if (!prev.includes(category)) {
        fetchCategoryPlaylists(category);
      }

      // If no categories selected, default to "All"
      return newCategories.length === 0 ? ["all"] : newCategories;
    });
  };

  // Load initial data
  useEffect(() => {
    // Load featured playlists first (now in parallel for faster loading)
    fetchFeaturedPlaylists();

    // Load categories with a small delay to prioritize featured playlists
    // This ensures featured playlists appear to load first
    const categoryLoadTimeout = setTimeout(() => {
      if (selectedCategories.includes("all")) {
        // Load all categories when "All" is selected
        Object.keys(CATEGORY_APIS).forEach((category) => {
          fetchCategoryPlaylists(category);
        });
      } else {
        // Load only selected categories
        selectedCategories.forEach((category) => {
          fetchCategoryPlaylists(category);
        });
      }
    }, 200); // Small delay to prioritize featured playlists

    return () => clearTimeout(categoryLoadTimeout);
  }, []);

  const handlePlayTrack = (track: any) => {
    if (track && track.name && track.artists && track.preview_url) {
      playTrack({
        id: track.id,
        title: track.name,
        artist: track.artists[0]?.name || "Unknown Artist",
        audioUrl: track.preview_url,
        thumbnail: track.album?.images[0]?.url || "",
        duration: track.duration_ms,
      });
    }
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    if (playlist && playlist.id) {
      console.log("Playing playlist:", playlist.name);
      navigation.navigate("Playlist", {
        playlistId: playlist.id,
        playlistName: playlist.name,
      });
    }
  };

  const getPlaylistImageSource = (playlist: Playlist) => {
    try {
      console.log(
        `[DEBUG] Playlist ${playlist.id} image data:`,
        JSON.stringify(playlist.image, null, 2)
      );

      // Ensure playlist.image is an array
      const imageArray = Array.isArray(playlist.image) ? playlist.image : [];

      const highQualityImage = imageArray.find(
        (img) => img && img.quality === "500x500"
      );
      const imageUrl = highQualityImage?.url || imageArray[0]?.url;

      // Return the image URL as URI or fallback image source
      if (imageUrl) {
        return { uri: imageUrl };
      } else {
        return require("../../assets/StreamifyLogo.png");
      }
    } catch (error) {
      console.error(
        `[DEBUG] Error in getPlaylistImageSource for playlist ${playlist.id}:`,
        error
      );
      return require("../../assets/StreamifyLogo.png");
    }
  };

  const formatSongCount = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k songs`;
    }
    return `${count} songs`;
  };

  return (
    <SafeArea>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header with Category Chips */}
        <ChipsContainer>
          <ProfileContainer>
            <UserProfileImage
              source={require("../../assets/StreamifyLogo.png")}
            />
          </ProfileContainer>
          <ChipsScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
          >
            <ChipsContent>
              {/* All Button */}
              <Chip
                key="all"
                active={selectedCategories.includes("all")}
                onPress={() => toggleCategory("all")}
              >
                <ChipText active={selectedCategories.includes("all")}>
                  All
                </ChipText>
              </Chip>
              {Object.keys(CATEGORY_APIS).map((category) => (
                <Chip
                  key={category}
                  active={selectedCategories.includes(category)}
                  onPress={() => toggleCategory(category)}
                >
                  <ChipText active={selectedCategories.includes(category)}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </ChipText>
                </Chip>
              ))}
            </ChipsContent>
          </ChipsScrollView>
        </ChipsContainer>
        {/* Featured Playlists */}
        <Section>
          <SectionHeader>
            <SectionTitle>Featured Playlists</SectionTitle>
          </SectionHeader>
          {loadingFeatured ? (
            <FeaturedPlaylistSkeleton />
          ) : (
            <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
              {featuredPlaylists.map((playlist) => (
                <Card
                  key={playlist.id}
                  onPress={() => handlePlayPlaylist(playlist)}
                >
                  <CardImage source={getPlaylistImageSource(playlist)} />
                  <CardTitle numberOfLines={2}>{playlist.name}</CardTitle>
                  <CardMeta>
                    {formatSongCount(playlist.songCount)} • {playlist.language}
                  </CardMeta>
                </Card>
              ))}
            </HorizontalScroll>
          )}
        </Section>
        {/* Selected Category Playlists */}
        {(selectedCategories.includes("all")
          ? Object.keys(CATEGORY_APIS)
          : selectedCategories
        ).map((category) => {
          const playlists = categoryData[category] || [];
          return (
            <Section key={category}>
              <SectionHeader>
                <SectionTitle>
                  {category.charAt(0).toUpperCase() + category.slice(1)}{" "}
                  Playlists
                </SectionTitle>
              </SectionHeader>
              {playlists.length === 0 ? (
                <CategoryPlaylistSkeleton />
              ) : (
                <HorizontalScroll
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  {playlists.map((playlist) => (
                    <Card
                      key={playlist.id}
                      onPress={() => handlePlayPlaylist(playlist)}
                    >
                      <CardImage source={getPlaylistImageSource(playlist)} />
                      <CardTitle numberOfLines={2}>{playlist.name}</CardTitle>
                      <CardMeta>
                        {formatSongCount(playlist.songCount)} •{" "}
                        {playlist.language}
                      </CardMeta>
                    </Card>
                  ))}
                </HorizontalScroll>
              )}
            </Section>
          );
        })}
      </ScrollView>
    </SafeArea>
  );
}
