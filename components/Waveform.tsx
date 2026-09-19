/********************************************************************
 *  Waveform.tsx — lightweight waveform seek bar (View-only, no SVG)
 *
 *  Renders symmetric vertical bars from a peak-envelope array.
 *  Mirrors the existing PanResponder seek behaviour from FullPlayerModal
 *  so seek interactions feel identical.
 *
 *  When peaks is empty / missing, the caller renders the regular
 *  ProgressTrack seek bar instead — this component is never rendered
 *  in that case.
 *******************************************************************/
import React, { useCallback, useMemo } from "react";
import { View, PanResponder } from "react-native";

type LayoutChangeEvent = Parameters<
  NonNullable<React.ComponentProps<typeof View>["onLayout"]>
>[0] & {
  nativeEvent: {
    layout: { x: number; y: number; width: number; height: number };
  };
};
type AccessibilityActionEvent = Parameters<
  NonNullable<React.ComponentProps<typeof View>["onAccessibilityAction"]>
>[0] & { nativeEvent: { actionName?: string } };

export interface WaveformProps {
  /** Peak envelope (0..1 range, length = bucket count). */
  peaks: number[];
  /** Current seek ratio (0..1). */
  seekRatio: number;
  /** Whether seek is in progress (for highlight colour). */
  isSeeking: boolean;
  /** Callback fires with the resolved seek ratio when user lifts finger. */
  onSeek: (ratio: number) => void;
  /** Callback fires as user drags. */
  onDrag: (ratio: number) => void;
  /** Callback fires when drag starts. */
  onDragStart: (ratio: number) => void;
  /** Callback fires on termination/cancel. */
  onDragEnd: () => void;
  /** Whether the track is seekable. */
  canSeek: boolean;
  /** Colour of the played portion + unfilled bars. */
  playedColor?: string;
  /** Colour of the unfilled portion. */
  unfilledColor?: string;
  /** Height of the tallest bar in points. */
  barMaxHeight?: number;
  /** Width of each bar in points. */
  barWidth?: number;
  /** Gap between bars in points. */
  barGap?: number;
  /** Accessibility label (language-aware). */
  accessibilityLabel?: string;
  /** 0..1 progress ratio (0 = beginning, 1 = end) */
  progressRatio?: number;
}

const DEFAULT_PLAYED_COLOR = "#ffffff";
const DEFAULT_UNFILLED_COLOR = "rgba(255,255,255,0.24)";
const DEFAULT_BAR_MAX_HEIGHT = 24;
const DEFAULT_BAR_WIDTH = 2;
const DEFAULT_BAR_GAP = 1;

export function Waveform({
  peaks,
  seekRatio,
  isSeeking,
  onSeek,
  onDrag,
  onDragStart,
  onDragEnd,
  canSeek,
  playedColor = DEFAULT_PLAYED_COLOR,
  unfilledColor = DEFAULT_UNFILLED_COLOR,
  barMaxHeight = DEFAULT_BAR_MAX_HEIGHT,
  barWidth = DEFAULT_BAR_WIDTH,
  barGap = DEFAULT_BAR_GAP,
  accessibilityLabel,
  progressRatio = 0,
}: WaveformProps) {
  const [barContainerWidth, setBarContainerWidth] = React.useState(0);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setBarContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const ratioFromX = useCallback(
    (locationX: number) => {
      if (barContainerWidth <= 0) {
        return 0;
      }
      return Math.max(0, Math.min(1, locationX / barContainerWidth));
    },
    [barContainerWidth],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canSeek,
        onStartShouldSetPanResponderCapture: () => canSeek,
        onMoveShouldSetPanResponder: () => canSeek,
        onMoveShouldSetPanResponderCapture: () => canSeek,
        onPanResponderGrant: (e) => {
          onDragStart(ratioFromX(e.nativeEvent.locationX));
        },
        onPanResponderMove: (e) => {
          onDrag(ratioFromX(e.nativeEvent.locationX));
        },
        onPanResponderRelease: (e) => {
          onSeek(ratioFromX(e.nativeEvent.locationX));
        },
        onPanResponderTerminate: () => {
          onDragEnd();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [canSeek, onDrag, onDragEnd, onDragStart, onSeek, ratioFromX],
  );

  const activeRatio = isSeeking ? seekRatio : progressRatio;

  // How many bars fit at current width
  const totalBarStep = barWidth + barGap;
  const visibleBars = barContainerWidth > 0
    ? Math.min(peaks.length, Math.floor(barContainerWidth / totalBarStep))
    : 0;

  return (
    <View
      onLayout={handleLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={[
        { name: "decrement", label: "Seek backward" },
        { name: "increment", label: "Seek forward" },
      ]}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(activeRatio * 100),
      }}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (!canSeek) return;
        if (e.nativeEvent.actionName === "increment") {
          onSeek(Math.min(1, activeRatio + 0.05));
        } else if (e.nativeEvent.actionName === "decrement") {
          onSeek(Math.max(0, activeRatio - 0.05));
        }
      }}
      {...panResponder.panHandlers}
      style={{
        width: "100%",
        height: barMaxHeight + 8,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "row",
      }}
    >
      {visibleBars > 0 &&
        Array.from({ length: visibleBars }, (_, i) => {
          const peak = peaks[i] ?? 0;
          const h = Math.max(1, peak * barMaxHeight);
          const isPlayed = (i / visibleBars) < activeRatio;
          return (
            <View
              key={i}
              style={{
                width: barWidth,
                height: h,
                borderRadius: barWidth > 2 ? 1 : barWidth / 2,
                marginRight: barGap,
                backgroundColor: isPlayed ? playedColor : unfilledColor,
              }}
            />
          );
        })}
    </View>
  );
}
