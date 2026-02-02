import React, { useCallback, useState } from "react";
import { View, Text } from "react-native";
import styled from "styled-components/native";

export type StreamItemProps = {
  id: string;
  title: string;
  author?: string;
  duration: string;
  href?: string;
  uploaded?: string;
  channelUrl?: string;
  views?: string;
  img?: string;
  draggable?: boolean;
  lastUpdated?: string;
  thumbnailUrl?: string;
  isAlbum?: boolean;
  albumYear?: string;
  source?: string; // Add source to identify JioSaavn results
};

const Row = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 16px 12px;
  gap: 12px;
`;

const ThumbWrap = styled.View<{ source?: string }>`
  width: 96px; /* w-24 */
  height: ${(props) =>
    props.source === "jiosaavn"
      ? "96px"
      : "56px"}; /* 1:1 for JioSaavn, 16:9 for others */
  background-color: #262626; /* neutral-800 */
  border-radius: 8px;
  overflow: hidden;
  position: relative;
`;

const Thumbnail = styled.Image`
  width: 100%;
  height: 100%;
`;

const DurationBadge = styled.View`
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px 4px;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.7);
`;

const DurationText = styled.Text`
  color: #fff;
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const Content = styled.View`
  flex: 1;
`;

const Title = styled.Text`
  color: #ffffff;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const MetaRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
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

function StreamItem(props: StreamItemProps) {
  const { title, author, duration, views, uploaded, thumbnailUrl, source } =
    props;

  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  const formatAuthor = useCallback((authorName?: string) => {
    return authorName ? authorName.replace(" - Topic", "") : "";
  }, []);

  const formatSubMeta = useCallback((views?: string, uploaded?: string) => {
    const parts = [];
    if (views) {
      parts.push(views);
    }
    if (uploaded) {
      const cleanedUploaded = uploaded.replace("Streamed ", "");
      parts.push(cleanedUploaded);
    }
    return parts.join(" • ");
  }, []);

  return (
    <Row>
      <ThumbWrap source={source}>
        {!!thumbnailUrl && !imageError ? (
          <Thumbnail
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
        {/* Only show duration badge for meaningful durations and not for JioSaavn results */}
        {duration &&
          duration !== "0" &&
          duration !== "0:00" &&
          source !== "jiosaavn" && (
            <DurationBadge>
              <DurationText>{duration}</DurationText>
            </DurationBadge>
          )}
      </ThumbWrap>
      <Content>
        <Title numberOfLines={2}>{title}</Title>
        <MetaRow>
          {!!author && <Author>{formatAuthor(author)}</Author>}
          <SubMeta>{formatSubMeta(views, uploaded)}</SubMeta>
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
    prevProps.uploaded === nextProps.uploaded &&
    prevProps.thumbnailUrl === nextProps.thumbnailUrl &&
    prevProps.isAlbum === nextProps.isAlbum &&
    prevProps.albumYear === nextProps.albumYear &&
    prevProps.source === nextProps.source
  );
});
