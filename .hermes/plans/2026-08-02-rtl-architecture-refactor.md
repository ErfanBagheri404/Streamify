# RTL Architecture Refactor Plan

> **Goal:** Decouple layout from language direction. The app layout must be IDENTICAL in Farsi and English — only text content, text direction, and font change.

## Problem

Currently, every screen has `flexDirection: isRtl ? "row-reverse" : "row"` and mirrored margins/padding. This causes:
1. Constant double-reversal bugs when `direction: "rtl"` is also set on parent Views
2. Layout differences between Farsi and English that look broken
3. 347 RTL-conditional layout lines across 20+ files that are fragile and hard to maintain

## Decision

**Layout is always LTR (English-style).** Only text rendering changes:
- `textAlign` → `"right"` for Farsi, `"left"` for English
- `writingDirection` → `"rtl"` for Farsi, `"ltr"` for English (Text elements only)
- `fontFamily` → Farsi font for Farsi, English font for English
- Content strings → translations via `t("key")`

## What to REMOVE (layout mirroring)

| Pattern | Replacement |
|---------|-------------|
| `flexDirection: isRtl ? "row-reverse" : "row"` | `flexDirection: "row"` |
| `marginLeft: isRtl ? 0 : N, marginRight: isRtl ? N : 0` | `marginLeft: N` (keep LTR value) |
| `marginLeft: isRtl ? N : 0, marginRight: isRtl ? 0 : N` | `marginRight: N` (keep LTR value) |
| `paddingLeft: isRtl ? N : M, paddingRight: isRtl ? M : N` | Use LTR values |
| `alignSelf: isRtl ? "flex-end" : "flex-start"` | `alignSelf: "flex-start"` |
| `alignItems: isRtl ? "flex-end" : "flex-start"` | `alignItems: "flex-start"` |
| `direction: isRtl ? "rtl" : "ltr"` on Views | Remove entirely |
| `direction: dir` on View containers | Remove entirely |
| `writingDirection: dir` on View/ScrollView containers | Remove entirely |
| `key={isRtl ? "rtl" : "ltr"}` on ScrollViews | Remove |
| `right: isRtl ? undefined : N, left: isRtl ? N : undefined` | `right: N` (keep LTR) |
| `right: isRtl ? N : undefined, left: isRtl ? undefined : N` | Keep LTR version |
| Array index reversal: `isRtl ? count - 1 - i : i` | Just `i` |
| `isRtl ? "chevron-back" : "chevron-forward"` | Always `"chevron-back"` |

## What to KEEP (text direction)

| Pattern | Reason |
|---------|--------|
| `textAlign: isRtl ? "right" : "left"` | Farsi text reads right-to-left |
| `writingDirection: isRtl ? "rtl" : "ltr"` on **Text** elements | Farsi text direction |
| `fontFamily: getAppFontFamily(isRtl, weight)` | Farsi/English fonts |
| `isRtl ? "فارسی" : "English"` (inline strings) | Translations |
| Seek bar touch calculation in FullPlayerModal | Touch position math |

## Files to modify (in order)

### Phase 1: Shared components (highest impact)

1. **`components/ui/SectionHeader.tsx`** — Remove `flexDirection` mirroring, `alignItems` mirroring
2. **`components/ui/Text.tsx`** — Keep as-is (already uses `resolveTextStyle`)
3. **`components/ui/Button.tsx`** — Remove `isRtl` prop from `resolveTextStyle` calls (already handled by the hook)
4. **`components/ui/Chip.tsx`** — Same as Button
5. **`components/ui/Screen.tsx`** — Remove ALL `writingDirection: dir` from Views (text handled by Text components)
6. **`components/ui/QueueConflictModal.tsx`** — Remove `isRtl` prop if it exists
7. **`components/StreamItem.tsx`** — Remove `flexDirection` mirroring, margin mirroring, `alignItems` mirroring
8. **`components/ListItem.tsx`** — Remove `flexDirection` mirroring
9. **`components/MiniPlayer.tsx`** — Remove `flexDirection` mirroring, margin mirroring
10. **`components/Playlist.tsx`** — Remove `flexDirection` mirroring, margin mirroring, `alignItems`/`alignSelf` mirroring, absolute positioning mirroring
11. **`components/PlaylistCreateModal.tsx`** — Remove `flexDirection` mirroring
12. **`components/FullPlayerModal.tsx`** — Remove `direction` on View, `flexDirection` mirroring, margin mirroring, chevron direction swap. KEEP seek bar touch calculation.
13. **`components/SkeletonLoader.tsx`** — Remove all mirroring
14. **`components/SliderSheet.tsx`** — Remove `flexDirection` mirroring, margin mirroring
15. **`components/CategoryBadges.tsx`** — Remove `flexDirection` mirroring, margin mirroring

### Phase 2: Screens

16. **`components/screens/HomeScreen.tsx`** — Remove `flexDirection` mirroring, `alignItems` mirroring, `key` props, `writingDirection: dir` from ScrollViews. Remove `dir` from destructuring if no longer needed.
17. **`components/screens/SearchScreen.tsx`** — Remove `flexDirection` mirroring, margin mirroring, `paddingLeft/Right` mirroring, `writingDirection` from filter ScrollViews
18. **`components/screens/LibraryScreen.tsx`** — Remove `flexDirection` mirroring, margin mirroring, `writingDirection` from ScrollView, array reversal logic
19. **`components/screens/SettingsScreen.tsx`** — Remove `flexDirection` mirroring, `alignSelf` mirroring
20. **`components/screens/ArtistScreen.tsx`** — Remove `flexDirection` mirroring, margin mirroring, `alignSelf` mirroring, `direction: "ltr"` on back buttons (always LTR now)
21. **`components/screens/AuthScreen.tsx`** — Remove `flexDirection` mirroring, margin mirroring
22. **`components/screens/AlbumPlaylistScreen.tsx`** — Remove `flexDirection` mirroring, margin mirroring, `textAlign` mirroring (KEEP `textAlign` for text only — move to Text elements)
23. **`components/screens/LikedSongsScreen.tsx`** — Remove inline `isRtl ? "..." : "..."` strings that duplicate translations (these should use `t()`)
24. **`components/screens/PreviouslyPlayedScreen.tsx`** — Same as LikedSongsScreen

### Phase 3: App root

25. **`App.tsx`** — Remove `flexDirection` mirroring in CustomTabBar, margin mirroring, `direction: dir` removals already done. Keep `writingDirection: dir` on tab bar Text elements only.

## Execution approach

Use `execute_code` with a Python script that:
1. Reads each file
2. Applies regex-based transforms for each pattern category
3. Writes the modified file
4. Runs `npx tsc --noEmit` after each phase

Transforms:
- `flexDirection: isRtl ? "row-reverse" : "row"` → `flexDirection: "row"`
- `marginRight: isRtl ? 0 : N` → remove line
- `marginLeft: isRtl ? N : 0` → `marginLeft: N`
- `marginLeft: isRtl ? 0 : N` → remove line  
- `marginRight: isRtl ? N : 0` → `marginRight: N`
- `paddingLeft: isRtl ? N : M` → `paddingLeft: M`
- `paddingRight: isRtl ? M : N` → `paddingRight: N`
- `alignSelf: isRtl ? "flex-end" : "flex-start"` → `alignSelf: "flex-start"`
- `alignItems: isRtl ? "flex-end" : "flex-start"` → `alignItems: "flex-start"`
- `alignItems: isRtl ? "flex-start" : "flex-end"` → `alignItems: "flex-end"`
- `direction: isRtl ? "rtl" : "ltr"` → remove
- `direction: dir` on Views → remove
- `writingDirection: dir` on Views → remove
- `key={isRtl ? "rtl" : "ltr"}` → remove
- `isRtl ? "chevron-back" : "chevron-forward"` → `"chevron-back"`
- Array reversal `isRtl ? count - 1 - i : i` → `i`

## Validation

After each phase:
1. `npx tsc --noEmit` — zero errors
2. Visual check: Farsi and English should have identical layout
3. Text should be RTL in Farsi, LTR in English
4. Fonts should change appropriately

## Risks

- Some margin patterns are complex (e.g., `marginLeft: isRtl ? 0 : 8, marginRight: isRtl ? 8 : 0` → need to keep one side)
- `textAlign: isRtl ? "right" : "left"` on View children (not Text) needs special handling
- Inline translation strings (`isRtl ? "فارسی" : "English"`) should be converted to `t()` calls
- Seek bar touch calculation in FullPlayerModal must be preserved
