/**
 * AI Mix (issue #49) regression suite.
 *
 * `modules/aiMixBuilder.ts` is pure (no React, no storage, no native), so it
 * is transpiled and driven for real in Node: build mixes from synthetic
 * history + library and assert the mix shape. The playlist persistence and
 * the UI trigger are contract-checked.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const scratchDir = process.env.TMPDIR || os.tmpdir();

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
function loadPureModule(rel, requireRewrites = []) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  // Emitted requires resolve relative to the scratch file, never the repo,
  // so any sibling import must be rewritten here rather than left to Node.
  for (const [from, to] of requireRewrites) js = js.split(from).join(to);
  const out = path.join(
    scratchDir,
    `aimix-${process.pid}-${rel.replace(/[\\/]/g, "_")}.cjs`,
  );
  fs.writeFileSync(out, js);
  try {
    return require(out);
  } finally {
    fs.unlinkSync(out);
  }
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// aiMixBuilder imports only the pure scorer (buildSmartQueue) from
// aiPlaylistService. That module pulls in AsyncStorage at require time, so
// its storage imports are rewritten to an empty module, it is emitted to a
// stable scratch path, and the builder's sibling require is pointed there.
// The builder needs buildSmartQueue from aiPlaylistService, but that module
// pulls in AsyncStorage at require time and cannot load in Node. Rather than
// rewire requires, inject the pure scorer into the builder: emit the builder
// with a `require` that returns the real scorer module, and stub the two
// imports it does not need.
const scorerJs2 = ts.transpileModule(read("modules/aiPlaylistService.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const scorer = { exports: {} };
const scorerModule = { exports: scorer.exports };
new Function("require", "module", "exports", scorerJs2)(
  (id) => {
    if (id.includes("aiPlaylistService")) return scorerModule.exports;
    return {};
  },
  scorerModule,
  scorer.exports,
);
const buildSmartQueue = scorerModule.exports.buildSmartQueue;
assert.strictEqual(typeof buildSmartQueue, "function", "scorer stub failed");

const builderJs2 = ts.transpileModule(read("modules/aiMixBuilder.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const builderModule = { exports: {} };
new Function("require", "module", "exports", builderJs2)(
  (id) => {
    if (id.includes("aiPlaylistService")) return scorerModule.exports;
    return {};
  },
  builderModule,
  builderModule.exports,
);
const builder = builderModule.exports;
assert.strictEqual(
  typeof builder.buildAiMixPicks,
  "function",
  "builder stub failed",
);

const playerModal = stripComments(read("components/FullPlayerModal.tsx"));
const libraryScreen = (() => {
  try {
    return stripComments(read("components/screens/LibraryScreen.tsx"));
  } catch {
    return "";
  }
})();
const storage = stripComments(read("utils/storage.ts"));
const builderFile = stripComments(read("modules/aiMixBuilder.ts"));

/** Synthetic library: 30 tracks across 5 artists, 3 albums. */
function makeLibrary() {
  const lib = [];
  const artists = ["Nova Rey", "Glass Harbor", "Mono Bloom", "Cedar Line", "Vanta Kids"];
  for (let i = 0; i < 30; i += 1) {
    const artist = artists[i % artists.length];
    lib.push({
      id: `track-${i}`,
      title: `Song ${i} about the ${["sea", "night", "road", "light", "rain"][i % 5]}`,
      artist,
      album: `Album ${Math.floor(i / 10)}`,
      source: "local",
    });
  }
  return lib;
}

/** Synthetic summary: first 5 tracks heavily played, artists 0-1 on top. */
function makeSummary(lib) {
  return {
    period: "alltime",
    totalMs: 10_000_000,
    totalPlays: 200,
    topTracks: lib.slice(0, 5).map((t, i) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      ms: 1_000_000 - i * 100_000,
      plays: 40 - i * 5,
    })),
    topArtists: [
      { name: "Nova Rey", ms: 4_000_000, plays: 100 },
      { name: "Glass Harbor", ms: 3_000_000, plays: 70 },
    ],
    topAlbums: [{ name: "Album 0", ms: 5_000_000, plays: 120 }],
    hours: new Array(24).fill(0),
  };
}

function playCounts(lib) {
  const map = new Map();
  lib.slice(0, 5).forEach((t, i) => map.set(t.id, 40 - i * 5));
  return map;
}

const runtimeChecks = [
  [
    "the mix reaches its size when the library allows",
    () => {
      const lib = makeLibrary();
      const picks = builder.buildAiMixPicks({
        summary: makeSummary(lib),
        library: lib,
        playCounts: playCounts(lib),
        size: 25,
      });
      assert.strictEqual(picks.length, 25);
    },
  ],
  [
    "no song appears twice, even across sources",
    () => {
      const lib = makeLibrary();
      // A duplicate of track-0 under a different id but same title+artist.
      lib.push({ ...lib[0], id: "track-0-dup" });
      const picks = builder.buildAiMixPicks({
        summary: makeSummary(lib),
        library: lib,
        playCounts: playCounts(lib),
        size: 25,
      });
      const keys = picks.map((p) =>
        `${p.track.title}|${p.track.artist}`.toLowerCase(),
      );
      assert.strictEqual(new Set(keys).size, keys.length);
    },
  ],
  [
    "every pick is a playable library track, never a stats stub",
    () => {
      const lib = makeLibrary();
      const libIds = new Set(lib.map((t) => t.id));
      const picks = builder.buildAiMixPicks({
        summary: makeSummary(lib),
        library: lib,
        playCounts: playCounts(lib),
        size: 25,
      });
      for (const p of picks) {
        assert.ok(libIds.has(p.track.id), `${p.track.id} is a stats stub`);
        assert.ok(p.track.title, "pick has no title");
      }
    },
  ],
  [
    "top artists surface beyond the top tracks (deep cuts)",
    () => {
      const lib = makeLibrary();
      const picks = builder.buildAiMixPicks({
        summary: makeSummary(lib),
        library: lib,
        playCounts: playCounts(lib),
        size: 25,
      });
      const topTrackIds = new Set(lib.slice(0, 5).map((t) => t.id));
      const deep = picks.filter(
        (p) =>
          p.source === "deep-cut" ||
          (["nova rey", "glass harbor"].includes(
            String(p.track.artist).toLowerCase(),
          ) &&
            !topTrackIds.has(p.track.id)),
      );
      assert.ok(deep.length > 0, "no deep cuts from top artists");
    },
  ],
  [
    "the mix is deterministic for the same inputs",
    () => {
      const lib = makeLibrary();
      const input = {
        summary: makeSummary(lib),
        library: lib,
        playCounts: playCounts(lib),
        size: 25,
      };
      const a = builder.buildAiMixPicks(input).map((p) => p.track.id);
      const b = builder.buildAiMixPicks(input).map((p) => p.track.id);
      assert.deepStrictEqual(a, b);
    },
  ],
  [
    "a small library yields a partial mix, never ghosts",
    () => {
      const lib = makeLibrary().slice(0, 4);
      const picks = builder.buildAiMixPicks({
        summary: makeSummary(lib),
        library: lib,
        playCounts: playCounts(lib),
        size: 25,
      });
      assert.ok(picks.length <= 4, `got ${picks.length} picks from 4 tracks`);
      const libIds = new Set(lib.map((t) => t.id));
      for (const p of picks) assert.ok(libIds.has(p.track.id));
    },
  ],
  [
    "an empty library yields nothing",
    () => {
      const picks = builder.buildAiMixPicks({
        summary: makeSummary(makeLibrary()),
        library: [],
        playCounts: new Map(),
        size: 25,
      });
      assert.deepStrictEqual(picks, []);
    },
  ],
  [
    "deleted songs anchor similarity but are never picked",
    () => {
      // Summary references tracks that no longer exist in the library.
      const lib = makeLibrary().slice(5);
      const picks = builder.buildAiMixPicks({
        summary: makeSummary(makeLibrary()),
        library: lib,
        playCounts: new Map(),
        size: 10,
      });
      const libIds = new Set(lib.map((t) => t.id));
      for (const p of picks) {
        assert.ok(libIds.has(p.track.id), `${p.track.id} is a ghost`);
      }
    },
  ],
];

const wiringChecks = [
  [
    "the mix is persisted under a stable id, in place",
    () => {
      const service = stripComments(read("modules/aiMixService.ts"));
      // The literal id expression matters: a Date.now() id keeps every other
      // line intact while piling a new row per tap.
      assert.ok(/id: AI_MIX_PLAYLIST_ID,/.test(service), "the playlist id is not the stable constant");
      assert.ok(/updatePlaylist\(playlist\)/.test(service), "regeneration does not update in place");
      assert.ok(/addPlaylist\(playlist\)/.test(service), "a first mix is never created");
      assert.ok(/createdAt: existing\?\.createdAt/.test(service), "createdAt is reset on every regeneration");
    },
  ],
  [
    "the library pins the mix above user playlists",
    () => {
      // pinOrder must be attached to the mix entry itself, not merely exist
      // somewhere else in the file (the sort comparator mentions it too).
      const idx = libraryScreen.indexOf("playlist.id === AI_MIX_PLAYLIST_ID");
      assert.ok(idx >= 0, "the library never recognises the mix");
      const window = libraryScreen.slice(idx, idx + 600);
      assert.ok(/pinOrder: 4/.test(window), "the mix entry carries no pin");
    },
  ],
  [
    "the sparkle trigger lives in the player menu",
    () => {
      assert.ok(/AI_MIX_OPTION_KEY/.test(playerModal), "no menu entry");
      // Menu key and handler must be the same constant, or the tap is dead.
      // Counting occurrences is not enough: a literal menu key keeps the
      // import and the handler intact while the tap goes nowhere.
      assert.ok(/key: AI_MIX_OPTION_KEY,/.test(playerModal), "the menu entry does not use the shared key");
      assert.ok(/option === AI_MIX_OPTION_KEY/.test(playerModal), "the handler does not use the shared key");
      assert.ok(/isGeneratingAiMix/.test(playerModal), "no in-progress state");
    },
  ],
  [
    "stored streams are not persisted with the mix",
    () => {
      const service = stripComments(read("modules/aiMixService.ts"));
      // Resolved stream URLs go stale; playTrack re-resolves on demand.
      assert.ok(/audioUrl: undefined/.test(service), "the mix stores resolved stream URLs");
    },
  ],
  [
    "the builder stays free of storage and native imports",
    () => {
      ["AsyncStorage", "expo-file-system", "expo-image-manipulator", "react-native", "react"].forEach((dep) => {
        assert.ok(!builderFile.includes(dep), `aiMixBuilder.ts drags in ${dep}`);
      });
      assert.ok(!/loadReplaySummary/.test(builderFile), "the builder reads stats itself instead of taking play counts");
    },
  ],
  [
    "generation cannot throw into the UI",
    () => {
      const service = stripComments(read("modules/aiMixService.ts"));
      const catchBlock = service.slice(service.indexOf("} catch"));
      // A catch that rethrows is no boundary at all: the handler treats null
      // as "nothing happened" and renders nothing.
      assert.ok(/return null/.test(catchBlock), "the catch path does not resolve to null");
      assert.ok(!/throw/.test(catchBlock), "the catch path rethrows");
    },
  ],
];

async function run() {
  for (const [name, fn] of runtimeChecks) await check(name, fn);
  for (const [name, fn] of wiringChecks) await check(name, fn);
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

run();
