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
  fallbackSource?: NativeImageSource | null;
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

  return uri || cache || headers ? `${uri}|${cache}|headers` : "static";
}

function isYouTubeHqUrl(uri: string): boolean {
  return uri.includes("hqdefault");
}

function upgradeToMaxres(uri: string): string {
  return uri.replace("hqdefault", "maxresdefault");
}

function downgradeToHqdefault(uri: string): string {
  return uri.replace("maxresdefault", "hqdefault");
}

export function ImageWithSkeleton({
  source,
  fallbackSource,
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
  /**
   * 0 = original source
   * 1 = upgraded to maxres (waiting for load or error)
   * 2 = downgraded back to hqdefault (maxres failed)
   */
  const [attempt, setAttempt] = React.useState(0);
  const hasImageSource = Boolean(source);
  const sourceKey = React.useMemo(() => getSourceKey(source), [source]);

  // Auto-upgrade: if the original URL is hqdefault, start with maxres immediately
  React.useEffect(() => {
    setHasLoaded(false);
    setHasError(false);
    const uri =
      source && typeof source === "object" && !Array.isArray(source)
        ? (source as { uri?: string }).uri
        : undefined;
    if (uri && isYouTubeHqUrl(uri)) {
      setAttempt(1);
    } else {
      setAttempt(0);
    }
  }, [sourceKey]);

  const shouldShowSkeleton =
    showSkeleton && hasImageSource && !hasLoaded && !hasError;

  const activeSource = React.useMemo(() => {
    if (fallbackSource && attempt === 2) return fallbackSource;

    const uri =
      source && typeof source === "object" && !Array.isArray(source)
        ? (source as { uri?: string }).uri
        : undefined;
    if (!uri) return source;

    if (attempt === 1 && isYouTubeHqUrl(uri)) {
      return { ...source, uri: upgradeToMaxres(uri) };
    }
    if (attempt === 2 && uri.includes("maxresdefault")) {
      return { ...source, uri: downgradeToHqdefault(uri) };
    }
    return source;
  }, [attempt, fallbackSource, source]);

  const handleLoad = React.useCallback(
    (event: any) => {
      setHasLoaded(true);
      onLoad?.(event);
    },
    [onLoad],
  );

  const handleLoadEnd = React.useCallback(
    (event: any) => {
      setHasLoaded(true);
      onLoadEnd?.(event);
    },
    [onLoadEnd],
  );

  const handleError = React.useCallback(
    (event: any) => {
      const uri =
        source && typeof source === "object" && !Array.isArray(source)
          ? (source as { uri?: string }).uri
          : undefined;

      if (attempt === 1) {
        // Maxres failed → fall back to hqdefault
        setAttempt(2);
        setHasLoaded(false);
      } else {
        // Everything failed
        setHasError(true);
        onError?.(event);
      }
    },
    [attempt, source, onError],
  );

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
          source={activeSource as NativeImageSource}
          resizeMode={imageProps.resizeMode ?? "cover"}
          style={[ABSOLUTE_FILL, style]}
          fadeDuration={0}
          onLoad={handleLoad}
          onLoadEnd={handleLoadEnd}
          onError={handleError}
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
});
