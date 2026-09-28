import * as React from "react";
import { usePlayer } from "../contexts/PlayerContext";
import { useAppSettings } from "../hooks/useAppSettings";
import { isLightAppTheme } from "../lib/app-settings";
import { publishArtworkTheme } from "../modules/artworkThemeBus";
import { deriveSeedFromArtwork } from "../modules/artworkThemeService";

/**
 * Samples the current track's artwork and publishes the resulting theme seed.
 *
 * Sits under `PlayerProvider` (it needs `usePlayer`) and above nothing that
 * cares, because `ThemeProvider` reads the result from the bus rather than
 * from here — see `modules/artworkThemeBus.ts` for why.
 */
export function ArtworkThemeBridge() {
  const { currentTrack } = usePlayer();
  const { settings } = useAppSettings();
  const isLight = isLightAppTheme(settings.theme);
  const enabled = settings.useArtworkTheme;

  const trackId = currentTrack?.id ?? null;
  const thumbnail = currentTrack?.thumbnail ?? null;
  React.useEffect(() => {
    if (!enabled) {
      publishArtworkTheme(null, null);
      return;
    }
    if (!trackId || !thumbnail) {
      publishArtworkTheme(trackId, null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const seed = await deriveSeedFromArtwork({ uri: thumbnail, isLightTheme: isLight });
      if (cancelled) {
        return;
      }
      publishArtworkTheme(trackId, seed);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, trackId, thumbnail, isLight]);

  return null;
}
