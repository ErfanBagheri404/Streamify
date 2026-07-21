import React from "react";
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SkeletonLoader } from "../SkeletonLoader";
import { useTheme } from "../../hooks/useTheme";

type NativeImageProps = React.ComponentProps<typeof Image>;
type NativeImageSource = NonNullable<NativeImageProps["source"]>;

const ABSOLUTE_FILL = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

interface ImageWithSkeletonProps extends Omit<NativeImageProps, "source"> {
  source?: NativeImageSource | null;
  containerStyle?: StyleProp<ViewStyle>;
  skeletonStyle?: StyleProp<ViewStyle>;
  fallback?: React.ReactNode;
  showSkeleton?: boolean;
}

function getSourceKey(source?: NativeImageSource | null): string {
  if (!source) {
    return "";
  }

  if (typeof source === "number") {
    return String(source);
  }

  if (Array.isArray(source)) {
    return source.map((item) => getSourceKey(item)).join("|");
  }

  const uri = typeof source.uri === "string" ? source.uri : "";
  const cache = typeof source.cache === "string" ? source.cache : "";
  const headers =
    source.headers && typeof source.headers === "object"
      ? JSON.stringify(source.headers)
      : "";

  return uri || cache || headers ? `${uri}|${cache}|${headers}` : "static";
}

export function ImageWithSkeleton({
  source,
  containerStyle,
  skeletonStyle,
  fallback,
  style,
  showSkeleton = true,
  onLoad,
  onLoadEnd,
  onError,
  ...imageProps
}: ImageWithSkeletonProps) {
  const { colors } = useTheme();
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);
  const hasImageSource = Boolean(source);
  const sourceKey = React.useMemo(() => getSourceKey(source), [source]);

  React.useEffect(() => {
    setHasLoaded(false);
    setHasError(false);
  }, [sourceKey]);

  const shouldShowSkeleton =
    showSkeleton && hasImageSource && !hasLoaded && !hasError;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface2 },
        containerStyle,
      ]}
    >
      {hasImageSource && !hasError ? (
        <Image
          {...imageProps}
          source={source as NativeImageSource}
          style={[
            ABSOLUTE_FILL,
            style,
            shouldShowSkeleton ? styles.hiddenImage : null,
          ]}
          fadeDuration={0}
          onLoad={(event) => {
            setHasLoaded(true);
            onLoad?.(event);
          }}
          onLoadEnd={(event) => {
            setHasLoaded(true);
            onLoadEnd?.(event);
          }}
          onError={(event) => {
            setHasError(true);
            onError?.(event);
          }}
        />
      ) : null}
      {shouldShowSkeleton ? (
        <SkeletonLoader style={[ABSOLUTE_FILL, skeletonStyle]} />
      ) : null}
      {(!hasImageSource || hasError) && fallback ? fallback : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  hiddenImage: {
    opacity: 0,
  },
});
