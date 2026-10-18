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

/* ---------------- persistence half ( AsyncStorage is stubbed) ------------- */

const store = new Map();
const asyncStorage = {
  setItem: async (k, v) => { store.set(k, String(v)); },
  getItem: async (k) => (store.has(k) ? store.get(k) : null),
  removeItem: async (k) => { store.delete(k); },
};
ctx.AsyncStorage = asyncStorage;
const { savePlaybackSession, loadPlaybackSession, clearPlaybackSession } = ctx.exports;

test("a saved session round-trips with volatile URLs stripped", async () => {
  store.clear();
  const playlist = [
    { id: "s3", title: "C", audioUrl: "https://stream/x3.m3u8?expiry=5", url: "https://res/x3" },
    { id: "s4", title: "D", audioUrl: "https://stream/x4.m3u8" },
  ];
  await savePlaybackSession(playlist, 1);
  const loaded = await loadPlaybackSession();
  assert.ok(loaded, "reload finds the session");
  assert.deepEqual(Array.from(loaded.playlist, (t) => t.id), ["s3", "s4"]);
  for (const t of loaded.playlist) {
    assert.equal(t.audioUrl, undefined, "resolved audio URLs expire and must not persist");
    assert.equal(t.url, undefined, "resolve URLs must not persist either");
    assert.equal(t.title, playlist.find((p) => p.id === t.id).title, "the logical fields survive");
  }
});

test("saving an empty playlist clears the stored session", async () => {
  store.clear();
  await savePlaybackSession([{ id: "s1" }], 0);
  assert.ok(await loadPlaybackSession());
  await savePlaybackSession([], 0);
  assert.equal(await loadPlaybackSession(), null, "an empty playlist cannot be restored");
});

test("a huge playlist is capped at the restore limit", async () => {
  store.clear();
  const huge = Array.from({ length: 250 }, (_, i) => ({ id: `t${i}`, title: `T${i}` }));
  await savePlaybackSession(huge, 240);
  const loaded = await loadPlaybackSession();
  assert.equal(loaded.playlist.length, 200, "MAX_RESTORED_PLAYLIST is the cap");
  assert.equal(Array.from(loaded.playlist, (t) => t.id).at(-1), "t199");
});

test("the saved index is clamped to the STORED playlist, not the full one", async () => {
  // FINDING (PR #100): savePlaybackSession clamps `index` against the FULL
  // playlist length and only then slices the playlist to
  // MAX_RESTORED_PLAYLIST, so a >200-track session stores an index past the
  // end of what it stored. A cold start then resumes at the LAST stored track
  // instead of the one the user was on. App source is not edited.
  store.clear();
  const huge = Array.from({ length: 250 }, (_, i) => ({ id: `t${i}`, title: `T${i}` }));
  await savePlaybackSession(huge, 240);
  const loaded = await loadPlaybackSession();
  assert.equal(loaded.playlist.length, 200, "MAX_RESTORED_PLAYLIST is the cap");
  assert.ok(
    loaded.index < loaded.playlist.length,
    `stored index ${loaded.index} is outside the stored ${loaded.playlist.length}-track playlist`,
  );
});

test("resolve clamps an out-of-range snapshot index instead of throwing", () => {
  // The restore path defends against the case above, which is why it is a
  // wrong-track bug and not a crash.
  const r = resolveRestoredSession({ playlist: [track(1), track(2)], index: 240 }, [], 0);
  assert.equal(r.index, 1, "clamped to the last track");
  const neg = resolveRestoredSession({ playlist: [track(1), track(2)], index: -5 }, [], 0);
  assert.equal(neg.index, 0, "a negative index clamps to the first track");
});

test("a corrupt stored session parses to null instead of crashing the cold start", async () => {
  store.clear();
  store.set("@streamify_playback_session", "{not json at all");
  assert.equal(await loadPlaybackSession(), null);
});

test("clearPlaybackSession removes a saved session", async () => {
  store.clear();
  await savePlaybackSession([{ id: "s1" }, { id: "s2" }], 0);
  assert.ok(await loadPlaybackSession());
  await clearPlaybackSession();
  assert.equal(await loadPlaybackSession(), null);
});

/* ---------------- restore decision boundaries (new) ----------------------- */

test("a shuffled queue survives a cold start in its shuffled order", () => {
  // playTrack persists the EFFECTIVE playlist, so after a shuffle kill the
  // restoration must keep the shuffled order, not the source order.
  store.clear();
  const shuffled = ["t3", "t1", "t2"].map((id) => ({ id, title: id }));
  const loaded = { playlist: shuffled, index: 0 };
  const r = resolveRestoredSession(loaded, [], 0);
  assert.deepEqual(r.playlist.map((t) => t.id), ["t3", "t1", "t2"], "order is kept");
  assert.equal(r.index, 0);
  // Same with the active track mid-way through the shuffled order.
  const mid = resolveRestoredSession({ ...loaded, index: 2 }, [], 0);
  assert.equal(mid.index, 2, "the index points at the shuffled position");
});

test("an out-of-range native active index still maps to the active track", () => {
  // TrackPlayer sometimes reports a stale index; clamp instead of crashing.
  const r = resolveRestoredSession(session([1, 2, 3, 4], 0), ["1", "2", "3"], 99);
  assert.equal(r.index, 2, "99 clamps to the last native track");
  const neg = resolveRestoredSession(session([1, 2, 3, 4], 0), ["1", "2", "3"], -1);
  assert.equal(neg.index, 0, "-1 clamps to the first native track");
});

test("a native queue that exceeds the snapshot defers to the native path", () => {
  // The queue is more complete than the snapshot; overriding it would LOSE
  // context, not restore it.
  const r = resolveRestoredSession(session([1], 0), ["1", "2"], 0);
  assert.equal(r, null);
});

test("a truncated queue whose active track is missing from the snapshot defers to native", () => {
  // addTracks() dropped non-resolvable tracks; if the user's active track was
  // one of them there is no original position to map to.
  const r = resolveRestoredSession(session([1, 2, 3, 4, 5], 0), ["1", "9"], 1);
  assert.equal(r, null);
});

test("numeric and string ids compare through the string projection", () => {
  // The snapshot stores ids how the platform produced them; native ids are
  // always strings. Both sides go through String() before comparing.
  const r = resolveRestoredSession(session([1, 2, 3, 4, 5], 0), ["1", "2"], 1);
  assert.ok(r, "the truncated restore path fires");
  assert.equal(r.index, 1);
});
