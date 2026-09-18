/* Run: node tests/local-playback-regression.cjs
 * Execute actual PlayerContext callback bodies, without mounting React Native.
 * Native/network/cache boundaries are injected; no device or network is used.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'contexts/PlayerContext.tsx'), 'utf8');
const ast = ts.createSourceFile('PlayerContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found;
  function visit(node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(found, 'Production callback seam exists');
  return found;
}
function callback(name) {
  return find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name).initializer.arguments[0].getText(ast);
}
function helpers() {
  const file = path.join(root, 'modules/localPlayback.ts');
  if (!fs.existsSync(file)) return {};
  const context = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context.exports;
}
function evaluate(code, env = {}) {
  const context = { ...helpers(), console: { log() {}, warn() {}, error() {} }, ...env };
  return vm.runInNewContext(ts.transpileModule(`const result = (${code});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '\nresult;', context);
}
const local = { id: 'local:53', title: 'Device MP3', source: 'local', _isLocal: true, audioUrl: 'content://media/external/audio/media/53' };
const variants = [local, { ...local, _isLocal: undefined }, { ...local, source: undefined, _isLocal: undefined }, { ...local, audioUrl: undefined, url: local.audioUrl }];

test('local stream resolution preserves URI before cache/network lookup (including restored url-only tracks)', async () => {
  for (const track of variants) {
    let cacheCalls = 0, remoteCalls = 0;
    const resolve = evaluate(callback('resolveTrackStreamUrl'), {
      getFullyCachedAudioUrl: async () => { cacheCalls++; return null; },
      getAudioStreamUrl: async () => { remoteCalls++; return 'https://wrong.example/audio'; },
      resolveTrackSource: () => 'youtube',
    });
    assert.equal(await resolve(track), local.audioUrl);
    assert.equal(cacheCalls, 0, 'device URI must bypass cache lookup');
    assert.equal(remoteCalls, 0);
  }
});

test('foreground resume never resolves or replaces device and downloaded URIs', async () => {
  const effect = find(n => ts.isArrowFunction(n) && n.body.getText(ast).startsWith('{\n    const wasBackgrounded')).getText(ast);
  for (const track of [...variants, { id: 'cached', audioUrl: 'file:///cache/song.mp3', source: 'youtube' }]) {
    let handler, remoteCalls = 0, replacements = 0, cacheCalls = 0;
    evaluate(effect, {
      currentTrack: track, AppState: { addEventListener: (_, fn) => { handler = fn; return { remove() {} }; } },
      flushListeningStats() {}, scrobblerService: { flushPendingOnly: async () => {} },
      lastAppliedCachedUrlRef: { current: null },
      getFullyCachedAudioUrl: async () => { cacheCalls++; return null; },
      resolveTrackSource: () => 'youtube',
      getAudioStreamUrl: async () => { remoteCalls++; return 'https://wrong.example/audio'; },
      trackPlayerService: { updateCurrentTrack: async () => { replacements++; } },
      syncResolvedTrackUrlInState() {},
    })();
    handler('background'); handler('active');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(remoteCalls, 0, 'resume must not treat local as YouTube');
    assert.equal(cacheCalls, 0);
    assert.equal(replacements, 0);
  }
});

test('queue pre-resolution skips local entries but still resolves the next remote entry', async () => {
  const task = find(n => ts.isArrowFunction(n) && n.body.getText(ast).startsWith('{\n              const currentPlayRequestId')).getText(ast);
  const remote = { id: 'remote', title: 'Remote', source: 'youtube' };
  const calls = [], updates = [];
  await evaluate(task, {
    playRequestId: 1, playRequestIdRef: { current: 1 }, PRE_RESOLVE_WINDOW: 3,
    effectiveIndex: 0, effectivePlaylist: [{ id: 'playing' }, local, remote], track: { id: 'playing' },
    resolveTrackSource: () => 'youtube',
    getAudioStreamUrl: async id => { calls.push(id); return 'https://remote.example/audio'; },
    trackPlayerService: { getOriginalIndexToQueueIndex: i => i, updateQueuedTrackUrl: async (...args) => updates.push(args) },
    syncResolvedTrackUrlInState() {},
  })();
  assert.deepEqual(calls, ['remote']);
  assert.deepEqual(updates, [[2, 'https://remote.example/audio']]);
});

test('liked cache scan excludes local tracks and downloaded files', () => {
  const predicate = find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'tracks' && n.initializer?.getText(ast).startsWith('likedSongsRef.current.filter')).initializer.arguments[0].getText(ast);
  const filter = evaluate(predicate, { attemptedTrackIds: new Set(), canceledTrackIdsRef: { current: new Set() } });
  for (const track of [...variants, { id: 'cached', title: 'Cached', audioUrl: 'file:///cache/song.mp3' }]) assert.equal(Boolean(filter(track)), false);
  assert.equal(Boolean(filter({ id: 'remote', title: 'Remote' })), true);
});

test('liked local playback cannot wait for a download-conflict modal', async () => {
  const start = source.indexOf('        const isFullyCached =');
  const end = source.indexOf('        // Reset position and cache tracking', start);
  assert.ok(start > 0 && end > start);
  let reads = 0, modal = 0;
  await evaluate(`async (track) => { ${source.slice(start, end)} }`, {
    activeCacheTrackIdRef: { current: null }, likedSongsRef: { current: [local] },
    getAudioCacheInfo: async () => { reads++; return { isFullyCached: false }; },
    canceledTrackIdsRef: { current: new Set() }, settings: { autoQueueConflictAutoRemove: false },
    queueConflictResolverRef: { current: null },
    setQueueConflictModal: () => { modal++; throw new Error('local track entered download conflict'); },
  })(local);
  assert.equal(reads, 0);
  assert.equal(modal, 0);
});

// A storage snapshot may drop _isLocal; the URI/source remain authoritative.
test('playTrack restores a local url-only queue before native queue construction', () => {
  const start = source.indexOf('      // Determine effective playlist');
  const end = source.indexOf('      // Seed the telemetry', start);
  const prepare = evaluate(`(track, playlistData, index) => { ${source.slice(start, end)} return { track, effectivePlaylist }; }`);
  const restored = { ...local, _isLocal: undefined, audioUrl: undefined, url: local.audioUrl };
  const result = prepare(restored, [restored], 0);
  assert.equal(result.track.audioUrl, local.audioUrl);
  assert.equal(result.effectivePlaylist[0].audioUrl, local.audioUrl);
});

test('local identity without a usable URI fails closed, not through a remote resolver', async () => {
  let calls = 0;
  const resolve = evaluate(callback('resolveTrackStreamUrl'), {
    getFullyCachedAudioUrl: async () => null, resolveTrackSource: () => 'youtube',
    getAudioStreamUrl: async () => { calls++; return 'https://wrong.example/audio'; },
  });
  assert.equal(await resolve({ id: 'local:missing', source: 'local', title: 'Missing' }), undefined);
  assert.equal(calls, 0);
});

test('remote resolution and fully cached remote fallback still work', async () => {
  let calls = 0;
  const resolve = evaluate(callback('resolveTrackStreamUrl'), {
    getFullyCachedAudioUrl: async id => id === 'cached' ? 'file:///cache/cached.mp3' : null,
    resolveTrackSource: () => 'youtube', getAudioStreamUrl: async () => { calls++; return 'https://remote.example/audio'; },
  });
  assert.equal(await resolve({ id: 'remote', source: 'youtube' }), 'https://remote.example/audio');
  assert.equal(await resolve({ id: 'cached', source: 'youtube' }), 'file:///cache/cached.mp3');
  assert.equal(calls, 1);
});
