/**
 * VipBadge — VIP mini-badge (Me tab, profiles, VIP row, room chat, lists).
 * Iter-136: ONE horizontal rounded rectangle. The ORIGINAL VIP1–VIP10 animal
 * artwork (head strip, plaque text removed) sits flush in the LEFT part and
 * fades seamlessly into the level-coloured background; "VIPn" in a premium
 * serif on the RIGHT. No circular image, mask or frame.
 * Heights match the standard info chips so rows never grow.
 */
import React from "react";
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle, I18nManager } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BADGE_H, BADGE_FONT } from "@/src/levels/badges";
import { VIP_STRIPS, VIP_STRIP_RATIO, VIP_THEMES, VIP_NUM_FONT, vipIndex, shade } from "@/src/vip/vipAssets";

type Props = {
  level?: number | null;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

// Iter-137 — same shared token as Age/Wealth/Charm → identical outer height.
const ONE = { h: BADGE_H, font: BADGE_FONT, radius: 5, padEnd: 5, minText: 24 };
const SIZES = { sm: ONE, md: ONE };

export function VipBadge({ level, size = "sm", style, textStyle }: Props) {
  const i = vipIndex(level);
  if (i == null) return null;
  const th = VIP_THEMES[i];
  const d = SIZES[size];
  const artW = Math.round(d.h * VIP_STRIP_RATIO);
  return (
    <View
      testID={`vip-badge-${i + 1}`}
      accessibilityLabel={`VIP ${i + 1}`}
      // Artwork always LEFT, level text RIGHT in both languages (row flips in RTL).
      style={[styles.wrap, { flexDirection: I18nManager.isRTL ? "row-reverse" : "row", height: d.h, borderRadius: d.radius, borderColor: th.accent + "B3" }, style]}
    >
      {/* Level colour: deep → rich → deep, plus a soft top sheen. */}
      <LinearGradient
        colors={[shade(th.tint, 0.3), shade(th.tint, 0.62), shade(th.tint, 0.35)]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient colors={["rgba(255,255,255,0.22)", "rgba(255,255,255,0)"]} style={[StyleSheet.absoluteFill, { bottom: "50%" }]} />
      {/* Original artwork, rectangular, flush left (clipped only by the pill's own corners). */}
      <Image source={VIP_STRIPS[i]} style={{ width: artW, height: d.h }} contentFit="cover" contentPosition="center" />
      <Text
        style={[styles.text, { fontSize: d.font, minWidth: d.minText, marginEnd: d.padEnd, marginStart: 1 }, textStyle]}
        numberOfLines={1}
      >{`VIP${i + 1}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center", alignItems: "center",
    borderWidth: 0.75, overflow: "hidden",
  },
  text: {
    color: "#FFFFFF", fontFamily: VIP_NUM_FONT, fontWeight: "800", letterSpacing: 0.3,
    textAlign: "right", includeFontPadding: false, fontVariant: ["lining-nums"],
    textShadowColor: "rgba(0,0,0,0.75)", textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 },
  },
});
