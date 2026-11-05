/********************************************************************
 *  AlarmList.tsx - Wake-radio alarms inside the sleep-timer sheet
 *
 *  One list plus one "Add" row. Tapping a row opens the editor; the
 *  toggle re-arms or cancels the alarm's notifications immediately.
 *******************************************************************/
import React, { useCallback, useEffect, useState } from "react";
import { TouchableOpacity, Text, View } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { t } from "../utils/localization";
import { alarmService, type WakeAlarm } from "../services/AlarmService";
import { AlarmEditorSheet } from "./AlarmEditorSheet";

const Row = styled.TouchableOpacity<{ borderColor: string }>`
  margin-top: 12px;
  padding-vertical: 13px;
  padding-horizontal: 16px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${(p: any) => p.borderColor};
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const RowTitle = styled.Text`
  font-size: 16px;
`;

const RowSubtitle = styled.Text`
  font-size: 12px;
  margin-top: 2px;
`;

const IconButton = styled.TouchableOpacity`
  padding: 6px;
`;

const pad2 = (n: number) => String(n).padStart(2, "0");

function formatRepeat(alarm: WakeAlarm, isFa: boolean): string {
  const days = alarm.weekdays;
  const labels = isFa
    ? ["ی", "د", "س", "چ", "پ", "ج", "ش"]
    : ["S", "M", "T", "W", "T", "F", "S"];
  if (days.length === 7) {
    return isFa ? "هر روز" : "Every day";
  }
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) {
    return isFa ? "روزهای کاری" : "Weekdays";
  }
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => labels[d])
    .join(" ");
}

export const AlarmList: React.FC = () => {
  const { colors } = useTheme();
  const { isRtl, language } = useAppLanguage();
  const accent = colors.accent;
  const [alarms, setAlarms] = useState<WakeAlarm[]>([]);
  const [editing, setEditing] = useState<WakeAlarm | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    void alarmService.load().then(setAlarms);
  }, []);

  const openEditor = useCallback((alarm: WakeAlarm | null) => {
    setEditing(alarm);
    setEditorOpen(true);
  }, []);

  const toggle = async (alarm: WakeAlarm) => {
    // Optimistic: the notification schedule round-trips through the OS, and
    // the list should not feel laggy when a row is tapped.
    setAlarms((prev) =>
      prev.map((a) => (a.id === alarm.id ? { ...a, enabled: !a.enabled } : a)),
    );
    await alarmService.save({ ...alarm, enabled: !alarm.enabled });
  };

  return (
    <View>
      {alarms.map((alarm) => (
        <Row
          key={alarm.id}
          borderColor={withOpacity(colors.foreground, 0.18)}
          onPress={() => openEditor(alarm)}
        >
          <View style={{ flex: 1 }}>
            <RowTitle
              style={{
                color: alarm.enabled ? colors.foreground : withOpacity(colors.foreground, 0.5),
                fontFamily: getAppFontFamily(isRtl, "bold"),
                ...getTextDirectionStyle(isRtl),
              }}
            >
              {`${pad2(alarm.hour)}:${pad2(alarm.minute)}`}
            </RowTitle>
            <RowSubtitle
              style={{
                color: withOpacity(colors.foreground, 0.6),
                fontFamily: getAppFontFamily(isRtl, "medium"),
                ...getTextDirectionStyle(isRtl),
              }}
            >
              {`${formatRepeat(alarm, language === "fa")} · ${alarm.playlistName}`}
            </RowSubtitle>
          </View>
          <IconButton
            onPress={() => {
              void toggle(alarm);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={alarm.enabled ? "alarm" : "alarm-outline"}
              size={20}
              color={alarm.enabled ? accent : withOpacity(colors.foreground, 0.45)}
            />
          </IconButton>
        </Row>
      ))}

      <Row
        borderColor={withOpacity(accent, 0.4)}
        onPress={() => openEditor(null)}
      >
        <Text
          style={{
            color: accent,
            fontFamily: getAppFontFamily(isRtl, "medium"),
            ...getTextDirectionStyle(isRtl),
          }}
        >
          {t("alarm.add") || "Add alarm"}
        </Text>
        <Ionicons name="add" size={20} color={accent} />
      </Row>

      <AlarmEditorSheet
        visible={editorOpen}
        alarm={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={setAlarms}
      />
    </View>
  );
};

export default AlarmList;
