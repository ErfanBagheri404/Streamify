/**
 * Synced-lyrics offset regression tests (issue #37).
 *
 * Units: `modules/lyricsOffset.ts` (storage + application) and `findActiveLyricIndex`
 * path are transpiled and driven at runtime under Node; UI wiring is asserted
 * statically.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const results = [];
const pending = [];
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      pending.push(
        out.then(
          () => results.push(`PASS ${name}`),
          (e) => results.push(`FAIL ${name}: ${e.message}`),
        ),
      );
    } else {
      results.push(`PASS ${name}`);
    }
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

const ts = require(path.join(root, "node_modules", "typescript"));

// AsyncStorage cannot run under Node (it touches `window`), so its specifier
// is rewritten to an in-memory stub at transpile time. Resolution-key tricks
// in require.cache do not survive Node's path normalisation on Windows.
const stubPath = path.join(root, "tests", "helpers", "asyncStorageStub.js");
// The TS transpile of `import AsyncStorage from "…"` lowers to
// `const async_storage_1 = require("…")`, so rewrite on the bare path.
const ASYNC_STORAGE_SPECIFIER =
  /require\("@react-native-async-storage\/async-storage"\)/;

function loadModule(rel) {
  const src = read(...rel.split("/"));
  const js = ts
    .transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    })
    .outputText.replace(
      ASYNC_STORAGE_SPECIFIER,
      `require(${JSON.stringify(stubPath)})`,
    );
  const mod = new module.constructor();
  mod.paths = module.paths;
  mod._compile(
    js,
    path.join(
      root,
      ...rel.split("/").slice(0, -1),
      rel.split("/").pop().replace(/\.ts$/, ".js"),
    ),
  );
  return mod.exports;
}

const storageStub = require(stubPath);

const off = loadModule("modules/lyricsOffset.ts");
const sharedSrc = read("modules", "lyricsShared.ts");
const sharedJs = ts.transpileModule(sharedSrc, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const sharedMod = new module.constructor();
sharedMod.paths = module.paths;
sharedMod._compile(
  sharedJs,
  path.join(root, "modules", "lyricsShared.js"),
);
const { buildTimedLyrics, findActiveLyricIndex } = sharedMod.exports;

// --- get/set/clear -----------------------------------------------------------
// One sequential check, not four: these share a module-level cache, so letting
// them interleave would let the corrupt-storage reset (below) wipe state
// another check is mid-read on.
check("offset storage round-trips, clears, clamps and survives corruption", async () => {
  assert.strictEqual(await off.getLyricsOffset("t1"), 0);
  assert.strictEqual(await off.setLyricsOffset("t1", 2.34), 2.3);
  assert.strictEqual(await off.getLyricsOffset("t1"), 2.3);
  assert.strictEqual(await off.getLyricsOffset("other-track"), 0);

  await off.setLyricsOffset("t2", 1.5);
  assert.strictEqual(await off.getLyricsOffset("t2"), 1.5);
  assert.strictEqual(await off.setLyricsOffset("t2", 0), 0);
  assert.strictEqual(await off.getLyricsOffset("t2"), 0);
  await off.clearLyricsOffset("t2");
  assert.strictEqual(await off.getLyricsOffset("t2"), 0);

  assert.strictEqual(await off.setLyricsOffset("t3", 99), 10);
  assert.strictEqual(await off.setLyricsOffset("t4", -99), -10);
  assert.strictEqual(await off.setLyricsOffset("t5", 1.26), 1.3);

  storageStub.__store.set("@lyrics_sync_offsets", "{not json");
  off.__resetLyricsOffsetCache();
  assert.strictEqual(await off.getLyricsOffset("t1"), 0);
  storageStub.__store.delete("@lyrics_sync_offsets");
  off.__resetLyricsOffsetCache();

  // An overfull table must still keep the nudge the user just made. This is
  // reachable: a table written before the cap existed can already hold more
  // than 500 entries, and eviction deletes from the front of insertion order —
  // which is exactly where a re-nudged older track sits.
  const full = {};
  for (let i = 0; i < 501; i += 1) full[`old-${i}`] = 1.5;
  storageStub.__store.set("@lyrics_sync_offsets", JSON.stringify(full));
  off.__resetLyricsOffsetCache();
  assert.strictEqual(await off.setLyricsOffset("old-0", 3), 3);
  assert.strictEqual(
    await off.getLyricsOffset("old-0"),
    3,
    "the just-written offset was evicted",
  );
  storageStub.__store.delete("@lyrics_sync_offsets");
  off.__resetLyricsOffsetCache();
});

check("applyLyricsOffset never returns a negative position or NaN", () => {
  assert.strictEqual(off.applyLyricsOffset(1, -5), 0);
  assert.strictEqual(off.applyLyricsOffset(0, -10), 0);
  assert.strictEqual(off.applyLyricsOffset(Number.NaN, 2), 0);
  assert.strictEqual(off.applyLyricsOffset(5, Number.NaN), 5);
  assert.strictEqual(off.applyLyricsOffset(10, 2), 12);
});

check("common.save exists in en AND fa (the nudge sheet's apply button)", () => {
  const en = JSON.parse(read("locales", "en.json"));
  const fa = JSON.parse(read("locales", "fa.json"));
  // translate() resolves a dotted key against the nested object first and the
  // flat map second; en/fa.json carry `common.save` under `common`, so read it
  // the same way the app does rather than indexing the flat map.
  const valueOf = (dict, key) => {
    const nested = key
      .split(".")
      .reduce((cur, part) => (cur && typeof cur === "object" ? cur[part] : undefined), dict);
    return typeof nested === "string" ? nested : dict[key];
  };
  assert.ok(valueOf(en, "common.save") && valueOf(en, "common.save").trim(), "en missing common.save");
  assert.ok(valueOf(fa, "common.save") && valueOf(fa, "common.save").trim(), "fa missing common.save");
  assert.notStrictEqual(valueOf(fa, "common.save"), valueOf(en, "common.save"), "fa is an English copy");
});

// --- applyLyricsOffset -------------------------------------------------------
check("applyLyricsOffset shifts the lookup position by exactly the nudge", () => {
  assert.strictEqual(off.applyLyricsOffset(10, 2), 12);
  assert.strictEqual(off.applyLyricsOffset(10, -2), 8);
  assert.strictEqual(off.applyLyricsOffset(0, 0), 0);
});

check("a +2s offset moves the active line back by one line", () => {
  const lrc = ["[00:01.00]one", "[00:05.00]two", "[00:09.00]three"].join("\n");
  const timed = buildTimedLyrics(lrc, 20);
  assert.strictEqual(timed.length, 3);
  // At 7.2s we are on "two"; the file runs 2s late, so asking at 9.2s picks
  // "three". (findActiveLyricIndex lets a line overlap its successor by 0.1s,
  // so the boundary must be crossed cleanly rather than sitting on it.)
  assert.strictEqual(findActiveLyricIndex(timed, 7.2), 1);
  assert.strictEqual(
    findActiveLyricIndex(timed, off.applyLyricsOffset(7.2, 2)),
    2,
  );
});

// --- UI wiring ---------------------------------------------------------------
const modal = read("components", "FullPlayerModal.tsx");

check("the modal applies the stored offset to the active lyric lookup", () => {
  assert.ok(
    modal.includes("applyLyricsOffset("),
    "active index computed without offset",
  );
  assert.ok(
    modal.includes("lyricsOffsetSeconds"),
    "no offset state in the modal",
  );
});

check("the modal loads the per-track offset on track change", () => {
  assert.ok(
    modal.includes("getLyricsOffset("),
    "stored offset never loaded",
  );
});

check("the offset sheet persists through setLyricsOffset and offers reset", () => {
  assert.ok(
    modal.includes("setLyricsOffset("),
    "nudge never persisted",
  );
  assert.ok(
    modal.includes("clearLyricsOffset("),
    "no reset path",
  );
  assert.ok(
    modal.includes("showLyricsOffsetSheet"),
    "no nudge sheet state",
  );
  assert.ok(
    modal.includes("MAX_LYRICS_OFFSET_SECONDS"),
    "bounds constant not enforced in UI",
  );
});

check("tap-to-seek inverts the offset", () => {
  assert.ok(
    /line\.startTime\s*-\s*lyricsOffsetSeconds/.test(modal),
    "tap-to-seek seeks to the authored time, not the nudged position",
  );
});

// --- applyLyricsOffset arithmetic -------------------------------------------

check("applyLyricsOffset keeps fractional positions and rejects infinities", () => {
  assert.ok(Math.abs(off.applyLyricsOffset(7.2, 2) - 9.2) < 1e-9, `got ${off.applyLyricsOffset(7.2, 2)}`);
  assert.strictEqual(
    off.applyLyricsOffset(Number.POSITIVE_INFINITY, 2),
    0,
    "an infinite position is meaningless",
  );
  assert.strictEqual(
    off.applyLyricsOffset(5, Number.POSITIVE_INFINITY),
    5,
    "an infinite offset must not move the position",
  );
  assert.strictEqual(off.applyLyricsOffset(Number.NaN, Number.NaN), 0);
});

// --- late sequential scenarios ----------------------------------------------
// The first async check above shares the module-level cache and rewrites the
// storage key; these additions run after it finishes so they cannot interleave
// with its resets. Same rule, separate harness so a failing assertion in one
// scenario does not hide the others.

async function runLateScenarios() {
  async function seqCheck(name, fn) {
    try {
      await fn();
      results.push(`PASS ${name}`);
    } catch (e) {
      results.push(`FAIL ${name}: ${e.message}`);
    }
  }

  await seqCheck("writes clamp to the published min/max and round to a tenth", async () => {
    assert.strictEqual(await off.setLyricsOffset("n1", 10), 10, "+max boundary");
    assert.strictEqual(await off.setLyricsOffset("n1", 10.4), 10);
    assert.strictEqual(await off.setLyricsOffset("n1", 10.6), 10);
    assert.strictEqual(await off.setLyricsOffset("n2", -10), -10, "-max boundary");
    assert.strictEqual(await off.setLyricsOffset("n2", -10.4), -10);
    assert.strictEqual(await off.setLyricsOffset("n2", -10.6), -10);
    assert.strictEqual(await off.setLyricsOffset("n3", 1.25), 1.3);
    assert.strictEqual(await off.setLyricsOffset("n4", -1.25), -1.2);
    assert.strictEqual(await off.getLyricsOffset("n4"), -1.2);
  });

  await seqCheck("a non-numeric offset is rejected instead of stored as NaN", async () => {
    // applyLyricsOffset and readStored both fail closed on non-finite input;
    // setLyricsOffset must do the same instead of persisting NaN into JSON.
    assert.strictEqual(
      await off.setLyricsOffset("bad", Number.NaN),
      0,
      "a NaN write must not be persisted",
    );
    assert.strictEqual(await off.getLyricsOffset("bad"), 0, "a NaN offset leaked into the stored table");
    assert.strictEqual(await off.setLyricsOffset("bad", undefined), 0);
    assert.strictEqual(await off.getLyricsOffset("bad"), 0);
    assert.strictEqual(
      await off.setLyricsOffset("bad", "2.5"),
      2.5,
      "a numeric string is a usable nudge",
    );
    assert.strictEqual(await off.getLyricsOffset("bad"), 2.5);
  });

  await seqCheck("a stored table is clamped and filtered on read", async () => {
    storageStub.__store.set(
      "@lyrics_sync_offsets",
      JSON.stringify({ hi: 999, lo: -999, ok: 3, zero: 0, str: "4", bad: null, missing: NaN }),
    );
    off.__resetLyricsOffsetCache();
    assert.strictEqual(await off.getLyricsOffset("hi"), 10, "an over-max value must clamp");
    assert.strictEqual(await off.getLyricsOffset("lo"), -10, "an under-min value must clamp");
    assert.strictEqual(await off.getLyricsOffset("ok"), 3);
    assert.strictEqual(await off.getLyricsOffset("zero"), 0, "a zero is not a correction");
    assert.strictEqual(await off.getLyricsOffset("str"), 0, "a non-number must be dropped");
    assert.strictEqual(await off.getLyricsOffset("bad"), 0, "a null must be dropped");
    storageStub.__store.delete("@lyrics_sync_offsets");
    off.__resetLyricsOffsetCache();
  });

  await seqCheck("clearing and reading a missing or empty id is harmless", async () => {
    await off.clearLyricsOffset("never-stored");
    await off.clearLyricsOffset("");
    assert.strictEqual(await off.getLyricsOffset(""), 0, "an empty id has no offset");
    assert.strictEqual(await off.getLyricsOffset(undefined), 0, "a missing id has no offset");
    storageStub.__store.delete("@lyrics_sync_offsets");
    off.__resetLyricsOffsetCache();
  });

  await seqCheck("the tracked-offset table stays capped at 500 entries", async () => {
    for (let i = 0; i < 502; i += 1) {
      await off.setLyricsOffset(`cap-${i}`, 1);
    }
    const stored = JSON.parse(storageStub.__store.get("@lyrics_sync_offsets"));
    assert.strictEqual(
      Object.keys(stored).length,
      500,
      `expected the table capped at 500, got ${Object.keys(stored).length}`,
    );
    assert.ok("cap-501" in stored, "the newest nudge must survive");
    assert.ok(!("cap-0" in stored), "the oldest entries must be evicted");
    assert.strictEqual(await off.getLyricsOffset("cap-501"), 1);
    storageStub.__store.delete("@lyrics_sync_offsets");
    off.__resetLyricsOffsetCache();
  });
}

// --- report ------------------------------------------------------------------
Promise.all(pending).then(async () => {
  await runLateScenarios();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) {
    console.log(line);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
});
