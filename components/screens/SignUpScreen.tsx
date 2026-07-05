import React from "react";
import AuthScreen from "./AuthScreen";

export default function SignUpScreen({ navigation }: { navigation: any }) {
  return <AuthScreen navigation={navigation} mode="signup" />;
}
