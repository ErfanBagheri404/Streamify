import "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { enableScreens } from "react-native-screens";
import { SafeAreaView } from "react-native";
import HomeScreen from "./components/screens/HomeScreen";
import ListsScreen from "./components/screens/ListsScreen";
import PlayerScreen from "./components/screens/PlayerScreen";
import DownloadsScreen from "./components/screens/DownloadsScreen";
import styled from "styled-components/native";

enableScreens();
const Stack = createNativeStackNavigator();

const SafeArea = styled(SafeAreaView)`
  flex: 1;
`;

export default function App() {
  return (
    <NavigationContainer>
      <SafeArea>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Lists" component={ListsScreen} />
          <Stack.Screen name="Player" component={PlayerScreen} />
          <Stack.Screen name="Downloads" component={DownloadsScreen} />
        </Stack.Navigator>
      </SafeArea>
    </NavigationContainer>
  );
}
