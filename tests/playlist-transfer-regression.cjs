/**
 * Playlist transfer contract tests (issue #40).
 *
 * modules/playlistTransfer.ts is pure by design, so the suite transpiles the
 * real checked-in file and drives it — the parsers, the CSV/M3U writers and the
 * matcher are all exercised, not asserted as strings.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

const ts = require(path.join(root, "node_modules", "typescript"));
const src = read("modules", "playlistTransfer.ts");
const js = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const mod = new module.constructor();
mod.paths = module.paths;
mod._compile(js, path.join(root, "modules", "playlistTransfer.js"));
const pt = mod.exports;

const libraryScreen = read("components", "screens", "LibraryScreen.tsx");
const albumPlaylist = read("components", "screens", "AlbumPlaylistScreen.tsx");


// --- M3U parsing ------------------------------------------------------------

check("parses a standard #EXTINF playlist", () => {
  const entries = pt.parseM3u(
    [
      "#EXTM3U",
      "#EXTINF:214,Ed Sheeran - Shape of You",
      "https://example.com/a.mp3",
      "#EXTINF:-1,Some Artist - No Duration",
      "https://example.com/b.mp3",
    ].join("\n"),
  );
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].title, "Shape of You");
  assert.strictEqual(entries[0].artist, "Ed Sheeran");
  assert.strictEqual(entries[0].durationSeconds, 214);
  assert.strictEqual(entries[0].uri, "https://example.com/a.mp3");
  assert.strictEqual(entries[1].durationSeconds, undefined, "-1 means unknown");
});

check("a hyphen inside a title is not mistaken for an artist separator", () => {
  const [entry] = pt.parseM3u(
    "#EXTINF:200,Queen - Bohemian Rhapsody - Remastered 2011\nhttps://e/x.mp3",
  );
  assert.strictEqual(entry.artist, "Queen");
  assert.strictEqual(entry.title, "Bohemian Rhapsody - Remastered 2011");
});

check("a title with no artist is kept whole", () => {
  const [entry] = pt.parseM3u("#EXTINF:100,Just A Title\nhttps://e/x.mp3");
  assert.strictEqual(entry.title, "Just A Title");
  assert.strictEqual(entry.artist, undefined);
});

check("other # headers are ignored, not treated as tracks", () => {
  const entries = pt.parseM3u(
    ["#EXTM3U", "#EXTALB:My Album", "#EXTENC:mp3", "https://e/x.mp3"].join("\n"),
  );
  assert.strictEqual(entries.length, 1);
});

check("a bare list of URIs imports, titles from the filename", () => {
  const entries = pt.parseM3u(
    ["https://e/My%20Song.mp3", "https://e/other.mp3"].join("\n"),
  );
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].title, "My Song");
  assert.strictEqual(entries[0].uri, "https://e/My%20Song.mp3");
});

check("a bare list of names imports as titles", () => {
  const entries = pt.parseM3u("Shape of You\nBohemian Rhapsody");
  assert.deepStrictEqual(
    entries.map((e) => e.title),
    ["Shape of You", "Bohemian Rhapsody"],
  );
});

check("CRLF input and blank lines are handled", () => {
  const entries = pt.parseM3u(
    "\r\n#EXTM3U\r\n\r\n#EXTINF:10,A - B\r\nhttps://e/x.mp3\r\n\r\n",
  );
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].title, "B");
});

check("empty input yields no entries rather than throwing", () => {
  assert.deepStrictEqual(pt.parseM3u(""), []);
  assert.deepStrictEqual(pt.parsePlaylistText("   \n  "), []);
});

// --- PLS parsing ------------------------------------------------------------

check("parses PLS with file, title and length", () => {
  const entries = pt.parsePlaylistText(
    [
      "[playlist]",
      "NumberOfEntries=2",
      "File1=https://e/one.mp3",
      "Title1=First Song",
      "Length1=180",
      "File2=https://e/two.mp3",
      "Title2=Second Song",
      "Version=2",
    ].join("\n"),
  );
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].title, "First Song");
  assert.strictEqual(entries[0].durationSeconds, 180);
  assert.strictEqual(entries[1].title, "Second Song");
  assert.strictEqual(entries[1].durationSeconds, undefined);
});

check("PLS entries are returned in index order, not file order", () => {
  const entries = pt.parsePlaylistText(
    ["[playlist]", "File2=https://e/b.mp3", "Title2=B", "File1=https://e/a.mp3", "Title1=A"].join("\n"),
  );
  assert.deepStrictEqual(
    entries.map((e) => e.title),
    ["A", "B"],
  );
});

check("PLS dispatch happens on content, not extension", () => {
  // A user pastes this; it has no .pls name anywhere.
  const entries = pt.parsePlaylistText("[playlist]\nFile1=https://e/x.mp3");
  assert.strictEqual(entries.length, 1);
});

// --- CSV export -------------------------------------------------------------

check("CSV starts with a BOM so Excel reads UTF-8", () => {
  const csv = pt.toCsv([{ title: "Song" }]);
  assert.strictEqual(csv.charCodeAt(0), 0xfeff);
});

check("CSV quotes commas, quotes and newlines", () => {
  const csv = pt.toCsv([
    { title: 'He said "hi", then left', artist: "A, B" },
    { title: "Line1\nLine2" },
  ]);
  assert.ok(csv.includes('"He said ""hi"", then left"'), csv);
  assert.ok(csv.includes('"A, B"'), csv);
  assert.ok(csv.includes('"Line1\nLine2"'), csv);
});

check("CSV neutralizes formula injection", () => {
  const csv = pt.toCsv([
    { title: "=1+1", artist: "+cmd", album: "-2" },
  ]);
  assert.ok(csv.includes("'=1+1"), csv);
  assert.ok(csv.includes("'+cmd"), csv);
  assert.ok(csv.includes("'-2"), csv);
});

check("CSV uses CRLF and a header row", () => {
  const csv = pt.toCsv([{ title: "A" }]);
  assert.ok(csv.startsWith("\uFEFFTitle,Artist,Album\r\n"), JSON.stringify(csv));
});

check("Persian titles survive the CSV round trip", () => {
  const csv = pt.toCsv([{ title: "آهنگ", artist: "خواننده" }]);
  assert.ok(csv.includes("آهنگ"), csv);
});

// --- M3U export -------------------------------------------------------------

check("M3U export is readable shape: header, EXTINF, URI", () => {
  const m3u = pt.toM3u([
    { title: "Song", artist: "Artist", uri: "https://e/s.mp3", durationSeconds: 200.7 },
    { title: "No Uri", artist: "B" },
  ]);
  const lines = m3u.trim().split("\r\n");
  assert.strictEqual(lines[0], "#EXTM3U");
  assert.strictEqual(lines[1], "#EXTINF:200,Artist - Song");
  assert.strictEqual(lines[2], "https://e/s.mp3");
  assert.strictEqual(lines[3], "#EXTINF:-1,B - No Uri", "unknown duration is -1");
  assert.strictEqual(lines[4], "No Uri");
});

check("M3U export round-trips through the parser", () => {
  const m3u = pt.toM3u([
    { title: "Shape of You", artist: "Ed Sheeran", uri: "https://e/a.mp3", durationSeconds: 214 },
  ]);
  const [entry] = pt.parseM3u(m3u);
  assert.strictEqual(entry.title, "Shape of You");
  assert.strictEqual(entry.artist, "Ed Sheeran");
  assert.strictEqual(entry.durationSeconds, 214);
  assert.strictEqual(entry.uri, "https://e/a.mp3");
});

// --- filename safety --------------------------------------------------------

check("playlist file names cannot escape the directory", () => {
  assert.strictEqual(pt.playlistFileName("../../etc/passwd"), ".. .. etc passwd.m3u8");
  assert.strictEqual(pt.playlistFileName("a/b:c*d"), "a b c d.m3u8");
  assert.strictEqual(pt.playlistFileName(""), "playlist.m3u8");
  assert.strictEqual(pt.playlistFileName("x".repeat(200)).length, 85);
});

// --- matching ---------------------------------------------------------------

check("matching is punctuation- and case-insensitive", () => {
  assert.ok(pt.isLikelyMatch("Shape of You (Lyric)", "shape of you"));
  assert.ok(pt.isLikelyMatch("Bohemian Rhapsody", "Bohemian Rhapsody"));
  assert.ok(pt.isLikelyMatch("Don't Stop Me Now", "Dont Stop Me Now"));
});

check("matching rejects genuinely different songs", () => {
  assert.ok(!pt.isLikelyMatch("Shape of You", "Photograph"));
  assert.ok(!pt.isLikelyMatch("", "Photograph"));
  assert.ok(!pt.isLikelyMatch(null, "Photograph"));
});

check("matching tolerates a trailing version suffix", () => {
  assert.ok(pt.isLikelyMatch("Bohemian Rhapsody - Remastered 2011", "Bohemian Rhapsody"));
});

// --- UI wiring --------------------------------------------------------------

check("the library screen offers import", () => {
  assert.ok(
    libraryScreen.includes("pickAndParsePlaylist") ||
      libraryScreen.includes("createPlaylistFromEntries"),
    "library has no import path",
  );
  assert.ok(
    libraryScreen.includes("handleImportPlaylist"),
    "no header button calls the importer",
  );
});

check("the playlist screen can export a playlist as M3U and CSV", () => {
  assert.ok(
    albumPlaylist.includes("exportPlaylist"),
    "no export path from the playlist screen",
  );
  assert.ok(
    albumPlaylist.includes('"ExportM3U"') && albumPlaylist.includes('"ExportCSV"'),
    "both formats must be offered",
  );
});

check("the transfer IO layer routes export through the share sheet", () => {
  const io = read("modules", "playlistTransferIO.ts");
  assert.ok(io.includes("shareAsync"), "no system share sheet on export");
  assert.ok(io.includes("getDocumentAsync"), "no file picker on import");
  assert.ok(io.includes("writeAsStringAsync"), "content never reaches disk");
  assert.ok(
    io.includes("mimeType") || io.includes("audio/x-mpegurl"),
    "exported file has no MIME type, so VLC cannot open it",
  );
  assert.ok(
    io.includes("addPlaylist"),
    "imported tracks are never saved as a playlist",
  );
});

// --- report -----------------------------------------------------------------

const failed = results.filter((r) => r.startsWith("FAIL"));
for (const line of results) {
  console.log(line);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
