import React from "react";
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme, withOpacity } from "../../hooks/useTheme";

type NativeViewProps = React.ComponentProps<typeof View>;

interface SurfaceProps extends NativeViewProps {
  children: React.ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

function createSurfaceStyle(
  backgroundColor: string,
  borderColor: string,
  padded: boolean,
  style?: StyleProp<ViewStyle>,
) {
  return [
    styles.base,
    { backgroundColor, borderColor },
    padded ? styles.padded : null,
    style,
  ];
}

export function Surface({
  children,
  padded = true,
  style,
  ...rest
}: SurfaceProps) {
  const { colors } = useTheme();

  return (
    <View
      {...rest}
      style={createSurfaceStyle(
        colors.surface1,
        colors.borderSubtle,
        padded,
        style,
      )}
    >
      {children}
    </View>
  );
}

export function SurfaceSoft({
  children,
  padded = true,
  style,
  ...rest
}: SurfaceProps) {
  const { colors } = useTheme();

  return (
    <View
      {...rest}
      style={createSurfaceStyle(
        withOpacity(colors.surface2, 0.72),
        withOpacity(colors.borderSubtle, 0.72),
        padded,
        style,
      )}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 20,
    borderWidth: 1,
  },
  padded: {
    padding: 16,
  },
});
