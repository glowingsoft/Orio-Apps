/**
 * Iter-99 — Profile stat chips under the username.
 * Order: VIP → Age/Gender → Wealth → Charm → Country flag.
 * Every chip matches the height of the VipBadge "md" (22px).
 */
import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { VipBadge } from "@/src/components/VipBadge";
import { LevelBadgeChip, AgeBadge } from "@/src/levels/badges";
import { colors } from "@/src/theme";

const H = 22;

export function ProfileStatChips({ user, testIDPrefix = "stat-chip" }: { user: any; testIDPrefix?: string }) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      {/* Iter-119 — ONLY: Age → VIP → Wealth → Charm (same height). Age is NOT tappable. */}
      <AgeBadge testID={`${testIDPrefix}-age-gender`} age={user.age} gender={user.gender} />
      {(user.vip_level ?? 0) > 0 && (
        <Pressable testID={`${testIDPrefix}-vip`} hitSlop={4} onPress={() => router.push("/vip" as any)}>
          <VipBadge level={user.vip_level} size="md" />
        </Pressable>
      )}
      {/* Wealth always shown (new accounts start at LV1); Charm only once LV1 is earned. */}
      <LevelBadgeChip testID={`${testIDPrefix}-wealth`} sys="wealth" level={Math.max(1, Number(user.wealth_level ?? 0))} />
      {Number(user.charm_level ?? 0) >= 1 && (
        <LevelBadgeChip testID={`${testIDPrefix}-charm`} sys="charm" level={Number(user.charm_level)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: {
    height: H, borderRadius: H / 2, borderWidth: 1, paddingHorizontal: 8,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3,
  },
  text: { fontSize: 11, fontWeight: "900", includeFontPadding: false },
  flagChip: { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 6 },
  flag: { fontSize: 12, lineHeight: 16 },
});
