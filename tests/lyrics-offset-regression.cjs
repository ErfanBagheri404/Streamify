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

// --- report ------------------------------------------------------------------
Promise.all(pending).then(() => {
  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) {
    console.log(line);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
});
