import TrackPlayer, { Event } from "../utils/safeTrackPlayer";
import { trackPlayerService } from "./TrackPlayerService";

/**
 * Playback service for React Native Track Player
 * This service runs in the background and handles media session integration
 */

module.exports = async function () {
  // Remote control event handlers
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    if (trackPlayerService.onRemoteNext) {
      Promise.resolve(trackPlayerService.onRemoteNext()).catch((error) => {
        console.error("[PlaybackService] Remote next handler failed:", error);
      });
      return;
    }
    trackPlayerService.skipToNext().catch((error) => {
      console.error("[PlaybackService] Failed to skip to next:", error);
    });
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    if (trackPlayerService.onRemotePrevious) {
      Promise.resolve(trackPlayerService.onRemotePrevious()).catch((error) => {
        console.error(
          "[PlaybackService] Remote previous handler failed:",
          error,
        );
      });
      return;
    }
    trackPlayerService.skipToPrevious().catch((error) => {
      console.error("[PlaybackService] Failed to skip to previous:", error);
    });
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, (event) => {
    if (event.permanent === true) {
      TrackPlayer.stop();
    } else {
      if (event.paused === true) {
        TrackPlayer.pause();
      } else {
        TrackPlayer.play();
      }
    }
  });

  console.log("[PlaybackService] Service initialized successfully");
};
