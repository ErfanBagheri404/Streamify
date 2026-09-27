/********************************************************************
 *  SongIdentifySheet.tsx — "what's this song?" (issue #36)
 *
 *  Flat bottom sheet in the same shape as PlaylistCreateModal /
 *  LyricsSearchSheet: Modal + backdrop + header row + flat rows.
 *  No rounded cards, no new settings section.
 *
 *  All recognition logic lives in modules/songRecognition.ts; this
 *  component only drives states and hands the match to the parent
 *  (search in app / add to queue via the existing player path).
 *******************************************************************/
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import {
  MAX_SNIPPET_MS,
  MIN_SNIPPET_MS,
  discardSnippet,
  finalizeSnippet,
  isRecognitionConfigured,
  recordSnippet,
  remainingSnippetMs,
  recognize,
  type RecognizeFailureReason,
  type SongMatch,
} from "../modules/songRecognition";

type SheetState =
  | "idle"
  | "recording"
  | "submitting"
  | "result"
  | "not_configured"
  | "no_match"
  | "permission_denied"
  | "network";

interface SongIdentifySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Parent runs the in-app search for the recognized title/artist. */
  onSearchInApp: (match: SongMatch) => void;
  /** Parent queues the match through the existing smart-queue path. */
  onAddToQueue: (match: SongMatch) => void;
}

const failureState = (
  reason: RecognizeFailureReason | undefined,
): SheetState => {
  if (reason === "not_configured") return "not_configured";
  if (reason === "no_match") return "no_match";
  if (reason === "permission_denied") return "permission_denied";
  return "network";
};

export function SongIdentifySheet({
  visible,
  onClose,
  onSearchInApp,
  onAddToQueue,
}: SongIdentifySheetProps) {
  const { colors } = useTheme();
  const { t, isRtl } = useAppLanguage();

  const [state, setState] = useState<SheetState>("idle");
  const [match, setMatch] = useState<SongMatch | null>(null);
  const [keepSnippet, setKeepSnippet] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(MAX_SNIPPET_MS / 1000),
  );
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [clipOutcome, setClipOutcome] = useState<string | null>(null);

  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keepRef = useRef(false);
  keepRef.current = keepSnippet;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset on open; show the not-configured state without any network call.
  useEffect(() => {
    if (!visible) return;
    clearTimer();
    elapsedRef.current = 0;
    setMatch(null);
    setKeepSnippet(false);
    setClipUri(null);
    setClipOutcome(null);
    setSecondsLeft(Math.ceil(MAX_SNIPPET_MS / 1000));
    setState(isRecognitionConfigured() ? "idle" : "not_configured");
  }, [visible, clearTimer]);

  // Privacy rule: on close the clip is deleted unless the user kept it.
  useEffect(() => {
    if (visible) return;
    const uri = clipUri;
    if (!uri) return;
    setClipUri(null);
    void finalizeSnippet(uri, keepRef.current).then((deleted) => {
      setClipOutcome(
        deleted ? t("songIdentify.snippetDiscarded") : t("songIdentify.snippetSaved"),
      );
    });
  }, [visible, clipUri, t]);

  const startRecording = useCallback(async () => {
    clearTimer();
    elapsedRef.current = 0;
    setSecondsLeft(Math.ceil(MAX_SNIPPET_MS / 1000));
    setState("recording");
    timerRef.current = setInterval(() => {
      elapsedRef.current += 250;
      setSecondsLeft(Math.ceil(remainingSnippetMs(elapsedRef.current) / 1000));
    }, 250);

    const recorded = await recordSnippet();
    clearTimer();
    if (!recorded.ok) {
      setState(failureState(recorded.reason));
      return;
    }
    setClipUri(recorded.uri);
    setState("submitting");
    const result = await recognize(recorded.uri);
    if (!result.ok) {
      setState(failureState(result.reason));
      return;
    }
    setMatch(result.match);
    setState("result");
  }, [clearTimer]);

  const close = useCallback(() => {
    clearTimer();
    onClose();
  }, [clearTimer, onClose]);

  const title = t("songIdentify.title");
  const subtitle = t("songIdentify.subtitle");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View
        style={[
          styles.backdrop,
          { backgroundColor: withOpacity(colors.background, 0.985) },
        ]}
      >
        <TouchableOpacity style={styles.backdropDismiss} onPress={close} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface1,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={[styles.headerRow, { flexDirection: "row" }]}>
              <View style={styles.headerTextBlock}>
                <Text
                  style={[styles.title, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
                <Text
                  style={[styles.subtitle, { color: colors.muted }]}
                  numberOfLines={2}
                >
                  {subtitle}
                </Text>
              </View>
              <TouchableOpacity
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel={t("songIdentify.close")}
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

            {state === "idle" && (
              <View style={styles.body}>
                <Text style={[styles.bodyText, { color: colors.muted }]}>
                  {t("songIdentify.idleBody")}
                </Text>
                <TouchableOpacity
                  onPress={startRecording}
                  accessibilityRole="button"
                  style={[
                    styles.primaryRow,
                    { backgroundColor: colors.accent },
                  ]}
                >
                  <Ionicons
                    name="mic-outline"
                    size={18}
                    color={colors.accentContrast}
                  />
                  <Text style={[styles.primaryRowText, { color: colors.accentContrast }]}>
                    {t("songIdentify.start")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {state === "recording" && (
              <View style={styles.body}>
                <View style={styles.statusRow}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    {t("songIdentify.recording")}{" "}
                    {t("songIdentify.secondsLeft").replace(
                      "{{seconds}}",
                      String(secondsLeft),
                    )}
                  </Text>
                </View>
                <View
                  style={[
                    styles.progressTrack,
                    { backgroundColor: colors.surface2 },
                  ]}
                >
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.accent,
                        width: `${Math.min(
                          100,
                          (elapsedRef.current / MAX_SNIPPET_MS) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.hintText, { color: colors.muted }]}>
                  {t("songIdentify.recordingHint")}
                </Text>
              </View>
            )}

            {state === "submitting" && (
              <View style={styles.body}>
                <View style={styles.statusRow}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    {t("songIdentify.submitting")}
                  </Text>
                </View>
              </View>
            )}

            {state === "not_configured" && (
              <View style={styles.body}>
                <View style={styles.statusRow}>
                  <Ionicons
                    name="cloud-offline-outline"
                    size={20}
                    color={colors.muted}
                  />
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    {t("songIdentify.notConfiguredBody")}
                  </Text>
                </View>
              </View>
            )}

            {state === "no_match" && (
              <View style={styles.body}>
                <View style={styles.statusRow}>
                  <Ionicons
                    name="musical-notes-outline"
                    size={20}
                    color={colors.muted}
                  />
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    {t("songIdentify.noMatchBody")}
                  </Text>
                </View>
              </View>
            )}

            {state === "permission_denied" && (
              <View style={styles.body}>
                <View style={styles.statusRow}>
                  <Ionicons
                    name="mic-off-outline"
                    size={20}
                    color={colors.muted}
                  />
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    {t("songIdentify.permissionDeniedBody")}
                  </Text>
                </View>
              </View>
            )}

            {state === "network" && (
              <View style={styles.body}>
                <View style={styles.statusRow}>
                  <Ionicons
                    name="wifi-outline"
                    size={20}
                    color={colors.muted}
                  />
                  <Text style={[styles.bodyText, { color: colors.foreground }]}>
                    {t("songIdentify.networkBody")}
                  </Text>
                </View>
              </View>
            )}

            {state === "result" && match && (
              <View style={styles.body}>
                <View
                  style={[
                    styles.matchRow,
                    {
                      backgroundColor: colors.surface2,
                      borderColor: colors.borderSubtle,
                    },
                  ]}
                >
                  <Ionicons
                    name="musical-note"
                    size={20}
                    color={colors.accent}
                  />
                  <View style={styles.matchTextBlock}>
                    <Text
                      style={[styles.matchTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {match.title}
                    </Text>
                    {!!match.artist && (
                      <Text
                        style={[styles.matchArtist, { color: colors.muted }]}
                        numberOfLines={1}
                      >
                        {match.artist}
                      </Text>
                    )}
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => onSearchInApp(match)}
                  accessibilityRole="button"
                  style={[
                    styles.flatRow,
                    { borderColor: colors.borderSubtle },
                  ]}
                >
                  <Ionicons
                    name="search-outline"
                    size={18}
                    color={colors.foreground}
                  />
                  <Text style={[styles.flatRowText, { color: colors.foreground }]}>
                    {t("songIdentify.searchInApp")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => onAddToQueue(match)}
                  accessibilityRole="button"
                  style={[
                    styles.flatRow,
                    { borderColor: colors.borderSubtle },
                  ]}
                >
                  <Ionicons
                    name="add-outline"
                    size={18}
                    color={colors.foreground}
                  />
                  <Text style={[styles.flatRowText, { color: colors.foreground }]}>
                    {t("songIdentify.addToQueue")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setKeepSnippet((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: keepSnippet }}
                  style={[
                    styles.flatRow,
                    { borderColor: colors.borderSubtle },
                  ]}
                >
                  <Ionicons
                    name={keepSnippet ? "checkbox" : "square-outline"}
                    size={18}
                    color={colors.foreground}
                  />
                  <Text style={[styles.flatRowText, { color: colors.foreground }]}>
                    {t("songIdentify.keepSnippet")}
                  </Text>
                </TouchableOpacity>

                {!!clipOutcome && (
                  <Text style={[styles.hintText, { color: colors.muted }]}>
                    {clipOutcome}
                  </Text>
                )}
              </View>
            )}
          </ScrollView>

          <View style={[styles.footer, { flexDirection: "row" }]}>
            <TouchableOpacity onPress={close} style={styles.cancelButton}>
              <Text style={[styles.cancelText, { color: colors.muted }]}>
                {t("songIdentify.close")}
              </Text>
            </TouchableOpacity>
            {(state === "no_match" ||
              state === "permission_denied" ||
              state === "network") && (
              <TouchableOpacity
                onPress={startRecording}
                accessibilityRole="button"
                style={styles.retryButton}
              >
                <Text style={[styles.retryText, { color: colors.accent }]}>
                  {t("songIdentify.tryAgain")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Re-exported so the privacy bound is visible at the call site too.
export { MIN_SNIPPET_MS };

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  backdropDismiss: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheet: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "88%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  content: {
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
    fontSize: 20,
    lineHeight: 26,
  },
  subtitle: {
    marginTop: 4,
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
  body: {
    gap: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bodyText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 16,
  },
  primaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  primaryRowText: {
    fontSize: 15,
    fontWeight: "600",
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  matchTextBlock: {
    flex: 1,
  },
  matchTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
  },
  matchArtist: {
    fontSize: 13,
    lineHeight: 18,
  },
  flatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    borderBottomWidth: 1,
    paddingHorizontal: 4,
  },
  flatRowText: {
    flex: 1,
    fontSize: 15,
  },
  footer: {
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 8,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 14,
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  retryText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
