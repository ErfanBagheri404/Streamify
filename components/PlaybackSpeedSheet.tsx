/********************************************************************
 *  PlaybackSpeedSheet.tsx - Choose playback rate (0.5x - 2x)
 *
 *  Perf contract: zero timers, zero listeners. A tap is one native
 *  setRate call. Store subscription re-renders only this sheet + the
 *  player badge.
 *******************************************************************/
import React from "react";
import { Modal, TouchableOpacity, Text } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { t } from "../utils/localization";
import {
  PLAYBACK_SPEED_PRESETS,
  playbackSpeedService,
  usePlaybackSpeedStore,
} from "../services/PlaybackSpeedService";

interface PlaybackSpeedSheetProps {
  visible: boolean;
  onClose: () => void;
}

const SheetBackdrop = styled(TouchableOpacity)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.6);
`;

const SheetBody = styled.View`
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 20px 18px 32px 18px;
`;

const SheetHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`;

const SheetTitle = styled.Text`
  font-size: 17px;
`;

const PresetGrid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
`;

const PresetChip = styled(TouchableOpacity)<{ isActive: boolean; borderColor: string; activeColor: string }>`
  min-width: 68px;
  padding-vertical: 12px;
  padding-horizontal: 12px;
  border-radius: 12px;
  border-width: 1px;
  align-items: center;
  border-color: ${(props: any) => (props.isActive ? props.activeColor : props.borderColor)};
  background-color: ${(props: any) => (props.isActive ? props.activeColor + "1f" : "transparent")};
`;

const PresetLabel = styled.Text`
  font-size: 14px;
`;

export const PlaybackSpeedSheet: React.FC<PlaybackSpeedSheetProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const rate = usePlaybackSpeedStore((state) => state.rate);

  if (!visible) {
    return null;
  }

  const accent = colors.accent;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SheetBackdrop activeOpacity={1} onPress={onClose} />
      <SheetBody style={{ backgroundColor: colors.background }}>
        <SheetHeader>
          <SheetTitle
            style={{
              color: colors.foreground,
              fontFamily: getAppFontFamily(isRtl, "bold"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {t("playerActions.playbackSpeed") || "Playback speed"}
          </SheetTitle>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={withOpacity(colors.foreground, 0.7)} />
          </TouchableOpacity>
        </SheetHeader>

        <PresetGrid style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
          {PLAYBACK_SPEED_PRESETS.map((preset) => {
            const isActive = Math.abs(preset - rate) < 0.001;
            return (
              <PresetChip
                key={preset}
                isActive={isActive}
                borderColor={withOpacity(colors.foreground, 0.18)}
                activeColor={accent}
                onPress={() => {
                  void playbackSpeedService.setRate(preset);
                  onClose();
                }}
              >
                <PresetLabel
                  style={{
                    color: isActive ? accent : colors.foreground,
                    fontFamily: getAppFontFamily(isRtl, isActive ? "bold" : "medium"),
                  }}
                >
                  {`${preset}×`}
                </PresetLabel>
              </PresetChip>
            );
          })}
        </PresetGrid>
      </SheetBody>
    </Modal>
  );
};

export default PlaybackSpeedSheet;
