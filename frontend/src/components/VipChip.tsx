/**
 * VipChip — Iter-96.
 *
 * Tappable VIP indicator used across the app wherever a user's VIP
 * status is displayed next to their avatar/name. Renders the existing
 * ORIO VipBadge icon (tier-colored animated V with level number inside
 * the glyph) — NEVER a plain "V + number" text display.
 *
 * Returns null when the user has no VIP.
 */
import React from "react";
import { Pressable, StyleProp, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { VipBadge } from "@/src/components/VipBadge";

type Props = {
  level?: number | null;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function VipChip({ level, size = "md", style, testID = "chip-vip" }: Props) {
  const router = useRouter();
  const lvl = Number(level ?? 0);
  if (!lvl || lvl < 1) return null;
  return (
    <Pressable
      testID={testID}
      onPress={() => router.push("/vip" as any)}
      style={[{ paddingHorizontal: 4, paddingVertical: 2 }, style]}
      accessibilityLabel={`VIP ${lvl}`}
    >
      <VipBadge level={lvl} size={size} />
    </Pressable>
  );
}
