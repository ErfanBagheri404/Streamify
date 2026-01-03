import React, { useEffect } from "react";
import { View, Image, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

interface LoadingScreenProps {
  onLoadingComplete: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  onLoadingComplete,
}) => {
  const fadeAnim = useSharedValue(1);

  useEffect(() => {
    // Simulate loading time (you can adjust this or make it dynamic based on actual loading)
    const timer = setTimeout(() => {
      // Start fade out animation
      fadeAnim.value = withTiming(0, { duration: 800 }, () => {
        // Call the completion callback when fade is done
        onLoadingComplete();
      });
    }, 1500); // Show loading screen for 1.5 seconds

    return () => clearTimeout(timer);
  }, [fadeAnim, onLoadingComplete]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: fadeAnim.value,
    };
  });

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <View style={styles.imageContainer}>
        <Image
          source={require("../assets/StreamifyLoading.png")}
          style={styles.loadingImage}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000000",
    zIndex: 9999,
    elevation: 9999,
  },
  imageContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingImage: {
    width: "80%",
    height: "80%",
    maxWidth: 300,
    maxHeight: 300,
  },
});
