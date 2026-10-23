import React from "react";
import { View, ViewStyle, StyleProp } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Circle, Path, Ellipse, G } from "react-native-svg";

/**
 * ORIO logo — futuristic 3D "O" with orbital ring and premium crown.
 * Blue/violet lighting with soft neon glow on dark background.
 */
export function OrioLogo({ size = 96, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id="glow" cx="0.5" cy="0.5" rx="0.6" ry="0.6">
            <Stop offset="0" stopColor="#8B5CF6" stopOpacity="0.55" />
            <Stop offset="0.6" stopColor="#4C1D95" stopOpacity="0.25" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="ring_outer" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7DD8FF" />
            <Stop offset="0.5" stopColor="#4EB9F5" />
            <Stop offset="1" stopColor="#1E7ED1" />
          </LinearGradient>
          <LinearGradient id="ring_inner_dark" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#0A2E5C" />
            <Stop offset="1" stopColor="#01050D" />
          </LinearGradient>
          <LinearGradient id="crown_gold" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#E9D5FF" />
            <Stop offset="0.5" stopColor="#9B6CFF" />
            <Stop offset="1" stopColor="#4B0082" />
          </LinearGradient>
          <RadialGradient id="crown_gem" cx="0.5" cy="0.4" rx="0.6" ry="0.6">
            <Stop offset="0" stopColor="#E5FBFF" />
            <Stop offset="0.5" stopColor="#4EB9F5" />
            <Stop offset="1" stopColor="#1E3A8A" />
          </RadialGradient>
          <LinearGradient id="orbit" x1="0" y1="0.5" x2="1" y2="0.5">
            <Stop offset="0" stopColor="#8B5CF6" stopOpacity="0.1" />
            <Stop offset="0.5" stopColor="#4EB9F5" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#8B5CF6" stopOpacity="0.1" />
          </LinearGradient>
        </Defs>

        {/* Ambient glow */}
        <Circle cx="100" cy="105" r="95" fill="url(#glow)" />

        {/* Orbital ring behind O (tilted ellipse) */}
        <G opacity="0.9">
          <Ellipse cx="100" cy="112" rx="82" ry="24" stroke="url(#orbit)" strokeWidth="2" fill="none" />
        </G>

        {/* Outer O ring */}
        <Circle cx="100" cy="112" r="58" fill="url(#ring_outer)" />
        {/* Inner dark hole */}
        <Circle cx="100" cy="112" r="40" fill="url(#ring_inner_dark)" />
        {/* Highlight on top-left of O */}
        <Path d="M 62 96 A 45 45 0 0 1 122 74 L 118 82 A 40 40 0 0 0 68 102 Z" fill="#FFFFFF" opacity="0.35" />

        {/* Orbital ring in front (bottom half) */}
        <Path d="M 18 112 A 82 24 0 0 0 182 112" stroke="url(#orbit)" strokeWidth="2.5" fill="none" opacity="0.95" />

        {/* Crown, aligned above the O */}
        <G>
          {/* Base band */}
          <Path d="M 62 46 L 138 46 L 134 58 L 66 58 Z" fill="url(#crown_gold)" stroke="#8B5A00" strokeWidth="1" />
          {/* Left spike */}
          <Path d="M 62 46 L 68 20 L 82 40 L 78 46 Z" fill="url(#crown_gold)" stroke="#8B5A00" strokeWidth="1" />
          {/* Right spike */}
          <Path d="M 138 46 L 132 20 L 118 40 L 122 46 Z" fill="url(#crown_gold)" stroke="#8B5A00" strokeWidth="1" />
          {/* Center spike (taller) */}
          <Path d="M 82 40 L 100 10 L 118 40 L 108 46 L 92 46 Z" fill="url(#crown_gold)" stroke="#8B5A00" strokeWidth="1" />
          {/* Center gem */}
          <Circle cx="100" cy="30" r="7" fill="url(#crown_gem)" stroke="#FFF" strokeWidth="0.5" opacity="0.95" />
          {/* Small side gems */}
          <Circle cx="72" cy="52" r="2.5" fill="#4EB9F5" />
          <Circle cx="128" cy="52" r="2.5" fill="#4EB9F5" />
        </G>

        {/* Sparkle accents */}
        <Circle cx="40" cy="70" r="1.5" fill="#FFFFFF" opacity="0.8" />
        <Circle cx="165" cy="88" r="1.2" fill="#FFFFFF" opacity="0.7" />
        <Circle cx="150" cy="150" r="1" fill="#8B5CF6" opacity="0.9" />
      </Svg>
    </View>
  );
}
