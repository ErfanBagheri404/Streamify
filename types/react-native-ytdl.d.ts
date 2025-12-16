declare module 'react-native-ytdl' {
  export interface YTDLVideoInfo {
    videoDetails: {
      videoId: string;
      title: string;
      lengthSeconds: number;
      viewCount: number;
      author: string;
      authorId: string;
      authorUrl: string;
      description: string;
      thumbnail: {
        thumbnails: Array<{
          url: string;
          width: number;
          height: number;
        }>;
      };
    };
    formats: Array<{
      itag: number;
      url: string;
      mimeType: string;
      quality: string;
      bitrate: number;
      audioSampleRate: string;
      audioChannels: number;
      contentLength: string;
      container: string;
      hasVideo: boolean;
      hasAudio: boolean;
    }>;
  }

  export function getInfo(url: string, options?: {}): Promise<YTDLVideoInfo>;
  export function getFormats(url: string): Promise<any[]>;
  export function downloadFromInfo(info: YTDLVideoInfo, options?: {}): any;
  
  const YTDL: {
    getInfo: typeof getInfo;
    getFormats: typeof getFormats;
    downloadFromInfo: typeof downloadFromInfo;
  };

  export default YTDL;
}