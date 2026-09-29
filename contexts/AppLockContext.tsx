import * as React from "react";
import { AppState, View, StyleSheet } from "react-native";
import { useTheme } from "../hooks/useTheme";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { PinPad } from "../components/PinPad";
import {
  authenticateWithBiometrics,
  canUseBiometrics,
  isAppUnlockedThisLaunch,
  loadLockoutState,
  markAppUnlockedViaBiometrics,
  subscribeToAppLock,
  verifyAppLockPin,
  type UnlockOutcome,
} from "../modules/appLockStore";
import {
  formatLockoutWait,
  isLockedOut,
  remainingLockoutMs,
  sanitizePin,
  type LockoutState,
} from "../modules/appLock";

/** Must match the PIN_LENGTH the pad renders. */
const PIN_MAX_LENGTH = 6;

interface AppLockContextValue {
  /** True once the gate has decided this launch may proceed. */
  isUnlocked: boolean;
  /** Null until the first storage read settles, so the gate can show a
   * spinner instead of flashing the app for one frame. */
  isChecking: boolean;
}

const AppLockContext = React.createContext<AppLockContextValue>({
  isUnlocked: true,
  isChecking: false,
});

export const useAppLock = () => React.useContext(AppLockContext);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [isUnlocked, setIsUnlocked] = React.useState(false);
  const [isChecking, setIsChecking] = React.useState(true);
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [lockout, setLockout] = React.useState<LockoutState>({
    failedAttempts: 0,
    lockedUntil: 0,
  });
  const [now, setNow] = React.useState(() => Date.now());
  const [biometricsAvailable, setBiometricsAvailable] = React.useState(false);
  const biometricsPromptedRef = React.useRef(false);
  const previousAppStateRef = React.useRef("active");
  /** True only when a PIN exists — without this the gate would pop up on every
   * return to foreground for users who never enabled a lock. */
  const lockArmedRef = React.useRef(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const lockedOut = isLockedOut(lockout, now);
  const waitMs = remainingLockoutMs(lockout, now);

  const refresh = React.useCallback(async () => {
    const [unlocked, hasBiometrics] = await Promise.all([
      isAppUnlockedThisLaunch(),
      canUseBiometrics(),
    ]);
    setBiometricsAvailable(hasBiometrics);
    lockArmedRef.current = !unlocked;
    setIsUnlocked(unlocked);
    setIsChecking(false);
    if (unlocked) {
      return;
    }
    const state = await loadLockoutState();
    setLockout(state);
    setNow(Date.now());
  }, []);

  React.useEffect(() => {
    void refresh();
    let disposed = false;
    const sub = subscribeToAppLock(() => {
      void refresh();
    });
    return () => {
      disposed = true;
      sub.remove();
    };
  }, [refresh]);

  // Re-engage the gate the moment the app leaves the foreground, so a phone
  // handed over mid-session is locked again. `previous` is tracked separately
  // from `active` because iOS fires `inactive` on control centre, lock and
  // notification shade — dropping to background first means a short glance at
  // the notification shade does not throw the gate in front of playback.
  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        previousAppStateRef.current = "background";
        if (lockArmedRef.current) {
          setIsUnlocked(false);
        }
        setError(null);
        setPin("");
        biometricsPromptedRef.current = false;
        return;
      }
      if (nextState === "active" && previousAppStateRef.current === "background") {
        previousAppStateRef.current = "active";
        void loadLockoutState().then((state) => {
          setLockout(state);
          setNow(Date.now());
        });
      }
    });
    return () => subscription.remove();
  }, []);

  // One automatic biometric prompt per launch, and only when there is no
  // active backoff — otherwise a wrong PIN could be followed by a prompt
  // that always succeeds, which would defeat the lockout entirely.
  React.useEffect(() => {
    if (
      isChecking ||
      isUnlocked ||
      lockedOut ||
      !biometricsAvailable ||
      biometricsPromptedRef.current
    ) {
      return;
    }
    biometricsPromptedRef.current = true;
    void (async () => {
      const ok = await authenticateWithBiometrics();
      if (ok) {
        await markAppUnlockedViaBiometrics();
        setIsUnlocked(true);
      }
    })();
  }, [
    isChecking,
    isUnlocked,
    lockedOut,
    biometricsAvailable,
  ]);

  // Countdown tick only while a lockout is running.
  React.useEffect(() => {
    if (!lockedOut) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [lockedOut]);

  const submit = React.useCallback(
    async (candidate?: string) => {
      if (lockedOut || isSubmitting) {
        return;
      }
      const value = candidate ?? pin;
      if (value.length < 4) {
        setError("pinTooShort");
        return;
      }
      setIsSubmitting(true);
      const at = Date.now();
      const outcome: UnlockOutcome = await verifyAppLockPin(value, at);
      setIsSubmitting(false);
      if (outcome.unlocked === true) {
        setError(null);
        setPin("");
        setIsUnlocked(true);
        return;
      }
      setPin("");
      setNow(at);
      if (outcome.reason === "locked-out") {
        setLockout(outcome.state);
        setError("pinTooManyAttempts");
        return;
      }
      setError("pinWrong");
    },
    [isSubmitting, lockedOut, pin],
  );

  const retryBiometrics = React.useCallback(async () => {
    setError(null);
    const ok = await authenticateWithBiometrics();
    if (ok) {
      await markAppUnlockedViaBiometrics();
      setIsUnlocked(true);
    }
  }, []);

  const value = React.useMemo<AppLockContextValue>(
    () => ({ isUnlocked: isChecking ? false : isUnlocked, isChecking }),
    [isChecking, isUnlocked],
  );

  // The gate is an OVERLAY, never a replacement. Unmounting the subtree would
  // tear down PlayerProvider and stop playback the moment the app is
  // backgrounded — the lock must hide the UI, not the audio.
  const showGate = !isChecking && !isUnlocked;

  return (
    <AppLockContext.Provider value={value}>
      {children}
      {showGate ? (
        <View style={styles.overlay}>
          <AppLockGate
            pin={pin}
            onPinInput={(next) => {
              setError(null);
              setPin(next);
            }}
            error={error}
            lockedOut={lockedOut}
            waitMs={waitMs}
            biometricsAvailable={biometricsAvailable}
            isSubmitting={isSubmitting}
            onSubmit={submit}
            onRetryBiometrics={retryBiometrics}
          />
        </View>
      ) : null}
    </AppLockContext.Provider>
  );
}

function AppLockGate({
  pin,
  onPinInput,
  error,
  lockedOut,
  waitMs,
  biometricsAvailable,
  isSubmitting,
  onSubmit,
  onRetryBiometrics,
}: {
  pin: string;
  onPinInput: (next: string) => void;
  error: string | null;
  lockedOut: boolean;
  waitMs: number;
  biometricsAvailable: boolean;
  isSubmitting: boolean;
  onSubmit: (candidate?: string) => void | Promise<void>;
  onRetryBiometrics: () => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useAppLanguage();

  const message = (() => {
    if (lockedOut) {
      return t("appLock.waitSeconds", {
        seconds: Math.ceil(waitMs / 1000),
        wait: formatLockoutWait(waitMs),
      });
    }
    if (error === "pinTooManyAttempts") {
      return t("appLock.tooManyAttempts");
    }
    if (error === "pinTooShort") {
      return t("appLock.pinTooShort");
    }
    if (error === "pinWrong") {
      return t("appLock.pinWrong");
    }
    return t("appLock.subtitle");
  })();

  return (
    <View
      style={[
        styles.gate,
        { backgroundColor: colors.background },
      ]}
    >
      <PinPad
        title={t("appLock.title")}
        message={message}
        isError={Boolean(error) || lockedOut}
        value={pin}
        onChange={(next) => {
          onPinInput(sanitizePin(next).slice(0, PIN_MAX_LENGTH));
        }}
        onSubmit={() => {
          void onSubmit();
        }}
        disabled={lockedOut || isSubmitting}
        biometricAvailable={biometricsAvailable}
        onUseBiometrics={() => {
          void onRetryBiometrics();
        }}
        colors={colors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The RN stub in this repo has no StyleSheet.absoluteFill, so the overlay
  // position is spelled out.
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  gate: {
    flex: 1,
    justifyContent: "center",
  },
});
