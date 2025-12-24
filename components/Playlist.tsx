import React from "react";
import { View, Text, FlatList, TouchableOpacity, Image } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { usePlayer } from "../contexts/PlayerContext";

interface PlaylistProps {
  title: string;
  subtitle?: string;
  songs: any[];
  onBack?: () => void;
  onPlayAll?: () => void;
  contentContainerStyle?: any;
  showPlayAllButton?: boolean;
  emptyMessage?: string;
  emptySubMessage?: string;
  emptyIcon?: string;
}

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

export const Playlist: React.FC<PlaylistProps> = ({
  title,
  subtitle,
  songs,
  onBack,
  onPlayAll,
  contentContainerStyle,
  showPlayAllButton = true,
  emptyMessage = "No songs",
  emptySubMessage = "Add songs to see them here",
  emptyIcon = "musical-notes"
}) => {
  const { playTrack } = usePlayer();

  const handlePlaySong = (song: any, index: number) => {
    playTrack(song, songs, index);
  };

  const renderSongItem = ({ item, index }: { item: any; index: number }) => (
    <SongItem onPress={() => handlePlaySong(item, index)}>
      {item.thumbnail ? (
        <SongThumbnail source={{ uri: item.thumbnail }} />
      ) : (
        <SongThumbnail>
          <Ionicons name={emptyIcon as any} size={24} color="#666" />
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
      <Ionicons name={emptyIcon as any} size={64} color="#333" />
      <EmptyText>{emptyMessage}</EmptyText>
      <EmptyText>{emptySubMessage}</EmptyText>
    </EmptyContainer>
  );

  return (
    <Screen>
      <Header>
        {onBack && (
          <BackButton onPress={onBack}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </BackButton>
        )}
        <View style={{ flex: 1 }}>
          <HeaderTitle>{title}</HeaderTitle>
          {subtitle && (
            <HeaderSubtitle>{subtitle}</HeaderSubtitle>
          )}
        </View>
      </Header>

      {showPlayAllButton && songs.length > 0 && (
        <PlayAllButton onPress={onPlayAll || (() => handlePlaySong(songs[0], 0))}>
          <PlayAllText>Play All</PlayAllText>
        </PlayAllButton>
      )}

      <FlatList
        data={songs}
        renderItem={renderSongItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle || { paddingBottom: 80 }}
      />
    </Screen>
  );
};

export default Playlist;