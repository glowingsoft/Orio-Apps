/**
 * ORIO luxury pager arrow: a faceted gold chevron inside a slim
 * diamond-cut frame with a tiny jewel accent. Fixed colours (sits on artwork).
 */
import React from "react";
import Svg, { Defs, LinearGradient, Stop, Path, G } from "react-native-svg";

export function LuxArrow({ direction, size = 40 }: { direction: "left" | "right"; size?: number }) {
  const flip = direction === "left" ? "translate(48,0) scale(-1,1)" : undefined;
  return (
    <Svg width={size} height={size * 1.4} viewBox="0 0 48 68">
      <Defs>
        <LinearGradient id="luxGold" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFF6C8" />
          <Stop offset="0.45" stopColor="#F2C94C" />
          <Stop offset="1" stopColor="#A86B08" />
        </LinearGradient>
        <LinearGradient id="luxFrame" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
          <Stop offset="1" stopColor="#F2C94C" stopOpacity="0.15" />
        </LinearGradient>
      </Defs>
      <G transform={flip}>
        {/* diamond-cut frame */}
        <Path d="M24 4 L44 34 L24 64 L4 34 Z" fill="rgba(0,0,0,0.35)" stroke="url(#luxFrame)" strokeWidth={1.2} />
        {/* faceted chevron (pointing right) */}
        <Path d="M17 18 L32 34 L17 50 L21 50 L36 34 L21 18 Z" fill="url(#luxGold)" />
        <Path d="M21 18 L36 34 L32 34 L17 18 Z" fill="#FFFBE6" fillOpacity={0.55} />
        {/* jewel accent */}
        <Path d="M40 34 L42 31.5 L44 34 L42 36.5 Z" fill="#FFF6C8" />
      </G>
    </Svg>
  );
}
