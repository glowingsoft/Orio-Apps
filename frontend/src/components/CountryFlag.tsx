/**
 * Iter-121 — the ONE flag renderer for ORIO. Every flag is a natural circular
 * SVG that fills its container completely (no square inside a circle, no
 * border/ornament/glow). Accepts an ISO/region `code` or a flag `emoji`
 * (decoded from regional-indicator symbols). Unknown 🌎 / All 🌐 fall back to
 * the globe emoji, which is already round.
 */
import React from "react";
import { View, Text } from "react-native";
import { CIRCLE_FLAGS } from "@/src/utils/circleFlags";

export function codeFromFlagEmoji(emoji?: string | null): string | null {
  if (!emoji) return null;
  const cps = Array.from(emoji).map((c) => c.codePointAt(0) || 0);
  if (cps.length !== 2 || cps.some((c) => c < 0x1f1e6 || c > 0x1f1ff)) return null;
  return String.fromCharCode(...cps.map((c) => c - 0x1f1e6 + 65));
}

export function CountryFlag({ code, flag, size = 22, testID }: {
  code?: string | null; flag?: string | null; size?: number; testID?: string;
}) {
  const key = (code || codeFromFlagEmoji(flag) || "").toUpperCase();
  const get = CIRCLE_FLAGS[key];
  if (get) {
    const Svg = get();
    return (
      <View testID={testID} style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
        <Svg width={size} height={size} />
      </View>
    );
  }
  if (!flag) return null;
  return (
    <View testID={testID} style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.92, lineHeight: size * 1.1, textAlign: "center", includeFontPadding: false }}>{flag}</Text>
    </View>
  );
}
