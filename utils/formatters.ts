/**
 * Utility functions for audio formatting and edge case handling
 */

/**
 * Format milliseconds to MM:SS format
 */
export const formatTime = (milliseconds: number): string => {
  if (isNaN(milliseconds) || milliseconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Format seconds to MM:SS format
 */
export const formatTimeSeconds = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

/**
 * Calculate effective duration (ensures minimum value for slider)
 */
export const getEffectiveDuration = (duration: number): number => {
  return Math.max(duration || 0, 1);
};

/**
 * Clamp progress value between 0 and duration
 */
export const clampProgress = (progress: number, duration: number): number => {
  const effectiveDuration = getEffectiveDuration(duration);
  return Math.max(0, Math.min(progress || 0, effectiveDuration));
};

/**
 * Check if progress is stuck (not advancing)
 */
export const isProgressStuck = (
  currentPosition: number,
  previousPosition: number,
  threshold: number = 0.1,
): boolean => {
  return Math.abs(currentPosition - previousPosition) < threshold;
};

/**
 * Calculate progress percentage for UI display
 */
export const getProgressPercentage = (
  progress: number,
  duration: number,
): number => {
  const effectiveDuration = getEffectiveDuration(duration);
  if (effectiveDuration <= 0) {
    return 0;
  }

  const clampedProgress = clampProgress(progress, duration);
  return (clampedProgress / effectiveDuration) * 100;
};

/**
 * Handle duration edge cases
 */
export const handleDurationEdgeCase = (duration: number): number => {
  // Handle undefined, null, NaN, or negative values
  if (
    duration === undefined ||
    duration === null ||
    isNaN(duration) ||
    duration < 0
  ) {
    return 0;
  }

  // Handle extremely large durations (likely corrupted)
  if (duration > 86400) {
    // 24 hours in seconds
    console.warn('[AudioUtils] Duration exceeds 24 hours, clamping to 0');
    return 0;
  }

  return duration;
};

/**
 * Handle progress edge cases
 */
export const handleProgressEdgeCase = (
  progress: number,
  duration: number,
): number => {
  // Handle undefined, null, NaN, or negative values
  if (
    progress === undefined ||
    progress === null ||
    isNaN(progress) ||
    progress < 0
  ) {
    return 0;
  }

  // Handle progress exceeding duration
  if (duration > 0 && progress > duration) {
    console.warn(
      '[AudioUtils] Progress exceeds duration, clamping to duration',
    );
    return duration;
  }

  return progress;
};

/**
 * Debounce function for rapid seek operations
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): T => {
  let timeout: NodeJS.Timeout;
  return ((...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  }) as T;
};

/**
 * Throttle function for progress updates
 */
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number,
): T => {
  let inThrottle: boolean;
  return ((...args) => {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  }) as T;
};
