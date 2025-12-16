declare module '@react-navigation/bottom-tabs' {
  import * as React from 'react';

  export interface BottomTabNavigationOptions {
    id?: string;
  }

  export class BottomTabNavigator extends React.Component<any> {}

  export function createBottomTabNavigator(): any;
}

declare module '@react-navigation/native-stack' {
  import * as React from 'react';

  export interface NativeStackNavigationOptions {
    id?: string;
  }

  export class StackNavigator extends React.Component<any> {}

  export function createNativeStackNavigator(): any;
}
