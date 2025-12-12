import React from "react";
import styled from "styled-components/native";
import { FlatList } from "react-native";
import ListItem from "../ListItem";
// generateImageUrl temporarily stubbed until the module is available
const generateImageUrl = (id: string, quality: string) =>
  `https://i.ytimg.com/vi/${id}/${quality}default.jpg`;

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

const Content = styled.View`
  padding: 16px;
`;

export default function ListsScreen() {
  const data = [
    {
      title: "Top Hits",
      stats: "32 items",
      uploader_data: "Curated",
      thumbnail: generateImageUrl("SeGNxgujehE", "hq"),
    },
    {
      title: "New Releases",
      stats: "18 items",
      uploader_data: "Weekly",
      thumbnail: generateImageUrl("dQw4w9WgXcQ", "mq"),
    },
  ];
  return (
    <Screen>
      <Content>
        <FlatList
          data={data}
          keyExtractor={(item, idx) => String(idx)}
          renderItem={({ item }: { item: (typeof data)[0] }) => (
            <ListItem {...item} />
          )}
        />
      </Content>
    </Screen>
  );
}
