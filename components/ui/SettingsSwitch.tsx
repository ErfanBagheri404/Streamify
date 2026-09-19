import React, { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../hooks/useTheme";

interface SettingsSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
}

/** Controlled, motion-free switch with a full-size touch target. */
export function SettingsSwitch({
  value,
  onValueChange,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
}: SettingsSwitchProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      activeOpacity={1}
      style={[
        styles.target,
        {
          borderColor: focused ? colors.foreground : "transparent",
          backgroundColor: pressed ? colors.surface2 : "transparent",
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <View
        accessible={false}
        pointerEvents="none"
        style={[
          styles.track,
          {
            backgroundColor: value ? colors.accent : colors.background,
            borderColor: value ? colors.accent : colors.muted,
            alignItems: value ? "flex-end" : "flex-start",
          },
        ]}
      >
        <View
          style={[
            styles.thumb,
            {
              backgroundColor: value
                ? colors.accentContrast
                : colors.foreground,
            },
          ]}
        >
          {value ? (
            <Ionicons
              accessible={false}
              name="checkmark"
              size={12}
              color={colors.accent}
            />
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  target: {
    width: 56,
    height: 44,
    flexShrink: 0,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    padding: 3,
    justifyContent: "center",
  },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
});
