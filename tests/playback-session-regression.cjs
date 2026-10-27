/* Run: node tests/playback-session-regression.cjs
 * Executes the real resolveRestoredSession() from modules/playbackSession.ts.
 * No device, no network, no React Native.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "modules/playbackSession.ts");
const src = fs.readFileSync(file, "utf8");

// Strip the AsyncStorage import (unavailable outside RN) and export the rest.
const stripped = src.replace(/^import .*?;\s*$/gm, "");
const js = ts.transpileModule(stripped, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const ctx = { exports: {}, console: { warn() {}, log() {}, error() {} } };
vm.runInNewContext(js, ctx);
const { resolveRestoredSession } = ctx.exports;
assert.equal(typeof resolveRestoredSession, "function", "exports resolveRestoredSession");

const track = (id) => ({ id, title: "T" + id, artist: "A", duration: 100, thumbnail: "" });
const session = (ids, index) => ({
  playlist: ids.map(track),
  index,
  updatedAt: Date.now(),
});

test("cold start with empty native queue restores the full playlist at its saved index", () => {
  const r = resolveRestoredSession(session([1, 2, 3, 4, 5], 3), [], 0);
  assert.ok(r, "restores");
  assert.deepEqual(r.playlist.map((t) => t.id), [1, 2, 3, 4, 5]);
  assert.equal(r.index, 3, "saved index preserved");
});

test("saved index is clamped to the persisted playlist bounds", () => {
  const r = resolveRestoredSession(session([1, 2], 99), [], 0);
  assert.equal(r.index, 1);
});

test("truncated native queue restores the FULL playlist at the active track's original position", () => {
  // 10-track playlist; addTracks() only queued 3 tracks (no audioUrl yet on the rest)
  const r = resolveRestoredSession(session([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0), ["1", "2", "3"], 2);
  assert.ok(r, "restores full playlist");
  assert.equal(r.playlist.length, 10, "playlist context is complete again");
  assert.equal(r.index, 2, "mapped to original position of native active track");
});

test("native queue in agreement with the snapshot defers to the native path", () => {
  const r = resolveRestoredSession(session([1, 2, 3], 1), ["1", "2", "3"], 1);
  assert.equal(r, null, "no override when queue already matches");
});

test("native queue containing an unknown track defers to the native path", () => {
  const r = resolveRestoredSession(session([1, 2, 3], 0), ["1", "77"], 1);
  assert.equal(r, null);
});

test("no persisted session means nothing to restore", () => {
  assert.equal(resolveRestoredSession(null, [], 0), null);
});

test("persistence helper refuses to restore an empty playlist", () => {
  const r = resolveRestoredSession(session([], 0), [], 0);
  assert.equal(r, null);
});
