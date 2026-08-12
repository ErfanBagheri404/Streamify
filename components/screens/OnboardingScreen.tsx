import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "../ui/Screen";
import { BodyText, MutedText, TitleText } from "../ui/Text";
import { BottomSheetModal } from "../ui/BottomSheetModal";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../../utils/fonts";
import { getSupabaseClient } from "../../lib/supabase/client";
import { useAuth } from "../../hooks/useAuth";
import { markOnboardingCompleted } from "../../utils/storage";
import * as Linking from "expo-linking";
import {
  checkAccountStatus,
  type AccountStatusResponse,
} from "../../lib/auth-account-status";

const globeImage = require("../../assets/Globe.png");

type AuthMode = "signin" | "signup";

interface OnboardingScreenProps {
  navigation: any;
  route?: { params?: { openAuth?: AuthMode } };
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

export default function OnboardingScreen({ navigation, route }: OnboardingScreenProps) {
  const { colors, isLight } = useTheme();
  const { t, isRtl } = useAppLanguage();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const progressAnim = useState(new Animated.Value(1 / 3))[0];
  const authCompletedRef = useRef(false);
  const modalWasOpenRef = useRef(false);
  const [authMode, setAuthMode] = useState<AuthMode>(
    route?.params?.openAuth || "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = getSupabaseClient();
  const redirectTo = "streamify://auth/callback";
  const authUnavailableMessage = t("home.authDisabledBody");
  const isSignUp = authMode === "signup";

  const animateProgress = (to: number) => {
    Animated.timing(progressAnim, {
      toValue: to,
      duration: 1000,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      useNativeDriver: false,
    }).start();
  };

  // Auto-open sheet when navigated with openAuth param
  React.useEffect(() => {
    if (route?.params?.openAuth) {
      setAuthMode(route.params.openAuth);
      setShowAuthModal(true);
      animateProgress(2 / 3);
    }
  }, [route?.params?.openAuth]);

  // Reset progress when sheet closes without auth completion
  React.useEffect(() => {
    if (showAuthModal) {
      authCompletedRef.current = false;
      modalWasOpenRef.current = true;
    } else if (modalWasOpenRef.current && !authCompletedRef.current) {
      animateProgress(1 / 3);
      modalWasOpenRef.current = false;
    }
  }, [showAuthModal]);

  React.useEffect(() => {
    if (user) {
      navigation.replace("Home");
    }
  }, [user]);

  if (user) {
    return null;
  }

  const openAuth = async (mode: AuthMode) => {
    setAuthMode(mode);
    setErrorMessage(null);
    setMessage(null);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    await markOnboardingCompleted();
    animateProgress(2 / 3);
    setShowAuthModal(true);
  };

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
        if (error) throw error;
        if (data.session) {
          authCompletedRef.current = true;
          animateProgress(1);
          setShowAuthModal(false);
          return;
        }
        setMessage(t("auth.signUpCheckInbox"));
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;
      setMessage(t("auth.signedIn"));
      authCompletedRef.current = true;
      animateProgress(1);
      setShowAuthModal(false);
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
      if (error) throw error;
      if (!data?.url) throw new Error(t("auth.googleUnavailable"));
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
        {/* Progress line */}
        <View style={[styles.progressTrack, { top: insets.top + 8 }]}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                backgroundColor: colors.foreground,
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>

        {/* Globe Image */}
        <View style={[styles.imageContainer, { marginTop: insets.top + 60 }]}>
          <Image
            source={globeImage}
            style={styles.globeImage}
            resizeMode="contain"
          />
        </View>

        {/* Headline */}
        <View style={styles.headlineContainer}>
          <TitleText
            style={[
              styles.headline,
              {
                color: colors.foreground,
                fontFamily: getAppFontFamily(isRtl, "bold"),
                ...getTextDirectionStyle(isRtl, "center"),
              },
            ]}
          >
            {t("onboarding.headline")}
          </TitleText>
        </View>

        {/* Buttons */}
        <View style={[styles.buttonContainer, { bottom: insets.bottom + 40 }]}>
          <TouchableOpacity
            onPress={() => void openAuth("signup")}
            activeOpacity={0.92}
            style={[styles.getStartedButton, { backgroundColor: colors.foreground }]}
          >
            <BodyText
              style={[
                styles.getStartedText,
                {
                  color: colors.background,
                  fontFamily: getAppFontFamily(isRtl, "bold"),
                },
              ]}
            >
              {t("onboarding.getStarted")}
            </BodyText>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => {
              await markOnboardingCompleted();
              navigation.replace("Home");
            }}
            activeOpacity={0.92}
            style={styles.skipButton}
          >
            <BodyText
              style={[
                styles.skipText,
                {
                  color: colors.muted,
                  fontFamily: getAppFontFamily(isRtl, "semibold"),
                },
              ]}
            >
              {t("onboarding.skip")}
            </BodyText>
          </TouchableOpacity>
        </View>

        {/* Auth Bottom Sheet Modal */}
        <BottomSheetModal
          visible={showAuthModal}
          onClose={() => setShowAuthModal(false)}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.background,
                paddingBottom: insets.bottom + 24,
              },
            ]}
          >
              {/* Drag handle */}
              <View style={styles.dragHandleRow}>
                <View
                  style={[
                    styles.dragHandle,
                    { backgroundColor: withOpacity(colors.foreground, 0.2) },
                  ]}
                />
              </View>

              <View
                style={styles.sheetContent}
              >
                <TitleText
                  style={[
                    styles.sheetTitle,
                    {
                      color: colors.foreground,
                      fontFamily: getAppFontFamily(isRtl, "bold"),
                      ...getTextDirectionStyle(isRtl, "center"),
                    },
                  ]}
                >
                  {isSignUp ? t("auth.signUpTitle") : t("auth.signInTitle")}
                </TitleText>
                <MutedText
                  style={[
                    styles.sheetDescription,
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
                  {/* Email */}
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

                  {/* Password */}
                  <View
                    style={[
                      styles.inputShell,
                      {
                        backgroundColor: withOpacity(
                          colors.surface2,
                          isLight ? 0.55 : 0.7,
                        ),
                        borderColor: colors.borderSubtle,
                        flexDirection: isRtl ? "row-reverse" : "row",
                        alignItems: "center",
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
                      onPress={() => setShowPassword((c) => !c)}
                      style={styles.eyeButton}
                    >
                      <Ionicons
                        name={showPassword ? "eye-outline" : "eye-off-outline"}
                        size={20}
                        color={colors.muted}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Confirm password (signup only) */}
                  {isSignUp ? (
                    <View
                      style={[
                        styles.inputShell,
                        {
                          backgroundColor: withOpacity(
                            colors.surface2,
                            isLight ? 0.55 : 0.7,
                          ),
                          borderColor: colors.borderSubtle,
                          flexDirection: isRtl ? "row-reverse" : "row",
                          alignItems: "center",
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
                        onPress={() => setShowConfirmPassword((c) => !c)}
                        style={styles.eyeButton}
                      >
                        <Ionicons
                          name={
                            showConfirmPassword
                              ? "eye-outline"
                              : "eye-off-outline"
                          }
                          size={20}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {/* Submit */}
                  <TouchableOpacity
                    disabled={isSubmitting || isGoogleSubmitting}
                    onPress={() => void handleSubmit()}
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

                  {/* Google */}
                  <TouchableOpacity
                    disabled={isSubmitting || isGoogleSubmitting}
                    onPress={() => void handleGoogleAuth()}
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
                      style={{ marginRight: 10, marginLeft: 10 }}
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

                {/* Error */}
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

                {/* Success message */}
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

                {/* Switch mode */}
                <View style={[styles.switchRow, { flexDirection: "row" }]}>
                  <BodyText
                    style={[
                      styles.switchPrompt,
                      {
                        color: colors.muted,
                        ...getTextDirectionStyle(isRtl),
                      },
                    ]}
                  >
                    {isSignUp
                      ? t("auth.alreadyHaveAccount")
                      : t("auth.noAccount")}
                  </BodyText>
                  <TouchableOpacity
                    onPress={() => {
                      setAuthMode(isSignUp ? "signin" : "signup");
                      setErrorMessage(null);
                      setMessage(null);
                    }}
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
                      {isSignUp
                        ? t("auth.signInAction")
                        : t("auth.signUpAction")}
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
            </View>
        </BottomSheetModal>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  // --- Onboarding ---
  progressTrack: {
    position: "absolute",
    left: 24,
    right: 24,
    height: 3,
    zIndex: 10,
    top: 0,
  },
  progressBar: {
    height: "100%",
  },
  imageContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  globeImage: {
    width: 420,
    height: 420,
  },
  headlineContainer: {
    marginTop: 48,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  headline: {
    fontSize: 36,
    lineHeight: 44,
    textAlign: "center",
    textTransform: "uppercase",
  },
  buttonContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    gap: 14,
  },
  getStartedButton: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  getStartedText: {
    fontSize: 16,
    lineHeight: 22,
  },
  skipButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 15,
    lineHeight: 20,
  },
  googleButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  googleText: {
    fontSize: 15,
    lineHeight: 20,
  },
  // --- Bottom Sheet ---
  sheet: {
    flexDirection: "column",
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
  sheetContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sheetFooter: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
    alignItems: "center",
  },
  sheetTitle: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: "center",
  },
  sheetDescription: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  form: {
    marginTop: 20,
    gap: 10,
  },
  inputShell: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
  },
  passwordInput: {
    flex: 1,
  },
  eyeButton: {
    padding: 6,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
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
    minHeight: 48,
    borderRadius: 14,
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
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 18,
  },
  switchRow: {
    marginTop: 14,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  switchPrompt: {
    fontSize: 14,
    lineHeight: 18,
  },
  switchLinkButton: {
    alignSelf: "center",
  },
  switchLink: {
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: "underline",
  },
  terms: {
    marginTop: 12,
    fontSize: 11,
    lineHeight: 16,
  },
});
