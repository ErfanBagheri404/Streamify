import React, { forwardRef, useImperativeHandle, useRef, useCallback } from "react";
import Video, { DRMType } from "react-native-video";
import type { VideoRef } from "react-native-video";
import type { Track } from "../contexts/PlayerContext";

export interface DrmAudioPlayerRef {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  stop: () => void;
  isPlaying: boolean;
}

interface DrmAudioPlayerProps {
  track: Track | null;
  onPlaybackStarted?: () => void;
  onPlaybackError?: (error: any) => void;
  onPlaybackEnded?: () => void;
  onProgress?: (data: { currentTime: number; playableDuration: number }) => void;
}

const DrmAudioPlayer = forwardRef<DrmAudioPlayerRef, DrmAudioPlayerProps>(
  ({ track, onPlaybackStarted, onPlaybackError, onPlaybackEnded, onProgress }, ref) => {
    const videoRef = useRef<VideoRef>(null);
    const isPlayingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      play: () => {
        isPlayingRef.current = true;
        videoRef.current?.resume();
      },
      pause: () => {
        isPlayingRef.current = false;
        videoRef.current?.pause();
      },
      seek: (time: number) => {
        videoRef.current?.seek(time);
      },
      stop: () => {
        isPlayingRef.current = false;
        videoRef.current?.pause();
      },
      get isPlaying() {
        return isPlayingRef.current;
      },
    }));

    const onLoad = useCallback(() => {
      isPlayingRef.current = true;
      onPlaybackStarted?.();
    }, [onPlaybackStarted]);

    const onError = useCallback(
      (error: any) => {
        isPlayingRef.current = false;
        console.error(
          "[DrmAudioPlayer] Playback error raw:",
          JSON.stringify(error, Object.getOwnPropertyNames(error || {}))
        );
        onPlaybackError?.(error);
      },
      [onPlaybackError],
    );

    const onEnd = useCallback(() => {
      isPlayingRef.current = false;
      onPlaybackEnded?.();
    }, [onPlaybackEnded]);

    if (!track || !track.drmLicenseUrl || !track.drmScheme) {
      return null;
    }

    const drmHeaders: Record<string, string> = {
      ...(track.drmHeaders || {}),
      Origin: "https://streamify-player.vercel.app",
      Referer: "https://streamify-player.vercel.app/",
    };

    const source = {
      uri: track.audioUrl || "",
      type: "m3u8" as const,
      headers: {
        Origin: "https://streamify-player.vercel.app",
        Referer: "https://streamify-player.vercel.app/",
      },
      drm: {
        type: DRMType.WIDEVINE,
        licenseServer: track.drmLicenseUrl,
        headers: drmHeaders,
        multiDrm: false,
      } as any,
    };

    return (
      <Video
        ref={videoRef}
        source={source}
        paused={false}
        playInBackground
        playWhenInactive
        onLoad={onLoad}
        onError={onError}
        onEnd={onEnd}
        onProgress={onProgress}
        style={{ position: "absolute", width: 0, height: 0, opacity: 0 }}
      />
    );
  },
);

DrmAudioPlayer.displayName = "DrmAudioPlayer";
export default DrmAudioPlayer;
