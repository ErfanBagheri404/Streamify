/* Run: node tests/usb-dac-regression.cjs
 *
 * Issue #42 — USB DAC / hi-res output mode.
 *
 * The JS wrapper is runtime-tested against a stubbed native module; the
 * config plugin and Kotlin sources are contract-checked, because the plugin
 * only runs during `expo prebuild` and the Kotlin needs a device.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
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

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Load modules/usbAudio.ts with a stubbed react-native + native module. */
function loadUsbAudio({ native, platform = 'android' } = {}) {
  const js = ts.transpileModule(read('modules/usbAudio.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const stub = (spec) => {
    if (spec === 'react-native') {
      return {
        __esModule: true,
        Platform: { OS: platform },
        NativeModules: native ? { StreamifyUsbAudio: native } : {},
      };
    }
    throw new Error(`unexpected require(${spec})`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', js)(stub, module, module.exports);
  return module.exports;
}

const goodNative = {
  getOutputInfo: async () => ({
    available: true,
    name: 'FiiO K3',
    type: 22,
    isDac: true,
    sampleRateHz: 96000,
  }),
  listUsbDevices: async () => [
    { name: 'FiiO K3', vendorId: 0x2972, productId: 0x0004, class: 0xff },
  ],
};

async function main() {
  // ---- availability ------------------------------------------------------

  await check('no native module: everything degrades, nothing throws', async () => {
    const m = loadUsbAudio({ native: null });
    assert.equal(m.isUsbDacAvailable, false);
    assert.equal(await m.getUsbAudioOutput(), null);
    assert.deepEqual(await m.listUsbAudioDevices(), []);
  });

  await check('iOS has no native path', async () => {
    const m = loadUsbAudio({ native: goodNative, platform: 'ios' });
    assert.equal(m.isUsbDacAvailable, false);
    assert.equal(await m.getUsbAudioOutput(), null);
  });

  await check('a throwing platform call resolves to null, not a rejection', async () => {
    const m = loadUsbAudio({
      native: {
        getOutputInfo: async () => { throw new Error('no audio service'); },
        listUsbDevices: async () => { throw new Error('no usb service'); },
      },
    });
    assert.equal(await m.getUsbAudioOutput(), null);
    assert.deepEqual(await m.listUsbAudioDevices(), []);
  });

  // ---- output info -------------------------------------------------------

  await check('reports the DAC name, flag and sample rate', async () => {
    const m = loadUsbAudio({ native: goodNative });
    const info = await m.getUsbAudioOutput();
    assert.equal(info.name, 'FiiO K3');
    assert.equal(info.isDac, true);
    assert.equal(info.sampleRateHz, 96000);
  });

  await check('available:false is a null output, not a half-filled object', async () => {
    const m = loadUsbAudio({
      native: { ...goodNative, getOutputInfo: async () => ({ available: false }) },
    });
    assert.equal(await m.getUsbAudioOutput(), null);
  });

  await check('listUsbDevices: a non-array answer becomes []', async () => {
    const m = loadUsbAudio({
      native: { ...goodNative, listUsbDevices: async () => undefined },
    });
    assert.deepEqual(await m.listUsbAudioDevices(), []);
  });

  // ---- formatting --------------------------------------------------------

  await check('formatSampleRate: integer and fractional kHz', () => {
    const m = loadUsbAudio({ native: goodNative });
    assert.equal(m.formatSampleRate(48000), '48 kHz');
    assert.equal(m.formatSampleRate(96000), '96 kHz');
    assert.equal(m.formatSampleRate(192000), '192 kHz');
    assert.equal(m.formatSampleRate(44100), '44.1 kHz');
  });

  await check('formatSampleRate: absent or nonsense rates render empty', () => {
    const m = loadUsbAudio({ native: goodNative });
    for (const value of [0, undefined, NaN, -1, Infinity]) {
      assert.equal(m.formatSampleRate(value), '', `bad output for ${value}`);
    }
  });

  await check('isHiRes: above CD quality only', () => {
    const m = loadUsbAudio({ native: goodNative });
    assert.equal(m.isHiRes(44100), false, 'CD quality is not hi-res');
    assert.equal(m.isHiRes(48000), true);
    assert.equal(m.isHiRes(192000), true);
    assert.equal(m.isHiRes(0), false);
    assert.equal(m.isHiRes(undefined), false);
  });

  // ---- native sources ----------------------------------------------------

  await check('the Kotlin module reports the output device and USB list', () => {
    const kt = read('plugins/android/StreamifyUsbAudioModule.kt');
    assert.match(kt, /class StreamifyUsbAudioModule/);
    assert.match(kt, /override fun getName\(\): String = "StreamifyUsbAudio"/);
    assert.match(kt, /@ReactMethod\s*\n\s*fun getOutputInfo\(promise: Promise\)/);
    assert.match(kt, /@ReactMethod\s*\n\s*fun listUsbDevices\(promise: Promise\)/);
    assert.match(kt, /GET_DEVICES_OUTPUTS/);
    assert.match(kt, /TYPE_USB_DEVICE/);
    // Every path resolves: a rejected promise would crash the settings screen.
    assert.equal(/promise\.reject/.test(kt), false, 'the module must never reject');
  });

  await check('the package registers the module', () => {
    const kt = read('plugins/android/StreamifyUsbAudioPackage.kt');
    assert.match(kt, /class StreamifyUsbAudioPackage : ReactPackage/);
    assert.match(kt, /listOf\(StreamifyUsbAudioModule\(reactContext\)\)/);
  });

  await check('the plugin copies both Kotlin files and registers the package', () => {
    const plugin = read('plugins/withUsbDac.js');
    assert.match(plugin, /StreamifyUsbAudioModule\.kt/);
    assert.match(plugin, /StreamifyUsbAudioPackage\.kt/);
    assert.match(plugin, /addPackage\(StreamifyUsbAudioPackage\(\)\)/);
    // A missing source must fail prebuild loudly, not ship a dead toggle.
    assert.match(plugin, /missing native source/);
  });

  await check('the plugin is registered in app.json', () => {
    const app = JSON.parse(read('app.json'));
    const plugins = app.expo.plugins || [];
    const registered = plugins.some((entry) =>
      Array.isArray(entry) ? entry[0] === './plugins/withUsbDac' : entry === './plugins/withUsbDac',
    );
    assert.ok(registered, 'withUsbDac not registered in app.json expo.plugins');
  });

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
