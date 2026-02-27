import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import TrackPlayer, { Event, State } from 'react-native-track-player';
import { useAudioStore } from '../stores/audioStore';

export const useAudioService = () => {
  const progressUpdateInterval = useRef<NodeJS.Timeout | null>(null);
  const lastPosition = useRef<number>(0);
  const positionStuckCounter = useRef<number>(0);

  // Subscribe to store
  const { setProgress, setDuration, setIsPlaying, setCurrentTrack, reset } =
    useAudioStore();

  // Cleanup function
  const cleanup = () => {
    if (progressUpdateInterval.current) {
      clearInterval(progressUpdateInterval.current);
      progressUpdateInterval.current = null;
    }
  };

  // Progress update function
  const updateProgress = async () => {
    try {
      const [position, duration] = await Promise.all([
        TrackPlayer.getPosition(),
        TrackPlayer.getDuration(),
      ]);

      // Update duration if changed
      if (duration > 0 && duration !== useAudioStore.getState().duration) {
        setDuration(duration);
      }

      // Update progress
      if (position >= 0) {
        setProgress(position);

        // Check for position stuck (indicates audio cutout)
        if (Math.abs(position - lastPosition.current) < 0.1) {
          positionStuckCounter.current++;
          if (positionStuckCounter.current > 10) {
            // 2.5 seconds stuck
            console.warn(
              '[AudioService] Position appears stuck, possible audio cutout',
            );
          }
        } else {
          positionStuckCounter.current = 0;
        }
        lastPosition.current = position;
      }
    } catch (error) {
      console.error('[AudioService] Error updating progress:', error);
    }
  };

  // Setup progress tracking
  const setupProgressTracking = async () => {
    cleanup();

    const state = await TrackPlayer.getState();
    if (state === State.Playing) {
      // Start progress updates every 250ms
      progressUpdateInterval.current = setInterval(updateProgress, 250);

      // Initial sync
      await updateProgress();
    }
  };

  useEffect(() => {
    console.log('[AudioService] Setting up audio service...');

    // Listen for playback state changes
    const playbackStateListener = TrackPlayer.addEventListener(
      Event.PlaybackState,
      async (event) => {
        console.log('[AudioService] Playback state changed:', event.state);

        if (event.state === State.Playing) {
          setIsPlaying(true);
          setupProgressTracking();
        } else if (
          event.state === State.Paused ||
          event.state === State.Stopped
        ) {
          setIsPlaying(false);
          cleanup();

          // Get final position when paused/stopped
          try {
            const position = await TrackPlayer.getPosition();
            if (position >= 0) {
              setProgress(position);
            }
          } catch (error) {
            console.error(
              '[AudioService] Error getting final position:',
              error,
            );
          }
        } else if (event.state === State.Ended) {
          setIsPlaying(false);
          cleanup();
          reset(); // Reset progress and duration
        }
      },
    );

    // Listen for track changes
    const trackChangedListener = TrackPlayer.addEventListener(
      Event.PlaybackTrackChanged,
      async (event) => {
        console.log('[AudioService] Track changed:', event);

        if (event.nextTrack !== undefined) {
          try {
            const track = await TrackPlayer.getTrack(event.nextTrack);
            if (track) {
              setCurrentTrack(track);
              // Reset progress for new track
              setProgress(0);
            }
          } catch (error) {
            console.error('[AudioService] Error getting new track:', error);
          }
        }
      },
    );

    // Listen for progress updates from track player (if available)
    const progressUpdateListener = TrackPlayer.addEventListener(
      Event.PlaybackProgressUpdated,
      (event) => {
        if (event.position !== undefined && event.duration !== undefined) {
          setProgress(event.position);
          setDuration(event.duration);
        }
      },
    );

    // Handle app state changes
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        // App became active, resume progress tracking
        TrackPlayer.getState().then((state) => {
          if (state === State.Playing) {
            setupProgressTracking();
          }
        });
      } else if (nextAppState === 'background') {
        // App went to background, cleanup but keep state
        cleanup();
      }
    };

    const appStateSubscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    // Initial setup
    const initializeAudioService = async () => {
      try {
        const currentTrackIndex = await TrackPlayer.getCurrentTrack();
        if (currentTrackIndex !== null) {
          const track = await TrackPlayer.getTrack(currentTrackIndex);
          if (track) {
            setCurrentTrack(track);
          }
        }

        const state = await TrackPlayer.getState();
        if (state === State.Playing) {
          setIsPlaying(true);
          setupProgressTracking();
        }
      } catch (error) {
        console.error(
          '[AudioService] Error initializing audio service:',
          error,
        );
      }
    };

    initializeAudioService();

    return () => {
      console.log('[AudioService] Cleaning up audio service...');
      cleanup();
      playbackStateListener.remove();
      trackChangedListener.remove();
      progressUpdateListener.remove();
      appStateSubscription.remove();
    };
  }, []);

  return null; // This is a service hook, doesn't render anything
};
