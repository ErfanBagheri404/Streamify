import React from "react";
import {
  Dimensions,
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
import { LinearGradient } from "expo-linear-gradient";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { AccentButton } from "./ui/Button";
import { BodyText, MutedText, TitleText } from "./ui/Text";

interface PlaylistCreateModalProps {
  visible: boolean;
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
}

export function PlaylistCreateModal({
  visible,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onClose,
  onSubmit,
  title,
  subtitle,
  submitLabel,
}: PlaylistCreateModalProps) {
  const { colors } = useTheme();
  const { t, isRtl } = useAppLanguage();
  const { width } = Dimensions.get("window");
  const canSubmit = name.trim().length > 0;
  const stacked = width < 720;
  const previewName = name.trim() || t("library.myPlaylist");
  const previewDescription =
    description.trim() || t("library.playlistDescriptionPlaceholder");
  const modalTitle = title || t("library.createPlaylistModalTitle");
  const modalSubtitle = subtitle || t("library.createPlaylistModalDescription");
  const actionLabel = submitLabel || t("common.create");

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
            { backgroundColor: withOpacity(colors.background, 0.72) },
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
              <View
                style={[
                  styles.headerRow,
                  { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                <View style={styles.headerTextBlock}>
                  <TitleText style={styles.title}>{modalTitle}</TitleText>
                  <MutedText style={styles.subtitle}>{modalSubtitle}</MutedText>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={t("library.closePlaylistModal")}
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

              <View
                style={[
                  styles.content,
                  {
                    flexDirection: stacked
                      ? "column"
                      : isRtl
                        ? "row-reverse"
                        : "row",
                  },
                ]}
              >
                <View
                  style={[
                    styles.previewPanel,
                    stacked ? styles.previewPanelStacked : null,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[colors.accent, colors.heroMid, colors.heroEnd]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[
                      styles.previewArtwork,
                      stacked ? styles.previewArtworkStacked : null,
                    ]}
                  >
                    <Ionicons
                      name="folder-open-outline"
                      size={54}
                      color={colors.accentContrast}
                    />
                  </LinearGradient>
                  <TitleText numberOfLines={1} style={styles.previewName}>
                    {previewName}
                  </TitleText>
                  <MutedText
                    numberOfLines={3}
                    style={styles.previewDescription}
                  >
                    {previewDescription}
                  </MutedText>
                </View>

                <View
                  style={[
                    styles.formPanel,
                    stacked ? styles.formPanelStacked : null,
                  ]}
                >
                  <View style={styles.field}>
                    <MutedText style={styles.label}>
                      {t("library.name")}
                    </MutedText>
                    <TextInput
                      value={name}
                      onChangeText={onNameChange}
                      placeholder={t("library.myPlaylist")}
                      placeholderTextColor={colors.muted}
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.surface2,
                          borderColor: colors.borderSubtle,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        },
                      ]}
                      autoFocus
                    />
                  </View>

                  <View style={styles.field}>
                    <MutedText style={styles.label}>
                      {t("library.description")}
                    </MutedText>
                    <TextInput
                      value={description}
                      onChangeText={onDescriptionChange}
                      placeholder={t("library.whatIsPlaylistFor")}
                      placeholderTextColor={colors.muted}
                      multiline
                      textAlignVertical="top"
                      style={[
                        styles.textarea,
                        {
                          color: colors.foreground,
                          backgroundColor: colors.surface2,
                          borderColor: colors.borderSubtle,
                          fontFamily: getAppFontFamily(isRtl, "regular"),
                          ...getTextDirectionStyle(isRtl),
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>

              <View
                style={[
                  styles.footer,
                  stacked
                    ? styles.footerStacked
                    : { flexDirection: isRtl ? "row-reverse" : "row" },
                ]}
              >
                <TouchableOpacity onPress={onClose} style={styles.cancelButton}>
                  <BodyText style={{ color: colors.muted }}>
                    {t("common.cancel")}
                  </BodyText>
                </TouchableOpacity>
                <View
                  style={[
                    styles.submitButtonWrap,
                    stacked ? styles.submitButtonWrapStacked : null,
                  ]}
                >
                  <AccentButton
                    title={actionLabel}
                    onPress={onSubmit}
                    disabled={!canSubmit}
                    fullWidth
                    style={!canSubmit ? { opacity: 0.45 } : undefined}
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
    alignItems: "center",
    paddingHorizontal: 16,
  },
  backdropDismiss: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  card: {
    width: "100%",
    maxWidth: 760,
    maxHeight: "88%",
    borderRadius: 28,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardContent: {
    padding: 20,
    gap: 18,
  },
  headerRow: {
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    gap: 18,
  },
  previewPanel: {
    flex: 1,
    minWidth: 220,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
  },
  previewArtwork: {
    aspectRatio: 1,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  previewPanelStacked: {
    minWidth: 0,
  },
  previewArtworkStacked: {
    aspectRatio: undefined,
    height: 140,
  },
  previewName: {
    marginTop: 14,
    fontSize: 18,
    lineHeight: 22,
  },
  previewDescription: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
  },
  formPanel: {
    flex: 1.35,
    gap: 14,
  },
  formPanelStacked: {
    flex: 0,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    lineHeight: 16,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  textarea: {
    minHeight: 122,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  footer: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  footerStacked: {
    alignItems: "stretch",
    flexDirection: "column-reverse",
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  submitButtonWrap: {
    minWidth: 132,
  },
  submitButtonWrapStacked: {
    width: "100%",
  },
});
