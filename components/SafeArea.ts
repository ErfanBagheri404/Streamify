import { View, StatusBar } from "react-native";
import styled from "styled-components/native";

export const SafeArea = styled(View)`
  flex: 1;
  margin-top: ${() => (StatusBar.currentHeight || 0) + 10}px;
  padding-bottom: 0; /* Remove bottom padding for tab screens */
  background-color: #000; /* Assuming a black background, change if needed */
`;
