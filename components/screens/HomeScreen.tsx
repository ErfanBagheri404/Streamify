import React, { useState, useEffect } from "react";
import { ScrollView, ActivityIndicator } from "react-native";
import styled from "styled-components/native";
import StreamItem from "../StreamItem";
import { SafeArea } from "../SafeArea";
import { LinearGradient } from "expo-linear-gradient";
import { usePlayer } from "../../contexts/PlayerContext";
// import spotifyService from "../../services/spotifyService"; // Commented out - using skeletons only
// Skeleton loading components
const SkeletonContainer = styled.View`
  border-radius: 8px;
  overflow: hidden;
`;

const SkeletonShimmer = styled.View`
  width: 100%;
  height: 100%;
  background-color: #2a2a2a;
  position: relative;
  overflow: hidden;
`;

const SkeletonShimmerOverlay = styled.View`
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    to right,
    transparent 0%,
    rgba(255, 255, 255, 0.1) 50%,
    transparent 100%
  );
`;

const SkeletonCard = styled.View`
  width: 120px;
  margin-right: 12px;
`;

const SkeletonCardImage = styled(SkeletonContainer)`
  width: 120px;
  height: 120px;
  margin-bottom: 8px;
`;

const SkeletonCardTitle = styled(SkeletonContainer)`
  width: 100%;
  height: 16px;
  margin-bottom: 4px;
`;

const SkeletonCardMeta = styled(SkeletonContainer)`
  width: 80%;
  height: 14px;
`;

const SkeletonText = styled(SkeletonContainer)`
  height: 20px;
  margin-bottom: 8px;
`;

const SkeletonSectionHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  margin-bottom: 16px;
`;

const SkeletonTitle = styled(SkeletonContainer)`
  width: 120px;
  height: 24px;
`;

const SkeletonSeeAll = styled(SkeletonContainer)`
  width: 60px;
  height: 16px;
`;

// Skeleton card component
const SkeletonCardComponent = () => (
  <SkeletonCard>
    <SkeletonCardImage>
      <SkeletonShimmer />
    </SkeletonCardImage>
    <SkeletonCardTitle>
      <SkeletonShimmer />
    </SkeletonCardTitle>
    <SkeletonCardMeta>
      <SkeletonShimmer />
    </SkeletonCardMeta>
  </SkeletonCard>
);

// Skeleton collection card component
const SkeletonCollectionComponent = () => (
  <SkeletonCollectionCard>
    <SkeletonCollectionTitle>
      <SkeletonShimmer />
    </SkeletonCollectionTitle>
    <SkeletonCollectionSub>
      <SkeletonShimmer />
    </SkeletonCollectionSub>
    <SkeletonCollectionImage>
      <SkeletonShimmer />
    </SkeletonCollectionImage>
  </SkeletonCollectionCard>
);

// Skeleton for StreamItem-style cards
const SkeletonStreamItem = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
  border-bottom-width: 1px;
  border-bottom-color: #2a2a2a;
`;

const SkeletonStreamItemImage = styled(SkeletonContainer)`
  width: 60px;
  height: 60px;
  border-radius: 8px;
  margin-right: 12px;
`;

const SkeletonStreamItemContent = styled.View`
  flex: 1;
`;

const SkeletonStreamItemTitle = styled(SkeletonContainer)`
  width: 150px;
  height: 18px;
  margin-bottom: 6px;
`;

const SkeletonStreamItemMeta = styled(SkeletonContainer)`
  width: 100px;
  height: 14px;
  margin-bottom: 4px;
`;

const SkeletonStreamItemSmall = styled(SkeletonContainer)`
  width: 80px;
  height: 12px;
`;

// Skeleton StreamItem component
const SkeletonStreamItemComponent = () => (
  <SkeletonStreamItem>
    <SkeletonStreamItemImage>
      <SkeletonShimmer />
    </SkeletonStreamItemImage>
    <SkeletonStreamItemContent>
      <SkeletonStreamItemTitle>
        <SkeletonShimmer />
      </SkeletonStreamItemTitle>
      <SkeletonStreamItemMeta>
        <SkeletonShimmer />
      </SkeletonStreamItemMeta>
      <SkeletonStreamItemSmall>
        <SkeletonShimmer />
      </SkeletonStreamItemSmall>
    </SkeletonStreamItemContent>
  </SkeletonStreamItem>
);

// Skeleton for featured playlist cards
const SkeletonFeaturedCard = styled.View`
  margin-right: 15px;
  width: 160px;
  height: 100%;
  position: relative;
  overflow: hidden;
`;

const SkeletonFeaturedImage = styled(SkeletonContainer)`
  width: 160px;
  height: 160px;
  border-radius: 12px;
  margin-bottom: 12px;
`;

const SkeletonFeaturedTitle = styled(SkeletonContainer)`
  width: 80%;
  height: 16px;
  margin-bottom: 4px;
`;

const SkeletonFeaturedDescription = styled(SkeletonContainer)`
  width: 60%;
  height: 12px;
`;

// Skeleton featured playlist component
const SkeletonFeaturedComponent = () => (
  <SkeletonFeaturedCard>
    <SkeletonFeaturedImage>
      <SkeletonShimmer />
    </SkeletonFeaturedImage>
    <SkeletonFeaturedTitle>
      <SkeletonShimmer />
    </SkeletonFeaturedTitle>
    <SkeletonFeaturedDescription>
      <SkeletonShimmer />
    </SkeletonFeaturedDescription>
  </SkeletonFeaturedCard>
);

// Skeleton section for horizontal card lists
const SkeletonHorizontalSection = ({ count = 6 }) => (
  <Section>
    <SkeletonSectionHeader>
      <SkeletonTitle>
        <SkeletonShimmer />
      </SkeletonTitle>
      <SkeletonSeeAll>
        <SkeletonShimmer />
      </SkeletonSeeAll>
    </SkeletonSectionHeader>
    <Horizontal horizontal showsHorizontalScrollIndicator={false}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCardComponent key={i} />
      ))}
    </Horizontal>
  </Section>
);

// Skeleton for text chips
const SkeletonChip = styled(SkeletonContainer)`
  width: 80px;
  height: 32px;
  border-radius: 16px;
  margin-right: 8px;
`;

// Skeleton for collection cards
const SkeletonCollectionCard = styled.View`
  background-color: #1a1a1a;
  border-radius: 12px;
  padding: 16px;
  margin-right: 12px;
  width: 200px;
  height: 120px;
  position: relative;
  overflow: hidden;
`;

const SkeletonCollectionTitle = styled(SkeletonContainer)`
  width: 120px;
  height: 20px;
  margin-bottom: 8px;
`;

const SkeletonCollectionSub = styled(SkeletonContainer)`
  width: 80px;
  height: 16px;
  margin-bottom: 16px;
`;

const SkeletonCollectionImage = styled(SkeletonContainer)`
  width: 60px;
  height: 60px;
  border-radius: 8px;
  position: absolute;
  bottom: 16px;
  right: 16px;
`;

// Existing styled components from original HomeScreen
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

const ProfileContainer = styled.View`
  width: 30px;
  height: 30px;
  border-radius: 20px;
  margin-left: 16px;
  margin-right: 10px;
  shadow-color: #000;
  shadow-offset: 3px 3px; /* right 3, down 3 */
  shadow-opacity: 0.4;
  shadow-radius: 6px;
  elevation: 8; /* Android */
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

// New styled components for enhanced sections
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

const SeeAllButton = styled.TouchableOpacity``;

const SeeAllText = styled.Text`
  color: #a3e635;
  font-size: 14px;
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

const CardImagePlaceholder = styled.View`
  width: 160px;
  height: 160px;
  border-radius: 12px;
  background-color: #262626;
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

const FeaturedCarousel = styled.ScrollView`
  padding: 0 16px;
`;

const FeaturedCard = styled.TouchableOpacity`
  width: 280px;
  margin-right: 16px;
`;

const FeaturedImage = styled.Image`
  width: 280px;
  height: 160px;
  border-radius: 16px;
`;

const FeaturedTitle = styled.Text`
  color: #fff;
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
`;

const FeaturedDescription = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 4px;
`;

const MoodChipContainer = styled.View`
  flex-direction: row;
  padding: 0 16px;
  flex-wrap: wrap;
`;

const MoodChip = styled.TouchableOpacity`
  padding: 8px 16px;
  border-radius: 20px;
  background-color: #262626;
  margin-right: 8px;
  margin-bottom: 8px;
`;

const MoodChipText = styled.Text`
  color: #fff;
  font-size: 14px;
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
  color: #a3a3a3;
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

const CollectionImagePlaceholder = styled.View`
  width: 64px;
  height: 64px;
  border-radius: 8px;
  background-color: #262626;
  margin-left: 12px;
`;

const PlaylistSection = styled.View`
  margin-top: 24px;
`;

const LoadingContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #000;
`;

const ErrorText = styled.Text`
  color: #ff4444;
  text-align: center;
  padding: 20px;
`;

export default function HomeScreen({ navigation }: any) {
  const { playTrack } = usePlayer();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useStaticContent, setUseStaticContent] = useState(false);

  // Data states for Spotify sections
  const [top50Global, setTop50Global] = useState<any[]>([]);
  const [viral50Global, setViral50Global] = useState<any[]>([]);
  const [bestPopPlaylist, setBestPopPlaylist] = useState<any[]>([]);
  const [newReleases, setNewReleases] = useState<any[]>([]);
  const [moodCategories, setMoodCategories] = useState<any[]>([]);
  const [featuredPlaylists, setFeaturedPlaylists] = useState<any[]>([]);
  const [radioRecommendations, setRadioRecommendations] = useState<any[]>([]);
  const [artistTopTracks, setArtistTopTracks] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [playlistItems, setPlaylistItems] = useState<any[]>([]);

  // Popular songs function removed - skeletons will be shown instead

  const loadHomeData = async (skipSpotify = true) => {
    try {
      console.log("[HomeScreen] loadHomeData start - Spotify service disabled");
      setLoading(true);
      setError(null);

      // Skip Spotify calls - show skeletons only
      console.log(
        "[HomeScreen] Skipping Spotify calls – showing skeletons only"
      );

      // Initialize all data arrays as empty to show skeletons
      setTop50Global([]);
      setViral50Global([]);
      setBestPopPlaylist([]);
      setNewReleases([]);
      setMoodCategories([]);
      setFeaturedPlaylists([]);
      setRadioRecommendations([]);
      setArtistTopTracks([]);
      setCategories([]);
      setCollections([]);
      setPlaylistItems([]);

      // Keep loading state true to show skeletons
      // This will be handled by the component's loading logic
    } catch (err) {
      console.error("[HomeScreen] Error in loadHomeData:", err);
      // Even on error, keep skeletons showing
      setTop50Global([]);
      setViral50Global([]);
      setBestPopPlaylist([]);
      setNewReleases([]);
      setMoodCategories([]);
      setFeaturedPlaylists([]);
      setRadioRecommendations([]);
      setArtistTopTracks([]);
      setCategories([]);
      setCollections([]);
      setPlaylistItems([]);
    } finally {
      console.log(
        "[HomeScreen] loadHomeData complete - skeletons should be visible"
      );
      // Keep loading false to allow skeleton display logic to work
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log(
      "[HomeScreen] useEffect -> calling loadHomeData with skipSpotify=true"
    );
    loadHomeData(true); // Always skip Spotify calls to show skeletons
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

  const handlePlayPlaylist = (playlist: any) => {
    if (playlist && playlist.id) {
      console.log("Playing playlist:", playlist.name);
      // Navigate to playlist screen or load playlist tracks
    }
  };

  // Remove full-page loading - show skeletons per section instead

  // Removed error handling - skeletons will be shown for all loading states

  return (
    <SafeArea>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header with User Profile and Categories - Always show skeletons */}
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
              {/* Always show skeleton chips */}
              {Array.from({ length: 8 }, (_, i) => (
                <SkeletonChip key={i}>
                  <SkeletonShimmer />
                </SkeletonChip>
              ))}
            </ChipsContent>
          </ChipsScrollView>
        </ChipsContainer>

        {/* Featured Playlists Carousel with Skeleton Loading */}
        <Section>
          <SectionHeader>
            <SectionTitle>Featured Playlists</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("Playlists")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <FeaturedCarousel horizontal showsHorizontalScrollIndicator={false}>
            {loading
              ? // Show skeleton featured playlists while loading
                Array.from({ length: 3 }, (_, i) => (
                  <SkeletonFeaturedComponent key={i} />
                ))
              : // Show actual featured playlists when loaded
                featuredPlaylists.map((playlist) => (
                  <FeaturedCard
                    key={playlist.id}
                    onPress={() => handlePlayPlaylist(playlist)}
                  >
                    {playlist.images[0]?.url ? (
                      <FeaturedImage source={{ uri: playlist.images[0].url }} />
                    ) : (
                      <CardImagePlaceholder />
                    )}
                    <FeaturedTitle numberOfLines={2}>
                      {playlist.name}
                    </FeaturedTitle>
                    <FeaturedDescription numberOfLines={2}>
                      {playlist.description}
                    </FeaturedDescription>
                  </FeaturedCard>
                ))}
          </FeaturedCarousel>
        </Section>

        {/* Top 50 Global - Always show skeletons */}
        <Section>
          <SectionHeader>
            <SectionTitle>🌍 Top 50 Global</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("Charts")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </HorizontalScroll>
        </Section>

        {/* Viral 50 Global - Always show skeletons */}
        <Section>
          <SectionHeader>
            <SectionTitle>🔥 Viral 50 Global</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("Trending")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </HorizontalScroll>
        </Section>

        {/* Best Pop 2025 - Always show skeletons */}
        <Section>
          <SectionHeader>
            <SectionTitle>🎵 Best Pop 2025</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("Pop")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </HorizontalScroll>
        </Section>

        {/* New Releases Friday - Always show skeletons */}
        <Section>
          <SectionHeader>
            <SectionTitle>🆕 New Releases Friday</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("NewReleases")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </HorizontalScroll>
        </Section>

        {/* Mood Filters - Always show skeletons */}
        <Section>
          <SectionHeader>
            <SectionTitle>🎭 Browse by Mood</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("Moods")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <MoodChipContainer>
            {/* Always show skeleton chips */}
            {Array.from({ length: 8 }, (_, i) => (
              <SkeletonChip key={i}>
                <SkeletonShimmer />
              </SkeletonChip>
            ))}
          </MoodChipContainer>
        </Section>

        {/* Radio-Style Recommendations - Always show skeletons */}
        <Section>
          <SectionHeader>
            <SectionTitle>📻 Energy Boost Radio</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("Radio")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </HorizontalScroll>
        </Section>

        {/* Top 10 Tracks - The Weeknd - Always show skeletons */}
        <Section>
          <SectionHeader>
            <SectionTitle>🎤 The Weeknd's Top Hits</SectionTitle>
            <SeeAllButton onPress={() => navigation.navigate("Artist")}>
              <SeeAllText>See all</SeeAllText>
            </SeeAllButton>
          </SectionHeader>
          <HorizontalScroll horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </HorizontalScroll>
        </Section>

        {/* Popular Songs - Always show skeletons */}
        <Section>
          <Row>
            <Title>Popular Songs</Title>
            <SubtitleBtn onPress={() => {}}>
              <SubtitleText>See all</SubtitleText>
            </SubtitleBtn>
          </Row>
          <Horizontal horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </Horizontal>
        </Section>

        {/* Top 50 Global Tracks - Always show skeletons */}
        <Section>
          <Row>
            <Title>Top 50 Global</Title>
            <SubtitleBtn onPress={() => navigation.navigate("Top50")}>
              <SubtitleText>See all</SubtitleText>
            </SubtitleBtn>
          </Row>
          <Horizontal horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </Horizontal>
        </Section>

        {/* Radio Recommendations in Card Format - Always show skeletons */}
        <Section>
          <Row>
            <Title>Energy Boost Radio</Title>
            <SubtitleBtn onPress={() => navigation.navigate("Radio")}>
              <SubtitleText>See all</SubtitleText>
            </SubtitleBtn>
          </Row>
          <Horizontal horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </Horizontal>
        </Section>

        {/* New Releases in Card Format - Always show skeletons */}
        <Section>
          <Row>
            <Title>New Releases</Title>
            <SubtitleBtn onPress={() => navigation.navigate("NewReleases")}>
              <SubtitleText>See all</SubtitleText>
            </SubtitleBtn>
          </Row>
          <Horizontal horizontal showsHorizontalScrollIndicator={false}>
            {/* Always show skeleton cards */}
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCardComponent key={i} />
            ))}
          </Horizontal>
        </Section>

        {/* Playlist Section - Always show skeletons */}
        <PlaylistSection>
          <Row>
            <Title>Playlist</Title>
            <SubtitleBtn onPress={() => navigation.navigate("Lists")}>
              <SubtitleText>See all</SubtitleText>
            </SubtitleBtn>
          </Row>
          {/* Always show skeleton StreamItems */}
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonStreamItemComponent key={i} />
          ))}
        </PlaylistSection>

        {/* New Collection - Always show skeletons */}
        <Section>
          <Label
            style={{
              marginBottom: 12,
              color: "#fff",
              fontSize: 18,
              fontWeight: "600",
            }}
          >
            New Collection
          </Label>
          <CollectionWrap>
            {/* Always show skeleton collection cards */}
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonCollectionComponent key={i} />
            ))}
          </CollectionWrap>
        </Section>
      </ScrollView>
    </SafeArea>
  );
}
