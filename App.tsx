import "react-native-gesture-handler";
import React, { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";
import { View, TouchableOpacity, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// Expo vector-icons
import { Ionicons } from "@expo/vector-icons";

// Context
import { PlayerProvider } from "./contexts/PlayerContext";

// Components
import { MiniPlayer } from "./components/MiniPlayer";
import { FullPlayerModal } from "./components/FullPlayerModal";

// Screens
import HomeScreen from "./components/screens/HomeScreen";
import ListsScreen from "./components/screens/ListsScreen";
import SearchScreen from "./components/screens/SearchScreen";
import SettingsScreen from "./components/screens/SettingsScreen";

enableScreens();

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/* ---------- Icon helper ---------- */
type IconProps = { name: string; color: string; size: number };
const TabBarIcon: React.FC<IconProps> = ({ name, color, size }) => {
  const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
    home: "home",
    search: "search",
    settings: "settings-sharp",
  };
  return <Ionicons name={iconMap[name] || "home"} size={size} color={color} />;
};

/* ---------- Custom Tab Bar with Gradient ---------- */
function CustomTabBar({ state, descriptors, navigation }: any) {
  return (
    <LinearGradient
      colors={[
        "rgba(0, 0, 0, 0.1)", // Top: 10% transparent
        "rgba(0, 0, 0, 0.8)", // Middle: 30% transparent
        "rgba(0, 0, 0, 1)", // Bottom: 50% transparent
      ]} // Gradient from top (10%) to bottom (50%) transparent dark
      start={{ x: 0, y: 0 }} // Start from top
      end={{ x: 0, y: 1 }} // End at bottom
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        paddingBottom: 6,
        paddingTop: 6,
        // Shadow properties for top border blending
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -3 }, // Negative height for top shadow
        shadowOpacity: 0.4,
        shadowRadius: 6,
        elevation: 8, // Android shadow
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flex: 1,
          alignItems: "center",
          justifyContent: "space-around",
        }}
      >
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const label =
            options.tabBarLabel !== undefined
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;

          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: "tabLongPress",
              target: route.key,
            });
          };

          const color = isFocused ? "#a3e635" : "#a3a3a3";
          const iconName =
            route.name === "HomeTab"
              ? "home"
              : route.name === "Search"
              ? "search"
              : "settings";

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TabBarIcon name={iconName} color={color} size={24} />
              <Text
                style={{ color, fontSize: 12, fontWeight: "600", marginTop: 2 }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </LinearGradient>
  );
}

/* ---------- Bottom Tabs ---------- */
function HomeTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#a3e635",
        tabBarInactiveTintColor: "#a3a3a3",
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: "Home" }}
      />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

/* ---------- Root Stack ---------- */
function AppContent() {
  const [showFullPlayer, setShowFullPlayer] = useState(false);

  const handleExpandPlayer = () => {
    setShowFullPlayer(true);
  };

  const handleClosePlayer = () => {
    setShowFullPlayer(false);
  };

  return (
    <PlayerProvider>
      <View style={{ flex: 1 }}>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Home" component={HomeTabs} />
            <Stack.Screen name="Lists" component={ListsScreen} />
          </Stack.Navigator>
        </NavigationContainer>

        {/* Persistent Player Components */}
        <MiniPlayer onExpand={handleExpandPlayer} />
        <FullPlayerModal visible={showFullPlayer} onClose={handleClosePlayer} />
      </View>
    </PlayerProvider>
  );
}

export default function App() {
  return <AppContent />;
}
