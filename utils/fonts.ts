import type { StyleProp, TextStyle } from "react-native";

export type AppFontWeight =
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "black";

function normalizeWeight(
  weight?: string | number | null
): AppFontWeight | undefined {
  if (weight == null) {
    return undefined;
  }

  const normalized = String(weight);
  if (normalized === "900" || normalized === "800") {
    return "black";
  }
  if (normalized === "700") {
    return "bold";
  }
  if (normalized === "600") {
    return "semibold";
  }
  if (normalized === "500") {
    return "medium";
  }

  return "regular";
}

export function getAppFontFamily(
  isRtl: boolean,
  weight: AppFontWeight = "regular"
): string {
  if (isRtl) {
    switch (weight) {
      case "black":
        return "YekanBakhFat";
      case "bold":
        return "YekanBakhBold";
      case "semibold":
      case "medium":
        return "YekanBakhMedium";
      default:
        return "YekanBakhRegular";
    }
  }

  switch (weight) {
    case "black":
      return "GoogleSansBold";
    case "bold":
    case "semibold":
      return "GoogleSansSemiBold";
    case "medium":
      return "GoogleSansMedium";
    default:
      return "GoogleSansRegular";
  }
}

export function getTextDirectionStyle(
  isRtl: boolean,
  textAlign?: string
): TextStyle {
  return {
    writingDirection: isRtl ? "rtl" : "ltr",
    textAlign: textAlign ?? (isRtl ? "right" : "left"),
    includeFontPadding: false,
  };
}

export function resolveTextStyle(
  isRtl: boolean,
  style: StyleProp<TextStyle>,
  fallbackWeight: AppFontWeight
): TextStyle {
  const flattened = Array.isArray(style)
    ? style.reduce(
        (accumulator, currentValue) => {
          if (currentValue && typeof currentValue === "object") {
            Object.assign(accumulator, currentValue);
          }
          return accumulator;
        },
        {} as Record<string, unknown>,
      )
    : style && typeof style === "object"
      ? (style as Record<string, unknown>)
      : {};
  const resolvedWeight =
    normalizeWeight(flattened.fontWeight) || fallbackWeight;

  return {
    fontFamily:
      (typeof flattened.fontFamily === "string" && flattened.fontFamily) ||
      getAppFontFamily(isRtl, resolvedWeight),
    ...getTextDirectionStyle(
      isRtl,
      typeof flattened.textAlign === "string" ? flattened.textAlign : undefined
    ),
  };
}
