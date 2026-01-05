import React, { useRef, useState } from "react";
const { Animated, PanResponder, Dimensions } = require("react-native");
import {
  Image,
  TextInput,
  Modal,
  View,
  TouchableOpacity,
  Text,
} from "react-native";
import styled from "styled-components/native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeArea } from "../SafeArea";
import AntDesign from "@expo/vector-icons/AntDesign";
import Entypo from "@expo/vector-icons/Entypo";
import { FontAwesome5, FontAwesome6, Fontisto } from "@expo/vector-icons";
import { usePlayer } from "../../contexts/PlayerContext";
import { StorageService, Playlist } from "../../utils/storage";
import { SongActionSheet } from "../SongActionSheet";
import { Track } from "../../contexts/PlayerContext";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

const { height } = Dimensions.get("window");
const SHEET_HEIGHT = height * 0.5;
const SHEET_CLOSED_TOP = height;
const SHEET_HALF_TOP = height - SHEET_HEIGHT;

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
  font-family: GoogleSansBold;
  line-height: 26px;
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
  font-family: GoogleSansRegular;
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
  font-family: ${(p: { active?: boolean }) =>
    p.active ? "GoogleSansBold" : "GoogleSansMedium"};
  line-height: 13px;
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
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const SortLabel = styled.Text`
  color: #fff;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const LayoutToggle = styled.TouchableOpacity`
  padding: 6px;
`;

const LayoutIcon = styled.Text`
  color: #a3a3a3;
  font-size: 18px;
  font-family: GoogleSansRegular;
  line-height: 22px;
`;

const Grid = styled.ScrollView`
  flex: 1;
  padding: 0 16px 80px 16px; /* Increased bottom padding for last items accessibility */
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
  font-family: GoogleSansRegular;
  line-height: 36px;
`;

const CollectionTitle = styled.Text`
  color: #fff;
  font-size: 14px;
  margin-top: 8px;
  font-family: GoogleSansSemiBold;
  line-height: 18px;
`;

const CollectionMeta = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const PinRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 2px;
`;

const PinIcon = styled.Text`
  color: #22c55e;
  margin-right: 4px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const PinLabel = styled.Text`
  color: #22c55e;
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 12px;
`;

const PinDot = styled.Text`
  color: #a3a3a3;
  margin: 0 4px;
  font-family: GoogleSansRegular;
  line-height: 12px;
`;

const ThreeDotButton = styled.TouchableOpacity`
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 12px;
  z-index: 10;
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
  {
    id: "previously-played",
    title: "Previously Played",
    meta: "Playlist • 0 songs",
    pinned: true,
    cover: null,
  },
];

export default function LibraryScreen({ navigation }: { navigation: any }) {
  const [activeSection, setActiveSection] = React.useState("Playlists");
  const [playlists, setPlaylists] = React.useState<Playlist[]>([]);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] =
    React.useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const { likedSongs, previouslyPlayedSongs } = usePlayer();

  // Song action sheet state
  const [showSongActionSheet, setShowSongActionSheet] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const sheetTop = useRef(new Animated.Value(SHEET_CLOSED_TOP)).current;
  const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHT);
  const sheetStateRef = useRef<"closed" | "half" | "full">("closed");

  const animateSheet = (state: "closed" | "half" | "full") => {
    let toValue = SHEET_CLOSED_TOP;
    if (state === "closed") {
      setSheetHeight(SHEET_HEIGHT);
      toValue = SHEET_CLOSED_TOP;
    } else if (state === "half") {
      setSheetHeight(SHEET_HEIGHT);
      toValue = SHEET_HALF_TOP;
    } else if (state === "full") {
      setSheetHeight(height);
      toValue = 0;
    }

    Animated.timing(sheetTop, {
      toValue,
      duration: 250,
      useNativeDriver: false,
    }).start(() => {
      sheetStateRef.current = state;
      if (state === "closed") {
        setShowSongActionSheet(false);
        setSelectedTrack(null);
      }
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_: any, gestureState: any) =>
        Math.abs(gestureState.dy) > 2,
      onPanResponderMove: (_: any, gestureState: any) => {
        const base =
          sheetStateRef.current === "full"
            ? 0
            : sheetStateRef.current === "half"
              ? SHEET_HALF_TOP
              : SHEET_CLOSED_TOP;
        let next = base + gestureState.dy;
        if (next < 0) {
          next = 0;
        }
        if (next > SHEET_CLOSED_TOP) {
          next = SHEET_CLOSED_TOP;
        }
        sheetTop.setValue(next);
      },
      onPanResponderRelease: (_: any, gestureState: any) => {
        const { dy, vy } = gestureState;
        let target: "closed" | "half" | "full" = sheetStateRef.current;

        if (sheetStateRef.current === "half") {
          if (dy > 60 || vy > 0.5) {
            target = "closed";
          } else if (dy < -60 || vy < -0.5) {
            target = "full";
          } else {
            target = "half";
          }
        } else if (sheetStateRef.current === "full") {
          if (dy > 60 || vy > 0.5) {
            target = "half";
          } else {
            target = "full";
          }
        }

        animateSheet(target);
      },
    })
  ).current;

  const closeSongActionSheet = () => {
    animateSheet("closed");
  };

  const openSongActionSheet = (track: Track) => {
    setSelectedTrack(track);
    setShowSongActionSheet(true);
    animateSheet("half");
  };

  const handleLikedSongsPress = () => {
    navigation.navigate("LikedSongs");
  };

  const handlePreviouslyPlayedPress = () => {
    navigation.navigate("PreviouslyPlayed");
  };

  const handleUserPlaylistPress = (playlist: any) => {
    navigation.navigate("AlbumPlaylist", {
      albumId: playlist.id,
      albumName: playlist.name,
      albumArtist: `${playlist.tracks.length} ${playlist.tracks.length === 1 ? "song" : "songs"}`,
      source: "user-playlist",
      tracks: playlist.tracks,
    });
  };

  const loadPlaylists = async () => {
    try {
      const loadedPlaylists = await StorageService.loadPlaylists();
      setPlaylists(loadedPlaylists);
    } catch (error) {
      console.error("Error loading playlists:", error);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) {
      console.warn("Please enter a playlist name");
      return;
    }

    try {
      const newPlaylist: Playlist = {
        id: Date.now().toString(),
        name: newPlaylistName.trim(),
        tracks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await StorageService.addPlaylist(newPlaylist);
      setPlaylists([...playlists, newPlaylist]);
      setNewPlaylistName("");
      setShowCreatePlaylistModal(false);
    } catch (error) {
      console.error("Error creating playlist:", error);
      console.warn("Failed to create playlist");
    }
  };

  React.useEffect(() => {
    loadPlaylists();

    // Refresh playlists when screen comes into focus
    const unsubscribe = navigation.addListener("focus", () => {
      loadPlaylists();
    });

    return unsubscribe;
  }, [navigation]);

  return (
    <SafeArea>
      <Screen>
        <Header>
          <HeaderLeft>
            <Avatar source={require("../../assets/StreamifyLogo.png")} />
            <HeaderTitle>Your Library</HeaderTitle>
          </HeaderLeft>
          <HeaderActions>
            <HeaderIconButton onPress={() => navigation.navigate("Settings")}>
              <HeaderIconText>
                <FontAwesome6 name="gear" size={20} color="white" />
              </HeaderIconText>
            </HeaderIconButton>
            <HeaderIconButton>
              <HeaderIconText>
                <Fontisto name="search" size={20} color="white" />
              </HeaderIconText>
            </HeaderIconButton>
            <HeaderIconButton onPress={() => setShowCreatePlaylistModal(true)}>
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
                  item.id === "liked"
                    ? handleLikedSongsPress
                    : item.id === "previously-played"
                      ? handlePreviouslyPlayedPress
                      : undefined
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
                ) : item.id === "previously-played" ? (
                  <LikedCoverWrapper>
                    <LikedCoverGradient
                      colors={["#1a1a1a", "#404040", "#525252"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Entypo name="back-in-time" size={42} color="white" />
                    </LikedCoverGradient>
                  </LikedCoverWrapper>
                ) : (
                  <CollectionCover source={item.cover as any} />
                )}
                <CollectionTitle>{item.title}</CollectionTitle>
                {item.id === "liked" || item.id === "previously-played" ? (
                  <>
                    <PinRow>
                      <PinIcon>
                        <AntDesign name="pushpin" size={14} color="green" />
                      </PinIcon>
                      <PinLabel>Playlist</PinLabel>
                      <PinDot>•</PinDot>
                      <CollectionMeta>
                        {item.id === "liked"
                          ? likedSongs.length
                          : previouslyPlayedSongs.length}{" "}
                        songs
                      </CollectionMeta>
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

          {/* Display user-created playlists */}
          {playlists.length > 0 && (
            <>
              {Array.from({ length: Math.ceil(playlists.length / 2) }).map(
                (_, rowIndex) => (
                  <GridRow key={rowIndex}>
                    {playlists
                      .slice(rowIndex * 2, (rowIndex + 1) * 2)
                      .map((playlist) => (
                        <CollectionCard
                          key={playlist.id}
                          onPress={() => handleUserPlaylistPress(playlist)}
                        >
                          {playlist.tracks.length > 0 &&
                          playlist.tracks[0].thumbnail ? (
                            <CollectionCover
                              source={{ uri: playlist.tracks[0].thumbnail }}
                            />
                          ) : (
                            <LikedCoverWrapper>
                              <LikedCoverGradient
                                colors={["#1a1a1a", "#404040", "#525252"]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                              >
                                <Entypo name="music" size={42} color="white" />
                              </LikedCoverGradient>
                            </LikedCoverWrapper>
                          )}
                          <CollectionTitle>{playlist.name}</CollectionTitle>
                          <CollectionMeta>
                            Playlist • {playlist.tracks.length} songs
                          </CollectionMeta>
                        </CollectionCard>
                      ))}
                  </GridRow>
                )
              )}
            </>
          )}
        </Grid>

        {/* Create Playlist Modal */}
        <Modal
          visible={showCreatePlaylistModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowCreatePlaylistModal(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <View
              style={{
                backgroundColor: "#1a1a1a",
                padding: 24,
                borderRadius: 12,
                width: "80%",
                maxWidth: 400,
              }}
            >
              <CollectionTitle
                style={{
                  marginBottom: 16,
                  textAlign: "center",
                  lineHeight: 24,
                }}
              >
                Create New Playlist
              </CollectionTitle>
              <TextInput
                style={{
                  backgroundColor: "#262626",
                  color: "#fff",
                  paddingHorizontal: 12,
                  height: 48,
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 16,
                  fontFamily: "GoogleSansRegular",
                  textAlign: "center",
                  textAlignVertical: "center",
                  includeFontPadding: false,
                  verticalAlign: "middle",
                }}
                placeholder="Enter playlist name"
                placeholderTextColor="#9ca3af"
                value={newPlaylistName}
                onChangeText={(text) => {
                  setNewPlaylistName(text);
                  // keep cursor at the same logical place
                  setSelection({ start: text.length, end: text.length });
                }}
                selection={selection}
                onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                autoFocus={true}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <TouchableOpacity
                  style={{
                    backgroundColor: "#404040",
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                    flex: 1,
                    marginRight: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                  }}
                  onPress={() => {
                    setShowCreatePlaylistModal(false);
                    setNewPlaylistName("");
                  }}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 14,
                      fontFamily: "GoogleSansSemiBold",
                      textAlign: "center",
                      textAlignVertical: "center",
                      includeFontPadding: false,
                      verticalAlign: "middle",
                    }}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    backgroundColor: "#3d02ae",
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                    flex: 1,
                    marginLeft: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                  }}
                  onPress={handleCreatePlaylist}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 14,
                      fontFamily: "GoogleSansSemiBold",
                      textAlign: "center",
                      textAlignVertical: "center",
                      includeFontPadding: false,
                      verticalAlign: "middle",
                    }}
                  >
                    Create
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Song Action Sheet */}
        <SongActionSheet
          visible={showSongActionSheet}
          onClose={closeSongActionSheet}
          sheetTop={sheetTop}
          sheetHeight={sheetHeight}
          panHandlers={panResponder.panHandlers}
          currentTrack={
            selectedTrack || { title: "", artist: "", thumbnail: "" }
          }
          options={[
            {
              key: "Share",
              label: "Share",
              icon: "share-outline",
            },
            {
              key: "Add to other playlist",
              label: "Add to other playlist",
              icon: "add-circle-outline",
            },
            {
              key: "Go to album",
              label: "Go to album",
              icon: "albums-outline",
            },
            {
              key: "Go to artists",
              label: "Go to artists",
              icon: "people-outline",
            },
            {
              key: "Sleep timer",
              label: "Sleep timer",
              icon: "time-outline",
            },
            {
              key: "Go to song radio",
              label: "Go to song radio",
              icon: "radio-outline",
            },
          ]}
          onOptionPress={(option) => {
            console.log("Song action:", option);
            closeSongActionSheet();
          }}
        />
      </Screen>
    </SafeArea>
  );
}
