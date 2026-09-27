/* Run: node tests/song-recognition-regression.cjs
 * Issue #36 — "what's this song?": bounded mic snippet, AudD adapter behind
 * an injectable fetch, match offered into search/queue.
 * Offline: the provider is a stubbed fetchImpl against a saved AudD-shaped
 * fixture; the recorder runs against a stubbed expo-av module. No network.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function stripComments(src) {
  const out = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.Preserve },
    reportDiagnostics: false,
  }).outputText;
  return out.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function liveCode(rel) {
  const src = read(rel);
  return rel.endsWith('.tsx') || rel.endsWith('.ts') ? stripComments(src) : src;
}

const failures = [];
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e && e.message ? e.message : e}`);
  }
}

/* ---------- source utilities ---------- */
function balanced(src, i, open, close) {
  let depth = 0, quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`unbalanced '${open}'`);
}
function after(src, marker, open, close) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `missing live-code marker: ${marker}`);
  const i = src.indexOf(open, at + marker.length - 1);
  assert.ok(i >= 0, `missing '${open}' after: ${marker}`);
  return balanced(src, i, open, close);
}

/* ---------- module loading with stubbed react-native deps ---------- */
function loadRecognition(stubs = {}) {
  const src = ts.transpileModule(read('modules/songRecognition.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
    reportDiagnostics: false,
  }).outputText;
  const mod = { exports: {} };
  const defaultStubs = {
    'expo-av': { Audio: { requestPermissionsAsync: async () => ({ granted: true }) } },
    'expo-file-system': { deleteAsync: async () => {} },
    'expo-constants': { expoConfig: { extra: { auddToken: 'TESTTOKEN' } } },
  };
  const merged = Object.assign({}, defaultStubs, stubs);
  const fakeRequire = (id) => {
    if (merged[id] !== undefined) return merged[id];
    throw new Error(`unexpected require: ${id}`);
  };
  new Function('require', 'module', 'exports', src)(fakeRequire, mod, mod.exports);
  return mod.exports;
}

const FIXTURE_HIT = {
  status: 'success',
  result: {
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    songlet: { confidence: 0.97 },
    spotify: { thumbnail: 'https://i.scdn.co/image/abc123' },
  },
};
const FIXTURE_MISS = { status: 'success', result: null };

function fakeFetch(payload, { calls = null, ok = true } = {}) {
  return async (url, init) => {
    if (calls) calls.push({ url, init });
    return {
      ok,
      json: async () => payload,
    };
  };
}

(async () => {
  await check('absent token -> not_configured, NO network call', async () => {
    const calls = [];
    const rec = loadRecognition({
      'expo-constants': { expoConfig: { extra: {} } },
    });
    const out = await rec.recognize('file:///x.m4a', fakeFetch(FIXTURE_HIT, { calls }));
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'not_configured');
    assert.equal(calls.length, 0, 'must not touch the network without a token');
    assert.equal(rec.isRecognitionConfigured(), false);
  });

  await check('fixture hit -> typed match, never fabricated', async () => {
    const rec = loadRecognition();
    const out = await rec.recognize('file:///x.m4a', fakeFetch(FIXTURE_HIT));
    assert.equal(out.ok, true);
    assert.equal(out.match.title, 'Bohemian Rhapsody');
    assert.equal(out.match.artist, 'Queen');
    assert.equal(out.match.provider, 'audd');
    assert.ok(out.match.confidence > 0 && out.match.confidence <= 1);
  });

  await check('miss + malformed payload -> typed failure, never a fake match', async () => {
    const rec = loadRecognition();
    for (const bad of [FIXTURE_MISS, {}, null, { status: 'error' }, { status: 'success', result: { title: '' } }]) {
      const out = await rec.recognize('file:///x.m4a', fakeFetch(bad));
      assert.equal(out.ok, false, `payload ${JSON.stringify(bad)} must not match`);
      assert.ok(['no_match', 'bad_response'].includes(out.reason), `unexpected reason ${out.reason}`);
    }
  });

  await check('network failure -> network reason', async () => {
    const rec = loadRecognition();
    const out = await rec.recognize('file:///x.m4a', async () => { throw new Error('down'); });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'network');
    const out2 = await rec.recognize('file:///x.m4a', fakeFetch(FIXTURE_HIT, { ok: false }));
    assert.equal(out2.ok, false);
    assert.equal(out2.reason, 'network');
  });

  await check('snippet deleted after submit unless kept', async () => {
    const deleted = [];
    const rec = loadRecognition({
      'expo-file-system': { deleteAsync: async (uri) => { deleted.push(uri); } },
    });
    assert.equal(await rec.finalizeSnippet('file:///clip.m4a', false), true);
    assert.deepEqual(deleted, ['file:///clip.m4a']);
    assert.equal(await rec.finalizeSnippet('file:///clip.m4a', true), false);
    assert.equal(deleted.length, 1, 'keep=true must not delete');
    assert.equal(await rec.finalizeSnippet('', false), false);
  });

  await check('permission denied -> typed failure', async () => {
    const rec = loadRecognition({
      'expo-av': { Audio: { requestPermissionsAsync: async () => ({ granted: false }) } },
    });
    const out = await rec.recordSnippet();
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'permission_denied');
  });

  await check('hard max snippet bound exists and is enforced in code', () => {
    const src = liveCode('modules/songRecognition.ts');
    assert.equal(/MAX_SNIPPET_MS\s*=\s*8000/.test(src), true, 'MAX must be 8000ms');
    assert.ok(src.includes('>= MAX_SNIPPET_MS'), 'self-stop at the bound required');
    assert.ok(/setTimeout\(resolve,\s*MAX_SNIPPET_MS\)/.test(src), 'bounded wait required');
    assert.equal(/MIN_SNIPPET_MS\s*=\s*5000/.test(src), true, 'MIN must be 5000ms');
  });

  await check('queue path uses seeded buildSmartQueue, never bare', () => {
    const src = liveCode('components/FullPlayerModal.tsx');
    assert.match(src, /handleRecognizeQueue/);
    // Seeded object form present in the recognize-queue handler.
    const hAt = src.indexOf('const handleRecognizeQueue = async');
    assert.ok(hAt >= 0, 'handleRecognizeQueue not found');
    const hBody = after(src, 'const handleRecognizeQueue = async', '{', '}');
    assert.match(hBody, /buildSmartQueue\(\{\s*seed:?,?\s*seedTrack|buildSmartQueue\(\{/);
    assert.match(hBody, /seed/);
    // Bare call (empty args / seedless) must not appear in this handler.
    assert.equal(/buildSmartQueue\(\s*\)/.test(hBody), false, 'bare buildSmartQueue returns []');
    assert.ok(hBody.includes('buildRadioQueue'), 'empty smart queue falls back to radio');
  });

  await check('search path goes through existing searchAPI, plays first hit', () => {
    const src = liveCode('components/FullPlayerModal.tsx');
    assert.ok(src.includes('const handleRecognizeSearch = async'), 'handleRecognizeSearch not found');
    const hBody = after(src, 'const handleRecognizeSearch = async', '{', '}');
    assert.match(hBody, /searchAPI\.searchMixed/);
    assert.match(hBody, /playTrack\(playable\[0\],\s*playable,\s*0\)/);
  });

  await check('menu carries exactly one "Identify this song" row, sheet closes', async () => {
    const src = read('components/FullPlayerModal.tsx');
    const list = after(stripComments(src), 'const fullSheetOptions = React.useMemo(', '[', ']');
    assert.equal((list.match(/key: "Identify this song"/g) ?? []).length, 1, 'exactly one row');
    assert.match(list, /mic-outline/);
    // Row handler: open the sheet.
    const stripped = stripComments(src);
    const hAt = stripped.indexOf('const handleOptionPress = async (option) => {');
    assert.ok(hAt >= 0, 'handleOptionPress not found');
    const hBody = balanced(stripped, hAt + 'const handleOptionPress = async (option) => '.length, '{', '}');
    assert.match(hBody, /if \(option === "Identify this song"\) \{\s*setShowIdentifySheet\(true\);/);
    // Sheet mounted with both callbacks.
    assert.match(stripped, /<SongIdentifySheet[\s\S]*?onSearchInApp=\{handleRecognizeSearch\}[\s\S]*?onAddToQueue=\{handleRecognizeQueue\}/);
  });

  await check('sheet has the full state machine, no fabricated match', () => {
    const src = liveCode('components/SongIdentifySheet.tsx');
    for (const s of ['"idle"', '"recording"', '"submitting"', '"result"', '"not_configured"', '"no_match"', '"permission_denied"', '"network"']) {
      assert.ok(src.includes(s), `missing state ${s}`);
    }
    assert.match(src, /recognize\(recorded\.uri\)/);
    assert.equal(/Bohemian|Queen|Fake Song|test match/i.test(src), false, 'sheet must never hardcode a match');
  });

  await check('privacy: recorder self-stops, clip discarded on close path', () => {
    const src = liveCode('components/SongIdentifySheet.tsx');
    assert.match(src, /finalizeSnippet\(\s*uri,\s*keepRef\.current\s*\)/);
    assert.match(src, /discardSnippet\(/);
    assert.match(src, /remainingSnippetMs\(/);
    const mod = liveCode('modules/songRecognition.ts');
    assert.match(mod, /finalizeSnippet/);
    assert.match(mod, /idempotent: true/);
  });

  await check('locale keys exist in en AND fa (real Persian, not English copy)', () => {
    const en = JSON.parse(read('locales/en.json'));
    const fa = JSON.parse(read('locales/fa.json'));
    for (const k of ['title', 'subtitle', 'start', 'notConfiguredBody', 'noMatchBody', 'permissionDeniedBody', 'searchInApp', 'addToQueue']) {
      assert.ok(typeof en.songIdentify?.[k] === 'string' && en.songIdentify[k].trim(), `en missing songIdentify.${k}`);
      assert.ok(typeof fa.songIdentify?.[k] === 'string' && fa.songIdentify[k].trim(), `fa missing songIdentify.${k}`);
      assert.notEqual(fa.songIdentify[k], en.songIdentify[k], `fa songIdentify.${k} is an English copy`);
      assert.match(fa.songIdentify[k], /[\u0600-\u06FF]/, `fa songIdentify.${k} has no Persian script`);
    }
    assert.equal(en.songIdentify.title, "What's this song?");
  });

  await check('app.json exposes auddToken slot under extra', () => {
    const app = JSON.parse(read('app.json'));
    assert.ok(app.expo && typeof app.expo.extra === 'object', 'extra missing');
    assert.ok('auddToken' in app.expo.extra, 'auddToken slot missing from expo.extra');
  });

  console.log(failures.length === 0 ? `\nALL ${14} PASS` : `\n${failures.length} FAILED: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
})();
