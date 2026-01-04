"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const async_storage_1 = __importDefault(require("@react-native-async-storage/async-storage"));
const LIKED_SONGS_KEY = "@liked_songs";
const PREVIOUSLY_PLAYED_KEY = "@previously_played_songs";
exports.StorageService = {
    // Save liked songs to storage
    async saveLikedSongs(songs) {
        try {
            const jsonValue = JSON.stringify(songs);
            await async_storage_1.default.setItem(LIKED_SONGS_KEY, jsonValue);
        }
        catch (error) {
            console.error("Error saving liked songs:", error);
            throw error;
        }
    },
    // Load liked songs from storage
    async loadLikedSongs() {
        try {
            const jsonValue = await async_storage_1.default.getItem(LIKED_SONGS_KEY);
            return jsonValue != null ? JSON.parse(jsonValue) : [];
        }
        catch (error) {
            console.error("Error loading liked songs:", error);
            return [];
        }
    },
    // Clear liked songs
    async clearLikedSongs() {
        try {
            await async_storage_1.default.removeItem(LIKED_SONGS_KEY);
        }
        catch (error) {
            console.error("Error clearing liked songs:", error);
            throw error;
        }
    },
    // Add a single liked song
    async addLikedSong(song) {
        try {
            const likedSongs = await this.loadLikedSongs();
            const updatedSongs = [...likedSongs, song];
            await this.saveLikedSongs(updatedSongs);
        }
        catch (error) {
            console.error("Error adding liked song:", error);
            throw error;
        }
    },
    // Remove a liked song
    async removeLikedSong(songId) {
        try {
            const likedSongs = await this.loadLikedSongs();
            const updatedSongs = likedSongs.filter((song) => song.id !== songId);
            await this.saveLikedSongs(updatedSongs);
        }
        catch (error) {
            console.error("Error removing liked song:", error);
            throw error;
        }
    },
    // Save previously played songs to storage
    async savePreviouslyPlayedSongs(songs) {
        try {
            const jsonValue = JSON.stringify(songs);
            await async_storage_1.default.setItem(PREVIOUSLY_PLAYED_KEY, jsonValue);
        }
        catch (error) {
            console.error("Error saving previously played songs:", error);
            throw error;
        }
    },
    // Load previously played songs from storage
    async loadPreviouslyPlayedSongs() {
        try {
            const jsonValue = await async_storage_1.default.getItem(PREVIOUSLY_PLAYED_KEY);
            return jsonValue != null ? JSON.parse(jsonValue) : [];
        }
        catch (error) {
            console.error("Error loading previously played songs:", error);
            return [];
        }
    },
    // Clear previously played songs
    async clearPreviouslyPlayedSongs() {
        try {
            await async_storage_1.default.removeItem(PREVIOUSLY_PLAYED_KEY);
        }
        catch (error) {
            console.error("Error clearing previously played songs:", error);
            throw error;
        }
    },
    // Generic storage methods
    async getItem(key) {
        try {
            return await async_storage_1.default.getItem(key);
        }
        catch (error) {
            console.error(`Error getting item ${key}:`, error);
            return null;
        }
    },
    async setItem(key, value) {
        try {
            await async_storage_1.default.setItem(key, value);
        }
        catch (error) {
            console.error(`Error setting item ${key}:`, error);
            throw error;
        }
    },
    async removeItem(key) {
        try {
            await async_storage_1.default.removeItem(key);
        }
        catch (error) {
            console.error(`Error removing item ${key}:`, error);
            throw error;
        }
    },
};
