/**
 * Platform I/O for playlist import/export (issue #40).
 *
 * Sits between the pure format layer (playlistTransfer.ts) and the UI.
 * Keeps FileSystem / Sharing / DocumentPicker calls in one place so the screens
 * stay simple.
 */

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import {
  parsePlaylistText,
  toM3u,
  toCsv,
  playlistFileName,
  type ParsedEntry,
  type CsvRow,
  type M3uTrack,
} from "./playlistTransfer";
import { StorageService, type Playlist } from "../utils/storage";

export type ExportFormat = "m3u" | "csv";

/**
 * Write a playlist to a temporary file and hand it to the system share sheet.
 * Works with VLC, file managers, Google Drive, email, etc.
 */
export async function exportPlaylist(
  name: string,
  tracks: Array<{
    title: string;
    artist?: string;
    album?: string;
    url?: string;
    duration?: number;
  }>,
  format: ExportFormat = "m3u",
): Promise<boolean> {
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error("No writable directory available for export");
  }

  const filename = playlistFileName(
    name,
    format === "m3u" ? "m3u8" : "csv",
  );
  const targetUri = `${baseDir}${filename}`;

  let content: string;
  let mimeType: string;

  if (format === "csv") {
    const rows: CsvRow[] = tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      album: t.album,
    }));
    content = toCsv(rows);
    mimeType = "text/csv";
  } else {
    const m3uTracks: M3uTrack[] = tracks.map((t) => ({
      title: t.title,
      artist: t.artist,
      uri: t.url,
      durationSeconds: t.duration,
    }));
    content = toM3u(m3uTracks);
    mimeType = "audio/x-mpegurl";
  }

  await FileSystem.writeAsStringAsync(targetUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const available = await Sharing.isAvailableAsync();
  if (available) {
    await Sharing.shareAsync(targetUri, {
      mimeType,
      dialogTitle: `Export ${name}`,
      UTI: format === "csv" ? "public.comma-separated-values-text" : "public.m3u-playlist",
    });
    return true;
  }
  return false;
}

/**
 * Open the file picker for M3U/M3U8/PLS/CSV/TXT and parse the contents.
 * Returns null if the user cancels.
 */
export async function pickAndParsePlaylist(): Promise<{
  name: string;
  entries: ParsedEntry[];
} | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "audio/x-mpegurl",
      "audio/mpegurl",
      "application/vnd.apple.mpegurl",
      "text/csv",
      "text/plain",
      "*/*",
    ],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const content = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const fallbackName = (asset.name || "Imported Playlist").replace(
    /\.[a-z0-9]{1,5}$/i,
    "",
  );

  const entries = parsePlaylistText(content);
  return {
    name: fallbackName,
    entries,
  };
}

/**
 * Turn parsed entries into a real user Playlist.
 * Entries with known URLs (local files, direct streams) become playable tracks;
 * others keep their titles for later resolution.
 */
export async function createPlaylistFromEntries(
  name: string,
  entries: ParsedEntry[],
): Promise<Playlist> {
  const tracks = entries.map((entry, idx) => ({
    id: `import-${Date.now()}-${idx}`,
    title: entry.title,
    artist: entry.artist || "Unknown Artist",
    url: entry.uri || "",
    duration: entry.durationSeconds || 0,
    thumbnail: "",
    source: "imported",
  }));

  const playlist: Playlist = {
    id: Date.now().toString(),
    name: name.trim() || "Imported Playlist",
    description: `Imported with ${entries.length} ${
      entries.length === 1 ? "track" : "tracks"
    }`,
    tracks: tracks as any,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await StorageService.addPlaylist(playlist);
  return playlist;
}
