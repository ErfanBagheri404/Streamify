/********************************************************************
 *  SleepTimerSheet.tsx - Arm / cancel the sleep timer
 *
 *  Perf contract: the 1s countdown interval exists ONLY while this sheet
 *  is visible. The actual pause is scheduled by SleepTimerService with a
 *  single setTimeout, independent of this component.
 *******************************************************************/
import React, { useEffect, useState } from "react";
import { Modal, TouchableOpacity, Text } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { t } from "../utils/localization";
import {
  SLEEP_TIMER_PRESET_MINUTES,
  sleepTimerService,
  useSleepTimerStore,
} from "../services/SleepTimerService";

interface SleepTimerSheetProps {
  visible: boolean;
  onClose: () => void;
}

const SheetModal = styled(Modal)``;

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
  margin-bottom: 14px;
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
  min-width: 78px;
  padding-vertical: 12px;
  padding-horizontal: 14px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${(props: any) => (props.isActive ? props.activeColor : props.borderColor)};
  align-items: center;
`;

const PresetLabel = styled.Text`
  font-size: 14px;
`;

const EndOfTrackRow = styled(TouchableOpacity)<{ borderColor: string; activeColor: string; isActive: boolean }>`
  margin-top: 12px;
  padding-vertical: 14px;
  padding-horizontal: 16px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${(props: any) => (props.isActive ? props.activeColor : props.borderColor)};
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const ActiveBanner = styled.View`
  margin-bottom: 14px;
  padding-vertical: 12px;
  padding-horizontal: 14px;
  border-radius: 12px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const formatRemaining = (ms: number | null): string => {
  if (ms === null) {
    return "";
  }
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

export const SleepTimerSheet: React.FC<SleepTimerSheetProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const { isRtl, language } = useAppLanguage();
  const isActive = useSleepTimerStore((state) => state.active);
  const mode = useSleepTimerStore((state) => state.mode);
  const revision = useSleepTimerStore((state) => state.revision);

  // Ticking is scoped to this sheet being visible.
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setRemainingMs(sleepTimerService.getRemainingMs());
    if (mode !== "minutes") {
      return;
    }
    const interval = setInterval(() => {
      setRemainingMs(sleepTimerService.getRemainingMs());
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, mode, revision]);

  const accent = colors.accent;

  return (
    <SheetModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
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
            {t("playerActions.sleepTimer") || "Sleep timer"}
          </SheetTitle>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={withOpacity(colors.foreground, 0.7)} />
          </TouchableOpacity>
        </SheetHeader>

        {isActive && (
          <ActiveBanner style={{ backgroundColor: withOpacity(accent, 0.12) }}>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: getAppFontFamily(isRtl, "medium"),
                ...getTextDirectionStyle(isRtl),
              }}
            >
              {mode === "endOfTrack"
                ? t("sleepTimer.endOfTrackActive") || "Pausing after this track"
                : `${t("sleepTimer.active") || "Pausing in"} ${formatRemaining(remainingMs)}`}
            </Text>
            <TouchableOpacity
              onPress={() => {
                sleepTimerService.clear();
                onClose();
              }}
            >
              <Text
                style={{
                  color: accent,
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                }}
              >
                {t("sleepTimer.cancel") || "Cancel"}
              </Text>
            </TouchableOpacity>
          </ActiveBanner>
        )}

        <PresetGrid style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
          {SLEEP_TIMER_PRESET_MINUTES.map((minutes) => {
            return (
              <PresetChip
                key={minutes}
                isActive={false}
                borderColor={withOpacity(colors.foreground, 0.18)}
                activeColor={accent}
                onPress={() => {
                  sleepTimerService.startMinutes(minutes);
                  onClose();
                }}
              >
                <PresetLabel
                  style={{
                    color: colors.foreground,
                    fontFamily: getAppFontFamily(isRtl, "medium"),
                  }}
                >
                  {`${minutes} ${language === "fa" ? "دقیقه" : "min"}`}
                </PresetLabel>
              </PresetChip>
            );
          })}
        </PresetGrid>

        <EndOfTrackRow
          isActive={isActive && mode === "endOfTrack"}
          borderColor={withOpacity(colors.foreground, 0.18)}
          activeColor={accent}
          onPress={() => {
            sleepTimerService.startEndOfTrack();
            onClose();
          }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontFamily: getAppFontFamily(isRtl, "medium"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {t("sleepTimer.endOfTrack") || "End of current track"}
          </Text>
          <Ionicons
            name="play-skip-forward-outline"
            size={18}
            color={withOpacity(colors.foreground, 0.6)}
          />
        </EndOfTrackRow>
      </SheetBody>
    </SheetModal>
  );
};

export default SleepTimerSheet;
