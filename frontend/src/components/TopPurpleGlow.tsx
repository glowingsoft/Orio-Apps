/**
 * TopPurpleGlow — Iter-66.
 *
 * Thin, premium purple light wash anchored to the very top edge of a
 * screen. Fades smoothly from a soft violet glow into transparent so it
 * blends with the existing dark/black UI underneath.
 *
 * No logo, rings, icons, or decorative shapes — just the luminous wash.
 *
 * Usage:
 *   <View style={styles.container}>
 *     <TopPurpleGlow />
 *     ...rest of screen...
 *   </View>
 *
 * Because this is `position: absolute` + `pointerEvents="none"` it does
 * NOT reserve any layout space and will never block touches.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type Props = {
  /** Total height of the glow in dp. Default 160. */
  height?: number;
};

export function TopPurpleGlow({ height = 160 }: Props) {
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { height }]}
      testID="top-purple-glow"
    >
      <LinearGradient
        colors={[
          "rgba(168, 85, 247, 0.55)",   // soft violet near the top edge
          "rgba(139, 92, 246, 0.22)",
          "rgba(88, 28, 135, 0.08)",
          "rgba(0, 0, 0, 0)",
        ]}
        locations={[0, 0.35, 0.7, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
});
