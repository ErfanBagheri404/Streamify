import React from "react";
import { View, TouchableOpacity, ScrollView } from "react-native";
import styled from "styled-components/native";

// Enhanced badge system with modern design
const BadgeContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px 0;
`;

const Badge = styled.TouchableOpacity<{ active?: boolean; category?: string }>`
  padding: 12px 16px;
  border-radius: 24px;
  background-color: ${(props) => {
    if (props.active) {
      switch (props.category) {
        case "indie":
          return "#8B5CF6";
        case "edm":
          return "#06B6D4";
        case "metal":
          return "#DC2626";
        case "punk":
          return "#F59E0B";
        case "party":
          return "#EC4899";
        case "jazz":
          return "#10B981";
        case "love":
          return "#EF4444";
        case "rap":
          return "#7C3AED";
        case "workout":
          return "#F59E0B";
        case "pop":
          return "#3B82F6";
        case "hiphop":
          return "#8B5CF6";
        case "rock":
          return "#DC2626";
        case "melody":
          return "#06B6D4";
        case "lofi":
          return "#6B7280";
        case "chill":
          return "#10B981";
        case "focus":
          return "#3B82F6";
        case "instrumental":
          return "#8B5CF6";
        case "folk":
          return "#059669";
        case "devotional":
          return "#F59E0B";
        case "ambient":
          return "#6366F1";
        case "sleep":
          return "#1E293B";
        case "soul":
          return "#DC2626";
        default:
          return "#a3e635";
      }
    }
    return "#1a1a1a";
  }};
  border: 1px solid ${(props) => (props.active ? "transparent" : "#333")};
  elevation: ${(props) => (props.active ? "4" : "0")};
  shadow-color: #000;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.25;
  shadow-radius: 4px;
  transform: ${(props) => (props.active ? "scale(1.05)" : "scale(1)")};
`;

const BadgeContent = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
`;

const BadgeIcon = styled.Text`
  font-size: 16px;
  margin-right: 6px;
`;

const BadgeText = styled.Text<{ active?: boolean }>`
  color: ${(props) => (props.active ? "#000" : "#fff")};
  font-size: 13px;
  text-transform: capitalize;
  font-family: GoogleSansSemiBold;
  line-height: 17px;
`;

const BadgeCount = styled.Text<{ active?: boolean }>`
  color: ${(props) => (props.active ? "#000" : "#a3a3a3")};
  font-size: 11px;
  margin-left: 4px;
  background-color: ${(props) =>
    props.active ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)"};
  padding: 2px 6px;
  border-radius: 10px;
  font-family: GoogleSansMedium;
  line-height: 15px;
`;

const CategoryEmoji = {
  indie: "🎸",
  edm: "🎧",
  metal: "🤘",
  punk: "🎤",
  party: "🎉",
  jazz: "🎺",
  love: "💕",
  rap: "🎙️",
  workout: "💪",
  pop: "🎵",
  hiphop: "🎶",
  rock: "🎸",
  melody: "🎼",
  lofi: "🌙",
  chill: "😌",
  focus: "🎯",
  instrumental: "🎹",
  folk: "🌾",
  devotional: "🙏",
  ambient: "🌌",
  sleep: "😴",
  soul: "🎤",
};

interface CategoryBadgeProps {
  categories: string[];
  selectedCategories: string[];
  onToggleCategory: (category: string) => void;
  playlistCounts?: { [key: string]: number };
  showCounts?: boolean;
}

export const CategoryBadges: React.FC<CategoryBadgeProps> = ({
  categories,
  selectedCategories,
  onToggleCategory,
  playlistCounts = {},
  showCounts = true,
}) => {
  return (
    <BadgeContainer>
      {categories.map((category) => (
        <Badge
          key={category}
          active={selectedCategories.includes(category)}
          category={category}
          onPress={() => onToggleCategory(category)}
        >
          <BadgeContent>
            <BadgeIcon>
              {CategoryEmoji[category as keyof typeof CategoryEmoji]}
            </BadgeIcon>
            <BadgeText active={selectedCategories.includes(category)}>
              {category}
            </BadgeText>
            {showCounts && playlistCounts[category] && (
              <BadgeCount active={selectedCategories.includes(category)}>
                {playlistCounts[category]}
              </BadgeCount>
            )}
          </BadgeContent>
        </Badge>
      ))}
    </BadgeContainer>
  );
};

// Enhanced badge header component
const BadgeHeaderContainer = styled.View`
  background-color: #0a0a0a;
  padding: 20px;
  border-bottom-width: 1px;
  border-bottom-color: #1a1a1a;
`;

const BadgeHeaderTitle = styled.Text`
  color: #fff;
  font-size: 24px;
  margin-bottom: 8px;
  letter-spacing: -0.5px;
  font-family: GoogleSansBold;
  line-height: 28px;
`;

const BadgeHeaderSubtitle = styled.Text`
  color: #a3a3a3;
  font-size: 14px;
  margin-bottom: 16px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const BadgeHeaderStats = styled.View`
  flex-direction: row;
  gap: 16px;
  margin-top: 8px;
`;

const BadgeStat = styled.View`
  flex-direction: row;
  align-items: center;
`;

const BadgeStatText = styled.Text`
  color: #a3e635;
  font-size: 12px;
  margin-left: 4px;
  font-family: GoogleSansSemiBold;
  line-height: 16px;
`;

interface BadgeHeaderProps {
  title?: string;
  subtitle?: string;
  selectedCategories: string[];
  totalCategories: number;
  onClearAll?: () => void;
  onSelectAll?: () => void;
}

export const BadgeHeader: React.FC<BadgeHeaderProps> = ({
  title = "Browse by Mood",
  subtitle = "Tap badges to explore different music genres",
  selectedCategories,
  totalCategories,
  onClearAll,
  onSelectAll,
}) => {
  return (
    <BadgeHeaderContainer>
      <BadgeHeaderTitle>{title}</BadgeHeaderTitle>
      <BadgeHeaderSubtitle>{subtitle}</BadgeHeaderSubtitle>
      <BadgeHeaderStats>
        <BadgeStat>
          <BadgeStatText>🎯 {selectedCategories.length} selected</BadgeStatText>
        </BadgeStat>
        <BadgeStat>
          <BadgeStatText>📊 {totalCategories} categories</BadgeStatText>
        </BadgeStat>
        {selectedCategories.length > 0 && onClearAll && (
          <TouchableOpacity onPress={onClearAll}>
            <BadgeStatText>🗑️ Clear all</BadgeStatText>
          </TouchableOpacity>
        )}
        {selectedCategories.length < totalCategories && onSelectAll && (
          <TouchableOpacity onPress={onSelectAll}>
            <BadgeStatText>✨ Select all</BadgeStatText>
          </TouchableOpacity>
        )}
      </BadgeHeaderStats>
    </BadgeHeaderContainer>
  );
};

export default CategoryBadges;
