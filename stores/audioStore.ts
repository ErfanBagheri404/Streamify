import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AudioState {
  // Playback state
  progress: number;
  duration: number;
  isPlaying: boolean;
  isModalOpen: boolean;
  currentTrack: any | null;

  // Actions
  setProgress: (progress: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsModalOpen: (isModalOpen: boolean) => void;
  setCurrentTrack: (track: any | null) => void;

  // Playback controls
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seekTo: (position: number) => void;
  reset: () => void;
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set, get) => ({
      // Initial state
      progress: 0,
      duration: 0,
      isPlaying: false,
      isModalOpen: false,
      currentTrack: null,

      // Actions
      setProgress: (progress) => set({ progress: Math.max(0, progress) }),
      setDuration: (duration) => set({ duration: Math.max(0, duration) }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setIsModalOpen: (isModalOpen) => set({ isModalOpen }),
      setCurrentTrack: (currentTrack) => set({ currentTrack }),

      // Playback controls
      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      togglePlay: () => {
        const { isPlaying } = get();
        set({ isPlaying: !isPlaying });
      },
      seekTo: (position) => {
        const { duration } = get();
        const clampedPosition = Math.max(0, Math.min(position, duration));
        set({ progress: clampedPosition });
      },
      reset: () =>
        set({
          progress: 0,
          duration: 0,
          isPlaying: false,
          currentTrack: null,
        }),
    }),
    {
      name: 'audio-store',
      partialize: (state) => ({
        // Only persist modal open state, not playback state
        isModalOpen: state.isModalOpen,
      }),
    },
  ),
);
