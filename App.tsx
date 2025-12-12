import "react-native-gesture-handler";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";
import { Text } from "react-native";

// Import your screens
import HomeScreen from "./components/screens/HomeScreen";
import ListsScreen from "./components/screens/ListsScreen";
import PlayerScreen from "./components/screens/PlayerScreen";
import DownloadsScreen from "./components/screens/DownloadsScreen";
import SearchScreen from "./components/screens/SearchScreen";
import SettingsScreen from "./components/screens/SettingsScreen";

enableScreens();

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// This custom icon component remains the same
function TabBarIcon({
  name,
  color,
  size,
}: {
  name: string;
  color: string;
  size: number;
}) {
  const icons: { [key: string]: string } = {
    home: "🏠",
    search: "🔍",
    settings: "⚙️",
  };
  return <Text style={{ fontSize: size, color }}>{icons[name] || "🏠"}</Text>;
}

// Your Tab Navigator remains the same
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
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// Your main App component now only contains the navigators
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
        <Stack.Screen name="Downloads" component={DownloadsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
