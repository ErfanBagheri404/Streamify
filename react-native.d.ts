declare module "react-native" {
  import * as React from "react";

  export class View extends React.Component<any> {}
  export class Text extends React.Component<any> {}
  export class TextInput extends React.Component<any> {}
  export class ScrollView extends React.Component<any> {}
  export class Modal extends React.Component<any> {}
  export class TouchableOpacity extends React.Component<any> {}
  export class TouchableWithoutFeedback extends React.Component<any> {}
  export class Image extends React.Component<any> {}
  export class FlatList extends React.Component<any> {}
  export class ActivityIndicator extends React.Component<any> {}
  export class Keyboard {
    static dismiss(): void;
  }
  export class StatusBar extends React.Component<any> {
    static currentHeight?: number;
  }
  export class AppState {
    static currentState: string;
    static addEventListener(event: string, handler: Function): Subscription;
    static removeListener(event: string, handler: Function): void;
  }
  export class Dimensions {
    static get(dim: string): { width: number; height: number };
  }
  export class StyleSheet {
    static create<T>(styles: T): T;
  }
  export class Platform {
    static OS: string;
    static select<T>(obj: { ios?: T; android?: T; web?: T; default?: T }): T;
  }
  export class PixelRatio {
    static get(): number;
  }
  export class NativeModules {}
  export class LogBox {
    static ignoreLogs(patterns: string[]): void;
  }
  export class AppRegistry {
    static registerComponent(
      appKey: string,
      getComponent: () => React.ComponentType,
    ): void;
    static runApplication(appKey: string, params: any): void;
  }
  export class DeviceEventEmitter {
    static addListener(event: string, handler: Function): void;
    static removeListener(event: string, handler: Function): void;
    static emit(event: string, ...params: any[]): void;
  }
  export class NativeEventEmitter {
    addListener(eventName: string, listener: Function): { remove: () => void };
    removeAllListeners(eventName: string): void;
    emit(eventName: string, ...params: any[]): void;
  }
  export class TurboModule {}
  export class TurboModuleRegistry {
    static get(moduleName: string): any;
  }
  export type ErrorHandlerCallback = (error: any, isFatal?: boolean) => void;
  export class PlatformOSType {}
  export class EXDevLauncher {}
  export class StatusBarManager {}
  export const NativeModules: {
    [key: string]: any;
    StatusBarManager?: StatusBarManager;
  };

  export interface ViewStyle {}
  export interface TextStyle {}
  export interface ImageStyle {}

  export type StyleProp<T> = T | T[] | null | undefined;
}
