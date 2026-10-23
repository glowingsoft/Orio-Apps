/**
 * Shared VIP → Wealth → Charm level boxes (Honor tab + room profile card).
 * One source of styling + live level data; high levels (31+) animate the
 * full-box palette via PaletteFill. Small badges elsewhere stay static.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { VIP_BADGES, VIP_THEMES, vipIndex, shade } from "@/src/vip/vipAssets";
import { LevelBadgeImage, PaletteFill } from "@/src/levels/badges";
import { colors, radius } from "@/src/theme";

export function LevelBoxes({ user, labels, onNavigate, testIDPrefix = "honor" }: {
  user: any;
  labels: { wealth: string; charm: string };
  /** Called before navigating (e.g. to close a modal). */
  onNavigate?: () => void;
  testIDPrefix?: string;
}) {
  const vip = Number(user?.vip_level ?? 0);
  const vi = vipIndex(vip);
  const wealth = Number(user?.wealth_level ?? 0);
  const charm = Number(user?.charm_level ?? 0);
  return (
    <View style={styles.row}>
      <Box testID={`${testIDPrefix}-vip`} href="/vip" label="VIP" level={vip} onNavigate={onNavigate}
        fill={vi != null ? (
          <LinearGradient colors={[VIP_THEMES[vi].tint, shade(VIP_THEMES[vi].tint, 0.45)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : null}>
        {/* Real VIP badge artwork (VIP1–VIP10); non-VIP shows VIP1 art as the goal. */}
        <Image source={VIP_BADGES[vi ?? 0]} style={{ width: 38, height: 38, opacity: vi == null ? 0.45 : 1 }} contentFit="contain" />
      </Box>
      <Box testID={`${testIDPrefix}-wealth`} href={`/level?sys=wealth&lv=${wealth}`} label={labels.wealth} level={wealth} onNavigate={onNavigate}
        fill={<PaletteFill sys="wealth" level={wealth} />}>
        <LevelBadgeImage sys="wealth" level={wealth} size={38} />
      </Box>
      <Box testID={`${testIDPrefix}-charm`} href={`/level?sys=charm&lv=${charm}`} label={labels.charm} level={charm} onNavigate={onNavigate}
        fill={<PaletteFill sys="charm" level={charm} />}>
        <LevelBadgeImage sys="charm" level={charm} size={38} />
      </Box>
    </View>
  );
}

function Box({ label, level, children, testID, href, fill, onNavigate }: any) {
  const router = useRouter();
  return (
    <Pressable testID={testID} onPress={() => { onNavigate?.(); router.push(href as any); }} style={styles.square}>
      {fill}
      <View style={styles.art}>{children}</View>
      <Text style={[styles.value, styles.text]}>{`LV.${level}`}</Text>
      <Text style={[styles.label, styles.text]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  square: {
    // Shorter cards (same width): height = width / 1.42.
    flex: 1, aspectRatio: 1.42, alignItems: "center", justifyContent: "center", gap: 1,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, overflow: "hidden",
  },
  // Fixed white text with shadow so it reads on every level palette.
  text: { color: "#FFFFFF", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  art: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  value: { fontWeight: "900", fontSize: 13, lineHeight: 16 },
  label: { fontSize: 10, lineHeight: 12, marginTop: 1 },
});
