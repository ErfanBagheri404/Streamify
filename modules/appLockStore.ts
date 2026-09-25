import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { DeviceEventEmitter } from "react-native";
import {
  APP_LOCK_REASON,
  nextLockout as computeNextLockout,
  hashPin,
  isValidPin,
  remainingLockoutMs as computeRemainingMs,
  sanitizePin,
  type LockoutState,
} from "./appLock";

const APP_LOCK_PIN_KEY = "streamify:app-lock:pin";
const APP_LOCK_ENABLED_KEY = "@streamify:app-lock:enabled";
const APP_LOCK_FAILED_ATTEMPTS_KEY = "@streamify:app-lock:failed-attempts";
const APP_LOCK_UNTIL_KEY = "@streamify:app-lock:locked-until";
const APP_LOCK_UNLOCKED_KEY = "@streamify:app-lock:unlocked-this-launch";
const PRIVATE_PLAYLISTS_KEY = "@streamify:private-playlists";
const VAULT_UNLOCKED_KEY = "@streamify:vault:unlocked-this-launch";

export const APP_LOCK_EVENT = "streamify-app-lock-changed";
export const VAULT_EVENT = "streamify-vault-changed";

async function setLaunchFlag(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, "1");
  } catch {
    // A stuck flag is a nuisance, not a crash.
  }
}

/** Persisted from a single register/enable/disable call so every reader sees
 * the same value — no in-memory shadow that can go stale. */
export async function isAppLockEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(APP_LOCK_ENABLED_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}

export async function hasAppLockPin(): Promise<boolean> {
  try {
    const stored = await SecureStore.getItemAsync(APP_LOCK_PIN_KEY);
    return typeof stored === "string" && stored.length > 0;
  } catch {
    return false;
  }
}

/** First-run convenience: if the user never set a lock, there is nothing to
 * gate on, so the app opens normally. */
export async function isAppUnlockedThisLaunch(): Promise<boolean> {
  const [enabled, hasPin, unlocked] = await Promise.all([
    isAppLockEnabled(),
    hasAppLockPin(),
    AsyncStorage.getItem(APP_LOCK_UNLOCKED_KEY).catch(() => null),
  ]);
  if (!enabled || !hasPin) {
    return true;
  }
  return unlocked === "1";
}

export async function registerAppLockPin(
  rawPin: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "unavailable" }> {
  const pin = sanitizePin(rawPin);
  if (!isValidPin(pin)) {
    return { ok: false, reason: "invalid" };
  }
  try {
    await SecureStore.setItemAsync(APP_LOCK_PIN_KEY, hashPin(pin));
    await AsyncStorage.setItem(APP_LOCK_ENABLED_KEY, "1");
    await AsyncStorage.multiRemove([
      APP_LOCK_FAILED_ATTEMPTS_KEY,
      APP_LOCK_UNTIL_KEY,
    ]).catch(() => undefined);
    DeviceEventEmitter.emit(APP_LOCK_EVENT);
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function disableAppLock(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(APP_LOCK_PIN_KEY).catch(() => undefined),
      AsyncStorage.multiRemove([
        APP_LOCK_ENABLED_KEY,
        APP_LOCK_FAILED_ATTEMPTS_KEY,
        APP_LOCK_UNTIL_KEY,
        APP_LOCK_UNLOCKED_KEY,
      ]),
    ]);
  } finally {
    DeviceEventEmitter.emit(APP_LOCK_EVENT);
  }
}

export async function loadLockoutState(): Promise<LockoutState> {
  try {
    const [attemptsRaw, untilRaw] = await AsyncStorage.multiGet([
      APP_LOCK_FAILED_ATTEMPTS_KEY,
      APP_LOCK_UNTIL_KEY,
    ]);
    const failedAttempts = Number(attemptsRaw?.[1] ?? 0);
    const lockedUntil = Number(untilRaw?.[1] ?? 0);
    return {
      failedAttempts: Number.isFinite(failedAttempts)
        ? Math.max(0, Math.floor(failedAttempts))
        : 0,
      lockedUntil: Number.isFinite(lockedUntil)
        ? Math.max(0, Math.floor(lockedUntil))
        : 0,
    };
  } catch {
    return { failedAttempts: 0, lockedUntil: 0 };
  }
}

async function saveLockoutState(state: LockoutState): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [APP_LOCK_FAILED_ATTEMPTS_KEY, String(state.failedAttempts)],
      [APP_LOCK_UNTIL_KEY, String(state.lockedUntil)],
    ]);
  } catch {
    // Backoff degrades to memory-only when storage fails.
  }
}

export async function recordFailedAppLockAttempt(now = Date.now()): Promise<LockoutState> {
  const next = computeNextLockout(await loadLockoutState(), now);
  await saveLockoutState(next);
  return next;
}

export async function clearAppLockAttempts(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      APP_LOCK_FAILED_ATTEMPTS_KEY,
      APP_LOCK_UNTIL_KEY,
    ]);
  } catch {
    // Fresh state is the default anyway.
  }
}

/** Biometrics is a convenience shortcut, never the only key: a correct PIN
 * always works, and on devices without an enrolled biometric the prompt is
 * skipped silently. */
export async function canUseBiometrics(): Promise<boolean> {
  try {
    const [compatible, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return compatible && enrolled;
  } catch {
    return false;
  }
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  try {
    if (!(await canUseBiometrics())) {
      return false;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Streamify",
      cancelLabel: "Use PIN",
      disableDeviceFallback: true,
    });
    return result.success === true;
  } catch {
    return false;
  }
}

export type UnlockOutcome =
  | { unlocked: true; via: "pin" | "biometrics" }
  | { unlocked: false; reason: "wrong-pin" | "locked-out"; state: LockoutState };

export async function verifyAppLockPin(
  rawPin: string,
  now = Date.now(),
): Promise<UnlockOutcome> {
  const state = await loadLockoutState();
  if (computeRemainingMs(state, now) > 0) {
    return { unlocked: false, reason: "locked-out", state };
  }
  const pin = sanitizePin(rawPin);
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(APP_LOCK_PIN_KEY);
  } catch {
    stored = null;
  }
  if (!stored || hashPin(pin) !== stored) {
    const next = await recordFailedAppLockAttempt(now);
    return {
      unlocked: false,
      reason: computeRemainingMs(next, now) > 0 ? "locked-out" : "wrong-pin",
      state: next,
    };
  }
  await clearAppLockAttempts();
  await setLaunchFlag(APP_LOCK_UNLOCKED_KEY);
  DeviceEventEmitter.emit(APP_LOCK_EVENT);
  return { unlocked: true, via: "pin" };
}

export async function markAppUnlockedViaBiometrics(): Promise<void> {
  await setLaunchFlag(APP_LOCK_UNLOCKED_KEY);
  DeviceEventEmitter.emit(APP_LOCK_EVENT);
}

export function subscribeToAppLock(listener: () => void): { remove: () => void } {
  const subscription = DeviceEventEmitter.addListener(APP_LOCK_EVENT, listener);
  // DeviceEventEmitter.addListener is typed as returning void in this repo's
  // RN surface, so the emitter is dropped through a ref we can remove.
  return {
    remove: () => {
      (subscription as unknown as { remove?: () => void } | undefined)?.remove?.();
    },
  };
}

// ── private-playlist vault ─────────────────────────────────────────────

export async function loadPrivatePlaylistIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PRIVATE_PLAYLISTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export async function setPlaylistPrivate(
  playlistId: string,
  isPrivate: boolean,
): Promise<void> {
  const ids = await loadPrivatePlaylistIds();
  const next = isPrivate
    ? Array.from(new Set([...ids, playlistId]))
    : ids.filter((id) => id !== playlistId);
  try {
    await AsyncStorage.setItem(PRIVATE_PLAYLISTS_KEY, JSON.stringify(next));
  } catch {
    // The in-memory read path degrades; the next refresh re-reads storage.
  }
  DeviceEventEmitter.emit(VAULT_EVENT);
}

export async function isVaultUnlockedThisLaunch(): Promise<boolean> {
  const [enabled, hasPin, unlocked] = await Promise.all([
    isAppLockEnabled(),
    hasAppLockPin(),
    AsyncStorage.getItem(VAULT_UNLOCKED_KEY).catch(() => null),
  ]);
  if (!enabled || !hasPin) {
    return true;
  }
  return unlocked === "1";
}

export async function unlockVaultForLaunch(): Promise<void> {
  await setLaunchFlag(VAULT_UNLOCKED_KEY);
  DeviceEventEmitter.emit(VAULT_EVENT);
}

export function subscribeToVault(listener: () => void): { remove: () => void } {
  const subscription = DeviceEventEmitter.addListener(VAULT_EVENT, listener);
  return {
    remove: () => {
      (subscription as unknown as { remove?: () => void } | undefined)?.remove?.();
    },
  };
}

export { APP_LOCK_REASON };
