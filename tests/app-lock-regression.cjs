/**
 * App lock + private-playlist vault regression suite.
 *
 * Runtime half: `modules/appLock.ts` is pure, so it is transpiled and driven
 * for real — PIN hashing, lockout backoff and the playlist filter are the
 * rules the whole feature rests on.
 *
 * Contract half: the store, the gate and the surfaces that must hide things
 * cannot run under Node, so they are asserted by file content.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const scratchDir = process.env.TMPDIR || os.tmpdir();

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
}

function loadPureModule(rel) {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const out = path.join(scratchDir, `applock-${process.pid}-${rel.replace(/[\\/]/g, "_")}.cjs`);
  fs.writeFileSync(out, js);
  const originalPaths = Module._nodeModulePaths;
  Module._nodeModulePaths = (from) => originalPaths.call(Module, root);
  try {
    return require(out);
  } finally {
    Module._nodeModulePaths = originalPaths;
    fs.unlinkSync(out);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const appLock = loadPureModule("modules/appLock.ts");
const store = stripComments(read("modules/appLockStore.ts"));
const lockCtx = stripComments(read("contexts/AppLockContext.tsx"));
const vaultCtx = stripComments(read("contexts/VaultContext.tsx"));
const pinPad = stripComments(read("components/PinPad.tsx"));
const settings = stripComments(read("components/screens/SettingsScreen.tsx"));
const library = stripComments(read("components/screens/LibraryScreen.tsx"));
const albumScreen = stripComments(read("components/screens/AlbumPlaylistScreen.tsx"));
const miniPlayer = stripComments(read("components/MiniPlayer.tsx"));
const app = stripComments(read("App.tsx"));
const appSettings = read("lib/app-settings.ts");

const runtimeChecks = [
  [
    "a PIN is never stored in the clear",
    () => {
      const hash = appLock.hashPin("4821");
      assert.ok(!hash.includes("4821"), `hash leaks the PIN: ${hash}`);
      assert.strictEqual(typeof hash, "string");
      assert.ok(appLock.verifyPinHash("4821", hash));
      assert.ok(!appLock.verifyPinHash("4822", hash));
    },
  ],
  [
    "a wrong PIN of the same length still fails",
    () => {
      const a = appLock.hashPin("1111");
      const b = appLock.hashPin("2222");
      assert.notStrictEqual(a, b);
    },
  ],
  [
    "non-digit input is stripped and short PINs rejected",
    () => {
      assert.strictEqual(appLock.sanitizePin("4-8 2_1"), "4821");
      assert.ok(appLock.isValidPin("4821"));
      assert.ok(appLock.isValidPin("482193"));
      assert.ok(!appLock.isValidPin("482"));
      assert.ok(!appLock.isValidPin("48219345678a"));
      assert.ok(!appLock.isValidPin(""));
    },
  ],
  [
    "lockout is absent for the first four wrong attempts",
    () => {
      let state = { failedAttempts: 0, lockedUntil: 0 };
      const now = 1_000_000;
      for (let i = 0; i < 4; i += 1) {
        state = appLock.nextLockout(state, now);
        assert.strictEqual(
          state.lockedUntil,
          0,
          `attempt ${i + 1} should not lock out`,
        );
        assert.ok(!appLock.isLockedOut(state, now));
      }
      state = appLock.nextLockout(state, now);
      assert.ok(appLock.isLockedOut(state, now), "5th wrong attempt must lock out");
      assert.ok(appLock.remainingLockoutMs(state, now) > 0);
    },
  ],
  [
    "lockout backoff grows and is capped",
    () => {
      const now = 1_000_000;
      let state = { failedAttempts: 0, lockedUntil: 0 };
      const waits = [];
      for (let i = 0; i < 12; i += 1) {
        state = appLock.nextLockout(state, now);
        waits.push(appLock.remainingLockoutMs(state, now));
      }
      const first = waits.find((w) => w > 0);
      const last = waits[waits.length - 1];
      assert.ok(first > 0);
      assert.ok(last > first, `backoff did not grow: ${first} -> ${last}`);
      assert.ok(last <= 5 * 60 * 1000, `backoff exceeded cap: ${last}`);
    },
  ],
  [
    "an expired lockout stops blocking",
    () => {
      const now = 1_000_000;
      let state = { failedAttempts: 0, lockedUntil: 0 };
      for (let i = 0; i < 5; i += 1) {
        state = appLock.nextLockout(state, now);
      }
      assert.ok(appLock.isLockedOut(state, now));
      const muchLater = now + 6 * 60 * 1000;
      assert.ok(!appLock.isLockedOut(state, muchLater));
      assert.strictEqual(appLock.remainingLockoutMs(state, muchLater), 0);
    },
  ],
  [
    "the wait string is readable at a glance",
    () => {
      assert.strictEqual(appLock.formatLockoutWait(5_000), "5s");
      assert.strictEqual(appLock.formatLockoutWait(65_000), "1:05");
      assert.strictEqual(appLock.formatLockoutWait(0), "0s");
    },
  ],
  [
    "private playlists are hidden until the vault opens",
    () => {
      const playlists = [
        { id: "1", name: "Public" },
        { id: "2", name: "Secret", isPrivate: true },
        { id: "3", name: "Other" },
      ];
      const locked = appLock.filterPrivatePlaylists(playlists, false);
      assert.deepStrictEqual(
        locked.map((p) => p.id),
        ["1", "3"],
        "private playlist leaked while the vault is closed",
      );
      const unlocked = appLock.filterPrivatePlaylists(playlists, true);
      assert.strictEqual(unlocked.length, 3);
    },
  ],
  [
    "only an explicit true counts as private",
    () => {
      const playlists = [
        { id: "1" },
        { id: "2", isPrivate: false },
        { id: "3", isPrivate: undefined },
        { id: "4", isPrivate: true },
      ];
      assert.deepStrictEqual(
        appLock.filterPrivatePlaylists(playlists, false).map((p) => p.id),
        ["1", "2", "3"],
      );
      assert.strictEqual(appLock.countPrivatePlaylists(playlists), 1);
    },
  ],
  [
    "the filter does not mutate its input",
    () => {
      const playlists = [
        { id: "1" },
        { id: "2", isPrivate: true },
      ];
      const copy = JSON.parse(JSON.stringify(playlists));
      appLock.filterPrivatePlaylists(playlists, true);
      assert.deepStrictEqual(playlists, copy);
    },
  ],
];

const wiringChecks = [
  [
    "the credential lives in SecureStore, not AppSettings",
    () => {
      assert.ok(
        /import \* as SecureStore from "expo-secure-store"/.test(store),
        "SecureStore is not imported by the store",
      );
      assert.ok(
        /SecureStore\.setItemAsync\(\s*APP_LOCK_PIN_KEY,\s*hashPin\(pin\)/.test(
          store,
        ),
        "the PIN hash is not what gets written to SecureStore",
      );
      // Nothing in the settings payload may carry a lock secret.
      assert.ok(
        !/pin|Pin|PIN/.test(appSettings.split("export const DEFAULT_APP_SETTINGS")[1] ?? ""),
        "a PIN-related field leaked into DEFAULT_APP_SETTINGS",
      );
    },
  ],
  [
    "a wrong PIN is recorded and a correct one clears the backoff",
    () => {
      assert.ok(
        /recordFailedAppLockAttempt/.test(store),
        "failed attempts are never counted",
      );
      assert.ok(
        /clearAppLockAttempts\(\)/.test(store),
        "a successful unlock does not clear the backoff",
      );
      const verify = store.slice(
        store.indexOf("export async function verifyAppLockPin"),
      );
      assert.ok(
        /computeRemainingMs\(state, now\) > 0/.test(verify),
        "verifyAppLockPin does not honour an active lockout",
      );
      assert.ok(
        /hashPin\(pin\) !== stored/.test(verify),
        "verifyAppLockPin does not compare against the stored hash",
      );
    },
  ],
  [
    "the gate is an overlay so playback survives the lock",
    () => {
      assert.ok(
        /\{children\}/.test(lockCtx),
        "the gate no longer renders children",
      );
      assert.ok(
        /const showGate = !isChecking && !isUnlocked/.test(lockCtx),
        "the gate visibility rule is gone",
      );
      const returnBlock = lockCtx.slice(lockCtx.indexOf("return ("));
      assert.ok(
        /\{showGate \?/.test(returnBlock) && /\{children\}/.test(returnBlock),
        "children must stay mounted under the gate overlay",
      );
    },
  ],
  [
    "re-engaging the lock is gated on an armed credential",
    () => {
      assert.ok(
        /lockArmedRef/.test(lockCtx),
        "background re-lock is not gated on an armed lock",
      );
      const block = lockCtx.slice(
        lockCtx.indexOf('if (nextState === "background")'),
      );
      assert.ok(
        /if \(lockArmedRef\.current\)/.test(block),
        "the gate can pop up for users who never set a PIN",
      );
    },
  ],
  [
    "the biometric prompt is skipped during a lockout",
    () => {
      const effect = lockCtx.slice(
        lockCtx.indexOf("biometricsPromptedRef.current = true;") - 900,
        lockCtx.indexOf("biometricsPromptedRef.current = true;"),
      );
      assert.ok(
        /lockedOut/.test(effect),
        "a wrong PIN can be followed by a prompt that always succeeds",
      );
    },
  ],
  [
    "the mini player hides the title while locked",
    () => {
      assert.ok(
        /hideMetadataWhileLocked && !isUnlocked/.test(miniPlayer),
        "the mini player does not follow the lock state",
      );
      assert.ok(
        /hideMetadata \? t\("appLock\.hiddenTrack"\)/.test(miniPlayer),
        "the mini player has no placeholder title",
      );
      assert.ok(
        /\(statusText \|\| currentTrack\.artist\) && !hideMetadata/.test(
          miniPlayer,
        ),
        "the artist line is not suppressed while locked",
      );
    },
  ],
  [
    "every browse surface filters through the vault",
    () => {
      assert.ok(
        /vault\.visible\(playlists\)/.test(library),
        "the library does not filter private playlists",
      );
      assert.ok(
        /visiblePlaylists\.map\(\(playlist\)/.test(library),
        "the playlist rows still come from the unfiltered list",
      );
      // The vault row must not carry searchable text: a row is findable via
      // the library search box, which is exactly the leak we are preventing.
      const rowStart = library.indexOf('id: "__private_vault__"');
      const rowEnd = library.indexOf("onPress:", rowStart);
      const vaultRow = library.slice(rowStart, rowEnd);
      assert.ok(
        /searchText: ""/.test(vaultRow),
        "the locked-vault row is searchable",
      );
    },
  ],
  [
    "the playlist screen can lock a playlist",
    () => {
      assert.ok(
        /playlistActions\.toggleLock/.test(albumScreen),
        "no lock option in the playlist menu",
      );
      assert.ok(
        /await setPlaylistPrivate\(albumId, next\)/.test(albumScreen),
        "the lock option does not persist",
      );
      assert.ok(
        /lock-closed-outline/.test(albumScreen) && /lock-open-outline/.test(albumScreen),
        "the lock option has no locked/unlocked icons",
      );
    },
  ],
  [
    "removing the lock re-verifies the current PIN",
    () => {
      const modal = stripComments(read("components/AppLockPinModal.tsx"));
      const remove = modal.slice(modal.indexOf("const removePin"));
      assert.ok(
        /verifyAppLockPin\(pin, at\)/.test(remove),
        "disabling the lock does not verify the current PIN",
      );
      assert.ok(
        /await disableAppLock\(\)/.test(remove),
        "the lock is never removed on success",
      );
    },
  ],
  [
    "setting a PIN asks for it twice",
    () => {
      const modal = stripComments(read("components/AppLockPinModal.tsx"));
      const create = modal.slice(modal.indexOf("const createPin"));
      assert.ok(
        /confirmPin === null/.test(create) && /pin !== confirmPin/.test(create),
        "a typo'd PIN is not caught at setup",
      );
      assert.ok(
        /registerAppLockPin\(confirmPin\)/.test(create),
        "the confirmed PIN is not what gets registered",
      );
    },
  ],
  [
    "both providers are mounted in the tree",
    () => {
      assert.ok(/<AppLockProvider>/.test(app), "AppLockProvider is not mounted");
      assert.ok(/<VaultProvider>/.test(app), "VaultProvider is not mounted");
      const body = app.slice(app.indexOf("<DebugStartupBoundary>"));
      assert.ok(
        body.indexOf("<AppLockProvider>") < body.indexOf("<PlayerProvider>"),
        "the lock must be mounted outside the player so the overlay survives",
      );
    },
  ],
  [
    "the keypad is shared by every prompt",
    () => {
      // The vault prompt lives in its own component; VaultContext only holds
      // state, so it has no keypad to share.
      const keypadUsers = [
        ["the lock gate", lockCtx],
        ["the vault prompt", stripComments(read("components/VaultUnlockPrompt.tsx"))],
        ["the PIN setup modal", stripComments(read("components/AppLockPinModal.tsx"))],
      ];
      keypadUsers.forEach(([label, src]) => {
        assert.ok(/<PinPad/.test(src), `${label} does not use the shared keypad`);
      });
      assert.ok(
        /numberOfLines|numbers only|sanitizePin/.test(pinPad) ||
          /value\.length >= PIN_LENGTH/.test(pinPad),
        "the keypad does not bound input length",
      );
    },
  ],
  [
    "both locales carry the lock copy",
    () => {
      ["en", "fa"].forEach((lang) => {
        const data = JSON.parse(read(`locales/${lang}.json`));
        assert.ok(data.appLock, `${lang}.json has no appLock block`);
        [
          "title",
          "subtitle",
          "hiddenTrack",
          "setPin",
          "changePin",
          "pinMismatch",
          "pinWrong",
          "pinTooShort",
          "tooManyAttempts",
          "waitSeconds",
          "requirePin",
          "hideMetadata",
          "privacyTitle",
          "vaultTitle",
        ].forEach((key) => {
          assert.ok(
            data.appLock[key],
            `${lang}.json appLock.${key} is missing`,
          );
        });
        assert.ok(
          data.appLock.waitSeconds.includes("{wait}"),
          `${lang} waitSeconds lost its interpolation variable`,
        );
      });
      const en = JSON.parse(read("locales/en.json"));
      const fa = JSON.parse(read("locales/fa.json"));
      assert.deepStrictEqual(
        Object.keys(en.appLock).sort(),
        Object.keys(fa.appLock).sort(),
        "the two locales drifted",
      );
    },
  ],
  [
    "the privacy settings live next to the account tab",
    () => {
      assert.ok(
        /t\("appLock\.requirePin"\)/.test(settings),
        "no PIN row in settings",
      );
      assert.ok(
        /t\("appLock\.hideMetadata"\)/.test(settings),
        "no metadata-suppression row in settings",
      );
      assert.ok(
        /AppLockPinModal/.test(settings) && /mode="disable"/.test(settings),
        "the settings screen cannot remove the lock",
      );
      const idx = settings.indexOf('t("appLock.privacyTitle")');
      assert.ok(idx > 0, "the privacy section is missing");
    },
  ],
  [
    "the biometric dependency is declared",
    () => {
      const pkg = JSON.parse(read("package.json"));
      assert.ok(
        pkg.dependencies["expo-local-authentication"],
        "expo-local-authentication is not a dependency",
      );
      assert.ok(
        /import \* as LocalAuthentication from "expo-local-authentication"/.test(
          store,
        ),
        "the store does not use the biometrics module",
      );
    },
  ],
];

async function run() {
  for (const [name, fn] of runtimeChecks) {
    await check(name, fn);
  }
  for (const [name, fn] of wiringChecks) {
    await check(name, fn);
  }
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

run();
