/**
 * VIP Center — "remaining to unlock VIP X" + locked VIP X badge with a lock.
 * Real backend data: remaining = threshold − lifetime RECHARGED Diamonds.
 * Hidden automatically once VIP X is unlocked.
 */
import React, { useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { apiVipProgress } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { VIP_BADGES, VIP_THEMES } from "@/src/vip/vipAssets";

export function VipUnlockHint({ index }: { index: number }) {
  const { lang } = useI18n();
  const { data, refetch } = useQuery({ queryKey: ["vip-progress"], queryFn: apiVipProgress, refetchInterval: 20000 });
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  const row = data?.levels?.find((l) => l.level === index + 1);
  if (data && data.level >= 10) {
    // VIP10 — maximum level reached (no next-level requirement).
    return (
      <View style={styles.wrap} testID="vip-max-level">
        <Text style={[styles.text, { textShadowColor: VIP_THEMES[9].tint }]}>
          {lang === "ar" ? "لقد وصلت إلى أعلى مستوى VIP 10" : "You've reached the maximum level: VIP 10"}
        </Text>
      </View>
    );
  }
  if (!row || row.unlocked) return null;
  const th = VIP_THEMES[index];
  // Full number, comma separators, never abbreviated.
  const amount = row.remaining.toLocaleString("en-US");
  const text = lang === "ar"
    ? `ينقصك للمستوى التالي VIP ${row.level}: ${amount} ماسة`
    : `Diamonds needed for VIP ${row.level}: ${amount}`;
  return (
    <View style={styles.wrap} testID="vip-unlock-hint">
      <Text style={[styles.text, { textShadowColor: th.tint }]} testID="vip-unlock-remaining">{text}</Text>
      <View style={styles.badgeRow} testID={`vip-locked-badge-${row.level}`}>
        <Image source={VIP_BADGES[index]} style={styles.badge} contentFit="contain" />
        <View style={[styles.lock, { borderColor: th.accent, backgroundColor: th.tint }]}>
          <Icon name="lock-closed" size={11} color="#FFFFFF" />
        </View>
      </View>
    </View>
  );
}

// Fixed palette on the VIP artwork (white text, VIP-level colours).
const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 4, paddingHorizontal: 16 },
  text: {
    color: "#FFFFFF", fontSize: 13, fontWeight: "800", textAlign: "center",
    textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 },
    backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, overflow: "hidden",
  },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badge: { width: 40, height: 40 },
  lock: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
