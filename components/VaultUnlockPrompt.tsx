import * as React from "react";
import { Modal, StyleSheet, View } from "react-native";
import { PinPad } from "./PinPad";
import { useTheme } from "../hooks/useTheme";
import { useAppLanguage } from "../hooks/useAppLanguage";
import {
  authenticateWithBiometrics,
  canUseBiometrics,
  loadLockoutState,
  markAppUnlockedViaBiometrics,
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

/**
 * Second gate in front of private playlists. It re-verifies the same
 * credential the app lock uses rather than storing a second secret — one
 * secret, two gates — so there is no second PIN for an attacker to guess and
 * nothing else to remember.
 */
export function VaultUnlockPrompt({
  visible,
  onDismiss,
  onSuccess,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useAppLanguage();
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [lockout, setLockout] = React.useState<LockoutState>({
    failedAttempts: 0,
    lockedUntil: 0,
  });
  const [now, setNow] = React.useState(() => Date.now());
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = React.useState(false);
  const promptedRef = React.useRef(false);

  const lockedOut = isLockedOut(lockout, now);
  const waitMs = remainingLockoutMs(lockout, now);

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    setPin("");
    setError(null);
    promptedRef.current = false;
    void (async () => {
      const [state, canBio] = await Promise.all([
        loadLockoutState(),
        canUseBiometrics(),
      ]);
      setLockout(state);
      setNow(Date.now());
      setBiometricsAvailable(canBio);
    })();
  }, [visible]);

  React.useEffect(() => {
    if (
      !visible ||
      lockedOut ||
      !biometricsAvailable ||
      promptedRef.current
    ) {
      return;
    }
    promptedRef.current = true;
    void (async () => {
      if (await authenticateWithBiometrics()) {
        await markAppUnlockedViaBiometrics();
        onSuccess();
      }
    })();
  }, [visible, lockedOut, biometricsAvailable, onSuccess]);

  React.useEffect(() => {
    if (!visible || !lockedOut) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [visible, lockedOut]);

  const submit = React.useCallback(async () => {
    if (lockedOut || isSubmitting) {
      return;
    }
    if (pin.length < 4) {
      setError("pinTooShort");
      return;
    }
    setIsSubmitting(true);
    const at = Date.now();
    const outcome: UnlockOutcome = await verifyAppLockPin(pin, at);
    setIsSubmitting(false);
    if (outcome.unlocked === true) {
      setError(null);
      setPin("");
      onSuccess();
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
  }, [isSubmitting, lockedOut, onSuccess, pin]);

  const message = lockedOut
    ? t("appLock.waitSeconds", {
        seconds: Math.ceil(waitMs / 1000),
        wait: formatLockoutWait(waitMs),
      })
    : error === "pinTooManyAttempts"
      ? t("appLock.tooManyAttempts")
      : error === "pinTooShort"
        ? t("appLock.pinTooShort")
        : error === "pinWrong"
          ? t("appLock.pinWrong")
          : t("appLock.subtitle");

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.background }]}>
        <View style={styles.pad}>
          <PinPad
            title={t("appLock.vaultTitle")}
            message={message}
            isError={Boolean(error) || lockedOut}
            value={pin}
            onChange={(next) => {
              setError(null);
              setPin(sanitizePin(next).slice(0, 6));
            }}
            onSubmit={() => {
              void submit();
            }}
            disabled={lockedOut || isSubmitting}
            biometricAvailable={biometricsAvailable}
            onUseBiometrics={() => {
              void (async () => {
                if (await authenticateWithBiometrics()) {
                  await markAppUnlockedViaBiometrics();
                  onSuccess();
                }
              })();
            }}
            colors={colors}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
  },
  pad: {
    paddingHorizontal: 8,
  },
});
