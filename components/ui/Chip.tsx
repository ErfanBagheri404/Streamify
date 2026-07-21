import React, { type ReactNode } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
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
  icon?: ReactNode;
  iconGap?: number;
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
  icon,
  iconGap = 6,
  ...rest
}: ChipProps) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const resolvedTextStyle = resolveTextStyle(
    isRtl,
    textStyle,
    selected ? "semibold" : "medium",
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
      <View style={[styles.contentRow, { flexDirection: isRtl ? "row-reverse" : "row" }]}>
        {icon ? (
          <View style={[styles.iconWrapper, { marginEnd: isRtl ? 0 : iconGap, marginStart: isRtl ? iconGap : 0 }]}>
            {icon}
          </View>
        ) : null}
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
      </View>
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
  contentRow: {
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 13,
    lineHeight: 16,
  },
});
