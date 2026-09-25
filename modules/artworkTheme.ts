/**
 * Artwork-driven theme: the pure half.
 *
 * This is the whole of #43's colour logic, kept free of React and of any
 * native module so it can be driven under Node. Two decisions worth stating:
 *
 * - **No androidx.palette.** The issue proposes a native `PaletteExtractor`.
 *   That would add a Gradle dependency whose resolution I cannot verify from
 *   here, and `android/` is gitignored so it would need a config plugin to
 *   survive CI's `prebuild --clean` — a lot of machinery to hand-pick colours
 *   that can be computed from the same bytes. The caller supplies the pixels
 *   (see `extractDominantColors`), this module decides what the theme is.
 *
 * - **Saturation and luminance are clamped before the accent is chosen.**
 *   The average colour of album art is frequently near-black, near-white, or a
 *   washed-out grey. Feeding that straight into the theme produces an unusable
 *   UI, which is the "contrast stays readable on extreme artwork" requirement
 *   from the issue's test plan. The clamps here are what make that true.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** HSL from RGB, h in degrees, s and l in 0..1. */
export function rgbToHsl({ r, g, b }: Rgb): {
  h: number;
  s: number;
  l: number;
} {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  h *= 60;
  if (h < 0) {
    h += 360;
  }
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  let value = match[1];
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/**
 * Pick the most colourful pixel from a small sample.
 *
 * A plain average is the usual trick and it is wrong: album covers are mostly
 * dark, and a cover with one bright logo in the corner averages to mud. This
 * buckets the pixels by hue and takes the largest bucket weighted by
 * saturation, which lands on the colour a human would name.
 */
export function extractDominantColor(pixels: Rgb[]): Rgb | null {
  if (!pixels.length) {
    return null;
  }

  const buckets = new Map<
    number,
    { count: number; saturation: number; sumR: number; sumG: number; sumB: number }
  >();

  for (const pixel of pixels) {
    const { h, s, l } = rgbToHsl(pixel);
    // Near-grey pixels carry no hue worth naming and would otherwise win a
    // bucket just by being numerous.
    if (s < 0.12 || l < 0.08 || l > 0.95) {
      continue;
    }
    const key = Math.floor(h / 30);
    const entry = buckets.get(key) ?? {
      count: 0,
      saturation: 0,
      sumR: 0,
      sumG: 0,
      sumB: 0,
    };
    entry.count += 1;
    entry.saturation += s;
    entry.sumR += pixel.r;
    entry.sumG += pixel.g;
    entry.sumB += pixel.b;
    buckets.set(key, entry);
  }

  if (!buckets.size) {
    // A genuinely grey cover: fall back to the average so the theme still
    // tracks the artwork rather than snapping to a fixed palette.
    let r = 0;
    let g = 0;
    let b = 0;
    for (const pixel of pixels) {
      r += pixel.r;
      g += pixel.g;
      b += pixel.b;
    }
    const n = pixels.length;
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }

  let best = null as null | { score: number; color: Rgb };
  buckets.forEach((entry) => {
    // Weight toward saturated colours, but let a dominant hue beat a rare
    // vivid one: this is what stops neon corners from taking over the app.
    const score = Math.sqrt(entry.count) * (entry.saturation / entry.count);
    const color = {
      r: Math.round(entry.sumR / entry.count),
      g: Math.round(entry.sumG / entry.count),
      b: Math.round(entry.sumB / entry.count),
    };
    if (!best || score > best.score) {
      best = { score, color };
    }
  });

  return best ? best.color : null;
}

export interface ArtworkThemeSeed {
  accent: string;
  accentContrast: string;
  /** True when the artwork is bright enough that the app should read light. */
  preferLight: boolean;
}

/**
 * The two colours the theme builder needs, chosen so the UI stays readable
 * whatever the cover looks like.
 */
export function deriveArtworkSeed(
  dominant: Rgb | null,
  isLightTheme: boolean,
): ArtworkThemeSeed {
  if (!dominant) {
    return { accent: "#1ed760", accentContrast: "#04110a", preferLight: isLightTheme };
  }

  const { h, s, l } = rgbToHsl(dominant);

  // Dark themes want a bright, saturated accent; light themes want a deeper
  // one. Both targets sit away from the extremes so a pure-black or pure-neon
  // cover cannot produce an unreadable accent.
  const targetL = isLightTheme
    ? Math.min(0.55, Math.max(0.28, l * 0.85))
    : Math.min(0.68, Math.max(0.5, l * 1.15 + 0.12));
  const targetS = Math.min(0.85, Math.max(0.42, s * 1.15));

  const accent = hslToRgb(h, targetS, targetL);

  // Nudge the accent until it clears 3:1 against the background in the
  // direction the theme actually needs. This is the guarantee behind
  // "contrast stays readable on extreme artwork".
  const background: Rgb = isLightTheme
    ? { r: 255, g: 255, b: 255 }
    : { r: 5, g: 5, b: 5 };
  const foreground: Rgb = isLightTheme
    ? { r: 5, g: 5, b: 5 }
    : { r: 245, g: 245, b: 245 };

  let adjusted = accent;
  for (let i = 0; i < 12; i += 1) {
    if (contrastRatio(adjusted, background) >= 3) {
      break;
    }
    const { h: ah, s: as, l: al } = rgbToHsl(adjusted);
    adjusted = hslToRgb(
      ah,
      as,
      isLightTheme ? Math.max(0.12, al - 0.06) : Math.min(0.88, al + 0.06),
    );
  }

  // Contrast colour for text drawn on top of the accent: pick whichever of
  // near-black / near-white actually contrasts, never assume.
  const accentContrast =
    contrastRatio(adjusted, { r: 0, g: 0, b: 0 }) >=
    contrastRatio(adjusted, { r: 255, g: 255, b: 255 })
      ? "#000000"
      : "#ffffff";

  return {
    accent: rgbToHex(adjusted),
    accentContrast,
    preferLight: isLightTheme,
  };
}
