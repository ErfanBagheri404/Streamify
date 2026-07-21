import React, { createContext, useContext, useMemo } from "react";
import { type AppTheme, isLightAppTheme } from "../lib/app-settings";
import { useSettings } from "./SettingsContext";

interface ThemeSeed {
  background: string;
  foreground: string;
  accent: string;
  accentContrast: string;
}

export interface ThemeColors {
  background: string;
  foreground: string;
  surface1: string;
  surface2: string;
  surface3: string;
  overlay: string;
  borderSubtle: string;
  muted: string;
  accent: string;
  accentContrast: string;
  heroStart: string;
  heroMid: string;
  heroEnd: string;
}

interface ThemeContextValue {
  themeName: AppTheme;
  isLight: boolean;
  colors: ThemeColors;
}

const THEME_SEEDS: Record<AppTheme, ThemeSeed> = {
  default: {
    background: "#050505",
    foreground: "#f5f5f5",
    accent: "#1ed760",
    accentContrast: "#04110a",
  },
  ocean: {
    background: "#07131d",
    foreground: "#eef8ff",
    accent: "#5cc8ff",
    accentContrast: "#031018",
  },
  amethyst: {
    background: "#120a1f",
    foreground: "#f7efff",
    accent: "#c084fc",
    accentContrast: "#12071b",
  },
  sunset: {
    background: "#1a0d08",
    foreground: "#fff2e8",
    accent: "#ff9153",
    accentContrast: "#1f0d06",
  },
  forest: {
    background: "#08130d",
    foreground: "#eefcf2",
    accent: "#4ade80",
    accentContrast: "#07140d",
  },
  rose: {
    background: "#180a11",
    foreground: "#fff1f6",
    accent: "#fb7185",
    accentContrast: "#220b12",
  },
  frost: {
    background: "#071116",
    foreground: "#effcff",
    accent: "#67e8f9",
    accentContrast: "#07131a",
  },
  midnight: {
    background: "#050816",
    foreground: "#eef2ff",
    accent: "#818cf8",
    accentContrast: "#060817",
  },
  ember: {
    background: "#170b07",
    foreground: "#fff4ed",
    accent: "#fb923c",
    accentContrast: "#1d0d04",
  },
  aurora: {
    background: "#061511",
    foreground: "#ecfffb",
    accent: "#2dd4bf",
    accentContrast: "#04110e",
  },
  sapphire: {
    background: "#06101d",
    foreground: "#edf5ff",
    accent: "#60a5fa",
    accentContrast: "#04101d",
  },
  violet: {
    background: "#13091c",
    foreground: "#faf0ff",
    accent: "#d8b4fe",
    accentContrast: "#14081d",
  },
  copper: {
    background: "#170c08",
    foreground: "#fff4ee",
    accent: "#d97757",
    accentContrast: "#190b06",
  },
  graphite: {
    background: "#090b0f",
    foreground: "#f4f7fb",
    accent: "#94a3b8",
    accentContrast: "#0c1016",
  },
  lagoon: {
    background: "#051617",
    foreground: "#effffd",
    accent: "#22d3ee",
    accentContrast: "#051214",
  },
  ruby: {
    background: "#19080d",
    foreground: "#fff2f5",
    accent: "#f43f5e",
    accentContrast: "#20070c",
  },
  olive: {
    background: "#111509",
    foreground: "#fbffef",
    accent: "#a3e635",
    accentContrast: "#111705",
  },
  starlight: {
    background: "#08091a",
    foreground: "#f6f7ff",
    accent: "#a5b4fc",
    accentContrast: "#0b0d1b",
  },
  dawn: {
    background: "#fff8f4",
    foreground: "#231814",
    accent: "#ff8a5b",
    accentContrast: "#ffffff",
  },
  mist: {
    background: "#f6f9ff",
    foreground: "#162033",
    accent: "#4f87ff",
    accentContrast: "#ffffff",
  },
  petal: {
    background: "#fff7fa",
    foreground: "#2b1620",
    accent: "#f06292",
    accentContrast: "#ffffff",
  },
  meadow: {
    background: "#f7fff8",
    foreground: "#142417",
    accent: "#2fbf71",
    accentContrast: "#ffffff",
  },
  daybreak: {
    background: "#f7f6ff",
    foreground: "#1f1830",
    accent: "#8b5cf6",
    accentContrast: "#ffffff",
  },
  linen: {
    background: "#fffaf5",
    foreground: "#2a1d16",
    accent: "#c08457",
    accentContrast: "#ffffff",
  },
  sky: {
    background: "#f4fbff",
    foreground: "#132433",
    accent: "#0ea5e9",
    accentContrast: "#ffffff",
  },
  lavender: {
    background: "#fbf9ff",
    foreground: "#241a33",
    accent: "#a78bfa",
    accentContrast: "#ffffff",
  },
  peach: {
    background: "#fff8f2",
    foreground: "#2d1b12",
    accent: "#fb923c",
    accentContrast: "#ffffff",
  },
  mint: {
    background: "#f4fffb",
    foreground: "#13261f",
    accent: "#10b981",
    accentContrast: "#ffffff",
  },
  butter: {
    background: "#fffdf2",
    foreground: "#2a220f",
    accent: "#f59e0b",
    accentContrast: "#ffffff",
  },
  sage: {
    background: "#f7fbf7",
    foreground: "#182517",
    accent: "#22c55e",
    accentContrast: "#ffffff",
  },
  ice: {
    background: "#f3feff",
    foreground: "#10262b",
    accent: "#06b6d4",
    accentContrast: "#ffffff",
  },
  sand: {
    background: "#fffaf3",
    foreground: "#2a1f14",
    accent: "#d97706",
    accentContrast: "#ffffff",
  },
  blush: {
    background: "#fff6f8",
    foreground: "#2a141b",
    accent: "#f43f5e",
    accentContrast: "#ffffff",
  },
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function colorToRgb(color: string) {
  const normalized = color.trim();
  const rgbMatch = normalized.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+\s*)?\)$/i,
  );

  if (rgbMatch) {
    return {
      r: clampColorChannel(Number(rgbMatch[1])),
      g: clampColorChannel(Number(rgbMatch[2])),
      b: clampColorChannel(Number(rgbMatch[3])),
    };
  }

  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  const value =
    hex.length === 3
      ? hex
          .split("")
          .map((part) => part + part)
          .join("")
      : hex;

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixColors(colorA: string, colorB: string, amount: number): string {
  const left = colorToRgb(colorA);
  const right = colorToRgb(colorB);

  return rgbToHex(
    left.r + (right.r - left.r) * amount,
    left.g + (right.g - left.g) * amount,
    left.b + (right.b - left.b) * amount,
  );
}

export function withOpacity(color: string, opacity: number): string {
  const { r, g, b } = colorToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function buildThemeColors(themeName: AppTheme): ThemeColors {
  const seed = THEME_SEEDS[themeName];
  const isLight = isLightAppTheme(themeName);
  const neutralTarget = isLight ? "#ffffff" : "#000000";
  const accentLift = isLight ? 0.18 : 0.26;
  const contrastLift = isLight ? 0.84 : 0.18;

  return {
    background: seed.background,
    foreground: seed.foreground,
    surface1: mixColors(seed.background, neutralTarget, contrastLift),
    surface2: mixColors(seed.background, seed.accent, accentLift),
    surface3: mixColors(
      mixColors(seed.background, neutralTarget, isLight ? 0.9 : 0.1),
      seed.accent,
      isLight ? 0.08 : 0.12,
    ),
    overlay: withOpacity(
      mixColors(seed.background, seed.accent, isLight ? 0.08 : 0.18),
      isLight ? 0.94 : 0.86,
    ),
    borderSubtle: withOpacity(seed.accent, isLight ? 0.3 : 0.3),
    muted: withOpacity(seed.foreground, isLight ? 0.72 : 0.7),
    accent: seed.accent,
    accentContrast: seed.accentContrast,
    heroStart: mixColors(seed.accent, "#ffffff", isLight ? 0.38 : 0.08),
    heroMid: mixColors(seed.background, seed.accent, isLight ? 0.28 : 0.44),
    heroEnd: mixColors(seed.background, neutralTarget, isLight ? 0.08 : 0.04),
  };
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { settings } = useSettings();

  const value = useMemo<ThemeContextValue>(() => {
    const themeName = settings.theme;
    return {
      themeName,
      isLight: isLightAppTheme(themeName),
      colors: buildThemeColors(themeName),
    };
  }, [settings.theme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
