import React, { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "../ui/Screen";
import { BodyText, MutedText, TitleText } from "../ui/Text";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { useAuth } from "../../hooks/useAuth";
import { getAppFontFamily, getTextDirectionStyle } from "../../utils/fonts";
import { getSupabaseClient } from "../../lib/supabase/client";
import {
  checkAccountStatus,
  type AccountStatusResponse,
} from "../../lib/auth-account-status";

const ABSOLUTE_FILL = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

type AuthMode = "signin" | "signup";

interface AuthScreenProps {
  navigation: any;
  mode: AuthMode;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function getExistingAccountMessage(
  status: AccountStatusResponse,
  intent: "signup" | "password" | "google",
  t: (key: string) => string,
) {
  if (status.duplicate) {
    return t("auth.multipleAccountsDetected");
  }

  const hasEmailProvider = status.providers.includes("email");
  const hasGoogleProvider = status.providers.includes("google");

  if (intent === "google") {
    if (hasEmailProvider && !hasGoogleProvider) {
      return t("auth.usePasswordInsteadOfGoogle");
    }

    return null;
  }

  if (intent === "password" && hasGoogleProvider && !hasEmailProvider) {
    return t("auth.useGoogleInsteadOfPassword");
  }

  if (intent === "signup" && hasGoogleProvider && !hasEmailProvider) {
    return t("auth.accountAlreadyExistsWithGoogle");
  }

  if (intent === "signup" && status.exists) {
    return t("auth.accountAlreadyExistsSignIn");
  }

  return null;
}

export default function AuthScreen({ navigation, mode }: AuthScreenProps) {
  const { colors, isLight } = useTheme();
  const { t, isRtl } = useAppLanguage();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isSignUp = mode === "signup";
  const supabase = useMemo(() => getSupabaseClient(), []);
  const redirectTo = useMemo(() => "streamify://auth/callback", []);
  const authUnavailableMessage = t("home.authDisabledBody");

  useEffect(() => {
    if (user) {
      navigation.goBack();
    }
  }, [navigation, user]);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setMessage(null);

    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password.trim()) {
      setErrorMessage(t("auth.fillAllFields"));
      return;
    }

    if (isSignUp && password.trim() !== confirmPassword.trim()) {
      setErrorMessage(t("auth.passwordsDoNotMatch"));
      return;
    }

    if (!supabase) {
      setErrorMessage(authUnavailableMessage);
      return;
    }

    setIsSubmitting(true);

    try {
      const accountStatus = await checkAccountStatus(normalizedEmail);
      const existingAccountMessage = accountStatus
        ? getExistingAccountMessage(
            accountStatus,
            isSignUp ? "signup" : "password",
            t,
          )
        : null;

      if (isSignUp && accountStatus && !accountStatus.available) {
        setErrorMessage(
          accountStatus.error || t("auth.accountCheckUnavailable"),
        );
        return;
      }

      if (existingAccountMessage) {
        setErrorMessage(existingAccountMessage);
        return;
      }

      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          setMessage(t("auth.accountReady"));
          navigation.goBack();
          return;
        }

        setMessage(t("auth.signUpCheckInbox"));
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        throw error;
      }

      setMessage(t("auth.signedIn"));
      navigation.goBack();
    } catch (error) {
      if (
        error instanceof Error &&
        /email not confirmed/i.test(error.message)
      ) {
        setErrorMessage(t("auth.emailNotConfirmed"));
        return;
      }

      setErrorMessage(
        error instanceof Error ? error.message : t("auth.genericError"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    setErrorMessage(null);
    setMessage(null);

    const normalizedEmail = normalizeEmail(email);

    if (!supabase) {
      setErrorMessage(authUnavailableMessage);
      return;
    }

    setIsGoogleSubmitting(true);

    try {
      const accountStatus = normalizedEmail
        ? await checkAccountStatus(normalizedEmail)
        : null;
      const existingAccountMessage = accountStatus
        ? getExistingAccountMessage(accountStatus, "google", t)
        : null;

      if (existingAccountMessage) {
        setErrorMessage(existingAccountMessage);
        return;
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.url) {
        throw new Error(t("auth.googleUnavailable"));
      }

      await Linking.openURL(data.url);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("auth.googleUnavailable"),
      );
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <Screen padded={false} safeEdges={["left", "right"]}>
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {/* Drag handle */}
        <View style={styles.dragHandleRow}>
          <View
            style={[
              styles.dragHandle,
              { backgroundColor: withOpacity(colors.foreground, 0.2) },
            ]}
          />
        </View>

        {/* Close button */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[
            styles.closeButton,
            {
              backgroundColor: withOpacity(colors.surface1, 0.92),
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Ionicons name="close" size={20} color={colors.foreground} />
        </TouchableOpacity>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <TitleText
              style={[
                styles.title,
                {
                  fontFamily: getAppFontFamily(isRtl, "bold"),
                  ...getTextDirectionStyle(isRtl, "center"),
                },
              ]}
            >
              {isSignUp ? t("auth.signUpTitle") : t("auth.signInTitle")}
            </TitleText>
            <MutedText
              style={[
                styles.description,
                {
                  ...getTextDirectionStyle(isRtl, "center"),
                },
              ]}
            >
              {isSignUp
                ? t("auth.signUpDescription")
                : t("auth.signInDescription")}
            </MutedText>

            <View style={styles.form}>
              <View
                style={[
                  styles.inputShell,
                  {
                    backgroundColor: withOpacity(
                      colors.surface2,
                      isLight ? 0.55 : 0.7,
                    ),
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t("auth.email")}
                  placeholderTextColor={withOpacity(colors.muted, 0.92)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      fontFamily: getAppFontFamily(isRtl, "regular"),
                      ...getTextDirectionStyle(isRtl),
                    },
                  ]}
                />
              </View>

              <View
                style={[
                  styles.inputShell,
                  styles.passwordShell,
                  {
                    backgroundColor: withOpacity(
                      colors.surface2,
                      isLight ? 0.55 : 0.7,
                    ),
                    borderColor: colors.borderSubtle,
                    flexDirection: "row",
                  },
                ]}
              >
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t("auth.password")}
                  placeholderTextColor={withOpacity(colors.muted, 0.92)}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  style={[
                    styles.input,
                    styles.passwordInput,
                    {
                      color: colors.foreground,
                      fontFamily: getAppFontFamily(isRtl, "regular"),
                      ...getTextDirectionStyle(isRtl),
                    },
                  ]}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((current) => !current)}
                  style={styles.eyeButton}
                >
                  <Ionicons
                    name={showPassword ? "eye-outline" : "eye-off-outline"}
                    size={20}
                    color={colors.muted}
                  />
                </TouchableOpacity>
              </View>

              {isSignUp ? (
                <View
                  style={[
                    styles.inputShell,
                    styles.passwordShell,
                    {
                      backgroundColor: withOpacity(
                        colors.surface2,
                        isLight ? 0.55 : 0.7,
                      ),
                      borderColor: colors.borderSubtle,
                      flexDirection: "row",
                    },
                  ]}
                >
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder={t("auth.confirmPassword")}
                    placeholderTextColor={withOpacity(colors.muted, 0.92)}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    style={[
                      styles.input,
                      styles.passwordInput,
                      {
                        color: colors.foreground,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      },
                    ]}
                  />
                  <TouchableOpacity
                    onPress={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                    style={styles.eyeButton}
                  >
                    <Ionicons
                      name={
                        showConfirmPassword ? "eye-outline" : "eye-off-outline"
                      }
                      size={20}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                </View>
              ) : null}

              <TouchableOpacity
                disabled={isSubmitting || isGoogleSubmitting}
                onPress={() => {
                  void handleSubmit();
                }}
                activeOpacity={0.92}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: colors.foreground,
                    opacity: isSubmitting || isGoogleSubmitting ? 0.72 : 1,
                  },
                ]}
              >
                <BodyText
                  style={[
                    styles.primaryButtonText,
                    {
                      color: colors.background,
                      fontFamily: getAppFontFamily(isRtl, "bold"),
                    },
                  ]}
                >
                  {isSubmitting
                    ? t("common.loading")
                    : isSignUp
                      ? t("auth.createAccount")
                      : t("auth.signInAction")}
                </BodyText>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={isSubmitting || isGoogleSubmitting}
                onPress={() => {
                  void handleGoogleAuth();
                }}
                activeOpacity={0.9}
                style={[
                  styles.secondaryButton,
                  {
                    backgroundColor: withOpacity(
                      colors.surface2,
                      isLight ? 0.58 : 0.8,
                    ),
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <Ionicons
                  name="logo-google"
                  size={18}
                  color={colors.foreground}
                  style={{
                    marginRight: 10,
                    marginLeft: 10,
                  }}
                />
                <BodyText
                  style={[
                    styles.secondaryButtonText,
                    {
                      color: colors.foreground,
                      fontFamily: getAppFontFamily(isRtl, "semibold"),
                    },
                  ]}
                >
                  {isGoogleSubmitting
                    ? t("common.loading")
                    : isSignUp
                      ? t("auth.googleSignUp")
                      : t("auth.googleSignIn")}
                </BodyText>
              </TouchableOpacity>
            </View>

            {errorMessage ? (
              <View
                style={[
                  styles.feedbackBox,
                  {
                    backgroundColor: "rgba(220, 38, 38, 0.12)",
                    borderColor: "rgba(248, 113, 113, 0.22)",
                  },
                ]}
              >
                <BodyText
                  style={[
                    styles.feedbackText,
                    {
                      color: isLight ? "#991b1b" : "#fecaca",
                      ...getTextDirectionStyle(isRtl, "center"),
                    },
                  ]}
                >
                  {errorMessage}
                </BodyText>
              </View>
            ) : null}

            {message ? (
              <View
                style={[
                  styles.feedbackBox,
                  {
                    backgroundColor: withOpacity(colors.foreground, 0.05),
                    borderColor: withOpacity(colors.foreground, 0.08),
                  },
                ]}
              >
                <BodyText
                  style={[
                    styles.feedbackText,
                    {
                      color: colors.foreground,
                      ...getTextDirectionStyle(isRtl, "center"),
                    },
                  ]}
                >
                  {message}
                </BodyText>
              </View>
            ) : null}

            <View
              style={[
                styles.switchRow,
                {
                  flexDirection: "row",
                },
              ]}
            >
              <BodyText
                style={[
                  styles.switchPrompt,
                  {
                    color: colors.muted,
                    ...getTextDirectionStyle(isRtl),
                  },
                ]}
              >
                {isSignUp ? t("auth.alreadyHaveAccount") : t("auth.noAccount")}
              </BodyText>
              <TouchableOpacity
                onPress={() =>
                  navigation.replace(isSignUp ? "SignIn" : "SignUp")
                }
                style={styles.switchLinkButton}
              >
                <BodyText
                  style={[
                    styles.switchLink,
                    {
                      color: colors.foreground,
                      fontFamily: getAppFontFamily(isRtl, "semibold"),
                    },
                  ]}
                >
                  {isSignUp ? t("auth.signInAction") : t("auth.signUpAction")}
                </BodyText>
              </TouchableOpacity>
            </View>

            <MutedText
              style={[
                styles.terms,
                {
                  ...getTextDirectionStyle(isRtl, "center"),
                },
              ]}
            >
              {t("auth.termsNote")}
            </MutedText>
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  aura: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 56,
  },
  dragHandleRow: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 8,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  closeButton: {
    position: "absolute",
    top: 12,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 56,
  },
  title: {
    marginTop: 8,
    fontSize: 28,
    lineHeight: 34,
    textAlign: "center",
  },
  description: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  form: {
    marginTop: 24,
    gap: 12,
  },
  inputShell: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
  },
  passwordShell: {
    alignItems: "center",
  },
  passwordInput: {
    flex: 1,
  },
  eyeButton: {
    padding: 6,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 2,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 14,
    lineHeight: 18,
  },
  feedbackBox: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 18,
  },
  switchPrompt: {
    fontSize: 14,
    lineHeight: 18,
  },
  switchRow: {
    marginTop: 18,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  switchLinkButton: {
    alignSelf: "center",
  },
  switchLink: {
    fontSize: 15,
    lineHeight: 20,
    textDecorationLine: "underline",
  },
  terms: {
    marginTop: 18,
    fontSize: 12,
    lineHeight: 17,
  },
});
