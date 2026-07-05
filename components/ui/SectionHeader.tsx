import React from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme } from "../../hooks/useTheme";
import { MutedText, TitleText } from "./Text";

type NativeViewProps = React.ComponentProps<typeof View>;

interface SectionHeaderProps extends NativeViewProps {
  title: string;
  subtitle?: string;
  subtitleNumberOfLines?: number;
  actionLabel?: string;
  onPressAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  subtitle,
  subtitleNumberOfLines = 2,
  actionLabel,
  onPressAction,
  style,
  ...rest
}: SectionHeaderProps) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();

  return (
    <View
      {...rest}
      style={[
        styles.container,
        { flexDirection: isRtl ? "row-reverse" : "row" },
        style,
      ]}
    >
      <View style={[styles.textBlock, { alignItems: isRtl ? "flex-end" : "flex-start" }]}>
        <TitleText numberOfLines={1} style={styles.title}>
          {title}
        </TitleText>
        {subtitle ? (
          <MutedText numberOfLines={subtitleNumberOfLines} style={styles.subtitle}>
            {subtitle}
          </MutedText>
        ) : null}
      </View>
      {actionLabel && onPressAction ? (
        <TouchableOpacity onPress={onPressAction} hitSlop={8}>
          <MutedText
            style={[
              styles.actionText,
              {
                color: colors.accent,
                fontFamily: isRtl ? "YekanBakhRegular" : "GoogleSansMedium",
              },
            ]}
          >
            {actionLabel}
          </MutedText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 22,
  },
  subtitle: {
    marginTop: 4,
  },
  actionText: {
  },
});
