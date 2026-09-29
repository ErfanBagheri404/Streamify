/**
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
