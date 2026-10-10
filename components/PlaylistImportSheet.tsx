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
import {
  importPlaylistAsLocalPlaylist,
  resolvePlaylistImport,
  type PlaylistImportResult,
} from "../modules/playlistImport";
import { AccentButton } from "./ui/Button";
import { BodyText, MutedText, TitleText } from "./ui/Text";

interface PlaylistImportSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the stored playlist so the caller can refresh its list. */
  onImported: () => void;
}

export function PlaylistImportSheet({
  visible,
  onClose,
  onImported,
}: PlaylistImportSheetProps) {
  const { colors } = useTheme();
  const { t, isRtl } = useAppLanguage();
  const [link, setLink] = useState("");
  const [result, setResult] = useState<PlaylistImportResult | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setLink("");
    setResult(null);
    setStatus("");
    setBusy(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleResolve = async () => {
    if (!link.trim() || busy) return;
    setBusy(true);
    setResult(null);
    setStatus(t("library.importPlaylistResolving"));
    try {
      const resolved = await resolvePlaylistImport(link);
      setResult(resolved);
      setStatus("");
    } catch (error) {
      console.warn("[PlaylistImportSheet] resolve failed:", error);
      setResult(null);
      setStatus(
        error instanceof Error
          ? error.message
          : t("library.importPlaylistFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!result || busy) return;
    setBusy(true);
    setStatus(t("library.importPlaylistSaving"));
    try {
      await importPlaylistAsLocalPlaylist(result);
      onImported();
      handleClose();
    } catch (error) {
      console.warn("[PlaylistImportSheet] import failed:", error);
      setStatus(t("library.importPlaylistFailed"));
      setBusy(false);
    }
  };

  const canResolve = link.trim().length > 0 && !busy;
  const canImport = Boolean(result?.tracks.length) && !busy;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
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
          <TouchableOpacity style={styles.backdropDismiss} onPress={handleClose} />
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
                    {t("library.importPlaylist")}
                  </TitleText>
                  <MutedText style={styles.subtitle}>
                    {t("library.importPlaylistDescription")}
                  </MutedText>
                </View>
                <TouchableOpacity
                  onPress={handleClose}
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

              <MutedText style={styles.label}>
                {t("library.importPlaylistLinkLabel")}
              </MutedText>
              <TextInput
                value={link}
                onChangeText={setLink}
                placeholder={t("library.importPlaylistLinkPlaceholder")}
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
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
              />
              <BodyText
                style={[styles.hint, { color: colors.muted }]}
              >
                {t("library.importPlaylistSources")}
              </BodyText>

              {status ? (
                <MutedText style={[styles.status, { color: colors.muted }]}>
                  {status}
                </MutedText>
              ) : null}

              {result ? (
                <View
                  style={[
                    styles.preview,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <TitleText numberOfLines={1} style={styles.previewName}>
                    {result.name || result.sourceId}
                  </TitleText>
                  <MutedText numberOfLines={1} style={styles.previewMeta}>
                    {result.owner
                      ? `${result.owner} \u2022 ${result.tracks.length} ${t(
                          "search.songs",
                        )}`
                      : `${result.tracks.length} ${t("search.songs")}`}
                  </MutedText>
                  {result.tracks.slice(0, 5).map((track) => (
                    <BodyText
                      key={`${track.source}-${track.id}`}
                      numberOfLines={1}
                      style={[styles.previewRow, { color: colors.foreground }]}
                    >
                      {track.title}
                      {track.artist ? ` \u2014 ${track.artist}` : ""}
                    </BodyText>
                  ))}
                  {result.skipped.length ? (
                    <MutedText style={[styles.status, { color: colors.muted }]}>
                      {t("library.importPlaylistSkipped", {
                        count: result.skipped.length,
                      })}
                    </MutedText>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.footer}>
                <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
                  <BodyText style={{ color: colors.muted }}>
                    {t("common.cancel")}
                  </BodyText>
                </TouchableOpacity>
                <View style={styles.submitButtonWrap}>
                  {result ? (
                    <AccentButton
                      title={t("library.importPlaylistConfirm")}
                      onPress={handleImport}
                      disabled={!canImport}
                      fullWidth
                      style={!canImport ? { opacity: 0.45 } : undefined}
                    />
                  ) : (
                    <AccentButton
                      title={t("library.importPlaylistPreview")}
                      onPress={handleResolve}
                      disabled={!canResolve}
                      fullWidth
                      style={!canResolve ? { opacity: 0.45 } : undefined}
                    />
                  )}
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
    gap: 14,
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
  label: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
  },
  status: {
    fontSize: 12,
    lineHeight: 17,
  },
  preview: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  previewName: {
    fontSize: 17,
    lineHeight: 22,
  },
  previewMeta: {
    fontSize: 12,
    lineHeight: 17,
  },
  previewRow: {
    fontSize: 14,
    lineHeight: 19,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  submitButtonWrap: {
    flex: 1,
    maxWidth: 320,
  },
});
