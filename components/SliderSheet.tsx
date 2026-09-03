import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  PanResponder,
} from "react-native";
const { Animated, Easing } = require("react-native");
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useAppLanguage } from "../hooks/useAppLanguage";
import { useTheme, withOpacity } from "../hooks/useTheme";
import { getAppFontFamily, getTextDirectionStyle } from "../utils/fonts";

const FULL_HEIGHT = Dimensions.get("window").height;
const DRAG_CLOSE_THRESHOLD = 90;
const DRAG_CLOSE_VELOCITY = 0.8;

interface SheetOption {
  key: string;
  label: string;
  icon: string;
}

interface SliderSheetProps {
  visible: boolean;
  onClose: () => void;
  sheetTop?: any; // kept for API compat — ignored, animation is internal now
  sheetHeight?: number; // kept for API compat — ignored
  panHandlers?: any; // kept for API compat — ignored
  currentTrack: {
    title: string;
    artist?: string;
    thumbnail?: string;
  };
  options: SheetOption[];
  onOptionPress: (option: string) => void;
}

const SheetOverlay = styled(Animated.View)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
`;

const SheetTouchableOverlay = styled(TouchableOpacity)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
`;

const SheetContainer = styled(Animated.View)`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
`;

const SheetInner = styled.View`
  background-color: #000000;
  border-top-left-radius: 24px;
  border-top-right-radius: 24px;
  padding-bottom: 32px;
  overflow: hidden;
`;

const SheetHandle = styled.View`
  width: 40px;
  height: 4px;
  border-radius: 12px;
  background-color: #4b5563;
  align-self: center;
  margin-top: 8px;
  margin-bottom: 8px;
`;

const SheetGrabArea = styled.View`
  padding-top: 12px;
  padding-bottom: 12px;
`;

const SheetContent = styled.View`
  padding-vertical: 8px;
  padding-horizontal: 24px;
`;

const SheetHeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding-vertical: 16px;
  padding-horizontal: 24px;
`;

const SheetHeaderCoverImage = styled.Image`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
`;

const SheetHeaderCoverPlaceholder = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background-color: #333;
  margin-right: 12px;
  align-items: center;
  justify-content: center;
`;

const SheetHeaderTextContainer = styled.View`
  flex-direction: column;
  flex: 1;
`;

const SheetHeaderTitle = styled.Text`
  color: #ffffff;
  font-size: 16px;
  font-family: GoogleSansMedium;
  margin-bottom: 2px;
  line-height: 20px;
`;

const SheetHeaderArtist = styled.Text`
  color: #9ca3af;
  font-size: 14px;
  font-family: GoogleSansRegular;
  line-height: 18px;
`;

const SheetSeparator = styled.View`
  height: 1px;
  background-color: #374151;
  margin-horizontal: 24px;
`;

const SheetItem = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding-vertical: 12px;
`;

const SheetItemIconWrapper = styled.View`
  width: 32px;
  height: 32px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  margin-right: 16px;
`;

const SheetItemText = styled.Text`
  color: #ffffff;
  font-size: 16px;
  font-family: GoogleSansRegular;
  line-height: 20px;
`;

export const SliderSheet: React.FC<SliderSheetProps> = ({
  visible,
  onClose,
  currentTrack,
  options,
  onOptionPress,
}) => {
  const { colors } = useTheme();
  const { isRtl } = useAppLanguage();
  const translateY = useRef(new Animated.Value(FULL_HEIGHT)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const [renderModal, setRenderModal] = useState(false);

  // Draggable: follow the finger while dragging down, snap to open/close on release.
  // Uses onStartShouldSetPanResponder (not onMoveShouldSet...) so the grab
  // area claims the touch immediately on press — preventing the ScrollView
  // from stealing the gesture during the first 4px of movement.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_: any, gesture: any) => {
        const next = Math.max(0, gesture.dy);
        translateY.setValue(next);
      },
      onPanResponderRelease: (_: any, gesture: any) => {
        const shouldClose =
          gesture.dy > DRAG_CLOSE_THRESHOLD || gesture.vy > DRAG_CLOSE_VELOCITY;
        if (shouldClose) {
          Animated.timing(translateY, {
            toValue: FULL_HEIGHT,
            duration: 180,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: false,
          }).start(() => {
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: false,
            friction: 8,
            tension: 40,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: false,
          friction: 8,
          tension: 40,
        }).start();
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      setRenderModal(true);
      translateY.setValue(FULL_HEIGHT);
      overlayOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (renderModal) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: FULL_HEIGHT,
          duration: 260,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setRenderModal(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!renderModal) {
    return null;
  }

  const handleOptionPress = (option: string) => {
    onOptionPress(option);
    onClose();
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <>
        <SheetOverlay style={{ opacity: overlayOpacity }}>
          <SheetTouchableOverlay activeOpacity={1} onPress={onClose} />
        </SheetOverlay>
        <SheetContainer
          style={{
            transform: [{ translateY }],
          }}
        >
          <SheetInner
            style={{
              backgroundColor: colors.background,
            }}
          >
            <SheetGrabArea {...panResponder.panHandlers}>
              <SheetHandle
                style={{
                  backgroundColor: withOpacity(colors.foreground, 0.22),
                }}
              />
            </SheetGrabArea>
            <SheetHeaderRow
              style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
              {...panResponder.panHandlers}
            >
              {currentTrack.thumbnail ? (
                <SheetHeaderCoverImage
                  source={{ uri: currentTrack.thumbnail }}
                  style={
                    isRtl
                      ? { marginLeft: 12, marginRight: 0 }
                      : { marginRight: 12, marginLeft: 0 }
                  }
                />
              ) : (
                <SheetHeaderCoverPlaceholder
                  style={
                    isRtl
                      ? { backgroundColor: colors.surface2, marginLeft: 12, marginRight: 0 }
                      : { backgroundColor: colors.surface2, marginRight: 12, marginLeft: 0 }
                  }
                >
                  <Ionicons
                    name="musical-notes"
                    size={24}
                    color={colors.foreground}
                  />
                </SheetHeaderCoverPlaceholder>
              )}
              <SheetHeaderTextContainer>
                <SheetHeaderTitle
                  numberOfLines={1}
                  style={{
                    color: colors.foreground,
                    fontFamily: getAppFontFamily(isRtl, "medium"),
                    ...getTextDirectionStyle(isRtl),
                  }}
                >
                  {currentTrack.title}
                </SheetHeaderTitle>
                {currentTrack.artist && (
                  <SheetHeaderArtist
                    numberOfLines={1}
                    style={{
                      color: colors.muted,
                      fontFamily: getAppFontFamily(isRtl, "regular"),
                      ...getTextDirectionStyle(isRtl),
                    }}
                  >
                    {currentTrack.artist}
                  </SheetHeaderArtist>
                )}
              </SheetHeaderTextContainer>
            </SheetHeaderRow>
            <SheetSeparator style={{ backgroundColor: colors.borderSubtle }} />
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: FULL_HEIGHT * 0.68 }}
            >
              <SheetContent>
                {options.map((option) => (
                  <SheetItem
                    key={option.key}
                    onPress={() => handleOptionPress(option.key)}
                    style={{ flexDirection: isRtl ? "row-reverse" : "row" }}
                  >
                    <SheetItemIconWrapper
                      style={
                        isRtl
                          ? { marginLeft: 16, marginRight: 0, alignItems: "flex-end" }
                          : { marginRight: 16, marginLeft: 0, alignItems: "flex-start" }
                      }
                    >
                      <Ionicons
                        name={option.icon as any}
                        size={22}
                        color={colors.foreground}
                      />
                    </SheetItemIconWrapper>
                    <SheetItemText
                      style={{
                        color: colors.foreground,
                        fontFamily: getAppFontFamily(isRtl, "regular"),
                        ...getTextDirectionStyle(isRtl),
                      }}
                    >
                      {option.label}
                    </SheetItemText>
                  </SheetItem>
                ))}
              </SheetContent>
            </ScrollView>
          </SheetInner>
        </SheetContainer>
      </>
    </Modal>
  );
};
