/********************************************************************
 *  updateNotes.ts — turn a raw GitHub release body into clean modal copy
 *
 *  The CI/CD workflow writes a structured release body:
 *
 *    # Streamify v20.30.90
 *    - Automated Android APK release from GitHub Actions.
 *    - App Version: `20.30.90`
 *    - Android Build Version: `36`
 *    - Tag: `v20.30.90`
 *    - Commit: `5353969...`
 *    - EAS Build ID: `00c526a9-...`
 *    - EAS Build Details: https://...
 *
 *    ## Changes
 *    - <commit message> (<short sha>)
 *
 *  GitHub needs that block (it's the release's provenance record), but the
 *  in-app modal shouldn't show machine metadata, markdown syntax, or a
 *  duplicated version banner. This module:
 *
 *    1. Removes the CI/CD metadata lines (Automated release / App Version /
 *       Android Build Version / Tag / Commit / EAS Build ID / EAS Build
 *       Details) wherever they appear.
 *    2. Converts "## Changes" and any leading "#"-banner into nothing (the
 *       modal already shows the version headline).
 *    3. Renders the remaining lines as a clean bullet list: "feat: add X
 *       (abc1234)" → "feat: add X" with the short sha kept as a subtle
 *       suffix. Non-bullet prose passes through untouched.
 *    4. Never throws — any body, including empty, yields a usable result.
 *******************************************************************/

/** Lines that are pure CI/CD provenance, not user-facing changelog. */
const METADATA_LINE_PATTERNS: RegExp[] = [
  /^#+\s*streamify\s+v?[\d.]+/i, // "# Streamify v20.30.90" banner
  /automated android apk release from github actions/i,
  /^app version:\s*`?[\w.\-]+`?$/i,
  /^android build version:\s*`?\d+`?$/i,
  /^tag:\s*`?v?[\w.\-]+`?$/i,
  /^commit:\s*`?[0-9a-f]{7,40}`?$/i,
  /^eas build id:\s*`?[0-9a-f\-]+`?$/i,
  /^eas build details:\s*\S+/i,
];

/** Section headers that add nothing in the modal context. */
const SECTION_HEADER_PATTERN = /^#+\s*(changes?|changelog|what'?s new|release notes)\s*$/i;

/** Trailing short-sha in parentheses: "feat: add X (abc1234)" */
const TRAILING_SHA_PATTERN = /\s*\(\s*([0-9a-f]{7,12})\s*\)\s*$/;

export interface CleanChangelogResult {
  /** Human-readable bullets/prose, ready to render. */
  lines: string[];
  /** True when nothing survived sanitization. */
  empty: boolean;
}

/** Strip inline markdown noise from a single line. */
function cleanInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1") // code spans → plain
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold → plain
    .replace(/^\s*[-*]\s+/, "") // leading "- " bullet → plain
    .trim();
}

/**
 * Sanitize a raw release body into modal-ready display lines.
 * The original GitHub release notes are never modified — this is
 * display-layer only.
 */
export function sanitizeChangelog(raw: string | null | undefined): CleanChangelogResult {
  const source = String(raw || "");
  if (!source.trim()) {
    return { lines: [], empty: true };
  }

  const lines: string[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      // Keep a single blank line as a paragraph separator if content
      // already exists; drop consecutive blanks.
      if (lines.length && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      continue;
    }

    if (METADATA_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      continue;
    }

    if (SECTION_HEADER_PATTERN.test(trimmed)) {
      continue;
    }

    let cleaned = cleanInline(trimmed);
    if (!cleaned) {
      continue;
    }

    const shaMatch = cleaned.match(TRAILING_SHA_PATTERN);
    if (shaMatch) {
      cleaned = cleaned.replace(TRAILING_SHA_PATTERN, "").trim() || cleaned;
    }

    // Collapse link-only lines ("Full changelog" + URL) — the modal has its
    // own release link.
    if (/^(full )?(changelog|release)\s*:?$/i.test(cleaned)) {
      continue;
    }

    lines.push(cleaned);
  }

  // Trim trailing/leading blanks introduced by removed lines.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  while (lines.length && lines[0] === "") lines.shift();

  return { lines, empty: lines.length === 0 };
}
