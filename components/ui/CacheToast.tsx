import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, Platform, StatusBar } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../hooks/useTheme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const ToastContainer = styled(Animated.View)<{ top: number }>`
  position: absolute;
  top: ${(props) => props.top}px;
  align-self: center;
  max-width: ${SCREEN_WIDTH - 48}px;
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
  border-radius: 14px;
  elevation: 8;
  shadow-color: #000;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.25;
  shadow-radius: 6px;
`;

const ToastText = styled.Text`
  color: #fff;
  font-size: 13px;
  font-family: GoogleSansMedium;
  flex: 1;
  margin-left: 10px;
`;

export interface CacheToastProps {
  visible: boolean;
  message: string;
  onHide: () => void;
}

export const CacheToast: React.FC<CacheToastProps> = ({
  visible,
  message,
  onHide,
}) => {
  const { colors } = useTheme();
  const topOffset = (StatusBar.currentHeight || 47) + 10;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible && message) {
      // Show
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();

      // Auto-hide after 2s
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }).start(() => onHide());
      }, 2000);
    }

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [visible, message]);

  if (!visible || !message) return null;

  return (
    <ToastContainer
      top={topOffset}
      style={{
        opacity,
        backgroundColor: colors.accent,
      }}
    >
      <Ionicons name="checkmark-circle" size={18} color="#fff" />
      <ToastText>{message}</ToastText>
    </ToastContainer>
  );
};
