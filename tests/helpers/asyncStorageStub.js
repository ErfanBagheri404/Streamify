/**
 * In-memory stand-in for @react-native-async-storage/async-storage.
 *
 * The real package touches `window` and cannot be required under Node, so the
 * regression suites that exercise storage-backed pure modules inject this in
 * place of it (see tests/lyrics-offset-regression.cjs).
 *
 * `__esModule` + a self-referencing `default` are required because the
 * TypeScript transpile emits `__importDefault(require(...)).default`, which
 * looks for `.default` on an already-default object without the flag.
 */
const store = new Map();

const api = {
 * In-memory AsyncStorage stand-in for Node regression suites.
 *
 * Dual-shaped on purpose: TypeScript emits `__importDefault(...)` for a default
 * import, so the module must expose both `module.exports` members and a
 * `.default` alias plus `__esModule`. A default-only stub resolves to
 * undefined and the suite dies with "cannot read properties of undefined".
 */
const store = new Map();

const AsyncStorage = {
  async getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async setItem(key, value) {
    store.set(key, String(value));
  },
  async removeItem(key) {
    store.delete(key);
  },
  __store: store,
};

module.exports = api;
module.exports.default = api;
  async clear() {
    store.clear();
  },
  async getAllKeys() {
    return Array.from(store.keys());
  },
  async multiGet(keys) {
    return keys.map((key) => [key, store.has(key) ? store.get(key) : null]);
  },
  async multiSet(pairs) {
    pairs.forEach(([key, value]) => store.set(key, String(value)));
  },
  /** Test-only helper: seed a raw value (or delete when undefined). */
  async __setItem(key, value) {
    if (value === undefined) store.delete(key);
    else store.set(key, value);
  },
  __reset() {
    store.clear();
  },
};

module.exports = AsyncStorage;
module.exports.default = AsyncStorage;
module.exports.__esModule = true;
