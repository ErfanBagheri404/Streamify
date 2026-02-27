// Minimal shared types for the mobile app

declare global {
  type StreamItem = {
    url: string;
    type: string;
    title: string;
    duration: number;
    uploaderName: string;
    uploaderUrl: string;
    thumbnail: string;
  };

  type AudioStream = {
    codec: string;
    url: string;
    quality: string;
    bitrate: string;
    contentLength: number;
    mimeType: string;
  };

  type Piped = {
    instance?: string;
    title: string;
    uploader: string;
    duration: number;
    uploaderUrl: string;
    livestream?: boolean;
    hls?: string;
    relatedStreams: {
      url: string;
      title: string;
      uploaderName: string;
      duration: number;
      uploaderUrl: string;
      type: string;
    }[];
    audioStreams: AudioStream[];
    subtitles: Record<"url" | "name", string>[];
  };

  type Invidious = {
    adaptiveFormats: Record<
      | "type"
      | "bitrate"
      | "encoding"
      | "clen"
      | "url"
      | "resolution"
      | "quality",
      string
    >[];
    recommendedVideos: {
      title: string;
      author: string;
      lengthSeconds: number;
      authorUrl: string;
      videoId: string;
    }[];
    title: string;
    captions: Record<"url" | "label", string>[];
    author: string;
    lengthSeconds: number;
    authorUrl: string;
    liveNow: boolean;
    hlsUrl?: string;
    dashUrl?: string;
  };
}

export {};

declare module "react-native-video-cache" {
  export default function convertToProxyURL(url: string): string;
  export function convertAsync(url: string): Promise<string>;
}
