import React from "react";
import { useIsFocused } from "@react-navigation/native";
import {
  Animated,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useAppSettings } from "../../hooks/useAppSettings";
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
  const { settings } = useAppSettings();
  const isFocused = useIsFocused();
  const {
    children,
    padded = true,
    safeEdges = ["top", "left", "right"],
  } = props;
  const entranceOpacity = React.useRef(
    new Animated.Value(settings.disableAnimations ? 1 : 0),
  ).current;
  const entranceTranslateY = React.useRef(
    new Animated.Value(settings.disableAnimations ? 0 : 10),
  ).current;

  React.useEffect(() => {
    if (settings.disableAnimations) {
      entranceOpacity.setValue(1);
      entranceTranslateY.setValue(0);
      return;
    }

    if (!isFocused) {
      (entranceOpacity as unknown as { stopAnimation(): void }).stopAnimation();
      (
        entranceTranslateY as unknown as { stopAnimation(): void }
      ).stopAnimation();
      entranceOpacity.setValue(0);
      entranceTranslateY.setValue(10);
      return;
    }

    entranceOpacity.setValue(0);
    entranceTranslateY.setValue(10);
    const animation = Animated.parallel([
      Animated.timing(entranceOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(entranceTranslateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => {
      animation.stop();
    };
  }, [
    entranceOpacity,
    entranceTranslateY,
    isFocused,
    settings.disableAnimations,
  ]);

  const animatedContentStyle = {
    opacity: entranceOpacity,
    transform: [{ translateY: entranceTranslateY }],
  };

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
            <Animated.View style={animatedContentStyle}>
              {children}
            </Animated.View>
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
          <Animated.View style={[styles.animatedContent, animatedContentStyle]}>
            {children}
          </Animated.View>
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
  animatedContent: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: 16,
  },
});
