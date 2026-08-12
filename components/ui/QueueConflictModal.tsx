import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Animated } from "react-native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, withOpacity } from "../../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../../utils/fonts";
import { useAppLanguage } from "../../hooks/useAppLanguage";

interface QueueConflictModalProps {
  visible: boolean;
  trackTitle: string;
  onCancel: () => void;
  onRemoveAndPlay: () => void;
}

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.65);
  justify-content: center;
  align-items: center;
  padding: 24px;
`;

const Dialog = styled(Animated.View)`
  width: 100%;
  max-width: 340px;
  border-radius: 18px;
  overflow: hidden;
  background-color: #1c1c1e;
`;

const IconCircle = styled.View`
  width: 52px;
  height: 52px;
  border-radius: 26px;
  justify-content: center;
  align-items: center;
  align-self: center;
  margin-top: 24px;
`;

const Title = styled.Text`
  font-size: 17px;
  font-weight: 600;
  text-align: center;
  margin-top: 14px;
  margin-bottom: 6px;
  padding-horizontal: 20px;
`;

const Subtitle = styled.Text`
  font-size: 14px;
  text-align: center;
  margin-bottom: 18px;
  padding-horizontal: 20px;
  line-height: 20px;
`;

const ButtonRow = styled.View`
  flex-direction: row;
  border-top-width: 1px;
`;

const Button = styled.TouchableOpacity`
  flex: 1;
  padding-vertical: 14px;
  align-items: center;
  justify-content: center;
`;

const ButtonText = styled.Text`
  font-size: 15px;
  font-weight: 600;
`;

export function QueueConflictModal({
  visible,
  trackTitle,
  onCancel,
  onRemoveAndPlay,
}: QueueConflictModalProps) {
  const { isRtl } = useAppLanguage();
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateAnim = useRef(new Animated.Value(50)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateAnim.setValue(50);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(translateAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(translateAnim, {
          toValue: -30,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setMounted(false);
      });
    }
  }, [visible]);

  const dialogStyle = {
    opacity: fadeAnim,
    transform: [{ translateY: translateAnim }],
  };

  return (
    <Modal
      visible={visible || mounted}
      transparent
      animationType="none"
      onRequestClose={onCancel}
    >
      <Overlay>
        <Dialog style={dialogStyle}>
          <IconCircle
            style={{ backgroundColor: withOpacity(colors.accent, 0.15) }}
          >
            <Ionicons
              name="cloud-download-outline"
              size={26}
              color={colors.accent}
            />
          </IconCircle>

          <Title
            style={{
              color: colors.foreground,
              fontFamily: getAppFontFamily(isRtl, "semibold"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            Song is downloading
          </Title>

          <Subtitle
            style={{
              color: withOpacity(colors.foreground, 0.6),
              fontFamily: getAppFontFamily(isRtl, "regular"),
              ...getTextDirectionStyle(isRtl),
            }}
          >
            "{trackTitle}" is in the download queue. Remove it from the queue
            and play?
          </Subtitle>

          <ButtonRow style={{ borderColor: colors.borderSubtle }}>
            <Button
              style={{
                backgroundColor: colors.surface2,
                borderRightWidth: 1,
                borderRightColor: colors.borderSubtle,
              }}
              onPress={onCancel}
              activeOpacity={0.8}
            >
              <ButtonText
                style={{
                  color: withOpacity(colors.foreground, 0.7),
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                }}
              >
                Cancel
              </ButtonText>
            </Button>
            <Button
              style={{ backgroundColor: colors.accent }}
              onPress={onRemoveAndPlay}
              activeOpacity={0.8}
            >
              <ButtonText
                style={{
                  color: "#fff",
                  fontFamily: getAppFontFamily(isRtl, "medium"),
                }}
              >
                Remove & Play
              </ButtonText>
            </Button>
          </ButtonRow>
        </Dialog>
      </Overlay>
    </Modal>
  );
}
