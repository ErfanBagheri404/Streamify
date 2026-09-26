/********************************************************************
 *  AlarmEditorSheet.tsx - Create / edit one wake-radio alarm
 *
 *  Deliberately a sheet inside the sleep-timer sheet rather than a new
 *  settings screen: the sleep timer is where the user already goes when
 *  they think about waking up to music.
 *
 *  Hour/minute use the app's own numeric-keypad pattern (see NumericKeypad)
 *  so time entry works identically to the existing numeric inputs instead
 *  of dragging the platform time picker into a themed bottom sheet.
 *******************************************************************/
import React, { useMemo, useState } from "react";
import { Modal, TouchableOpacity, Text, ScrollView, View } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { t } from "../utils/localization";
import {
  ALARM_FADE_MINUTES,
  alarmService,
  validateAlarm,
  type WakeAlarm,
} from "../services/AlarmService";

interface AlarmEditorSheetProps {
  visible: boolean;
  /** null = creating a new alarm. */
  alarm: WakeAlarm | null;
  onClose: () => void;
  onSaved: (alarms: WakeAlarm[]) => void;
}

const Overlay = styled(Modal)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.6);
`;

const Body = styled.View`
  margin-top: auto;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 20px 18px 32px 18px;
  max-height: 88%;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`;

const TimeRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
`;

const TimeBox = styled.TouchableOpacity<{ borderColor: string }>`
  width: 84px;
  height: 84px;
  border-radius: 16px;
  border-width: 1px;
  border-color: ${(p: any) => p.borderColor};
  align-items: center;
  justify-content: center;
`;

const TimeValue = styled.Text`
  font-size: 34px;
`;

const Colon = styled.Text`
  font-size: 28px;
  padding-horizontal: 12px;
`;

const SectionLabel = styled.Text`
  font-size: 12px;
  letter-spacing: 0.6px;
  margin-bottom: 8px;
`;

const DayGrid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
`;

const DayChip = styled.TouchableOpacity<{ activeColor: string; borderColor: string; isActive: boolean }>`
  padding-vertical: 9px;
  padding-horizontal: 12px;
  border-radius: 10px;
  border-width: 1px;
  border-color: ${(p: any) => (p.isActive ? p.activeColor : p.borderColor)};
  min-width: 46px;
  align-items: center;
`;

const OptionRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
`;

const OptionChip = styled.TouchableOpacity<{ activeColor: string; borderColor: string; isActive: boolean }>`
  padding-vertical: 9px;
  padding-horizontal: 14px;
  border-radius: 10px;
  border-width: 1px;
  border-color: ${(p: any) => (p.isActive ? p.activeColor : p.borderColor)};
  align-items: center;
`;

const Footer = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
`;

const ActionText = styled.Text`
  font-size: 15px;
`;

const ErrorText = styled.Text`
  font-size: 12px;
  margin-bottom: 10px;
`;

/** JS getDay() order starting Monday reads better in a row of chips. */
const DAY_CHIPS = [
  { value: 1, short: "M", label: "Mon" },
  { value: 2, short: "T", label: "Tue" },
  { value: 3, short: "W", label: "Wed" },
  { value: 4, short: "T", label: "Thu" },
  { value: 5, short: "F", label: "Fri" },
  { value: 6, short: "S", label: "Sat" },
  { value: 0, short: "S", label: "Sun" },
];

const FADE_CHOICES = [1, 2, 3];

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Tapping a time box cycles through plausible values instead of opening a
 * picker: hours 0-23, minutes in 5-minute steps. Enough granularity for
 * "wake me at 6:30", and it keeps the whole editor inside this sheet.
 */
function nextValue(current: number, field: "hour" | "minute"): number {
  if (field === "hour") {
    return (current + 1) % 24;
  }
  return (current + 5) % 60;
}

export const AlarmEditorSheet: React.FC<AlarmEditorSheetProps> = ({
  visible,
  alarm,
  onClose,
  onSaved,
}) => {
  const { colors } = useTheme();
  const { isRtl, language } = useAppLanguage();
  const accent = colors.accent;

  const [hour, setHour] = useState(alarm?.hour ?? 7);
  const [minute, setMinute] = useState(alarm?.minute ?? 0);
  const [weekdays, setWeekdays] = useState<number[]>(
    alarm?.weekdays ?? [1, 2, 3, 4, 5],
  );
  const [fadeMinutes, setFadeMinutes] = useState(
    alarm?.fadeMinutes ?? ALARM_FADE_MINUTES.default,
  );
  const [source, setSource] = useState<"mix" | "liked">(
    alarm?.playlistId ? "liked" : "mix",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed the form when the target alarm changes (a second alarm opened
  // in the same session must not inherit the previous one's values).
  const seedKey = alarm?.id ?? "new";
  const [seededFor, setSeededFor] = useState(seedKey);
  if (visible && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setHour(alarm?.hour ?? 7);
    setMinute(alarm?.minute ?? 0);
    setWeekdays(alarm?.weekdays ?? [1, 2, 3, 4, 5]);
    setFadeMinutes(alarm?.fadeMinutes ?? ALARM_FADE_MINUTES.default);
    setSource(alarm?.playlistId ? "liked" : "mix");
    setError(null);
  }

  const summary = useMemo(() => {
    const days = weekdays.length;
    if (days === 0) {
      return language === "fa" ? "روز انتخاب نشده" : "Pick at least one day";
    }
    if (days === 7) {
      return language === "fa" ? "هر روز" : "Every day";
    }
    if (days === 5 && [1, 2, 3, 4, 5].every((d) => weekdays.includes(d))) {
      return language === "fa" ? "شنبه تا چهارشنبه" : "Weekdays";
    }
    if (days === 2 && weekdays.includes(0) && weekdays.includes(6)) {
      return language === "fa" ? "آخر هفته" : "Weekends";
    }
    return DAY_CHIPS.filter((d) => weekdays.includes(d.value))
      .map((d) => d.label)
      .join(" · ");
  }, [weekdays, language]);

  const toggleDay = (day: number) => {
    setError(null);
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const save = async () => {
    if (saving) {
      return;
    }
    const candidate: WakeAlarm = {
      id: alarm?.id ?? `alarm-${Date.now()}`,
      hour,
      minute,
      weekdays,
      // A playlist-backed alarm is not modelled yet: the two sources on
      // offer are a smart mix and the liked library.
      playlistId: null,
      playlistName:
        source === "liked"
          ? t("alarm.sourceLiked") || "Liked songs"
          : t("alarm.sourceMix") || "Mix from history",
      fadeMinutes,
      enabled: true,
    };
    try {
      validateAlarm(candidate);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : language === "fa"
            ? "تنظیم نامعتبر"
            : "Invalid alarm",
      );
      return;
    }
    setSaving(true);
    try {
      const alarms = await alarmService.save(candidate);
      onSaved(alarms);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : language === "fa"
            ? "ذخیره نشد"
            : "Could not save",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!alarm) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      onSaved(await alarmService.remove(alarm.id));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const hairline = withOpacity(colors.foreground, 0.18);

  return (
    <Overlay visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Body style={{ backgroundColor: colors.background }}>
        <Header>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 17,
              fontFamily: getAppFontFamily(isRtl, "bold"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {alarm
              ? t("alarm.editTitle") || "Edit alarm"
              : t("alarm.newTitle") || "New alarm"}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={withOpacity(colors.foreground, 0.7)} />
          </TouchableOpacity>
        </Header>

        <ScrollView keyboardShouldPersistTaps="handled">
          <TimeRow>
            <TimeBox borderColor={hairline} onPress={() => setHour((h) => nextValue(h, "hour"))}>
              <TimeValue
                style={{
                  color: colors.foreground,
                  fontFamily: getAppFontFamily(isRtl, "bold"),
                }}
              >
                {pad2(hour)}
              </TimeValue>
            </TimeBox>
            <Colon style={{ color: withOpacity(colors.foreground, 0.5) }}>:</Colon>
            <TimeBox borderColor={hairline} onPress={() => setMinute((m) => nextValue(m, "minute"))}>
              <TimeValue
                style={{
                  color: colors.foreground,
                  fontFamily: getAppFontFamily(isRtl, "bold"),
                }}
              >
                {pad2(minute)}
              </TimeValue>
            </TimeBox>
          </TimeRow>

          <SectionLabel
            style={{
              color: withOpacity(colors.foreground, 0.55),
              fontFamily: getAppFontFamily(isRtl, "medium"),
            }}
          >
            {t("alarm.repeat") || "Repeat"}
          </SectionLabel>
          <DayGrid style={{ flexDirection: isRtl ? "row-reverse" : "row" }}>
            {DAY_CHIPS.map((day) => (
              <DayChip
                key={day.value}
                isActive={weekdays.includes(day.value)}
                activeColor={accent}
                borderColor={hairline}
                onPress={() => toggleDay(day.value)}
              >
                <Text
                  style={{
                    color: weekdays.includes(day.value)
                      ? accent
                      : withOpacity(colors.foreground, 0.75),
                    fontFamily: getAppFontFamily(isRtl, "medium"),
                    textAlign: "center",
                  }}
                >
                  {language === "fa" ? day.label : day.label}
                </Text>
              </DayChip>
            ))}
          </DayGrid>

          <SectionLabel
            style={{
              color: withOpacity(colors.foreground, 0.55),
              fontFamily: getAppFontFamily(isRtl, "medium"),
            }}
          >
            {t("alarm.source") || "Music"}
          </SectionLabel>
          <OptionRow>
            {(["mix", "liked"] as const).map((option) => (
              <OptionChip
                key={option}
                isActive={source === option}
                activeColor={accent}
                borderColor={hairline}
                onPress={() => setSource(option)}
              >
                <Text
                  style={{
                    color:
                      source === option ? accent : withOpacity(colors.foreground, 0.75),
                    fontFamily: getAppFontFamily(isRtl, "medium"),
                  }}
                >
                  {option === "mix"
                    ? t("alarm.sourceMix") || "Mix from history"
                    : t("alarm.sourceLiked") || "Liked songs"}
                </Text>
              </OptionChip>
            ))}
          </OptionRow>

          <SectionLabel
            style={{
              color: withOpacity(colors.foreground, 0.55),
              fontFamily: getAppFontFamily(isRtl, "medium"),
            }}
          >
            {t("alarm.fadeIn") || "Volume ramp"}
          </SectionLabel>
          <OptionRow>
            {FADE_CHOICES.map((minutes) => (
              <OptionChip
                key={minutes}
                isActive={fadeMinutes === minutes}
                activeColor={accent}
                borderColor={hairline}
                onPress={() => setFadeMinutes(minutes)}
              >
                <Text
                  style={{
                    color:
                      fadeMinutes === minutes ? accent : withOpacity(colors.foreground, 0.75),
                    fontFamily: getAppFontFamily(isRtl, "medium"),
                  }}
                >
                  {`${minutes} ${language === "fa" ? "دقیقه" : "min"}`}
                </Text>
              </OptionChip>
            ))}
          </OptionRow>

          {error ? (
            <ErrorText
              style={{ color: colors.accent, fontFamily: getAppFontFamily(isRtl, "medium") }}
            >
              {error}
            </ErrorText>
          ) : null}

          <Footer>
            {alarm ? (
              <TouchableOpacity onPress={remove} disabled={saving}>
                <ActionText
                  style={{
                    color: withOpacity(colors.foreground, 0.7),
                    fontFamily: getAppFontFamily(isRtl, "medium"),
                  }}
                >
                  {t("common.delete") || "Delete"}
                </ActionText>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <TouchableOpacity onPress={save} disabled={saving}>
              <ActionText
                style={{
                  color: accent,
                  fontFamily: getAppFontFamily(isRtl, "bold"),
                }}
              >
                {t("common.save") || "Save"}
              </ActionText>
            </TouchableOpacity>
          </Footer>
        </ScrollView>
      </Body>
    </Overlay>
  );
};

export default AlarmEditorSheet;
