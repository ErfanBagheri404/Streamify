import { View, StatusBar } from "react-native";
import styled from "styled-components/native";

export const SafeArea = styled(View)`
  flex: 1;
  padding-top: ${() => StatusBar.currentHeight || 0}px;
  padding-bottom: 0; /* Remove bottom padding - handled in scrollable content */
  background-color: #000; /* Assuming a black background, change if needed */
`;
