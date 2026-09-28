/* Run: node tests/cast-metadata-regression.cjs
 *
 * Issue #26 — Chromecast / Cast support.
 *
 * The pure half: receiver metadata + queue transfer. The SDK wiring needs a
 * real Cast device, so it is not covered here.
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

function loadCast() {
  const js = ts.transpileModule(read('modules/castMetadata.ts'), {
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
  audioUrl: 'https://example.com/audio.mp3',
  duration: 215,
  ...overrides,
});

async function main() {
  const m = loadCast();

  // ---- metadata ----------------------------------------------------------

  await check('metadata: a full track maps every field', () => {
    const meta = m.buildCastMetadata(track());
    assert.equal(meta.title, 'Test Song');
    assert.equal(meta.artist, 'Test Artist');
    assert.equal(meta.albumArtist, 'Test Artist');
    assert.equal(meta.imageUrl, 'https://i.ytimg.com/vi/vid1/hqdefault.jpg');
    assert.equal(meta.duration, 215);
  });

  await check('metadata: null track yields placeholders, never null fields', () => {
    const meta = m.buildCastMetadata(null);
    assert.equal(meta.title, 'Unknown Title');
    assert.equal(meta.artist, 'Unknown Artist');
    assert.equal(meta.albumArtist, 'Unknown Artist');
    assert.equal(meta.imageUrl, '');
    assert.equal(meta.duration, 0);
  });

  await check('metadata: undefined track behaves like null', () => {
    const meta = m.buildCastMetadata(undefined);
    assert.equal(meta.title, 'Unknown Title');
    assert.equal(meta.artist, 'Unknown Artist');
  });

  await check('metadata: missing artist falls back to Unknown Artist', () => {
    const meta = m.buildCastMetadata(track({ artist: undefined }));
    assert.equal(meta.artist, 'Unknown Artist');
    assert.equal(meta.albumArtist, 'Unknown Artist');
  });

  await check('metadata: whitespace-only strings are treated as missing', () => {
    const meta = m.buildCastMetadata(track({ title: '   ', artist: '' }));
    assert.equal(meta.title, 'Unknown Title');
    assert.equal(meta.artist, 'Unknown Artist');
  });

  await check('metadata: a non-http image URL is dropped', () => {
    const meta = m.buildCastMetadata(track({ thumbnail: 'file:///storage/art.jpg' }));
    assert.equal(meta.imageUrl, '');
  });

  await check('metadata: a non-finite or negative duration becomes 0', () => {
    assert.equal(m.buildCastMetadata(track({ duration: NaN })).duration, 0);
    assert.equal(m.buildCastMetadata(track({ duration: -5 })).duration, 0);
    assert.equal(m.buildCastMetadata(track({ duration: Infinity })).duration, 0);
    assert.equal(m.buildCastMetadata(track({ duration: undefined })).duration, 0);
  });

  await check('metadata: fractional durations are rounded', () => {
    assert.equal(m.buildCastMetadata(track({ duration: 215.6 })).duration, 216);
  });

  // ---- stream URL --------------------------------------------------------

  await check('streamUrl: prefers the resolved audioUrl', () => {
    assert.equal(
      m.castStreamUrl(track({ audioUrl: 'https://a.example/s.mp3', url: 'https://b.example/s.mp3' })),
      'https://a.example/s.mp3',
    );
  });

  await check('streamUrl: falls back to the track url', () => {
    assert.equal(
      m.castStreamUrl(track({ audioUrl: undefined, url: 'https://b.example/s.mp3' })),
      'https://b.example/s.mp3',
    );
  });

  await check('streamUrl: a relative path is not castable', () => {
    assert.equal(m.castStreamUrl(track({ audioUrl: '/storage/emulated/0/s.mp3' })), '');
  });

  await check('streamUrl: null track yields empty', () => {
    assert.equal(m.castStreamUrl(null), '');
  });

  // ---- queue transfer ----------------------------------------------------

  await check('queue: transfers every castable track with the right start index', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })];
    const q = m.buildCastQueue(tracks, 1);
    assert.equal(q.items.length, 3);
    assert.equal(q.startIndex, 1);
    assert.equal(q.items[1].mediaId, 'b');
    assert.equal(q.items[1].title, 'Test Song');
  });

  await check('queue: tracks without an absolute stream URL are dropped', () => {
    const tracks = [
      track({ id: 'a', audioUrl: undefined }),
      track({ id: 'b' }),
      track({ id: 'c', audioUrl: 'file:///local.mp3' }),
    ];
    const q = m.buildCastQueue(tracks, 0);
    assert.deepEqual(q.items.map((i) => i.mediaId), ['b']);
    assert.equal(q.startIndex, 0);
  });

  await check('queue: startIndex follows the playing track after drops', () => {
    const tracks = [
      track({ id: 'a', audioUrl: undefined }),
      track({ id: 'b' }),
      track({ id: 'c' }),
    ];
    const q = m.buildCastQueue(tracks, 2);
    assert.equal(q.startIndex, 1, 'index 2 is track c, which is now at position 1');
  });

  await check('queue: an out-of-range index falls back to the first item', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' })];
    assert.equal(m.buildCastQueue(tracks, 99).startIndex, 0);
    assert.equal(m.buildCastQueue(tracks, -1).startIndex, 0);
  });

  await check('queue: a non-integer index falls back to the first item', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' })];
    assert.equal(m.buildCastQueue(tracks, 1.5).startIndex, 0);
    assert.equal(m.buildCastQueue(tracks, NaN).startIndex, 0);
  });

  await check('queue: tracks without an id are skipped', () => {
    const tracks = [track({ id: undefined }), track({ id: 'b' })];
    const q = m.buildCastQueue(tracks, 0);
    assert.deepEqual(q.items.map((i) => i.mediaId), ['b']);
  });

  await check('queue: null or empty input is an empty, non-castable queue', () => {
    assert.deepEqual(m.buildCastQueue(null, 0), { items: [], startIndex: 0 });
    assert.deepEqual(m.buildCastQueue([], 0), { items: [], startIndex: 0 });
    assert.equal(m.isCastable(m.buildCastQueue(null, 0)), false);
  });

  await check('queue: every item carries a non-empty streamUrl', () => {
    const q = m.buildCastQueue([track({ id: 'a' }), track({ id: 'b' })], 0);
    for (const item of q.items) {
      assert.ok(item.streamUrl.startsWith('https://'), item.streamUrl);
    }
  });

  // ---- castable / next ---------------------------------------------------

  await check('isCastable: true only for a non-empty queue', () => {
    assert.equal(m.isCastable({ items: [{}], startIndex: 0 }), true);
    assert.equal(m.isCastable({ items: [], startIndex: 0 }), false);
    assert.equal(m.isCastable(null), false);
    assert.equal(m.isCastable(undefined), false);
  });

  await check('nextCastItem: returns the following item, null at the end', () => {
    const q = m.buildCastQueue([track({ id: 'a' }), track({ id: 'b' })], 0);
    assert.equal(m.nextCastItem(q, 0).mediaId, 'b');
    assert.equal(m.nextCastItem(q, 1), null);
  });

  await check('nextCastItem: an out-of-range index yields null', () => {
    const q = m.buildCastQueue([track({ id: 'a' })], 0);
    assert.equal(m.nextCastItem(q, 5), null);
  });

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) process.exitCode = 1;
}

main();
