/**
 * UPnP/DLNA renderer control — pure half for issue #41.
 *
 * The discovery half needs SSDP multicast sockets, which React Native has no
 * stdlib support for, so that lives in a native module (issue #41 scope).
 * Everything here is the wire protocol the renderers actually speak and is
 * pure, so it is testable without a radio:
 *
 *   - SSDP response  -> device description (name, control URL, service type)
 *   - DIDL-Lite queue -> the track list the renderer will play
 *   - SOAP envelopes  -> SetAVTransportURI / Play / Stop / GetVolume
 *
 * SCOPE NOTE (honest, and the same one the issue carries): a renderer can
 * only stream a URL it can reach. googlevideo URLs are signed and expire, and
 * a phone on a cellular hotspot is not LAN-reachable at all, so the queue
 * handed to a renderer can only contain tracks whose URL is already
 * phone-reachable — Subsonic/Navidrome, local files served over the LAN, and
 * direct http(s) sources. Tracks that need stream resolution on the phone are
 * skipped rather than sent as URLs that will 403 on the device.
 */

/** One renderer, as learned from its SSDP reply + device description. */
export interface UpnpRenderer {
  /** Unique Location header URL from the SSDP reply. */
  location: string;
  /** Friendly name from the device description. */
  name: string;
  manufacturer: string;
  /** Absolute AVTransport control URL. */
  controlUrl: string;
  /** Absolute RenderingControl control URL. */
  renderingControlUrl: string;
  /** UPnP service type, e.g. urn:schemas-upnp-org:service:AVTransport:1. */
  serviceType: string;
}

export interface UpnpTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  /** Absolute, renderer-reachable URL. See the scope note above. */
  url: string;
  /** Seconds. 0 for a live stream. */
  duration: number;
  mimeType?: string;
  thumbnail?: string;
}

// ---- SSDP ----------------------------------------------------------------

export interface SsdpReply {
  location: string;
  /** USN, stable per-device+service; used to dedupe multi-service replies. */
  usn: string;
  st: string;
}

/**
 * Parse an SSDP M-SEARCH reply. A renderer answers one datagram per service
 * (AVTransport, RenderingControl, ...), so the caller sees several replies for
 * the same device and must merge them by USN's device portion.
 */
export function parseSsdpReply(raw: string): SsdpReply | null {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toUpperCase()] = line.slice(idx + 1).trim();
  }
  const location = headers.LOCATION;
  const usn = headers.USN;
  if (!location || !usn || !headers.ST) return null;
  if (!/^https?:\/\//i.test(location)) return null;
  return { location, usn, st: headers.ST };
}

/**
 * The device half of a USN: `uuid:xyz::urn:...` -> `uuid:xyz`. Every service
 * of one device shares this prefix, which is how replies get merged.
 */
export function usnDevice(usn: string): string {
  return (usn || "").split("::")[0] || "";
}

/**
 * Read a device description XML. This is a tolerant tag read, not a parser:
 * device descriptions are shallow (friendlyName, service/controlURL) and a
 * full XML dependency would be dead weight for six fields.
 */
export function parseDeviceDescription(xml: string): {
  name: string;
  manufacturer: string;
  services: { serviceType: string; controlUrl: string }[];
} {
  const text = xml || "";
  const tag = (source: string, name: string): string => {
    const m = source.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
    return m ? m[1].trim() : "";
  };
  const services: { serviceType: string; controlUrl: string }[] = [];
  const serviceBlock = text.match(
    /<service>[\s\S]*?<\/service>/gi,
  );
  if (serviceBlock) {
    for (const block of serviceBlock) {
      const serviceType = tag(block, "serviceType");
      const control = tag(block, "controlURL");
      if (serviceType && control) {
        services.push({ serviceType, controlUrl: control });
      }
    }
  }
  return {
    name: tag(text, "friendlyName") || "UPnP renderer",
    manufacturer: tag(text, "manufacturer") || "",
    services,
  };
}

/** Resolve a possibly-relative controlURL against the description Location. */
export function absoluteControlUrl(base: string, href: string): string {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  const m = (base || "").match(/^(https?:\/\/[^/]+)(\/[^?#]*)?/i);
  if (!m) return "";
  const origin = m[1];
  if (href.startsWith("/")) return `${origin}${href}`;
  const dir = (m[2] || "/").replace(/[^/]*$/, "");
  return `${origin}${dir}${href}`;
}

/**
 * Turn one renderer from an SSDP reply + its device description. Returns null
 * when the device exposes no AVTransport service, which means it cannot play
 * a queue and should never appear in the picker.
 */
export function buildRenderer(
  reply: SsdpReply,
  descriptionXml: string,
): UpnpRenderer | null {
  const parsed = parseDeviceDescription(descriptionXml);
  const avTransport = parsed.services.find((s) =>
    s.serviceType.includes(":AVTransport:"),
  );
  if (!avTransport) return null;
  const renderingControl = parsed.services.find((s) =>
    s.serviceType.includes(":RenderingControl:"),
  );
  return {
    location: reply.location,
    name: parsed.name,
    manufacturer: parsed.manufacturer,
    controlUrl: absoluteControlUrl(reply.location, avTransport.controlUrl),
    renderingControlUrl: renderingControl
      ? absoluteControlUrl(reply.location, renderingControl.controlUrl)
      : "",
    serviceType: avTransport.serviceType,
  };
}

// ---- DIDL-Lite ------------------------------------------------------------

/** XML-escape. Track titles carry &, <, > and quotes constantly. */
export function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Seconds -> DIDL duration, `H:MM:SS`. 0 means an unbounded live stream. */
export function toDidlDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total === 0) return "0:00:00";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Zero-padded so the renderer sorts the queue the way we listed it. */
function trackNumberLabel(index: number): string {
  return String(index + 1).padStart(5, "0");
}

/**
 * Build the DIDL-Lite metadata document for a track. A renderer takes exactly
 * one track this way; the queue is walked one SetAVTransportURI per track.
 */
export function buildDidl(track: UpnpTrack): string {
  const mime = track.mimeType || "audio/mpeg";
  return (
    `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ` +
    `xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/" ` +
    `xmlns:sec="http://www.sec.co.kr/">` +
    `<item id="0" parentID="-1" restricted="1">` +
    `<dc:title>${escapeXml(track.title)}</dc:title>` +
    `<upnp:class object.item.audioItem.musicTrack</upnp:class>` +
    `<dc:creator>${escapeXml(track.artist || "Unknown Artist")}</dc:creator>` +
    `<upnp:artist>${escapeXml(track.artist || "Unknown Artist")}</upnp:artist>` +
    `<upnp:album>${escapeXml(track.album || "")}</upnp:album>` +
    `<res duration="${toDidlDuration(track.duration)}" protocolInfo="http-get:*:${escapeXml(mime)}:*">` +
    `${escapeXml(track.url)}</res>` +
    (track.thumbnail
      ? `<upnp:albumArtURI>${escapeXml(track.thumbnail)}</upnp:albumArtURI>`
      : "") +
    `</item></DIDL-Lite>`
  );
}

/** DIDL with a zero-padded queue index, which some renderers sort by. */
export function buildDidlWithIndex(track: UpnpTrack, index: number): string {
  return buildDidl(track).replace(
    '<item id="0"',
    `<item id="${trackNumberLabel(index)}"`,
  );
}

// ---- SOAP -----------------------------------------------------------------

export type SoapAction =
  | "SetAVTransportURI"
  | "SetNextAVTransportURI"
  | "Play"
  | "Pause"
  | "Stop"
  | "GetTransportInfo"
  | "GetPositionInfo"
  | "SetVolume"
  | "GetVolume";

const ACTION_URN: Record<SoapAction, string> = {
  SetAVTransportURI: "urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI",
  SetNextAVTransportURI:
    "urn:schemas-upnp-org:service:AVTransport:1#SetNextAVTransportURI",
  Play: "urn:schemas-upnp-org:service:AVTransport:1#Play",
  Pause: "urn:schemas-upnp-org:service:AVTransport:1#Pause",
  Stop: "urn:schemas-upnp-org:service:AVTransport:1#Stop",
  GetTransportInfo: "urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo",
  GetPositionInfo: "urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo",
  SetVolume: "urn:schemas-upnp-org:service:RenderingControl:1#SetVolume",
  GetVolume: "urn:schemas-upnp-org:service:RenderingControl:1#GetVolume",
};

/** Actions that live on RenderingControl rather than AVTransport. */
const RENDERING_ACTIONS: SoapAction[] = ["SetVolume", "GetVolume"];

export function controlUrlFor(
  renderer: UpnpRenderer,
  action: SoapAction,
): string {
  return RENDERING_ACTIONS.includes(action)
    ? renderer.renderingControlUrl
    : renderer.controlUrl;
}

/** Build a SOAP request envelope. Body is the raw inner XML. */
export function buildSoapEnvelope(action: SoapAction, body: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body>${body}</s:Body></s:Envelope>`
  );
}

export function soapActionHeader(action: SoapAction): string {
  return `"${ACTION_URN[action]}"`;
}

/** SetAVTransportURI: point the renderer at a track. */
export function setAvTransportUri(
  track: UpnpTrack,
  index: number,
): { body: string } {
  return {
    body:
      `<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">` +
      `<u:InstanceID>0</u:InstanceID>` +
      `<u:CurrentURI>${escapeXml(track.url)}</u:CurrentURI>` +
      `<u:CurrentURIMetaData>${escapeXml(buildDidlWithIndex(track, index))}</u:CurrentURIMetaData>` +
      `</u:SetAVTransportURI>`,
  };
}

/** SetNextAVTransportURI: queue the next track without interrupting. */
export function setNextAvTransportUri(
  track: UpnpTrack,
  index: number,
): { body: string } {
  return {
    body:
      `<u:SetNextAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">` +
      `<u:InstanceID>0</u:InstanceID>` +
      `<u:NextURI>${escapeXml(track.url)}</u:NextURI>` +
      `<u:NextURIMetaData>${escapeXml(buildDidlWithIndex(track, index))}</u:NextURIMetaData>` +
      `</u:SetNextAVTransportURI>`,
  };
}

/** Play. Plain UPnP carries no start offset in Play — gapless renderers step from the URI; the handler re-issues Play per track when the renderer has no Next support. */
export function play(instanceId = 0): { body: string } {
  const instance = Number.isInteger(instanceId) ? instanceId : 0;
  return {
    body:
      `<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">` +
      `<u:InstanceID>${instance}</u:InstanceID><u:Speed>1</u:Speed></u:Play>`,
  };
}

export function stop(): { body: string } {
  return {
    body:
      `<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">` +
      `<u:InstanceID>0</u:InstanceID></u:Stop>`,
  };
}

/** Volume is 0-100 on the wire, not 0-1. */
export function setVolume(level: number): { body: string } {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
  return {
    body:
      `<u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">` +
      `<u:InstanceID>0</u:InstanceID>` +
      `<u:Channel>Master</u:Channel>` +
      `<u:DesiredVolume>${clamped}</u:DesiredVolume>` +
      `</u:SetVolume>`,
  };
}

export function getVolume(): { body: string } {
  return {
    body:
      `<u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">` +
      `<u:InstanceID>0</u:InstanceID>` +
      `<u:Channel>Master</u:Channel></u:GetVolume>`,
  };
}

export function getPositionInfo(): { body: string } {
  return {
    body:
      `<u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">` +
      `<u:InstanceID>0</u:InstanceID></u:GetPositionInfo>`,
  };
}

/** Parse GetPositionInfo's RelTime, which is UPnP time (H+:MM:SS), not DIDL. */
export function parsePositionInfo(xml: string): { trackSeconds: number } {
  const m = (xml || "").match(
    /<(?:\w+:)?RelTime>([\s\S]*?)<\/(?:\w+:)?RelTime>/i,
  );
  if (!m) return { trackSeconds: 0 };
  const hms = m[1].trim().match(/^(\d+):(\d{2}):(\d{2})/);
  if (!hms) return { trackSeconds: 0 };
  return {
    trackSeconds: Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]),
  };
}

/** Parse a SOAP fault so the caller can show the renderer's own reason. */
export function parseSoapFault(xml: string): string {
  const m = (xml || "").match(
    /<(?:\w+:)?errorDescription>([\s\S]*?)<\/(?:\w+:)?errorDescription>/i,
  );
  return m ? m[1].trim() : "";
}
