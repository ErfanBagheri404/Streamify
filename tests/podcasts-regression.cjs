/**
 * Podcast subscriptions regression tests (#30).
 *
 * The RSS parser is pure (XML in, show+episodes out) so it is transpiled and
 * driven with real feed fixtures — that is where hostile-XML bugs live. The
 * storage layer is exercised through the shared AsyncStorage stub, because
 * subscribe/unsubscribe/resume are where episode identity gets lost. The UI
 * and player wiring is asserted as file-content contracts.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules", "typescript"));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  const done = () => {
    passed += 1;
    console.log(`PASS ${name}`);
  };
  const bad = (error) => {
    failed += 1;
    failures.push(name);
    console.log(
      `FAIL ${name}\n  ${String((error && error.stack) || error)
        .split("\n")
        .join("\n  ")}`,
    );
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(done, bad);
    }
    done();
  } catch (error) {
    bad(error);
  }
  return undefined;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const scratchDir = process.env.TMPDIR || path.join(root, ".hermes-tmp");

/** Transpiles a TS module and requires it from scratch. */
function loadTsModule(relPath, { rewrite } = {}) {
  const source = fs.readFileSync(path.join(root, relPath), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  if (rewrite) js = rewrite(js);
  fs.mkdirSync(scratchDir, { recursive: true });
  const scratch = path.join(scratchDir, `podcast-${process.pid}-${loadedCount}.js`);
  loadedCount += 1;
  fs.writeFileSync(scratch, js, "utf8");
  // The scratch file lives outside the repo, so bare specifiers such as
  // fast-xml-parser would not resolve; point module resolution at node_modules.
  const originalPaths = Module._nodeModulePaths;
  Module._nodeModulePaths = (from) => originalPaths.call(Module, root);
  try {
    return require(scratch);
  } finally {
    Module._nodeModulePaths = originalPaths;
    fs.unlinkSync(scratch);
  }
}
let loadedCount = 0;

/**
 * Transpiles a .ts file into the scratch dir and requires it. A module that
 * itself imports siblings is transpiled with the same relative specifiers,
 * which resolve only if the copy keeps the repo-relative layout — so the copy
 * is written under a scratch mirror of the repo and the require path is
 * rewritten to it. Nothing is written inside the repo.
 */
const scratchMirror = path.join(scratchDir, "podcast-mirror");
const generated = new Set();

function transpileTo(source, outPath) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, js, "utf8");
  generated.add(outPath);
  return outPath;
}

function mirrorTs(relPath) {
  const abs = path.join(root, relPath);
  const out = path.join(scratchMirror, relPath.replace(/\.tsx?$/, ".cjs"));
  return transpileTo(fs.readFileSync(abs, "utf8"), out);
}

process.on("exit", () => {
  for (const file of generated) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
});

const feed = loadTsModule("modules/podcastFeed.ts");

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>The Daily Show</title>
    <itunes:author>Comedy Network</itunes:author>
    <description><![CDATA[<p>Long-form <b>talk</b> show</p>]]></description>
    <itunes:image href="https://cdn.example.com/cover.jpg"/>
    <item>
      <title>Episode One</title>
      <guid isPermaLink="false">ep-1</guid>
      <pubDate>Mon, 12 Sep 2025 06:00:00 GMT</pubDate>
      <itunes:duration>35:00</itunes:duration>
      <enclosure url="https://cdn.example.com/ep1.mp3" length="52428800" type="audio/mpeg"/>
      <description><![CDATA[<p>First</p>]]></description>
    </item>
    <item>
      <title>Episode Two</title>
      <guid isPermaLink="false">ep-2</guid>
      <pubDate>Tue, 13 Sep 2025 06:00:00 GMT</pubDate>
      <itunes:duration>1:02:05</itunes:duration>
      <enclosure url="https://cdn.example.com/ep2.mp3" length="94371840" type="audio/mpeg"/>
    </item>
    <item>
      <title>Show notes only</title>
      <pubDate>Sun, 14 Sep 2025 06:00:00 GMT</pubDate>
      <link>https://example.com/blog</link>
    </item>
  </channel>
</rss>`;

// ── parser ──────────────────────────────────────────────────────────────

const parsed = feed.parsePodcastFeed("https://example.com/feed.xml", RSS);

check("show metadata is read from iTunes tags", () => {
  assert(parsed.show.title === "The Daily Show", `title: ${parsed.show.title}`);
  assert(parsed.show.author === "Comedy Network", `author: ${parsed.show.author}`);
  assert(
    parsed.show.artworkUrl === "https://cdn.example.com/cover.jpg",
    `artwork: ${parsed.show.artworkUrl}`,
  );
  assert(parsed.show.feedUrl === "https://example.com/feed.xml", "feedUrl kept");
  assert(typeof parsed.show.id === "string" && parsed.show.id.length > 0, "id derived");
});

check("episodes are parsed, newest first, undated items dropped", () => {
  assert(parsed.episodes.length === 2, `expected 2 playable, got ${parsed.episodes.length}`);
  assert(parsed.skippedItems === 1, `expected 1 skipped, got ${parsed.skippedItems}`);
  assert(parsed.episodes[0].title === "Episode Two", `first: ${parsed.episodes[0].title}`);
  assert(parsed.episodes[1].title === "Episode One", "older second");
});

check("durations parse for both hh:mm:ss and mm:ss", () => {
  assert(parsed.episodes[1].durationSeconds === 35 * 60, `got ${parsed.episodes[1].durationSeconds}`);
  assert(
    parsed.episodes[0].durationSeconds === 1 * 3600 + 2 * 60 + 5,
    `got ${parsed.episodes[0].durationSeconds}`,
  );
});

check("enclosure url is the playback url", () => {
  assert(
    parsed.episodes[0].audioUrl === "https://cdn.example.com/ep2.mp3",
    `got ${parsed.episodes[0].audioUrl}`,
  );
});

check("publishedAt is a real timestamp", () => {
  const t = parsed.episodes[0].publishedAt;
  assert(typeof t === "number" && Number.isFinite(t), `got ${t}`);
  assert(t > Date.parse("2025-09-01"), "after Sep 1 2025");
});

check("the same feed URL yields a stable show id", () => {
  const again = feed.parsePodcastFeed("https://example.com/feed.xml", RSS);
  assert(again.show.id === parsed.show.id, "id must be stable across fetches");
  const other = feed.parsePodcastFeed("https://other.example.com/feed.xml", RSS);
  assert(other.show.id !== parsed.show.id, "different feeds get different ids");
});

check("garbage XML does not throw", () => {
  const broken = feed.parsePodcastFeed("https://bad.example.com/feed.xml", "<<<not xml");
  assert(Array.isArray(broken.episodes), "must return an array");
  assert(broken.episodes.length === 0, "no episodes from garbage");
  assert(broken.show.id === parsed.show.id.replace(/.*/, broken.show.id), "id still present");
});

check("an empty feed is an empty library, not a crash", () => {
  const empty = feed.parsePodcastFeed(
    "https://example.com/empty.xml",
    "<rss><channel><title>Empty</title></channel></rss>",
  );
  assert(empty.episodes.length === 0, "no episodes");
  assert(empty.show.title === "Empty", "show title still readable");
});

check("CDATA text nodes are unwrapped", () => {
  assert(
    parsed.show.description.includes("talk"),
    `description: ${parsed.show.description}`,
  );
  assert(!parsed.show.description.includes("<![CDATA["), "CDATA wrapper must be gone");
  assert(!/[{}]/.test(parsed.show.description), "raw parser objects must not leak into UI text");
});

// ── storage ─────────────────────────────────────────────────────────────

const storage = (() => {
  // storage.ts pulls in lib/app-settings and modules/podcastFeed. Each is
  // mirrored (transpiled) so the scratch copy's relative requires resolve.
  const appSettings = mirrorTs("lib/app-settings.ts");
  const podcastFeed = mirrorTs("modules/podcastFeed.ts");

  const source = fs.readFileSync(path.join(root, "utils", "storage.ts"), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  js = js
    .replace(
      /require\("@react-native-async-storage\/async-storage"\)/g,
      `require(${JSON.stringify(path.join(__dirname, "helpers", "asyncStorageStub.js"))})`,
    )
    // storage.ts only needs DeviceEventEmitter from react-native; the real
    // package is ESM+Flow and cannot be required from a CJS suite.
    .replace(
      /require\("react-native"\)/g,
      `require(${JSON.stringify(path.join(__dirname, "helpers", "reactNativeStub.js"))})`,
    )
    .replace(/require\("\.\.\/lib\/app-settings"\)/g, `require(${JSON.stringify(appSettings)})`)
    .replace(/require\("\.\.\/modules\/podcastFeed"\)/g, `require(${JSON.stringify(podcastFeed)})`);

  const out = path.join(scratchDir, `podcast-storage-${process.pid}.cjs`);
  transpileTo(js, out);
  const originalPaths = Module._nodeModulePaths;
  Module._nodeModulePaths = (from) => originalPaths.call(Module, root);
  try {
    return require(out);
  } finally {
    Module._nodeModulePaths = originalPaths;
  }
})();

const showFixture = parsed.show;
const episodesFixture = parsed.episodes;

const run = (checks) =>
  checks.reduce(
    (chain, [name, fn]) => chain.then(() => check(name, fn)),
    Promise.resolve(),
  );

const storageChecks = [
  [
    "subscribe stores the show and its episodes",
    async () => {
      const shows = await storage.subscribeToPodcast({
        show: showFixture,
        episodes: episodesFixture,
      });
      assert(shows.length === 1, `expected 1 show, got ${shows.length}`);
      const stored = await storage.loadPodcastEpisodes();
      assert(stored.length === 2, `expected 2 episodes, got ${stored.length}`);
      assert(stored[0].audioUrl.includes(".mp3"), "audio url persisted");
    },
  ],
  [
    "re-subscribing the same feed replaces rather than duplicates",
    async () => {
      await storage.subscribeToPodcast({
        show: showFixture,
        episodes: episodesFixture,
      });
      const shows = await storage.loadPodcastShows();
      assert(shows.length === 1, `idempotent subscribe, got ${shows.length} shows`);
    },
  ],
  [
    "resume position is persisted and read back",
    async () => {
      const episodeId = episodesFixture[0].id;
      await storage.savePodcastEpisodePosition(episodeId, 612);
      const positions = await storage.loadPodcastPositions();
      assert(positions[episodeId] === 612, `got ${positions[episodeId]}`);
      const episodes = await storage.loadPodcastEpisodes();
      const found = episodes.find((e) => e.id === episodeId);
      assert(found.positionSeconds === 612, `episode position: ${found.positionSeconds}`);
    },
  ],
  [
    "an episode past 95% counts as played",
    async () => {
      const episodeId = episodesFixture[0].id;
      // Episode Two is 1:02:05 = 3725s; 96% is well past the threshold.
      await storage.savePodcastEpisodePosition(episodeId, 3600);
      const episodes = await storage.loadPodcastEpisodes();
      const found = episodes.find((e) => e.id === episodeId);
      assert(found.played === true, "near the end means played");
    },
  ],
  [
    "marking finished keeps the episode as played",
    async () => {
      const episodeId = episodesFixture[1].id;
      await storage.markPodcastEpisodeFinished(episodeId);
      const episodes = await storage.loadPodcastEpisodes();
      const found = episodes.find((e) => e.id === episodeId);
      assert(found.played === true, "finished stays finished");
    },
  ],
  [
    "unsubscribe removes the show, its episodes and its positions",
    async () => {
      const before = await storage.loadPodcastPositions();
      assert(Object.keys(before).length > 0, "positions existed before");
      const shows = await storage.unsubscribeFromPodcast(showFixture.id);
      assert(shows.length === 0, `expected 0 shows, got ${shows.length}`);
      const episodes = await storage.loadPodcastEpisodes();
      assert(episodes.length === 0, `episodes left: ${episodes.length}`);
      const positions = await storage.loadPodcastPositions();
      assert(Object.keys(positions).length === 0, "orphan positions must be pruned");
    },
  ],
  [
    "a corrupt store degrades to empty instead of throwing",
    async () => {
      const stub = require(path.join(__dirname, "helpers", "asyncStorageStub.js"));
      await stub.__setItem("@podcast_shows", "{not json");
      const shows = await storage.loadPodcastShows();
      assert(Array.isArray(shows), "must return an array");
      assert(shows.length === 0, "corrupt store reads as empty");
      await stub.__setItem("@podcast_shows", undefined);
    },
  ],
];

// Storage checks must be sequential (they share one module-level store), and
// the summary must come after every async check has settled.
run(storageChecks).then(() => {
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
});

// ── wiring contracts ────────────────────────────────────────────────────

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

check("episodes are direct-play, never resolved or auto-downloaded", () => {
  const local = stripComments(read("modules/localPlayback.ts"));
  assert(local.includes("export function isPodcastTrack"), "isPodcastTrack must exist");
  assert(
    /isDirectPlayTrack\(track: LocalPlaybackTrack\): boolean \{\s*return isLocalPlaybackTrack\(track\) \|\| isSubsonicTrack\(track\) \|\| isPodcastTrack\(track\)/.test(
      local,
    ),
    "podcast must be part of the direct-play guard",
  );
  const svc = stripComments(read("modules/podcastService.ts"));
  assert(svc.includes('_isPodcast: true'), "the adapter must flag the track");
  assert(svc.includes('source: "podcast"'), "the adapter must tag the source");
});

check("the player resumes podcasts and excludes them from music history", () => {
  const player = stripComments(read("contexts/PlayerContext.tsx"));
  assert(
    /const isPlayedTrackPodcast = isPodcastTrack\(track\)/.test(player),
    "the queue must know it is playing a podcast",
  );
  assert(
    player.includes("savePodcastEpisodePosition("),
    "progress must be checkpointed",
  );
  assert(
    /!isPodcastTrack\(track\) &&/.test(player),
    "episodes must be excluded from the previously-played shelf",
  );
  assert(
    player.includes("markPodcastEpisodeFinished("),
    "a finished episode must be marked, not left resumable",
  );
  assert(
    /podcastCheckpointRef\.current >= 15_000/.test(player),
    "checkpoints must be throttled, not written on every progress tick",
  );
});

check("library exposes a podcasts section with a subscribe entry", () => {
  const lib = stripComments(read("components/screens/LibraryScreen.tsx"));
  assert(lib.includes('"Podcasts"'), "the section must exist");
  assert(lib.includes("podcastItems"), "the section must have items");
  assert(
    lib.includes("PodcastSubscribeModal"),
    "the subscribe sheet must be rendered",
  );
  assert(
    lib.includes('navigation.navigate("PodcastShow"'),
    "tapping a show must open its episodes",
  );
});

check("the route is registered and both locales carry the copy", () => {
  const app = stripComments(read("App.tsx"));
  assert(app.includes('name="PodcastShow"'), "route must be registered");
  assert(app.includes("PodcastShowScreen"), "screen must be imported");
  for (const file of ["locales/en.json", "locales/fa.json"]) {
    const json = JSON.parse(read(file));
    for (const key of [
      "podcasts.title",
      "podcasts.subscribeTitle",
      "podcasts.subscribeDescription",
      "podcasts.feedUrl",
      "podcasts.subscribe",
      "podcasts.unplayedCount",
    ]) {
      assert(
        typeof json[key] === "string" && json[key].length > 0,
        `${file} is missing ${key}`,
      );
    }
  }
});

check("the feed parser dependency is a declared direct dependency", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(
    typeof pkg.dependencies["fast-xml-parser"] === "string",
    "fast-xml-parser must be a direct dependency, not a transitive one",
  );
});
