import React, { useEffect, useRef } from "react";
import { ViewStyle } from "react-native";
import styled from "styled-components/native";

const { Animated } = require("react-native");

const AnimatedView = Animated.View;

interface SkeletonProps {
  width?: number;
  height?: number;
  style?: ViewStyle;
}

export const SkeletonLoader: React.FC<SkeletonProps> = ({
  width = 100,
  height = 20,
  style,
}) => {
  const opacityAnim = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 0.6,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.2,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [opacityAnim]);

  return (
    <AnimatedView
      style={[
        {
          width,
          height,
          opacity: opacityAnim,
          backgroundColor: "#f0f0f0",
          borderRadius: 12,
        },
        style,
      ]}
    />
  );
};

const PlaylistCardSkeletonContainer = styled.View`
  width: 160px;
  margin-right: 20px;
`;

const SkeletonTitle = styled(SkeletonLoader).attrs({
  width: 120,
  height: 16,
})`
  margin-bottom: 8px;
  margin-top: 12px;
  border-radius: 8px;
`;

const SkeletonMeta = styled(SkeletonLoader).attrs({
  width: 80,
  height: 12,
})`
  border-radius: 6px;
`;

export const PlaylistCardSkeleton: React.FC = () => (
  <PlaylistCardSkeletonContainer>
    <SkeletonLoader width={160} height={160} />
    <SkeletonTitle />
    <SkeletonMeta />
  </PlaylistCardSkeletonContainer>
);

const SkeletonRowContainer = styled.View`
  flex-direction: row;
`;

export const PlaylistSkeletonRow: React.FC<{ count?: number }> = ({
  count = 6,
}) => (
  <SkeletonRowContainer>
    {Array.from({ length: count }, (_, i) => (
      <PlaylistCardSkeleton key={i} />
    ))}
  </SkeletonRowContainer>
);

const FeaturedSkeletonContainer = styled.View`
  padding: 0 16px;
`;

export const FeaturedPlaylistSkeleton: React.FC = () => (
  <FeaturedSkeletonContainer>
    <PlaylistSkeletonRow count={5} />
  </FeaturedSkeletonContainer>
);

const CategorySkeletonContainer = styled.View`
  margin-top: 24px;
`;

const CategoryTitle = styled(SkeletonLoader).attrs({
  width: 120,
  height: 18,
})`
  margin-left: 16px;
  margin-bottom: 16px;
  border-radius: 9px;
`;

export const CategoryPlaylistSkeleton: React.FC = () => (
  <CategorySkeletonContainer>
    <CategoryTitle />
    <FeaturedSkeletonContainer>
      <PlaylistSkeletonRow count={6} />
    </FeaturedSkeletonContainer>
  </CategorySkeletonContainer>
);
