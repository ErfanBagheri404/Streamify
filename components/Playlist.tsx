import React from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  ScrollView,
} from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Entypo } from "@expo/vector-icons";
import { usePlayer } from "../contexts/PlayerContext";

interface PlaylistProps {
  title: string; // e.g., "Justice"
  artist?: string; // e.g., "Justin Bieber"
  albumArtUrl: string; // URL for the main album cover
  libraryCover?: "liked" | "previously-played"; // Use library covers instead of album art
  songs: any[];
  onBack?: () => void;
  onPlayAll?: () => void;
  onShuffle?: () => void;
  onSongOptionsPress?: (song: any) => void;
  onHeaderOptionsPress?: () => void;
  contentContainerStyle?: any;
  emptyMessage?: string;
  emptySubMessage?: string;
  emptyIcon?: string;
  showSongOptions?: boolean; // Whether to show the options button for songs
  showHeaderOptions?: boolean; // Whether to show the header options button
  type?: "album" | "playlist"; // Type of content being displayed
}

// Main screen container
const Screen = styled.View`
  flex: 1;
`;

// Header
const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background-color: #000;
`;

const HeaderButton = styled.TouchableOpacity`
  padding: 8px;
`;

const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  font-family: GoogleSansSemiBold;
  line-height: 22px;
`;

// Album Art Section
const AlbumArtContainer = styled.View`
  padding: 0 24px;
  margin-bottom: 24px;
`;

const AlbumCover = styled.Image`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 20px;
  background-color: #333;
  shadow-color: #ffffff;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.1;
  shadow-radius: 8px;
  elevation: 3;
`;

const LibraryCoverWrapper = styled.View`
  width: 100%;
  aspect-ratio: 1;
  border-radius: 20px;
  overflow: hidden;
  shadow-color: #ffffff;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.1;
  shadow-radius: 8px;
  elevation: 3;
`;

const LibraryCoverGradient = styled(LinearGradient)`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const LibraryCoverIcon = styled.Text`
  color: #fff;
  font-size: 64px;
`;

const FloatingPlayButton = styled.TouchableOpacity`
  position: absolute;
  bottom: -25px;
  right: 70px;
  background-color: #1db954;
  width: 60px;
  height: 60px;
  border-radius: 25px;
  justify-content: center;
  align-items: center;
  shadow-color: #000;
  shadow-offset: 0px 4px;
  shadow-opacity: 0.3;
  shadow-radius: 4px;
  elevation: 5;
`;

// Album Info Section
const AlbumInfoContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  margin-bottom: 24px;
`;

const AlbumTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  font-family: GoogleSansBold;
  line-height: 28px;
`;

const AlbumArtist = styled.Text`
  color: #999;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const ShuffleButton = styled.TouchableOpacity`
  background-color: #282828;
  padding: 10px;
  border-radius: 20px;
`;

// Song List Item
const SongItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding: 12px 24px;
`;

const SongThumbnail = styled.Image`
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background-color: #333;
  margin-right: 12px;
`;

const SongNumber = styled.Text`
  color: #999;
  font-size: 14px;
  width: 24px;
`;

const SongInfo = styled.View`
  flex: 1;
  margin-left: 4px;
`;

const SongTitle = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansMedium;
  line-height: 20px;
`;

const SongArtist = styled.Text`
  color: #999;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const SongActions = styled.View`
  flex-direction: row;
  align-items: center;
`;

const ActionButton = styled.TouchableOpacity`
  padding: 8px;
  margin-left: 8px;
`;

// Empty State
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
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

export const Playlist: React.FC<PlaylistProps> = ({
  title,
  artist,
  albumArtUrl,
  libraryCover,
  songs,
  onBack,
  onPlayAll,
  onShuffle,
  onSongOptionsPress,
  onHeaderOptionsPress,
  contentContainerStyle,
  emptyMessage = "No songs found",
  emptySubMessage = "This album is currently empty.",
  emptyIcon = "musical-notes-outline",
  showSongOptions,
  showHeaderOptions = true, // Default to true for backward compatibility
  type = "album", // Default to album for backward compatibility
}) => {
  const { playTrack } = usePlayer();

  const handlePlaySong = (song: any, index: number) => {
    playTrack(song, songs, index);
  };

  const renderSongItem = ({ item, index }: { item: any; index: number }) => (
    <SongItem onPress={() => handlePlaySong(item, index)}>
      <SongNumber>{index + 1}</SongNumber>
      {item.thumbnail && <SongThumbnail source={{ uri: item.thumbnail }} />}
      <SongInfo>
        <SongTitle numberOfLines={1}>{item.title}</SongTitle>
        {item.artist && (
          <SongArtist numberOfLines={1}>{item.artist}</SongArtist>
        )}
      </SongInfo>
      <SongActions>
        {showSongOptions !== false && onSongOptionsPress && (
          <ActionButton onPress={() => onSongOptionsPress(item)}>
            <Ionicons name="ellipsis-vertical" size={20} color="#999" />
          </ActionButton>
        )}
      </SongActions>
    </SongItem>
  );

  const renderEmptyState = () => (
    <EmptyContainer>
      <Ionicons name={emptyIcon as any} size={64} color="#333" />
      <EmptyText>{emptyMessage}</EmptyText>
      <EmptyText style={{ fontSize: 14, color: "#666" }}>
        {emptySubMessage}
      </EmptyText>
    </EmptyContainer>
  );

  const ListHeader = () => (
    <>
      <AlbumArtContainer>
        {libraryCover ? (
          libraryCover === "liked" ? (
            <LibraryCoverWrapper>
              <LibraryCoverGradient
                colors={["#3d02ae", "#6053b0", "#6c867f"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Entypo name="heart" size={64} color="white" />
              </LibraryCoverGradient>
            </LibraryCoverWrapper>
          ) : (
            <LibraryCoverWrapper>
              <LibraryCoverGradient
                colors={["#1a1a1a", "#404040", "#525252"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Entypo name="back-in-time" size={64} color="white" />
              </LibraryCoverGradient>
            </LibraryCoverWrapper>
          )
        ) : (
          <AlbumCover source={{ uri: albumArtUrl }} />
        )}
        <FloatingPlayButton
          onPress={onPlayAll || (() => handlePlaySong(songs[0], 0))}
        >
          <Ionicons name="play" size={24} color="#fff" />
        </FloatingPlayButton>
      </AlbumArtContainer>

      <AlbumInfoContainer>
        <View>
          <AlbumTitle>{title}</AlbumTitle>
          {artist && <AlbumArtist>{artist}</AlbumArtist>}
        </View>
        <ShuffleButton onPress={onShuffle}>
          <Ionicons name="shuffle" size={24} color="#fff" />
        </ShuffleButton>
      </AlbumInfoContainer>
    </>
  );

  return (
    <Screen>
      <Header>
        <HeaderButton onPress={onBack}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </HeaderButton>
        <HeaderTitle>{type === "playlist" ? "Playlist" : "Album"}</HeaderTitle>
        {showHeaderOptions && onHeaderOptionsPress && (
          <HeaderButton onPress={onHeaderOptionsPress}>
            <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
          </HeaderButton>
        )}
        {!showHeaderOptions && <View style={{ width: 40 }} />}
      </Header>

      <FlatList
        data={songs}
        renderItem={renderSongItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={songs.length > 0 ? ListHeader : null}
        ListEmptyComponent={
          <>
            <ListHeader />
            {renderEmptyState()}
          </>
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle || { paddingBottom: 80 }}
      />
    </Screen>
  );
};

export default Playlist;
