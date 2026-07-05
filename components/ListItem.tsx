import * as React from "react";
import { Image } from "react-native";
import styled from "styled-components/native";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";

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
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const Uploader = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const Stats = styled.Text`
  color: #737373;
  font-size: 12px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

export default function ListItem(props: ListItemProps) {
  const { title, stats, thumbnail, uploader_data } = props;
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();

  return (
    <Row style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
      {!!thumbnail && <Thumb source={{ uri: thumbnail }} resizeMode="cover" />}
      <Content>
        <Title
          numberOfLines={2}
          style={{
            color: colors.foreground,
            fontFamily: getAppFontFamily(isRtl, "medium"),
            ...getTextDirectionStyle(isRtl),
          }}
        >
          {title}
        </Title>
        {!!uploader_data && (
          <Uploader
            style={{
              color: colors.muted,
              fontFamily: getAppFontFamily(isRtl, "regular"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {uploader_data}
          </Uploader>
        )}
        {!!stats && (
          <Stats
            style={{
              color: colors.muted,
              fontFamily: getAppFontFamily(isRtl, "regular"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {stats}
          </Stats>
        )}
      </Content>
    </Row>
  );
}
