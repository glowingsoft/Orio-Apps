/**
 * Iter-134 — private chat sender identity: real profile photo with the
 * user's Age · VIP · Wealth · Charm badges beneath (same order/system as rooms).
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { VipBadge } from "@/src/components/VipBadge";
import { AgeBadge, LevelBadgeChip } from "@/src/levels/badges";
import { colors } from "@/src/theme";

export function ChatAvatar({ user, testID }: { user: any; testID?: string }) {
  return (
    <View style={styles.col} testID={testID}>
      {user?.avatar_url ? (
        <Image source={user.avatar_url} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, { backgroundColor: colors.surfaceTertiary }]} />
      )}
      <View style={styles.badges}>
        <AgeBadge age={user?.age} gender={user?.gender} />
        {Number(user?.vip_level ?? 0) > 0 && <VipBadge level={user.vip_level} size="sm" />}
        <LevelBadgeChip size="sm" sys="wealth" level={Math.max(1, Number(user?.wealth_level ?? 0))} />
        {Number(user?.charm_level ?? 0) >= 1 && <LevelBadgeChip size="sm" sys="charm" level={Number(user.charm_level)} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { width: 62, alignItems: "center", gap: 3 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  badges: { alignItems: "center", gap: 2, transform: [{ scale: 0.9 }] },
});
