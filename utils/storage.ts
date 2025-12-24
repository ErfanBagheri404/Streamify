import AsyncStorage from "@react-native-async-storage/async-storage";
import { Track } from "../contexts/PlayerContext";

const LIKED_SONGS_KEY = "@liked_songs";
const PREVIOUSLY_PLAYED_KEY = "@previously_played_songs";

export const StorageService = {
  // Save liked songs to storage
  async saveLikedSongs(songs: Track[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(songs);
      await AsyncStorage.setItem(LIKED_SONGS_KEY, jsonValue);
    } catch (error) {
      console.error("Error saving liked songs:", error);
      throw error;
    }
  },

  // Load liked songs from storage
  async loadLikedSongs(): Promise<Track[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(LIKED_SONGS_KEY);
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (error) {
      console.error("Error loading liked songs:", error);
      return [];
    }
  },

  // Clear liked songs
  async clearLikedSongs(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LIKED_SONGS_KEY);
    } catch (error) {
      console.error("Error clearing liked songs:", error);
      throw error;
    }
  },

  // Add a single liked song
  async addLikedSong(song: Track): Promise<void> {
    try {
      const likedSongs = await this.loadLikedSongs();
      const updatedSongs = [...likedSongs, song];
      await this.saveLikedSongs(updatedSongs);
    } catch (error) {
      console.error("Error adding liked song:", error);
      throw error;
    }
  },

  // Remove a liked song
  async removeLikedSong(songId: string): Promise<void> {
    try {
      const likedSongs = await this.loadLikedSongs();
      const updatedSongs = likedSongs.filter((song) => song.id !== songId);
      await this.saveLikedSongs(updatedSongs);
    } catch (error) {
      console.error("Error removing liked song:", error);
      throw error;
    }
  },

  // Save previously played songs to storage
  async savePreviouslyPlayedSongs(songs: Track[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(songs);
      await AsyncStorage.setItem(PREVIOUSLY_PLAYED_KEY, jsonValue);
    } catch (error) {
      console.error("Error saving previously played songs:", error);
      throw error;
    }
  },

  // Load previously played songs from storage
  async loadPreviouslyPlayedSongs(): Promise<Track[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(PREVIOUSLY_PLAYED_KEY);
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (error) {
      console.error("Error loading previously played songs:", error);
      return [];
    }
  },

  // Clear previously played songs
  async clearPreviouslyPlayedSongs(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PREVIOUSLY_PLAYED_KEY);
    } catch (error) {
      console.error("Error clearing previously played songs:", error);
      throw error;
    }
  },
};
