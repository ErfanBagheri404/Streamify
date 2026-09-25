/**
 * Headset media-button gesture interpreter (issue #45).
 *
 * Detects multi-tap sequences (double-tap, triple-tap) on incoming media
 * button / play-pause events within a configurable debounce window (default
 * 600ms). Dispatches the mapped action, falling back to OS play/pause when no
 * follow-up tap arrives.
 *
 * Pure: no React Native or TrackPlayer dependencies, fully runnable under Node
 * for contract testing.
 */

export type HeadsetAction =
  | "playPause"
  | "skipNext"
  | "skipPrevious"
  | "likeCurrent"
  | "smartQueue"
  | "sleepTimer"
  | "toggleShuffle";

export interface HeadsetGestureConfig {
  enabled: boolean;
  /** Window in milliseconds within which subsequent taps count as a multi-tap. */
  windowMs: number;
  /** Action executed on double-tap (2 taps within windowMs). */
  doubleTapAction: HeadsetAction;
  /** Action executed on triple-tap (3 taps within windowMs). */
  tripleTapAction: HeadsetAction;
}

export const DEFAULT_HEADSET_GESTURE_CONFIG: HeadsetGestureConfig = {
  enabled: true,
  windowMs: 600,
  doubleTapAction: "skipNext",
  tripleTapAction: "likeCurrent",
};

export type GestureDispatch = (action: HeadsetAction) => void | Promise<void>;

/**
 * Stateful multi-tap accumulator. Feeds raw play/pause signals from RNTP or
 * hardware receivers and collapses them into single, double, or triple-tap
 * actions.
 */
export class HeadsetGestureDetector {
  private tapCount = 0;
  private timer: any = null;
  private config: HeadsetGestureConfig;
  private onDispatch: GestureDispatch;

  constructor(
    onDispatch: GestureDispatch,
    config: Partial<HeadsetGestureConfig> = {},
  ) {
    this.onDispatch = onDispatch;
    this.config = { ...DEFAULT_HEADSET_GESTURE_CONFIG, ...config };
  }

  public updateConfig(config: Partial<HeadsetGestureConfig>) {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): HeadsetGestureConfig {
    return { ...this.config };
  }

  /**
   * Called every time a play/pause / hook press occurs.
   * If gestures are disabled, dispatches "playPause" immediately without buffering.
   */
  public recordTap(): void {
    if (!this.config.enabled) {
      this.onDispatch("playPause");
      return;
    }

    this.tapCount++;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Cap at triple-tap: trigger immediately on third tap rather than waiting out the window.
    if (this.tapCount >= 3) {
      this.flush();
      return;
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, this.config.windowMs);
  }

  private flush(): void {
    const count = this.tapCount;
    this.tapCount = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (count === 1) {
      this.onDispatch("playPause");
    } else if (count === 2) {
      this.onDispatch(this.config.doubleTapAction);
    } else if (count >= 3) {
      this.onDispatch(this.config.tripleTapAction);
    }
  }

  /** Clear any pending timers (used on unmount / reset / test). */
  public reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.tapCount = 0;
  }
}
