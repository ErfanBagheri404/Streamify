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
 * The router is the module's own routeShareMomentUrl, exercised for real.
 * Dispatching a URL through it proves the routing decision at runtime — a
 * static string check cannot tell that routing forgot to call the handler.
 */
const router = share;
const shareRouting = read("modules", "shareMoment.ts");
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
  // A malformed percent-escape must return null, not throw URIError.
  assert.strictEqual(share.parseShareMomentUrl("streamify://track/%zz"), null);
  assert.strictEqual(share.parseShareMomentUrl("streamify://track/%E0%A4%A"), null);
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

check("routeShareMomentUrl routes moments to their own handler", () => {
  assert.ok(
    shareRouting.includes("export async function routeShareMomentUrl("),
    "routing must live in shareMoment, not in deepLink",
  );
  assert.ok(
    shareRouting.includes("parseShareMomentUrl("),
    "routing must recognise a share-moment URL",
  );
});

check("RUNTIME: a moment URL reaches the moment handler with its payload", async () => {
  share.__resetShareMomentForTests();
  const seen = [];
  share.setShareMomentHandler((moment) => {
    seen.push(moment);
  });

  const url = share.buildShareMomentUrl(track, 83);
  const handled = await share.routeShareMomentUrl(url);

  assert.strictEqual(handled, true, "a moment link must be reported as handled");
  assert.strictEqual(seen.length, 1, "the moment handler was not called");
  assert.strictEqual(seen[0].id, "abc123", "payload lost");
  assert.strictEqual(seen[0].seconds, 83, "timestamp lost");
});

check("RUNTIME: a non-moment URL is not handled", async () => {
  share.__resetShareMomentForTests();
  const seen = [];
  share.setShareMomentHandler((moment) => seen.push(moment));

  const handled = await share.routeShareMomentUrl("streamify://resume");

  assert.strictEqual(handled, false);
  assert.strictEqual(seen.length, 0, "an action leaked into the moment handler");
});

check("the bridge installs exactly one Linking listener", () => {
  const calls = (app.match(/Linking\.addEventListener\(/g) || []).length;
  assert.strictEqual(calls, 1, `expected 1 listener, found ${calls}`);
});

check("App registers the moment handler and seeks only after load", () => {
  assert.ok(app.includes("setShareMomentHandler("), "handler not registered");
  assert.ok(app.includes("seekTo("), "the moment must seek to its timestamp");
  // The bound must gate the seek, not merely exist somewhere in the file —
  // otherwise a weakened comparison still passes a name-only check.
  assert.ok(
    /seconds\s*<=\s*MAX_SHARE_SEEK_SECONDS/.test(app),
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

// --- additional edge-case coverage (PR #70) --------------------------------

check("formatTimestamp clamps non-finite and negative input to 0:00", () => {
  assert.strictEqual(share.formatTimestamp(NaN), "0:00");
  assert.strictEqual(share.formatTimestamp(Infinity), "0:00");
  assert.strictEqual(share.formatTimestamp(-5), "0:00");
  assert.strictEqual(share.formatTimestamp(3600), "1:00:00");
  assert.strictEqual(share.formatTimestamp(65), "1:05");
});

check("parseTimestamp trims whitespace and floors plain seconds", () => {
  assert.strictEqual(share.parseTimestamp("  83  "), 83);
  assert.strictEqual(share.parseTimestamp(" 1:23 "), 83);
  assert.strictEqual(share.parseTimestamp("83.9"), 83);
});

check("parseTimestamp rejects too many segments and negative parts", () => {
  assert.strictEqual(share.parseTimestamp("1:2:3:4"), null);
  assert.strictEqual(share.parseTimestamp("-1:23"), null);
  assert.strictEqual(share.parseTimestamp("1:-2"), null);
});

check("buildShareMomentUrl floors and ignores non-positive seconds", () => {
  const url = share.buildShareMomentUrl({ id: "x" }, 83.9);
  assert.ok(url.includes("t=83"), url);
  assert.ok(!share.buildShareMomentUrl({ id: "x" }, -5).includes("t="));
  assert.ok(!share.buildShareMomentUrl({ id: "x" }, NaN).includes("t="));
  assert.ok(!share.buildShareMomentUrl({ id: "x" }, 0).includes("t="));
});

check("buildShareMomentUrl omits empty metadata fields", () => {
  const url = share.buildShareMomentUrl(
    { id: "x", title: "", artist: "A & B" },
    0,
  );
  assert.ok(!url.includes("n="), url);
  assert.ok(url.includes("a="), url);
  const moment = share.parseShareMomentUrl(url);
  assert.strictEqual(moment.title, undefined);
  assert.strictEqual(moment.artist, "A & B");
});

check("parseShareMomentUrl treats missing and zero timestamps as zero", () => {
  assert.strictEqual(
    share.parseShareMomentUrl("streamify://track/x").seconds,
    0,
  );
  assert.strictEqual(
    share.parseShareMomentUrl("streamify://track/x?t=0").seconds,
    0,
  );
});

check("parseShareMomentUrl round-trips unicode ids and metadata", () => {
  const track = { id: "caf\xc3\xa9/\u266b", title: "\u0645\u0648\u0633\u06cc\u0642\u06cc", artist: "Bj\u00f6rk" };
  const url = share.buildShareMomentUrl(track, 42);
  const moment = share.parseShareMomentUrl(url);
  assert.strictEqual(moment.id, track.id);
  assert.strictEqual(moment.seconds, 42);
  assert.strictEqual(moment.title, track.title);
  assert.strictEqual(moment.artist, track.artist);
});

check("buildShareMessage returns the bare url without heading or timestamp", () => {
  const url = "streamify://track/x";
  assert.strictEqual(
    share.buildShareMessage({ id: "x", seconds: 0 }, url),
    url,
  );
});

check("RUNTIME: handler is not invoked for a malformed moment url", async () => {
  share.__resetShareMomentForTests();
  const seen = [];
  share.setShareMomentHandler((moment) => seen.push(moment));
  const handled = await share.routeShareMomentUrl("streamify://track/%zz");
  assert.strictEqual(handled, false);
  assert.strictEqual(seen.length, 0);
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
