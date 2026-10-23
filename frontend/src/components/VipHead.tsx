import React from "react";
import { View, Text, StyleSheet } from "react-native";

export const VIP_HEADS = [
  { level: 1, emoji: "🐑", color: "#32D74B", label_en: "Sheep",   label_ar: "الخروف" },
  { level: 2, emoji: "🐴", color: "#C7C7CC", label_en: "Horse",   label_ar: "الحصان" },
  { level: 3, emoji: "🦌", color: "#BF5AF2", label_en: "Deer",    label_ar: "الغزال" },
  { level: 4, emoji: "🦊", color: "#FF453A", label_en: "Fox",     label_ar: "الثعلب" },
  { level: 5, emoji: "🐻", color: "#A0522D", label_en: "Bear",    label_ar: "الدب" },
  { level: 6, emoji: "🦅", color: "#FF9500", label_en: "Eagle",   label_ar: "النسر" },
  { level: 7, emoji: "🐆", color: "#FFD700", label_en: "Cheetah", label_ar: "الفهد" },
] as const;

type Props = { level: number; size?: number; showBadge?: boolean };

export function VipHead({ level, size = 40, showBadge = true }: Props) {
  const meta = VIP_HEADS.find((v) => v.level === level);
  if (!meta) return null;
  const boxStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: meta.color + "22",
    borderColor: meta.color,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 2,
    shadowColor: meta.color,
    shadowOpacity: 0.9,
    shadowRadius: size / 3,
    shadowOffset: { width: 0, height: 0 },
  };
  return (
    <View style={{ alignItems: "center" }}>
      <View style={boxStyle}>
        <Text style={{ fontSize: size * 0.55 }}>{meta.emoji}</Text>
      </View>
      {showBadge && (
        <View style={[styles.badge, { backgroundColor: meta.color }]}>
          <Text style={styles.badgeText}>VIP{meta.level}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, marginTop: -6 },
  badgeText: { color: "#000", fontWeight: "900", fontSize: 10, letterSpacing: 0.3 },
});

// Role color for room members: owner=red, moderator=green, member=yellow
export function roleColor(role: "owner" | "moderator" | "member"): string {
  if (role === "owner") return "#FF453A";
  if (role === "moderator") return "#32D74B";
  return "#F5C542";
}
