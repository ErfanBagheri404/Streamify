import React, { useState } from "react";
import styled from "styled-components/native";
import { SafeArea } from "../SafeArea";
import { Ionicons } from "@expo/vector-icons";
import { clearSoundCloudCache } from "../../modules/audioStreaming";
import { Switch, Image } from "react-native";
import Slider from "@react-native-community/slider";

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
    "https://via.placeholder.com/100",
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
        return "Account";
      case "playback":
        return "Playback";
      case "privacy":
        return "Privacy and Social";
      case "notifications":
        return "Notifications";
      case "data":
        return "Data-saving and offline";
      case "quality":
        return "Media quality";
      case "support":
        return "About and support";
      default:
        return "Settings";
    }
  };

  const renderAccountSettings = () => (
    <SettingsSection>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Account Details</SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingIcon>
            <Ionicons name="person-circle" size={48} color="#fff" />
          </SettingIcon>
          <SettingContent>
            <SettingText>Account Image</SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Username</SettingText>
            <SettingDescription>your_username</SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Email</SettingText>
            <SettingDescription>user@example.com</SettingDescription>
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
            <SettingText>Gapless Playback</SettingText>
            <SettingDescription>Play tracks without gaps</SettingDescription>
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
            <SettingText>Automix</SettingText>
            <SettingDescription>
              Automatically mix between songs
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
            <SettingText>Crossfade</SettingText>
            <SettingDescription>
              Smooth transition between tracks ({crossfadeValue}s)
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
            <SettingText>Listening Controls</SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Autoplay</SettingText>
            <SettingDescription>
              Continue playing similar music
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
            <SettingText>Mono Audio</SettingText>
            <SettingDescription>Combine audio channels</SettingDescription>
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
            <SettingText>Equalizer</SettingText>
          </SettingContent>
        </SettingLeft>
      </SettingItem>

      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Volume Normalization</SettingText>
            <SettingDescription>
              Consistent volume across tracks
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
            <SettingText>Private Session</SettingText>
            <SettingDescription>
              Start a private listening session
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
            <SettingText>Listening Activity</SettingText>
            <SettingDescription>
              Share what I'm listening to with followers
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
            <SettingText>Recently Played Artists</SettingText>
            <SettingDescription>
              Show recently played artists on profile
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
            <SettingText>Make my profile public</SettingText>
            <SettingDescription>
              Allow others to find and follow you
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
            <SettingText>Push Notifications</SettingText>
            <SettingDescription>
              Receive notifications on your device
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
            <SettingText>Email Notifications</SettingText>
            <SettingDescription>Get updates via email</SettingDescription>
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
            <SettingText>New Music Alerts</SettingText>
            <SettingDescription>
              Notifications for new releases
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
            <SettingText>Playlist Updates</SettingText>
            <SettingDescription>
              When playlists you follow are updated
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
            <SettingText>Data Saver</SettingText>
            <SettingDescription>
              Reduce data usage while streaming
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
            <SettingText>Download Quality</SettingText>
            <SettingDescription>
              Normal quality for downloads
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Auto-download Playlists</SettingText>
            <SettingDescription>
              Automatically download your playlists
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
            <SettingText>Equalizer</SettingText>
            <SettingDescription>Custom audio settings</SettingDescription>
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
            <SettingText>Help Center</SettingText>
            <SettingDescription>
              Find answers to common questions
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Community</SettingText>
            <SettingDescription>Connect with other users</SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>App Version</SettingText>
            <SettingDescription>Version 1.0.0</SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Terms of Service</SettingText>
            <SettingDescription>
              Read our terms and conditions
            </SettingDescription>
          </SettingContent>
        </SettingLeft>
      </SettingItem>
      <SettingItem>
        <SettingLeft>
          <SettingContent>
            <SettingText>Privacy Policy</SettingText>
            <SettingDescription>
              Learn how we protect your data
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
