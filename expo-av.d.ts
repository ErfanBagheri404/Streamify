declare module "expo-av" {
  import * as React from "react";

  export type AVPlaybackStatus =
    | AVPlaybackStatusSuccess
    | AVPlaybackStatusError;

  export interface AVPlaybackStatusSuccess {
    isLoaded: true;
    durationMillis?: number;
    positionMillis: number;
    shouldPlay: boolean;
    isPlaying: boolean;
    isBuffering: boolean;
    rate: number;
    shouldCorrectPitch: boolean;
    volume: number;
    isMuted: boolean;
    isLooping: boolean;
    didJustFinish: boolean;
    error?: never;
  }

  export interface AVPlaybackStatusError {
    isLoaded: false;
    error: string;
    durationMillis?: never;
    positionMillis?: never;
    shouldPlay?: never;
    isPlaying?: never;
    isBuffering?: never;
    rate?: never;
    shouldCorrectPitch?: never;
    volume?: never;
    isMuted?: never;
    isLooping?: never;
    didJustFinish?: never;
  }

  export function isAVPlaybackStatusSuccess(
    status: AVPlaybackStatus,
  ): status is AVPlaybackStatusSuccess;
  export function isAVPlaybackStatusError(
    status: AVPlaybackStatus,
  ): status is AVPlaybackStatusError;

  export interface Subscription {
    remove(): void;
  }

  export class Sound {
    static createAsync(
      source: { uri: string },
      options?: any,
      callback?: (status: AVPlaybackStatus) => void,
    ): Promise<{ sound: Sound }>;
    setOnPlaybackStatusUpdate(
      callback: (status: AVPlaybackStatus) => void,
    ): Subscription;
    playAsync(): Promise<void>;
    pauseAsync(): Promise<void>;
    stopAsync(): Promise<void>;
    unloadAsync(): Promise<void>;
    getStatusAsync(): Promise<AVPlaybackStatus>;
    setPositionAsync(position: number): Promise<void>;
  }

  export namespace Audio {
    export class Sound {
      static createAsync(
        source: { uri: string },
        options?: any,
        callback?: (status: AVPlaybackStatus) => void,
      ): Promise<{ sound: Sound }>;
      setOnPlaybackStatusUpdate(
        callback: (status: AVPlaybackStatus) => void,
      ): Subscription;
      playAsync(): Promise<void>;
      pauseAsync(): Promise<void>;
      stopAsync(): Promise<void>;
      unloadAsync(): Promise<void>;
      getStatusAsync(): Promise<AVPlaybackStatus>;
      setPositionAsync(position: number): Promise<void>;
    }

    export function setAudioModeAsync(options: {
      allowsRecordingIOS?: boolean;
      interruptionModeIOS?: InterruptionModeIOS;
      playsInSilentModeIOS?: boolean;
      staysActiveInBackground?: boolean;
      interruptionModeAndroid?: InterruptionModeAndroid;
      shouldDuckAndroid?: boolean;
      playThroughEarpieceAndroid?: boolean;
    }): Promise<void>;
  }

  export enum InterruptionModeIOS {
    DoNotMix = 0,
    DuckOthers = 1,
    MixWithOthers = 2,
  }

  export enum InterruptionModeAndroid {
    DoNotMix = 1,
    DuckOthers = 2,
    MixWithOthers = 3,
  }
}
