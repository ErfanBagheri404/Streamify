/**
 * Music-video surface for issue #27 (YouTube-sourced only).
 *
 * PiP: react-native-video already implements picture-in-picture natively
 * (PictureInPictureUtil -> activity.enterPictureInPictureMode). The only JS
 * side of it is the enter-on-leave prop below; AndroidManifest support comes
 * from plugins/withVideoPip.js at prebuild time.
 *
 * Teardown contract: closing or unmounting this view pauses THIS view and
 * nothing else. The background audio session (TrackPlayer / expo-av) is never
 * touched from here, so the queue keeps running as audio when the video goes
 * away.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Video from "react-native-video";
import type { VideoRef } from "react-native-video";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { resolveMusicVideo, type MusicVideoSource } from "../modules/musicVideo";
import type { Track } from "../contexts/PlayerContext";

interface MusicVideoPlayerProps {
  track: Track;
  /** Queue-aware hand-off: the video ended, audio must continue. */
  onEnded: () => void;
  /** The user dismissed the video. Audio session stays alive. */
  onClose: () => void;
}

const MusicVideoPlayer = ({ track, onEnded, onClose }: MusicVideoPlayerProps) => {
  const videoRef = useRef<VideoRef>(null);
  const { t, isRtl } = useAppLanguage();
  const [video, setVideo] = useState<MusicVideoSource | null>(null);
  const [failed, setFailed] = useState(false);
  const settledRef = useRef(false);

  useEffect(() => {
    let alive = true;
    settledRef.current = false;
    setVideo(null);
    setFailed(false);
    resolveMusicVideo(track).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setVideo(result.video);
      } else {
        console.warn(`[MusicVideoPlayer] ${track.id}: ${result.ok ? "ok" : (result as { reason: string }).reason}`);
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, track.url]);

  // Teardown: pause this view only. No Audio.unloadAsync, no TrackPlayer —
  // the background audio session must outlive the video.
  useEffect(() => () => videoRef.current?.pause(), []);

  const handleEnd = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onEnded();
  }, [onEnded]);

  return (
    <View style={styles.root}>
      {video && !failed ? (
        <Video
          ref={videoRef}
          source={video.source}
          style={fill as any}
          resizeMode="contain"
          paused={false}
          controls
          // Enter-on-leave: Android PiP takes over when this screen is left.
          enterPictureInPictureOnLeave
          onEnd={handleEnd}
          onError={(error: any) => {
            console.warn(`[MusicVideoPlayer] playback error: ${error?.error?.errorString ?? error}`);
            setFailed(true);
          }}
          onFullscreenPlayerDidDismiss={onClose}
        />
      ) : (
        <View style={styles.state}>
          {failed ? (
            <>
              <Text style={styles.message}>{t("playerActions.videoUnavailable")}</Text>
              <TouchableOpacity onPress={onClose} accessibilityRole="button">
                <Text style={styles.action}>{t("common.close")}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator color="#ffffff" />
          )}
        </View>
      )}
      <TouchableOpacity
        onPress={onClose}
        accessibilityRole="button"
        style={[styles.close, isRtl ? { left: 16 } : { right: 16 }]}
      >
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
};

const fill = {
  position: "absolute" as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

const styles = StyleSheet.create({
  root: {
    ...fill,
    backgroundColor: "#000000",
    zIndex: 40,
  },
  state: {
    ...fill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  message: {
    color: "#ffffff",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 16,
  },
  action: {
    color: "#9ca3af",
    fontSize: 15,
    textDecorationLine: "underline",
  },
  close: {
    position: "absolute",
    top: 48,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    color: "#ffffff",
    fontSize: 20,
  },
});

export default MusicVideoPlayer;
