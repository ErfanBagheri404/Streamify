/**
 * Network-aware audio quality + data-saver policy (issue #35).
 *
 * JioSaavn and Innertube both expose several bitrates per track, so the cap is
 * enforced at stream-URL selection time (the two `pick highest` sites) rather
 * than by re-encoding. Connectivity comes from `expo-network`; the policy
 * itself is pure so it is testable without a device.
 */

export type NetworkKind = "wifi" | "cellular" | "other" | "unknown";

/** Cap in kbps. `null` = no cap (stream the highest the source offers). */
export type QualityCap = 96 | 128 | 160 | 320;

export type QualityMode = "alwaysBest" | "networkAware" | "alwaysLow";

export type NetworkQualityPolicy = {
  mode: QualityMode;
  /** Cap applied on Wi-Fi. null = highest available. */
  wifiCapKbps: QualityCap | null;
  /** Cap applied on cellular. null = highest available. */
  cellularCapKbps: QualityCap | null;
  /** Cap applied on other transports (ethernet, VPN, unknown). */
  otherCapKbps: QualityCap | null;
};

export const DEFAULT_QUALITY_POLICY: NetworkQualityPolicy = {
  // Highest quality everywhere — the pre-#35 behavior, so existing users see
  // no change until they opt in.
  mode: "alwaysBest",
  wifiCapKbps: null,
  cellularCapKbps: 128,
  otherCapKbps: 320,
};

export const QUALITY_CAP_OPTIONS: QualityCap[] = [96, 128, 160, 320];
export const QUALITY_MODE_OPTIONS: QualityMode[] = [
  "alwaysBest",
  "networkAware",
  "alwaysLow",
];

/** A candidate stream at a known bitrate, in kbps. */
export type QualityCandidate = { bitrateKbps: number };

function isQualityCap(value: unknown): value is QualityCap {
  return (
    value === 96 || value === 128 || value === 160 || value === 320 || value === null
  );
}

function isQualityMode(value: unknown): value is QualityMode {
  return (
    value === "alwaysBest" || value === "networkAware" || value === "alwaysLow"
  );
}

export function sanitizeQualityPolicy(
  value: unknown,
): NetworkQualityPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_QUALITY_POLICY;
  }

  const record = value as Partial<NetworkQualityPolicy>;

  return {
    mode: isQualityMode(record.mode) ? record.mode : DEFAULT_QUALITY_POLICY.mode,
    wifiCapKbps: isQualityCap(record.wifiCapKbps)
      ? record.wifiCapKbps
      : DEFAULT_QUALITY_POLICY.wifiCapKbps,
    cellularCapKbps: isQualityCap(record.cellularCapKbps)
      ? record.cellularCapKbps
      : DEFAULT_QUALITY_POLICY.cellularCapKbps,
    otherCapKbps: isQualityCap(record.otherCapKbps)
      ? record.otherCapKbps
      : DEFAULT_QUALITY_POLICY.otherCapKbps,
  };
}

/** The cap in force right now, given the live network and the policy. */
export function effectiveCapKbps(
  policy: NetworkQualityPolicy,
  network: NetworkKind,
): QualityCap | null {
  if (policy.mode === "alwaysBest") {
    return null;
  }
  if (policy.mode === "alwaysLow") {
    return policy.cellularCapKbps;
  }
  if (network === "wifi") {
    return policy.wifiCapKbps;
  }
  if (network === "cellular") {
    return policy.cellularCapKbps;
  }
  return policy.otherCapKbps;
}

/**
 * Pick the best candidate at or under the cap. When nothing fits under the
 * cap, take the LOWEST available rather than the highest: a cap the source
 * cannot honor must still save data, and falling back to the most expensive
 * stream would spend the most on the most constrained connection. A cap never
 * produces silence — only a downgrade.
 */
export function pickCandidateByCap<T extends QualityCandidate>(
  candidates: T[],
  capKbps: QualityCap | null,
): T | null {
  if (!candidates.length) {
    return null;
  }
  const highest = (a: T, b: T) =>
    b.bitrateKbps > a.bitrateKbps ? b : a;
  const lowest = (a: T, b: T) =>
    b.bitrateKbps < a.bitrateKbps ? b : a;

  if (capKbps === null) {
    return candidates.reduce(highest);
  }

  const withinCap = candidates.filter((c) => c.bitrateKbps <= capKbps);
  return withinCap.length ? withinCap.reduce(highest) : candidates.reduce(lowest);
}

/**
 * JioSaavn labels bitrates as "320kbps"/"160kbps"/"96kbps"; Innertube reports a
 * raw bps figure. Normalize both to kbps for the shared picker.
 */
export function parseJioSaavnQualityKbps(quality: unknown): number {
  if (typeof quality !== "string") {
    return 0;
  }
  const match = quality.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export function bpsToKbps(bps: number | undefined | null): number {
  if (typeof bps !== "number" || !Number.isFinite(bps) || bps <= 0) {
    return 0;
  }
  return Math.round(bps / 1000);
}

// --- live network -----------------------------------------------------------

/**
 * Last known connection kind. expo-network is async-only, and the per-track
 * URL picker must be synchronous, so this is the value it reads.
 */
let cachedNetwork: NetworkKind = "unknown";

/**
 * Current connection kind. Async — expo-network has no sync snapshot — so the
 * hot path (per-track URL selection) reads the cached value via
 * `getCachedNetwork`, refreshed here and by the app shell on foreground.
 */
export async function refreshNetworkKind(): Promise<NetworkKind> {
  try {
    const Network = await import("expo-network");
    const state = await Network.getNetworkStateAsync();
    const type = state.type;

    if (type === Network.NetworkStateType.WIFI) {
      cachedNetwork = "wifi";
    } else if (type === Network.NetworkStateType.CELLULAR) {
      cachedNetwork = "cellular";
    } else if (
      type === Network.NetworkStateType.NONE ||
      type === Network.NetworkStateType.UNKNOWN
    ) {
      // No connection, or undetermined — do NOT guess "cellular" and throttle
      // (or bill against) a link we cannot see.
      cachedNetwork = "unknown";
    } else {
      // Ethernet, VPN, etc.
      cachedNetwork = "other";
    }
    return cachedNetwork;
  } catch {
    return cachedNetwork;
  }
}

/** Last known connection kind, used by the per-track picker without awaiting. */
export function getCachedNetwork(): NetworkKind {
  return cachedNetwork;
}

// --- live policy ------------------------------------------------------------

/**
 * The policy in force. The settings screen pushes it here whenever the user
 * changes the mode or a cap, so the per-track selection path (which must stay
 * synchronous) never has to read AsyncStorage. Until the first push it stays
 * at the default, i.e. highest bitrate everywhere — the pre-#35 behavior.
 */
let activePolicy: NetworkQualityPolicy = DEFAULT_QUALITY_POLICY;

export function setActiveQualityPolicy(policy: NetworkQualityPolicy): void {
  activePolicy = sanitizeQualityPolicy(policy);
}

export function getActiveQualityPolicy(): NetworkQualityPolicy {
  return activePolicy;
}

/** The cap the current settings + network actually enforce right now. */
export function currentCapKbps(): QualityCap | null {
  return effectiveCapKbps(activePolicy, cachedNetwork);
}

// --- byte accounting --------------------------------------------------------

/**
 * The bitrate actually chosen for a track id, written by the two resolvers
 * that pick a stream (they are the only places that know the real number).
 * Keyed by id so a later local/file track — which consumes no data — can never
 * inherit the previous stream's bitrate and be counted against it.
 */
const pickedBitrateById = new Map<string, number>();

export function notePickedBitrate(trackId: string, kbps: number): void {
  if (!trackId || !Number.isFinite(kbps) || kbps <= 0) {
    return;
  }
  pickedBitrateById.set(trackId, Math.round(kbps));
}

/** 0 when this track never resolved to a network stream (local, uncached). */
export function pickedBitrateFor(trackId: string): number {
  if (!trackId) return 0;
  return pickedBitrateById.get(trackId) ?? 0;
}
