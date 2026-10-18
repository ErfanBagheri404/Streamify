/* Run: node tests/cache-queue-notify-regression.cjs
 * Covers the cache-queue system notification added for issue #94:
 *   - copy for both locales (progress / cooldown / finished)
 *   - the post gate (text-diff + throttle + force transition bypass)
 *   - counter arithmetic and its clamps
 *   - PlayerContext wiring: one gated entry point, settings-off dismiss,
 *     locale read from a live ref, and per-run seeding
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

function load(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const context = { exports: {}, console };
  vm.runInNewContext(
    ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    context,
  );
  return context.exports;
}

const notify = load('modules/cacheQueueNotify.ts');

/* ---------------- copy ---------------- */

test('en copy reports remaining count, cooldown, and completion', () => {
  const progress = notify.cacheQueueNotifyCopy({
    total: 40, remaining: 12, cooldownSeconds: 0, language: 'en',
  });
  assert.equal(progress.title, 'Caching liked songs');
  assert.equal(progress.body, '12 of 40 remaining');

  const cooldown = notify.cacheQueueNotifyCopy({
    total: 40, remaining: 12, cooldownSeconds: 180, language: 'en',
  });
  assert.match(cooldown.body, /batch cooldown/);

  const done = notify.cacheQueueNotifyCopy({
    total: 40, remaining: 0, cooldownSeconds: 0, language: 'en',
  });
  assert.equal(done.body, 'All songs cached');
});

test('fa copy is real Persian, not English passthrough', () => {
  const progress = notify.cacheQueueNotifyCopy({
    total: 40, remaining: 12, cooldownSeconds: 0, language: 'fa',
  });
  assert.equal(progress.title, 'در حال ذخیره‌سازی آهنگ‌های لایک‌شده');
  assert.match(progress.body, /باقی مانده/);
  assert.doesNotMatch(progress.body, /[A-Za-z]{3,}/);

  const done = notify.cacheQueueNotifyCopy({
    total: 40, remaining: 0, cooldownSeconds: 0, language: 'fa',
  });
  assert.equal(done.body, 'همه آهنگ‌ها ذخیره شدند');
});

test('cooldown copy never claims a remaining count (states are exclusive)', () => {
  const cooldown = notify.cacheQueueNotifyCopy({
    total: 40, remaining: 12, cooldownSeconds: 180, language: 'en',
  });
  assert.doesNotMatch(cooldown.body, /remaining/);
});

test('a finished run never shows "0 of 40 remaining"', () => {
  // Guard against the notification dismissing with progress-looking copy.
  const done = notify.cacheQueueNotifyCopy({
    total: 40, remaining: 0, cooldownSeconds: 0, language: 'en',
  });
  assert.doesNotMatch(done.body, /0 of/);
});

/* ---------------- cooldown formatting ---------------- */

test('formatCooldown keeps sub-minute values in seconds and rounds up', () => {
  assert.equal(notify.formatCooldown(0), '0s');
  assert.equal(notify.formatCooldown(45), '45s');
  assert.equal(notify.formatCooldown(61), '1m 1s');
  assert.equal(notify.formatCooldown(180), '3m');
});

/* ---------------- post gate ---------------- */

test('identical copy never reposts, even when forced', () => {
  const input = {
    next: '12 of 40 remaining', last: '12 of 40 remaining',
    lastPostedAt: 0, now: 999_999,
  };
  assert.equal(notify.shouldPostCacheNotification(input), false);
  assert.equal(notify.shouldPostCacheNotification({ ...input, force: true }), false);
});

test('first post lands immediately regardless of timestamp', () => {
  assert.equal(notify.shouldPostCacheNotification({
    next: '13 of 40 remaining', last: null, lastPostedAt: null, now: 5,
  }), true);
});

test('changed copy inside the throttle window is dropped', () => {
  assert.equal(notify.shouldPostCacheNotification({
    next: '12 of 40 remaining', last: '13 of 40 remaining',
    lastPostedAt: 10_000, now: 10_000 + notify.NOTIFY_MIN_INTERVAL_MS - 1,
  }), false);
});

test('the cooldown transition is not swallowed by the throttle', () => {
  // Entering a cooldown lands ~8s after the previous post (inter-track
  // delay); without force the "resuming in" line would silently vanish.
  const entered = notify.shouldPostCacheNotification({
    next: 'Resuming in 3m (batch cooldown)', last: '12 of 40 remaining',
    lastPostedAt: 10_000, now: 18_000, force: true,
  });
  assert.equal(entered, true);

  // Leaving it must land too, or the shade keeps the stale countdown.
  const exited = notify.shouldPostCacheNotification({
    next: '12 of 40 remaining', last: 'Resuming in 3m (batch cooldown)',
    lastPostedAt: 18_000, now: 20_000, force: true,
  });
  assert.equal(exited, true);
});

test('force never bypasses the text-diff requirement', () => {
  assert.equal(notify.shouldPostCacheNotification({
    next: '12 of 40 remaining', last: '12 of 40 remaining',
    lastPostedAt: 10_000, now: 20_000, force: true,
  }), false);
});

test('posts resume on their own once the throttle window elapses', () => {
  assert.equal(notify.shouldPostCacheNotification({
    next: '11 of 40 remaining', last: '12 of 40 remaining',
    lastPostedAt: 10_000,
    now: 10_000 + notify.NOTIFY_MIN_INTERVAL_MS,
  }), true);
});

/* ---------------- counters ---------------- */

test('remaining is total minus seeded cache minus this run', () => {
  const r = notify.cacheQueueCounters({ total: 40, finishedInRun: 10, alreadyCachedBeforeRun: 6 });
  assert.equal(r.total, 40);
  assert.equal(r.remaining, 24);
});

test('counters clamp instead of going negative', () => {
  const over = notify.cacheQueueCounters({ total: 5, finishedInRun: 50, alreadyCachedBeforeRun: 0 });
  assert.equal(over.total, 5);
  assert.equal(over.remaining, 0);
  // NaN / undefined from a broken caller must not produce NaN copy.
  const nan = notify.cacheQueueCounters({ total: undefined, finishedInRun: undefined, alreadyCachedBeforeRun: undefined });
  assert.equal(nan.total, 0);
  assert.equal(nan.remaining, 0);
});

test('an all-already-cached library reports zero remaining, no negative', () => {
  const r = notify.cacheQueueCounters({ total: 40, finishedInRun: 0, alreadyCachedBeforeRun: 40 });
  assert.equal(r.total, 40);
  assert.equal(r.remaining, 0);
});

/* ---------------- PlayerContext wiring ----------------
 * These read the real source. They exist because a green unit test on the
 * pure module says nothing about whether the queue ever calls it, or
 * whether the button that used to start caching is actually gone. */

const pc = fs.readFileSync(path.join(root, 'contexts/PlayerContext.tsx'), 'utf8');
const library = fs.readFileSync(path.join(root, 'components/screens/LibraryScreen.tsx'), 'utf8');

// Slice the processLikedSongsCacheQueue callback. The dep array opens on its
// own line after the union merge (`}, [\n    resolveTrackStreamUrl,`), so
// anchoring on `}, [resolveTrackStreamUrl` returned -1 and silently sliced
// the whole rest of the file.
function queueSeam() {
  const start = pc.indexOf('const processLikedSongsCacheQueue');
  assert.ok(start > -1, 'processLikedSongsCacheQueue missing');
  const depStart = pc.indexOf('\n  }, [', start);
  assert.ok(depStart > start, 'queue dep array missing');
  const depEnd = pc.indexOf(']);', depStart);
  assert.ok(depEnd > depStart, 'queue dep array terminator missing');
  const deps = pc.slice(depStart, depEnd);
  assert.match(deps, /resolveTrackStreamUrl/, 'anchored on the wrong dep array');
  return { start, depStart, depEnd, body: pc.slice(start, depStart) };
}

function queueBody() {
  return queueSeam().body;
}

test('every notification post goes through the gated entry point', () => {
  // Raw calls from the queue would bypass the settings-off gate.
  const raw = pc.match(/void updateCacheNotification\(/g) || [];
  assert.equal(raw.length, 1, 'updateCacheNotification must only be called from postCacheNotification');
  assert.match(pc, /const postCacheNotification = useCallback\(/);
});

test('the entry point refuses to post once auto-caching is off', () => {
  const start = pc.indexOf('const postCacheNotification = useCallback(');
  assert.ok(start > -1, 'postCacheNotification missing');
  // The dep array sits on its own line, e.g. `    [settings.autoCacheLikedSongs],`.
  const end = pc.indexOf('[settings.autoCacheLikedSongs],', start);
  assert.ok(end > start, 'postCacheNotification dep array not found');
  const body = pc.slice(start, end);
  assert.match(body, /if \(!settings\.autoCacheLikedSongs\) \{\s*\n\s*return;/,
    'post must bail when the user turned auto-caching off');
});

test('the queue dismisses the notification when it stops', () => {
  // Drain/abort path: finally must clear it or the shade keeps a stale
  // "caching" notice after the work ended.
  const queue = queueBody();
  const fin = queue.lastIndexOf('} finally {');
  assert.match(queue.slice(fin), /void dismissCacheNotification\(\);/);
});

test('settings-off toggles the notification away', () => {
  // The toggle effect, not the gate inside postCacheNotification.
  const { depEnd } = queueSeam();
  const idx = pc.indexOf('if (!settings.autoCacheLikedSongs) {', depEnd);
  assert.ok(idx > -1, 'settings-off branch missing');
  assert.match(pc.slice(idx, idx + 500), /dismissCacheNotification/);
});

test('queue reads locale from a live ref, not a captured settings object', () => {
  // The queue callback's deps do not include settings, so any settings read
  // inside it is frozen at first render. Locale travels through a ref.
  const { body: queue } = queueSeam();
  assert.doesNotMatch(queue, /language: settings\.language/,
    'captured settings would freeze the notification locale');
  assert.doesNotMatch(queue, /settings\.language/);

  const postStart = pc.indexOf('const postCacheNotification = useCallback(');
  // Deps span lines: the array closes on its own line, so match that.
  const postEnd = pc.indexOf('\n    [settings.autoCacheLikedSongs],', postStart);
  assert.ok(postEnd > postStart, 'postCacheNotification dep array not found');
  const post = pc.slice(postStart, postEnd);
  assert.match(post, /language: cacheNotifyLanguageRef\.current/,
    'the entry point must read locale from the ref');
  assert.match(pc, /cacheNotifyLanguageRef\.current = settings\.language/);
});

test('the run announces itself before the first track finishes', () => {
  // A batch takes a while; if the only post lands after track 1 completes the
  // user sees nothing for the whole first batch.
  const { body } = queueSeam();
  const seed = body.indexOf('if (!cacheRunSeededRef.current) {');
  assert.ok(seed > -1, 'seed block missing');
  // Scope to the seed block: the cooldown-exit post also passes force=true, so
  // a plain indexOf would find that one and report a false pass.
  const seedEnd = body.indexOf('\n    }', seed);
  const seedBlock = body.slice(seed, seedEnd > -1 ? seedEnd : body.length);
  const post = seedBlock.indexOf('postCacheNotification(0, true);');
  assert.ok(post > -1, 'no forced post inside the seed block (run never announces itself)');
  const progressPost = body.indexOf('postCacheNotification(0, false);');
  assert.ok(progressPost > seedEnd, 'entry post must come before the per-track post');
});

test('counters are seeded once per run, then reset on exit', () => {
  const { body } = queueSeam();
  assert.match(body, /if \(!cacheRunSeededRef\.current\) \{/, 'seed guard missing');
  assert.match(body, /cacheRunFinishedRef\.current \+= 1;/, 'no per-track progress');
  const finallyIdx = body.lastIndexOf('} finally {');
  assert.match(body.slice(finallyIdx), /cacheRunSeededRef\.current = false;/,
    'a stale seed would corrupt the next run');
});

/* ---------------- notifier module (stubbed RN/expo) -----------------------
 * The pure module decides WHAT to say; this decides whether it is said and
 * how failures are contained. Driven with stubbed react-native /
 * expo-notifications so the real post gate, throttle and id handling run. */

function loadNotifier({
  platform = 'android',
  granted = true,
  canAskAgain = true,
  requestGranted = true,
  scheduleThrows = false,
} = {}) {
  const js = ts.transpileModule(
    fs.readFileSync(path.join(root, 'modules/cacheQueueNotifier.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const module = { exports: {} };
  const calls = { schedule: [], dismiss: [], cancel: [], channel: 0, handler: 0 };
  const notifications = {
    setNotificationHandler: () => { calls.handler += 1; },
    getPermissionsAsync: async () => ({ granted, canAskAgain }),
    requestPermissionsAsync: async () => ({ granted: requestGranted }),
    setNotificationChannelAsync: async () => { calls.channel += 1; },
    scheduleNotificationAsync: async (req) => {
      if (scheduleThrows) throw new Error('schedule failed');
      calls.schedule.push(req);
    },
    dismissNotificationAsync: async (id) => { calls.dismiss.push(id); },
    cancelScheduledNotificationAsync: async (id) => { calls.cancel.push(id); },
    AndroidImportance: { LOW: 'LOW' },
  };
  const stub = (spec) => {
    if (spec === 'react-native') return { __esModule: true, Platform: { OS: platform } };
    if (spec === 'expo-notifications') return { __esModule: true, ...notifications };
    if (spec === './cacheQueueNotify') return { __esModule: true, ...notify };
    throw new Error(`unexpected require(${spec})`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', js)(stub, module, module.exports);
  return { ...module.exports, __calls: calls };
}

test('an identical update never posts a second notification', async () => {
  const n = loadNotifier();
  const state = { total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' };
  await n.updateCacheNotification(state);
  await n.updateCacheNotification(state);
  await n.updateCacheNotification({ ...state, remaining: 38 }); // throttled
  assert.equal(n.__calls.schedule.length, 1, 'unchanged copy and in-window copy both dropped');
  await n.updateCacheNotification({ ...state, remaining: 38 }, { force: true });
  assert.equal(n.__calls.schedule.length, 2, 'a changed forced copy lands');
});

test('post and dismiss share one stable notification id', async () => {
  const n = loadNotifier();
  await n.updateCacheNotification({ total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' });
  await n.updateCacheNotification({ total: 40, remaining: 38, cooldownSeconds: 0, language: 'en' }, { force: true });
  assert.equal(n.__calls.schedule.length, 2);
  for (const req of n.__calls.schedule) {
    assert.equal(req.identifier, notify.CACHE_NOTIFICATION_ID, 'updates replace, never stack');
    assert.equal(req.content.sticky, true, 'an ongoing notification cannot be swiped away');
  }
  await n.dismissCacheNotification();
  assert.deepEqual(n.__calls.dismiss, [notify.CACHE_NOTIFICATION_ID]);
  assert.deepEqual(n.__calls.cancel, [notify.CACHE_NOTIFICATION_ID]);
});

test('a denied permission posts nothing and never throws', async () => {
  const n = loadNotifier({ granted: false, canAskAgain: false });
  await assert.doesNotReject(() =>
    n.updateCacheNotification({ total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' }),
  );
  assert.equal(n.__calls.schedule.length, 0, 'no notification may reach the shade');
  assert.equal(n.__calls.dismiss.length, 0, 'nothing was shown, nothing to remove');
});

test('a throwing scheduler is swallowed, caching continues', async () => {
  const n = loadNotifier({ scheduleThrows: true });
  await assert.doesNotReject(() =>
    n.updateCacheNotification({ total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' }),
  );
  assert.equal(n.__calls.handler, 1, 'the handler is still installed for the session');
});

test('dismiss resets the throttle so the next run announces itself immediately', async () => {
  const n = loadNotifier();
  const state = { total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' };
  await n.updateCacheNotification(state);
  await n.dismissCacheNotification();
  await n.updateCacheNotification(state, { force: false });
  assert.equal(n.__calls.schedule.length, 2,
    'a fresh run with the same copy must post again after a dismiss');
});

test('the channel is created on Android only, and never on the web', async () => {
  const web = loadNotifier({ platform: 'web' });
  await web.updateCacheNotification({ total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' });
  assert.equal(web.__calls.schedule.length, 0, 'web has no notification surface');
  assert.equal(web.__calls.channel, 0);

  const ios = loadNotifier({ platform: 'ios' });
  await ios.updateCacheNotification({ total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' });
  assert.equal(ios.__calls.channel, 0, 'iOS needs no Android channel');
  assert.equal(ios.__calls.schedule.length, 1, 'iOS does post');

  const android = loadNotifier();
  await android.updateCacheNotification({ total: 40, remaining: 40, cooldownSeconds: 0, language: 'en' });
  assert.equal(android.__calls.channel, 1);
});

/* ---------------- new pure boundaries ------------------------------------ */

test('the cooldown copy wins over the finished copy while a batch rests', () => {
  // remaining hits 0 the moment a cooldown starts: the shade must show the
  // countdown, not a stale "All songs cached".
  const copy = notify.cacheQueueNotifyCopy({ total: 40, remaining: 0, cooldownSeconds: 30, language: 'en' });
  assert.equal(copy.body, 'Resuming in 30s (batch cooldown)');
  assert.notEqual(copy.body, 'All songs cached');
});

test('counters count a run down to exactly zero, then clamp', () => {
  const cases = [
    [0, 10], [4, 6], [10, 0], [11, 0],
  ];
  for (const [finished, remaining] of cases) {
    const r = notify.cacheQueueCounters({ total: 10, finishedInRun: finished, alreadyCachedBeforeRun: 0 });
    assert.equal(r.remaining, remaining, `finished ${finished}`);
  }
  const seeded = notify.cacheQueueCounters({ total: 10, finishedInRun: 4, alreadyCachedBeforeRun: 6 });
  assert.equal(seeded.remaining, 0, 'seeded already-cached counts toward the total');
});

test('a clock that runs backwards never un-throttles a post', () => {
  assert.equal(notify.shouldPostCacheNotification({
    next: '11 of 40 remaining', last: '12 of 40 remaining',
    lastPostedAt: 10_000, now: 9_999,
  }), false, 'a negative delta must not post');
});

/* ---------------- PlayerContext contracts (new) --------------------------- */

test('only transition posts force the throttle; per-track progress never does', () => {
  // Seed + cooldown-exit are transitions (~8s after the previous post, inside
  // the throttle window) so they must pass force=true; the per-track progress
  // post must stay on the plain throttle or a fast run spams the shade.
  const { body } = queueSeam();
  assert.equal((body.match(/postCacheNotification\(0, true\);/g) || []).length, 2,
    'seed and cooldown posts force');
  assert.equal((body.match(/postCacheNotification\(0, false\);/g) || []).length, 1,
    'exactly one progress post');
  // The cooldown post must carry the full cooldown in seconds, not 0.
  assert.match(body, /postCacheNotification\(totalSec, true\);/);
});

test('the batch cooldown the notification shows matches the queue constant', () => {
  const totalSec = Math.ceil(180_000 / 1000); // CACHE_BATCH_COOLDOWN_MS
  assert.equal(notify.formatCooldown(totalSec), '3m');
  const { body } = queueSeam();
  assert.match(body, /CACHE_BATCH_COOLDOWN_MS \/ 1000/);
});

test('every finished track enforces the user cache budget', () => {
  // Overfilling the cap silently evicts the user's other downloads; the queue
  // must hand the finished track to the enforcer each time.
  const { body } = queueSeam();
  assert.equal((body.match(/enforceAudioCacheBudget\(/g) || []).length, 1);
  assert.match(body, /enforceAudioCacheBudget\(\s*settings\.audioCacheCapMb/);
  assert.match(body, /enforceAudioCacheBudget\([\s\S]*?cacheRunFinishedRef\.current \+= 1;/,
    'the budget runs only after a track finished, not per attempt');
});

test('a cooldown beyond an hour renders minutes, and a negative one renders zero', () => {
  // formatCooldown has no hour branch: a 1-hour value reads "60m". No queue
  // cooldown reaches that (the batch cooldown is 180s), so this is a render
  // boundary, not a defect.
  assert.equal(notify.formatCooldown(3599), '59m 59s');
  assert.equal(notify.formatCooldown(3600), '60m');
  assert.equal(notify.formatCooldown(3661), '61m 1s');
  assert.equal(notify.formatCooldown(-5), '0s', 'a negative cooldown is zero');
});

/* ---------------- issue #94 acceptance ---------------- */

test('the Library no longer renders a manual cache-download button', () => {
  assert.doesNotMatch(library, /startCacheQueue/,
    'Library must not offer a manual download button');
  assert.doesNotMatch(library, /cloud-download-outline/);
});

test('auto-caching defaults to on (issue #94 makes the queue automatic)', () => {
  const settings = fs.readFileSync(path.join(root, 'lib/app-settings.ts'), 'utf8');
  assert.match(settings, /autoCacheLikedSongs: true,/);
  assert.doesNotMatch(settings, /autoCacheLikedSongs: false,/);
});

test('android declares POST_NOTIFICATIONS and the plugin is configured', () => {
  const app = fs.readFileSync(path.join(root, 'app.json'), 'utf8');
  assert.match(app, /POST_NOTIFICATIONS/);
  assert.match(app, /"expo-notifications"/);
});

test('the notification module never throws into the cache loop', () => {
  // Permission denied / dev client without notifications must not stop caching:
  // every exit path of updateCacheNotification has to swallow, not rethrow.
  const src = fs.readFileSync(path.join(root, 'modules/cacheQueueNotifier.ts'), 'utf8');
  const start = src.indexOf('export async function updateCacheNotification');
  const end = src.indexOf('export async function dismissCacheNotification', start);
  const body = src.slice(start, end);
  assert.ok(start > -1 && end > start, 'updateCacheNotification seam missing');
  assert.match(body, /catch \(error\)/, 'a rejected notification promise would break the queue');
  assert.doesNotMatch(body, /throw /, 'rethrowing would propagate into the cache queue');
  assert.match(body, /await ensureCacheNotificationPermission\(\)/);
  // Same rule for the dismiss path.
  const dstart = end;
  const dend = src.indexOf('Test seam', dstart);
  const dbody = src.slice(dstart, dend > -1 ? dend : src.length);
  assert.doesNotMatch(dbody, /throw /, 'dismiss must not throw either');
});
