/********************************************************************
 *  ScrobbleSheet.tsx — ListenBrainz and Last.fm scrobble setup
 *
 *  ListenBrainz: paste a user token. One field, one save button.
 *  Last.fm: guided browser auth flow with step-by-step instructions
 *  shown right in the sheet.
 *******************************************************************/
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as Linking from "expo-linking";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";
import { t } from "../utils/localization";
import { scrobblerService } from "../services/ScrobblerService";

export type ScrobbleProvider = "listenbrainz" | "lastfm";

interface ScrobbleSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Which provider's setup screen to show. One row per provider in Settings. */
  provider: ScrobbleProvider;
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
const GuideText = styled.Text`
  font-size: 12px;
  margin-bottom: 6px;
  line-height: 17px;
`;
const StepText = styled.Text`
  font-size: 12px;
  line-height: 17px;
  margin-bottom: 2px;
`;
const LinkText = styled.Text`
  font-size: 12px;
  line-height: 17px;
  text-decoration-line: underline;
`;
const Divider = styled.View`
  height: 1px;
  margin: 20px 0;
`;

export const ScrobbleSheet: React.FC<ScrobbleSheetProps> = ({
  visible,
  onClose,
  provider,
}) => {
  const isLbz = provider === "listenbrainz";
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();

  // --- ListenBrainz state ---
  const [lbzToken, setLbzToken] = useState("");
  const [lbzSaving, setLbzSaving] = useState(false);
  const [lbzStatus, setLbzStatus] = useState("");

  // --- Last.fm state ---
  const [lfmKey, setLfmKey] = useState("");
  const [lfmSecret, setLfmSecret] = useState("");
  const [lfmToken, setLfmToken] = useState("");
  const [lfmSaving, setLfmSaving] = useState(false);
  const [lfmStatus, setLfmStatus] = useState("");
  const [lfmUsername, setLfmUsername] = useState("");
  const lfmPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const font = useCallback(
    (w: "regular" | "semibold" | "bold") => getAppFontFamily(isRtl, w),
    [isRtl],
  );
  const rtl = useCallback(() => getTextDirectionStyle(isRtl), [isRtl]);
  const muted = withOpacity(colors.foreground, 0.6);

  // Load current saved values on open.
  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const [providers, lfmCreds, lfmSk] = await Promise.all([
        scrobblerService.getEnabledProviders(),
        scrobblerService.getLastfmCreds(),
        scrobblerService.getLastfmSessionKey(),
      ]);
      if (lfmCreds.apiKey) setLfmKey(lfmCreds.apiKey);
      if (lfmCreds.secret) setLfmSecret(lfmCreds.secret);
      if (providers.listenbrainz) {
        const raw: string | null = null; // Token is write-only in ScrobblerService; clearing the input on load is fine.
        if (raw) setLbzToken(raw);
      }
      if (providers.lastfm && lfmSk) {
        const uname = await scrobblerService.getLastfmUsername();
        if (uname) setLfmUsername(uname);
        setLfmStatus(`Connected as ${uname || "unknown"}`);
      }
    })();
    return () => { if (lfmPollRef.current) clearInterval(lfmPollRef.current); };
  }, [visible]);

  // ------- ListenBrainz save -------
  const saveLbz = async () => {
    const tok = lbzToken.trim();
    setLbzSaving(true);
    try {
      await scrobblerService.setListenBrainzToken(tok || null);
      const { listenbrainz } = await scrobblerService.getEnabledProviders();
      setLbzStatus(
        listenbrainz
          ? "Token saved — scrobbling to ListenBrainz is active."
          : tok
            ? "Saved — please verify at listenbrainz.org."
            : "Token cleared.",
      );
    } catch {
      setLbzStatus("Error saving token.");
    } finally {
      setLbzSaving(false);
    }
  };

  // ------- Last.fm guided flow -------
  const startLfmAuth = async () => {
    setLfmSaving(true);
    setLfmStatus("Requesting authorization token from Last.fm…");
    try {
      const token = await scrobblerService.requestLastfmAuthToken();
      if (!token) {
        setLfmStatus("Error: could not obtain an auth token. Check your API key and secret, then try again.");
        return;
      }
      setLfmToken(token);
      setLfmStatus(`Token received — authorizing…`);
      // Open Last.fm in browser for the user to approve.
      const url = scrobblerService.buildLastfmAuthUrl(token);
      if (Platform.OS === "android" || Platform.OS === "ios") {
        await Linking.openURL(url);
      }
      // Poll a few times for the session to land.
      lfmPollRef.current = setInterval(async () => {
        const { ok, username } = await scrobblerService.completeLastfmAuth(token);
        if (ok) {
          clearInterval(lfmPollRef.current!);
          lfmPollRef.current = null;
          setLfmUsername(username ?? "");
          setLfmStatus(`Connected to Last.fm as ${username ?? "unknown"}. Scrobbling is active.`);
          setLfmSaving(false);
        }
      }, 2000);
      // Timeout after 60 seconds.
      setTimeout(() => {
        if (lfmPollRef.current) {
          clearInterval(lfmPollRef.current);
          lfmPollRef.current = null;
          if (!lfmUsername) {
            setLfmStatus("Auth timed out — the user may not have approved the token. Please try again.");
            setLfmSaving(false);
          }
        }
      }, 60000);
      return; // polling continues in the background
    } catch {
      setLfmStatus("Network error — check your connection and try again.");
      setLfmSaving(false);
    }
  };

  const saveLfmKeys = async () => {
    const ak = lfmKey.trim();
    const sec = lfmSecret.trim();
    setLfmSaving(true);
    try {
      await scrobblerService.setLastfmCreds(ak || null, sec || null);
      const { lastfm } = await scrobblerService.getEnabledProviders();
      setLfmStatus(
        !ak
          ? "API key and secret cleared."
          : lastfm
            ? "Keys saved — Last.fm scrobbling is active."
            : "Keys saved — now run the authorization flow above to connect.",
      );
    } catch {
      setLfmStatus("Error saving keys.");
    } finally {
      setLfmSaving(false);
    }
  };

  const disconnectLfm = async () => {
    await scrobblerService.clearLastfmAuth();
    setLfmUsername("");
    setLfmToken("");
    setLfmStatus("Last.fm disconnected.");
  };

  if (!visible) return null;

  const inputStyle = (extra?: any) => ({
    borderColor: colors.borderSubtle,
    backgroundColor: withOpacity(colors.surface2, 0.8),
    color: colors.foreground,
    fontFamily: font("regular"),
    ...rtl(),
    ...extra,
  });
  const labelStyle = {
    color: colors.foreground,
    fontFamily: font("semibold"),
    ...rtl(),
  };
  const helpStyle = {
    color: muted,
    fontFamily: font("regular"),
    ...rtl(),
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <SheetBackdrop activeOpacity={1} onPress={onClose} />
      <SheetBody style={{ backgroundColor: colors.background }}>
        <SheetHeader>
          <SheetTitle style={{ color: colors.foreground, fontFamily: font("bold"), ...rtl() }}>
            {isLbz ? "ListenBrainz" : "Last.fm"}
          </SheetTitle>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={muted} />
          </TouchableOpacity>
        </SheetHeader>

        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          {/* ============ LISTENBRAINZ ============ */}
          {isLbz && (
            <>
          <SectionLabel style={labelStyle}>How to connect</SectionLabel>
          <GuideText style={helpStyle}>
            ListenBrainz is a free, open-source music scrobbling service. Setup takes under a minute:
          </GuideText>
          <StepText style={helpStyle}>1. Create a free account at listenbrainz.org</StepText>
          <StepText style={helpStyle}>2. Go to Settings → Profile</StepText>
          <StepText style={helpStyle}>3. Copy the "User Token" value (a UUID like xxxxxxxx-xxxx-…)</StepText>
          <StepText style={helpStyle}>4. Paste it in the field below and press Save</StepText>
          <View style={{ height: 8 }} />
          <TokenInput
            value={lbzToken}
            onChangeText={setLbzToken}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            placeholderTextColor={withOpacity(muted, 0.7)}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle()}
          />
          <SaveButton
            activeOpacity={0.88}
            disabled={lbzSaving}
            onPress={() => void saveLbz()}
            style={{ backgroundColor: colors.foreground, opacity: lbzSaving ? 0.6 : 1 }}
          >
            {lbzSaving
              ? <ActivityIndicator size="small" color={colors.background} />
              : <Text style={{ color: colors.background, fontSize: 14, fontFamily: font("semibold") }}>Save</Text>
            }
          </SaveButton>
          {!!lbzStatus && (
            <Text style={{ color: muted, fontSize: 12, marginTop: 10, fontFamily: font("regular"), ...rtl(), ...getTextDirectionStyle(isRtl, "center") }}>
              {lbzStatus}
            </Text>
          )}

          </>
          )}

          {/* ============ LAST.FM ============ */}
          {!isLbz && (
            <>
          <SectionLabel style={labelStyle}>How to connect</SectionLabel>
          <GuideText style={helpStyle}>
            Last.fm tracks your listening history and builds detailed stats. Setup requires four simple steps:
          </GuideText>
          <StepText style={helpStyle}>1. Go to last.fm/api/account/create and create an application</StepText>
          <StepText style={helpStyle}>2. Copy the "API Key" and "Shared Secret" — paste them here</StepText>
          <StepText style={helpStyle}>3. Press "Connect to Last.fm" — a browser will open to authorize the app</StepText>
          <StepText style={helpStyle}>4. Approve the request in your browser; scrobbling starts automatically</StepText>
          <View style={{ height: 8 }} />

          <TokenInput
            value={lfmKey}
            onChangeText={setLfmKey}
            placeholder="API Key"
            placeholderTextColor={withOpacity(muted, 0.7)}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle()}
          />
          <TokenInput
            value={lfmSecret}
            onChangeText={setLfmSecret}
            placeholder="Shared Secret"
            placeholderTextColor={withOpacity(muted, 0.7)}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={inputStyle()}
          />
          <SaveButton
            activeOpacity={0.88}
            disabled={lfmSaving}
            onPress={() => void saveLfmKeys()}
            style={{ backgroundColor: colors.foreground, opacity: lfmSaving ? 0.6 : 1 }}
          >
            {lfmSaving && !lfmToken
              ? <ActivityIndicator size="small" color={colors.background} />
              : <Text style={{ color: colors.background, fontSize: 14, fontFamily: font("semibold") }}>Save API Keys</Text>
            }
          </SaveButton>

          {/* Connect button — only shown after keys are saved and no session yet */}
          {!!lfmKey && !!lfmSecret && !lfmUsername && (
            <>
              <View style={{ height: 10 }} />
              <SaveButton
                activeOpacity={0.88}
                disabled={lfmSaving}
                onPress={() => void startLfmAuth()}
                style={{ backgroundColor: colors.accent, opacity: lfmSaving ? 0.6 : 1 }}
              >
                {lfmSaving
                  ? <ActivityIndicator size="small" color={colors.background} />
                  : <Text style={{ color: colors.background, fontSize: 14, fontFamily: font("semibold") }}>
                      {lfmToken ? "Authorizing… (check your browser)" : "Connect to Last.fm"}
                    </Text>
                }
              </SaveButton>
            </>
          )}

          {/* Disconnect button — shown when connected */}
          {!!lfmUsername && (
            <>
              <View style={{ height: 10 }} />
              <SaveButton
                activeOpacity={0.88}
                onPress={() => void disconnectLfm()}
                style={{ backgroundColor: withOpacity(colors.foreground, 0.15) }}
              >
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: font("semibold") }}>
                  Disconnect Last.fm
                </Text>
              </SaveButton>
            </>
          )}

          {!!lfmStatus && (
            <Text style={{ color: muted, fontSize: 12, marginTop: 10, fontFamily: font("regular"), ...rtl(), ...getTextDirectionStyle(isRtl, "center") }}>
              {lfmStatus}
            </Text>
          )}
          </>
          )}
        </ScrollView>
      </SheetBody>
    </Modal>
  );
};

export default ScrobbleSheet;
