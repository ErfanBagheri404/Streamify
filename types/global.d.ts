import type en from "../locales/en.json";

export type TranslationKeys = keyof typeof en;

export type Routes = "/upcoming" | "/search" | "/list" | "/" | "/library";

export type StreamItem = {
  url: string;
  type: string;
  name: string;
  views: number;
  title: string;
  videos: number;
  uploaded: number;
  duration: number;
  isShort?: boolean;
  thumbnail: string;
  subscribers: number;
  author: string;
  videoId: string;
  authorUrl: string;
  lengthSeconds: number;
  viewCount: number;
  publishedText: string;
  uploadedDate: string;
  description: string;
  uploaderName?: string;
  uploaderUrl?: string;
  viewCountText?: string;
};

export type Author = {
  url: string;
  name: string;
  channelId: string;
  subscribers: string;
  description: string;
  thumbnail: string;
};

export type CollectionItem = {
  id: string;
  title: string;
  author: string;
  duration: string;
  channelUrl: string;
  lastUpdated?: string;
};

export type List = Record<"id" | "name" | "thumbnail", string>;

export type Collection = {
  [index: string]: CollectionItem | DOMStringMap;
};

export type Library = {
  history?: Collection;
  favorites: Collection;
  playlists: Collection;
  watchlater: Collection;
  discover?: { [key: string]: { frequency: number } };
  [key: string]:
    | Collection
    | { [key: string]: { frequency: number } }
    | undefined;
};

export type SuperCollection =
  | "featured"
  | "collections"
  | APAC
  | "feed"
  | "for_you";

export type APAC = "trending" | "music" | "gaming" | "movies";

export type Scheme = {
  [index: string]: {
    bg: (r: number, g: number, b: number) => string;
    borderColor: (r: number, g: number, b: number) => string;
    shadowColor: string;
    onBg: string;
    text: string;
  };
};

export interface FileEv extends Event {
  target: HTMLInputElement & {
    files: FileList;
  };
}
