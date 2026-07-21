import React, { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
        <LinearGradient
          colors={[
            withOpacity(colors.heroStart, isLight ? 0.18 : 0.12),
            withOpacity(colors.heroMid, isLight ? 0.24 : 0.18),
            withOpacity(colors.heroEnd, isLight ? 0.14 : 0.12),
            withOpacity(colors.background, 1),
          ]}
          start={{ x: 0.04, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={ABSOLUTE_FILL}
        />

        <View
          pointerEvents="none"
          style={[
            styles.aura,
            {
              backgroundColor: withOpacity(colors.accent, isLight ? 0.14 : 0.1),
              top: insets.top + 42,
              [isRtl ? "right" : "left"]: -46,
            },
          ]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[
            withOpacity(colors.heroMid, 0),
            withOpacity(colors.heroMid, isLight ? 0.16 : 0.11),
            withOpacity(colors.heroEnd, 0),
          ]}
          style={[
            styles.ribbon,
            {
              top: insets.top + 136,
              [isRtl ? "left" : "right"]: -86,
              transform: [{ rotate: isRtl ? "-22deg" : "22deg" }],
            },
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <View
          pointerEvents="none"
          style={[
            styles.aura,
            styles.auraLarge,
            {
              backgroundColor: withOpacity(
                colors.heroStart,
                isLight ? 0.14 : 0.11,
              ),
              bottom: 104,
              [isRtl ? "left" : "right"]: -84,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.softHalo,
            {
              backgroundColor: withOpacity(
                colors.foreground,
                isLight ? 0.04 : 0.03,
              ),
              top: insets.top + 210,
              alignSelf: "center",
            },
          ]}
        />

        <View
          style={[
            styles.header,
            {
              flexDirection: "row",
              paddingTop: insets.top + 18,
            },
          ]}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[
              styles.backButton,
              {
                backgroundColor: withOpacity(colors.surface1, 0.92),
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 104 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.card,
              {
                backgroundColor: withOpacity(
                  colors.surface1,
                  isLight ? 0.92 : 0.88,
                ),
                borderColor: colors.borderSubtle,
                shadowColor: colors.foreground,
              },
            ]}
          >
            <View
              style={[
                styles.badge,
                {
                  alignSelf: isRtl ? "flex-end" : "flex-start",
                  backgroundColor: withOpacity(colors.foreground, 0.05),
                  borderColor: withOpacity(colors.foreground, 0.08),
                },
              ]}
            >
              <MutedText style={styles.badgeText}>
                {t("auth.brandBadge")}
              </MutedText>
            </View>

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
                    flexDirection: isRtl ? "row-reverse" : "row",
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
                      flexDirection: isRtl ? "row-reverse" : "row",
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
                    marginRight: isRtl ? 0 : 10,
                    marginLeft: isRtl ? 10 : 0,
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
                  flexDirection: isRtl ? "row-reverse" : "row",
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
          </View>
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
  auraLarge: {
    width: 260,
    height: 220,
  },
  ribbon: {
    position: "absolute",
    width: 240,
    height: 150,
    borderRadius: 44,
  },
  softHalo: {
    position: "absolute",
    width: 280,
    height: 180,
    borderRadius: 999,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerSpacer: {
    width: 42,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingBottom: 56,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.16,
    shadowRadius: 34,
    elevation: 8,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 18,
    fontSize: 32,
    lineHeight: 38,
  },
  description: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  form: {
    marginTop: 22,
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
