import React, { useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { useAppLanguage } from "../../hooks/useAppLanguage";
import { BodyText, MutedText, TitleText } from "./Text";

const TELEGRAM_URL = "https://t.me/StreamifyPlayer";
const GITHUB_URL = "https://github.com/ErfanBagheri404/Streamify";
const COMMUNITY_MODAL_STORAGE_KEY = "streamifyCommunityModalDismissed";

async function readDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(COMMUNITY_MODAL_STORAGE_KEY)) === "true";
  } catch {
    return false;
  }
}

async function persistDismissed(): Promise<void> {
  try {
    await AsyncStorage.setItem(COMMUNITY_MODAL_STORAGE_KEY, "true");
  } catch {}
}

interface CommunityIconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  url: string;
  colors: ReturnType<typeof useTheme>["colors"];
}

function CommunityIconButton({
  icon,
  label,
  url,
  colors,
}: CommunityIconButtonProps) {
  return (
    <View style={styles.iconColumn}>
      <TouchableOpacity
        accessibilityRole="link"
        onPress={() => {
          void Linking.openURL(url).catch(() => {});
        }}
        style={[
          styles.iconCircle,
          {
            backgroundColor: withOpacity(colors.accent, 0.14),
            borderColor: withOpacity(colors.accent, 0.3),
          },
        ]}
      >
        <Ionicons name={icon} size={24} color={colors.accent} />
      </TouchableOpacity>
      <MutedText style={styles.iconLabel}>{label}</MutedText>
    </View>
  );
}

interface CommunityModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CommunityModal({ visible, onClose }: CommunityModalProps) {
  const { colors } = useTheme();
  const { t } = useAppLanguage();

  const handleClose = () => {
    void persistDismissed();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableOpacity
        activeOpacity={1}
        style={styles.backdrop}
        onPress={handleClose}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[
            styles.card,
            {
              backgroundColor: colors.surface1,
              borderColor: colors.borderSubtle,
            },
          ]}
          onPress={() => {}}
        >
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TitleText style={styles.title}>
            {t("settings.communityTitle")}
          </TitleText>
          <BodyText style={[styles.description, { color: colors.foreground }]}>
            {t("settings.communityDescription")}
          </BodyText>
          <View style={styles.iconRow}>
            <CommunityIconButton
              icon="paper-plane"
              label={t("settings.communityTelegram")}
              url={TELEGRAM_URL}
              colors={colors}
            />
            <CommunityIconButton
              icon="logo-github"
              label={t("settings.communityGithub")}
              url={GITHUB_URL}
              colors={colors}
            />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export function useCommunityModalAutoShow(): {
  autoVisible: boolean;
  closeAuto: () => void;
} {
  const [autoVisible, setAutoVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readDismissed().then((dismissed) => {
      if (!cancelled && !dismissed) {
        setAutoVisible(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const closeAuto = () => {
    void persistDismissed();
    setAutoVisible(false);
  };

  return { autoVisible, closeAuto };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    top: 12,
    right: 12,
    padding: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  description: {
    marginTop: 8,
    fontSize: 14,
    textAlign: "center",
    opacity: 0.75,
  },
  iconRow: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "center",
    gap: 32,
  },
  iconColumn: {
    alignItems: "center",
    gap: 8,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
});

export { COMMUNITY_MODAL_STORAGE_KEY };
