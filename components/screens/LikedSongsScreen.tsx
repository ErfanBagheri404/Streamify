import React, { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Image } from "react-native";
import styled from "styled-components/native";
import { SafeArea } from "../SafeArea";
import { usePlayer } from "../../contexts/PlayerContext";
import { Ionicons } from "@expo/vector-icons";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 16px;
  border-bottom-width: 1px;
  border-bottom-color: #333;
`;

const BackButton = styled.TouchableOpacity`
  padding: 8px;
  margin-right: 12px;
`;

const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  flex: 1;
`;

const HeaderSubtitle = styled.Text`
  color: #999;
  font-size: 14px;
`;

const PlayAllButton = styled.TouchableOpacity`
  background-color: #1db954;
  border-radius: 24px;
  padding: 8px 16px;
  margin: 16px;
  align-self: flex-start;
`;

const PlayAllText = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
`;

const SongItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
  border-bottom-width: 1px;
  border-bottom-color: #1a1a1a;
`;

const SongThumbnail = styled.Image`
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background-color: #333;
  margin-right: 12px;
`;

const SongInfo = styled.View`
  flex: 1;
  justify-content: center;
`;

const SongTitle = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 4px;
`;

const SongArtist = styled.Text`
  color: #999;
  font-size: 14px;
`;

const MoreButton = styled.TouchableOpacity`
  padding: 8px;
`;

const EmptyContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 32px;
`;

const EmptyText = styled.Text`
  color: #999;
  font-size: 16px;
  text-align: center;
  margin-top: 16px;
`;

interface LikedSongsScreenProps {
  navigation: any;
}

export const LikedSongsScreen: React.FC<LikedSongsScreenProps> = ({
  navigation,
}) => {
  const { likedSongs, playTrack } = usePlayer();
  const [isLoading, setIsLoading] = useState(true);
  const [isNavigatingBack, setIsNavigatingBack] = useState(false);

  useEffect(() => {
    // Add a small delay to prevent flash when component loads
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 50);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Handle back navigation with delay to prevent white flash
  const handleGoBack = () => {
    if (isNavigatingBack) return; // Prevent double navigation
    setIsNavigatingBack(true);

    // Small delay to ensure smooth transition
    setTimeout(() => {
      navigation.goBack();
    }, 50);
  };

  if (isLoading) {
    return (
      <SafeArea>
        <Screen>
          <Header>
            <BackButton onPress={handleGoBack} disabled={isNavigatingBack}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </BackButton>
            <View style={{ flex: 1 }}>
              <HeaderTitle>Liked Songs</HeaderTitle>
              <HeaderSubtitle>Loading...</HeaderSubtitle>
            </View>
          </Header>
        </Screen>
      </SafeArea>
    );
  }

  const handlePlayAll = () => {
    if (likedSongs.length > 0) {
      playTrack(likedSongs[0], likedSongs, 0);
      navigation.goBack();
    }
  };

  const handlePlaySong = (song: any, index: number) => {
    playTrack(song, likedSongs, index);
    navigation.goBack();
  };

  const renderSongItem = ({ item, index }: { item: any; index: number }) => (
    <SongItem onPress={() => handlePlaySong(item, index)}>
      {item.thumbnail ? (
        <SongThumbnail source={{ uri: item.thumbnail }} />
      ) : (
        <SongThumbnail>
          <Ionicons name="musical-notes" size={24} color="#666" />
        </SongThumbnail>
      )}
      <SongInfo>
        <SongTitle numberOfLines={1}>{item.title}</SongTitle>
        {item.artist && (
          <SongArtist numberOfLines={1}>{item.artist}</SongArtist>
        )}
      </SongInfo>
      <MoreButton>
        <Ionicons name="ellipsis-horizontal" size={20} color="#999" />
      </MoreButton>
    </SongItem>
  );

  const renderEmptyState = () => (
    <EmptyContainer>
      <Ionicons name="heart" size={64} color="#333" />
      <EmptyText>No liked songs yet</EmptyText>
      <EmptyText>Like songs from the player to see them here</EmptyText>
    </EmptyContainer>
  );

  return (
    <SafeArea>
      <Screen>
        <Header>
          <BackButton onPress={handleGoBack} disabled={isNavigatingBack}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </BackButton>
          <View style={{ flex: 1 }}>
            <HeaderTitle>Liked Songs</HeaderTitle>
            <HeaderSubtitle>{likedSongs.length} songs</HeaderSubtitle>
          </View>
        </Header>

        {likedSongs.length > 0 && (
          <PlayAllButton onPress={handlePlayAll}>
            <PlayAllText>Play All</PlayAllText>
          </PlayAllButton>
        )}

        <FlatList
          data={likedSongs}
          renderItem={renderSongItem}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmptyState}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      </Screen>
    </SafeArea>
  );
};
