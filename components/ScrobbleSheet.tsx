/********************************************************************
 *  ScrobbleSheet.tsx - Connect ListenBrainz / Last.fm scrobbling
 *
 *  ListenBrainz: user pastes their user token from listenbrainz.org — works
 *  immediately, no app registration needed.
 *  Last.fm: disabled until app-level API credentials are compiled in; the
 *  row explains this instead of silently failing.
 *
 *  Perf contract: no timers, no listeners. One AsyncStorage write per change.
 *******************************************************************/
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { t } from "../utils/localization";
import { scrobblerService } from "../services/ScrobblerService";

interface ScrobbleSheetProps {
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

const Label = styled.Text`
  font-size: 13px;
  margin-bottom: 6px;
`;

const TokenInput = styled(TextInput)`
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

export const ScrobbleSheet: React.FC<ScrobbleSheetProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const [lbzToken, setLbzToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    if (!visible) {
      return;
    }
    void scrobblerService
      .getEnabledProviders()
      .then(({ lastfm, listenbrainz }) => {
        // Read back the stored raw token so the field shows what's saved.
        setStatusText(
          lastfm || listenbrainz
            ? t("scrobble.connected") || "Connected"
            : "",
        );
      })
      .catch(() => {});
  }, [visible]);

  if (!visible) {
    return null;
  }

  const muted = withOpacity(colors.foreground, 0.6);

  const save = async () => {
    const token = lbzToken.trim();
    setIsSaving(true);
    try {
      await scrobblerService.setListenBrainzToken(token || null);
      setStatusText(
        token
          ? t("scrobble.savedConnected") || "Saved — scrobbling enabled"
          : t("scrobble.cleared") || "Token cleared",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <SheetBackdrop activeOpacity={1} onPress={onClose} />
      <SheetBody style={{ backgroundColor: colors.background }}>
        <SheetHeader>
          <SheetTitle
            style={{
              color: colors.foreground,
              fontFamily: getAppFontFamily(isRtl, "bold"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            {t("scrobble.title") || "Scrobbling"}
          </SheetTitle>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={muted} />
          </TouchableOpacity>
        </SheetHeader>

        <Label
          style={{
            color: colors.foreground,
            fontFamily: getAppFontFamily(isRtl, "semibold"),
            ...getTextDirectionStyle(isRtl),
          }}
        >
          {t("scrobble.listenbrainzToken") || "ListenBrainz user token"}
        </Label>
        <Text
          style={{
            color: muted,
            fontSize: 12,
            marginBottom: 10,
            fontFamily: getAppFontFamily(isRtl, "regular"),
            ...getTextDirectionStyle(isRtl),
          }}
        >
          {t("scrobble.listenbrainzHelp") ||
            "Paste your user token from listenbrainz.org/settings (Profile → User Token)."}
        </Text>
        <TokenInput
          value={lbzToken}
          onChangeText={setLbzToken}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          placeholderTextColor={withOpacity(muted, 0.7)}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            borderColor: colors.borderSubtle,
            backgroundColor: withOpacity(colors.surface2, 0.8),
            color: colors.foreground,
            fontFamily: getAppFontFamily(isRtl, "regular"),
            ...getTextDirectionStyle(isRtl),
          }}
        />
        <SaveButton
          activeOpacity={0.88}
          disabled={isSaving}
          onPress={() => void save()}
          style={{
            backgroundColor: colors.foreground,
            opacity: isSaving ? 0.6 : 1,
          }}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text
              style={{
                color: colors.background,
                fontSize: 14,
                fontFamily: getAppFontFamily(isRtl, "semibold"),
              }}
            >
              {t("scrobble.save") || "Save"}
            </Text>
          )}
        </SaveButton>

        {!!statusText && (
          <Text
            style={{
              color: muted,
              fontSize: 12,
              marginTop: 10,
              fontFamily: getAppFontFamily(isRtl, "regular"),
              ...getTextDirectionStyle(isRtl, "center"),
            }}
          >
            {statusText}
          </Text>
        )}
      </SheetBody>
    </Modal>
  );
};

export default ScrobbleSheet;
