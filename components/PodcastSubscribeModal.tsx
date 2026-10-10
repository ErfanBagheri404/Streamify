import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { AccentButton } from "./ui/Button";
import { BodyText, MutedText, TitleText } from "./ui/Text";

interface PodcastSubscribeModalProps {
  visible: boolean;
  feedUrl: string;
  onFeedUrlChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  /** Set while the feed is being fetched; disables submit. */
  isSubmitting?: boolean;
  /** Inline failure from the fetch, e.g. "Feed not found (404)". */
  error?: string | null;
}

/**
 * Subscribe sheet (#30). Deliberately one field: a feed URL is the whole
 * input, and every failure mode is reported inline by the caller.
 */
export function PodcastSubscribeModal({
  visible,
  feedUrl,
  onFeedUrlChange,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
}: PodcastSubscribeModalProps) {
  const { colors } = useTheme();
  const { t, isRtl } = useAppLanguage();
  const [focused, setFocused] = useState(false);
  const canSubmit = feedUrl.trim().length > 0 && !isSubmitting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View
          style={[
            styles.backdrop,
            { backgroundColor: withOpacity(colors.background, 0.985) },
          ]}
        >
          <TouchableOpacity style={styles.backdropDismiss} onPress={onClose} />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface1,
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.cardContent}
            >
              <View style={[styles.headerRow, { flexDirection: "row" }]}>
                <View style={styles.headerTextBlock}>
                  <TitleText style={styles.title}>
                    {t("podcasts.subscribeTitle")}
                  </TitleText>
                  <MutedText style={styles.subtitle}>
                    {t("podcasts.subscribeDescription")}
                  </MutedText>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.cancel")}
                  style={[
                    styles.closeButton,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <Ionicons name="close" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <MutedText style={styles.label}>
                  {t("podcasts.feedUrl")}
                </MutedText>
                <TextInput
                  value={feedUrl}
                  onChangeText={onFeedUrlChange}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder={t("podcasts.feedUrlPlaceholder")}
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={!isSubmitting}
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.surface2,
                      borderColor: focused ? colors.accent : colors.borderSubtle,
                      fontFamily: getAppFontFamily(isRtl, "regular"),
                      ...getTextDirectionStyle(isRtl),
                    },
                  ]}
                />
              </View>

              {error ? (
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={16}
                    color={colors.muted}
                  />
                  <MutedText style={styles.errorText}>{error}</MutedText>
                </View>
              ) : null}

              <View style={[styles.footer, { flexDirection: "row" }]}>
                <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
                  <BodyText style={{ color: colors.muted }}>
                    {t("common.cancel")}
                  </BodyText>
                </TouchableOpacity>
                <View style={styles.submitButtonWrap}>
                  <AccentButton
                    title={
                      isSubmitting
                        ? t("podcasts.subscribing")
                        : t("podcasts.subscribe")
                    }
                    onPress={onSubmit}
                    disabled={!canSubmit}
                    fullWidth
                  />
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  backdropDismiss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    maxHeight: "80%",
  },
  cardContent: {
    padding: 20,
    gap: 16,
  },
  headerRow: {
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 18,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
  },
  footer: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  submitButtonWrap: {
    flex: 1,
  },
});
