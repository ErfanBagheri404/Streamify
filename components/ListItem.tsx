import * as React from "react";
import { Image } from "react-native";
import styled from "styled-components/native";

export type ListItemProps = {
  title: string;
  stats: string;
  thumbnail?: string;
  uploader_data?: string;
  url?: string;
};

const Row = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 12px;
  gap: 12px;
`;

const Thumb = styled.Image`
  width: 64px;
  height: 64px;
  border-radius: 8px;
`;

const Content = styled.View`
  flex: 1;
`;

const Title = styled.Text`
  color: #ffffff;
`;

const Uploader = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
`;

const Stats = styled.Text`
  color: #737373;
  font-size: 12px;
`;

export default function ListItem(props: ListItemProps) {
  const { title, stats, thumbnail, uploader_data } = props;

  return (
    <Row>
      {!!thumbnail && <Thumb source={{ uri: thumbnail }} resizeMode="cover" />}
      <Content>
        <Title numberOfLines={2}>{title}</Title>
        {!!uploader_data && <Uploader>{uploader_data}</Uploader>}
        {!!stats && <Stats>{stats}</Stats>}
      </Content>
    </Row>
  );
}
