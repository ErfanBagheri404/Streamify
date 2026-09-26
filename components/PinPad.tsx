import * as React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getAppFontFamily } from "../utils/fonts";

const PIN_LENGTH = 6;
const MIN_SUBMIT_LENGTH = 4;

export interface PinPadColors {
  foreground: string;
  muted: string;
  accent: string;
  accentContrast: string;
  surface2: string;
  borderSubtle: string;
}

/**
 * Shared numeric keypad. Used by the app-lock gate and the vault unlock
 * prompt, so the two cannot drift in look or in which keys accept input.
 */
export function PinPad({
  title,
  message,
  isError = false,
  value,
  onChange,
  onSubmit,
  disabled = false,
  biometricAvailable = false,
  onUseBiometrics,
  colors,
}: {
  title: string;
  message?: string;
  isError?: boolean;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  biometricAvailable?: boolean;
  onUseBiometrics?: () => void;
  colors: PinPadColors;
}) {
  const canSubmit = !disabled && value.length >= MIN_SUBMIT_LENGTH;

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) {
      return;
    }
    onChange(value + digit);
  };

  const backspace = () => {
    if (!disabled) {
      onChange(value.slice(0, -1));
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Text
        style={[
          styles.message,
          { color: isError ? colors.accent : colors.muted },
        ]}
      >
        {message ?? ""}
      </Text>

      <View
        style={styles.dotsRow}
        accessibilityLabel={`${value.length} of ${PIN_LENGTH} digits entered`}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, index) => {
          const filled = index < value.length;
          return (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor: filled ? colors.accent : "transparent",
                  borderColor: filled ? colors.accent : colors.borderSubtle,
                },
              ]}
            />
          );
        })}
      </View>

      <View style={styles.pad}>
        {keys.map((digit) => (
          <PadKey
            key={digit}
            label={digit}
            onPress={() => press(digit)}
            disabled={disabled}
            colors={colors}
          />
        ))}
        <View style={styles.keySlot}>
          {biometricAvailable && onUseBiometrics ? (
            <TouchableOpacity
              onPress={onUseBiometrics}
              disabled={disabled}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Use biometrics"
              style={[styles.key, { backgroundColor: "transparent" }]}
            >
              <Ionicons name="finger-print" size={26} color={colors.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <PadKey
          label="0"
          onPress={() => press("0")}
          disabled={disabled}
          colors={colors}
        />
        <PadKey
          label="backspace"
          onPress={backspace}
          disabled={disabled}
          colors={colors}
          icon
        />
      </View>

      <TouchableOpacity
        onPress={() => {
          if (canSubmit) {
            onSubmit();
          }
        }}
        disabled={!canSubmit}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Unlock"
        style={[
          styles.submit,
          { backgroundColor: canSubmit ? colors.accent : colors.surface2 },
        ]}
      >
        <Text
          style={[
            styles.submitText,
            { color: canSubmit ? colors.accentContrast : colors.muted },
          ]}
        >
          Unlock
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function PadKey({
  label,
  onPress,
  disabled,
  colors,
  icon = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  colors: PinPadColors;
  icon?: boolean;
}) {
  return (
    <View style={styles.keySlot}>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={icon ? "Delete" : label}
        style={[styles.key, { backgroundColor: colors.surface2 }]}
      >
        {icon ? (
          <Ionicons name="backspace-outline" size={24} color={colors.muted} />
        ) : (
          <Text
            style={[
              styles.keyText,
              { color: colors.foreground, opacity: disabled ? 0.5 : 1 },
            ]}
          >
            {label}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  title: {
    fontSize: 22,
    textAlign: "center",
    fontFamily: getAppFontFamily(false, "medium"),
  },
  message: {
    marginTop: 10,
    fontSize: 14,
    textAlign: "center",
    minHeight: 20,
    fontFamily: getAppFontFamily(false, "regular"),
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 22,
  },
  dot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
    marginHorizontal: 7,
  },
  pad: {
    marginTop: 24,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  keySlot: {
    width: "33.333%",
    aspectRatio: 1.35,
    padding: 6,
  },
  key: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  keyText: {
    fontSize: 22,
    fontFamily: getAppFontFamily(false, "medium"),
  },
  submit: {
    marginTop: 22,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontSize: 16,
    fontFamily: getAppFontFamily(false, "medium"),
  },
});
