declare module "@react-native-community/slider" {
  import { Component } from "react";
  import { ViewProps, StyleProp, ViewStyle } from "react-native";

  export interface SliderProps extends ViewProps {
    value?: number;
    minimumValue?: number;
    maximumValue?: number;
    step?: number;
    minimumTrackTintColor?: string;
    maximumTrackTintColor?: string;
    thumbTintColor?: string;
    onValueChange?: (value: number) => void;
    onSlidingComplete?: (value: number) => void;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
  }

  export default class Slider extends Component<SliderProps> {}
}
