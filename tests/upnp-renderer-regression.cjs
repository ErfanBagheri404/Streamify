/* Run: node tests/upnp-renderer-regression.cjs
 *
 * Issue #41 — UPnP/DLNA renderer control.
 *
 * The pure wire-protocol half (SSDP reply parsing, device description,
 * DIDL-Lite metadata, SOAP envelopes) is runtime-tested here. SSDP discovery
 * itself needs multicast sockets, which RN has no stdlib for, so that half
 * lives in a native module and is out of scope for this suite.
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

const readRepoFile = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadModule(rel) {
  const js = ts.transpileModule(readRepoFile(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiled = path.join(os.tmpdir(), `${path.basename(rel)}.${process.pid}.cjs`);
  fs.writeFileSync(compiled, js);
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', js)(
    () => { throw new Error(`${rel} must have no imports`); },
    module,
    module.exports,
  );
  fs.unlinkSync(compiled);
  return module.exports;
}

const UP = loadModule('modules/upnpRenderer.ts');

const SSDP_REPLY = [
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age=1800',
  'LOCATION: http://192.168.1.50:8200/rootDesc.xml',
  'SERVER: Linux/3.0 UPnP/1.0 Sonos/63.0-88230',
  'ST: urn:schemas-upnp-org:service:AVTransport:1',
  'USN: uuid:RINCON_000E58D8403A01400::urn:schemas-upnp-org:service:AVTransport:1',
  '',
  '',
].join('\r\n');

const DEVICE_XML = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>Living Room</friendlyName>
    <manufacturer>Sonos, Inc.</manufacturer>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/MediaRenderer/AVTransport/Control</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <controlURL>/MediaRenderer/RenderingControl/Control</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;

const TRACK = {
  id: 't1',
  title: 'Song & <Title>',
  artist: 'A & B',
  album: 'Alb',
  url: 'http://192.168.1.10:49152/stream.mp3',
  duration: 235,
  mimeType: 'audio/mpeg',
  thumbnail: 'http://192.168.1.10:49152/cover.jpg',
};

async function main() {
  // ---- SSDP --------------------------------------------------------------

  await check('parseSsdpReply: reads LOCATION, USN and ST', () => {
    const reply = UP.parseSsdpReply(SSDP_REPLY);
    assert.equal(reply.location, 'http://192.168.1.50:8200/rootDesc.xml');
    assert.equal(reply.st, 'urn:schemas-upnp-org:service:AVTransport:1');
    assert.ok(reply.usn.startsWith('uuid:RINCON_'));
  });

  await check('parseSsdpReply: rejects a reply without LOCATION', () => {
    assert.equal(UP.parseSsdpReply('HTTP/1.1 200 OK\r\nST: x\r\n'), null);
    assert.equal(UP.parseSsdpReply(''), null);
  });

  await check('usnDevice: the device half of a USN', () => {
    assert.equal(
      UP.usnDevice('uuid:RINCON_000E58D8403A01400::urn:schemas-upnp-org:service:AVTransport:1'),
      'uuid:RINCON_000E58D8403A01400',
    );
    assert.equal(UP.usnDevice('uuid:abc'), 'uuid:abc');
  });

  // ---- device description ------------------------------------------------

  await check('parseDeviceDescription: friendlyName, manufacturer, services', () => {
    const d = UP.parseDeviceDescription(DEVICE_XML);
    assert.equal(d.name, 'Living Room');
    assert.equal(d.manufacturer, 'Sonos, Inc.');
    assert.equal(d.services.length, 2);
    assert.equal(d.services[0].serviceType, 'urn:schemas-upnp-org:service:AVTransport:1');
  });

  await check('absoluteControlUrl: root-relative and origin-relative', () => {
    const base = 'http://192.168.1.50:8200/rootDesc.xml';
    assert.equal(
      UP.absoluteControlUrl(base, '/MediaRenderer/AVTransport/Control'),
      'http://192.168.1.50:8200/MediaRenderer/AVTransport/Control',
    );
    assert.equal(
      UP.absoluteControlUrl(base, 'MediaRenderer/AVTransport/Control'),
      'http://192.168.1.50:8200/MediaRenderer/AVTransport/Control',
    );
    assert.equal(
      UP.absoluteControlUrl(base, 'http://other/x'),
      'http://other/x',
    );
  });

  await check('buildRenderer: resolves both control URLs', () => {
    const r = UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), DEVICE_XML);
    assert.equal(r.name, 'Living Room');
    assert.equal(r.controlUrl, 'http://192.168.1.50:8200/MediaRenderer/AVTransport/Control');
    assert.equal(
      r.renderingControlUrl,
      'http://192.168.1.50:8200/MediaRenderer/RenderingControl/Control',
    );
  });

  await check('buildRenderer: a device with no AVTransport is refused', () => {
    const noAv = DEVICE_XML.replace(
      /<service>[\s\S]*?AVTransport[\s\S]*?<\/service>/,
      '',
    );
    assert.equal(UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), noAv), null);
  });

  // ---- DIDL-Lite ---------------------------------------------------------

  await check('toDidlDuration: seconds -> H:MM:SS, 0 for live', () => {
    assert.equal(UP.toDidlDuration(235), '0:03:55');
    assert.equal(UP.toDidlDuration(3661), '1:01:01');
    assert.equal(UP.toDidlDuration(0), '0:00:00');
  });

  await check('buildDidl: metadata, duration, protocolInfo, artwork', () => {
    const didl = UP.buildDidl(TRACK);
    assert.match(didl, /<dc:title>Song &amp; &lt;Title&gt;<\/dc:title>/);
    assert.match(didl, /<upnp:artist>A &amp; B<\/upnp:artist>/);
    assert.match(didl, /duration="0:03:55"/);
    assert.match(didl, /protocolInfo="http-get:\*:audio\/mpeg:\*"/);
    assert.match(didl, /<upnp:albumArtURI>http:\/\/192\.168\.1\.10:49152\/cover\.jpg<\/upnp:albumArtURI>/);
    assert.match(didl, /<res[^>]*>http:\/\/192\.168\.1\.10:49152\/stream\.mp3<\/res>/);
  });

  await check('buildDidl: no albumArtURI when there is no artwork', () => {
    const didl = UP.buildDidl({ ...TRACK, thumbnail: undefined });
    assert.equal(didl.includes('albumArtURI'), false);
  });

  await check('buildDidlWithIndex: zero-padded queue position', () => {
    assert.match(UP.buildDidlWithIndex(TRACK, 0), /<item id="00001"/);
    assert.match(UP.buildDidlWithIndex(TRACK, 9), /<item id="00010"/);
  });

  // ---- SOAP --------------------------------------------------------------

  await check('buildSoapEnvelope: wraps the body in the SOAP envelope', () => {
    const env = UP.buildSoapEnvelope('Play', '<u:Play/>');
    assert.match(env, /<\?xml version="1\.0" encoding="utf-8"\?>/);
    assert.match(env, /<s:Envelope[^>]*>/);
    assert.match(env, /<s:Body><u:Play\/><\/s:Body><\/s:Envelope>/);
  });

  await check('soapActionHeader: the quoted URN the renderer matches on', () => {
    assert.equal(
      UP.soapActionHeader('SetAVTransportURI'),
      '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"',
    );
    assert.equal(
      UP.soapActionHeader('SetVolume'),
      '"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"',
    );
  });

  await check('SOAPACTION carries the device own service version', () => {
    // A renderer advertising AVTransport:2 matches the header against its own
    // service type; a hardcoded :1 is rejected even though the body is right.
    const r = UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), DEVICE_XML.replace(
      'urn:schemas-upnp-org:service:AVTransport:1',
      'urn:schemas-upnp-org:service:AVTransport:2',
    ));
    assert.equal(r.serviceType, 'urn:schemas-upnp-org:service:AVTransport:2');
    assert.equal(
      UP.soapActionHeader('Play', UP.serviceTypeFor(r, 'Play')),
      '"urn:schemas-upnp-org:service:AVTransport:2#Play"',
    );
    // No version known: keep the v1 default rather than emitting garbage.
    assert.equal(
      UP.soapActionHeader('Play'),
      '"urn:schemas-upnp-org:service:AVTransport:1#Play"',
    );
    assert.equal(
      UP.soapActionHeader('Play', ''),
      '"urn:schemas-upnp-org:service:AVTransport:1#Play"',
    );
  });

  await check('volume actions take RenderingControl own version, not AVTransport', () => {
    // The two families version independently; AVTransport:2 + RenderingControl:1
    // is a real configuration and must not become RenderingControl:2.
    const xml = DEVICE_XML.replace(
      'urn:schemas-upnp-org:service:AVTransport:1',
      'urn:schemas-upnp-org:service:AVTransport:2',
    );
    const r = UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), xml);
    assert.equal(r.renderingControlServiceType, 'urn:schemas-upnp-org:service:RenderingControl:1');
    assert.equal(
      UP.soapActionHeader('SetVolume', UP.serviceTypeFor(r, 'SetVolume')),
      '"urn:schemas-upnp-org:service:RenderingControl:1#SetVolume"',
    );
    assert.equal(
      UP.soapActionHeader('GetVolume', UP.serviceTypeFor(r, 'GetVolume')),
      '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"',
    );
  });

  await check('a renderer without RenderingControl still builds', () => {
    const avtOnly = DEVICE_XML.replace(
      /<service>[\s\S]*?<\/service>/gi,
      '<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>' +
        '<controlURL>/avt/control</controlURL></service>',
    );
    const r = UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), avtOnly);
    assert.equal(r.renderingControlUrl, '');
    assert.equal(r.renderingControlServiceType, '');
    // Transport actions still work with no rendering service.
    assert.equal(
      UP.soapActionHeader('Pause', UP.serviceTypeFor(r, 'Pause')),
      '"urn:schemas-upnp-org:service:AVTransport:1#Pause"',
    );
  });

  await check('controlUrlFor: volume goes to RenderingControl, transport to AVTransport', () => {
    const r = UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), DEVICE_XML);
    assert.equal(UP.controlUrlFor(r, 'SetVolume'), r.renderingControlUrl);
    assert.equal(UP.controlUrlFor(r, 'GetVolume'), r.renderingControlUrl);
    assert.equal(UP.controlUrlFor(r, 'Play'), r.controlUrl);
    assert.equal(UP.controlUrlFor(r, 'SetAVTransportURI'), r.controlUrl);
  });

  await check('setAvTransportUri: URI plus escaped DIDL metadata', () => {
    const { body } = UP.setAvTransportUri(TRACK, 0);
    assert.match(body, /<u:InstanceID>0<\/u:InstanceID>/);
    assert.match(body, /<u:CurrentURI>http:\/\/192\.168\.1\.10:49152\/stream\.mp3<\/u:CurrentURI>/);
    // DIDL is double-escaped inside the SOAP envelope: the renderer parses it
    // back, but a raw <DIDL-Lite would break the envelope itself.
    assert.match(body, /<u:CurrentURIMetaData>&lt;DIDL-Lite/);
    assert.match(body, /duration=&quot;0:03:55&quot;/);
  });

  await check('setNextAvTransportURI: queues without interrupting', () => {
    const { body } = UP.setNextAvTransportUri(TRACK, 1);
    assert.match(body, /<u:NextURI>/);
    assert.match(body, /<u:NextURIMetaData>/);
    assert.equal(body.includes('CurrentURI'), false);
  });

  await check('play: InstanceID and Speed only', () => {
    const { body } = UP.play(0);
    assert.match(body, /<u:InstanceID>0<\/u:InstanceID><u:Speed>1<\/u:Speed>/);
  });

  await check('stop: InstanceID only', () => {
    assert.match(UP.stop().body, /<u:Stop[^>]*><u:InstanceID>0<\/u:InstanceID><\/u:Stop>/);
  });

  await check('setVolume: 0-100 on the wire, truncated and clamped', () => {
    // The wire unit is the renderer's own 0-100 scale, so 0.5 rounds to a 1:
    // callers pass whole steps, and the guard below keeps strays in range.
    assert.match(UP.setVolume(0.5).body, /<u:DesiredVolume>1<\/u:DesiredVolume>/);
    assert.match(UP.setVolume(50).body, /<u:DesiredVolume>50<\/u:DesiredVolume>/);
    assert.match(UP.setVolume(140).body, /<u:DesiredVolume>100<\/u:DesiredVolume>/);
    assert.match(UP.setVolume(-1).body, /<u:DesiredVolume>0<\/u:DesiredVolume>/);
    assert.match(UP.setVolume(NaN).body, /<u:DesiredVolume>0<\/u:DesiredVolume>/);
  });

  await check('getVolume: Master channel', () => {
    assert.match(UP.getVolume().body, /<u:Channel>Master<\/u:Channel>/);
  });

  await check('getPositionInfo: InstanceID only', () => {
    assert.match(UP.getPositionInfo().body, /<u:GetPositionInfo[^>]*><u:InstanceID>0<\/u:InstanceID><\/u:GetPositionInfo>/);
  });

  await check('parsePositionInfo: RelTime is UPnP time, not DIDL', () => {
    const xml = '<s:Envelope><s:Body><u:GetPositionInfoResponse>' +
      '<RelTime>1:02:03</RelTime>' +
      '</u:GetPositionInfoResponse></s:Body></s:Envelope>';
    assert.deepEqual(UP.parsePositionInfo(xml), { trackSeconds: 3723 });
    assert.deepEqual(UP.parsePositionInfo('<x/>'), { trackSeconds: 0 });
  });

  await check('parseSoapFault: the renderer own reason', () => {
    const xml = '<s:Envelope><s:Body><s:Fault>' +
      '<faultcode>s:Client</faultcode>' +
      '<errorDescription>701 Transition not available</errorDescription>' +
      '</s:Fault></s:Body></s:Envelope>';
    assert.equal(UP.parseSoapFault(xml), '701 Transition not available');
    assert.equal(UP.parseSoapFault(''), '');
  });

  // ---- new: SSDP robustness ----------------------------------------------

  await check('parseSsdpReply: LF-only line endings and case-insensitive headers', () => {
    const reply = UP.parseSsdpReply(
      'HTTP/1.1 200 OK\n' +
      'location: http://192.168.1.51:8200/rootDesc.xml\n' +
      'usn: uuid:ABC::urn:schemas-upnp-org:service:AVTransport:1\n' +
      'st: urn:schemas-upnp-org:service:AVTransport:1',
    );
    assert.ok(reply, 'LF-only replies are real datagrams too');
    assert.equal(reply.location, 'http://192.168.1.51:8200/rootDesc.xml');
    assert.equal(reply.usn, 'uuid:ABC::urn:schemas-upnp-org:service:AVTransport:1');
  });

  await check('parseSsdpReply: a non-http LOCATION is not a fetchable device', () => {
    // A malformed or spoofed reply must not reach the description fetch.
    assert.equal(UP.parseSsdpReply(
      'HTTP/1.1 200 OK\r\nLOCATION: file:///etc/passwd\r\nUSN: uuid:x\r\nST: x',
    ), null);
    assert.equal(UP.parseSsdpReply(
      'HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.50/rootDesc.xml\r\nST: x',
    ), null, 'a missing USN cannot be deduped');
    assert.equal(UP.parseSsdpReply(
      'HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.50/rootDesc.xml\r\nUSN: uuid:x',
    ), null, 'a missing ST cannot be matched to a service');
  });

  await check('usnDevice: degenerate USNs', () => {
    assert.equal(UP.usnDevice(''), '');
    assert.equal(UP.usnDevice('uuid:only'), 'uuid:only', 'no :: means the whole string');
    assert.equal(UP.usnDevice('::urn:service'), '', 'empty device half');
  });

  // ---- new: description robustness ----------------------------------------

  await check('parseDeviceDescription: a nameless device still gets a label', () => {
    const d = UP.parseDeviceDescription('<root><device><deviceType>x</deviceType></device></root>');
    assert.equal(d.name, 'UPnP renderer', 'the picker needs something to show');
    assert.equal(d.manufacturer, '');
    assert.deepEqual(d.services, []);
  });

  await check('parseDeviceDescription: a service without controlURL is skipped', () => {
    const xml = '<root><device><serviceList>' +
      '<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType></service>' +
      '<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>' +
      '<controlURL>/rc/control</controlURL></service>' +
      '</serviceList></device></root>';
    const d = UP.parseDeviceDescription(xml);
    assert.equal(d.services.length, 1, 'the AVTransport entry has no controlURL');
    assert.equal(d.services[0].serviceType, 'urn:schemas-upnp-org:service:RenderingControl:1');
  });

  await check('parseDeviceDescription: every service of a multi-service device is kept', () => {
    const xml = '<root><device><serviceList>' +
      [1, 2, 3].map((n) =>
        `<service><serviceType>urn:schemas-upnp-org:service:S${n}:1</serviceType>` +
        `<controlURL>/s${n}</controlURL></service>`).join('') +
      '</serviceList></device></root>';
    assert.equal(UP.parseDeviceDescription(xml).services.length, 3);
  });

  await check('absoluteControlUrl: empty href and unresolvable base', () => {
    assert.equal(UP.absoluteControlUrl('http://h/rootDesc.xml', ''), '');
    assert.equal(UP.absoluteControlUrl('', '/avt'), '', 'no base means no URL');
    assert.equal(UP.absoluteControlUrl('not a url', '/avt'), '');
    // A description served from a deep path resolves relative to that path.
    assert.equal(
      UP.absoluteControlUrl('http://h:8200/a/b/rootDesc.xml', 'avt/control'),
      'http://h:8200/a/b/avt/control',
    );
  });

  await check('buildRenderer: a device with no services at all is refused', () => {
    assert.equal(UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), '<root><device/></root>'), null);
  });

  // ---- new: DIDL boundaries -----------------------------------------------

  await check('escapeXml: quotes, apostrophes and nullish values', () => {
    assert.equal(UP.escapeXml('a "b" \'c\''), 'a &quot;b&quot; &apos;c&apos;');
    assert.equal(UP.escapeXml(''), '');
    assert.equal(UP.escapeXml(undefined), '', 'a missing field must not render "undefined"');
    assert.equal(UP.escapeXml(null), '');
  });

  await check('toDidlDuration: negative, fractional and very long', () => {
    assert.equal(UP.toDidlDuration(-5), '0:00:00', 'a negative duration is a live stream');
    assert.equal(UP.toDidlDuration(59.9), '0:00:59', 'fractional seconds floor');
    assert.equal(UP.toDidlDuration(36000), '10:00:00', 'a 10-hour audiobook');
    assert.equal(UP.toDidlDuration(NaN), '0:00:00');
  });

  await check('buildDidl: missing artist, album, mime and url degrade gracefully', () => {
    const didl = UP.buildDidl({ id: 't', title: 'T', url: 'http://h/s.mp3' });
    assert.match(didl, /<dc:creator>Unknown Artist<\/dc:creator>/);
    assert.match(didl, /<upnp:album><\/upnp:album>/);
    assert.match(didl, /protocolInfo="http-get:\*:audio\/mpeg:\*"/, 'default mime is mp3');
    const noUrl = UP.buildDidl({ id: 't', title: 'T', url: '' });
    assert.match(noUrl, /<res duration="0:00:00"[^>]*><\/res>/, 'an empty res, not a broken one');
  });

  await check('buildDidlWithIndex: a queue past 99999 keeps its digits', () => {
    assert.match(UP.buildDidlWithIndex(TRACK, 99999), /<item id="100000"/);
    assert.match(UP.buildDidlWithIndex(TRACK, 0), /<item id="00001"/);
  });

  // ---- new: SOAP boundaries -----------------------------------------------

  await check('play: a non-integer instance id falls back to 0', () => {
    assert.match(UP.play(1.5).body, /<u:InstanceID>0<\/u:InstanceID>/);
    assert.match(UP.play(7).body, /<u:InstanceID>7<\/u:InstanceID>/);
  });

  await check('parsePositionInfo: a missing or malformed RelTime is zero', () => {
    assert.deepEqual(UP.parsePositionInfo('<x/>'), { trackSeconds: 0 });
    assert.deepEqual(UP.parsePositionInfo('<RelTime>n/a</RelTime>'), { trackSeconds: 0 });
    assert.deepEqual(UP.parsePositionInfo('<RelTime>1:02:03.5</RelTime>'), { trackSeconds: 3723 },
      'a fractional RelTime still parses the H:MM:SS prefix');
    assert.deepEqual(UP.parsePositionInfo('<RelTime>0:00:00</RelTime>'), { trackSeconds: 0 });
  });

  await check('parseSoapFault: a fault without a description is empty', () => {
    assert.equal(UP.parseSoapFault('<s:Fault><faultcode>s:Client</faultcode></s:Fault>'), '');
  });

  await check('actionUrn: a higher service version is honoured per family', () => {
    assert.equal(
      UP.actionUrn('Play', 'urn:schemas-upnp-org:service:AVTransport:3'),
      'urn:schemas-upnp-org:service:AVTransport:3#Play',
    );
    assert.equal(
      UP.actionUrn('SetVolume', 'urn:schemas-upnp-org:service:RenderingControl:2'),
      'urn:schemas-upnp-org:service:RenderingControl:2#SetVolume',
    );
    assert.equal(
      UP.actionUrn('Play', 'urn:schemas-upnp-org:service:AVTransport'),
      'urn:schemas-upnp-org:service:AVTransport:1#Play',
      'no version digit means the v1 default',
    );
  });

  await check('controlUrlFor: transport-info actions stay on AVTransport', () => {
    const r = UP.buildRenderer(UP.parseSsdpReply(SSDP_REPLY), DEVICE_XML);
    assert.equal(UP.controlUrlFor(r, 'GetTransportInfo'), r.controlUrl);
    assert.equal(UP.controlUrlFor(r, 'Pause'), r.controlUrl);
    assert.equal(UP.controlUrlFor(r, 'GetVolume'), r.renderingControlUrl);
  });

  // ---- scope guard -------------------------------------------------------

  await check('the module stays free of native imports', () => {
    const src = readRepoFile('modules/upnpRenderer.ts');
    for (const dep of ['react-native', 'react', 'expo', 'react-native-udp']) {
      const importRe = new RegExp(`^\s*(?:import|export)[^'"]*['"]${dep}`, 'm');
      assert.ok(!importRe.test(src), `upnpRenderer.ts imports ${dep}`);
    }
  });

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
