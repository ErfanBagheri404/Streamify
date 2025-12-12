import React from "react";
import { ScrollView } from "react-native";
import styled from "styled-components/native";
import StreamItem from "../StreamItem";
import { SafeArea } from "../SafeArea";

const Section = styled.View`
  margin-top: 24px;
`;

const HeaderRow = styled.View`
  padding: 16px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const HelloText = styled.Text`
  color: #fff;
  font-size: 18px;
`;

const Label = styled.Text`
  color: #d4d4d4;
  margin-bottom: 8px;
  padding: 0 16px;
`;

const Chips = styled.View`
  padding: 0 16px;
  flex-direction: row;
  flex-wrap: wrap;
`;

const Chip = styled.TouchableOpacity<{ active?: boolean }>`
  padding: 8px 16px;
  border-radius: 999px;
  background-color: ${(p: { active?: boolean }) =>
    p.active ? "#a3e635" : "#262626"};
  margin-right: 8px;
  margin-bottom: 8px;
`;

const ChipText = styled.Text<{ active?: boolean }>`
  color: ${(p: { active?: boolean }) => (p.active ? "#000" : "#fff")};
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

const Card = styled.View`
  width: 160px;
  margin-right: 16px;
`;

const CardImagePlaceholder = styled.View`
  height: 160px;
  border-radius: 12px;
  background-color: #262626;
`;

const CardTitle = styled.Text`
  color: #fff;
  margin-top: 8px;
  font-size: 14px;
`;

const CardMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
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

export default function HomeScreen({ navigation }: any) {
  const categories = ["All", "Party", "Blues", "Sad", "Hip Hop"];
  const popularSongs = [
    { title: "Starboy Remix", artist: "The Weeknd" },
    { title: "Superman", artist: "Eminem" },
    { title: "We Don't Talk", artist: "Kyanu & Co." },
    { title: "Blinding Lights", artist: "The Weeknd" },
  ];

  const collections = [
    { title: "TOP SONGS GLOBAL", subtitle: "Discover 85 songs" },
    { title: "PUMP SONGS", subtitle: "Discover 42 songs" },
  ];

  return (
    <SafeArea>
      {/* Header */}
      <HeaderRow>
        <HelloText>
          Hello, <HelloText style={{ fontWeight: "600" }}>John Smith</HelloText>
          ✨
        </HelloText>
      </HeaderRow>

      {/* Categories */}
      <Label>Select Categories</Label>
      <Chips>
        {categories.map((c, i) => (
          <Chip key={c} active={i === 0}>
            <ChipText active={i === 0}>{c}</ChipText>
          </Chip>
        ))}
      </Chips>

      {/* Popular Songs */}
      <Section>
        <Row>
          <Title>Popular Songs</Title>
          <SubtitleBtn onPress={() => {}}>
            <SubtitleText>See all</SubtitleText>
          </SubtitleBtn>
        </Row>
        <Horizontal horizontal showsHorizontalScrollIndicator={false}>
          {popularSongs.map((item, idx) => (
            <Card key={idx}>
              <CardImagePlaceholder />
              <CardTitle numberOfLines={1}>{item.title}</CardTitle>
              <CardMeta numberOfLines={1}>{item.artist}</CardMeta>
            </Card>
          ))}
        </Horizontal>
      </Section>

      {/* New Collection */}
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
          {collections.map((c, i) => (
            <CollectionCard
              key={i}
              style={{ marginRight: i === collections.length - 1 ? 0 : 12 }}
            >
              <CollectionInfo>
                <CollectionTitle numberOfLines={1}>{c.title}</CollectionTitle>
                <CollectionSub numberOfLines={1}>{c.subtitle}</CollectionSub>
                <Arrow>→</Arrow>
              </CollectionInfo>
              <CollectionImagePlaceholder />
            </CollectionCard>
          ))}
        </CollectionWrap>
      </Section>

      {/* Playlist */}
      <PlaylistSection>
        <Row>
          <Title>Playlist</Title>
          <SubtitleBtn onPress={() => navigation.navigate("Lists")}>
            <SubtitleText>See all</SubtitleText>
          </SubtitleBtn>
        </Row>
        <StreamItem
          id="abc"
          title="Midnight Drive"
          author="DJ Nova"
          duration="03:21"
          views="1.2M views"
          uploaded="2 years ago"
        />
        <StreamItem
          id="def"
          title="Sunny Vibes"
          author="Electro Chill"
          duration="02:54"
          views="934K views"
          uploaded="1 year ago"
        />
      </PlaylistSection>
    </SafeArea>
  );
}
