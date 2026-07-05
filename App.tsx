import "react-native-gesture-handler";
import React, { useEffect, useRef } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { enableScreens } from "react-native-screens";
import TrackPlayer from "./utils/safeTrackPlayer";
import {
  View,
  TouchableOpacity,
  Text,
  StatusBar,
  TextInput,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useFonts } from "expo-font";
// import { LoadingScreen } from "./components/LoadingScreen";

// Expo vector-icons
import { Ionicons } from "@expo/vector-icons";
import StreamifyLogoIcon from "./assets/StreamifyLogo.svg";
import LibraryIcon from "./assets/Library.svg";

// Context
import { PlayerProvider } from "./contexts/PlayerContext";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { ThemeProvider, useTheme, withOpacity } from "./contexts/ThemeContext";
import { usePlayer } from "./contexts/PlayerContext";
import { AuthProvider } from "./contexts/AuthContext";

// API
import { initializeDynamicInstances } from "./components/core/api";

// Components
import { MiniPlayer } from "./components/MiniPlayer";
import { FullPlayerModal } from "./components/FullPlayerModal";
import { CloudLibraryBridge } from "./components/CloudLibraryBridge";
import { useAppLanguage } from "./hooks/useAppLanguage";
import { getAppFontFamily } from "./utils/fonts";

// Screens
import HomeScreen from "./components/screens/HomeScreen";
import ListsScreen from "./components/screens/ListsScreen";
import SearchScreen from "./components/screens/SearchScreen";
import LibraryScreen from "./components/screens/LibraryScreen";
import { LikedSongsScreen } from "./components/screens/LikedSongsScreen";
import { PreviouslyPlayedScreen } from "./components/screens/PreviouslyPlayedScreen";
import { AlbumPlaylistScreen } from "./components/screens/AlbumPlaylistScreen";
import PlayerScreen from "./components/screens/PlayerScreen";
import ArtistScreen from "./components/screens/ArtistScreen";
import SettingsScreen from "./components/screens/SettingsScreen";
import SignInScreen from "./components/screens/SignInScreen";
import SignUpScreen from "./components/screens/SignUpScreen";

enableScreens();

class DebugStartupBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      hasError: true,
      message: error?.message || "Unknown startup error",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#111111",
            paddingHorizontal: 24,
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              textAlign: "center",
              fontSize: 16,
              lineHeight: 22,
            }}
          >
            {`Startup error: ${this.state.message}`}
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

// Register the playback service for proper media session integration
try {
  TrackPlayer.registerPlaybackService(() =>
    require("./services/playbackService")
  );
  console.log("[App] Playback service registered successfully");
} catch (error) {
  console.error("[App] Failed to register playback service:", error);
}

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/* ---------- Icon helper ---------- */
type IconProps = {
  name: string;
  color: string;
  size: number;
  focused?: boolean;
};
const TabBarIcon: React.FC<IconProps> = ({ name, color, size, focused }) => {
  if (name === "home") {
    return (
      <View style={{ opacity: focused ? 1 : 0.56 }}>
        <StreamifyLogoIcon width={22} height={22} />
      </View>
    );
  }

  if (name === "library") {
    return (
      <View style={{ opacity: focused ? 1 : 0.56 }}>
        <LibraryIcon width={22} height={22} />
      </View>
    );
  }

  return <Ionicons name="search" size={size} color={color} />;
};

/* ---------- Custom Tab Bar ---------- */
function CustomTabBar({ state, descriptors, navigation }: any) {
  const { colors } = useTheme();
  const { dir, isRtl } = useAppLanguage();

  return (
    <LinearGradient
      colors={[
        "rgba(0, 0, 0, 0.92)",
        "rgba(0, 0, 0, 0.52)",
        "rgba(0, 0, 0, 0.12)",
      ]}
      locations={[0, 0.56, 1]}
      start={{ x: 0, y: 1 }}
      end={{ x: 0, y: 0 }}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        paddingBottom: 6,
        paddingTop: 6,
      }}
    >
      <View
        style={{
          flexDirection: isRtl ? "row-reverse" : "row",
          flex: 1,
          alignItems: "center",
          justifyContent: "space-around",
          direction: dir,
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

          const color = isFocused ? colors.foreground : colors.muted;
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
              <TabBarIcon
                name={iconName}
                color={color}
                size={24}
                focused={isFocused}
              />
              <Text
                style={{
                  color,
                  fontSize: 12,
                  lineHeight: 16,
                  marginTop: 2,
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                  writingDirection: dir,
                  textAlign: "center",
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
  const { colors } = useTheme();
  const { t } = useAppLanguage();

  return (
    <Tab.Navigator
      id="HomeTabs"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
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
        options={{ title: t("navigation.home") }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ title: t("navigation.search") }}
      />
      <Tab.Screen
        name="Your Library"
        component={LibraryScreen}
        options={{ title: t("navigation.library") }}
      />
    </Tab.Navigator>
  );
}

function PlaybackPreferenceBridge() {
  const { currentTrack, showFullPlayer, setShowFullPlayer } = usePlayer();
  const { settings, hasHydratedSettings } = useSettings();
  const lastOpenedTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTrack?.id) {
      lastOpenedTrackIdRef.current = null;
      return;
    }

    if (!hasHydratedSettings || !settings.openFullscreenOnPlay) {
      lastOpenedTrackIdRef.current = currentTrack.id;
      return;
    }

    if (lastOpenedTrackIdRef.current === currentTrack.id) {
      return;
    }

    lastOpenedTrackIdRef.current = currentTrack.id;

    if (!showFullPlayer) {
      setShowFullPlayer(true);
    }
  }, [
    currentTrack?.id,
    hasHydratedSettings,
    setShowFullPlayer,
    settings.openFullscreenOnPlay,
    showFullPlayer,
  ]);

  return null;
}

function GlobalTextDefaultsBridge() {
  const { isRtl } = useAppLanguage();
  const baseTextStyleRef = useRef((Text as any).defaultProps?.style);
  const baseTextInputStyleRef = useRef((TextInput as any).defaultProps?.style);

  useEffect(() => {
    const defaultFontFamily = getAppFontFamily(isRtl, "regular");
    const TextAny: any = Text;
    const TextInputAny: any = TextInput;

    if (TextAny.defaultProps == null) {
      TextAny.defaultProps = {};
    }
    if (TextInputAny.defaultProps == null) {
      TextInputAny.defaultProps = {};
    }

    TextAny.defaultProps.style = [
      { fontFamily: defaultFontFamily },
      baseTextStyleRef.current,
    ].filter(Boolean);

    TextInputAny.defaultProps.style = [
      { fontFamily: defaultFontFamily },
      baseTextInputStyleRef.current,
    ].filter(Boolean);
  }, [isRtl]);

  return null;
}

function StartupLoadingScreen() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#101010",
        paddingHorizontal: 24,
      }}
    >
      <Image
        source={require("./assets/StreamifyLoading.png")}
        resizeMode="contain"
        style={{ width: 220, height: 220 }}
      />
    </View>
  );
}

function AppStartupGate({ children }: { children: React.ReactNode }) {
  const { hasHydratedSettings } = useSettings();

  if (!hasHydratedSettings) {
    return <StartupLoadingScreen />;
  }

  return <>{children}</>;
}

/* ---------- Root Stack ---------- */
function AppShell() {
  const { colors, isLight } = useTheme();
  const { dir } = useAppLanguage();
  const { showFullPlayer, setShowFullPlayer } = usePlayer();
  const navigationRef = React.useRef<any>(null);
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

  const syncCurrentScreen = React.useCallback((state?: any) => {
    const resolvedState = state ?? navigationRef.current?.getRootState?.();
    const screenName = getCurrentScreenName(resolvedState);
    console.log("[App] Detected screen name:", screenName);
    setCurrentScreen(screenName);
  }, []);

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, direction: dir }}
    >
      <StatusBar
        barStyle={isLight ? "dark-content" : "light-content"}
        backgroundColor={colors.background}
        translucent={true}
      />
      <NavigationContainer
        ref={navigationRef}
        onReady={() => syncCurrentScreen()}
        onStateChange={syncCurrentScreen}
      >
        <Stack.Navigator
          id="MainStack"
          initialRouteName="Home"
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            animationDuration: 200,
            contentStyle: { backgroundColor: colors.background },
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
              contentStyle: { backgroundColor: colors.background },
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
              contentStyle: { backgroundColor: colors.background },
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
              contentStyle: { backgroundColor: colors.background },
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
              contentStyle: { backgroundColor: colors.background },
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
              contentStyle: { backgroundColor: colors.background },
            }}
          />
          <Stack.Screen
            name="PlayerScreen"
            component={PlayerScreen}
            options={{
              animation: "slide_from_right",
              animationDuration: 200,
              gestureEnabled: true,
              gestureDirection: "horizontal",
              contentStyle: { backgroundColor: colors.background },
            }}
          />
          <Stack.Screen
            name="SignIn"
            component={SignInScreen}
            options={{
              animation: "slide_from_right",
              animationDuration: 200,
              gestureEnabled: true,
              gestureDirection: "horizontal",
              contentStyle: { backgroundColor: colors.background },
            }}
          />
          <Stack.Screen
            name="SignUp"
            component={SignUpScreen}
            options={{
              animation: "slide_from_right",
              animationDuration: 200,
              gestureEnabled: true,
              gestureDirection: "horizontal",
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>

      {/* Persistent Player Components */}
      <MiniPlayer
        onExpand={() => setShowFullPlayer(true)}
        currentScreen={currentScreen}
      />
      <FullPlayerModal
        visible={showFullPlayer}
        onClose={() => setShowFullPlayer(false)}
        onPlaylistUpdated={handlePlaylistUpdated}
      />
    </View>
  );
}

function AppContent() {
  return (
    <DebugStartupBoundary>
      <SettingsProvider>
        <AppStartupGate>
          <ThemeProvider>
            <AuthProvider>
              <PlayerProvider>
                <CloudLibraryBridge />
                <PlaybackPreferenceBridge />
                <GlobalTextDefaultsBridge />
                <AppShell />
              </PlayerProvider>
            </AuthProvider>
          </ThemeProvider>
        </AppStartupGate>
      </SettingsProvider>
    </DebugStartupBoundary>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    GoogleSansRegular: require("./assets/fonts/DMSans-Regular.ttf"),
    GoogleSansMedium: require("./assets/fonts/DMSans-Bold.ttf"),
    GoogleSansSemiBold: require("./assets/fonts/DMSans-Bold.ttf"),
    GoogleSansBold: require("./assets/fonts/DMSans-Black.ttf"),
    DMSansRegular: require("./assets/fonts/DMSans-Regular.ttf"),
    DMSansBold: require("./assets/fonts/DMSans-Bold.ttf"),
    DMSansBlack: require("./assets/fonts/DMSans-Black.ttf"),
    SpaceMonoRegular: require("./assets/fonts/SpaceMono-Regular.ttf"),
    YekanBakhRegular: require("./assets/fonts/YekanBakhRegular.ttf"),
    YekanBakhMedium: require("./assets/fonts/YekanBakhMedium.ttf"),
    YekanBakhBold: require("./assets/fonts/YekanBakhBold.ttf"),
    YekanBakhFat: require("./assets/fonts/YekanBakhFat.ttf"),
  });

  // Prime provider instances from runtime config on app startup.
  useEffect(() => {
    const fetchInstances = async () => {
      await initializeDynamicInstances();
    };

    fetchInstances();
  }, []);

  // const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // const [isLoadingComplete, setIsLoadingComplete] = useState(false);

  // Handle loading screen completion
  // const handleLoadingComplete = () => {
  //   setIsLoadingComplete(true);
  // };

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
    return <StartupLoadingScreen />;
  }

  return <AppContent />;
}
