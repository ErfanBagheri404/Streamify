import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { resolveTextStyle } from "../../utils/fonts";

type TouchableProps = React.ComponentProps<typeof TouchableOpacity>;

interface AccentButtonProps extends TouchableProps {
  title: string;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

interface IconButtonProps extends TouchableProps {
  icon: React.ReactNode;
  size?: number;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AccentButton({
  title,
  fullWidth = false,
  style,
  ...rest
}: AccentButtonProps) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const textStyle = resolveTextStyle(isRtl, undefined, "semibold");

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      {...rest}
      style={[
        styles.accentButton,
        {
          backgroundColor: colors.accent,
          width: fullWidth ? "100%" : undefined,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.accentButtonText,
          {
            color: colors.accentContrast,
          },
          textStyle,
        ]}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

export function IconButton({
  icon,
  size = 42,
  filled = false,
  style,
  ...rest
}: IconButtonProps) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      {...rest}
      style={[
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: filled
            ? colors.accent
            : withOpacity(colors.surface2, 0.8),
          borderColor: filled ? colors.accent : colors.borderSubtle,
        },
        style,
      ]}
    >
      <View>{icon}</View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  accentButton: {
    minHeight: 46,
    borderRadius: 999,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  accentButtonText: {
    fontSize: 15,
    lineHeight: 18,
  },
  iconButton: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
