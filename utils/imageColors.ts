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
): Promise<ColorTheme> => {
  try {
    console.log("[ColorExtraction] Starting extraction for:", imageUrl);

    const defaultTheme: ColorTheme = {
      primary: "#a3e635",
      secondary: "#22d3ee",
      background: "#000000",
      text: "#ffffff",
      accent: "#f59e0b",
    };

    if (imageUrl) {
      const colors = await extractDominantColors(imageUrl);
      console.log("[ColorExtraction] Extracted colors:", colors);

      if (colors && colors.length > 0) {
        const primaryColor = colors[0] || defaultTheme.primary;
        const secondaryColor = colors[1] || defaultTheme.secondary;
        const accentColor = colors[2] || defaultTheme.accent;

        console.log("[ColorExtraction] Using extracted colors:", {
          primaryColor,
          secondaryColor,
          accentColor,
        });

        // Create a dark, tinted background based on the primary color
        const darkBackground = makeDarkBackground(primaryColor);

        // Ensure text has good contrast
        const textColor = getContrastColor(darkBackground);

        const theme = {
          primary: primaryColor,
          secondary: secondaryColor,
          background: darkBackground,
          text: textColor,
          accent: accentColor,
        };

        console.log("[ColorExtraction] Final theme:", theme);
        return theme;
      } else {
        console.log(
          "[ColorExtraction] No colors extracted, using default theme",
        );
      }
    }

    return defaultTheme;
  } catch (error) {
    console.error("Error extracting colors from image:", error);
    return {
      primary: "#a3e635",
      secondary: "#22d3ee",
      background: "#000000",
      text: "#ffffff",
      accent: "#f59e0b",
    };
  }
};

// Real color extraction from image pixels
const extractDominantColors = async (imageUrl: string): Promise<string[]> => {
  try {
    console.log("[ColorExtraction] Starting pixel analysis for:", imageUrl);

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

    console.log("[ColorExtraction] Image dimensions:", { width, height });

    // Create a smaller version for analysis (faster processing)
    const analysisWidth = Math.min(width, 100);
    const analysisHeight = Math.min(height, 100);

    console.log("[ColorExtraction] Analysis dimensions:", {
      analysisWidth,
      analysisHeight,
    });

    // Resize image for analysis and get pixel data
    const resizedImage = await ImageManipulator.manipulateAsync(
      imageUrl,
      [{ resize: { width: analysisWidth, height: analysisHeight } }],
      { format: ImageManipulator.SaveFormat.PNG, base64: true },
    );

    console.log(
      "[ColorExtraction] Image manipulation complete, base64 available:",
      !!resizedImage.base64,
    );

    if (!resizedImage.base64) {
      throw new Error("Failed to get base64 data from image");
    }

    // Analyze the resized image for color characteristics
    const colorAnalysis = await analyzeImageColors(
      resizedImage.base64,
      analysisWidth,
      analysisHeight,
    );

    console.log("[ColorExtraction] Color analysis result:", colorAnalysis);

    // Generate colors based on analysis
    const colors = generateColorsFromAnalysis(colorAnalysis);
    console.log("[ColorExtraction] Generated colors from analysis:", colors);

    return colors;
  } catch (error) {
    console.error("Error extracting colors from image:", error);
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
    console.log("[ColorExtraction] Starting pixel analysis with dimensions:", {
      width,
      height,
    });

    const b64 = base64Data.includes(",")
      ? (base64Data.split(",").pop() as string)
      : base64Data;

    console.log("[ColorExtraction] Base64 data length:", b64.length);
    console.log(
      "[ColorExtraction] Base64 data preview:",
      b64.substring(0, 50) + "...",
    );

    let rgba: Uint8Array;

    try {
      const bytes = toByteArray(b64);
      console.log(
        "[ColorExtraction] Converted to bytes, length:",
        bytes.length,
      );

      const decoded = UPNG.decode(bytes.buffer);
      console.log("[ColorExtraction] UPNG decode successful:", {
        width: decoded.width,
        height: decoded.height,
        frames: decoded.frames ? decoded.frames.length : "undefined",
        data: decoded.data ? decoded.data.length : "undefined",
      });

      // Check if we have frame data or direct RGBA data
      if (decoded.frames && decoded.frames.length > 0) {
        const frames = UPNG.toRGBA8(decoded);
        console.log(
          "[ColorExtraction] Converted to RGBA8, frames:",
          frames.length,
        );
        rgba = frames[0];
      } else if (decoded.data) {
        console.log("[ColorExtraction] Using direct RGBA data");
        rgba = new Uint8Array(decoded.data);
      } else {
        throw new Error("No image data found in decoded result");
      }

      console.log("[ColorExtraction] RGBA data length:", rgba.length);

      console.log("[ColorExtraction] Decoded image data:", {
        totalPixels: rgba.length / 4,
        expectedPixels: width * height,
      });
    } catch (decodeError) {
      console.error("[ColorExtraction] UPNG decode error:", decodeError);
      throw decodeError;
    }

    // Color histogram to find the most dominant color
    const colorHistogram: Map<string, number> = new Map();
    let totalLight = 0;
    let validCount = 0;
    let grayCount = 0;

    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i + 2]; // Assuming BGRA format, so R is at offset 2
      const g = rgba[i + 1];
      const b = rgba[i]; // B is at offset 0
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

    console.log("[ColorExtraction] Pixel analysis complete:", {
      validCount,
      histogramSize: colorHistogram.size,
      grayCount,
      avgLight: validCount > 0 ? totalLight / validCount : 0.5,
    });

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
      if (lightness < 0.1 || lightness > 0.9) {
        return;
      }

      // Skip very low saturation colors (grays) unless they're very frequent
      if (saturation < 0.15 && count < validCount * 0.05) {
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

    console.log("[ColorExtraction] Most visually dominant color found:", {
      dominantColor,
      visualScore: bestScore.toFixed(3),
      selectionCriteria:
        "frequency(40%) + saturation(40%) + optimal lightness(20%)",
    });

    console.log("[ColorExtraction] Image characteristics:", {
      isBlackAndWhite,
      isDark,
      isLight,
      avgLight,
    });

    let dominantHue = 200;
    let saturation = 0.65;
    let lightness = 0.55;

    if (validCount > 0) {
      // Fallback: if no good color was found (bestScore too low), use the most frequent one
      if (bestScore < 0.2) {
        console.log(
          "[ColorExtraction] No visually prominent color found, falling back to most frequent",
        );
        let maxCount = 0;
        colorHistogram.forEach((count, colorKey) => {
          if (count > maxCount) {
            maxCount = count;
            const [r, g, b] = colorKey.split(",").map(Number);
            dominantColor = { r, g, b };
          }
        });
      }

      console.log("[ColorExtraction] Color calculation mode:", {
        useDominantColor: true,
        reason:
          bestScore >= 0.2
            ? "Using most visually prominent color"
            : "Using most frequent color (fallback)",
      });

      // Use the dominant color from histogram
      const rNorm = dominantColor.r / 255;
      const gNorm = dominantColor.g / 255;
      const bNorm = dominantColor.b / 255;

      console.log("[ColorExtraction] Dominant color RGB values:", {
        r: dominantColor.r,
        g: dominantColor.g,
        b: dominantColor.b,
      });

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

      console.log(
        "[ColorExtraction] Calculated HSL values from dominant color:",
        {
          dominantHue,
          saturation: Math.round(saturation * 100),
          lightness: Math.round(lightness * 100),
          colorSpace: saturation < 0.12 ? "grayscale" : "colorful",
        },
      );

      if (saturation < 0.12) {
        console.log(
          "[ColorExtraction] Detected grayscale dominant color, forcing black and white theme",
        );
        return {
          isBlackAndWhite: true,
          isDark,
          isLight,
          dominantHue,
          saturation,
          lightness,
        };
      }
    } else {
      console.log(
        "[ColorExtraction] No valid pixels found, using default blue",
      );
    }

    console.log("[ColorExtraction] Final analysis result:", {
      isBlackAndWhite,
      isDark,
      isLight,
      dominantHue,
      saturation: Math.round(saturation * 100),
      lightness: Math.round(lightness * 100),
    });

    return {
      isBlackAndWhite,
      isDark,
      isLight,
      dominantHue,
      saturation,
      lightness,
    };
  } catch (error) {
    console.error("[ColorExtraction] Error analyzing image colors:", error);
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
  console.log("[ColorExtraction] Generating colors from analysis:", {
    isBlackAndWhite: analysis.isBlackAndWhite,
    isDark: analysis.isDark,
    isLight: analysis.isLight,
    dominantHue: analysis.dominantHue,
    saturation: Math.round(analysis.saturation * 100),
    lightness: Math.round(analysis.lightness * 100),
  });

  if (analysis.isBlackAndWhite) {
    const colors = [
      "#2a2a2a", // Very dark gray primary
      "#555555", // Medium gray secondary
      "#808080", // True gray accent
    ];
    console.log("[ColorExtraction] Generated grayscale colors:", colors);
    return colors;
  } else if (analysis.isDark) {
    const colors = [
      "#1a1a1a", // Very dark gray primary
      "#404040", // Dark gray secondary
      "#666666", // Medium gray accent
    ];
    console.log("[ColorExtraction] Generated dark colors:", colors);
    return colors;
  } else if (analysis.isLight) {
    const colors = [
      "#f5f5f5", // Very light gray primary
      "#d0d0d0", // Light gray secondary
      "#b0b0b0", // Medium light gray accent
    ];
    console.log("[ColorExtraction] Generated light colors:", colors);
    return colors;
  } else {
    // Colorful image
    const colors = [
      `hsl(${analysis.dominantHue}, ${Math.round(
        analysis.saturation * 100,
      )}%, ${Math.round(analysis.lightness * 100)}%)`,
      `hsl(${(analysis.dominantHue + 60) % 360}, ${Math.round(
        analysis.saturation * 80,
      )}%, ${Math.round(analysis.lightness * 90)}%)`,
      `hsl(${(analysis.dominantHue + 120) % 360}, ${Math.round(
        analysis.saturation * 90,
      )}%, ${Math.round(analysis.lightness * 110)}%)`,
    ];
    console.log("[ColorExtraction] Generated colorful HSL colors:", colors);
    return colors;
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

  console.log("[ColorExtraction] URL-based analysis:", {
    hasLightBackground,
    hasDarkBackground,
  });

  return sampleColorsFromImage(imageUrl, hasLightBackground, hasDarkBackground);
};

// Smart color sampling based on image characteristics
const sampleColorsFromImage = (
  imageUrl: string,
  isLight: boolean,
  isDark: boolean,
): string[] => {
  console.log("[ColorExtraction] Analyzing image characteristics:", {
    isLight,
    isDark,
    imageUrl,
  });

  // Better detection of black and white images
  const isBlackAndWhite =
    imageUrl.toLowerCase().includes("bw") ||
    imageUrl.toLowerCase().includes("mono") ||
    imageUrl.toLowerCase().includes("grayscale") ||
    (isDark && isLight); // Both dark and light detected

  if (isBlackAndWhite) {
    console.log("[ColorExtraction] Detected black and white image");
    // For true black and white images, use grayscale palette
    return [
      "#2a2a2a", // Very dark gray primary
      "#555555", // Medium gray secondary
      "#808080", // True gray accent
    ];
  } else if (isDark) {
    console.log("[ColorExtraction] Detected dark image");
    // For dark images, extract subtle colors
    return [
      "#1a1a1a", // Very dark gray primary
      "#404040", // Dark gray secondary
      "#666666", // Medium gray accent
    ];
  } else if (isLight) {
    console.log("[ColorExtraction] Detected light image");
    // For light images, extract softer colors
    return [
      "#f5f5f5", // Very light gray primary
      "#d0d0d0", // Light gray secondary
      "#b0b0b0", // Medium light gray accent
    ];
  } else {
    console.log("[ColorExtraction] Detected colorful image");
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
export const predefinedThemes = {
  electronic: {
    primary: "#00d4ff",
    secondary: "#ff00ff",
    background: "#0a0a0a",
    text: "#ffffff",
    accent: "#ffff00",
  },
  rock: {
    primary: "#ff4444",
    secondary: "#ff8844",
    background: "#1a0a0a",
    text: "#ffffff",
    accent: "#ffaa44",
  },
  jazz: {
    primary: "#d4af37",
    secondary: "#8b4513",
    background: "#2a1a0a",
    text: "#f5f5dc",
    accent: "#cd853f",
  },
  classical: {
    primary: "#4a90e2",
    secondary: "#7b68ee",
    background: "#0a0a1a",
    text: "#f0f8ff",
    accent: "#9370db",
  },
  pop: {
    primary: "#ff69b4",
    secondary: "#ff1493",
    background: "#1a0a1a",
    text: "#ffffff",
    accent: "#ffc0cb",
  },
};
