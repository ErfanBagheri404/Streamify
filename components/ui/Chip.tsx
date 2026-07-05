import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme } from "../../hooks/useTheme";
import { resolveTextStyle } from "../../utils/fonts";

type TouchableProps = React.ComponentProps<typeof TouchableOpacity>;

interface ChipProps extends TouchableProps {
  label: string;
  selected?: boolean;
  textStyle?: StyleProp<TextStyle>;
  chipStyle?: StyleProp<ViewStyle>;
  selectedBackgroundColor?: string;
  selectedBorderColor?: string;
  selectedTextColor?: string;
  unselectedTextColor?: string;
  style?: StyleProp<ViewStyle>;
}

export function Chip({
  label,
  selected = false,
  style,
  textStyle,
  chipStyle,
  selectedBackgroundColor,
  selectedBorderColor,
  selectedTextColor,
  unselectedTextColor,
  ...rest
}: ChipProps) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const resolvedTextStyle = resolveTextStyle(
    isRtl,
    textStyle,
    selected ? "semibold" : "medium"
  );

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      {...rest}
      style={[
        styles.chip,
        {
          backgroundColor: selected
            ? selectedBackgroundColor || colors.accent
            : colors.surface2,
          borderColor: selected
            ? selectedBorderColor || selectedBackgroundColor || colors.accent
            : colors.borderSubtle,
        },
        chipStyle,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: selected
              ? selectedTextColor || colors.accentContrast
              : unselectedTextColor || colors.foreground,
            textAlign: "center",
          },
          resolvedTextStyle,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 13,
    lineHeight: 16,
  },
});
