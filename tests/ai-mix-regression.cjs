/* Run: node tests/ai-mix-regression.cjs
 *
 * Issue #49 — AI auto-playlist from listening history.
 *
 * The on-device generator (aiMixPlaylist.ts) is pure logic over
 * StorageService + buildSmartQueue, so it is driven at runtime with
 * stubbed storage. The discovery generator (aiMixGenerator.ts) adds a
 * keyless LLM that writes SEARCH QUERIES only — it never picks tracks —
 * resolved through the app's own search and scored by the same weights,
 * with fallback to the on-device mix at every failing stage. Its fetch,
 * search, and history inputs are stubbed here; the UI half of both is
 * contract-checked against the file, because FullPlayerModal cannot
 * load under Node.
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

// Modules whose lookups are resolved lazily, so the discovery generator
// can swap its history + LLM + search stubs per test.
const LAZY = {};
const stubRequire = (spec) => {
  if (Object.prototype.hasOwnProperty.call(STUBS, spec)) {
    return { __esModule: true, ...STUBS[spec] };
  }
  if (Object.prototype.hasOwnProperty.call(LAZY, spec)) {
    return { __esModule: true, ...LAZY[spec]() };
  }
  // aiMixGenerator imports its sibling by relative path; resolve it to the
  // already-compiled on-device module rather than duplicating its stubs.
  if (spec === './aiMixPlaylist') {
    return { __esModule: true, ...MIX };
  }
  throw new Error(`unexpected require(${spec})`);
};

function compileModule(rel) {
  const js = ts.transpileModule(readRepoFile(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiled = path.join(os.tmpdir(), `${path.basename(rel)}.${process.pid}.cjs`);
  fs.writeFileSync(compiled, js);
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', fs.readFileSync(compiled, 'utf8'))(
    stubRequire,
    module,
    module.exports,
  );
  fs.unlinkSync(compiled);
  return module.exports;
}

function loadModule() {
  return compileModule('modules/aiMixPlaylist.ts');
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

// ---- discovery generator stubs ----------------------------------------------

// The generator pulls real history via listeningStats; stubbed here so tests
// do not depend on playback fixtures.
let history = { artists: [], tracks: [] };
LAZY['../utils/listeningStats'] = () => ({
  loadReplaySummary: async () => ({
    topArtists: history.artists.map((name) => ({ name, ms: 1000, plays: 1 })),
    topTracks: history.tracks.map((s) => ({ title: s.title, artist: s.artist, ms: 1000, plays: 1 })),
  }),
});
LAZY['./searchAPI'] = () => ({ searchAPI: { searchWithYouTubeMusic: async () => ({ items: [] }) } });

const GEN = compileModule('modules/aiMixGenerator.ts');

// A fetch stub returning OpenAI-shaped content; letCount proves the request
// actually left the generator rather than short-circuiting.
let llmContent = null;
let llmStatus = 200;
let llmCalls = 0;
const llmFetch = async (url, opts) => {
  llmCalls += 1;
  assert.equal(url, 'https://text.pollinations.ai/openai', 'all chain entries hit the OpenAI-compatible endpoint');
  assert.ok(opts.headers['Content-Type'], 'needs a JSON content type');
  assert.ok(!('Authorization' in opts.headers) && !('authorization' in opts.headers),
    'anonymous lane — any Authorization header earns HTTP 402 from Pollinations');
  const parsed = JSON.parse(opts.body);
  assert.ok(['openai', 'mistral'].includes(parsed.model), `unexpected chain model ${parsed.model}`);
  assert.ok(parsed.messages[0].content.includes('Top artists:'), 'prompt carries history');
  return { ok: llmStatus === 200, status: llmStatus, json: async () => ({ choices: [{ message: { content: llmContent } }] }) };
};

// A search stub feeding a pool big enough to clear buildSmartQueue's floor.
const discoveryTracks = (n) => Array.from({ length: n }, (_, i) => track(`d${i}`, `New ${i}`, 'Delta', `https://img/d${i}.jpg`));
let searchResults = [];
const discoverySearch = async () => searchResults;

function resetDiscovery() {
  reset();
  history = {
    artists: ['Alpha', 'Beta', 'Gamma'],
    tracks: [
      { title: 'Song One', artist: 'Alpha' },
      { title: 'Song Two', artist: 'Alpha' },
    ],
  };
  llmContent = '["lofi hip hop beats","90s alternative rock","persian pop classics","jazz for rainy days"]';
  llmStatus = 200;
  searchResults = discoveryTracks(40);
    llmCalls = 0;
  }


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
    assert.match(src, /await import\(\s*"\.\.\/modules\/aiMixGenerator"\s*\)/);
    assert.ok(
      !/^import .*from "\.\.\/modules\/aiMix(Gen|Play)";?/m.test(src),
      'the generator must not be a static import of the player modal',
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

  // ---- discovery generator -------------------------------------------------

  await check('discovery: LLM queries resolve to a pinned mix of NEW tracks', async () => {
    resetDiscovery();
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: llmFetch, search: discoverySearch });
    assert.ok(mix, 'expected a mix');
    assert.equal(mix.id, MIX.AI_MIX_ID);
    assert.equal(llmCalls, 1, 'the LLM must be called exactly once');
    // Every track came from discovery, none from the user's library.
    assert.ok(mix.tracks.length >= 8, 'expected a real discovery pool');
    assert.ok(mix.tracks.every((t) => t.id.startsWith('d')), 'mix must be new tracks only');
    assert.equal(playlists.filter((p) => p.id === MIX.AI_MIX_ID).length, 1);
  });

  await check('discovery: the LLM never picks tracks, only search queries', () => {
    // The prompt must ask for queries, not track names — the app's own
    // search + scoring stays the only thing that chooses songs.
    const prompt = GEN.buildHistoryContext(['Alpha'], [{ title: 'Song One', artist: 'Alpha' }], 'en');
    assert.match(prompt, /search queries/);
    assert.match(prompt, /NOT heard yet/);
    assert.match(prompt, /Top artists: Alpha/);
  });

  await check('discovery: a markdown-fenced JSON array still parses', () => {
    const raw = 'Here you go:\n```json\n["lofi beats", "90s rock"]\n```\nEnjoy!';
    assert.deepEqual(GEN.parseQueryList(raw), ['lofi beats', '90s rock']);
  });

  await check('discovery: garbage model output is rejected, not trusted', () => {
    // Chatter with no array at all.
    assert.deepEqual(GEN.parseQueryList('I cannot help with that.'), []);
    // Non-string entries are dropped, not coerced.
    assert.deepEqual(GEN.parseQueryList('["fine tune", 42, null, "also fine"]'), ['fine tune', 'also fine']);
    // Junk strings with no word characters are dropped.
    assert.deepEqual(GEN.parseQueryList('["!!!", "fine tune"]'), ['fine tune']);
    // Over-long queries are capped, not rejected wholesale.
    const long = GEN.parseQueryList(`["${'x'.repeat(200)}"]`);
    assert.equal(long[0].length, 80);
  });

  await check('discovery: a failed LLM call falls back to the on-device mix', async () => {
    resetDiscovery();
    llmStatus = 500;
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: llmFetch, search: discoverySearch });
    assert.ok(mix, 'fallback must still produce a mix');
    // On-device mix draws from the user's library, not discovery ids.
    assert.ok(mix.tracks.every((t) => !t.id.startsWith('d')), 'fallback must be the on-device mix');
  });

  await check('discovery: an unparseable LLM response falls back, not empty', async () => {
    resetDiscovery();
    llmContent = 'Sorry, I cannot generate that.';
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: llmFetch, search: discoverySearch });
    assert.ok(mix, 'a bad response must fall back, not yield an empty playlist');
    assert.ok(mix.tracks.every((t) => !t.id.startsWith('d')));
  });

  await check('discovery: too few discovered tracks falls back to on-device', async () => {
    resetDiscovery();
    searchResults = discoveryTracks(3); // below the MIN_DISCOVERY_TRACKS floor
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: llmFetch, search: discoverySearch });
    assert.ok(mix);
    assert.ok(mix.tracks.every((t) => !t.id.startsWith('d')), 'thin discovery must fall back');
  });

  await check('discovery: a throwing search source does not sink the batch', async () => {
    resetDiscovery();
    const mix = await GEN.generateAiMixWithDiscovery('en', {
      fetchImpl: llmFetch,
      search: async () => { throw new Error('search down'); },
    });
    assert.ok(mix, 'a dead search source must fall back, not reject');
  });

  await check('discovery: no seed history returns null and calls nothing', async () => {
    resetDiscovery();
    liked = [];
    recent = [];
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: llmFetch, search: discoverySearch });
    assert.equal(mix, null);
    assert.equal(llmCalls, 0, 'no history means no LLM call at all');
    assert.equal(playlists.length, 0);
  });

  await check('discovery: the endpoint is keyless in source', () => {
    const src = readRepoFile('modules/aiMixGenerator.ts');
    assert.match(src, /text\.pollinations\.ai/);
    // The anonymous lane is the free lane; no auth token may be attached.
    assert.doesNotMatch(src, /headers[^}]*[Aa]uthorization|: *[\"']Bearer/,
      'no auth token may be sent to the keyless endpoint');
  });

  await check('discovery: the player button calls the discovery generator', () => {
    const src = readRepoFile('components/FullPlayerModal.tsx');
    assert.match(src, /await import\(\s*"\.\.\/modules\/aiMixGenerator"\s*\)/);
    assert.match(src, /generateAiMixWithDiscovery/);
    assert.ok(
      !/^import .*from "\.\.\/modules\/aiMixGenerator";$/m.test(src),
      'the generator must stay a lazy import of the player modal',
    );
  });

  await check('discovery: the chain tries the fallback model after a 402', async () => {
    resetDiscovery();
    const seenModels = [];
    const chainFetch = async (url, opts) => {
      const parsed = JSON.parse(opts.body);
      seenModels.push(parsed.model);
      // First endpoint throttled, second answers.
      if (seenModels.length === 1) {
        return { ok: false, status: 402, json: async () => ({}) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: llmContent } }] }),
      };
    };
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: chainFetch, search: discoverySearch });
    assert.deepEqual(seenModels, ['mistral', 'openai'], 'chain walks mistral first, then openai');
    assert.ok(mix, 'fallback model must rescue the run');
    assert.ok(mix.tracks.every((t) => t.id.startsWith('d')), 'rescued run is still discovery');
  });

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
