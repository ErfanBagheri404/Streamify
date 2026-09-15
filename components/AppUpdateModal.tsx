/********************************************************************
 *  AppUpdateModal.tsx — redesigned new-version modal
 *
 *  The raw release body contained CI/CD provenance lines (version,
 *  tag, commit, EAS build ID, etc.) that leaked through as raw text.
 *  This component uses utils/updateNotes.ts to sanitize for display
 *  only — GitHub release notes stay untouched.
 *
 *  Design tokens come from the caller via the useTheme() hook.
 *******************************************************************/
import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useAppUpdate, CURRENT_APP_VERSION } from "../contexts/AppUpdateContext";
import { getAppFontFamily } from "../utils/fonts";
import { sanitizeChangelog } from "../utils/updateNotes";

const TRANSLATIONS = {
  en: {
    newVersion: "Update Available",
    subtitle: (current: string, next: string) =>
      `You're on v${current} — v${next} is ready to download.`,
    changelog: "What's new",
    later: "Not now",
    download: "Download",
    noChangelog: "No details available for this release.",
  },
  fa: {
    newVersion: "نسخه جدید موجود است",
    subtitle: (current: string, next: string) =>
      `نسخه ${current} را دارید — نسخه ${next} آماده دانلود است.`,
    changelog: "تغییرات جدید",
    later: "بعداً",
    download: "دانلود",
    noChangelog: "جزئیاتی برای این نسخه موجود نیست.",
  },
};

/**
 * Overlay-only update prompt. Mounts from AppShell and reads
 * updateInfo / dismissUpdate / hideUpdateModal from the
 * AppUpdateContext — no extra props needed.
 */
export function AppUpdateModal() {
  const { updateInfo, dismissUpdate, hideUpdateModal } = useAppUpdate();
  const { colors } = useTheme();
  const { language } = useAppLanguage();
  const copy = TRANSLATIONS[language] || TRANSLATIONS.en;

  const changelog = React.useMemo(
    () => (updateInfo ? sanitizeChangelog(updateInfo.changelog) : null),
    [updateInfo?.changelog],
  );

  if (!updateInfo) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => void dismissUpdate()}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.68)",
          paddingHorizontal: 20,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: 24,
            overflow: "hidden",
            backgroundColor: colors.surface1,
            borderWidth: 1,
            borderColor: withOpacity(colors.borderSubtle, 0.9),
          }}
        >
          <View style={{ padding: 20 }}>
            {/* Version badge */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: withOpacity(colors.accent, 0.18),
                }}
              >
                <Ionicons name="arrow-up-circle-outline" size={22} color={colors.accent} />
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 18,
                    lineHeight: 22,
                    fontFamily: getAppFontFamily(language === "fa", "bold"),
                  }}
                >
                  {copy.newVersion}
                </Text>
                <Text
                  style={{
                    color: withOpacity(colors.foreground, 0.6),
                    fontSize: 13,
                    lineHeight: 17,
                    marginTop: 2,
                    fontFamily: getAppFontFamily(language === "fa", "regular"),
                  }}
                >
                  v{updateInfo.version}
                </Text>
              </View>
            </View>

            <Text
              style={{
                color: withOpacity(colors.foreground, 0.78),
                fontSize: 14,
                lineHeight: 20,
                fontFamily: getAppFontFamily(language === "fa", "regular"),
              }}
            >
              {copy.subtitle(CURRENT_APP_VERSION, updateInfo.version)}
            </Text>

            {/* Changelog card */}
            <View
              style={{
                marginTop: 14,
                maxHeight: 200,
                borderRadius: 16,
                backgroundColor: withOpacity(colors.background, 0.5),
                borderWidth: 1,
                borderColor: withOpacity(colors.borderSubtle, 0.6),
              }}
            >
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 14 }}
              >
                <Text
                  style={{
                    color: withOpacity(colors.foreground, 0.88),
                    fontSize: 13,
                    lineHeight: 21,
                    fontFamily: getAppFontFamily(language === "fa", "regular"),
                  }}
                >
                  {changelog && !changelog.empty
                    ? changelog.lines.map((line, i) => {
                        // Paragraph separators render as blank lines, no bullet.
                        if (line === "") {
                          return <Text key={i}>{"\n"}</Text>;
                        }
                        return (
                          <Text key={i}>
                            {i > 0 ? "\n" : ""}
                            {`• ${line}`}
                          </Text>
                        );
                      })
                    : copy.noChangelog}
                </Text>
              </ScrollView>
            </View>
          </View>

          {/* Action buttons */}
          <View
            style={{
              flexDirection: "row",
              borderTopWidth: 1,
              borderTopColor: withOpacity(colors.borderSubtle, 0.6),
            }}
          >
            <TouchableOpacity
              onPress={() => void dismissUpdate()}
              activeOpacity={0.7}
              style={{
                flex: 1,
                minHeight: 52,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "transparent",
              }}
            >
              <Text
                style={{
                  color: withOpacity(colors.foreground, 0.68),
                  fontSize: 15,
                  lineHeight: 20,
                  fontFamily: getAppFontFamily(language === "fa", "medium"),
                }}
              >
                {copy.later}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (updateInfo.downloadUrl) {
                  void Linking.openURL(updateInfo.downloadUrl);
                }
                hideUpdateModal();
              }}
              activeOpacity={0.7}
              style={{
                flex: 1.3,
                minHeight: 52,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accent,
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontSize: 15,
                  lineHeight: 20,
                  fontFamily: getAppFontFamily(language === "fa", "bold"),
                }}
              >
                {copy.download}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
