/**
 * Smart playlist regression tests (issue #39).
 *
 * The rule engine and its helpers are transpiled from TypeScript and driven at
 * runtime under Node, so the assertions exercise real matching behaviour rather
 * than file contents. The storage/UI wiring is checked as a contract, since
 * those modules pull in react-native.
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
    `smart-${path.basename(rel).replace(/\W/g, "_")}-${Date.now()}.cjs`,
  );
  fs.writeFileSync(file, js);
  const mod = require(file);
  fs.unlinkSync(file);
  return mod;
}

const sp = loadModule("modules/smartPlaylists.ts");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

function track(overrides) {
  return {
    id: "t1",
    title: "Song",
    plays: 0,
    isLiked: false,
    ...overrides,
  };
}

// --- rule matching -----------------------------------------------------------

check("plays gte matches only tracks at or above the threshold", () => {
  const rule = { field: "plays", operator: "gte", value: 5 };
  assert.strictEqual(sp.matchRule(track({ plays: 5 }), rule), true);
  assert.strictEqual(sp.matchRule(track({ plays: 4 }), rule), false);
});

check("a non-numeric value on a numeric field never matches", () => {
  // Guards the text-input path: '' must not coerce to 0 and match everything.
  const rule = { field: "plays", operator: "gte", value: "" };
  assert.strictEqual(sp.matchRule(track({ plays: 100 }), rule), false);
});

check("a track never played counts as the most forgotten for gte", () => {
  const rule = { field: "lastPlayedDaysAgo", operator: "gte", value: 30 };
  assert.strictEqual(sp.matchRule(track({}), rule), true);
});

check("a track never played does NOT satisfy an lte recency rule", () => {
  const rule = { field: "lastPlayedDaysAgo", operator: "lte", value: 7 };
  assert.strictEqual(sp.matchRule(track({}), rule), false);
});

check("missing added-date data fails closed for lte and gte", () => {
  assert.strictEqual(
    sp.matchRule(track({}), { field: "addedDaysAgo", operator: "lte", value: 7 }),
    false,
  );
  assert.strictEqual(
    sp.matchRule(track({}), { field: "addedDaysAgo", operator: "gte", value: 7 }),
    false,
  );
});

check("isLiked only matches on equals with a boolean", () => {
  assert.strictEqual(
    sp.matchRule(track({ isLiked: true }), {
      field: "isLiked",
      operator: "equals",
      value: true,
    }),
    true,
  );
  assert.strictEqual(
    sp.matchRule(track({ isLiked: true }), {
      field: "isLiked",
      operator: "contains",
      value: true,
    }),
    false,
  );
});

check("text rules are case-insensitive and support negation", () => {
  const t = track({ artist: "Pink Floyd", source: "Subsonic" });
  assert.strictEqual(
    sp.matchRule(t, { field: "artist", operator: "contains", value: "pink" }),
    true,
  );
  assert.strictEqual(
    sp.matchRule(t, {
      field: "source",
      operator: "notContains",
      value: "jiosaavn",
    }),
    true,
  );
});

check("AND requires every rule; OR requires any", () => {
  const t = track({ plays: 10, isLiked: false });
  const rules = [
    { field: "plays", operator: "gte", value: 5 },
    { field: "isLiked", operator: "equals", value: true },
  ];
  assert.strictEqual(sp.matchRules(t, rules, "and"), false);
  assert.strictEqual(sp.matchRules(t, rules, "or"), true);
});

check("an empty rule list matches nothing, not everything", () => {
  assert.strictEqual(sp.matchRules(track({ plays: 99 }), [], "and"), false);
  assert.strictEqual(sp.matchRules(track({ plays: 99 }), [], "or"), false);
});

// --- resolution --------------------------------------------------------------

check("results are capped by the definition limit", () => {
  const pool = Array.from({ length: 80 }, (_, i) =>
    track({ id: `t${i}`, title: `Song ${i}`, plays: 10 }),
  );
  const out = sp.resolveSmartPlaylist(
    { id: "s", name: "S", chain: "and", limit: 5, rules: [{ field: "plays", operator: "gte", value: 1 }] },
    pool,
  );
  assert.strictEqual(out.length, 5);
});

check("a zero or missing limit falls back instead of matching everything", () => {
  const pool = Array.from({ length: 60 }, (_, i) =>
    track({ id: `t${i}`, title: `S${i}`, plays: 1 }),
  );
  const out = sp.resolveSmartPlaylist(
    { id: "s", name: "S", chain: "and", limit: 0, rules: [{ field: "plays", operator: "gte", value: 1 }] },
    pool,
  );
  assert.strictEqual(out.length, 50);
});

check("results are ordered by plays, then title", () => {
  const pool = [
    track({ id: "a", title: "Beta", plays: 1 }),
    track({ id: "b", title: "Alpha", plays: 9 }),
    track({ id: "c", title: "Alpha", plays: 1 }),
  ];
  const out = sp.resolveSmartPlaylist(
    { id: "s", name: "S", chain: "and", limit: 50, rules: [{ field: "plays", operator: "gte", value: 1 }] },
    pool,
  );
  assert.deepStrictEqual(
    out.map((t) => t.id),
    ["b", "c", "a"],
  );
});

check("the same input always yields the same order", () => {
  const pool = [
    track({ id: "x", title: "Same", plays: 2 }),
    track({ id: "y", title: "Same", plays: 2 }),
  ];
  const def = { id: "s", name: "S", chain: "and", limit: 50, rules: [{ field: "plays", operator: "gte", value: 1 }] };
  assert.deepStrictEqual(
    sp.resolveSmartPlaylist(def, pool).map((t) => t.id),
    sp.resolveSmartPlaylist(def, pool).map((t) => t.id),
  );
});

// --- helpers -----------------------------------------------------------------

check("daysAgoFrom floors whole days and ignores bad input", () => {
  const now = 1_700_000_000_000;
  assert.strictEqual(sp.daysAgoFrom(now - 86_400_000 * 3 - 1000, now), 3);
  assert.strictEqual(sp.daysAgoFrom(now, now), 0);
  assert.strictEqual(sp.daysAgoFrom(null, now), undefined);
  assert.strictEqual(sp.daysAgoFrom(0, now), undefined);
  assert.strictEqual(sp.daysAgoFrom(Number.NaN, now), undefined);
});

check("a future stamp reads as today, never a negative age", () => {
  const now = 1_700_000_000_000;
  assert.strictEqual(sp.daysAgoFrom(now + 86_400_000 * 5, now), 0);
});

// --- sanitizer ---------------------------------------------------------------

check("a stored definition with an unknown field drops that rule", () => {
  const out = sp.sanitizeSmartPlaylist(
    {
      name: "Mixed",
      chain: "and",
      rules: [
        { field: "genre", operator: "equals", value: "rock" },
        { field: "plays", operator: "gte", value: 5 },
      ],
    },
    "fallback",
  );
  assert.ok(out);
  assert.strictEqual(out.rules.length, 1);
  assert.strictEqual(out.rules[0].field, "plays");
});

check("an operator the field does not support drops the rule", () => {
  const out = sp.sanitizeSmartPlaylist(
    { name: "Bad", rules: [{ field: "isLiked", operator: "gte", value: 1 }] },
    "fallback",
  );
  assert.strictEqual(out, null);
});

check("a definition with no usable rules is null, not match-all", () => {
  assert.strictEqual(sp.sanitizeSmartPlaylist({ rules: [] }, "f"), null);
  assert.strictEqual(sp.sanitizeSmartPlaylist(null, "f"), null);
  assert.strictEqual(sp.sanitizeSmartPlaylist("nonsense", "f"), null);
});

check("the sanitizer restores a usable definition with its id and chain", () => {
  const out = sp.sanitizeSmartPlaylist(
    {
      id: "smart-1",
      name: "  Keep me  ",
      chain: "or",
      limit: 12.7,
      rules: [{ field: "plays", operator: "gte", value: 2 }],
    },
    "fallback",
  );
  assert.strictEqual(out.id, "smart-1");
  assert.strictEqual(out.name, "Keep me");
  assert.strictEqual(out.chain, "or");
  assert.strictEqual(out.limit, 12);
});

check("an out-of-range limit is clamped to at least one", () => {
  const out = sp.sanitizeSmartPlaylist(
    { name: "X", limit: 0, rules: [{ field: "plays", operator: "gte", value: 1 }] },
    "f",
  );
  assert.strictEqual(out.limit, 1);
});

// --- storage / UI wiring contract -------------------------------------------

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

check("the added-date store is stamped at the liked and history write sites", () => {
  const storage = readFile("utils/storage.ts");
  const liked = storage.slice(storage.indexOf("async saveLikedSongs"));
  assert.ok(
    liked.slice(0, 700).includes("noteTrackAdded("),
    "saveLikedSongs must stamp added-dates",
  );
  const history = storage.slice(storage.indexOf("async savePreviouslyPlayedSongs"));
  assert.ok(
    history.slice(0, 700).includes("noteTrackAdded("),
    "savePreviouslyPlayedSongs must stamp added-dates",
  );
});

check("added-date stamping never overwrites an existing stamp", () => {
  const storage = readFile("utils/storage.ts");
  const fn = storage.slice(storage.indexOf("async function noteTrackAdded"));
  assert.ok(
    fn.slice(0, 900).includes("if (map.has(key)) continue;"),
    "an existing stamp must be kept, so re-liking does not look new",
  );
});

check("Playlist carries the optional smart definition", () => {
  const storage = readFile("utils/storage.ts");
  const iface = storage.slice(
    storage.indexOf("export interface Playlist"),
    storage.indexOf("export interface Playlist") + 700,
  );
  assert.ok(iface.includes("smartDefinition?: SmartPlaylistDefinition"));
});

check("a stored definition is sanitized when a playlist is loaded", () => {
  const storage = readFile("utils/storage.ts");
  const normalizer = storage.slice(
    storage.indexOf("function normalizePlaylistSnapshot"),
    storage.indexOf("function normalizePlaylistSnapshot") + 1400,
  );
  assert.ok(
    normalizer.includes("sanitizeSmartPlaylist(playlist.smartDefinition, id)"),
    "loadPlaylists must not trust a stored definition",
  );
});

check("the album screen resolves a smart playlist instead of its cached tracks", () => {
  const screen = readFile("components/screens/AlbumPlaylistScreen.tsx");
  assert.ok(
    screen.includes("playlist.smartDefinition") &&
      screen.includes("resolveSmartPlaylistTracks("),
    "opening a smart playlist must re-resolve its rules",
  );
});

check("the album screen refuses manual reorder and removal on a smart list", () => {
  const screen = readFile("components/screens/AlbumPlaylistScreen.tsx");
  const guards = screen.split("isSmartPlaylist").length - 1;
  assert.ok(
    guards >= 3,
    `expected a state flag plus both guards, found ${guards} references`,
  );
});

check("the library screen resolves rules on press and persists a definition", () => {
  const screen = readFile("components/screens/LibraryScreen.tsx");
  assert.ok(screen.includes("resolveSmartPlaylistTracks("));
  assert.ok(screen.includes("smartDefinition: smartDraft"));
  assert.ok(
    screen.includes("describeSmartPlaylist("),
    "the saved description should summarize the rules",
  );
});

check("the smart builder is reachable and its modal is rendered", () => {
  const screen = readFile("components/screens/LibraryScreen.tsx");
  assert.ok(
    screen.includes("setSmartDraft({") && screen.includes("<SmartPlaylistModal"),
    "a builder entry point plus its modal must both exist",
  );
});

check("the builder cannot save without a name and at least one rule", () => {
  const modal = readFile("components/SmartPlaylistModal.tsx");
  assert.ok(
    modal.includes("const canSubmit = name.length > 0 && definition.rules.length > 0;"),
    "an empty rule list would create a playlist that matches nothing",
  );
});

check("changing a field keeps only operators that field supports", () => {
  const modal = readFile("components/SmartPlaylistModal.tsx");
  assert.ok(
    modal.includes("supported.includes(definition.rules[index].operator)"),
    "the operator must be revalidated against the new field",
  );
});

// --- report ------------------------------------------------------------------

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
