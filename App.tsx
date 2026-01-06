import "react-native-gesture-handler";
import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";
import {
  View,
  TouchableOpacity,
  Text,
  StatusBar,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts } from "expo-font";
// import { LoadingScreen } from "./components/LoadingScreen";

// Expo vector-icons
import { Ionicons } from "@expo/vector-icons";
import { MaterialIcons } from "@expo/vector-icons";

// Context
import { PlayerProvider } from "./contexts/PlayerContext";

// Components
import { MiniPlayer } from "./components/MiniPlayer";
import { FullPlayerModal } from "./components/FullPlayerModal";

// Screens
import HomeScreen from "./components/screens/HomeScreen";
import ListsScreen from "./components/screens/ListsScreen";
import SearchScreen from "./components/screens/SearchScreen";
import LibraryScreen from "./components/screens/LibraryScreen";
import { LikedSongsScreen } from "./components/screens/LikedSongsScreen";
import { PreviouslyPlayedScreen } from "./components/screens/PreviouslyPlayedScreen";
import { AlbumPlaylistScreen } from "./components/screens/AlbumPlaylistScreen";
import ArtistScreen from "./components/screens/ArtistScreen";
import SettingsScreen from "./components/screens/SettingsScreen";

enableScreens();

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/* ---------- Icon helper ---------- */
type IconProps = { name: string; color: string; size: number };
const TabBarIcon: React.FC<IconProps> = ({ name, color, size }) => {
  // Map icon names to their respective libraries and icon names
  const iconMap: Record<
    string,
    { library: "Ionicons" | "MaterialIcons"; iconName: string }
  > = {
    home: { library: "Ionicons", iconName: "home-outline" },
    search: { library: "Ionicons", iconName: "search" },
    library: { library: "Ionicons", iconName: "library-outline" },
  };

  const iconConfig = iconMap[name] || { library: "Ionicons", iconName: "home" };

  if (iconConfig.library === "MaterialIcons") {
    return (
      <MaterialIcons
        name={iconConfig.iconName as keyof typeof MaterialIcons.glyphMap}
        size={size}
        color={color}
      />
    );
  } else {
    return (
      <Ionicons
        name={iconConfig.iconName as keyof typeof Ionicons.glyphMap}
        size={size}
        color={color}
      />
    );
  }
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

          const color = isFocused ? "#fff" : "#a3a3a3";
          const iconName =
            route.name === "HomeTab"
              ? "home"
              : route.name === "Search"
                ? "search"
                : "library";

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
                style={{
                  color,
                  fontSize: 12,
                  lineHeight: 16,
                  marginTop: 2,
                  fontFamily: "GoogleSansSemiBold",
                }}
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
      id="HomeTabs"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#a3e635",
        tabBarInactiveTintColor: "#a3a3a3",
        tabBarLabelStyle: {
          fontSize: 12,
          lineHeight: 16,
          fontFamily: "GoogleSansSemiBold",
        },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: "Home" }}
      />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Your Library" component={LibraryScreen} />
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

  const handlePlaylistUpdated = () => {
    console.log("[App] Playlist updated, triggering refresh");
    // This will be handled by the focus listener in LibraryScreen
  };

  // Track current screen name for MiniPlayer positioning
  const [currentScreen, setCurrentScreen] = React.useState<string>("Home");

  React.useEffect(() => {
    console.log("[App] Current screen updated:", currentScreen);
  }, [currentScreen]);

  // Check initial navigation state
  React.useEffect(() => {
    console.log("[App] Component mounted, checking initial state");
  }, []);

  const getCurrentScreenName = (state: any): string => {
    if (!state || !state.routes || state.routes.length === 0) {
      return "Home";
    }

    let currentRoute = state.routes[state.index];

    // Handle nested navigators (like tab navigators inside stack navigators)
    while (
      currentRoute.state &&
      currentRoute.state.routes &&
      currentRoute.state.routes.length > 0
    ) {
      currentRoute = currentRoute.state.routes[currentRoute.state.index];
    }

    return currentRoute.name || "Home";
  };

  const handleNavigationStateChange = (state: any) => {
    const screenName = getCurrentScreenName(state);
    console.log("[App] Detected screen name:", screenName);
    setCurrentScreen(screenName);
  };

  return (
    <PlayerProvider>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <StatusBar
          barStyle="light-content"
          backgroundColor="transparent"
          translucent={true}
        />
        <NavigationContainer onStateChange={handleNavigationStateChange}>
          <Stack.Navigator
            id="MainStack"
            initialRouteName="Home"
            screenOptions={{
              headerShown: false,
              animation: "slide_from_right",
              animationDuration: 200,
            }}
          >
            <Stack.Screen name="Home" component={HomeTabs} />
            <Stack.Screen name="Lists" component={ListsScreen} />
            <Stack.Screen
              name="LikedSongs"
              component={LikedSongsScreen}
              options={{
                animation: "slide_from_right",
                animationDuration: 200,
                gestureEnabled: true,
                gestureDirection: "horizontal",
                cardStyle: { backgroundColor: "#000" },
              }}
            />
            <Stack.Screen
              name="PreviouslyPlayed"
              component={PreviouslyPlayedScreen}
              options={{
                animation: "slide_from_right",
                animationDuration: 200,
                gestureEnabled: true,
                gestureDirection: "horizontal",
                cardStyle: { backgroundColor: "#000" },
              }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                animation: "slide_from_right",
                animationDuration: 200,
                gestureEnabled: true,
                gestureDirection: "horizontal",
                cardStyle: { backgroundColor: "#000" },
              }}
            />
            <Stack.Screen
              name="Artist"
              component={ArtistScreen}
              options={{
                animation: "slide_from_right",
                animationDuration: 200,
                gestureEnabled: true,
                gestureDirection: "horizontal",
                cardStyle: { backgroundColor: "#000" },
              }}
            />
            <Stack.Screen
              name="AlbumPlaylist"
              component={AlbumPlaylistScreen}
              options={{
                animation: "slide_from_right",
                animationDuration: 200,
                gestureEnabled: true,
                gestureDirection: "horizontal",
                cardStyle: { backgroundColor: "#000" },
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>

        {/* Persistent Player Components */}
        <MiniPlayer
          onExpand={handleExpandPlayer}
          currentScreen={currentScreen}
        />
        <FullPlayerModal
          visible={showFullPlayer}
          onClose={handleClosePlayer}
          onPlaylistUpdated={handlePlaylistUpdated}
        />
      </View>
    </PlayerProvider>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    GoogleSansRegular: require("./assets/fonts/GoogleSansRegular.ttf"),
    GoogleSansMedium: require("./assets/fonts/GoogleSansMedium.ttf"),
    GoogleSansSemiBold: require("./assets/fonts/GoogleSansSemiBold.ttf"),
    GoogleSansBold: require("./assets/fonts/GoogleSansBold.ttf"),
  });
  // const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // const [isLoadingComplete, setIsLoadingComplete] = useState(false);

  // Handle loading screen completion
  // const handleLoadingComplete = () => {
  //   setIsLoadingComplete(true);
  // };

  // Apply font styles when fonts are loaded
  if (fontsLoaded) {
    const TextAny: any = Text;
    const TextInputAny: any = TextInput;

    if (TextAny.defaultProps == null) {
      TextAny.defaultProps = {};
    }
    if (TextInputAny.defaultProps == null) {
      TextInputAny.defaultProps = {};
    }

    TextAny.defaultProps.style = [
      { fontFamily: "GoogleSansRegular" },
      TextAny.defaultProps.style,
    ].filter(Boolean);

    TextInputAny.defaultProps.style = [
      { fontFamily: "GoogleSansRegular" },
      TextInputAny.defaultProps.style,
    ].filter(Boolean);
  }

  // Show loading screen initially
  // if (showLoadingScreen && !isLoadingComplete) {
  //   return (
  //     <>
  //       <StatusBar
  //         barStyle="light-content"
  //         backgroundColor="transparent"
  //         translucent={true}
  //       />
  //       <LoadingScreen onLoadingComplete={handleLoadingComplete} />
  //     </>
  //   );
  // }

  // Hide loading screen after it's complete
  // useEffect(() => {
  //   if (isLoadingComplete) {
  //     setShowLoadingScreen(false);
  //   }
  // }, [isLoadingComplete]);

  // Show app content when fonts are loaded
  if (!fontsLoaded) {
    return null;
  }

  return <AppContent />;
}
