/**
 * App lock + private-playlist vault.
 *
 * The two halves are deliberately separated:
 *
 * - Pure functions in this file: PIN verification, failed-attempt lockout,
 *   and playlist filtering. Node-testable, no native surface.
 * - Native/persistence half in `appLock.ts`: SecureStore for the credential,
 *   expo-local-authentication for biometrics, AsyncStorage for the non-secret
 *   per-playlist lock flags.
 *
 * Why the credential never lives in AppSettings: the settings payload is read
 * into a single context that every screen can pull, and it round-trips through
 * AsyncStorage. A PIN hash has no business there.
 */

const MIN_PIN_LENGTH = 4;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_LOCKOUT_MS = 5 * 60 * 1000;

export const APP_LOCK_REASON = "streamify-app-lock";

/** FNV-1a, same shape as `podcastShowId`. Not cryptography: this is a
 *  local convenience lock, and a salted digest would be false comfort —
 *  AsyncStorage/SecureStore on a rooted device is already readable. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sanitizePin(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidPin(pin: string): boolean {
  return (
    pin.length >= MIN_PIN_LENGTH &&
    pin.length <= 12 &&
    /^\d+$/.test(pin)
  );
}

/** Store this, never the PIN itself. */
export function hashPin(pin: string): string {
  return `${fnv1a(pin)}-${pin.length}`;
}

export function verifyPinHash(pin: string, stored: string): boolean {
  return typeof stored === "string" && stored.length > 0 && hashPin(pin) === stored;
}

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: number;
}

/** Exponential backoff: 5s, 10s, 20s, 40s, capped at MAX_LOCKOUT_MS. */
export function nextLockout(
  state: LockoutState,
  now: number,
): LockoutState {
  const attempts = Math.max(0, state.failedAttempts) + 1;
  if (attempts < MAX_FAILED_ATTEMPTS) {
    return { failedAttempts: attempts, lockedUntil: 0 };
  }
  const over = attempts - MAX_FAILED_ATTEMPTS;
  const backoff = Math.min(MAX_LOCKOUT_MS, 5000 * 2 ** over);
  return { failedAttempts: attempts, lockedUntil: now + backoff };
}

export function remainingLockoutMs(
  state: LockoutState,
  now: number,
): number {
  return Math.max(0, state.lockedUntil - now);
}

export function isLockedOut(state: LockoutState, now: number): boolean {
  return remainingLockoutMs(state, now) > 0;
}

export function formatLockoutWait(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${seconds}s`;
}

export interface LockablePlaylist {
  id: string;
  /** Set by the vault toggle; not part of the playlist's own shape. */
  isPrivate?: boolean;
}

/** The single filter every playlist surface must use. */
export function filterPrivatePlaylists<T extends LockablePlaylist>(
  playlists: T[],
  isVaultUnlocked: boolean,
): T[] {
  if (isVaultUnlocked) {
    return playlists.slice();
  }
  return playlists.filter((playlist) => playlist.isPrivate !== true);
}

export function countPrivatePlaylists(
  playlists: LockablePlaylist[],
): number {
  return playlists.reduce(
    (total, playlist) => (playlist.isPrivate ? total + 1 : total),
    0,
  );
}
