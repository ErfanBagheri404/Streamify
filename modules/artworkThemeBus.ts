import { DeviceEventEmitter } from "react-native";
import type { ArtworkThemeSeed } from "../modules/artworkTheme";

/**
 * Artwork-theme state bus.
 *
 * Provider-order problem: `ThemeProvider` wraps `PlayerProvider`, so the theme
 * cannot subscribe to the current track. Instead a bridge component sits under
 * the player, samples each new track's artwork, and publishes the resulting
 * seed here. This keeps the flow one-way (player -> bus -> theme) and native
 * imports out of `artworkTheme.ts`, which stays Node-testable.
 */

export const ARTWORK_THEME_EVENT = "streamify-artwork-theme-changed";

let latestSeed: ArtworkThemeSeed | null = null;
let latestTrackId: string | null = null;

export function publishArtworkTheme(
  trackId: string | null,
  seed: ArtworkThemeSeed | null,
): void {
  latestTrackId = trackId;
  latestSeed = seed;
  DeviceEventEmitter.emit(ARTWORK_THEME_EVENT);
}

export function readArtworkTheme(): {
  trackId: string | null;
  seed: ArtworkThemeSeed | null;
} {
  return { trackId: latestTrackId, seed: latestSeed };
}

export function subscribeToArtworkTheme(
  listener: () => void,
): { remove: () => void } {
  const subscription = DeviceEventEmitter.addListener(
    ARTWORK_THEME_EVENT,
    listener,
  );
  return {
    remove: () => {
      (subscription as unknown as { remove?: () => void } | undefined)?.remove?.();
    },
  };
}
