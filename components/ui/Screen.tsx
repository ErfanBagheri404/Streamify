import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme } from "../../hooks/useTheme";

interface ScreenBaseProps {
  children: React.ReactNode;
  padded?: boolean;
  safeEdges?: Edge[];
  style?: StyleProp<ViewStyle>;
}

type NativeViewProps = React.ComponentProps<typeof View>;
type NativeScrollViewProps = React.ComponentProps<typeof ScrollView>;
const SafeAreaContainer = SafeAreaView as React.ComponentType<any>;

interface StaticScreenProps extends ScreenBaseProps, NativeViewProps {
  scroll?: false;
}

interface ScrollScreenProps extends ScreenBaseProps, NativeScrollViewProps {
  scroll: true;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

type ScreenProps = StaticScreenProps | ScrollScreenProps;

export function Screen(props: ScreenProps) {
  const { colors } = useTheme();
  const { dir } = useAppLanguage();
  const {
    children,
    padded = true,
    safeEdges = ["top", "left", "right"],
  } = props;

  const baseScreenStyle = [
    styles.screen,
    { backgroundColor: colors.background, direction: dir },
    padded ? styles.padded : null,
    props.style,
  ];

  if (props.scroll) {
    const { scroll, contentContainerStyle, style, ...scrollProps } =
      props as ScrollScreenProps;

    return (
      <SafeAreaContainer
        edges={safeEdges}
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.safeArea,
            { backgroundColor: colors.background, direction: dir },
          ]}
        >
          <ScrollView
            {...scrollProps}
            style={[
              styles.screen,
              { backgroundColor: colors.background, direction: dir },
              style,
            ]}
            contentContainerStyle={[
              padded ? styles.padded : null,
              { direction: dir },
              contentContainerStyle,
            ]}
          >
            {children}
          </ScrollView>
        </View>
      </SafeAreaContainer>
    );
  }

  const { scroll, style, ...viewProps } = props as StaticScreenProps;

  return (
    <SafeAreaContainer
      edges={safeEdges}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.safeArea,
          { backgroundColor: colors.background, direction: dir },
        ]}
      >
        <View {...viewProps} style={baseScreenStyle}>
          {children}
        </View>
      </View>
    </SafeAreaContainer>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: 16,
  },
});
