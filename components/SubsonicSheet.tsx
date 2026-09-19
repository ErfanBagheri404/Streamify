/********************************************************************
 *  SubsonicSheet.tsx — self-hosted server setup
 *
 *  Users point Streamify at their own Subsonic-compatible server
 *  (Navidrome, Airsonic, gonic, Jellyfin's Subsonic bridge) by entering
 *  a URL plus credentials. Nothing is proxied through us; searches and
 *  streams go straight to their server.
 *
 *  Save validates with ping before persisting, so a typo can never
 *  clobber a previously working configuration.
 *******************************************************************/
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { subsonicService } from "../modules/subsonicService";

interface SubsonicSheetProps {
  visible: boolean;
  onClose: () => void;
}

const SheetBackdrop = styled(TouchableOpacity)`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.6);
`;
const SheetBody = styled.View`
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 20px 18px 30px 18px;
`;
const SheetHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`;
const SheetTitle = styled.Text`
  font-size: 17px;
`;
const SectionLabel = styled.Text`
  font-size: 13px;
  margin-bottom: 6px;
  font-weight: 600;
`;
const FieldInput = styled(TextInput)`
  min-height: 44px;
  border-radius: 12px;
  border-width: 1px;
  padding-horizontal: 14px;
  font-size: 14px;
  margin-bottom: 14px;
`;
const SaveButton = styled(TouchableOpacity)`
  min-height: 44px;
  border-radius: 12px;
  align-items: center;
  justify-content: center;
`;
const GuideText = styled.Text`
  font-size: 12px;
  margin-bottom: 6px;
  line-height: 17px;
`;

export function SubsonicSheet({ visible, onClose }: SubsonicSheetProps) {
  const { colors } = useTheme();
  const { t, isRtl } = useAppLanguage();
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "ok" | "error";
    message: string;
  } | null>(null);

  const font = (weight: "regular" | "medium" | "bold" = "regular") =>
    getAppFontFamily(isRtl, weight);
  const rtl = () => getTextDirectionStyle(isRtl);

  // Load any existing configuration whenever the sheet opens so users can
  // correct a typo instead of retyping the whole thing.
  useEffect(() => {
    if (!visible) return;
    setFeedback(null);
    void (async () => {
      const existing = await subsonicService.loadConfig();
      if (existing) {
        setBaseUrl(existing.baseUrl);
        setUsername(existing.username);
        setPassword(existing.password);
      } else {
        setBaseUrl("");
        setUsername("");
        setPassword("");
      }
    })();
  }, [visible]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await subsonicService.saveConfig({ baseUrl, username, password });
      setFeedback({ tone: "ok", message: t("subsonic.saved") });
    } catch (error: any) {
      setFeedback({
        tone: "error",
        message: error?.message || t("subsonic.connectFailed"),
      });
    } finally {
      setSaving(false);
    }
  }, [baseUrl, username, password, saving, t]);

  const disconnect = useCallback(async () => {
    await subsonicService.clearConfig();
    setBaseUrl("");
    setUsername("");
    setPassword("");
    setFeedback({ tone: "ok", message: t("subsonic.cleared") });
  }, [t]);

  const labelStyle = {
    color: colors.foreground,
    fontFamily: font("medium"),
    ...rtl(),
  };
  const helpStyle = {
    color: colors.muted,
    fontFamily: font("regular"),
    ...rtl(),
  };
  const inputStyle = {
    color: colors.foreground,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface1,
    fontFamily: font("regular"),
    ...rtl(),
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <SheetBackdrop activeOpacity={1} onPress={onClose} />
      <SheetBody style={{ backgroundColor: colors.background }}>
        <SheetHeader>
          <SheetTitle
            style={{
              color: colors.foreground,
              fontFamily: font("bold"),
              ...rtl(),
            }}
          >
            {t("subsonic.title")}
          </SheetTitle>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={22} color={colors.muted} />
          </TouchableOpacity>
        </SheetHeader>

        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          <SectionLabel style={labelStyle}>
            {t("subsonic.how_to_connect")}
          </SectionLabel>
          <GuideText style={helpStyle}>{t("subsonic.intro")}</GuideText>
          <GuideText style={helpStyle}>{t("subsonic.step1")}</GuideText>
          <GuideText style={helpStyle}>{t("subsonic.step2")}</GuideText>
          <GuideText style={helpStyle}>{t("subsonic.step3")}</GuideText>
          <View style={{ height: 8 }} />

          <SectionLabel style={labelStyle}>
            {t("subsonic.serverUrl")}
          </SectionLabel>
          <FieldInput
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={t("subsonic.serverUrlPlaceholder")}
            placeholderTextColor={withOpacity(colors.muted, 0.7)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={inputStyle}
          />

          <SectionLabel style={labelStyle}>
            {t("subsonic.username")}
          </SectionLabel>
          <FieldInput
            value={username}
            onChangeText={setUsername}
            placeholder={t("subsonic.usernamePlaceholder")}
            placeholderTextColor={withOpacity(colors.muted, 0.7)}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />

          <SectionLabel style={labelStyle}>
            {t("subsonic.password")}
          </SectionLabel>
          <FieldInput
            value={password}
            onChangeText={setPassword}
            placeholder={t("subsonic.passwordPlaceholder")}
            placeholderTextColor={withOpacity(colors.muted, 0.7)}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle}
          />

          <SaveButton
            activeOpacity={0.88}
            disabled={saving}
            onPress={() => void save()}
            style={{
              backgroundColor: colors.foreground,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.background} />
            ) : (
              <Text
                style={{
                  color: colors.background,
                  fontFamily: font("bold"),
                  fontSize: 14,
                }}
              >
                {t("subsonic.connect")}
              </Text>
            )}
          </SaveButton>

          {feedback ? (
            <View style={{ marginTop: 12 }}>
              <Text
                style={{
                  color:
                    feedback.tone === "error" ? "#ef4444" : colors.foreground,
                  fontFamily: font("regular"),
                  fontSize: 12,
                  ...rtl(),
                }}
              >
                {feedback.message}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={() => void disconnect()}
            style={{ marginTop: 16, alignSelf: "center" }}
          >
            <Text
              style={{
                color: colors.muted,
                fontFamily: font("regular"),
                fontSize: 12,
              }}
            >
              {t("subsonic.disconnect")}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SheetBody>
    </Modal>
  );
}
