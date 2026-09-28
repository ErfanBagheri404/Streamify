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
module.exports.__esModule = true;
