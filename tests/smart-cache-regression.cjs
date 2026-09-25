/**
 * Smart offline cache regression tests (issue #31).
 *
 * modules/cacheBudget.ts is pure (inventory in, eviction plan out), so it
 * is transpiled and driven at runtime. The storage/UI wiring is asserted
 * as file-content contracts.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");

const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules", "typescript"));

const scratch = path.join(
  process.env.TMPDIR || path.join(root, ".hermes-tmp"),
  "cache-budget-" + process.pid + ".js",
);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(name);
    console.log(`FAIL ${name}\n  ${String((error && error.stack) || error).split("\n").join("\n  ")}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function loadPlanner() {
  const source = fs.readFileSync(path.join(root, "modules", "cacheBudget.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  fs.mkdirSync(path.dirname(scratch), { recursive: true });
  fs.writeFileSync(scratch, js, "utf8");
  const loaded = require(scratch);
  fs.unlinkSync(scratch);
  return loaded;
}

const {
  planCacheEviction,
  sanitizeCacheCapMb,
  summarizeCacheUsage,
  toBytes,
} = loadPlanner();

const MB = (n) => n * 1024 * 1024;
const entry = (trackId, sizeMb, lastUsedAt, extra = {}) => ({
  trackId,
  sizeBytes: MB(sizeMb),
  lastUsedAt,
  isFullyCached: true,
  isDownloading: false,
  ...extra,
});

const T0 = 1_700_000_000_000;

// ── cap budget ──────────────────────────────────────────────────────────

check("under budget evicts nothing", () => {
  const plan = planCacheEviction(
    [entry("a", 100, T0), entry("b", 100, T0)],
    500,
  );
  assert(!plan.overBudget, "expected not over budget");
  assert(plan.evict.length === 0, "expected no victims");
});

check("LRU order: least-recently-used goes first", () => {
  // 4 x 200MB under a 500MB cap: two victims, oldest first.
  const plan = planCacheEviction(
    [
      entry("new", 200, T0 + 9000),
      entry("old", 200, T0),
      entry("mid", 200, T0 + 4000),
      entry("newer", 200, T0 + 6000),
    ],
    500,
  );
  assert(plan.overBudget, "expected over budget");
  assert(plan.evict[0].trackId === "old", `expected old first, got ${plan.evict[0].trackId}`);
  assert(plan.evict[1].trackId === "mid", `expected mid second, got ${plan.evict[1].trackId}`);
  assert(plan.evict.length === 2, "exactly enough victims to fit under cap");
  assert(plan.projectedBytes <= toBytes(500), `still over cap: ${plan.projectedBytes}`);
});

check("eviction stops as soon as it fits the cap", () => {
  // 3 x 250MB under a 500MB cap: one eviction fits exactly, three would not.
  const plan = planCacheEviction(
    [
      entry("a", 250, T0),
      entry("b", 250, T0 + 1),
      entry("c", 250, T0 + 2),
    ],
    500,
  );
  assert(plan.evict.length === 1, `expected 1 victim, got ${plan.evict.length}`);
  assert(plan.keep.length === 2, `expected 2 kept, got ${plan.keep.length}`);
  assert(plan.projectedBytes === toBytes(500), `expected exactly 500MB, got ${plan.projectedBytes}`);
});

check("partial downloads are evicted before complete tracks", () => {
  // 600MB total, 500MB cap. Only one victim is needed, and it must be the
  // partial even though the complete track is far older.
  const plan = planCacheEviction(
    [
      entry("complete-old", 300, T0),
      entry("partial", 300, T0 + 99999, { isFullyCached: false }),
    ],
    500,
  );
  assert(plan.evict.length === 1, `expected 1 victim, got ${plan.evict.length}`);
  assert(plan.evict[0].trackId === "partial", "partial bytes are wasted and go first");
});

check("pinned tracks are never evicted even when over budget", () => {
  const plan = planCacheEviction(
    [entry("keep", 400, T0), entry("drop", 400, T0 + 1)],
    500,
    ["keep"],
  );
  assert(plan.evict.length === 1, `expected only the unpinned victim, got ${plan.evict.length}`);
  assert(plan.evict[0].trackId === "drop", `pinned track was evicted: ${plan.evict[0].trackId}`);
});

check("in-flight downloads are never evicted", () => {
  const plan = planCacheEviction(
    [entry("active", 400, T0, { isDownloading: true }), entry("idle", 400, T0 + 1)],
    500,
  );
  assert(plan.evict.length === 1, "expected one victim");
  assert(plan.evict[0].trackId === "idle", "the active download must be protected");
});

check("eviction is deterministic on identical timestamps", () => {
  const a = planCacheEviction([entry("b", 300, T0), entry("a", 300, T0)], 500);
  const b = planCacheEviction([entry("a", 300, T0), entry("b", 300, T0)], 500);
  assert(a.evict.length === 1 && b.evict.length === 1, "600MB under a 500MB cap evicts one");
  assert(a.evict[0].trackId === b.evict[0].trackId, "same inputs must pick the same victim");
});

check("empty cache is under budget", () => {
  const plan = planCacheEviction([], 500);
  assert(!plan.overBudget, "empty cache cannot be over budget");
  assert(plan.projectedBytes === 0, `expected 0 bytes, got ${plan.projectedBytes}`);
});

check("negative and missing sizes count as zero", () => {
  const plan = planCacheEviction(
    [entry("a", -50, T0), { trackId: "b", sizeBytes: undefined, lastUsedAt: T0 }],
    500,
  );
  assert(!plan.overBudget, "bogus sizes must not inflate the total");
  assert(plan.projectedBytes === 0, `expected 0 projected, got ${plan.projectedBytes}`);
});

check("a single oversized track is evicted rather than immortal", () => {
  const plan = planCacheEviction([entry("huge", 900, T0)], 500);
  assert(plan.evict.length === 1, "a track bigger than the cap must not be exempt");
  assert(plan.evict[0].trackId === "huge", `expected the oversized track, got ${plan.evict[0] && plan.evict[0].trackId}`);
});

check("cap is snapped to an offered option", () => {
  assert(sanitizeCacheCapMb(500) === 500, "exact option passes through");
  assert(sanitizeCacheCapMb(2000) === 2000, "exact option passes through");
  assert(sanitizeCacheCapMb(501) === 500, "nearest option wins");
  assert(sanitizeCacheCapMb(999) === 500, "999 is closer to 500 than 2000");
  assert(sanitizeCacheCapMb(100000) === 5000, "clamped to the largest option");
  assert(sanitizeCacheCapMb(undefined) === 500, "missing value falls back to the minimum");
  assert(sanitizeCacheCapMb("nope") === 500, "garbage falls back to the minimum");
  assert(sanitizeCacheCapMb(-1) === 500, "negative cannot produce a negative budget");
});

check("toBytes converts MB with no precision loss", () => {
  assert(toBytes(500) === 524288000, `got ${toBytes(500)}`);
  assert(toBytes(-5) === 0, "negative clamps to zero");
});

// ── usage summary ───────────────────────────────────────────────────────

check("usage summary splits liked vs other without double counting", () => {
  const summary = summarizeCacheUsage(
    [entry("liked1", 10, T0), entry("other", 20, T0), entry("liked2", 5, T0)],
    ["liked1", "liked2"],
  );
  assert(summary.likedBytes === MB(15), `liked ${summary.likedBytes}`);
  assert(summary.otherBytes === MB(20), `other ${summary.otherBytes}`);
  assert(summary.totalBytes === MB(35), `total ${summary.totalBytes}`);
});

check("usage summary reports partial bytes separately", () => {
  const summary = summarizeCacheUsage([
    entry("done", 10, T0),
    entry("half", 7, T0, { isFullyCached: false }),
  ]);
  assert(summary.partialBytes === MB(7), `partial ${summary.partialBytes}`);
  assert(summary.totalBytes === MB(17), `total still counts partials: ${summary.totalBytes}`);
});

// ── wiring contracts ────────────────────────────────────────────────────

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

check("cache queue enforces the budget after a completed download", () => {
  const player = stripComments(read("contexts/PlayerContext.tsx"));
  assert(
    player.includes("enforceAudioCacheBudget("),
    "PlayerContext must call enforceAudioCacheBudget",
  );
  const call = player.slice(player.indexOf("enforceAudioCacheBudget("));
  assert(
    call.includes("settings.audioCacheCapMb"),
    "the queue must read the configured cap, not a hard-coded one",
  );
  assert(
    /enforceAudioCacheBudget\(\s*settings\.audioCacheCapMb,\s*nowPlayingId \? \[nowPlayingId\] : \[\],?\s*\)/.test(player),
    "the now-playing track must be passed as a pinned id, so the queue never evicts what is playing",
  );
});

check("cap change in Settings enforces immediately, not at next download", () => {
  const settings = stripComments(read("components/screens/SettingsScreen.tsx"));
  const idx = settings.indexOf("updateSettings({ audioCacheCapMb: cap })");
  assert(idx > 0, "Settings must persist the chosen cap");
  const after = settings.slice(idx, idx + 400);
  assert(
    after.includes("enforceAudioCacheBudget(cap"),
    "lowering the cap must trim the cache right away",
  );
  assert(
    settings.includes("CACHE_CAP_OPTIONS_MB.map"),
    "the offered caps must come from the shared option list",
  );
});

check("settings persist and sanitize the cap", () => {
  const s = stripComments(read("lib/app-settings.ts"));
  assert(s.includes("audioCacheCapMb"), "AppSettings must expose audioCacheCapMb");
  assert(
    s.includes("sanitizeCacheCapMb(record.audioCacheCapMb)"),
    "a hand-edited or stale persisted value must be sanitized on load",
  );
  assert(/audioCacheCapMb:\s*500,/.test(s), "default cap must be 500MB");
});

check("audioStreaming exposes inventory, usage and eviction", () => {
  const a = stripComments(read("modules/audioStreaming.ts"));
  assert(a.includes("export async function listCacheEntriesForBudget"), "inventory reader missing");
  assert(a.includes("export async function getAudioCacheUsageBytes"), "usage reader missing");
  assert(a.includes("export async function enforceAudioCacheBudget"), "enforcement entrypoint missing");
  assert(
    a.includes("await clearAudioCacheForTrack(entry.trackId)"),
    "eviction must go through the existing per-track cleanup so files AND index stay in sync",
  );
  assert(
    !/index\.totalBytes\s*\+=/.test(a.slice(a.indexOf("export async function enforceAudioCacheBudget"))),
    "budget code must not touch index.totalBytes directly",
  );
});

check("both locales carry the cache-cap labels", () => {
  for (const file of ["locales/en.json", "locales/fa.json"]) {
    const json = JSON.parse(read(file));
    for (const key of ["settings.audioCacheCap", "settings.audioCacheCapDescription"]) {
      assert(
        typeof json[key] === "string" && json[key].length > 0,
        `${file} is missing ${key}`,
      );
    }
  }
});

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) {
  console.log(`FAILURES:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
