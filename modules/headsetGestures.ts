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
  private lastTapAt = 0;
  /** Suppresses the fresh sequence a 4th tap would otherwise start. */
  private suppressedUntil = 0;
  /** Injectable clock for tests; defaults to Date.now(). */
  private now: () => number = () => Date.now();
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
   *
   * Idempotent per physical press: RNTP broadcasts each remote event to every
   * registered listener, and both TrackPlayerService.setupEventListeners and the
   * headless playbackService register for RemotePlay/RemotePause. Without this
   * guard, one physical press calls recordTap() twice, tapCount reaches 2, and
   * a single tap dispatches doubleTapAction instead of playPause.
   */
  public recordTap(): void {
    const now = this.now();
    // Two listener sets fire in the same tick (0ms apart); the fastest real
    // multi-tap in the suite is 15ms. 10ms splits the difference.
    if (now - this.lastTapAt < 10) return; // double-fire from two listener sets
    this.lastTapAt = now;
    // A 4th tap inside the old window (stiff earbud buttons) must not start a
    // fresh sequence — it would dispatch a phantom playPause after the window.
    if (now < this.suppressedUntil) return;

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
      // Ignore late taps from the same press cluster until the window drains.
      this.suppressedUntil = Date.now() + this.config.windowMs;
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
    this.lastTapAt = 0;
    this.suppressedUntil = 0;
  }
}
