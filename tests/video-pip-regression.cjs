/* Run: node tests/video-pip-regression.cjs
 * Issue #27 — music video playback + picture-in-picture (YouTube only).
 * Offline: format picking runs against the captured ANDROID_VR player
 * response in tests/fixtures/innertube-player.json, and the live path runs
 * with a stubbed innertube module. No network, no device.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/innertube-player.json'));

// ---------- harness ----------
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e && e.message ? e.message : e}`);
  }
}

// ---------- source utilities ----------
/** Strip comments (block + line) so text contracts cannot match prose. */
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
/** Balanced run starting at index i. */
function balanced(src, i, open, close) {
  let depth = 0, quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`unbalanced '${open}' after: ${String(src.slice(i, i + 60)).replace(/\s+/g, ' ')}`);
}
/** Balanced run of the first `open` that follows `marker` (comments stripped). */
function after(src, marker, open, close) {
  const stripped = stripComments(src);
  const at = stripped.indexOf(marker);
  assert.ok(at >= 0, `missing live-code marker: ${marker}`);
  const i = stripped.indexOf(open, at + marker.length - 1);
  assert.ok(i >= 0, `missing '${open}' after: ${marker}`);
  return balanced(stripped, i, open, close);
}
/** Same, but returns [start, end] indices in the comment-stripped source. */
function toCjs(src, fileName) {
  return ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
    fileName,
  }).outputText;
}
/** Dual-shaped AsyncStorage stub: module.exports + .default + __esModule. */
function asyncStorageStub() {
  const bag = new Map();
  const api = {
    getItem: async (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: async (k, v) => { bag.set(k, String(v)); },
    removeItem: async (k) => { bag.delete(k); },
    multiGet: async (ks) => ks.map((k) => [k, bag.get(k) ?? null]),
  };
  const mod = { __esModule: true, default: api };
  return Object.assign(mod, api);
}
/** Evaluate a repo module as CommonJS with an injectable require(). */
function loadModule(rel, stubs = {}) {
  const code = toCjs(read(rel), rel);
  const mod = { exports: {} };
  const fakeRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (id === '@react-native-async-storage/async-storage') return asyncStorageStub();
    if (id === 'react' || id === 'react-native' || id === 'react-native-video') {
      throw new Error(`unexpected require('${id}') from ${rel}`);
    }
    // Pass-through for sibling modules this check does not care about (e.g.
    // `./innertube` when only the pure format helpers are exercised).
    return {};
  };
  new Function('require', 'module', 'exports', code)(fakeRequire, mod, mod.exports);
  return mod.exports;
}
const quiet = async (fn) => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
};

// ---------- suite ----------
(async () => {
  console.log('video-pip-regression (issue #27)');

  await check('fixture: muxed itag 18 selected, 20 video-only adaptive formats rejected', () => {
    const mv = loadModule('modules/musicVideo.ts');
    const { formats, adaptiveFormats } = fixture.streamingData;
    assert.equal(fixture.playabilityStatus.status, 'OK');
    assert.equal(formats.length, 1);
    const videoOnly = adaptiveFormats.filter((f) => String(f.mimeType).startsWith('video/'));
    const audioOnly = adaptiveFormats.filter((f) => String(f.mimeType).startsWith('audio/'));
    assert.equal(videoOnly.length, 20, 'fixture must still hold 20 video-only adaptive formats');
    assert.equal(audioOnly.length, 4);

    const picked = mv.pickVideoFormat(formats);
    assert.ok(picked, 'muxed progressive must be playable');
    assert.equal(picked.itag, 18);
    assert.equal(mv.formatHeight(picked), 360);
    assert.equal(typeof picked.url, 'string');

    // react-native-video v6 takes ONE source map: video-only cannot be paired
    // with an audio track, so the whole adaptive list is unusable.
    assert.equal(mv.pickVideoFormat(adaptiveFormats), null, 'adaptive list must be rejected');
    assert.equal(mv.pickVideoFormat(videoOnly), null, 'video-only formats rejected');
    assert.equal(mv.pickVideoFormat(audioOnly), null, 'audio-only formats rejected');
    assert.equal(mv.pickVideoFormat([]), null);

    // The muxed pick needs a declared audioQuality (muxed-only field in the
    // player response); ciphered (no plain url) is rejected.
    const muxed = 'video/mp4; codecs="avc1.42001E, mp4a.40.2"';
    assert.equal(mv.pickVideoFormat([{ itag: 18, mimeType: muxed, audioQuality: 'AUDIO_QUALITY_NONE' }]), null, 'silent mux rejected');
    assert.equal(mv.pickVideoFormat([{ itag: 18, mimeType: muxed, audioQuality: 'AUDIO_QUALITY_LOW' }]), null, 'ciphered (no plain url) rejected');
    assert.equal(mv.pickVideoFormat([{ itag: 18, mimeType: muxed, url: 'u' }]), null, 'missing audioQuality (video-only shape) rejected');
    assert.equal(mv.pickVideoFormat([{ itag: 18, mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: 'u' }]), null, 'audio rejected');
  });

  await check('extractYouTubeVideoId: bare id, watch?v=, youtu.be/, /shorts/', () => {
    const mv = loadModule('modules/musicVideo.ts');
    const id = 'dQw4w9WgXcQ';
    assert.equal(mv.extractYouTubeVideoId({ id }), id);
    assert.equal(mv.extractYouTubeVideoId({ id: ` ${id} ` }), id, 'padded id trimmed');
    assert.equal(mv.extractYouTubeVideoId({ id: 'not-an-id', url: `https://www.youtube.com/watch?v=${id}&list=RD` }), id);
    assert.equal(mv.extractYouTubeVideoId({ id: 'saavn:9', url: `https://youtu.be/${id}?si=x` }), id);
    assert.equal(mv.extractYouTubeVideoId({ id: 'sh', url: `https://www.youtube.com/shorts/${id}` }), id);
    assert.equal(mv.extractYouTubeVideoId({ id: 'sh', url: `https://music.youtube.com/watch?v=${id}` }), id);
    assert.equal(mv.extractYouTubeVideoId({ id: 'saavn:9', url: 'https://www.jiosaavn.com/song/x/abc' }), null);
    assert.equal(mv.extractYouTubeVideoId({}), null);
  });

  await check('live path goes through resolveInnertubeStream and never fetches a resolved URL', async () => {
    const resolved = [];
    const stream = {
      videoId: 'dQw4w9WgXcQ', url: 'https://rr4.googlevideo.com/videoplayback?itag=18&sig=one-shot',
      itag: 18, bitrate: 1000000, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      clientName: 'ANDROID_VR', visitorDataUsed: true, mediaHeaders: { 'User-Agent': 'vr-ua' },
    };
    const fetches = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      fetches.push([String(url), init && init.method]);
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    try {
      const mv = loadModule('modules/musicVideo.ts', {
        './innertube': { resolveInnertubeStream: async (id) => { resolved.push(id); return stream; } },
      });
      const res = await quiet(() => mv.resolveMusicVideo({ id: 'dQw4w9WgXcQ' }));
      assert.equal(res.ok, true);
      assert.deepEqual(resolved, ['dQw4w9WgXcQ'], 'exactly one resolution, no client walk here');
      assert.equal(res.video.source.uri, stream.url, 'resolved URL handed straight to the player');
      assert.equal(res.video.source.type, 'mp4');
      assert.deepEqual(res.video.source.headers, { 'User-Agent': 'vr-ua' }, 'media headers carried over');
      assert.deepEqual(fetches, [], 'one-shot rule: this module never fetches a media URL');
      assert.equal(/fetch\s*\(/.test(liveCode('modules/musicVideo.ts')), false, 'no fetch() in the module');

      // Second playback re-resolves rather than replaying a burned URL.
      const again = await quiet(() => mv.resolveMusicVideo({ id: 'dQw4w9WgXcQ' }));
      assert.equal(again.ok, true);
      assert.equal(resolved.length, 2, 'each playback resolves afresh');
      assert.deepEqual(fetches, []);

      const none = loadModule('modules/musicVideo.ts', {
        './innertube': { resolveInnertubeStream: async () => null },
      });
      assert.deepEqual(await quiet(() => none.resolveMusicVideo({ id: 'dQw4w9WgXcQ' })), { ok: false, reason: 'unavailable' });
      assert.deepEqual(await quiet(() => none.resolveMusicVideo({ id: 'saavn:1', url: 'https://saavn/x' })), { ok: false, reason: 'unsupported-track' });
      assert.equal(resolved.length, 2, 'non-YouTube track never reaches the walk');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await check('PiP: enterPictureInPictureOnLeave passed to <Video>, manifest plugin registered', () => {
    const player = liveCode('components/MusicVideoPlayer.tsx');
    // A bare name match would pass `={false}` — the auto-enter on leave must
    // be ENABLED on the live <Video>. Match the spread shorthand or an
    // explicit true on the stripped source.
    assert.match(player, /enterPictureInPictureOnLeave(?!=)/);
    assert.equal(/enterPictureInPictureOnLeave=\{false\}/.test(player), false, 'auto-enter PiP on leave must be ENABLED, not ={false}');
    assert.match(player, /<Video/);
    // Prop must be one react-native-video v6 actually declares.
    const dts = read('node_modules/react-native-video/lib/types/video.d.ts');
    assert.match(dts, /enterPictureInPictureOnLeave\??:\s*boolean/);
    // /android is gitignored and CI runs prebuild --clean: manifest edits must
    // ship as a registered config plugin, not a hand-edited manifest.
    const app = JSON.parse(read('app.json'));
    assert.ok(app.expo.plugins.includes('./plugins/withVideoPip'), 'plugin not registered in app.json');
    assert.equal(fs.existsSync(path.join(root, 'plugins/withVideoPip.js')), true);
  });

  await check('video end closes the overlay and hands the queue to the next track as audio', () => {
    const src = read('components/FullPlayerModal.tsx');
    const block = after(src, 'onEnded={() =>', '{', '}');
    const arrow = '() => ' + block;
    const toggles = [], calls = [];
    const handler = new Function('setShowMusicVideo', 'nextTrack', 'return (' + arrow + ')')(
      (v) => toggles.push(v),
      () => { calls.push('nextTrack'); },
    );
    handler();
    assert.deepEqual(toggles, [false], 'video overlay must close');
    assert.deepEqual(calls, ['nextTrack'], 'queue must advance so the next track plays as audio');

    // The video view only reports the end; it never drives TrackPlayer.
    const player = liveCode('components/MusicVideoPlayer.tsx');
    assert.match(player, /onEnd=\{handleEnd\}/);
    assert.equal(/TrackPlayer|skipToNext|playTrack/.test(player), false, 'video view must not drive the audio queue');
  });

  await check('teardown pauses the video view only — background audio session survives', () => {
    const src = read('components/MusicVideoPlayer.tsx');
    const marker = 'useEffect(() => () => videoRef.current?.pause(), [])';
    assert.ok(src.includes(marker), 'teardown effect missing');
    const arrow = marker.slice('useEffect('.length, marker.length - ', [])'.length);
    const calls = [];
    const ref = { current: { pause: () => calls.push('pause') } };
    const teardown = new Function('videoRef', 'return (' + arrow + ')')(ref);
    teardown()();
    assert.deepEqual(calls, ['pause'], 'teardown must pause this view exactly once');

    const live = liveCode('components/MusicVideoPlayer.tsx');
    for (const forbidden of ['TrackPlayer', 'TrackPlayerService', 'expo-av', 'audioStreaming', 'Audio.', 'Audio ', 'foregroundService', 'clearAudioMonitoring', 'clearPlayer', 'removeListener', 'destroy']) {
      assert.equal(live.includes(forbidden), false, `teardown module touches the audio session: ${forbidden}`);
    }
  });

  await check('track menu carries exactly one "Watch video" row, wired to the player', async () => {
    const src = read('components/FullPlayerModal.tsx');
    const list = after(src, 'const fullSheetOptions = React.useMemo(', '[', ']');
    // Exactly one Watch video row among the existing rows; every row keeps
    // the {key,label,icon} shape of a flat SliderSheet list.
    assert.equal((list.match(/key: "Watch video"/g) ?? []).length, 1, 'exactly one Watch video row');
    assert.equal((list.match(/key: "/g) ?? []).length, (list.match(/icon: "/g) ?? []).length, 'every row keeps the {key,label,icon} shape');
    const atWatch = list.indexOf('key: "Watch video"');
    assert.ok(atWatch >= 0, 'Watch video row present');
    const watch = balanced(list, list.lastIndexOf('{', atWatch), '{', '}');
    assert.match(watch.replace(/\s+/g, ' '), /playerActions\.watchVideo/, 'row label goes through locales (t("playerActions.watchVideo"))');
    assert.match(watch, /videocam-outline/);
    // Existing flat-row sheet hosts it: no new component, section or settings screen.
    assert.match(src, /options=\{playerSheetOptions\}/);
    assert.equal(fs.existsSync(path.join(root, 'components/SliderSheet.tsx')), true);

    // Drive the real handler body: the row must close the sheet and open the
    // player, and nothing else. after() balances the first {...} after the
    // marker, which is only the console.log block — so slice the whole
    // handler body explicitly instead.
    const stripped = read('components/FullPlayerModal.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const hAt = stripped.indexOf('const handleOptionPress = async (option: string) => {');
    assert.ok(hAt >= 0, 'handleOptionPress not found');
    const hBody = balanced(stripped, hAt + 'const handleOptionPress = async (option: string) => '.length, '{', '}');
    const shown = [];
    const run = new Function('setShowMusicVideo', 'closeOptions', 'option',
      'return (async (option) => ' + hBody + ')')(
      (v) => shown.push(['setShowMusicVideo', v]),
      () => shown.push(['closeOptions']),
      'Watch video',
    );
    await quiet(() => run('Watch video'));
    assert.deepEqual(shown, [['closeOptions'], ['setShowMusicVideo', true]], 'row must close the sheet and open the player');
  });

  await check('locale keys exist in en AND fa (real Persian, not English copy)', () => {
    const en = JSON.parse(read('locales/en.json'));
    const fa = JSON.parse(read('locales/fa.json'));
    for (const k of ['watchVideo', 'watchVideoUnavailable', 'videoUnavailable']) {
      assert.ok(typeof en.playerActions?.[k] === 'string' && en.playerActions[k].trim(), `en missing playerActions.${k}`);
      assert.ok(typeof fa.playerActions?.[k] === 'string' && fa.playerActions[k].trim(), `fa missing playerActions.${k}`);
      assert.notEqual(fa.playerActions[k], en.playerActions[k], `fa playerActions.${k} is an English copy`);
      assert.match(fa.playerActions[k], /[\u0600-\u06FF]/, `fa playerActions.${k} has no Persian script`);
    }
    assert.equal(en.playerActions.watchVideo, 'Watch video');
    // Every playerActions key the UI reads must exist in both files.
    const used = liveCode('components/MusicVideoPlayer.tsx') + liveCode('components/FullPlayerModal.tsx');
    for (const m of used.match(/t\("playerActions\.[A-Za-z]+"\)/g) ?? []) {
      const key = m.slice(m.indexOf('playerActions.') + 'playerActions.'.length, -2);
      assert.ok(en.playerActions[key], `UI uses missing en key playerActions.${key}`);
      assert.ok(fa.playerActions[key], `UI uses missing fa key playerActions.${key}`);
    }
  });

  await check('withVideoPip writes PiP manifest attrs and fails loudly without MainActivity', () => {
    const code = read('plugins/withVideoPip.js');
    const build = (activityName, declaredConfigChanges) => {
      const activity = { $: { 'android:name': activityName } };
      if (declaredConfigChanges) activity.$['android:configChanges'] = declaredConfigChanges;
      const cfg = { modResults: { manifest: { application: [{ activity: [activity] }] } } };
      const withAndroidManifest = (config, mod) => { const r = mod(config); config.modResults = r.modResults; return config; };
      const mod_ = { exports: {} };
      const fakeRequire = (id) => {
        if (id === '@expo/config-plugins') return { withAndroidManifest };
        throw new Error(`unexpected require(${id})`);
      };
      new Function('require', 'module', 'exports', code)(fakeRequire, mod_, mod_.exports);
      const fn = typeof mod_.exports === 'function' ? mod_.exports : mod_.exports.default;
      assert.equal(typeof fn, 'function', 'withVideoPip must export the plugin');
      return fn(cfg).modResults.manifest.application[0].activity[0].$;
    };
    const attrs = build('.MainActivity', 'keyboard|keyboardHidden|orientation|screenLayout');
    assert.equal(attrs['android:supportsPictureInPicture'], 'true', 'supportsPictureInPicture must be set');
    const flags = String(attrs['android:configChanges']).split('|');
    for (const f of ['density', 'keyboard', 'keyboardHidden', 'orientation', 'screenSize', 'smallestScreenSize', 'uiMode']) {
      assert.ok(flags.includes(f), `configChanges missing ${f} (PiP resize would restart the activity)`);
    }
    assert.ok(flags.includes('screenLayout'), 'pre-existing screenLayout must be preserved');
    assert.equal(flags.length, new Set(flags).size, 'configChanges must not duplicate flags');
    // Missing MainActivity: prebuild must throw rather than ship PiP-less builds.
    assert.throws(() => build('.OtherActivity', ''), /MainActivity not found/);
  });

  if (failures.length) {
    console.log(`\n${failures.length} FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nall checks passed');
})();
