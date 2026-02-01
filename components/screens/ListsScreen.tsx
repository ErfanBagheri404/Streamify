import React from "react";
import styled from "styled-components/native";
import { FlatList } from "react-native";
import ListItem from "../ListItem";
import { t } from "../../utils/localization";
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
      title: t("screens.album_playlist.top_hits"),
      stats: `32 ${t("screens.album_playlist.items")}`,
      uploader_data: t("screens.album_playlist.curated"),
      thumbnail: generateImageUrl("SeGNxgujehE", "hq"),
    },
    {
      title: t("screens.album_playlist.new_releases"),
      stats: `18 ${t("screens.album_playlist.items")}`,
      uploader_data: t("screens.album_playlist.weekly"),
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
          contentContainerStyle={{ paddingBottom: 80 }} // Ensure last items are accessible
        />
      </Content>
    </Screen>
  );
}
