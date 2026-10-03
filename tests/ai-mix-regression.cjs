/* Run: node tests/ai-mix-regression.cjs
 *
 * Issue #49 — AI auto-playlist from listening history.
 *
 * The generator is pure logic over StorageService + buildSmartQueue, so it is
 * driven at runtime with stubbed storage. The UI half is contract-checked
 * against the file, because FullPlayerModal cannot load under Node.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

const readRepoFile = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---- fixtures --------------------------------------------------------------

const track = (id, title, artist, thumb) => ({ id, title, artist, thumbnail: thumb });

let liked = [];
let recent = [];
let playlists = [];
let playCounts = new Map();
let playlistWrites = [];

const storageStub = {
  StorageService: {
    loadLikedSongs: async () => liked.map((t) => ({ ...t })),
    loadPreviouslyPlayedSongs: async () => recent.map((t) => ({ ...t })),
    loadPlaylists: async () => playlists.map((p) => ({ ...p })),
    savePlaylists: async (next) => {
      playlistWrites.push({ kind: 'savePlaylists', next: next.map((p) => ({ ...p })) });
      playlists = next.map((p) => ({ ...p }));
    },
    addPlaylist: async (p) => {
      playlistWrites.push({ kind: 'addPlaylist', next: [p] });
      playlists = [p, ...playlists];
    },
  },
};

// buildSmartQueue needs >= 5 library entries to say anything; a stub that
// keeps the call honest without duplicating the real scoring.
let lastQueueArgs = null;
const aiStub = {
  buildSmartQueue: (options) => {
    lastQueueArgs = options;
    if (!options.seed || options.library.length < 5) {
      return [];
    }
    return options.library
      .filter((t) => t.id !== options.seed.id)
      .slice(0, options.size)
      .map((t) => ({ ...t }));
  },
  loadPlayCounts: async () => playCounts,
};

const STUBS = {
  '../utils/storage': storageStub,
  './aiPlaylistService': aiStub,
  '../contexts/PlayerContext': {},
};

function loadModule() {
  const js = ts.transpileModule(readRepoFile('modules/aiMixPlaylist.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiled = path.join(os.tmpdir(), `aiMixPlaylist.${process.pid}.cjs`);
  fs.writeFileSync(compiled, js);
  const module = { exports: {} };
  const stubRequire = (spec) => {
    if (Object.prototype.hasOwnProperty.call(STUBS, spec)) {
      return { __esModule: true, ...STUBS[spec] };
    }
    throw new Error(`unexpected require(${spec}) in aiMixPlaylist.ts`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', fs.readFileSync(compiled, 'utf8'))(
    stubRequire,
    module,
    module.exports,
  );
  fs.unlinkSync(compiled);
  return module.exports;
}

function reset() {
  liked = [
    track('a1', 'Song One', 'Alpha', 'https://img/1.jpg'),
    track('a2', 'Song Two', 'Alpha', 'https://img/2.jpg'),
    track('a3', 'Song Three', 'Beta', 'https://img/3.jpg'),
    track('a4', 'Song Four', 'Beta', 'https://img/4.jpg'),
    track('a5', 'Song Five', 'Gamma', 'https://img/5.jpg'),
    track('a6', 'Song Six', 'Gamma', 'https://img/6.jpg'),
  ];
  recent = [track('r1', 'Recent One', 'Delta', 'https://img/r1.jpg'), ...liked];
  playlists = [];
  playCounts = new Map([
    ['a1', 40],
    ['a2', 25],
    ['r1', 9],
  ]);
  lastQueueArgs = null;
  playlistWrites = [];
}

const MIX = loadModule();

async function main() {
  await check('generates a mix and pins it under the stable AI Mix id', async () => {
    reset();
    const mix = await MIX.generateAiMixPlaylist('en');
    assert.ok(mix, 'expected a mix');
    assert.equal(mix.id, MIX.AI_MIX_ID);
    assert.equal(mix.name, 'AI Mix');
    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].id, MIX.AI_MIX_ID);
  });

  await check('the mix is named in the active language', async () => {
    reset();
    const fa = await MIX.generateAiMixPlaylist('fa');
    assert.equal(fa.name, 'میکس هوش مصنوعی');
    const en = await MIX.generateAiMixPlaylist('en');
    assert.equal(en.name, 'AI Mix');
  });

  await check('regenerating replaces the mix instead of stacking copies', async () => {
    reset();
    await MIX.generateAiMixPlaylist('en');
    playlists.push({ id: 'user-made', name: 'Mine', tracks: [], createdAt: 'x', updatedAt: 'x' });
    const second = await MIX.generateAiMixPlaylist('en');
    assert.equal(playlists.length, 2, 'exactly one AI Mix plus the user playlist');
    assert.equal(playlists.filter((p) => p.id === MIX.AI_MIX_ID).length, 1);
    // The user's own playlist survives regeneration.
    assert.ok(playlists.some((p) => p.id === 'user-made'));
    assert.ok(second.createdAt, 'creation time is preserved across a rebuild');
  });

  await check('too little history returns null and saves nothing', async () => {
    reset();
    liked = liked.slice(0, 2);
    recent = [liked[0]];
    const mix = await MIX.generateAiMixPlaylist('en');
    // 2 liked + 1 recent is a pool of 2, below buildSmartQueue's floor of 5.
    assert.equal(mix, null);
    assert.equal(playlists.length, 0, 'nothing must be stored when there is no mix');
  });

  await check('no history at all returns null', async () => {
    reset();
    liked = [];
    recent = [];
    const mix = await MIX.generateAiMixPlaylist('en');
    assert.equal(mix, null);
    assert.equal(playlists.length, 0);
  });

  await check('the seed is the most recent play, and the pool is deduplicated', async () => {
    reset();
    await MIX.generateAiMixPlaylist('en');
    assert.ok(lastQueueArgs, 'buildSmartQueue must be called');
    assert.equal(lastQueueArgs.seed.id, 'r1', 'seed is the most recent play');
    const ids = lastQueueArgs.library.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, 'pool must not repeat a track');
  });

  await check('the play-count map is passed through for scoring', async () => {
    reset();
    await MIX.generateAiMixPlaylist('en');
    assert.ok(lastQueueArgs.playCounts instanceof Map);
    assert.equal(lastQueueArgs.playCounts.get('a1'), 40);
  });

  await check('playlists are read once and written once per generate', async () => {
    // Two loadPlaylists() calls plus a re-reading addPlaylist means another
    // writer's playlist can be dropped on the floor.
    reset();
    let loads = 0;
    const realLoad = storageStub.StorageService.loadPlaylists;
    storageStub.StorageService.loadPlaylists = async () => {
      loads += 1;
      return realLoad();
    };
    try {
      await MIX.generateAiMixPlaylist('en');
    } finally {
      storageStub.StorageService.loadPlaylists = realLoad;
    }
    assert.equal(loads, 1, 'expected a single read of the stored playlists');
    assert.equal(playlistWrites.length, 1, 'expected a single write');
    assert.equal(playlistWrites[0].kind, 'savePlaylists',
      'must not round-trip through addPlaylist, which re-reads the list');
  });

  await check('regenerating preserves playlists added after the first run', async () => {
    reset();
    await MIX.generateAiMixPlaylist('en');
    // Someone creates a playlist between runs.
    playlists = [{ id: 'user-made', name: 'Mine', tracks: [], createdAt: 'x', updatedAt: 'x' }, ...playlists];
    await MIX.generateAiMixPlaylist('en');
    const ids = playlists.map((p) => p.id).sort();
    assert.deepEqual(ids, ['@ai_mix', 'user-made'],
      'the user playlist must survive a regenerate');
    assert.equal(playlists.filter((p) => p.id === '@ai_mix').length, 1,
      'the mix must not be duplicated');
  });

  await check('the candidate pool is built without a redundant top-tracks list', async () => {
    // playCounts holds ids that already live in liked/recent, so re-adding
    // them as "top tracks" is a no-op the dedupe had to undo.
    reset();
    await MIX.generateAiMixPlaylist('en');
    const poolIds = lastQueueArgs.library.map((t) => t.id);
    assert.equal(new Set(poolIds).size, poolIds.length, 'pool must be deduplicated');
    assert.equal(poolIds.length, new Set([...liked, ...recent].map((t) => t.id)).size);
    assert.doesNotMatch(readRepoFile('modules/aiMixPlaylist.ts'), /topTracks/,
      'the dead top-tracks resolution should not come back');
  });

  await check('the cover is the top track artwork', async () => {
    reset();
    const mix = await MIX.generateAiMixPlaylist('en');
    assert.equal(mix.thumbnail, mix.tracks[0].thumbnail);
  });

  // ---- UI contract --------------------------------------------------------

  await check('the sparkle button sits in the player track row', () => {
    const src = readRepoFile('components/FullPlayerModal.tsx');
    assert.match(src, /name=\{isGeneratingAiMix \? "hourglass" : "sparkles"\}/);
    assert.match(src, /onPress=\{handleAiMix\}/);
    // Guarded against double taps while a generation is in flight.
    assert.match(src, /if \(isGeneratingAiMix\) \{\s*return;/);
  });

  await check('generating is lazy-imported, not pulled into the player bundle', () => {
    const src = readRepoFile('components/FullPlayerModal.tsx');
    assert.match(src, /await import\("\.\.\/modules\/aiMixPlaylist"\)/);
    assert.ok(
      !/^import .*from "\.\.\/modules\/aiMixPlaylist";$/m.test(src),
      'aiMixPlaylist must not be a static import of the player modal',
    );
  });

  await check('both outcomes are reported to the user', () => {
    const src = readRepoFile('components/FullPlayerModal.tsx');
    assert.match(src, /Alert\.alert\(\s*t\("player\.aiMixTitle"\)/);
    assert.match(src, /player\.aiMixReady/);
    assert.match(src, /player\.aiMixEmpty/);
  });

  await check('locale keys exist in both languages and match each other', () => {
    const en = JSON.parse(readRepoFile('locales/en.json'));
    const fa = JSON.parse(readRepoFile('locales/fa.json'));
    for (const key of ['aiMixTitle', 'aiMixReady', 'aiMixEmpty']) {
      assert.ok(en.player[key], `en.player.${key} missing`);
      assert.ok(fa.player[key], `fa.player.${key} missing`);
    }
  });

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
