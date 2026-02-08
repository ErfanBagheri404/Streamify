import { Image } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import UPNG from "upng-js";
import { toByteArray } from "base64-js";

export interface ColorTheme {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
}

export const extractColorsFromImage = async (
  imageUrl: string,
): Promise<ExtendedColorTheme> => {
  try {
    const defaultTheme: ExtendedColorTheme = {
      primary: "#a3e635",
      secondary: "#22d3ee",
      background: "#000000",
      text: "#ffffff",
      accent: "#f59e0b",
      isGradient: false,
    };

    if (imageUrl) {
      const colors = await extractDominantColors(imageUrl);

      if (colors && colors.length > 0) {
        const primaryColor = colors[0] || defaultTheme.primary;
        const secondaryColor = colors[1] || defaultTheme.secondary;
        const accentColor = colors[2] || defaultTheme.accent;
        
        // Find the closest matching predefined theme based on extracted colors
        const closestTheme = findClosestPredefinedTheme(
          primaryColor,
          secondaryColor,
          accentColor,
        );

        if (closestTheme) {
          
          return closestTheme;
        }

        // Fallback to custom theme generation if no close match found
        const darkBackground = makeDarkBackground(primaryColor);
        const textColor = getContrastColor(darkBackground);

        const theme = {
          primary: primaryColor,
          secondary: secondaryColor,
          background: darkBackground,
          text: textColor,
          accent: accentColor,
          isGradient: false,
        };

        return theme;
      }
    }

    return defaultTheme;
  } catch (error) {
    return {
      primary: "#a3e635",
      secondary: "#22d3ee",
      background: "#000000",
      text: "#ffffff",
      accent: "#f59e0b",
      isGradient: false,
    };
  }
};

// Real color extraction from image pixels
const extractDominantColors = async (imageUrl: string): Promise<string[]> => {
  try {
    // Get image dimensions using React Native's Image.getSize
    const { width, height } = await new Promise<{
      width: number;
      height: number;
    }>((resolve, reject) => {
      (Image as any).getSize(
        imageUrl,
        (width, height) => resolve({ width, height }),
        (error) => reject(error),
      );
    });

    // Create a smaller version for analysis (faster processing)
    const analysisWidth = Math.min(width, 100);
    const analysisHeight = Math.min(height, 100);

    // Resize image for analysis and get pixel data
    const resizedImage = await ImageManipulator.manipulateAsync(
      imageUrl,
      [{ resize: { width: analysisWidth, height: analysisHeight } }],
      { format: ImageManipulator.SaveFormat.PNG, base64: true },
    );

    console.log(!!resizedImage.base64); // eslint-disable-line no-console

    if (!resizedImage.base64) {
      throw new Error("Failed to get base64 data from image");
    }

    // Analyze the resized image for color characteristics
    const colorAnalysis = await analyzeImageColors(
      resizedImage.base64,
      analysisWidth,
      analysisHeight,
    );

    // Generate colors based on analysis
    const colors = generateColorsFromAnalysis(colorAnalysis);

    return colors;
  } catch (error) {
    console.error("Error extracting colors from image:", error); // eslint-disable-line no-console
    // Fallback to URL-based analysis
    return await extractColorsFromUrl(imageUrl);
  }
};

// Analyze image colors from base64 data
const analyzeImageColors = async (
  base64Data: string,
  width: number,
  height: number,
): Promise<{
  isBlackAndWhite: boolean;
  isDark: boolean;
  isLight: boolean;
  dominantHue: number;
  saturation: number;
  lightness: number;
}> => {
  try {
    const b64 = base64Data.includes(",")
      ? (base64Data.split(",").pop() as string)
      : base64Data;

    let rgba: Uint8Array;

    try {
      const bytes = toByteArray(b64);

      const decoded = UPNG.decode(bytes.buffer);

      // Check if we have frame data or direct RGBA data
      if (decoded.frames && decoded.frames.length > 0) {
        const frames = UPNG.toRGBA8(decoded);
        rgba = frames[0];
      } else if (decoded.data) {
        rgba = new Uint8Array(decoded.data);
      } else {
        throw new Error("No image data found in decoded result");
      }
    } catch (decodeError) {
      throw decodeError;
    }

    // Color histogram to find the most dominant color
    const colorHistogram: Map<string, number> = new Map();
    let totalLight = 0;
    let validCount = 0;
    let grayCount = 0;

    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i + 2]; // Should be rgba[i + 0]
      const g = rgba[i + 1]; // Correct
      const b = rgba[i]; // Should be rgba[i + 2]
      const a = rgba[i + 3];

      if (a < 128) {
        continue;
      } // Skip transparent pixels

      // Quantize colors to reduce noise (group similar colors)
      const quantizedR = Math.round(r / 16) * 16;
      const quantizedG = Math.round(g / 16) * 16;
      const quantizedB = Math.round(b / 16) * 16;

      const colorKey = `${quantizedR},${quantizedG},${quantizedB}`;
      colorHistogram.set(colorKey, (colorHistogram.get(colorKey) || 0) + 1);

      const rNorm = r / 255;
      const gNorm = g / 255;
      const bNorm = b / 255;
      const max = Math.max(rNorm, gNorm, bNorm);
      const min = Math.min(rNorm, gNorm, bNorm);
      const l = (max + min) / 2;
      const d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

      totalLight += l;
      validCount++;

      if (s < 0.12) {
        grayCount++;
      }
    }

    const avgLight = validCount > 0 ? totalLight / validCount : 0.5;
    const isDark = avgLight < 0.38;
    const isLight = avgLight > 0.75;
    const isBlackAndWhite =
      validCount > 0 ? grayCount / validCount > 0.65 : false;

    // Find the most visually dominant color from histogram
    let dominantColor = { r: 100, g: 100, b: 100 };
    let bestScore = 0;

    colorHistogram.forEach((count, colorKey) => {
      const [r, g, b] = colorKey.split(",").map(Number);

      // Convert to normalized values for analysis
      const rNorm = r / 255;
      const gNorm = g / 255;
      const bNorm = b / 255;
      const maxVal = Math.max(rNorm, gNorm, bNorm);
      const minVal = Math.min(rNorm, gNorm, bNorm);
      const lightness = (maxVal + minVal) / 2;
      const saturation =
        maxVal === minVal
          ? 0
          : (maxVal - minVal) / (1 - Math.abs(2 * lightness - 1));

      // Skip colors that are too dark (< 10%) or too light (> 90%) - less restrictive
      if (lightness < 0.05 || lightness > 0.95) {
        return;
      }

      // Skip very low saturation colors (grays) unless they're very frequent
      if (saturation < 0.1 && count < validCount * 0.02) {
        return;
      }

      // Calculate visual importance score: combines frequency, saturation, and optimal lightness
      const frequencyScore = count / validCount; // 0-1, how frequent
      const saturationScore = Math.min(1, saturation / 0.8); // 0-1, how colorful
      const lightnessScore = 1 - Math.abs(lightness - 0.5) * 2; // 0-1, prefers mid-tones

      // Combined score with weights: frequency (40%), saturation (40%), lightness (20%)
      const visualScore =
        frequencyScore * 0.4 + saturationScore * 0.4 + lightnessScore * 0.2;

      if (visualScore > bestScore) {
        bestScore = visualScore;
        dominantColor = { r, g, b };
      }
    });

    let dominantHue = 200;
    let saturation = 0.65;
    let lightness = 0.55;

    if (validCount > 0) {
      // Fallback: if no good color was found (bestScore too low), use the most frequent one
      if (bestScore < 0.1) {
        let maxCount = 0;
        colorHistogram.forEach((count, colorKey) => {
          if (count > maxCount) {
            maxCount = count;
            const [r, g, b] = colorKey.split(",").map(Number);
            dominantColor = { r, g, b };
          }
        });
      }

      // Use the dominant color from histogram
      const rNorm = dominantColor.r / 255;
      const gNorm = dominantColor.g / 255;
      const bNorm = dominantColor.b / 255;

      const max = Math.max(rNorm, gNorm, bNorm);
      const min = Math.min(rNorm, gNorm, bNorm);
      const lAvg = (max + min) / 2;
      const d = max - min;
      const sAvg = d === 0 ? 0 : d / (1 - Math.abs(2 * lAvg - 1));
      let hAvg = 0;
      if (d !== 0) {
        switch (max) {
          case rNorm:
            hAvg = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
            break;
          case gNorm:
            hAvg = (bNorm - rNorm) / d + 2;
            break;
          default:
            hAvg = (rNorm - gNorm) / d + 4;
        }
        hAvg *= 60;
      }
      dominantHue = ((Math.round(hAvg) % 360) + 360) % 360;
      saturation = Math.min(0.9, Math.max(0.08, sAvg));
      lightness = Math.min(0.75, Math.max(0.18, lAvg));

      if (saturation < 0.12) {
        return {
          isBlackAndWhite: true,
          isDark,
          isLight,
          dominantHue,
          saturation,
          lightness,
        };
      }
    }

    return {
      isBlackAndWhite,
      isDark,
      isLight,
      dominantHue,
      saturation,
      lightness,
    };
  } catch (error) {
    return {
      isBlackAndWhite: false,
      isDark: false,
      isLight: false,
      dominantHue: 200,
      saturation: 0.7,
      lightness: 0.6,
    };
  }
};

// Helper removed: we now do real pixel analysis

// Generate colors from analysis
const generateColorsFromAnalysis = (analysis: {
  isBlackAndWhite: boolean;
  isDark: boolean;
  isLight: boolean;
  dominantHue: number;
  saturation: number;
  lightness: number;
}): string[] => {
  if (analysis.isBlackAndWhite) {
    return ["#374151", "#6b7280", "#9ca3af"]; // Better grayscale
  } else if (analysis.isDark) {
    // Use actual dominant color instead of grays
    return [
      `hsl(${analysis.dominantHue}, ${Math.round(analysis.saturation * 80)}%, ${Math.round(analysis.lightness * 40)}%)`,
      `hsl(${analysis.dominantHue}, ${Math.round(analysis.saturation * 60)}%, ${Math.round(analysis.lightness * 60)}%)`,
      `hsl(${analysis.dominantHue}, ${Math.round(analysis.saturation * 70)}%, ${Math.round(analysis.lightness * 80)}%)`,
    ];
  } else if (analysis.isLight) {
    return [
      `hsl(${analysis.dominantHue}, ${Math.round(analysis.saturation * 60)}%, ${Math.round(analysis.lightness * 90)}%)`,
      `hsl(${analysis.dominantHue}, ${Math.round(analysis.saturation * 50)}%, ${Math.round(analysis.lightness * 75)}%)`,
      `hsl(${analysis.dominantHue}, ${Math.round(analysis.saturation * 40)}%, ${Math.round(analysis.lightness * 60)}%)`,
    ];
  } else {
    // Colorful image - use complementary colors
    return [
      `hsl(${analysis.dominantHue}, ${Math.round(analysis.saturation * 100)}%, ${Math.round(analysis.lightness * 100)}%)`,
      `hsl(${(analysis.dominantHue + 30) % 360}, ${Math.round(analysis.saturation * 80)}%, ${Math.round(analysis.lightness * 85)}%)`,
      `hsl(${(analysis.dominantHue + 180) % 360}, ${Math.round(analysis.saturation * 90)}%, ${Math.round(analysis.lightness * 70)}%)`,
    ];
  }
};

// Fallback URL-based analysis
const extractColorsFromUrl = async (imageUrl: string): Promise<string[]> => {
  const hasLightBackground =
    imageUrl.toLowerCase().includes("white") ||
    imageUrl.toLowerCase().includes("light") ||
    imageUrl.toLowerCase().includes("bright");

  const hasDarkBackground =
    imageUrl.toLowerCase().includes("black") ||
    imageUrl.toLowerCase().includes("dark") ||
    imageUrl.toLowerCase().includes("night");

  return sampleColorsFromImage(imageUrl, hasLightBackground, hasDarkBackground);
};

// Smart color sampling based on image characteristics
const sampleColorsFromImage = (
  imageUrl: string,
  isLight: boolean,
  isDark: boolean,
): string[] => {
  // Better detection of black and white images
  const isBlackAndWhite =
    imageUrl.toLowerCase().includes("bw") ||
    imageUrl.toLowerCase().includes("mono") ||
    imageUrl.toLowerCase().includes("grayscale") ||
    (isDark && isLight); // Both dark and light detected

  if (isBlackAndWhite) {
    // For true black and white images, use grayscale palette
    return [
      "#2a2a2a", // Very dark gray primary
      "#555555", // Medium gray secondary
      "#808080", // True gray accent
    ];
  } else if (isDark) {
    // For dark images, extract subtle colors
    return [
      "#1a1a1a", // Very dark gray primary
      "#404040", // Dark gray secondary
      "#666666", // Medium gray accent
    ];
  } else if (isLight) {
    // For light images, extract softer colors
    return [
      "#f5f5f5", // Very light gray primary
      "#d0d0d0", // Light gray secondary
      "#b0b0b0", // Medium light gray accent
    ];
  } else {
    // For colorful images, extract vibrant colors
    // Use a more sophisticated approach based on image URL patterns
    const colorKeywords = [
      { keyword: "red", hue: 0 },
      { keyword: "orange", hue: 30 },
      { keyword: "yellow", hue: 60 },
      { keyword: "green", hue: 120 },
      { keyword: "blue", hue: 240 },
      { keyword: "purple", hue: 280 },
      { keyword: "pink", hue: 330 },
    ];

    let baseHue = 200; // Default blue-ish

    // Check if image URL contains color keywords
    for (const color of colorKeywords) {
      if (imageUrl.toLowerCase().includes(color.keyword)) {
        baseHue = color.hue;
        break;
      }
    }

    // If no color keywords found, use hash-based approach
    if (baseHue === 200) {
      const hash = imageUrl.split("").reduce((acc, char) => {
        return char.charCodeAt(0) + ((acc << 5) - acc);
      }, 0);
      baseHue = Math.abs(hash) % 360;
    }

    return [
      `hsl(${baseHue}, 70%, 60%)`, // Vibrant primary
      `hsl(${(baseHue + 60) % 360}, 60%, 50%)`, // Complementary secondary
      `hsl(${(baseHue + 120) % 360}, 80%, 55%)`, // Triadic accent
    ];
  }
};

// Helper function to adjust color brightness (handles both hex and HSL)
const adjustBrightness = (color: string, amount: number): string => {
  // Handle HSL colors
  if (color.startsWith("hsl")) {
    const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (match) {
      const h = parseInt(match[1]);
      const s = parseInt(match[2]);
      let l = parseInt(match[3]) + amount * 100;
      l = Math.max(0, Math.min(100, l));
      return `hsl(${h}, ${s}%, ${l}%)`;
    }
  }

  // Handle hex colors
  let hex = color.replace("#", "");
  const num = parseInt(hex, 16);
  let r = (num >> 16) + Math.round(255 * amount);
  let g = ((num >> 8) & 0x00ff) + Math.round(255 * amount);
  let b = (num & 0x0000ff) + Math.round(255 * amount);

  // Clamp values
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));

  // Convert back to hex
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
};

// Create a dark tinted background from a color without turning it pure black
const makeDarkBackground = (color: string): string => {
  if (color.startsWith("hsl")) {
    const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (match) {
      const h = parseInt(match[1], 10);
      const s = parseInt(match[2], 10);
      const l = parseInt(match[3], 10);
      const bgS = Math.min(60, Math.max(25, Math.round(s * 0.6)));
      const bgL = Math.min(30, Math.max(12, Math.round(l * 0.4)));
      return `hsl(${h}, ${bgS}%, ${bgL}%)`;
    }
  }
  // For hex colors, moderately darken
  return adjustBrightness(color, -0.4);
};

// Helper function to get contrast color (black or white)
const getContrastColor = (color: string): string => {
  let r, g, b;

  // Handle HSL colors
  if (color.startsWith("hsl")) {
    const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (match) {
      const h = parseInt(match[1]);
      const s = parseInt(match[2]) / 100;
      const l = parseInt(match[3]) / 100;

      // Convert HSL to RGB
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;

      let r1, g1, b1;
      if (h < 60) {
        r1 = c;
        g1 = x;
        b1 = 0;
      } else if (h < 120) {
        r1 = x;
        g1 = c;
        b1 = 0;
      } else if (h < 180) {
        r1 = 0;
        g1 = c;
        b1 = x;
      } else if (h < 240) {
        r1 = 0;
        g1 = x;
        b1 = c;
      } else if (h < 300) {
        r1 = x;
        g1 = 0;
        b1 = c;
      } else {
        r1 = c;
        g1 = 0;
        b1 = x;
      }

      r = Math.round((r1 + m) * 255);
      g = Math.round((g1 + m) * 255);
      b = Math.round((b1 + m) * 255);
    } else {
      return "#ffffff"; // fallback
    }
  } else {
    // Handle hex colors
    const hex = color.replace("#", "");
    const num = parseInt(hex, 16);
    r = (num >> 16) & 0xff;
    g = (num >> 8) & 0xff;
    b = num & 0xff;
  }

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white based on luminance
  return luminance > 0.5 ? "#000000" : "#ffffff";
};

// Predefined color themes for different genres/moods
export interface GradientTheme {
  colors: string[];
  start?: [number, number];
  end?: [number, number];
  locations?: number[];
}

export interface ExtendedColorTheme extends ColorTheme {
  gradient?: GradientTheme;
  isGradient?: boolean;
}

export const predefinedThemes: Record<string, ExtendedColorTheme> = {
  electronic: {
    primary: "#00d4ff",
    secondary: "#ff00ff",
    background: "#0a0a0a",
    text: "#ffffff",
    accent: "#ffff00",
    gradient: {
      colors: ["#0a0a0a", "#1a1a2e", "#16213e"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  rock: {
    primary: "#ff4444",
    secondary: "#ff8844",
    background: "#1a0a0a",
    text: "#ffffff",
    accent: "#ffaa44",
    gradient: {
      colors: ["#1a0a0a", "#2a0a0a", "#3a1a1a"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  jazz: {
    primary: "#d4af37",
    secondary: "#8b4513",
    background: "#2a1a0a",
    text: "#f5f5dc",
    accent: "#cd853f",
    gradient: {
      colors: ["#2a1a0a", "#3a2a1a", "#4a3a2a"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  classical: {
    primary: "#4a90e2",
    secondary: "#7b68ee",
    background: "#0a0a1a",
    text: "#f0f8ff",
    accent: "#9370db",
    gradient: {
      colors: ["#0a0a1a", "#1a1a2a", "#2a2a3a"],
      start: [0, 0],
      end: [0, 1],
    },
    isGradient: true,
  },
  pop: {
    primary: "#ff69b4",
    secondary: "#ff1493",
    background: "#1a0a1a",
    text: "#ffffff",
    accent: "#ffc0cb",
    gradient: {
      colors: ["#1a0a1a", "#2a0a2a", "#3a1a3a"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  // New themes with gradients
  sunset: {
    primary: "#ff6b35",
    secondary: "#f7931e",
    background: "#2a1810",
    text: "#ffffff",
    accent: "#ffd23f",
    gradient: {
      colors: ["#2a1810", "#4a2810", "#6a3810"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  ocean: {
    primary: "#00b4d8",
    secondary: "#0077b6",
    background: "#0a1a2a",
    text: "#ffffff",
    accent: "#90e0ef",
    gradient: {
      colors: ["#0a1a2a", "#0a2a3a", "#0a3a4a"],
      start: [0, 0],
      end: [0, 1],
    },
    isGradient: true,
  },
  forest: {
    primary: "#2d6a4f",
    secondary: "#40916c",
    background: "#0a2a1a",
    text: "#ffffff",
    accent: "#52b788",
    gradient: {
      colors: ["#0a2a1a", "#1a3a2a", "#2a4a3a"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  midnight: {
    primary: "#6c757d",
    secondary: "#495057",
    background: "#0a0a0a",
    text: "#ffffff",
    accent: "#dee2e6",
    gradient: {
      colors: ["#0a0a0a", "#1a1a1a", "#2a2a2a"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  neon: {
    primary: "#ff073a",
    secondary: "#39ff14",
    background: "#0a0a0a",
    text: "#ffffff",
    accent: "#ff6b35",
    gradient: {
      colors: ["#0a0a0a", "#1a0a1a", "#2a0a2a"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  warm: {
    primary: "#e76f51",
    secondary: "#f4a261",
    background: "#2a1a0a",
    text: "#ffffff",
    accent: "#e9c46a",
    gradient: {
      colors: ["#2a1a0a", "#3a2a1a", "#4a3a2a"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  cool: {
    primary: "#457b9d",
    secondary: "#1d3557",
    background: "#0a1a2a",
    text: "#ffffff",
    accent: "#a8dadc",
    gradient: {
      colors: ["#0a1a2a", "#1a2a3a", "#2a3a4a"],
      start: [0, 0],
      end: [0, 1],
    },
    isGradient: true,
  },
  vintage: {
    primary: "#8b4513",
    secondary: "#a0522d",
    background: "#2a1a0a",
    text: "#f5deb3",
    accent: "#daa520",
    gradient: {
      colors: ["#2a1a0a", "#3a2a1a", "#4a3a2a"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  // Additional beautiful gradient themes
  aurora: {
    primary: "#ff006e",
    secondary: "#8338ec",
    background: "#1a0a2a",
    text: "#ffffff",
    accent: "#06ffa5",
    gradient: {
      colors: ["#1a0a2a", "#2a1a3a", "#3a2a4a"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  cosmic: {
    primary: "#7209b7",
    secondary: "#560bad",
    background: "#0a0a1a",
    text: "#ffffff",
    accent: "#f72585",
    gradient: {
      colors: ["#0a0a1a", "#1a0a2a", "#2a0a3a"],
      start: [0, 0],
      end: [0, 1],
    },
    isGradient: true,
  },
  sunrise: {
    primary: "#ff9500",
    secondary: "#ff6200",
    background: "#2a1810",
    text: "#ffffff",
    accent: "#ffdd00",
    gradient: {
      colors: ["#2a1810", "#4a2810", "#6a3810"],
      start: [0, 1],
      end: [1, 0],
    },
    isGradient: true,
  },
  twilight: {
    primary: "#667eea",
    secondary: "#764ba2",
    background: "#0a1a2a",
    text: "#ffffff",
    accent: "#f093fb",
    gradient: {
      colors: ["#0a1a2a", "#1a2a3a", "#2a3a4a"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  fire: {
    primary: "#ff4757",
    secondary: "#ff6348",
    background: "#2a1010",
    text: "#ffffff",
    accent: "#ffa502",
    gradient: {
      colors: ["#2a1010", "#4a2020", "#6a3030"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  ice: {
    primary: "#74b9ff",
    secondary: "#0984e3",
    background: "#0a1a2a",
    text: "#ffffff",
    accent: "#00cec9",
    gradient: {
      colors: ["#0a1a2a", "#0a2a3a", "#0a3a4a"],
      start: [0, 0],
      end: [0, 1],
    },
    isGradient: true,
  },
  nature: {
    primary: "#00b894",
    secondary: "#55a3ff",
    background: "#0a2a1a",
    text: "#ffffff",
    accent: "#fdcb6e",
    gradient: {
      colors: ["#0a2a1a", "#1a3a2a", "#2a4a3a"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  sunsetGlow: {
    primary: "#ff7675",
    secondary: "#fd79a8",
    background: "#2a1018",
    text: "#ffffff",
    accent: "#fdcb6e",
    gradient: {
      colors: ["#2a1018", "#4a2028", "#6a3038"],
      start: [0, 0],
      end: [1, 1],
    },
    isGradient: true,
  },
  deepSpace: {
    primary: "#6c5ce7",
    secondary: "#a29bfe",
    background: "#0a0a1a",
    text: "#ffffff",
    accent: "#fd79a8",
    gradient: {
      colors: ["#0a0a1a", "#1a1a2a", "#2a2a3a"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  autumn: {
    primary: "#e17055",
    secondary: "#fab1a0",
    background: "#2a1810",
    text: "#ffffff",
    accent: "#fdcb6e",
    gradient: {
      colors: ["#2a1810", "#3a2820", "#4a3830"],
      start: [0, 0],
      end: [1, 0],
    },
    isGradient: true,
  },
  midnightBlue: {
    primary: "#0984e3",
    secondary: "#74b9ff",
    background: "#0a0a2a",
    text: "#ffffff",
    accent: "#00cec9",
    gradient: {
      colors: ["#0a0a2a", "#1a1a3a", "#2a2a4a"],
      start: [0, 0],
      end: [0, 1],
    },
    isGradient: true,
  },
};

// Helper function to convert hex color to RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
};

// Calculate color distance using Euclidean distance in RGB space
const colorDistance = (color1: string, color2: string): number => {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
      Math.pow(rgb1.g - rgb2.g, 2) +
      Math.pow(rgb1.b - rgb2.b, 2),
  );
};

// Find the closest predefined theme based on extracted colors
const findClosestPredefinedTheme = (
  primaryColor: string,
  secondaryColor: string,
  accentColor: string,
): ExtendedColorTheme | null => {
  let closestTheme: ExtendedColorTheme | null = null;
  let minDistance = Infinity;

  // Convert extracted colors to hex format if they're in HSL format
  let primaryHex = primaryColor;
  let secondaryHex = secondaryColor;
  let accentHex = accentColor;

  if (primaryColor.startsWith("hsl")) {
    primaryHex = hslToHex(primaryColor);
  }
  if (secondaryColor.startsWith("hsl")) {
    secondaryHex = hslToHex(secondaryColor);
  }
  if (accentColor.startsWith("hsl")) {
    accentHex = hslToHex(accentColor);
  }

  // Find the closest matching theme
  Object.entries(predefinedThemes).forEach(([_themeName, theme]) => {
    const distance =
      colorDistance(primaryHex, theme.primary) * 0.5 + // Primary color has more weight
      colorDistance(secondaryHex, theme.secondary) * 0.3 +
      colorDistance(accentHex, theme.accent) * 0.2;

    if (distance < minDistance) {
      minDistance = distance;
      closestTheme = theme;
    }
  });

  // Only return a predefined theme if it's reasonably close (threshold: 150)
  if (minDistance < 150) {
    
    return closestTheme;
  }

  
  return null;
};

// Convert HSL color to hex
const hslToHex = (hsl: string): string => {
  const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) {
    return "#000000";
  }

  const h = parseInt(match[1], 10);
  const s = parseInt(match[2], 10) / 100;
  const l = parseInt(match[3], 10) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`; // eslint-disable-line no-bitwise
};
