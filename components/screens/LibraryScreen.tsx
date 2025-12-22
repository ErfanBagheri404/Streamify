import React from "react";
import { Image } from "react-native";
import styled from "styled-components/native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeArea } from "../SafeArea";
import AntDesign from "@expo/vector-icons/AntDesign";
import Entypo from "@expo/vector-icons/Entypo";
import { FontAwesome5, FontAwesome6, Fontisto } from "@expo/vector-icons";
import { usePlayer } from "../../contexts/PlayerContext";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

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

const Avatar = styled.Image`
  width: 28px;
  height: 28px;
  border-radius: 16px;
  margin-right: 12px;
`;

const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 22px;
  font-weight: 700;
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
`;

const FilterChipsRow = styled.ScrollView`
  padding: 0 16px;
  margin-bottom: 12px;
  max-height: 32px;
`;

const FilterChip = styled.TouchableOpacity<{ active?: boolean }>`
  padding: 6px 16px;
  border-radius: 999px;
  background-color: ${(p: { active?: boolean }) =>
    p.active ? "#404040" : "#262626"};
  margin-right: 8px;
  align-items: center;
  justify-content: center;
`;

const FilterChipText = styled.Text<{ active?: boolean }>`
  color: #fff;
  font-size: 13px;
  font-weight: ${(p: { active?: boolean }) => (p.active ? "700" : "500")};
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
`;

const SortLabel = styled.Text`
  color: #fff;
  font-size: 14px;
`;

const LayoutToggle = styled.TouchableOpacity`
  padding: 6px;
`;

const LayoutIcon = styled.Text`
  color: #a3a3a3;
  font-size: 18px;
`;

const Grid = styled.ScrollView`
  flex: 1;
  padding: 0 16px 16px 16px;
`;

const GridRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: 16px;
`;

const CollectionCard = styled.TouchableOpacity`
  width: 48%;
`;

const CollectionCover = styled.Image`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  background-color: #262626;
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

const LikedHeart = styled.Text`
  color: #fff;
  font-size: 32px;
`;

const CollectionTitle = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
`;

const CollectionMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
`;

const PinRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 2px;
`;

const PinIcon = styled.Text`
  color: #22c55e;
  margin-right: 4px;
`;

const PinLabel = styled.Text`
  color: #22c55e;
  font-size: 12px;
`;

const PinDot = styled.Text`
  color: #a3a3a3;
  margin: 0 4px;
`;

const sections = ["Playlists", "Albums", "Artists", "Downloaded"];

const sampleCollections = [
  {
    id: "liked",
    title: "Liked Songs",
    meta: "Playlist • 650 songs",
    pinned: true,
    cover: null,
  },
];

export default function LibraryScreen({ navigation }: { navigation: any }) {
  const [activeSection, setActiveSection] = React.useState("Playlists");
  const { likedSongs } = usePlayer();

  const handleLikedSongsPress = () => {
    navigation.navigate("LikedSongs");
  };

  return (
    <SafeArea>
      <Screen>
        <Header>
          <HeaderLeft>
            <Avatar source={require("../../assets/logo512.png")} />
            <HeaderTitle>Your Library</HeaderTitle>
          </HeaderLeft>
          <HeaderActions>
            <HeaderIconButton>
              <HeaderIconText>
                <Fontisto name="search" size={20} color="white" />
              </HeaderIconText>
            </HeaderIconButton>
            <HeaderIconButton>
              <HeaderIconText>
                <FontAwesome6 name="add" size={20} color="white" />
              </HeaderIconText>
            </HeaderIconButton>
          </HeaderActions>
        </Header>

        <FilterChipsRow horizontal showsHorizontalScrollIndicator={false}>
          {sections.map((label) => (
            <FilterChip
              key={label}
              active={label === activeSection}
              onPress={() => setActiveSection(label)}
            >
              <FilterChipText active={label === activeSection}>
                {label}
              </FilterChipText>
            </FilterChip>
          ))}
        </FilterChipsRow>

        <SortRow>
          <SortLeft>
            <SortIcon>
              <FontAwesome5 name="arrows-alt-v" size={12} color="white" />
            </SortIcon>
            <SortLabel>Recents</SortLabel>
          </SortLeft>
          <LayoutToggle>
            <LayoutIcon>
              <AntDesign name="unordered-list" size={14} color="white" />
            </LayoutIcon>
          </LayoutToggle>
        </SortRow>

        <Grid>
          <GridRow>
            {sampleCollections.slice(0, 2).map((item) => (
              <CollectionCard
                key={item.id}
                onPress={
                  item.id === "liked" ? handleLikedSongsPress : undefined
                }
              >
                {item.id === "liked" ? (
                  <LikedCoverWrapper>
                    <LikedCoverGradient
                      colors={["#3d02ae", "#6053b0", "#6c867f"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Entypo name="heart" size={42} color="white" />
                    </LikedCoverGradient>
                  </LikedCoverWrapper>
                ) : (
                  <CollectionCover source={item.cover as any} />
                )}
                <CollectionTitle>{item.title}</CollectionTitle>
                {item.id === "liked" ? (
                  <>
                    <PinRow>
                      <PinIcon>
                        <AntDesign name="pushpin" size={14} color="green" />
                      </PinIcon>
                      <PinLabel>Playlist</PinLabel>
                      <PinDot>•</PinDot>
                      <CollectionMeta>{likedSongs.length} songs</CollectionMeta>
                    </PinRow>
                  </>
                ) : (
                  <CollectionMeta>{item.meta}</CollectionMeta>
                )}
              </CollectionCard>
            ))}
          </GridRow>

          <GridRow>
            {sampleCollections.slice(2, 4).map((item) => (
              <CollectionCard key={item.id}>
                <CollectionCover source={item.cover as any} />
                <CollectionTitle>{item.title}</CollectionTitle>
                <CollectionMeta>{item.meta}</CollectionMeta>
              </CollectionCard>
            ))}
          </GridRow>
        </Grid>
      </Screen>
    </SafeArea>
  );
}
