import React, { useCallback, useState } from "react";
import { View, Text } from "react-native";
import styled from "styled-components/native";
import { MaterialIcons } from "@expo/vector-icons";

export type StreamItemProps = {
  id: string;
  title: string;
  author?: string;
  duration: string;
  href?: string;
  uploaded?: string;
  channelUrl?: string;
  views?: string;
  videoCount?: string; // For playlists - number of videos
  img?: string;
  draggable?: boolean;
  lastUpdated?: string;
  thumbnailUrl?: string;
  isAlbum?: boolean;
  albumYear?: string;
  source?: string; // Add source to identify JioSaavn results
  type?: string; // Add type to identify artist items
  channelDescription?: string; // Add channel description for artists/channels
  verified?: boolean; // Add verified badge for channels
  showGrayLayers?: boolean; // Add prop to control gray layer visibility
  searchFilter?: string; // Add search filter to control metadata display
  searchSource?: string; // Add search source to control metadata display
};

const Row = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 16px 12px;
  gap: 12px;
`;

const ThumbWrap = styled.View<{
  source?: string;
  isPlaylist?: boolean;
  type?: string;
}>`
  width: 96px; /* w-24 */
  height: ${(props) => {
    // JioSaavn albums and songs: square
    if (props.source === "jiosaavn") {
      return "96px";
    }
    // Channels and artists: square container for circular cropping
    if (props.source === "youtube_channel" || props.type === "artist") {
      return "96px"; /* Square for circular cropping */
    }
    return "54px"; /* Rectangular for videos/songs/albums/playlists */
  }};
  border-radius: ${(props) => {
    // JioSaavn albums and songs: squared (no circular cropping)
    if (props.source === "jiosaavn") {
      return "8px"; /* Squared with rounded corners for all JioSaavn items */
    }
    // Only make circular for YouTube channels and artist items
    if (props.source === "youtube_channel" || props.type === "artist") {
      return "48px"; /* 50% of width/height for circular shape */
    }
    return "8px"; /* Default rounded corners for other content */
  }};
  overflow: hidden;
  position: relative;
`;

const Thumbnail = styled.Image<{
  imgSource?: string;
  imgType?: string;
}>`
  width: 100%;
  height: 100%;
  border-radius: ${(props) => {
    // Make circular for YouTube channels and artist items
    if (props.imgSource === "youtube_channel" || props.imgType === "artist") {
      return "48px"; /* 50% of width/height for circular shape */
    }
    return "0px"; /* No border radius for other content */
  }};
`;

const DurationBadge = styled.View`
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px 4px;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.7);
`;

const PlaylistBadge = styled.View`
  position: absolute;
  left: 4px;
  top: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(59, 130, 246, 0.9); /* blue-500 with transparency */
`;

const DurationText = styled.Text`
  color: #fff;
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const PlaylistText = styled.Text`
  color: #fff;
  font-size: 11px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const DetailsBadge = styled.Text`
  color: #737373; /* neutral-500 - match details row color */
  font-size: 12px;
  font-family: GoogleSansRegular;
  margin-left: 8px;
`;

const Content = styled.View`
  flex: 1;
  justify-content: center;
`;

const Title = styled.Text`
  color: #ffffff;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const MetaRow = styled.View<{ isChannel?: boolean }>`
  flex-direction: row;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: ${(props) => (props.isChannel ? "0px" : "8px")};
`;

const Author = styled.Text`
  color: #a3a3a3; /* neutral-400 */
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const SubMeta = styled.Text`
  color: #737373; /* neutral-500 */
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const VerifiedBadge = styled.View`
  margin-left: 4px;
`;

const PlaylistLayer1 = styled.View`
  position: absolute;
  top: 2px;
  left: 2px;
  width: 100%;
  height: 100%;
  background-color: #1f2937; /* gray-800 */
  border-radius: 6px;
  z-index: -1;
`;

const PlaylistLayer2 = styled.View`
  position: absolute;
  top: 4px;
  left: 4px;
  width: 100%;
  height: 100%;
  background-color: #111827; /* gray-900 */
  border-radius: 4px;
  z-index: -2;
`;

function StreamItem(props: StreamItemProps) {
  const {
    title,
    author,
    duration,
    views,
    videoCount,
    uploaded,
    thumbnailUrl,
    source,
    type,
    isAlbum,
    albumYear,
    channelDescription,
    verified,
    showGrayLayers = false,
    searchFilter,
    searchSource,
  } = props;

  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const formatAuthor = useCallback(
    (
      authorName?: string,
      source?: string,
      type?: string,
      channelDescription?: string
    ) => {
      if (
        !authorName ||
        authorName === "Unknown Artist" ||
        authorName === "Unknown"
      ) {
        // For artists and channels, show channel description if available
        if (
          source === "jiosaavn" ||
          source === "youtube_channel" ||
          type === "artist"
        ) {
          if (channelDescription) {
            // Return full channel description - let the UI handle truncation
            return channelDescription;
          }
          return "";
        }
        return "Unknown Artist";
      }
      return authorName.replace(" - Topic", "");
    },
    []
  );

  const formatSubMeta = useCallback(
    (
      views?: string,
      uploaded?: string,
      source?: string,
      type?: string,
      videoCount?: string,
      isAlbum?: boolean,
      searchFilter?: string,
      searchSource?: string,
      albumYear?: string
    ) => {
      const parts = [];

      // For YouTube Music songs filter, don't show view count or date
      if (searchSource === "youtubemusic" && searchFilter === "songs") {
        return "";
      }

      if (isAlbum) {
        return albumYear ? `Album • ${albumYear}` : "Album";
      }

      // Skip video count for albums/playlists - shown separately with blue badge
      if (!isAlbum && type !== "playlist" && views) {
        parts.push(views);
      }
      // Skip showing date for artists, channels, albums, and playlists
      if (
        uploaded &&
        source !== "jiosaavn" &&
        source !== "youtube_channel" &&
        type !== "artist" &&
        !isAlbum &&
        type !== "playlist"
      ) {
        const cleanedUploaded = uploaded.replace("Streamed ", "");
        parts.push(cleanedUploaded);
      }
      return parts.join(" • ");
    },
    []
  );

  return (
    <Row>
      <ThumbWrap source={source} type={type} isPlaylist={!!videoCount}>
        {!!thumbnailUrl && !imageError ? (
          <Thumbnail
            imgSource={source}
            imgType={type}
            source={{ uri: thumbnailUrl }}
            resizeMode="cover"
            onError={handleImageError}
            onLoad={handleImageLoad}
            fadeDuration={0}
          />
        ) : (
          <View
            style={{
              flex: 1,
              backgroundColor: "#262626",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {!imageLoaded && (
              <Text style={{ color: "#a3a3a3", fontSize: 12 }}>Loading...</Text>
            )}
            {imageLoaded && imageError && (
              <Text style={{ color: "#a3a3a3", fontSize: 12 }}>No Image</Text>
            )}
          </View>
        )}
        {/* Blue badge removed from thumbnails - now shown in details row */}
        {/* Only show duration badge for meaningful durations and not for JioSaavn results or playlists */}
        {duration &&
          duration !== "0" &&
          duration !== "0:00" &&
          source !== "jiosaavn" &&
          !videoCount && (
            <DurationBadge>
              <DurationText>{duration}</DurationText>
            </DurationBadge>
          )}
      </ThumbWrap>
      <Content>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Title>{title}</Title>
          {verified && (
            <VerifiedBadge>
              <MaterialIcons name="verified" size={16} color="#3b82f6" />
            </VerifiedBadge>
          )}
        </View>
        <MetaRow isChannel={source === "youtube_channel" || type === "artist"}>
          {!!author && (
            <Author numberOfLines={2}>
              {formatAuthor(author, source, type, channelDescription)}
            </Author>
          )}
          <SubMeta>
            {formatSubMeta(
              views,
              uploaded,
              source,
              type,
              videoCount,
              isAlbum,
              searchFilter,
              searchSource,
              albumYear
            )}
            {/* Show blue badge for albums/playlists with video count */}
            {(isAlbum || type === "playlist") && videoCount && (
              <DetailsBadge>{videoCount} videos</DetailsBadge>
            )}
          </SubMeta>
        </MetaRow>
      </Content>
    </Row>
  );
}

export default React.memo(StreamItem, (prevProps, nextProps) => {
  // Only re-render if essential props change
  return (
    prevProps.id === nextProps.id &&
    prevProps.title === nextProps.title &&
    prevProps.author === nextProps.author &&
    prevProps.duration === nextProps.duration &&
    prevProps.views === nextProps.views &&
    prevProps.videoCount === nextProps.videoCount &&
    prevProps.uploaded === nextProps.uploaded &&
    prevProps.thumbnailUrl === nextProps.thumbnailUrl &&
    prevProps.isAlbum === nextProps.isAlbum &&
    prevProps.albumYear === nextProps.albumYear &&
    prevProps.source === nextProps.source
  );
});
