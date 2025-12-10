import React, { useCallback, useState } from "react";
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
};

const Row = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px;
  gap: 12px;
`;

const ThumbWrap = styled.View`
  width: 96px; /* w-24 */
  height: 56px; /* h-14 */
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
`;

const Content = styled.View`
  flex: 1;
`;

const Title = styled.Text`
  color: #ffffff;
  font-size: 14px;
`;

const MetaRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const Author = styled.Text`
  color: #a3a3a3; /* neutral-400 */
  font-size: 12px;
`;

const SubMeta = styled.Text`
  color: #737373; /* neutral-500 */
  font-size: 12px;
`;

function StreamItem(props: StreamItemProps) {
  const { title, author, duration, views, uploaded, thumbnailUrl } = props;

  const [imageError, setImageError] = React.useState(false);

  const handleImageError = React.useCallback(() => {
    setImageError(true);
  }, []);

  const formatAuthor = React.useCallback((authorName?: string) => {
    return authorName ? authorName.replace(" - Topic", "") : "";
  }, []);

  const formatSubMeta = React.useCallback(
    (views?: string, uploaded?: string) => {
      const parts = [];
      if (views) parts.push(views);
      if (uploaded) {
        const cleanedUploaded = uploaded.replace("Streamed ", "");
        parts.push(cleanedUploaded);
      }
      return parts.join(" • ");
    },
    []
  );

  return (
    <Row>
      {!!thumbnailUrl && !imageError && (
        <ThumbWrap>
          <Thumbnail
            source={{ uri: thumbnailUrl }}
            resizeMode="cover"
            onError={handleImageError}
          />
          <DurationBadge>
            <DurationText>{duration}</DurationText>
          </DurationBadge>
        </ThumbWrap>
      )}
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

export default React.memo(StreamItem);
