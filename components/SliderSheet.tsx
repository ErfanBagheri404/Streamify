import React from "react";
import { TouchableOpacity, ScrollView } from "react-native";
const { Animated } = require("react-native");
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";

interface SheetOption {
  key: string;
  label: string;
  icon: string;
}

interface SliderSheetProps {
  visible: boolean;
  onClose: () => void;
  sheetTop: any; // Animated.AnimatedValue
  sheetHeight: number;
  panHandlers: any;
  currentTrack: {
    title: string;
    artist?: string;
    thumbnail?: string;
  };
  options: SheetOption[];
  onOptionPress: (option: string) => void;
}

const BottomSheetOverlay = styled.TouchableOpacity`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
`;

const BottomSheetContainer = styled(Animated.View)`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
`;

const BottomSheetInner = styled.View`
  background-color: #000000;
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  padding-bottom: 32px;
  height: 100%;
`;

const SheetHandle = styled.View`
  width: 40px;
  height: 4px;
  border-radius: 12px;
  background-color: #4b5563;
  align-self: center;
  margin-top: 8px;
  margin-bottom: 8px;
`;

const SheetContent = styled.View`
  padding-vertical: 8px;
  padding-horizontal: 24px;
`;

const SheetHeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding-vertical: 16px;
  padding-horizontal: 24px;
`;

const SheetHeaderCoverImage = styled.Image`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
`;

const SheetHeaderCoverPlaceholder = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
  align-items: center;
  justify-content: center;
`;

const SheetHeaderTextContainer = styled.View`
  flex-direction: column;
  flex: 1;
`;

const SheetHeaderTitle = styled.Text`
  color: #ffffff;
  font-size: 16px;
  font-family: GoogleSansMedium;
  margin-bottom: 2px;
  line-height: 20px;
`;

const SheetHeaderArtist = styled.Text`
  color: #9ca3af;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const SheetSeparator = styled.View`
  height: 1px;
  background-color: #374151;
  margin-horizontal: 24px;
`;

const SheetItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding-vertical: 12px;
`;

const SheetItemIconWrapper = styled.View`
  width: 32px;
  height: 32px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  margin-right: 16px;
`;

const SheetItemText = styled.Text`
  color: #ffffff;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

export const SliderSheet: React.FC<SliderSheetProps> = ({
  visible,
  onClose,
  sheetTop,
  sheetHeight,
  panHandlers,
  currentTrack,
  options,
  onOptionPress,
}) => {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();

  if (!visible) {
    return null;
  }

  const handleOptionPress = (option: string) => {
    onOptionPress(option);
    onClose();
  };

  return (
    <>
      <BottomSheetOverlay activeOpacity={1} onPress={onClose} />
      <BottomSheetContainer style={{ top: sheetTop }} {...panHandlers}>
        <BottomSheetInner
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
          }}
        >
          <SheetHandle style={{ backgroundColor: withOpacity(colors.foreground, 0.22) }} />
          <SheetHeaderRow style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
            {currentTrack.thumbnail ? (
              <SheetHeaderCoverImage
                source={{ uri: currentTrack.thumbnail }}
                style={{ marginRight: isRtl ? 0 : 12, marginLeft: isRtl ? 12 : 0 }}
              />
            ) : (
              <SheetHeaderCoverPlaceholder
                style={{
                  backgroundColor: colors.surface2,
                  marginRight: isRtl ? 0 : 12,
                  marginLeft: isRtl ? 12 : 0,
                }}
              >
                <Ionicons
                  name="musical-notes"
                  size={24}
                  color={colors.foreground}
                />
              </SheetHeaderCoverPlaceholder>
            )}
            <SheetHeaderTextContainer>
              <SheetHeaderTitle
                numberOfLines={1}
                style={{
                  color: colors.foreground,
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                  ...getTextDirectionStyle(isRtl),
                }}
              >
                {currentTrack.title}
              </SheetHeaderTitle>
              {currentTrack.artist && (
                <SheetHeaderArtist
                  numberOfLines={1}
                  style={{
                    color: colors.muted,
                    fontFamily: getAppFontFamily(isRtl, "regular"),
                    ...getTextDirectionStyle(isRtl),
                  }}
                >
                  {currentTrack.artist}
                </SheetHeaderArtist>
              )}
            </SheetHeaderTextContainer>
          </SheetHeaderRow>
          <SheetSeparator style={{ backgroundColor: colors.borderSubtle }} />
          <SheetContent>
            {options.map((option) => (
              <SheetItem
                key={option.key}
                onPress={() => handleOptionPress(option.key)}
                style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
              >
                <SheetItemIconWrapper
                  style={{ marginRight: isRtl ? 0 : 16, marginLeft: isRtl ? 16 : 0 }}
                >
                  <Ionicons
                    name={option.icon as any}
                    size={22}
                    color={colors.foreground}
                  />
                </SheetItemIconWrapper>
                <SheetItemText
                  style={{
                    color: colors.foreground,
                    fontFamily: getAppFontFamily(isRtl, "regular"),
                    ...getTextDirectionStyle(isRtl),
                  }}
                >
                  {option.label}
                </SheetItemText>
              </SheetItem>
            ))}
          </SheetContent>
        </BottomSheetInner>
      </BottomSheetContainer>
    </>
  );
};
