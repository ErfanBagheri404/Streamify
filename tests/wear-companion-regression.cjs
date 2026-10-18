/* Run: node tests/wear-companion-regression.cjs
 *
 * Issue #32 — Wear OS companion app.
 *
 * The pure half: now-playing card, queue rows and complication payloads. The
 * wearapp/ module needs an emulator and is not covered here.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;

async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${error && error.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadWear() {
  const js = ts.transpileModule(read('modules/wearCompanion.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const stub = (spec) => {
    if (spec.endsWith('PlayerContext')) return {};
    throw new Error(`unexpected require(${spec})`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', js)(stub, module, module.exports);
  return module.exports;
}

const track = (overrides = {}) => ({
  id: 'vid1',
  title: 'Test Song',
  artist: 'Test Artist',
  thumbnail: 'https://i.ytimg.com/vi/vid1/hqdefault.jpg',
  duration: 215,
  ...overrides,
});

async function main() {
  const m = loadWear();

  // ---- time formatting ---------------------------------------------------

  await check('formatWearTime: minutes:seconds below an hour', () => {
    assert.equal(m.formatWearTime(0), '0:00');
    assert.equal(m.formatWearTime(9), '0:09');
    assert.equal(m.formatWearTime(215), '3:35');
    assert.equal(m.formatWearTime(599), '9:59');
  });

  await check('formatWearTime: adds hours past 3600s', () => {
    assert.equal(m.formatWearTime(3600), '1:00:00');
    assert.equal(m.formatWearTime(3725), '1:02:05');
  });

  await check('formatWearTime: never NaN or a bare colon', () => {
    for (const value of [undefined, NaN, -1, Infinity]) {
      assert.equal(m.formatWearTime(value), '0:00', `bad output for ${value}`);
    }
  });

  await check('formatWearTime: fractional seconds truncate down', () => {
    assert.equal(m.formatWearTime(215.9), '3:35');
  });

  // ---- now playing -------------------------------------------------------

  await check('nowPlaying: a full track maps every field', () => {
    const np = m.buildWearNowPlaying(track(), true, 65, 215);
    assert.equal(np.title, 'Test Song');
    assert.equal(np.artist, 'Test Artist');
    assert.equal(np.artworkUrl, 'https://i.ytimg.com/vi/vid1/hqdefault.jpg');
    assert.equal(np.isPlaying, true);
    assert.equal(np.positionLabel, '1:05');
    assert.equal(np.durationLabel, '3:35');
    assert.equal(np.progressLabel, '30% / 3:35');
  });

  await check('nowPlaying: null track yields placeholders', () => {
    const np = m.buildWearNowPlaying(null, false, 0, 0);
    assert.equal(np.title, 'Unknown Title');
    assert.equal(np.artist, 'Unknown Artist');
    assert.equal(np.artworkUrl, '');
    assert.equal(np.progressLabel, '');
  });

  await check('nowPlaying: unknown duration drops the progress label', () => {
    const np = m.buildWearNowPlaying(track({ duration: undefined }), true, 65, 0);
    assert.equal(np.durationLabel, '');
    assert.equal(np.progressLabel, '');
    assert.equal(np.positionLabel, '1:05');
  });

  await check('nowPlaying: a position past the end is clamped, not overshot', () => {
    const np = m.buildWearNowPlaying(track(), true, 900, 215);
    assert.equal(np.positionLabel, '3:35');
    assert.ok(!np.progressLabel.startsWith('100'), np.progressLabel);
    assert.ok(!np.progressLabel.includes('-'), np.progressLabel);
  });

  await check('nowPlaying: a non-http artwork URL is dropped', () => {
    assert.equal(
      m.buildWearNowPlaying(track({ thumbnail: 'file:///a.jpg' }), true, 0, 215).artworkUrl,
      '',
    );
  });

  // ---- queue -------------------------------------------------------------

  await check('queue: rows come back in queue order with the current marked', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })];
    const rows = m.buildWearQueue(tracks, 1);
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
    assert.deepEqual(rows.map((r) => r.isCurrent), [false, true, false]);
  });

  await check('queue: no row is marked when the index is out of range', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' })];
    const rows = m.buildWearQueue(tracks, 99);
    assert.equal(rows.filter((r) => r.isCurrent).length, 0);
  });

  await check('queue: a negative index marks nothing', () => {
    const rows = m.buildWearQueue([track({ id: 'a' })], -1);
    assert.equal(rows[0].isCurrent, false);
  });

  await check('queue: tracks without an id are dropped', () => {
    const rows = m.buildWearQueue([track({ id: undefined }), track({ id: 'b' })], 0);
    assert.deepEqual(rows.map((r) => r.id), ['b']);
  });

  await check('queue: null input is an empty list', () => {
    assert.deepEqual(m.buildWearQueue(null, 0), []);
    assert.deepEqual(m.buildWearQueue([], 0), []);
  });

  await check('queue: the current marker tracks the id after drops', () => {
    const tracks = [track({ id: undefined }), track({ id: 'b' }), track({ id: 'c' })];
    const rows = m.buildWearQueue(tracks, 2);
    assert.equal(rows[1].isCurrent, true, 'c is the playing track and row 1 after the drop');
  });

  await check('queue: duplicate ids mark only the selected row', () => {
    const tracks = [track({ id: 'same' }), track({ id: 'same' })];
    const rows = m.buildWearQueue(tracks, 1);
    assert.deepEqual(rows.map((row) => row.isCurrent), [false, true]);
  });

  // ---- complication ------------------------------------------------------

  await check('complication: playing shows artist — title', () => {
    const c = m.buildWearComplication(track(), true);
    assert.equal(c.label, 'Test Artist — Test Song');
    assert.equal(c.empty, false);
  });

  await check('complication: paused is prefixed with the pause glyph', () => {
    assert.equal(m.buildWearComplication(track(), false).label, '⏸ Test Song');
  });

  await check('complication: a track with no artist shows just the title', () => {
    assert.equal(
      m.buildWearComplication(track({ artist: undefined }), true).label,
      'Test Song',
    );
  });

  await check('complication: no track is an empty complication', () => {
    assert.deepEqual(m.buildWearComplication(null, true), { label: '', empty: true });
    assert.deepEqual(m.buildWearComplication(undefined, false), { label: '', empty: true });
  });

  await check('complication: a titleless track is empty, not a bare glyph', () => {
    assert.deepEqual(
      m.buildWearComplication(track({ title: '   ' }), true),
      { label: '', empty: true },
    );
  });

  // ---- payload serialization (extended scenarios) -------------------------

  await check('payloads are JSON round-trippable — the Data Layer carries them as JSON', () => {
    const np = m.buildWearNowPlaying(track(), true, 65, 215);
    const rows = m.buildWearQueue([track({ id: 'a' }), track({ id: 'b' })], 1);
    const comp = m.buildWearComplication(track(), true);
    for (const payload of [np, rows, comp]) {
      const round = JSON.parse(JSON.stringify(payload));
      assert.deepEqual(round, payload, 'a watch must see exactly what the phone built');
    }
    // Keys are plain JSON primitives: no undefined leaking into the wire format.
    for (const key of Object.keys(np)) {
      assert.ok(['string', 'boolean', 'number'].includes(typeof np[key]), `nowPlaying.${key} is ${typeof np[key]}`);
    }
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        assert.notStrictEqual(row[key], undefined, `queue row ${key} must not be undefined`);
      }
    }
  });

  await check('a long queue still fits the 100 KB DataItem budget at 500 rows', () => {
    // The Wear Data Layer caps a DataItem payload at 100 KB. The phone-side
    // builder emits no cap of its own, so guard the margin the queue shape
    // actually leaves: 500 rows of a typical track stay well inside it.
    const rows = m.buildWearQueue(
      Array.from({ length: 500 }, (_, i) => track({ id: `vid${i}`, title: `Track ${i}` })),
      3,
    );
    assert.equal(rows.length, 500);
    const bytes = Buffer.byteLength(JSON.stringify(rows), 'utf8');
    assert.ok(bytes > 0 && bytes < 100 * 1024, `queue payload is ${bytes} bytes`);
    assert.equal(rows[3].isCurrent, true);
  });

  // ---- formatting boundaries (extended scenarios) -------------------------

  await check('formatWearTime: rolls 59:59 -> 1:00:00 at the hour boundary', () => {
    assert.equal(m.formatWearTime(3599), '59:59');
    assert.equal(m.formatWearTime(3600), '1:00:00');
    assert.equal(m.formatWearTime(7199), '1:59:59');
    assert.equal(m.formatWearTime(60), '1:00');
    assert.equal(m.formatWearTime(59.9), '0:59', 'sub-second values floor, not round up');
    assert.equal(m.formatWearTime(0.4), '0:00');
  });

  await check('nowPlaying: progress floors below 100% and starts at 0%', () => {
    const nearEnd = m.buildWearNowPlaying(track(), true, 213.9, 215);
    assert.equal(nearEnd.progressLabel, '99% / 3:35', '99.x floors to 99, never 100 mid-track');
    assert.equal(nearEnd.positionLabel, '3:33');
    const start = m.buildWearNowPlaying(track(), true, 0, 215);
    assert.equal(start.progressLabel, '0% / 3:35');
    assert.equal(start.positionLabel, '0:00');
    // An unknown duration still shows the position it does know.
    const noDur = m.buildWearNowPlaying(track(), true, 65, 0);
    assert.equal(noDur.durationLabel, '');
    assert.equal(noDur.progressLabel, '');
    assert.equal(noDur.positionLabel, '1:05');
  });

  // ---- queue + complication edges (extended scenarios) --------------------

  await check('queue: rows fall back to placeholders the same way the card does', () => {
    const rows = m.buildWearQueue([{ id: 'a', title: '   ', artist: undefined, thumbnail: 'content://x.jpg' }], 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Unknown Title');
    assert.equal(rows[0].artist, 'Unknown Artist');
    assert.equal(rows[0].artworkUrl, '', 'content:// artwork is not fetchable on the watch');
  });

  await check('queue: a fractional index marks nothing', () => {
    const rows = m.buildWearQueue([track({ id: 'a' }), track({ id: 'b' })], 1.5);
    assert.equal(rows.filter((r) => r.isCurrent).length, 0, 'a fractional index is not a row');
  });

  await check('complication: whitespace artist is treated as no artist', () => {
    assert.deepEqual(
      m.buildWearComplication({ id: 'x', title: 'Only Title' }, false),
      { label: '⏸ Only Title', empty: false },
      'paused, no artist: glyph + title',
    );
    assert.deepEqual(
      m.buildWearComplication({ id: 'x', title: 'TT', artist: '   ' }, true),
      { label: 'TT', empty: false },
      'playing, blank artist: title only',
    );
    assert.equal(m.buildWearComplication(track(), true).label.includes('—'), true, 'em-dash joins artist and title');
  });
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) process.exitCode = 1;
}

main();
