import React, { useState } from "react";
import styled from "styled-components/native";
import { SafeArea } from "../SafeArea";
import { Ionicons } from "@expo/vector-icons";
import { clearSoundCloudCache } from "../../modules/audioStreaming";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 16px;
  border-bottom-width: 1px;
  border-bottom-color: #262626;
`;

const BackButton = styled.TouchableOpacity`
  padding: 8px;
  margin-right: 16px;
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

const SectionTitle = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
  margin-left: 16px;
  margin-bottom: 8px;
  font-family: GoogleSansSemiBold;
  line-height: 18px;
`;

const SettingItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background-color: #121212;
  border-bottom-width: 1px;
  border-bottom-color: #262626;
`;

const SettingLeft = styled.View`
  flex-direction: row;
  align-items: center;
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

const ChevronIcon = styled.Text`
  color: #a3a3a3;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

export default function SettingsScreen({ navigation }: { navigation: any }) {
  const [isClearingCache, setIsClearingCache] = useState(false);

  const handleClearCache = async () => {
    // For now, just clear cache without confirmation dialog
    // TODO: Fix Alert import issue
    setIsClearingCache(true);
    try {
      await clearSoundCloudCache();
      console.log("Cache cleared successfully!");
      // (Alert as any).alert("Success", "Cache cleared successfully!");
    } catch (error) {
      console.error("Failed to clear cache:", error);
      // (Alert as any).alert("Error", "Failed to clear cache. Please try again.");
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <SafeArea>
      <Screen>
        <Header>
          <BackButton onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </BackButton>
          <HeaderTitle>Settings</HeaderTitle>
        </Header>

        <SettingsSection>
          <SectionTitle>Storage</SectionTitle>
          <SettingItem onPress={handleClearCache} disabled={isClearingCache}>
            <SettingLeft>
              <SettingIcon>
                <Ionicons name="trash-outline" size={20} color="#a3a3a3" />
              </SettingIcon>
              <SettingContent>
                <SettingText>Clear Cache</SettingText>
                <SettingDescription>
                  Remove all cached audio files
                </SettingDescription>
              </SettingContent>
            </SettingLeft>
            <ChevronIcon>
              <Ionicons name="chevron-forward" size={16} color="#a3a3a3" />
            </ChevronIcon>
          </SettingItem>
        </SettingsSection>

        <SettingsSection>
          <SectionTitle>About</SectionTitle>
          <SettingItem>
            <SettingLeft>
              <SettingIcon>
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color="#a3a3a3"
                />
              </SettingIcon>
              <SettingContent>
                <SettingText>App Version</SettingText>
                <SettingDescription>1.0.0</SettingDescription>
              </SettingContent>
            </SettingLeft>
          </SettingItem>
        </SettingsSection>
      </Screen>
    </SafeArea>
  );
}
