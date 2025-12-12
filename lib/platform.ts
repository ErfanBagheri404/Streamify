// Platform detection for web vs React Native
export const isWeb =
  typeof document !== "undefined" && typeof window !== "undefined";
export const isNative = !isWeb;

// Safe document access
export const safeDocument = isWeb ? document : null;
export const safeWindow = isWeb ? window : null;
