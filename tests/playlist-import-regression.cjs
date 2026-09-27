/* Run: node tests/playlist-import-regression.cjs
 *
 * Issue #65 — playlist import.
 *
 * The pure halves (URL classification, Innertube browse parsing, SoundCloud
 * payload parsing, track mapping) are RUNTIME-driven here against fixtures
 * captured from real responses under tests/fixtures/. The storage/UI half is
 * contract-checked against the file contents, because those import graph roots
 * (AsyncStorage / react-native) cannot load under Node.
 *
 * No network access.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => console.log(`ok   ${name}`),
        (error) => {
          failures.push({ name, error });
          console.log(`FAIL ${name}: ${error && error.message}`);
        },
      );
    }
    console.log(`ok   ${name}`);
    return Promise.resolve();
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${error && error.message}`);
    return Promise.resolve();
  }
}

function readRepoFile(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function readJson(relative) {
  return JSON.parse(readRepoFile(relative));
}

// ---- load the module under test -------------------------------------------
// transpile playlistImport.ts and stub the RN-only imports. TS emits
// __importStar/__importDefault, so every stub is dual-shaped.
function loadImageModule() {
  // components/core/image.ts has no imports, so it loads under Node as-is.
  const js = ts.transpileModule(readRepoFile('components/core/image.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', js)(
    () => {
      throw new Error('components/core/image.ts must have no imports');
    },
    module,
    module.exports,
  );
  return module.exports;
}

const STUBS = {
  '../components/core/api': { getBeatseekApiBase: () => 'https://beatseek.io/api' },
  '../components/core/image': loadImageModule(),
  './subsonicService': { subsonicService: { getPlaylist: async () => ({ name: '', coverArtUrl: null, tracks: [] }) } },
  '../contexts/PlayerContext': {},
  '../utils/storage': { StorageService: { addPlaylist: async () => {} } },
};

function loadPlaylistImport() {
  const file = path.join(root, 'modules', 'playlistImport.ts');
  const js = ts.transpileModule(readRepoFile('modules/playlistImport.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiled = path.join(os.tmpdir(), `playlistImport.${process.pid}.cjs`);
  fs.writeFileSync(compiled, js);
  const module = { exports: {} };
  const stubRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
      return { __esModule: true, ...STUBS[specifier] };
    }
    throw new Error(`unexpected require(${specifier}) in playlistImport.ts`);
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

const IMPORT = loadPlaylistImport();

// ---- fixtures --------------------------------------------------------------
const ytmPage1 = readJson('tests/fixtures/ytm-playlist-browse-page1.json');
const ytmPage2 = readJson('tests/fixtures/ytm-playlist-browse-page2.json');
const soundcloudPlaylist = readJson('tests/fixtures/soundcloud-playlist.json');

async function main() {
  // ---- URL classification -------------------------------------------------

  await check('parsePlaylistUrl: youtube.com playlist link is youtube', () => {
    const parsed = IMPORT.parsePlaylistUrl(
      'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );
    assert.equal(parsed.kind, 'youtube');
    assert.equal(parsed.playlistId, 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  });

  await check('parsePlaylistUrl: music.youtube.com link keeps the youtubemusic source', () => {
    const parsed = IMPORT.parsePlaylistUrl(
      'https://music.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );
    assert.equal(parsed.kind, 'youtubemusic');
    assert.equal(parsed.playlistId, 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  });

  await check('parsePlaylistUrl: youtu.be short link and scheme-less paste both work', () => {
    const short = IMPORT.parsePlaylistUrl(
      'https://youtu.be/fOT0BUpITw8?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );
    assert.equal(short.kind, 'youtube');
    assert.equal(
      short.playlistId,
      'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );
    const bare = IMPORT.parsePlaylistUrl(
      'music.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
    );
    assert.equal(bare.kind, 'youtubemusic');
  });

  await check('parsePlaylistUrl: SoundCloud set URL keeps the permalink', () => {
    const parsed = IMPORT.parsePlaylistUrl(
      'https://soundcloud.com/relaxcafemusic/sets/coffee-jazz',
    );
    assert.equal(parsed.kind, 'soundcloud');
    assert.equal(
      parsed.playlistId,
      'https://soundcloud.com/relaxcafemusic/sets/coffee-jazz',
    );
  });

  await check('parsePlaylistUrl: a YouTube video link with no list is rejected', () => {
    const parsed = IMPORT.parsePlaylistUrl('https://www.youtube.com/watch?v=fOT0BUpITw8');
    assert.ok(parsed.unsupported, 'video-only link must not resolve to a playlist');
  });

  await check('parsePlaylistUrl: SoundCloud track (not a set) is rejected', () => {
    const parsed = IMPORT.parsePlaylistUrl(
      'https://soundcloud.com/relaxcafemusic/cheerful-smile',
    );
    assert.ok(parsed.unsupported);
  });

  await check('parsePlaylistUrl: a Subsonic rest URL keeps its playlist id', () => {
    const parsed = IMPORT.parsePlaylistUrl(
      'https://nav.example/rest/getPlaylist.view?id=42',
    );
    assert.equal(parsed.kind, 'subsonic');
    assert.equal(parsed.playlistId, '42');
  });

  await check('parsePlaylistUrl: unsupported hosts and blanks never throw', () => {
    for (const value of ['', '   ', 'not a url', 'https://deezer.com/playlist/123', 'https://x.com/']) {
      const parsed = IMPORT.parsePlaylistUrl(value);
      assert.ok(parsed.unsupported, `expected unsupported for ${JSON.stringify(value)}`);
    }
  });

  // ---- Innertube browse parsing (real fixture) ----------------------------

  await check('parseYoutubeBrowseResponse: reads header title, artwork and next token', () => {
    const page = IMPORT.parseYoutubeBrowseResponse(ytmPage1);
    assert.equal(page.name, 'Popular Music Videos');
    assert.ok(page.owner.length > 0, 'header subtitle must yield an owner');
    assert.ok(page.thumbnail.startsWith('http'), 'header artwork must be picked up');
    assert.ok(page.continuation.length > 20, 'page 1 must expose a continuation token');
  });

  await check('parseYoutubeBrowseResponse: reads every shelf item into id/title/artist/duration', () => {
    const page = IMPORT.parseYoutubeBrowseResponse(ytmPage1);
    assert.equal(page.items.length, 4);
    const first = page.items[0];
    assert.equal(first.videoId, 'fOT0BUpITw8');
    assert.equal(first.title, 'BELLAKEO');
    assert.equal(first.artist, 'Peso Pluma & Anitta');
    assert.equal(first.duration, 235);
    assert.ok(first.thumbnail.includes('ytimg.com'), 'track artwork must be read');
    for (const item of page.items) {
      assert.match(item.videoId, /^[A-Za-z0-9_-]{11}$/, `bad videoId ${item.videoId}`);
      assert.ok(item.title.length > 0, 'every item needs a title');
    }
  });

  await check('parseYoutubeBrowseResponse: continuation page items parse and stop paging', () => {
    const page = IMPORT.parseYoutubeBrowseResponse(ytmPage2);
    assert.equal(page.items.length, 4);
    assert.equal(page.continuation, '', 'a final page must report no further token');
    for (const item of page.items) assert.match(item.videoId, /^[A-Za-z0-9_-]{11}$/);
  });

  await check('parseClockDuration: only clock strings convert, live stays 0', () => {
    assert.equal(IMPORT.parseClockDuration('3:55'), 235);
    assert.equal(IMPORT.parseClockDuration('1:02:03'), 3723);
    for (const value of ['', 'LIVE', '3:55:99x', 'abc']) {
      assert.equal(IMPORT.parseClockDuration(value), 0, `bad parse for ${value}`);
    }
  });

  await check('parseYoutubeListItem: an item without a title or id is dropped', () => {
    assert.equal(IMPORT.parseYoutubeListItem(null), null);
    assert.equal(
      IMPORT.parseYoutubeListItem({ musicResponsiveListItemRenderer: { flexColumns: [] } }),
      null,
    );
  });

  // ---- SoundCloud parsing (real fixture) ---------------------------------

  await check('parseSoundCloudPlaylistPayload: maps beats->seconds, artwork and permalink id', () => {
    const page = IMPORT.parseSoundCloudPlaylistPayload(soundcloudPlaylist);
    assert.equal(page.name, 'Coffee Jazz');
    assert.equal(page.tracks.length, 3);
    const first = page.tracks[0];
    assert.equal(first.title, 'Cheerful Smile');
    assert.equal(first.artist, 'Relax Cafe Music BGM');
    assert.equal(first.duration, 147);
    assert.equal(
      first.url,
      'https://soundcloud.com/relaxcafemusic/cheerful-smile',
    );
    assert.ok(first.thumbnail.includes('t500x500'), 'artwork must be upscaled');
    assert.equal(first._isSoundCloud, true);
    assert.equal(page.skipped.length, 0);
  });

  await check('parseSoundCloudPlaylistPayload: unplayable rows are reported, never dropped silently', () => {
    const page = IMPORT.parseSoundCloudPlaylistPayload({
      playlistTitle: 'Partial',
      tracks: [
        { title: 'Kept', url: 'https://soundcloud.com/a/b', duration: 1000 },
        { title: 'No permalink', url: '', duration: 1000 },
        { title: '', url: 'https://soundcloud.com/a/c' },
      ],
    });
    assert.equal(page.tracks.length, 1);
    assert.equal(page.skipped.length, 2);
  });

  // ---- track mapping + storage path ---------------------------------------

  await check('toImportedTracks: maps every field the player reads, flags intact', () => {
    const tracks = IMPORT.toImportedTracks([
      {
        id: 'fOT0BUpITw8',
        title: 'BELLAKEO',
        artist: 'Peso Pluma',
        duration: 235,
        thumbnail: 'https://i.ytimg.com/x.jpg',
        url: 'https://music.youtube.com/watch?v=fOT0BUpITw8&list=PL1',
        source: 'youtubemusic',
      },
      {
        id: 'https://soundcloud.com/a/b',
        title: 'Kept',
        artist: 'Someone',
        duration: 147,
        thumbnail: '',
        url: 'https://soundcloud.com/a/b',
        source: 'soundcloud',
        _isSoundCloud: true,
      },
      {
        id: 'srv-1',
        title: 'Server track',
        artist: 'Band',
        duration: 200,
        thumbnail: '',
        url: 'https://nav.example/rest/stream.view?id=srv-1',
        source: 'subsonic',
        _isSubsonic: true,
        audioUrl: 'https://nav.example/rest/stream.view?id=srv-1',
      },
    ]);
    assert.equal(tracks[0].id, 'fOT0BUpITw8');
    assert.equal(tracks[0].source, 'youtubemusic');
    assert.equal(tracks[1]._isSoundCloud, true);
    // A Subsonic track must play from its server URL, never a remote resolver.
    assert.equal(tracks[2]._isSubsonic, true);
    assert.equal(tracks[2].audioUrl, 'https://nav.example/rest/stream.view?id=srv-1');
  });

  await check('importPlaylistAsLocalPlaylist: writes through StorageService.addPlaylist', async () => {
    const written = [];
    const module = { exports: {} };
    const js = ts.transpileModule(readRepoFile('modules/playlistImport.ts'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const compiled = path.join(os.tmpdir(), `playlistImport.write.${process.pid}.cjs`);
    fs.writeFileSync(compiled, js);
    const stubs = {
      ...STUBS,
      '../utils/storage': {
        StorageService: { addPlaylist: async (playlist) => { written.push(playlist); } },
      },
    };
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', fs.readFileSync(compiled, 'utf8'))(
      (specifier) => {
        if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
          return { __esModule: true, ...stubs[specifier] };
        }
        throw new Error(`unexpected require(${specifier})`);
      },
      module,
      module.exports,
    );
    fs.unlinkSync(compiled);

    const stored = await module.exports.importPlaylistAsLocalPlaylist({
      source: 'youtubemusic',
      sourceId: 'PL1',
      sourceUrl: 'https://music.youtube.com/playlist?list=PL1',
      name: 'Popular Music Videos',
      owner: 'Music',
      thumbnail: '',
      tracks: IMPORT.toImportedTracks(
        IMPORT.parseYoutubeBrowseResponse(ytmPage1).items.map((item) => ({
          ...item,
          url: `https://music.youtube.com/watch?v=${item.videoId}&list=PL1`,
          source: 'youtubemusic',
        })),
      ),
      skipped: [],
    });
    assert.equal(written.length, 1, 'playlist must be persisted exactly once');
    assert.equal(written[0].name, 'Popular Music Videos');
    assert.equal(written[0].description, 'https://music.youtube.com/playlist?list=PL1');
    assert.equal(written[0].tracks.length, 4);
    assert.ok(stored.id.startsWith('youtubemusic:PL1:'), 'id must be namespaced by origin');
    assert.ok(stored.createdAt && stored.updatedAt);
  });

  // ---- wiring / storage contract ------------------------------------------

  await check('import path goes through StorageService, not a raw AsyncStorage write', () => {
    const source = readRepoFile('modules/playlistImport.ts');
    assert.match(source, /await StorageService\.addPlaylist\(/);
    assert.ok(!/AsyncStorage/.test(source), 'playlistImport must not write AsyncStorage directly');
  });

  await check('normalizePlaylistSnapshot dedupe applies to imported tracks (same Track shape)', () => {
    const storage = readRepoFile('utils/storage.ts');
    assert.match(storage, /async addPlaylist\(playlist: Playlist\)/);
    assert.match(storage, /async savePlaylists\(playlists: Playlist\[\]\)/);
    assert.match(storage, /normalizePlaylistSnapshot/);
    // The importer must not define a second Track shape.
    const source = readRepoFile('modules/playlistImport.ts');
    assert.match(source, /import type \{ Track \} from "\.\.\/contexts\/PlayerContext"/);
  });

  await check('Subsonic playlist read uses getPlaylist.view on the configured server', () => {
    const source = readRepoFile('modules/subsonicService.ts');
    assert.match(source, /async getPlaylist\(/);
    assert.match(source, /request\(config, "getPlaylist", \{ id: playlistId \}\)/);
    assert.match(source, /async getPlaylistList\(/);
    assert.match(source, /request\(config, "getPlaylistList"\)/);
  });

  await check('the import sheet is mounted from the Library screen with a refresh callback', () => {
    const library = readRepoFile('components/screens/LibraryScreen.tsx');
    assert.match(library, /import \{ PlaylistImportSheet \} from "\.\.\/PlaylistImportSheet"/);
    assert.match(library, /<PlaylistImportSheet/);
    assert.match(library, /visible=\{showImportPlaylistSheet\}/);
    assert.match(library, /setShowImportPlaylistSheet\(true\)/);
    assert.match(library, /onImported=\{\(\) => \{\s*void loadPlaylists\(\);/);
  });

  await check('the sheet wires resolve -> preview -> import through the module', () => {
    const sheet = readRepoFile('components/PlaylistImportSheet.tsx');
    assert.match(sheet, /resolvePlaylistImport/);
    assert.match(sheet, /importPlaylistAsLocalPlaylist/);
    // Result preview is what the acceptance criteria ask for.
    assert.match(sheet, /result\.tracks\.slice\(0, 5\)/);
    // Unmatched/skipped count is surfaced, not swallowed.
    assert.match(sheet, /result\.skipped\.length/);
    assert.match(sheet, /t\("library\.importPlaylistSkipped", \{\s*count: result\.skipped\.length,/);
  });

  await check('every browse request carries its own timeout (innertube chain rule)', () => {
    const source = readRepoFile('modules/playlistImport.ts');
    const fetches = source.match(/await fetch\(/g) || [];
    const aborts = source.match(/new AbortController\(\)/g) || [];
    assert.ok(fetches.length >= 2, 'both the browse and beatseek calls exist');
    assert.equal(
      aborts.length,
      fetches.length,
      'every fetch in the import chain needs its own AbortController',
    );
  });

  await check('locale keys exist in both languages and match each other', () => {
    const en = readJson('locales/en.json');
    const fa = readJson('locales/fa.json');
    const keys = Object.keys(en).filter((key) => key.startsWith('library.importPlaylist'));
    assert.ok(keys.length >= 10, 'expected the full import copy set');
    for (const key of keys) {
      assert.ok(fa[key], `missing fa locale for ${key}`);
      assert.notEqual(fa[key], key, `fa locale for ${key} is untranslated`);
      // The real failure mode is an English string pasted into the fa file.
      // (URL placeholders are meant to be identical.)
      if (!/^https?:\/\//.test(en[key])) {
        assert.notEqual(fa[key], en[key], `fa locale for ${key} is still the English copy`);
        assert.match(fa[key], /[\u0600-\u06FF]/, `fa locale for ${key} has no Persian text`);
      }
    }
    // The sheet must not fall back to raw keys.
    const sheet = readRepoFile('components/PlaylistImportSheet.tsx');
    for (const key of keys) {
      if (key === 'library.importPlaylistSkipped') continue;
      assert.match(sheet, new RegExp(`t\\("${key.replace(/\./g, '\\.')}"`), `sheet never uses ${key}`);
    }
  });

  await check('unsupported sources (m3u, Deezer, iTunes) are refused, not half-imported', () => {
    const source = readRepoFile('modules/playlistImport.ts');
    assert.match(source, /if \(parsed\.kind === "m3u"\)/);
    assert.match(source, /throw new Error\("Unsupported playlist link \(m3u\)"\)/);
    assert.match(source, /throw new Error\(`Unsupported playlist link \(\$\{parsed\.unsupported\}\)`\)/);
  });

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) {
    for (const failure of failures) {
      console.log(`\n--- ${failure.name}\n${failure.error && failure.error.stack}`);
    }
    process.exit(1);
  }
}

main();
