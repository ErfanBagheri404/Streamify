import React from "react";
import { ScrollView } from "react-native";
import styled from "styled-components/native";

const Screen = styled.View`
  flex: 1;
  background-color: #000;
`;

const Header = styled.View`
  padding: 16px;
  border-bottom-width: 1px;
  border-bottom-color: #262626;
`;

const HeaderTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  font-weight: 600;
`;

const SettingsSection = styled.View`
  padding: 16px;
  border-bottom-width: 1px;
  border-bottom-color: #262626;
`;

const SectionTitle = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
  margin-bottom: 12px;
  text-transform: uppercase;
`;

const SettingItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
`;

const SettingLabel = styled.Text`
  color: #fff;
  font-size: 16px;
`;

const SettingValue = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
`;

const SettingIcon = styled.Text`
  color: #a3a3a3;
  font-size: 20px;
  margin-right: 12px;
`;

const SettingLeft = styled.View`
  flex-direction: row;
  align-items: center;
`;

export default function SettingsScreen() {
  const settings = [
    {
      title: "Account",
      items: [
        { label: "Profile", value: "John Smith", icon: "👤" },
        { label: "Subscription", value: "Premium", icon: "💎" },
      ],
    },
    {
      title: "Preferences",
      items: [
        { label: "Audio Quality", value: "High", icon: "🎵" },
        { label: "Downloads", value: "WiFi only", icon: "📥" },
        { label: "Notifications", value: "Enabled", icon: "🔔" },
      ],
    },
    {
      title: "General",
      items: [
        { label: "Language", value: "English", icon: "🌐" },
        { label: "Theme", value: "Dark", icon: "🎨" },
        { label: "About", value: "Version 1.0.0", icon: "ℹ️" },
      ],
    },
  ];

  return (
    <Screen>
      <Header>
        <HeaderTitle>Settings</HeaderTitle>
      </Header>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {settings.map((section, sectionIndex) => (
          <SettingsSection key={sectionIndex}>
            <SectionTitle>{section.title}</SectionTitle>
            {section.items.map((item, itemIndex) => (
              <SettingItem key={itemIndex}>
                <SettingLeft>
                  <SettingIcon>{item.icon}</SettingIcon>
                  <SettingLabel>{item.label}</SettingLabel>
                </SettingLeft>
                <SettingValue>{item.value}</SettingValue>
              </SettingItem>
            ))}
          </SettingsSection>
        ))}
      </ScrollView>
    </Screen>
  );
}
