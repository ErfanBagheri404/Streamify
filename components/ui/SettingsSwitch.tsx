import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../hooks/useTheme";

interface SettingsSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const THUMB_SIZE = 18;
const PADDING = 3;
const THUMB_MAX_X = TRACK_WIDTH - THUMB_SIZE - PADDING * 2;

/** Animated switch: thumb slides with spring, colors snap instantly. */
export function SettingsSwitch({
  value,
  onValueChange,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
}: SettingsSwitchProps) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: value ? 1 : 0,
      damping: 16,
      stiffness: 190,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [value, progress]);

  const thumbTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, THUMB_MAX_X],
  });

  // Colors snap instantly — no RGB interpolation, so no red/purple flash
  // while the thumb is mid-animation.
  const trackBg = value ? colors.foreground : colors.surface1;
  const trackBorder = value ? colors.foreground : colors.muted;
  const thumbBg = value ? colors.background : colors.foreground;

  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      activeOpacity={1}
      style={[styles.target, { opacity: disabled ? 0.45 : 1 }]}
    >
      <View
        accessible={false}
        pointerEvents="none"
        style={[
          styles.track,
          {
            backgroundColor: trackBg,
            borderColor: trackBorder,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: thumbBg,
              transform: [{ translateX: thumbTranslateX }],
            },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  target: {
    width: 56,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    padding: PADDING,
    justifyContent: "center",
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
