import { CountryFlag } from "@/src/components/CountryFlag";
import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { apiRankings } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { FoluCoin } from "@/src/components/FoluCoin";
import { Diamond } from "@/src/components/Diamond";
import { VipBadge } from "@/src/components/VipBadge";
import { VipName } from "@/src/components/VipName";

const CATEGORIES = [
  { id: "charm",      labelKey: "charmCat" as const,      icon: "heart",   color: colors.error },
  { id: "wealth",     labelKey: "wealthCat" as const,     icon: "diamond", color: colors.purple },
  { id: "gifts",      labelKey: "giftsCat" as const,      icon: "gift",    color: colors.gold },
  { id: "cp",         labelKey: "cpCat" as const,         icon: "people",  color: "#FF69B4" },
  { id: "friendship", labelKey: "friendsCat" as const,    icon: "star",    color: "#32D74B" },
];
const PERIODS = [
  { id: "daily",   labelKey: "daily" as const },
  { id: "weekly",  labelKey: "weekly" as const },
  { id: "monthly", labelKey: "monthly" as const },
  { id: "all",     labelKey: "allTime" as const },
];

export default function Rankings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t } = useI18n();
  const [cat, setCat] = useState("charm");
  const [period, setPeriod] = useState("all");

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["rankings", cat, period],
    queryFn: () => apiRankings(cat, period),
  });

  const catData = CATEGORIES.find((c) => c.id === cat)!;

  return (
    <View style={styles.container} testID="rankings-screen">
      <LinearGradient colors={[catData.color, colors.surface]} style={[StyleSheet.absoluteFill, { opacity: 0.3 }]} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.rankingsTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Category chips */}
      <View style={{ height: 56 }}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center" }}
          data={CATEGORIES}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => {
            const sel = cat === item.id;
            return (
              <Pressable testID={`cat-${item.id}`} onPress={() => setCat(item.id)} style={[styles.chip, sel && { backgroundColor: item.color }]}>
                <Icon name={item.icon as any} size={14} color={sel ? (item.color === "#FFD60A" ? "#111114" : "#FFF") : colors.onSurfaceSecondary} />
                <Text style={[styles.chipText, sel && { color: item.color === "#FFD60A" ? "#111114" : "#FFF" }]}>{t[item.labelKey]}</Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* Period tabs */}
      <View style={styles.periodBar}>
        {PERIODS.map((p) => (
          <Pressable key={p.id} testID={`period-${p.id}`} onPress={() => setPeriod(p.id)} style={[styles.periodTab, period === p.id && styles.periodActive]}>
            <Text style={[styles.periodText, period === p.id && styles.periodTextActive]}>{t[p.labelKey]}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Icon name="trophy-outline" size={64} color={colors.muted} />
          <Text style={styles.empty}>{t.noRankingsYet}</Text>
        </View>
      ) : cat === "cp" || cat === "friendship" ? (
        <FlatList
          data={list}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          renderItem={({ item, index }) => (
            <View style={styles.pairRow} testID={`rank-${index}`}>
              <Text style={[styles.rankNum, index < 3 && { color: colors.gold }]}>#{index + 1}</Text>
              <View style={styles.pairAvatars}>
                <Image source={item.pair[0].avatar_url} style={styles.pairAvatar} />
                <Image source={item.pair[1].avatar_url} style={[styles.pairAvatar, { marginLeft: -14 }]} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                  <VipName style={styles.rankName} name={item.pair[0].nickname} color={item.pair[0].name_color} vipLevel={item.pair[0].vip_level} />
                  <Text style={styles.rankName}>{" & "}</Text>
                  <VipName style={styles.rankName} name={item.pair[1].nickname} color={item.pair[1].name_color} vipLevel={item.pair[1].vip_level} />
                </View>
                <Text style={styles.rankScore}>{t.lvPts(item.level, item.score)}</Text>
              </View>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(r, i) => r.id + i}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          renderItem={({ item, index }) => (
            <View style={styles.rankRow} testID={`rank-${index}`}>
              <Text style={[styles.rankNum, index < 3 && { color: colors.gold, fontSize: 20 }]}>#{index + 1}</Text>
              <Image source={item.avatar_url} style={styles.rankAvatar} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <VipName name={item.nickname} color={(item as any).name_color} style={styles.rankName} />
                  {!!item.country_flag && <CountryFlag flag={item.country_flag} size={16} />}
                  {item.vip_level > 0 && <VipBadge level={item.vip_level} />}
                </View>
              </View>
              <View style={styles.scoreChip}>
                {cat === "gifts" && <Diamond size={12} />}
                <Text style={styles.rankScore}>{item.score.toLocaleString()}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  chipText: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  periodBar: { flexDirection: "row", marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  periodTab: { flex: 1, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  periodActive: { backgroundColor: colors.gold },
  periodText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  periodTextActive: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  empty: { color: colors.muted },
  rankRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  rankNum: { color: colors.muted, fontWeight: "900", fontSize: 16, width: 36 },
  rankAvatar: { width: 40, height: 40, borderRadius: 20 },
  rankName: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  rankScore: { color: colors.onSurface, fontWeight: "800", fontSize: 13 },
  scoreChip: { flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: colors.surfaceTertiary, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill },
  vipMini: { backgroundColor: colors.gold, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.pill },
  vipMiniText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: "800" },
  pairRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  pairAvatars: { flexDirection: "row" },
  pairAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.surface },
});
