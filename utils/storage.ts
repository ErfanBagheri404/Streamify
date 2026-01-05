import AsyncStorage from "@react-native-async-storage/async-storage";
import { Track } from "../contexts/PlayerContext";

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
}

const LIKED_SONGS_KEY = "@liked_songs";
const PREVIOUSLY_PLAYED_KEY = "@previously_played_songs";
const PLAYLISTS_KEY = "@playlists";

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

  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error("Error getting item from storage:", error);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error("Error setting item in storage:", error);
      throw error;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error("Error removing item from storage:", error);
      throw error;
    }
  },

  // Save playlists to storage
  async savePlaylists(playlists: Playlist[]): Promise<void> {
    try {
      const jsonValue = JSON.stringify(playlists);
      await AsyncStorage.setItem(PLAYLISTS_KEY, jsonValue);
    } catch (error) {
      console.error("Error saving playlists:", error);
      throw error;
    }
  },

  // Load playlists from storage
  async loadPlaylists(): Promise<Playlist[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(PLAYLISTS_KEY);
      return jsonValue != null ? JSON.parse(jsonValue) : [];
    } catch (error) {
      console.error("Error loading playlists:", error);
      return [];
    }
  },

  // Add a new playlist
  async addPlaylist(playlist: Playlist): Promise<void> {
    try {
      const playlists = await this.loadPlaylists();
      const updatedPlaylists = [...playlists, playlist];
      await this.savePlaylists(updatedPlaylists);
    } catch (error) {
      console.error("Error adding playlist:", error);
      throw error;
    }
  },

  // Delete a playlist by ID
  async deletePlaylist(playlistId: string): Promise<void> {
    try {
      const playlists = await this.loadPlaylists();
      const updatedPlaylists = playlists.filter((p) => p.id !== playlistId);
      await this.savePlaylists(updatedPlaylists);
    } catch (error) {
      console.error("Error deleting playlist:", error);
      throw error;
    }
  },

  // Update a playlist
  async updatePlaylist(playlist: Playlist): Promise<void> {
    try {
      const playlists = await this.loadPlaylists();
      const index = playlists.findIndex((p) => p.id === playlist.id);
      if (index !== -1) {
        playlists[index] = playlist;
        await this.savePlaylists(playlists);
      }
    } catch (error) {
      console.error("Error updating playlist:", error);
      throw error;
    }
  },
};
