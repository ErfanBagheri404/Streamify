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
      ])
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
  margin-top: 0px;
`;

export const CategoryPlaylistContainer = styled.View`
  padding: 0 16px;
`;

export const CategoryPlaylistSkeleton: React.FC = () => (
  <CategorySkeletonContainer>
    <CategoryPlaylistContainer>
      <PlaylistSkeletonRow count={6} />
    </CategoryPlaylistContainer>
  </CategorySkeletonContainer>
);

const PreviouslyPlayedSkeletonContainer = styled.View`
  padding: 0 16px;
  margin-top: 16px;
`;

export const PreviouslyPlayedSkeleton: React.FC = () => (
  <PreviouslyPlayedSkeletonContainer>
    <PlaylistSkeletonRow count={5} />
  </PreviouslyPlayedSkeletonContainer>
);

// YouTube Mix skeleton
const YouTubeMixSkeletonContainer = styled.View`
  padding: 0 16px;
  margin-top: 16px;
`;

export const YouTubeMixSkeleton: React.FC = () => (
  <YouTubeMixSkeletonContainer>
    <PlaylistSkeletonRow count={5} />
  </YouTubeMixSkeletonContainer>
);

// JioSaavn suggestions skeleton
const JioSaavnSuggestionsSkeletonContainer = styled.View`
  padding: 0 16px;
  margin-top: 16px;
`;

export const JioSaavnSuggestionsSkeleton: React.FC = () => (
  <JioSaavnSuggestionsSkeletonContainer>
    <PlaylistSkeletonRow count={5} />
  </JioSaavnSuggestionsSkeletonContainer>
);

const RecommendationSkeletonContainer = styled.View`
  padding: 0 16px;
  margin-top: 16px;
`;

const RecommendationSkeletonColumn = styled.View`
  width: 240px;
  margin-right: 16px;
`;

const RecommendationSkeletonItem = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: 12px;
`;

const RecommendationSkeletonThumb = styled(SkeletonLoader).attrs({
  width: 54,
  height: 54,
})`
  border-radius: 8px;
`;

const RecommendationSkeletonText = styled.View`
  flex: 1;
  margin-left: 10px;
`;

const RecommendationSkeletonTitle = styled(SkeletonLoader).attrs({
  width: 140,
  height: 12,
})`
  border-radius: 6px;
  margin-bottom: 6px;
`;

const RecommendationSkeletonMeta = styled(SkeletonLoader).attrs({
  width: 100,
  height: 10,
})`
  border-radius: 5px;
`;

export const RecommendationsSkeleton: React.FC<{
  columns?: number;
  rows?: number;
}> = ({ columns = 3, rows = 4 }) => (
  <RecommendationSkeletonContainer>
    <SkeletonRowContainer>
      {Array.from({ length: columns }, (_, columnIndex) => (
        <RecommendationSkeletonColumn key={`rec-skel-col-${columnIndex}`}>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <RecommendationSkeletonItem
              key={`rec-skel-${columnIndex}-${rowIndex}`}
            >
              <RecommendationSkeletonThumb />
              <RecommendationSkeletonText>
                <RecommendationSkeletonTitle />
                <RecommendationSkeletonMeta />
              </RecommendationSkeletonText>
            </RecommendationSkeletonItem>
          ))}
        </RecommendationSkeletonColumn>
      ))}
    </SkeletonRowContainer>
  </RecommendationSkeletonContainer>
);
