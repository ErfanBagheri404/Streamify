import * as React from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PinPad } from "./PinPad";
import { useTheme } from "../hooks/useTheme";
import { useAppLanguage } from "../hooks/useAppLanguage";
import {
  authenticateWithBiometrics,
  canUseBiometrics,
  disableAppLock,
  loadLockoutState,
  markAppUnlockedViaBiometrics,
  registerAppLockPin,
  verifyAppLockPin,
} from "../modules/appLockStore";
import {
  formatLockoutWait,
  isLockedOut,
  remainingLockoutMs,
  sanitizePin,
  type LockoutState,
} from "../modules/appLock";

type Mode = "set" | "disable";

/**
 * PIN setup (set/change) and removal. Removal re-verifies the current PIN —
 * without that anyone holding the phone could switch the lock off.
 */
export function AppLockPinModal({
  visible,
  mode,
  onCancel,
  onDone,
}: {
  visible: boolean;
  mode: Mode;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useAppLanguage();
  const [pin, setPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lockout, setLockout] = React.useState<LockoutState>({
    failedAttempts: 0,
    lockedUntil: 0,
  });
  const [now, setNow] = React.useState(() => Date.now());
  const [biometricsAvailable, setBiometricsAvailable] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const promptedRef = React.useRef(false);

  const lockedOut = isLockedOut(lockout, now);
  const waitMs = remainingLockoutMs(lockout, now);

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    setPin("");
    setConfirmPin(null);
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
  }, [visible, mode]);

  React.useEffect(() => {
    if (!visible || mode !== "disable" || !biometricsAvailable) {
      return;
    }
    void (async () => {
      if (await authenticateWithBiometrics()) {
        await markAppUnlockedViaBiometrics();
        await disableAppLock();
        onDone();
      }
    })();
    // Biometrics is a shortcut on open only; not re-prompted per keystroke.
  }, [visible, mode, biometricsAvailable, onDone]);

  React.useEffect(() => {
    if (!visible || !lockedOut) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [visible, lockedOut]);

  const createPin = React.useCallback(async () => {
    if (isSubmitting) {
      return;
    }
    if (pin.length < 4) {
      setError("pinTooShort");
      return;
    }
    if (confirmPin === null) {
      setConfirmPin(pin);
      setPin("");
      setError(null);
      return;
    }
    if (pin !== confirmPin) {
      setConfirmPin(null);
      setPin("");
      setError("pinMismatch");
      return;
    }
    setIsSubmitting(true);
    const result = await registerAppLockPin(confirmPin);
    setIsSubmitting(false);
    if (result.ok !== true) {
      setError(result.reason === "invalid" ? "pinTooShort" : "saveFailed");
      setConfirmPin(null);
      setPin("");
      return;
    }
    onDone();
  }, [confirmPin, isSubmitting, onDone, pin]);

  const removePin = React.useCallback(async () => {
    if (lockedOut || isSubmitting) {
      return;
    }
    if (pin.length < 4) {
      setError("pinTooShort");
      return;
    }
    setIsSubmitting(true);
    const at = Date.now();
    const outcome = await verifyAppLockPin(pin, at);
    setIsSubmitting(false);
    setPin("");
    if (outcome.unlocked === true) {
      await disableAppLock();
      onDone();
      return;
    }
    setNow(at);
    if (outcome.reason === "locked-out") {
      setLockout(outcome.state);
      setError("pinTooManyAttempts");
      return;
    }
    setError("pinWrong");
  }, [isSubmitting, lockedOut, onDone, pin]);

  const message = (() => {
    if (lockedOut) {
      return t("appLock.waitSeconds", {
        seconds: Math.ceil(waitMs / 1000),
        wait: formatLockoutWait(waitMs),
      });
    }
    if (error === "pinTooManyAttempts") return t("appLock.tooManyAttempts");
    if (error === "pinTooShort") return t("appLock.pinTooShort");
    if (error === "pinMismatch") return t("appLock.pinMismatch");
    if (error === "pinWrong") return t("appLock.pinWrong");
    if (error === "saveFailed") return t("appLock.saveFailed");
    if (mode === "disable") return t("appLock.disableHint");
    if (confirmPin !== null) return t("appLock.confirmPin");
    return t("appLock.createPinHint");
  })();

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={[styles.backdrop, { backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.close}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={26} color={colors.muted} />
        </TouchableOpacity>
        <View style={styles.pad}>
          <PinPad
            title={
              mode === "disable"
                ? t("appLock.removeTitle")
                : t("appLock.setPin")
            }
            message={message}
            isError={Boolean(error) || lockedOut}
            value={pin}
            onChange={(next) => {
              setError(null);
              setPin(sanitizePin(next).slice(0, 6));
            }}
            onSubmit={() => {
              if (mode === "disable") {
                void removePin();
                return;
              }
              void createPin();
            }}
            disabled={lockedOut || isSubmitting}
            biometricAvailable={mode === "disable" && biometricsAvailable}
            onUseBiometrics={() => {
              void (async () => {
                if (await authenticateWithBiometrics()) {
                  await markAppUnlockedViaBiometrics();
                  await disableAppLock();
                  onDone();
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
  close: {
    position: "absolute",
    top: 46,
    right: 24,
    padding: 8,
    zIndex: 2,
  },
  pad: {
    paddingHorizontal: 8,
  },
});
