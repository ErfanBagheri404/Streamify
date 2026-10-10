/**
 * Minimal react-native stand-in for Node regression suites.
 *
 * `storage.ts` only touches DeviceEventEmitter. The real react-native package
 * is ESM + Flow and cannot be required from a CommonJS suite, so the few
 * members actually used are provided here.
 */
const listeners = new Map();

const DeviceEventEmitter = {
  addListener(event, handler) {
    const existing = listeners.get(event) || new Set();
    existing.add(handler);
    listeners.set(event, existing);
    return {
      remove: () => existing.delete(handler),
    };
  },
  emit(event, payload) {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) handler(payload);
  },
};

module.exports = { DeviceEventEmitter };
module.exports.default = module.exports;
module.exports.__esModule = true;
