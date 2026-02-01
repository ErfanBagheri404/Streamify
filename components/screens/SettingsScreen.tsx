import React, { useState } from "react";
import styled from "styled-components/native";
import { SafeArea } from "../SafeArea";
import { Ionicons } from "@expo/vector-icons";
import { clearSoundCloudCache } from "../../modules/audioStreaming";
import { Image } from "react-native";
import { Switch } from "react-native-gesture-handler";
import Slider from "@react-native-community/slider";
import { t } from "../../utils/localization";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0px 8px;
  border-bottom-width: 1px;
`;

const BackButton = styled.TouchableOpacity`
  padding: 8px;
`;

const HeaderCenter = styled.View`
  flex: 1;
  align-items: center;
`;

const SearchButton = styled.TouchableOpacity`
  padding: 8px;
`;

const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 18px;
  font-family: GoogleSansBold;
  line-height: 22px;
`;

const SettingsSection = styled.View`
  margin-top: 24px;
`;

const SettingItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom-width: 1px;
`;

const PressedSettingItem = styled(SettingItem)`
  background-color: #1a1a1a;
`;

const SettingLeft = styled.View`
  flex-direction: row;
  align-items: center;
  flex: 1;
  padding-left: ${(props) =>
    props.hasIcon
      ? "8px"
      : "0px"}; /* 24px (icon width) + 12px (margin) = 36px */
`;

const SettingRight = styled.View`
  margin-left: 12px;
`;

const SettingIcon = styled.Text`
  color: #a3a3a3;
  font-size: 20px;
  margin-right: 12px;
  font-family: GoogleSansRegular;
  line-height: 24px;
`;

const SettingText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

const SettingDescription = styled.Text`
  color: #a3a3a3;
  font-size: 12px;
  margin-top: 2px;
  font-family: GoogleSansRegular;
  line-height: 16px;
`;

const SettingContent = styled.View`
  flex: 1;
`;

export default function SettingsScreen({
  navigation,
  route,
}: {
  navigation: any;
  route: any;
}) {
  const [pressedButton, setPressedButton] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<string>("main");

  // Account settings state
  const [accountImage, setAccountImage] = useState<string>(
    "https://via.placeholder.com/100"
  );
  const [username, setUsername] = useState<string>("john_doe");
  const [email, setEmail] = useState<string>("john.doe@example.com");

  // Playback settings state
  const [gaplessPlayback, setGaplessPlayback] = useState<boolean>(true);
  const [automix, setAutomix] = useState<boolean>(false);
  const [crossfadeValue, setCrossfadeValue] = useState<number>(6);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [monoAudio, setMonoAudio] = useState<boolean>(false);
  const [volumeNormalization, setVolumeNormalization] = useState<boolean>(true);

  const settingsConfig: Array<{
    id: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    title: string;
    subtitle: string;
  }> = [
    {
      id: "account",
      icon: "person-outline",
      title: "Account",
      subtitle: "Manage your profile and preferences",
    },
    {
      id: "playback",
      icon: "play-circle-outline",
      title: "Playback",
      subtitle: "Audio quality and playback settings",
    },
    {
      id: "privacy",
      icon: "lock-closed-outline",
      title: "Privacy and Social",
      subtitle: "Privacy settings and social features",
    },
    {
      id: "notifications",
      icon: "notifications-outline",
      title: "Notifications",
      subtitle: "Push notifications and alerts",
    },
    {
      id: "data",
      icon: "cloud-download-outline",
      title: "Data-saving and offline",
      subtitle: "Download and data usage settings",
    },
    {
      id: "quality",
      icon: "musical-note-outline",
      title: "Media quality",
      subtitle: "Audio quality preferences",
    },
    {
      id: "support",
      icon: "help-circle-outline",
      title: "About and support",
      subtitle: "App information and help",
    },
  ];

  const handleButtonPress = (buttonId: string) => {
    setCurrentPage(buttonId);
  };

  const handleBackToMain = () => {
    setCurrentPage("main");
  };

  const getHeaderTitle = () => {
    switch (currentPage) {
      case "account":
        return t("screens.settings.main.account_title");
      case "playback":
        return t("screens.settings.main.playback_title");
      case "privacy":
        return t("screens.settings.main.privacy_title");
      case "notifications":
        return t("screens.settings.main.notifications_title");
      case "data":
        return t("screens.settings.main.data_title");
      case "quality":
        return t("screens.settings.main.quality_title");
      case "support":
        return t("screens.settings.main.support_title");
      default:
        return t("screens.settings.main.title");
    }
  };

  const renderAccountSettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.account.account_details")}
            </SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingIcon>
            <Ionicons name="person-circle" size={48} color="#fff" />
          </SettingIcon>
          <SettingContent>
            <SettingText>
              {t("screens.settings.account.account_image")}
            </SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>{t("screens.settings.account.username")}</SettingText>
            <SettingDescription>
              {t("screens.settings.account.username_placeholder")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>{t("screens.settings.account.email")}</SettingText>
            <SettingDescription>
              {t("screens.settings.account.email_placeholder")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
    </SettingsSection>
  );

  const renderPlaybackSettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.playback.gapless_playback")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.playback.gapless_playback_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={gaplessPlayback}
            onValueChange={setGaplessPlayback}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor={gaplessPlayback ? "#fff" : "#f4f3f4"}
          />
        </SettingRight>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>{t("screens.settings.playback.automix")}</SettingText>
            <SettingDescription>
              {t("screens.settings.playback.automix_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={automix}
            onValueChange={setAutomix}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor={automix ? "#fff" : "#f4f3f4"}
          />
        </SettingRight>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.playback.crossfade")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.playback.crossfade_desc").replace(
                "{time}",
                crossfadeValue.toString()
              )}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Slider
            style={{ width: 120, height: 40 }}
            minimumValue={0}
            maximumValue={12}
            step={0.5}
            value={crossfadeValue}
            onValueChange={setCrossfadeValue}
            minimumTrackTintColor="#1DB954"
            maximumTrackTintColor="#767577"
            thumbTintColor="#fff"
          />
        </SettingRight>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.playback.listening_controls")}
            </SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>{t("screens.settings.playback.autoplay")}</SettingText>
            <SettingDescription>
              {t("screens.settings.playback.autoplay_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={autoplay}
            onValueChange={setAutoplay}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor={autoplay ? "#fff" : "#f4f3f4"}
          />
        </SettingRight>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.playback.mono_audio")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.playback.mono_audio_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={monoAudio}
            onValueChange={setMonoAudio}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor={monoAudio ? "#fff" : "#f4f3f4"}
          />
        </SettingRight>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.playback.equalizer")}
            </SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.playback.volume_normalization")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.playback.volume_normalization_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={volumeNormalization}
            onValueChange={setVolumeNormalization}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor={volumeNormalization ? "#fff" : "#f4f3f4"}
          />
        </SettingRight>
      </SettingItem>
    </SettingsSection>
  );

  const renderPrivacySettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.privacy.private_session")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.privacy.private_session_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={false}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.privacy.listening_activity")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.privacy.listening_activity_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={true}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.privacy.recently_played_artists")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.privacy.recently_played_artists_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={true}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.privacy.public_profile")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.privacy.public_profile_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={true}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
    </SettingsSection>
  );

  const renderNotificationsSettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.notifications.push_notifications")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.notifications.push_notifications_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={true}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.notifications.email_notifications")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.notifications.email_notifications_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={false}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.notifications.new_music_alerts")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.notifications.new_music_alerts_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={true}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.notifications.playlist_updates")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.notifications.playlist_updates_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={false}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
    </SettingsSection>
  );

  const renderDataSettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>{t("screens.settings.data.data_saver")}</SettingText>
            <SettingDescription>
              {t("screens.settings.data.data_saver_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={false}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.data.download_quality")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.data.download_quality_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.data.auto_download_playlists")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.data.auto_download_playlists_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={true}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Offline Mode</SettingText>
            <SettingDescription>
              Only play downloaded content
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={false}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
    </SettingsSection>
  );

  const renderQualitySettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Streaming Quality</SettingText>
            <SettingDescription>High quality for streaming</SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Download Quality</SettingText>
            <SettingDescription>High quality for downloads</SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Normalize Volume</SettingText>
            <SettingDescription>
              Consistent volume across tracks
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
        <SettingRight>
          <Switch
            value={true}
            onValueChange={() => {}}
            trackColor={{ false: "#767577", true: "#1DB954" }}
            thumbColor="#fff"
          />
        </SettingRight>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>{t("screens.settings.quality.equalizer")}</SettingText>
            <SettingDescription>
              {t("screens.settings.quality.equalizer_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
    </SettingsSection>
  );

  const renderSupportSettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.support.help_center")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.support.help_center_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>{t("screens.settings.support.community")}</SettingText>
            <SettingDescription>
              {t("screens.settings.support.community_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.support.app_version")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.support.app_version_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.support.terms_of_service")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.support.terms_of_service_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>
              {t("screens.settings.support.privacy_policy")}
            </SettingText>
            <SettingDescription>
              {t("screens.settings.support.privacy_policy_desc")}
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
    </SettingsSection>
  );

  return (
    <SafeArea>
      <Screen>
        <Header>
          <BackButton
            onPress={
              currentPage === "main"
                ? () => navigation.goBack()
                : handleBackToMain
            }
          >
            <Ionicons name="arrow-back" size={24} color="white" />
          </BackButton>
          <HeaderCenter>
            <HeaderTitle>{getHeaderTitle()}</HeaderTitle>
          </HeaderCenter>
          <SearchButton onPress={() => console.log("Search pressed")}>
            <Ionicons name="search" size={24} color="white" />
          </SearchButton>
        </Header>

        {currentPage === "main" && (
          <SettingsSection>
            {settingsConfig.map((setting) => (
              <SettingItem
                key={setting.id}
                onPressIn={() => setPressedButton(setting.id)}
                onPressOut={() => setPressedButton(null)}
                onPress={() => handleButtonPress(setting.id)}
                activeOpacity={1}
                style={{
                  backgroundColor:
                    pressedButton === setting.id ? "#333" : "transparent",
                }}
              >
                <SettingLeft>
                  <SettingIcon>
                    <Ionicons name={setting.icon} size={24} color="#fff" />
                  </SettingIcon>
                  <SettingContent>
                    <SettingText>{setting.title}</SettingText>
                    <SettingDescription>{setting.subtitle}</SettingDescription>
                  </SettingContent>
                </SettingLeft>
              </SettingItem>
            ))}
          </SettingsSection>
        )}

        {currentPage === "account" && renderAccountSettings()}
        {currentPage === "playback" && renderPlaybackSettings()}
        {currentPage === "privacy" && renderPrivacySettings()}
        {currentPage === "notifications" && renderNotificationsSettings()}
        {currentPage === "data" && renderDataSettings()}
        {currentPage === "quality" && renderQualitySettings()}
        {currentPage === "support" && renderSupportSettings()}
      </Screen>
    </SafeArea>
  );
}
