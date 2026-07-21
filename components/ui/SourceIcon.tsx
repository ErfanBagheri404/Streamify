import React from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import DeezerSvg from "../../assets/sources/Deezer.svg";
import ITunesSvg from "../../assets/sources/ITunes.svg";
import JioSaavnSvg from "../../assets/sources/JioSaavn.svg";
import SoundcloudSvg from "../../assets/sources/soundcloud.svg";
import SpotifySvg from "../../assets/sources/Spotify.svg";
import YouTubeSvg from "../../assets/sources/YouTube.svg";
import YoutubeMusicSvg from "../../assets/sources/YoutubeMusic.svg";
import StreamifyLogoSvg from "../../assets/StreamifyLogo.svg";

type SourceIconProps = {
  source?: string | null;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

const SOURCE_ICON_MAP: Record<string, React.FC<any>> = {
  deezer: DeezerSvg,
  itunes: ITunesSvg,
  jiosaavn: JioSaavnSvg,
  soundcloud: SoundcloudSvg,
  spotify: SpotifySvg,
  youtube: YouTubeSvg,
  youtubemusic: YoutubeMusicSvg,
  mixed: StreamifyLogoSvg,
};

function normalizeSource(source?: string | null): string {
  return (source || "").trim().toLowerCase();
}

export const SourceIcon: React.FC<SourceIconProps> = ({
  source,
  size = 16,
  color,
  style,
}) => {
  const key = normalizeSource(source);
  const SvgComponent = SOURCE_ICON_MAP[key];
  if (!SvgComponent) return null;

  // StreamifyLogo fills its entire viewBox with no internal padding,
  // so visually it looks bigger than other source icons at the same size.
  // Scale it down slightly and center it to match the visual weight.
  const visualScale = key === "mixed" ? 0.8 : 1;
  const svgSize = Math.round(size * visualScale);
  const svgProps: any = { width: svgSize, height: svgSize };
  if (key === "mixed" && color) {
    svgProps.color = color;
  }

  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <SvgComponent {...svgProps} />
    </View>
  );
};

export default SourceIcon;
