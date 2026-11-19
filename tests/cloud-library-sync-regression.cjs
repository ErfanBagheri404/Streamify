/* Run: node tests/cloud-library-sync-regression.cjs
 *
 * Regression: the cloud push is a full replace (delete-then-insert), so a GET
 * can observe a playlist row with zero tracks. That transient empty read must
 * not be treated as "deleted on another device" and wipe the local songs.
 * Legitimate deletions (remote playlist with some tracks still present) must
 * still propagate.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const failures = [];
let checks = 0;

async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}: ${error && error.message}`);
  }
}

const readRepoFile = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ---- in-memory Supabase ----------------------------------------------------

const db = { playlists: [], playlist_tracks: [], liked_tracks: [] };

function makeBuilder(table) {
  const state = { op: "select", filters: [], payload: null, order: null };
  const match = (row) =>
    state.filters.every(([col, val]) =>
      typeof val === "function" ? val(row[col]) : row[col] === val,
    );
  const run = () => {
    if (state.op === "select") {
      let rows = db[table].filter(match).map((row) => ({ ...row }));
      if (state.order) {
        const [col, opt] = state.order;
        rows.sort(
          (a, b) =>
            String(a[col]).localeCompare(String(b[col])) *
            (opt && opt.ascending === false ? -1 : 1),
        );
      }
      return { data: rows, error: null };
    }
    if (state.op === "insert" || state.op === "upsert") {
      if (state.op === "upsert") {
        db[table] = db[table].filter((row) => !match(row));
      }
      const rows = state.payload.map((row, index) => ({
        id: `${table}_id_${db[table].length + index}`,
        ...row,
      }));
      db[table].push(...rows);
      return { data: null, error: null };
    }
    if (state.op === "delete") {
      const removed = db[table].filter(match);
      db[table] = db[table].filter((row) => !match(row));
      if (table === "playlists") {
        // Mirror the playlist_tracks -> playlists FK cascade.
        const ids = new Set(removed.map((row) => row.id));
        db.playlist_tracks = db.playlist_tracks.filter(
          (row) => !ids.has(row.playlist_id),
        );
      }
      return { data: null, error: null };
    }
    throw new Error(`unexpected ${state.op}`);
  };

  const builder = {
    select: () => builder,
    eq: (col, value) => {
      state.filters.push([col, value]);
      return builder;
    },
    in: (col, values) => {
      state.filters.push([col, (value) => values.includes(value)]);
      return builder;
    },
    order: (col, opt) => {
      state.order = [col, opt];
      return builder;
    },
    delete: () => {
      state.op = "delete";
      return builder;
    },
    insert: (rows) => {
      state.op = "insert";
      state.payload = rows;
      return builder;
    },
    upsert: (rows) => {
      state.op = "upsert";
      state.payload = rows;
      return builder;
    },
    then: (resolve, reject) => {
      try {
        resolve(run());
      } catch (error) {
        reject(error);
      }
    },
  };
  return builder;
}

const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
  },
  from: (table) => makeBuilder(table),
};

// ---- in-memory StorageService ---------------------------------------------

const kv = new Map();
const storage = { playlists: [], likedSongs: [], knownLibraryTracks: [] };
const StorageService = {
  loadPlaylists: async () => storage.playlists,
  savePlaylists: async (next) => {
    storage.playlists = next;
  },
  loadLikedSongs: async () => storage.likedSongs,
  saveLikedSongs: async (next) => {
    storage.likedSongs = next;
  },
  loadKnownLibraryTracks: async () => storage.knownLibraryTracks,
  getItem: async (key) => kv.get(key),
  setItem: async (key, value) => kv.set(key, value),
  removeItem: async (key) => kv.delete(key),
};

// ---- load the real module with stubs --------------------------------------

const stubs = {
  "../components/core/api": {
    fetchWithRetry: async () => {
      throw new Error("network disabled in test");
    },
    getSoundCloudApiV2Base: () => "",
  },
  "../components/core/image": {
    pickBestImageUrl: (value) =>
      typeof value === "string" ? value : undefined,
    sanitizeImageUrl: (value) => value,
  },
  "./provider-endpoints": {
    buildProviderUrlCandidates: () => [],
    getProviderEndpoints: () => ({}),
  },
  "../modules/searchAPI": { searchAPI: {} },
  "../utils/storage": { StorageService },
  "./supabase/client": { getSupabaseClient: () => supabase },
};

const js = ts.transpileModule(readRepoFile("lib/cloud-library-sync.ts"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const moduleUnderTest = { exports: {} };
new Function("require", "module", "exports", js)(
  (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) {
      return stubs[id];
    }
    throw new Error(`unexpected import: ${id}`);
  },
  moduleUnderTest,
  moduleUnderTest.exports,
);
const { syncCloudLibrarySnapshot } = moduleUnderTest.exports;

// ---- fixtures --------------------------------------------------------------

const BASE_SONGS = ["song1", "song2", "song3"];

function trackRef(id) {
  return { id, source: "local" };
}

function localTrack(id) {
  return {
    id,
    source: "local",
    title: `Track ${id}`,
    artist: "Artist",
    url: "",
    thumbnail: "",
    duration: 100,
  };
}

function seed({ localSongs, remoteSongs }) {
  storage.playlists = [
    {
      id: "p1",
      name: "My Mix",
      description: "",
      createdAt: 1700000000000,
      tracks: localSongs.map(localTrack),
    },
  ];
  storage.likedSongs = [];
  kv.set(
    "@last_synced_cloud_library_snapshot",
    JSON.stringify({
      playlists: [
        {
          id: "p1",
          name: "My Mix",
          description: "",
          createdAt: 1700000000000,
          songs: BASE_SONGS.map(trackRef),
        },
      ],
      likedSongs: [],
    }),
  );
  db.playlists = [
    {
      id: "playlist-row",
      client_playlist_id: "p1",
      name: "My Mix",
      description: "",
      created_at_client: "2026-01-01T00:00:00Z",
      user_id: "user-1",
    },
  ];
  db.playlist_tracks = remoteSongs.map((id, index) => ({
    id: `playlist-track-${index}`,
    playlist_id: "playlist-row",
    user_id: "user-1",
    track_id: id,
    source: "local",
  }));
  db.liked_tracks = [];
}

const savedSongIds = () =>
  storage.playlists[0].tracks.map((track) => track.id).sort();

async function main() {
  await check("transient empty remote read keeps local songs", async () => {
    // Push is mid-replace: playlist row exists, its tracks read as empty.
    seed({ localSongs: BASE_SONGS, remoteSongs: [] });
    await syncCloudLibrarySnapshot();
    assert.deepEqual(savedSongIds(), BASE_SONGS);
    assert.equal(db.playlist_tracks.length, 3, "push re-uploads all songs");
    const lastSynced = JSON.parse(
      kv.get("@last_synced_cloud_library_snapshot"),
    );
    assert.deepEqual(
      lastSynced.playlists[0].songs.map((song) => song.id).sort(),
      BASE_SONGS,
      "last-synced snapshot does not record the empty read",
    );
  });

  await check("remote track deletion still propagates", async () => {
    seed({
      localSongs: BASE_SONGS,
      remoteSongs: ["song1", "song2"],
    });
    await syncCloudLibrarySnapshot();
    assert.deepEqual(savedSongIds(), ["song1", "song2"]);
    assert.equal(db.playlist_tracks.length, 2, "push keeps the deletion");
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length}/${checks} checks failed`);
    for (const { name, error } of failures) {
      console.error(`\n${name}\n${error && error.stack}`);
    }
    process.exit(1);
  }
  console.log(`\n${checks}/${checks} checks passed`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
