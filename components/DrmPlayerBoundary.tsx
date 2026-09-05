import React from "react";

interface DrmPlayerBoundaryProps {
  children: React.ReactNode;
  onError?: (error: unknown) => void;
}

interface DrmPlayerBoundaryState {
  hasError: boolean;
}

/**
 * Isolates the DRM SoundCloud player subtree. If DrmAudioPlayer (or the
 * react-native-video view inside it) throws during render/mount, this
 * boundary contains the crash so the whole app doesn't get torn down by
 * the root DebugStartupBoundary. The caught error is forwarded to
 * onError so PlayerContext can run its normal DRM-failure path
 * (handleDrmFailure -> JioSaavn fallback).
 */
export class DrmPlayerBoundary extends React.Component<
  DrmPlayerBoundaryProps,
  DrmPlayerBoundaryState
> {
  state: DrmPlayerBoundaryState = { hasError: false };

  static getDerivedStateFromError(): Partial<DrmPlayerBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(
      "[DrmPlayerBoundary] DRM player crashed, failing over:",
      error,
    );
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      // Render nothing — PlayerContext's watchdog/fallback takes over.
      return null;
    }
    return this.props.children;
  }
}
