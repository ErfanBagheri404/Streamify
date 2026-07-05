import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme } from "../../hooks/useTheme";
import { resolveTextStyle } from "../../utils/fonts";

type NativeTextProps = React.ComponentProps<typeof Text>;

interface ThemedTextProps extends NativeTextProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

function stripResolvedTextProps(style: StyleProp<TextStyle>): TextStyle {
  const flattened = ((StyleSheet as any).flatten(style) ?? {}) as Record<
    string,
    unknown
  >;
  const {
    fontFamily: _fontFamily,
    fontWeight: _fontWeight,
    textAlign: _textAlign,
    writingDirection: _writingDirection,
    includeFontPadding: _includeFontPadding,
    ...rest
  } = flattened;

  return rest;
}

export function BodyText({ children, style, ...rest }: ThemedTextProps) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const textStyle = resolveTextStyle(isRtl, style, "regular");
  const presentationStyle = stripResolvedTextProps(style);

  return (
    <Text
      {...rest}
      style={[
        styles.body,
        {
          color: colors.foreground,
        },
        textStyle,
        presentationStyle,
      ]}
    >
      {children}
    </Text>
  );
}

export function MutedText({ children, style, ...rest }: ThemedTextProps) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const textStyle = resolveTextStyle(isRtl, style, "regular");
  const presentationStyle = stripResolvedTextProps(style);

  return (
    <Text
      {...rest}
      style={[
        styles.body,
        {
          color: colors.muted,
        },
        textStyle,
        presentationStyle,
      ]}
    >
      {children}
    </Text>
  );
}

export function TitleText({ children, style, ...rest }: ThemedTextProps) {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const textStyle = resolveTextStyle(isRtl, style, "semibold");
  const presentationStyle = stripResolvedTextProps(style);

  return (
    <Text
      {...rest}
      style={[
        styles.title,
        {
          color: colors.foreground,
        },
        textStyle,
        presentationStyle,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    fontSize: 20,
    lineHeight: 24,
  },
});
