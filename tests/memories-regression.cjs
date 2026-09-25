/**
 * On This Day memories regression tests (issue #38).
 *
 * `modules/memories.ts` is pure (buckets in, memories out), so it is
 * transpiled and driven at runtime. The storage and UI wiring is asserted as a
 * contract since those modules pull in react-native.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const ts = require(path.join(root, "node_modules", "typescript"));

function loadModule(rel) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const scratch = process.env.TMPDIR || path.join(root, ".hermes-tmp");
  fs.mkdirSync(scratch, { recursive: true });
  const file = path.join(
    scratch,
    `mem-${path.basename(rel).replace(/\W/g, "_")}-${Date.now()}.cjs`,
  );
  fs.writeFileSync(file, js);
  const mod = require(file);
  fs.unlinkSync(file);
  return mod;
}

const m = loadModule("modules/memories.ts");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

/** A bucket with listening on the given day-of-month. */
function bucket(month, day, ms, tracks) {
  return {
    month,
    days: { [String(day)]: ms },
    tracks: tracks ?? [
      { id: `${month}-a`, title: "Track A", artist: "Artist", ms: 60_000, plays: 2, art: null },
      { id: `${month}-b`, title: "Track B", artist: "Artist", ms: 30_000, plays: 1, art: null },
    ],
    artists: [{ name: "Artist", ms: 90_000, plays: 3, art: null }],
  };
}

// --- basics -----------------------------------------------------------------

check("an exact one-year match produces one memory", () => {
  const memories = m.findYearlyMemories(
    [bucket("2024-06-15", 15, 3_600_000)],
    new Date(2025, 5, 15), // 2025-06-15 local
  );
  assert.strictEqual(memories.length, 1);
  assert.strictEqual(memories[0].yearsAgo, 1);
  assert.strictEqual(memories[0].date, "2024-06-15");
  assert.strictEqual(memories[0].monthDay, "06-15");
  assert.strictEqual(memories[0].listenedMs, 3_600_000);
});

check("the memory id is stable for the same date", () => {
  const days = [bucket("2024-06-15", 15, 3_600_000), bucket("2023-06-15", 15, 3_600_000)];
  const a = m.findYearlyMemories(days, new Date(2025, 5, 15));
  const b = m.findYearlyMemories(days, new Date(2025, 5, 15));
  assert.deepStrictEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.ok(a[0].id.includes("06-15"));
});

check("opening the app a day late still finds the anniversary", () => {
  const memories = m.findYearlyMemories(
    [bucket("2024-06-15", 15, 3_600_000)],
    new Date(2025, 5, 17), // two days late, default window 3
  );
  assert.strictEqual(memories.length, 1);
});

check("history outside the window is not a memory", () => {
  const memories = m.findYearlyMemories(
    [bucket("2024-06-01", 1, 3_600_000)],
    new Date(2025, 5, 15), // two weeks later
  );
  assert.strictEqual(memories.length, 0);
});

check("the current month is never treated as a past year", () => {
  // Same month, different year-less bucket: a partial month cannot be a memory.
  const today = new Date(2025, 5, 15);
  const memories = m.findYearlyMemories(
    [bucket("2025-06", 10, 3_600_000)],
    today,
  );
  assert.strictEqual(memories.length, 0);
});

check("today's own listening never counts as a memory", () => {
  const memories = m.findYearlyMemories(
    [bucket("2025-06", 15, 3_600_000)],
    new Date(2025, 5, 15),
  );
  assert.strictEqual(memories.length, 0);
});

check("a day with no listening never produces a memory", () => {
  const empty = { month: "2024-06", days: {}, tracks: [], artists: [] };
  const memories = m.findYearlyMemories([empty], new Date(2025, 5, 15));
  assert.strictEqual(memories.length, 0);
});

check("zero or negative ms on a day is ignored", () => {
  const zero = { month: "2024-06", days: { "15": 0 }, tracks: [], artists: [] };
  const negative = { month: "2024-06", days: { "15": -5 }, tracks: [], artists: [] };
  const memories = m.findYearlyMemories(
    [zero, negative],
    new Date(2025, 5, 15),
  );
  assert.strictEqual(memories.length, 0);
});

check("an empty history yields no memories and no crash", () => {
  assert.deepStrictEqual(m.findYearlyMemories([], new Date(2025, 5, 15)), []);
});

check("malformed buckets are skipped rather than throwing", () => {
  const memories = m.findYearlyMemories(
    [
      null,
      { month: 123 },
      { month: "2024-13", days: { "15": 1000 } },
      { month: "2024-06", days: null, tracks: null, artists: null },
      bucket("2024-06-15", 15, 3_600_000),
    ],
    new Date(2025, 5, 15),
  );
  assert.strictEqual(memories.length, 1);
});

// --- multiple years ----------------------------------------------------------

check("each past year contributes at most one memory", () => {
  const memories = m.findYearlyMemories(
    [
      bucket("2024-06", 14, 1_000_000),
      bucket("2024-06", 15, 5_000_000),
      bucket("2024-06", 16, 2_000_000),
      bucket("2023-06", 15, 9_000_000),
    ],
    new Date(2025, 5, 15),
  );
  assert.strictEqual(memories.length, 2);
  // The busiest day wins within a year, and the most recent year comes first.
  assert.strictEqual(memories[0].yearsAgo, 1);
  assert.strictEqual(memories[0].listenedMs, 5_000_000);
  assert.strictEqual(memories[1].yearsAgo, 2);
});

check("months are ordered most recent year first", () => {
  const memories = m.findYearlyMemories(
    [bucket("2022-06", 15, 9_000_000), bucket("2024-06", 15, 1_000_000)],
    new Date(2025, 5, 15),
  );
  assert.deepStrictEqual(
    memories.map((x) => x.yearsAgo),
    [1, 3],
  );
});

// --- payload ----------------------------------------------------------------

check("memory tracks are the month's top, capped and deterministic", () => {
  const tracks = Array.from({ length: 25 }, (_, i) => ({
    id: `t${i}`,
    title: `Title ${String(i).padStart(2, "0")}`,
    artist: "A",
    ms: (25 - i) * 1000,
    plays: 1,
    art: null,
  }));
  const memories = m.findYearlyMemories(
    [bucket("2024-06", 15, 3_600_000, tracks)],
    new Date(2025, 5, 15),
  );
  assert.strictEqual(memories[0].tracks.length, 10);
  assert.strictEqual(memories[0].tracks[0].id, "t0");
  assert.ok(memories[0].tracks[0].ms >= memories[0].tracks[1].ms);
});

check("approxTrackMs is the sum of the listed tracks, not the day total", () => {
  const memories = m.findYearlyMemories(
    [bucket("2024-06", 15, 3_600_000)],
    new Date(2025, 5, 15),
  );
  // 60k + 30k of month totals vs a 3.6M day — the floor must not claim the day.
  assert.strictEqual(memories[0].approxTrackMs, 90_000);
  assert.ok(memories[0].approxTrackMs <= memories[0].listenedMs);
});

check("a track with zero ms never enters a memory", () => {
  const memories = m.findYearlyMemories(
    [
      bucket("2024-06", 15, 3_600_000, [
        { id: "zero", title: "Zero", artist: "A", ms: 0, plays: 0, art: null },
        { id: "real", title: "Real", artist: "A", ms: 1000, plays: 1, art: null },
      ]),
    ],
    new Date(2025, 5, 15),
  );
  assert.deepStrictEqual(memories[0].tracks.map((x) => x.id), ["real"]);
});

check("artists are carried through, capped at five", () => {
  const artists = Array.from({ length: 12 }, (_, i) => ({
    name: `Artist ${String(i).padStart(2, "0")}`,
    ms: (12 - i) * 1000,
    plays: 1,
    art: null,
  }));
  const source = bucket("2024-06", 15, 3_600_000);
  source.artists = artists;
  const memories = m.findYearlyMemories([source], new Date(2025, 5, 15));
  assert.strictEqual(memories[0].artists.length, 5);
  assert.strictEqual(memories[0].artists[0].name, "Artist 00");
});

// --- history span -----------------------------------------------------------

check("history under a year reports it cannot have memories", () => {
  assert.strictEqual(
    m.historySpansAYear([bucket("2025-01", 5, 1000)], new Date(2025, 5, 15)),
    false,
  );
});

check("a full year of history is enough", () => {
  assert.strictEqual(
    m.historySpansAYear([bucket("2024-06", 5, 1000)], new Date(2025, 5, 15)),
    true,
  );
});

check("an empty history never spans a year", () => {
  assert.strictEqual(m.historySpansAYear([], new Date(2025, 5, 15)), false);
});

check("earliestMonthKey finds the oldest bucket or null", () => {
  assert.strictEqual(
    m.earliestMonthKey([bucket("2024-06", 1, 1), bucket("2023-01", 1, 1)]),
    "2023-01",
  );
  assert.strictEqual(m.earliestMonthKey([]), null);
});

// --- labels -----------------------------------------------------------------

check("yearsAgoLabel singular/plural and both languages", () => {
  assert.strictEqual(m.yearsAgoLabel(1, "en"), "1 year ago");
  assert.strictEqual(m.yearsAgoLabel(3, "en"), "3 years ago");
  assert.strictEqual(m.yearsAgoLabel(1, "fa"), "یک سال پیش");
  assert.strictEqual(m.yearsAgoLabel(2, "fa"), "2 سال پیش");
});

// --- DST / date arithmetic --------------------------------------------------

check("a leap day anniversary still resolves", () => {
  const memories = m.findYearlyMemories(
    [bucket("2024-02", 29, 3_600_000)],
    new Date(2025, 1, 28), // 2025 has no Feb 29
  );
  assert.strictEqual(memories.length, 1);
  assert.strictEqual(memories[0].yearsAgo, 1);
});

check("a day-number diff survives a DST boundary", () => {
  // March 25 sits on a US DST transition; wall-clock math would be off by an
  // hour and could round to the wrong year.
  const memories = m.findYearlyMemories(
    [bucket("2024-03", 25, 3_600_000)],
    new Date(2025, 2, 25),
  );
  assert.strictEqual(memories.length, 1);
  assert.strictEqual(memories[0].yearsAgo, 1);
});

// --- wiring contract --------------------------------------------------------

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

check("the memory loader reads buckets without forcing a flush", () => {
  const stats = readFile("utils/listeningStats.ts");
  const fn = stats.slice(stats.indexOf("export async function loadMemoryMonths"));
  assert.ok(
    !fn.slice(0, 1200).includes("flushListeningStats"),
    "reading a screen must not write storage as a side effect",
  );
  assert.ok(fn.includes("readBucket("));
});

check("the replay screen hides the section when no memories exist", () => {
  const screen = readFile("components/screens/ReplayScreen.tsx");
  assert.ok(screen.includes("historySpansAYear(months, new Date())"));
  assert.ok(
    screen.includes("(memories ?? []).length > 0"),
    "an empty list must not render an empty Memories header",
  );
});

check("a memory is playable as a queue", () => {
  const screen = readFile("components/screens/ReplayScreen.tsx");
  assert.ok(
    screen.includes("playTrack(memory.tracks[0], memory.tracks, 0)"),
    "a throwback must become a playable queue, not a dead row",
  );
});

check("the home card is conditional and does not claim the day total per track", () => {
  const home = readFile("components/screens/HomeScreen.tsx");
  assert.ok(home.includes("homeMemories.length > 0 && homeMemories[0].tracks.length > 0"));
  assert.ok(home.includes("loadMemoryMonths"));
});

check("both locales carry the memory labels", () => {
  for (const file of ["locales/en.json", "locales/fa.json"]) {
    const locale = JSON.parse(readFile(file));
    assert.ok(locale["replay.memories"], `${file} missing replay.memories`);
    assert.ok(locale["home.onThisDay"], `${file} missing home.onThisDay`);
  }
});

// --- report -----------------------------------------------------------------

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`PASS ${r.name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${r.name}\n     ${r.error}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
