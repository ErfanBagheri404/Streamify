import React from "react";
import styled from "styled-components/native";

const NavContainer = styled.View`
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  background-color: #171717;
  padding: 16px 0;
  border-top-width: 1px;
  border-top-color: #262626;
`;

const NavButton = styled.TouchableOpacity<{ active?: boolean }>`
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 12px;
  background-color: ${(p: { active?: boolean }) =>
    p.active ? "#a3e635" : "transparent"};
`;

const NavIcon = styled.Text<{ active?: boolean }>`
  font-size: 24px;
  color: ${(p: { active?: boolean }) => (p.active ? "#000" : "#fff")};
  font-family: GoogleSansRegular;
  line-height: 24px;
`;

type BottomNavProps = {
  activeTab: "home" | "search" | "settings";
  onTabPress: (tab: "home" | "search" | "settings") => void;
};

export default function BottomNav({ activeTab, onTabPress }: BottomNavProps) {
  return (
    <NavContainer>
      <NavButton
        active={activeTab === "home"}
        onPress={() => onTabPress("home")}
      >
        <NavIcon active={activeTab === "home"}>🏠</NavIcon>
      </NavButton>

      <NavButton
        active={activeTab === "search"}
        onPress={() => onTabPress("search")}
      >
        <NavIcon active={activeTab === "search"}>🔍</NavIcon>
      </NavButton>

      <NavButton
        active={activeTab === "settings"}
        onPress={() => onTabPress("settings")}
      >
        <NavIcon active={activeTab === "settings"}>⚙️</NavIcon>
      </NavButton>
    </NavContainer>
  );
}
