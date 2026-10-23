/**
 * ORIO exclusive ranking flame — sculpted crimson 3D flame (layered SVG
 * gradients for depth + highlights), gently animated (breathing flicker).
 * Used by Global Ranking and Room Ranking.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Path, Ellipse } from "react-native-svg";

export function FlameBadge({ size = 16 }: { size?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [v]);
  const scaleY = v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const scaleX = v.interpolate({ inputRange: [0, 1], outputRange: [1.03, 0.97] });
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ["-2deg", "2deg"] });
  return (
    <View style={{ width: size, height: size * 1.25, alignItems: "center", justifyContent: "flex-end" }} testID="rank-flame">
      <Animated.View style={{ transform: [{ translateY: size * 0.06 }, { scaleX }, { scaleY }, { rotate }, { translateY: -size * 0.06 }] }}>
        <Svg width={size} height={size * 1.25} viewBox="0 0 40 50">
          <Defs>
            <LinearGradient id="fOuter" x1="0.2" y1="0" x2="0.8" y2="1">
              <Stop offset="0" stopColor="#FF4D5E" />
              <Stop offset="0.45" stopColor="#D0102B" />
              <Stop offset="1" stopColor="#6E0015" />
            </LinearGradient>
            <LinearGradient id="fMid" x1="0.3" y1="0" x2="0.7" y2="1">
              <Stop offset="0" stopColor="#FF8A8F" />
              <Stop offset="0.6" stopColor="#E3223B" />
              <Stop offset="1" stopColor="#9E0A22" />
            </LinearGradient>
            <RadialGradient id="fCore" cx="0.5" cy="0.7" r="0.6">
              <Stop offset="0" stopColor="#FFE3E3" />
              <Stop offset="0.5" stopColor="#FF6B77" />
              <Stop offset="1" stopColor="#E3223B" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="fShade" cx="0.5" cy="1" r="0.5">
              <Stop offset="0" stopColor="#3D0009" stopOpacity="0.55" />
              <Stop offset="1" stopColor="#3D0009" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          {/* Outer sculpted body */}
          <Path d="M20 2 C23 10 33 15 34 28 C35 40 28 48 20 48 C12 48 5 41 6 30 C6.5 23 10 19 13 15 C13.5 20 15.5 23 18 24 C16 16 17 8 20 2 Z" fill="url(#fOuter)" />
          {/* Mid layer — depth */}
          <Path d="M21 14 C24 20 29 24 29 32 C29 40 25 45 20 45 C15 45 11 41 11.5 34 C12 29 14.5 26 16.5 23.5 C17 27 18.5 29 20.5 29.5 C19 24 19.5 19 21 14 Z" fill="url(#fMid)" />
          {/* Hot core */}
          <Ellipse cx="20.5" cy="37" rx="6.5" ry="8" fill="url(#fCore)" />
          {/* Specular highlights */}
          <Path d="M14 22 C12 26 11.5 31 13 35" stroke="#FFC2C7" strokeOpacity={0.7} strokeWidth={1.4} strokeLinecap="round" fill="none" />
          <Path d="M21 6 C20 10 20.3 13 21.5 16" stroke="#FFD6D9" strokeOpacity={0.6} strokeWidth={1} strokeLinecap="round" fill="none" />
          {/* Base shading */}
          <Ellipse cx="20" cy="46" rx="12" ry="3" fill="url(#fShade)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
