/**
 * Share-moment link contract tests (issue #33).
 *
 * The pure link layer (modules/shareMoment.ts) is exercised by transpiling the
 * checked-in file with the project's own TypeScript — the same source of truth
 * the app ships, not a copy. The routing/bridge wiring is asserted statically.
 * Opening a link on a second device is verified by the manual two-device pass,
 * not here.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const results = [];
const pending = [];
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      pending.push(
        out.then(
          () => results.push(`PASS ${name}`),
          (e) => results.push(`FAIL ${name}: ${e.message}`),
        ),
      );
    } else {
      results.push(`PASS ${name}`);
    }
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

const ts = require(path.join(root, "node_modules", "typescript"));
const shareSrc = read("modules", "shareMoment.ts");
const shareJs = ts.transpileModule(shareSrc, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const shareModule = new module.constructor();
shareModule.paths = module.paths;
shareModule._compile(shareJs, path.join(root, "modules", "shareMoment.js"));
const share = shareModule.exports;

/**
 * The router is loaded for real, with expo-linking faked. Dispatching a URL
 * through it proves the routing decision at runtime — a static string check
 * cannot tell that `handleDeepLink` forgot to call the moment handler.
 */
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "expo-linking") return "expo-linking";
  return originalResolve.call(this, request, ...rest);
};
require.cache["expo-linking"] = {
  id: "expo-linking",
  filename: "expo-linking",
  loaded: true,
  exports: {
    addEventListener: () => ({ remove: () => {} }),
    getInitialURL: async () => null,
  },
};

const deepLinkJs = ts.transpileModule(read("modules", "deepLink.ts"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
// deepLink.ts requires ./shareMoment — point that at the real transpiled copy.
const deepLinkModule = new module.constructor();
deepLinkModule.paths = module.paths;
deepLinkModule.require = (request) =>
  request === "./shareMoment"
    ? share
    : Module.createRequire(path.join(root, "modules", "deepLink.js"))(request);
deepLinkModule._compile(deepLinkJs, path.join(root, "modules", "deepLink.js"));
const router = deepLinkModule.exports;
Module._resolveFilename = originalResolve;

const deepLink = read("modules", "deepLink.ts");
const app = read("App.tsx");
const fullPlayer = read("components", "FullPlayerModal.tsx");

// --- timestamp formatting ---------------------------------------------------

check("timestamp formats as m:ss and h:mm:ss", () => {
  assert.strictEqual(share.formatTimestamp(0), "0:00");
  assert.strictEqual(share.formatTimestamp(83), "1:23");
  assert.strictEqual(share.formatTimestamp(3723), "1:02:03");
});

check("timestamp parsing accepts the formats a user would paste", () => {
  assert.strictEqual(share.parseTimestamp("83"), 83);
  assert.strictEqual(share.parseTimestamp("1:23"), 83);
  assert.strictEqual(share.parseTimestamp("1:02:03"), 3723);
});

check("garbage timestamps parse to null rather than NaN seconds", () => {
  assert.strictEqual(share.parseTimestamp(""), null);
  assert.strictEqual(share.parseTimestamp(null), null);
  assert.strictEqual(share.parseTimestamp("abc"), null);
  assert.strictEqual(share.parseTimestamp("1:2:3:4"), null);
  assert.strictEqual(share.parseTimestamp("-5"), null);
});

// --- link building ----------------------------------------------------------

const track = {
  id: "abc123",
  source: "youtube",
  title: "Some Song",
  artist: "Some Artist",
};

check("a shared link carries id, position, source and metadata", () => {
  const url = share.buildShareMomentUrl(track, 83);
  assert.ok(url.startsWith("streamify://track/abc123?"), url);
  assert.ok(url.includes("t=83"), url);
  assert.ok(url.includes("s=youtube"), url);
});

check("a zero position omits t so a plain share stays clean", () => {
  const url = share.buildShareMomentUrl(track, 0);
  assert.ok(!url.includes("t="), url);
});

check("a track with no id cannot produce a link", () => {
  assert.strictEqual(share.buildShareMomentUrl({ title: "x" }, 10), null);
});

check("build then parse round-trips exactly", () => {
  const url = share.buildShareMomentUrl(track, 83);
  const moment = share.parseShareMomentUrl(url);
  assert.strictEqual(moment.id, "abc123");
  assert.strictEqual(moment.seconds, 83);
  assert.strictEqual(moment.source, "youtube");
  assert.strictEqual(moment.title, "Some Song");
  assert.strictEqual(moment.artist, "Some Artist");
});

check("ids needing encoding survive the round trip", () => {
  const url = share.buildShareMomentUrl({ id: "a/b c?d" }, 5);
  assert.strictEqual(share.parseShareMomentUrl(url).id, "a/b c?d");
});

// --- link parsing must not steal other deep links ---------------------------

check("launcher-shortcut actions are not parsed as moments", () => {
  for (const url of [
    "streamify://resume",
    "streamify://search",
    "streamify://shuffle-liked",
    "streamify://smart-queue",
  ]) {
    assert.strictEqual(share.parseShareMomentUrl(url), null, url);
  }
});

check("unrelated and malformed URLs are ignored", () => {
  assert.strictEqual(share.parseShareMomentUrl(null), null);
  assert.strictEqual(share.parseShareMomentUrl(""), null);
  assert.strictEqual(share.parseShareMomentUrl("https://example.com/track/1"), null);
  assert.strictEqual(share.parseShareMomentUrl("streamify://track/"), null);
});

check("an unknown track link still parses — the error is clean, not a crash", () => {
  const moment = share.parseShareMomentUrl("streamify://track/never-heard?t=1:23");
  assert.ok(moment, "must parse so the app can report it cleanly");
  assert.strictEqual(moment.id, "never-heard");
  assert.strictEqual(moment.seconds, 83);
});

check("share text carries the timestamp and the link", () => {
  const url = share.buildShareMomentUrl(track, 83);
  const message = share.buildShareMessage(
    { id: "abc123", seconds: 83, title: "Some Song", artist: "Some Artist" },
    url,
  );
  assert.ok(message.includes("Some Song"), message);
  assert.ok(message.includes("1:23"), message);
  assert.ok(message.includes(url), message);
});

// --- routing and bridge wiring ----------------------------------------------

check("the deep-link router hands moments to their own handler", () => {
  assert.ok(
    deepLink.includes("parseShareMomentUrl("),
    "deepLink must recognise a share-moment URL",
  );
  assert.ok(
    deepLink.includes("handleShareMoment("),
    "moments need their own handler, not the bare action map",
  );
});

check("RUNTIME: a moment URL reaches the moment handler with its payload", async () => {
  router.__resetDeepLinkForTests();
  const seen = [];
  let actionCalls = 0;
  router.setShareMomentHandler((moment) => {
    seen.push(moment);
  });
  router.setDeepLinkHandlers({
    resume: () => {
      actionCalls += 1;
    },
    "shuffle-liked": () => {},
    "smart-queue": () => {},
    search: () => {},
  });

  const url = share.buildShareMomentUrl(track, 83);
  const handled = await router.handleDeepLink(url);

  assert.strictEqual(handled, true, "a moment link must be reported as handled");
  assert.strictEqual(seen.length, 1, "the moment handler was not called");
  assert.strictEqual(seen[0].id, "abc123", "payload lost");
  assert.strictEqual(seen[0].seconds, 83, "timestamp lost");
  assert.strictEqual(actionCalls, 0, "a moment must not fall through to an action");
});

check("RUNTIME: a launcher action still routes to its own action", async () => {
  router.__resetDeepLinkForTests();
  const seen = [];
  let resumed = 0;
  router.setShareMomentHandler((moment) => seen.push(moment));
  router.setDeepLinkHandlers({
    resume: () => {
      resumed += 1;
    },
    "shuffle-liked": () => {},
    "smart-queue": () => {},
    search: () => {},
  });

  const handled = await router.handleDeepLink("streamify://resume");
  assert.strictEqual(handled, true);
  assert.strictEqual(resumed, 1, "resume action did not fire");
  assert.strictEqual(seen.length, 0, "an action leaked into the moment handler");
});

check("a cold-start moment is queued with its URL, not replayed as an action", () => {
  // A launcher action can be rebuilt from its name; a moment cannot — the id
  // and timestamp only exist in the URL, so the URL must be kept.
  assert.ok(deepLink.includes("pendingMoments"), "moment queue missing");
  assert.ok(
    /pendingMoments\.push\(url/.test(deepLink),
    "the moment URL itself must be queued",
  );
});

check("the bridge still installs exactly one Linking listener", () => {
  const calls = (deepLink.match(/Linking\.addEventListener\(/g) || []).length;
  assert.strictEqual(calls, 1, `expected 1 listener, found ${calls}`);
});

check("App registers the moment handler and seeks only after load", () => {
  assert.ok(app.includes("setShareMomentHandler("), "handler not registered");
  assert.ok(app.includes("seekTo("), "the moment must seek to its timestamp");
  assert.ok(
    app.includes("MAX_SHARE_SEEK_SECONDS"),
    "an absurd t= must be rejected rather than seeking past the track",
  );
});

check("the player offers the timestamped share action", () => {
  assert.ok(
    fullPlayer.includes("Share from current position"),
    "menu entry missing",
  );
  assert.ok(
    fullPlayer.includes("buildShareMomentUrl("),
    "the menu entry must build a real link",
  );
});

// --- report -----------------------------------------------------------------

Promise.all(pending).then(() => {
  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) {
    console.log(line);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
});
