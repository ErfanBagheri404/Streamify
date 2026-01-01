import React, { useState, useEffect } from "react";
import { ScrollView, ActivityIndicator } from "react-native";
import styled from "styled-components/native";
import StreamItem from "../StreamItem";
import { SafeArea } from "../SafeArea";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer } from "../../contexts/PlayerContext";

// API endpoints for your Lowkey Backend
const CATEGORY_APIS = {
  indie: "https://lowkey-backend.vercel.app/api/search/playlists?query=indie",
  edm: "https://lowkey-backend.vercel.app/api/search/playlists?query=edm",
  metal: "https://lowkey-backend.vercel.app/api/search/playlists?query=metal",
  punk: "https://lowkey-backend.vercel.app/api/search/playlists?query=punk",
  party: "https://lowkey-backend.vercel.app/api/search/playlists?query=party",
  jazz: "https://lowkey-backend.vercel.app/api/search/playlists?query=jazz",
  love: "https://lowkey-backend.vercel.app/api/search/playlists?query=love",
  rap: "https://lowkey-backend.vercel.app/api/search/playlists?query=rap",
  workout:
    "https://lowkey-backend.vercel.app/api/search/playlists?query=workout",
  pop: "https://lowkey-backend.vercel.app/api/search/playlists?query=pop",
  hiphop: "https://lowkey-backend.vercel.app/api/search/playlists?query=hiphop",
  rock: "https://lowkey-backend.vercel.app/api/search/playlists?query=rock",
  melody: "https://lowkey-backend.vercel.app/api/search/playlists?query=melody",
  lofi: "https://lowkey-backend.vercel.app/api/search/playlists?query=lofi",
  chill: "https://lowkey-backend.vercel.app/api/search/playlists?query=chill",
  focus: "https://lowkey-backend.vercel.app/api/search/playlists?query=focus",
  instrumental:
    "https://lowkey-backend.vercel.app/api/search/playlists?query=instrumental",
  folk: "https://lowkey-backend.vercel.app/api/search/playlists?query=folk",
  devotional:
    "https://lowkey-backend.vercel.app/api/search/playlists?query=devotional",
  ambient:
    "https://lowkey-backend.vercel.app/api/search/playlists?query=ambient",
  sleep: "https://lowkey-backend.vercel.app/api/search/playlists?query=sleep",
  soul: "https://lowkey-backend.vercel.app/api/search/playlists?query=soul",
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
  margin-top: 24px;
`;

const Label = styled.Text`
  color: #d4d4d4;
  margin-bottom: 8px;
  padding: 0 16px;
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
  width: 30px;
  height: 30px;
  border-radius: 20px;
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
  font-weight: 600;
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
  font-weight: 500;
`;

const CardMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
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
  font-weight: 600;
`;

const SubtitleBtn = styled.TouchableOpacity``;

const SubtitleText = styled.Text`
  color: #a3e635;
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
  font-weight: 600;
`;

const CollectionSub = styled.Text`
  color: #a3a3a3;
  margin-top: 4px;
`;

const Arrow = styled.Text`
  color: #a3e635;
  margin-top: 8px;
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
      const response = await fetch(
        CATEGORY_APIS[category as keyof typeof CATEGORY_APIS],
      );
      const data = await response.json();

      if (data.success && data.data?.results) {
        const playlists = data.data.results.slice(0, 6);
        setCategoryData((prev) => ({ ...prev, [category]: playlists }));
      }
    } catch (error) {
      console.error(`Failed to fetch ${category} playlists:`, error);
    }
  };

  // Fetch featured playlists
  const fetchFeaturedPlaylists = async () => {
    try {
      setLoadingFeatured(true);
      const featuredData: Playlist[] = [];

      for (const playlistId of FEATURED_PLAYLIST_IDS) {
        try {
          const response = await fetch(
            `https://lowkey-backend.vercel.app/api/playlists?id=${playlistId}`,
          );
          const data = await response.json();
          if (data.success && data.data) {
            featuredData.push(data.data);
          }
        } catch (error) {
          console.error(
            `Failed to fetch featured playlist ${playlistId}:`,
            error,
          );
        }
      }

      setFeaturedPlaylists(featuredData);
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
    fetchFeaturedPlaylists();
    // Load initial categories
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
    const highQualityImage = playlist.image.find(
      (img) => img.quality === "500x500",
    );
    const imageUrl = highQualityImage?.url || playlist.image[0]?.url;

    // Return the image URL as URI or fallback image source
    if (imageUrl) {
      return { uri: imageUrl };
    }
    return require("../../assets/logo192.png");
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
            <UserProfileImage source={require("../../assets/logo192.png")} />
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
            <LoadingContainer>
              <ActivityIndicator color="#a3e635" size="large" />
            </LoadingContainer>
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
                <LoadingContainer>
                  <ActivityIndicator color="#a3e635" size="large" />
                </LoadingContainer>
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
