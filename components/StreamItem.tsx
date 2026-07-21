import React, { useCallback } from "react";
import { View, Text } from "react-native";
import styled from "styled-components/native";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { ImageWithSkeleton } from "./ui/ImageWithSkeleton";
import { SkeletonLoader } from "./SkeletonLoader";

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
    // Artists & channels: square container for circular cropping
    if (props.source === "youtube_channel" || props.type === "artist") {
      return "96px"; /* Square for circular cropping */
    }
    // JioSaavn albums and songs: square
    if (props.source === "jiosaavn") {
      return "96px";
    }
    return "54px"; /* Rectangular for videos/songs/albums/playlists */
  }};
  border-radius: ${(props) => {
    // Artists & channels: circular (50% of width/height)
    if (props.source === "youtube_channel" || props.type === "artist") {
      return "48px"; /* 50% of width/height for circular shape */
    }
    // JioSaavn albums and songs: squared (no circular cropping)
    if (props.source === "jiosaavn") {
      return "8px"; /* Squared with rounded corners for all JioSaavn items */
    }
    return "8px"; /* Default rounded corners for other content */
  }};
  overflow: hidden;
  position: relative;
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
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();

  const formatAuthor = useCallback(
    (
      authorName?: string,
      source?: string,
      type?: string,
      channelDescription?: string,
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
    [],
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
      albumYear?: string,
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
    [],
  );

  return (
    <Row style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
      <ThumbWrap
        source={source}
        type={type}
        isPlaylist={!!videoCount}
        style={{
          backgroundColor: colors.surface1,
        }}
      >
        {!!thumbnailUrl ? (
          <ImageWithSkeleton
            source={{ uri: thumbnailUrl }}
            resizeMode="cover"
            containerStyle={{ flex: 1, backgroundColor: colors.surface1 }}
            style={{
              borderRadius:
                source === "youtube_channel" || type === "artist" ? 48 : 0,
            }}
            fallback={
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.surface2,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: 12,
                    fontFamily: getAppFontFamily(isRtl, "regular"),
                    ...getTextDirectionStyle(isRtl, "center"),
                  }}
                >
                  No Image
                </Text>
              </View>
            }
          />
        ) : (
          <View
            style={{
              flex: 1,
              backgroundColor: colors.surface2,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: colors.muted,
                fontSize: 12,
                fontFamily: getAppFontFamily(isRtl, "regular"),
                ...getTextDirectionStyle(isRtl, "center"),
              }}
            >
              No Image
            </Text>
          </View>
        )}
        {/* Blue badge removed from thumbnails - now shown in details row */}
        {/* Only show duration badge for meaningful durations and not for JioSaavn results or playlists */}
        {duration &&
          duration !== "0" &&
          duration !== "0:00" &&
          source !== "jiosaavn" &&
          !videoCount && (
            <DurationBadge
              style={{
                backgroundColor:
                  source === "youtube" || source === "youtubemusic"
                    ? "rgba(0, 0, 0, 0.78)"
                    : "rgba(0, 0, 0, 0.68)",
              }}
            >
              <DurationText
                style={{ fontFamily: getAppFontFamily(isRtl, "regular") }}
              >
                {duration}
              </DurationText>
            </DurationBadge>
          )}
      </ThumbWrap>
      <Content>
        <View
          style={{
            flexDirection: isRtl ? "row-reverse" : "row",
            alignItems: "center",
          }}
        >
          <Title
            style={{
              color: colors.foreground,
              fontFamily: getAppFontFamily(isRtl, "medium"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {title}
          </Title>
          {verified && (
            <VerifiedBadge
              style={{
                marginLeft: isRtl ? 0 : 4,
                marginRight: isRtl ? 4 : 0,
              }}
            >
              <MaterialIcons name="verified" size={16} color="#3b82f6" />
            </VerifiedBadge>
          )}
        </View>
        <MetaRow
          isChannel={source === "youtube_channel" || type === "artist"}
          style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
        >
          {!!author && (
            <Author
              numberOfLines={2}
              style={{
                color: colors.muted,
                fontFamily: getAppFontFamily(isRtl, "regular"),
                ...getTextDirectionStyle(isRtl),
              }}
            >
              {formatAuthor(author, source, type, channelDescription)}
            </Author>
          )}
          <SubMeta
            style={{
              color: colors.muted,
              fontFamily: getAppFontFamily(isRtl, "regular"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {formatSubMeta(
              views,
              uploaded,
              source,
              type,
              videoCount,
              isAlbum,
              searchFilter,
              searchSource,
              albumYear,
            )}
            {/* Show blue badge for albums/playlists with video count */}
            {(isAlbum || type === "playlist") && videoCount && (
              <DetailsBadge
                style={{
                  color: colors.muted,
                  fontFamily: getAppFontFamily(isRtl, "regular"),
                  marginLeft: isRtl ? 0 : 8,
                  marginRight: isRtl ? 8 : 0,
                  ...getTextDirectionStyle(isRtl),
                }}
              >
                {videoCount} videos
              </DetailsBadge>
            )}
          </SubMeta>
        </MetaRow>
      </Content>
    </Row>
  );
}

export function StreamItemSkeleton({
  source,
  type,
}: {
  source?: string;
  type?: string;
}) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();

  return (
    <Row style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
      <ThumbWrap
        source={source}
        type={type}
        style={{ backgroundColor: colors.surface1 }}
      >
        <SkeletonLoader
          style={{
            width: "100%",
            height: "100%",
            borderRadius:
              source === "youtube_channel" || type === "artist" ? 48 : 8,
          }}
        />
      </ThumbWrap>
      <Content style={{ alignItems: isRtl ? "flex-end" : "flex-start" }}>
        <SkeletonLoader
          width={168}
          height={18}
          style={{
            borderRadius: 8,
            marginBottom: 8,
            maxWidth: "92%",
            alignSelf: isRtl ? "flex-end" : "flex-start",
          }}
        />
        <SkeletonLoader
          width={132}
          height={16}
          style={{
            borderRadius: 7,
            marginBottom: 6,
            maxWidth: "76%",
            alignSelf: isRtl ? "flex-end" : "flex-start",
          }}
        />
        <SkeletonLoader
          width={108}
          height={16}
          style={{
            borderRadius: 7,
            maxWidth: "62%",
            alignSelf: isRtl ? "flex-end" : "flex-start",
          }}
        />
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
