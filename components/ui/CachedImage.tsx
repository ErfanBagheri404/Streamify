import React, { useEffect, useState } from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";
type ImageProps = React.ComponentProps<typeof Image>;
import { getCachedThumbnailPath, isThumbnailCached } from "../../utils/thumbnailCache";

interface CachedImageProps extends ImageProps {
  trackId?: string | null;
}

/**
 * Drop-in replacement for Image that checks the thumbnail disk cache first.
 * If a cached thumbnail exists on disk, it uses that file:// path.
 * Otherwise falls back to the original URI (online loading).
 */
export function CachedImage({ trackId, source, ...rest }: CachedImageProps) {
  const [resolvedSource, setResolvedSource] = useState(source);

  useEffect(() => {
    if (!trackId || !source || typeof source !== "object" || !("uri" in source) || !source.uri) {
      setResolvedSource(source);
      return;
    }

    let cancelled = false;
    isThumbnailCached(trackId).then((cached) => {
      if (!cancelled && cached) {
        const path = getCachedThumbnailPath(trackId);
        setResolvedSource({ ...source, uri: path! });
      }
    });

    return () => { cancelled = true; };
  }, [trackId, source]);

  return <Image source={resolvedSource} {...rest} />;
}
