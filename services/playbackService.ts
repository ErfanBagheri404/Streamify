import TrackPlayer, { Event } from "react-native-track-player";

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
    TrackPlayer.skipToNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious();
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
