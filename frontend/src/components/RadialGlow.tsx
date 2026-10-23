/**
 * Permanent, static soft radial glow (no movement / pulsing).
 * Used behind the top badge tiers (VIP8–10, Wealth/Charm last 3).
 * `strong` → much brighter core + soft radial light streaks fading outward
 * into the background (VIP8–VIP10).
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Defs, RadialGradient, Stop, Rect, Path, G } from "react-native-svg";

const RAYS = 18;

export function RadialGlow({ color, size, id, strong }: { color: string; size: number; id: string; strong?: boolean }) {
  const gid = `glow-${id}`;
  const rid = `rays-${id}`;
  const c = size / 2;
  // Thin wedges from the centre; alternating lengths for an elegant burst.
  const rays = strong
    ? Array.from({ length: RAYS }, (_, k) => {
        const a = (k / RAYS) * Math.PI * 2;
        const len = c * (k % 2 ? 0.78 : 0.98);
        const half = (Math.PI / RAYS) * (k % 2 ? 0.22 : 0.32);
        const x1 = c + Math.cos(a - half) * len, y1 = c + Math.sin(a - half) * len;
        const x2 = c + Math.cos(a + half) * len, y2 = c + Math.sin(a + half) * len;
        return `M${c} ${c} L${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
      }).join(" ")
    : "";
  return (
    <View pointerEvents="none" style={[styles.wrap, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={gid} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={strong ? 1 : 0.6} />
            <Stop offset={strong ? "0.3" : "0.45"} stopColor={color} stopOpacity={strong ? 0.7 : 0.28} />
            <Stop offset="0.6" stopColor={color} stopOpacity={strong ? 0.25 : 0.2} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={rid} cx="50%" cy="50%" r="50%">
            <Stop offset="0.25" stopColor="#FFFFFF" stopOpacity={0.55} />
            <Stop offset="0.45" stopColor={color} stopOpacity={0.55} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} fill={`url(#${gid})`} />
        {strong ? <G><Path d={rays} fill={`url(#${rid})`} /></G> : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: "50%", top: "50%" },
});
