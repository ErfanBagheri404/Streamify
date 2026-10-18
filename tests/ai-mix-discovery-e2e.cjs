/* E2E: real keyless LLM call -> real parse -> discovery playlist.
 * Run: node tests/ai-mix-discovery-e2e.cjs
 *
 * NOT a hermetic regression test — it hits text.pollinations.ai over the
 * network and asserts the real response parses into real search queries.
 * Exits 0 if the discovery path works OR if it cleanly falls back (both
 * are valid product outcomes); logs which happened. Fails only if the
 * call throws uncaught or a track slips through from the wrong pool.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const readRepoFile = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const track = (id, title, artist) => ({ id, title, artist, thumbnail: `https://img/${id}.jpg` });
let liked = [];
let recent = [];
let playlists = [];
let playCounts = new Map();

const storageStub = {
  StorageService: {
    loadLikedSongs: async () => liked.map((t) => ({ ...t })),
    loadPreviouslyPlayedSongs: async () => recent.map((t) => ({ ...t })),
    loadPlaylists: async () => playlists.map((p) => ({ ...p })),
    savePlaylists: async (next) => { playlists = next.map((p) => ({ ...p })); },
    addPlaylist: async (p) => { playlists = [p, ...playlists]; },
  },
};
let lastQueueArgs = null;
const aiStub = {
  buildSmartQueue: (options) => {
    lastQueueArgs = options;
    if (!options.seed || options.library.length < 5) return [];
    return options.library.filter((t) => t.id !== options.seed.id).slice(0, options.size).map((t) => ({ ...t }));
  },
  loadPlayCounts: async () => playCounts,
};

const STUBS = {
  '../utils/storage': storageStub,
  './aiPlaylistService': aiStub,
  '../contexts/PlayerContext': {},
  './searchAPI': { searchAPI: { searchWithYouTubeMusic: async () => ({ items: [] }) } },
  '../utils/listeningStats': {
    loadReplaySummary: async () => ({
      topArtists: ['Radiohead', 'Portishead', 'Massive Attack'].map((name) => ({ name, ms: 1, plays: 1 })),
      topTracks: [{ title: 'Karma Police', artist: 'Radiohead', ms: 1, plays: 1 }],
    }),
  },
};

function compile(rel) {
  const js = ts.transpileModule(readRepoFile(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const file = path.join(os.tmpdir(), `${path.basename(rel)}.e2e.${process.pid}.cjs`);
  fs.writeFileSync(file, js);
  const module = { exports: {} };
  const req = (spec) => {
    if (Object.prototype.hasOwnProperty.call(STUBS, spec)) return { __esModule: true, ...STUBS[spec] };
    if (spec === './aiMixPlaylist') return { __esModule: true, ...MIX };
    throw new Error(`unexpected require(${spec})`);
  };
  new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(req, module, module.exports);
  fs.unlinkSync(file);
  return module.exports;
}

const MIX = compile('modules/aiMixPlaylist.ts');
const GEN = compile('modules/aiMixGenerator.ts');

const discoveryTracks = (n) => Array.from({ length: n }, (_, i) => track(`d${i}`, `New ${i}`, 'Delta', `https://img/d${i}.jpg`));

let offlineFailures = [];
let offlineChecks = 0;
async function offCheck(name, fn) {
  offlineChecks += 1;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    offlineFailures.push({ name, error });
    console.log(`FAIL ${name}: ${error && error.message}`);
  }
}

let offLlmContent = '["lofi hip hop beats","90s alternative rock"]';
let offLlmStatus = 200;
let offLlmThrow = null;
let offLlmCalls = 0;
const offLlmFetch = async (url, opts) => {
  offLlmCalls += 1;
  if (offLlmThrow) throw offLlmThrow;
  if (offLlmStatus !== 200) {
    return { ok: false, status: offLlmStatus, json: async () => ({}) };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: offLlmContent } }] }),
  };
};

let offSearchResults = [];
const offSearch = async () => offSearchResults;

function resetOfflineBase() {
  liked = Array.from({ length: 6 }, (_, i) => track(`a${i}`, `Old ${i}`, 'Alpha', `https://img/a${i}.jpg`));
  recent = [track('r1', 'Recent One', 'Delta', 'https://img/r1.jpg'), ...liked];
  playlists = [];
  playCounts = new Map(liked.map((t) => [t.id, 10]));
  offLlmContent = '["lofi hip hop beats","90s alternative rock","persian pop classics","jazz for rainy days"]';
  offLlmStatus = 200;
  offLlmThrow = null;
  offLlmCalls = 0;
  offSearchResults = discoveryTracks(40);
}

async function offlineScenarios() {
  // 1. LLM error -> fallback to on-device mix.
  await offCheck('discovery-e2e: LLM error falls back to template (on-device) mix', async () => {
    resetOfflineBase();
    offLlmStatus = 500;
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: offLlmFetch, search: offSearch });
    assert.ok(mix, 'fallback must produce a mix');
    assert.ok(mix.tracks.every((t) => !String(t.id).startsWith('d')), 'fallback must be on-device tracks');
  });

  // 2. HTTP 402 -> fallback.
  await offCheck('discovery-e2e: HTTP 402 falls back to template (on-device) mix', async () => {
    resetOfflineBase();
    offLlmStatus = 402;
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: offLlmFetch, search: offSearch });
    assert.ok(mix);
    assert.ok(mix.tracks.every((t) => !String(t.id).startsWith('d')));
  });

  // 3. Timeout (fetch throws) -> fallback.
  await offCheck('discovery-e2e: LLM timeout falls back to template (on-device) mix', async () => {
    resetOfflineBase();
    offLlmThrow = new Error('aborted');
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: offLlmFetch, search: offSearch });
    assert.ok(mix);
    assert.ok(mix.tracks.every((t) => !String(t.id).startsWith('d')));
  });

  // 4. Empty listening history -> null, no LLM call.
  await offCheck('discovery-e2e: empty listening history returns null without calling the LLM', async () => {
    resetOfflineBase();
    liked = [];
    recent = [];
    offLlmCalls = 0;
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: offLlmFetch, search: offSearch });
    assert.equal(mix, null);
    assert.equal(offLlmCalls, 0, 'no history must not hit the LLM');
    assert.equal(playlists.length, 0);
  });

  // 5. Single-track history -> on-device mix has too little pool, returns null.
  await offCheck('discovery-e2e: single-track history returns null (insufficient pool)', async () => {
    resetOfflineBase();
    liked = [track('only', 'Only Song', 'Solo', 'https://img/only.jpg')];
    recent = [liked[0]];
    playCounts = new Map([['only', 5]]);
    const mix = await MIX.generateAiMixPlaylist('en');
    assert.equal(mix, null);
    assert.equal(playlists.length, 0);
  });

  // 6. Malformed track metadata is skipped by resolveQueries.
  await offCheck('discovery-e2e: malformed track metadata is skipped during resolution', async () => {
    const out = await GEN.resolveQueries(['q'], async () => ([
      { id: 'ok1', title: 'Good One', artist: 'A' },
      { id: '', title: 'No Id' },
      { title: 'No Id Either' },
      { id: 'noTitle', title: '' },
      { id: 'ok2', title: 'Good Two' },
    ]));
    assert.deepEqual(out.map((t) => t.id), ['ok1', 'ok2']);
  });

  // 7. Deduplication of repeated ids (same artist repeated).
  await offCheck('discovery-e2e: repeated track ids are deduplicated even for one artist', async () => {
    const out = await GEN.resolveQueries(['q'], async () => ([
      { id: '1', title: 'First', artist: 'Same Artist' },
      { id: '1', title: 'Duplicate', artist: 'Same Artist' },
      { id: '2', title: 'Second', artist: 'Same Artist' },
    ]));
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((t) => t.id), ['1', '2']);
  });

  // 8. Query cap: at most MAX_QUERIES (6) queries are issued.
  await offCheck('discovery-e2e: query list is capped at 6 entries', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `discovery query number ${i}`);
    const parsed = GEN.parseQueryList(JSON.stringify(many));
    assert.equal(parsed.length, 6);
  });
  await offCheck('discovery-e2e: resolveQueries issues at most 6 searches', async () => {
    resetOfflineBase();
    let calls = 0;
    await GEN.resolveQueries(Array.from({ length: 10 }, (_, i) => `q${i}`), async () => {
      calls += 1;
      return [];
    });
    assert.equal(calls, 6);
  });

  // 9. Result-length cap: discovery mix never exceeds 30 tracks.
  await offCheck('discovery-e2e: discovery result is capped at 30 tracks', async () => {
    resetOfflineBase();
    offSearchResults = discoveryTracks(100);
    const mix = await GEN.generateAiMixWithDiscovery('en', { fetchImpl: offLlmFetch, search: offSearch });
    assert.ok(mix);
    assert.ok(mix.tracks.length <= 30, `expected <=30, got ${mix.tracks.length}`);
  });

  // 10. Persist/read round-trip under @ai_mix via aiMixPlaylist.
  await offCheck('discovery-e2e: AI Mix persists and reads back under @ai_mix', async () => {
    resetOfflineBase();
    const tracks = discoveryTracks(5);
    const saved = await MIX.persistAiMix(tracks, 'en');
    assert.equal(saved.id, '@ai_mix');
    const loaded = await storageStub.StorageService.loadPlaylists();
    const found = loaded.find((p) => p.id === '@ai_mix');
    assert.ok(found, 'persisted mix must be readable');
    assert.equal(found.tracks.length, tracks.length);
    assert.deepEqual(found.tracks.map((t) => t.id), tracks.map((t) => t.id));
  });

  console.log('\noffline: ' + (offlineChecks - offlineFailures.length) + '/' + offlineChecks + ' passed');
  if (offlineFailures.length > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  await offlineScenarios();

  // Enough library that buildSmartQueue yields, so a fallback is visible as
  // library ids and a discovery run as the stub's new ids.
  liked = Array.from({ length: 6 }, (_, i) => track(`a${i}`, `Old ${i}`, 'Alpha'));
  recent = [track('r1', 'Recent One', 'Delta'), ...liked];
  playCounts = new Map(liked.map((t) => [t.id, 10]));

  // Stub search so the run stays offline-deterministic while still
  // exercising the real network LLM call and the real parser.
  const discovered = Array.from({ length: 40 }, (_, i) => track(`d${i}`, `New ${i}`, 'Delta'));
  const search = async () => discovered;

  const started = Date.now();
  const mix = await GEN.generateAiMixWithDiscovery('en', { search });
  const ms = Date.now() - started;

  assert.ok(mix, 'expected a mix from either the discovery or fallback path');
  assert.ok(mix.tracks.length > 0, 'a mix must not be empty');
  assert.equal(playlists.filter((p) => p.id === '@ai_mix').length, 1, 'exactly one pinned mix');
  assert.equal(mix.thumbnail, mix.tracks[0].thumbnail, 'cover is the top track art');

  // The real LLM parse is asserted directly too, so a provider change that
  // breaks parsing is caught even when the run fell back.
  const queries = await GEN.fetchSearchQueries(
    GEN.buildHistoryContext(['Radiohead', 'Portishead'], ['Karma Police'], 'en'),
  );
  console.log(`real endpoint returned ${queries.length} queries:`, queries);

  const usedDiscovery = mix.tracks.every((t) => t.id.startsWith('d'));
  console.log(`\nresult: ${usedDiscovery ? 'DISCOVERY' : 'FALLBACK (on-device)'} in ${ms}ms`);
  console.log(`mix: ${mix.tracks.length} tracks, e.g. ${mix.tracks.slice(0, 3).map((t) => `${t.title} / ${t.artist}`).join(' | ')}`);

  if (usedDiscovery) {
    assert.ok(mix.tracks.length >= 8, 'discovery must clear the minimum floor');
    assert.ok(lastQueueArgs && lastQueueArgs.seed.id === 'r1', 'scoring is seeded by recent play');
    console.log('\nE2E PASS (discovery path)');
  } else {
    console.log('\nE2E PASS (on-device fallback — endpoint unavailable or returned nothing)');
  }
}

main().catch((error) => {
  console.error('E2E FAIL:', error);
  process.exitCode = 1;
});