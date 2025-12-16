import "react-native-gesture-handler";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";

// Expo vector-icons
import { Ionicons } from "@expo/vector-icons";

// Screens
import HomeScreen from "./components/screens/HomeScreen";
import ListsScreen from "./components/screens/ListsScreen";
import PlayerScreen from "./components/screens/PlayerScreen";
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

/* ---------- Bottom Tabs ---------- */
function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, size }) => {
          let iconName = "";
          if (route.name === "HomeTab") iconName = "home";
          else if (route.name === "Search") iconName = "search";
          else if (route.name === "Settings") iconName = "settings";
          else if (route.name === "Player") iconName = "play";
          return <TabBarIcon name={iconName} color={color} size={size} />;
        },
        tabBarActiveTintColor: "#a3e635",
        tabBarInactiveTintColor: "#a3a3a3",
        tabBarStyle: {
          backgroundColor: "#171717",
          borderTopColor: "#262626",
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 8,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: "Home" }}
      />
      <Tab.Screen name="Player" component={PlayerScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

/* ---------- Root Stack ---------- */
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Home" component={HomeTabs} />
        <Stack.Screen name="Lists" component={ListsScreen} />
        <Stack.Screen name="Player" component={PlayerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}