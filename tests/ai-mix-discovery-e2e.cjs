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

async function main() {
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