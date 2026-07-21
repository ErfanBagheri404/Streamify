import React, { useEffect, useRef } from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import styled from "styled-components/native";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";

const { Animated } = require("react-native");

const AnimatedView = Animated.View;

interface SkeletonProps {
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export const SkeletonLoader: React.FC<SkeletonProps> = ({
  width,
  height,
  style,
}) => {
  const opacityAnim = useRef(new Animated.Value(0.2)).current;
  const { colors } = useTheme();
  const flattenedStyle: Record<string, any> =
    (StyleSheet as any).flatten(style) || {};
  const fillsParent =
    flattenedStyle.position === "absolute" &&
    flattenedStyle.top !== undefined &&
    flattenedStyle.right !== undefined &&
    flattenedStyle.bottom !== undefined &&
    flattenedStyle.left !== undefined;
  const resolvedWidth =
    width ?? flattenedStyle.width ?? (fillsParent ? undefined : 100);
  const resolvedHeight =
    height ?? flattenedStyle.height ?? (fillsParent ? undefined : 20);

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
          width: resolvedWidth,
          height: resolvedHeight,
          opacity: opacityAnim,
          backgroundColor: withOpacity(colors.foreground, 0.12),
          borderRadius: flattenedStyle.borderRadius ?? 12,
        },
        style,
      ]}
    />
  );
};

const PlaylistCardSkeletonContainer = styled.View`
  width: 168px;
  margin-right: 16px;
`;

const SkeletonTitle = styled(SkeletonLoader).attrs({
  width: 126,
  height: 18,
})`
  margin-bottom: 8px;
  margin-top: 12px;
  border-radius: 8px;
`;

const SkeletonMeta = styled(SkeletonLoader).attrs({
  width: 92,
  height: 16,
})`
  border-radius: 7px;
`;

export const PlaylistCardSkeleton: React.FC = () => {
  const { isRtl } = useAppLanguage();

  return (
    <PlaylistCardSkeletonContainer
      style={{
        width: 168,
        marginRight: isRtl ? 0 : 16,
        marginLeft: isRtl ? 16 : 0,
      }}
    >
      <SkeletonLoader width={168} height={168} style={{ borderRadius: 22 }} />
      <SkeletonTitle style={{ alignSelf: isRtl ? "flex-end" : "flex-start" }} />
      <SkeletonMeta style={{ alignSelf: isRtl ? "flex-end" : "flex-start" }} />
    </PlaylistCardSkeletonContainer>
  );
};

const SkeletonRowContainer = styled.View`
  flex-direction: row;
`;

export const PlaylistSkeletonRow: React.FC<{ count?: number }> = ({
  count = 6,
}) => {
  const { isRtl } = useAppLanguage();

  return (
    <SkeletonRowContainer
      style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
    >
      {Array.from({ length: count }, (_, i) => (
        <PlaylistCardSkeleton key={i} />
      ))}
    </SkeletonRowContainer>
  );
};

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
}> = ({ columns = 3, rows = 4 }) => {
  const { isRtl } = useAppLanguage();

  return (
    <RecommendationSkeletonContainer>
      <SkeletonRowContainer
        style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
      >
        {Array.from({ length: columns }, (_, columnIndex) => (
          <RecommendationSkeletonColumn
            key={`rec-skel-col-${columnIndex}`}
            style={{
              marginRight: isRtl ? 0 : 16,
              marginLeft: isRtl ? 16 : 0,
            }}
          >
            {Array.from({ length: rows }, (_, rowIndex) => (
              <RecommendationSkeletonItem
                key={`rec-skel-${columnIndex}-${rowIndex}`}
                style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
              >
                <RecommendationSkeletonThumb />
                <RecommendationSkeletonText
                  style={{
                    marginLeft: isRtl ? 0 : 10,
                    marginRight: isRtl ? 10 : 0,
                    alignItems: isRtl ? "flex-end" : "flex-start",
                  }}
                >
                  <RecommendationSkeletonTitle
                    style={{ alignSelf: isRtl ? "flex-end" : "flex-start" }}
                  />
                  <RecommendationSkeletonMeta
                    style={{ alignSelf: isRtl ? "flex-end" : "flex-start" }}
                  />
                </RecommendationSkeletonText>
              </RecommendationSkeletonItem>
            ))}
          </RecommendationSkeletonColumn>
        ))}
      </SkeletonRowContainer>
    </RecommendationSkeletonContainer>
  );
};
