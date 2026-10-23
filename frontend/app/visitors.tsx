import { CountryFlag } from "@/src/components/CountryFlag";
import { useCallback } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiMyVisitors } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { VipBadge } from "@/src/components/VipBadge";
import { VipName } from "@/src/components/VipName";

export default function Visitors() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["visitors"],
    queryFn: apiMyVisitors,
    staleTime: 15_000,
  });
  // Re-fetch whenever the screen gains focus so new visits appear without
  // forcing a manual pull-to-refresh. Reuses existing React Query infra.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const visitors = data?.visitors ?? [];
  const lifetime = data?.lifetime_views ?? 0;
  const today = data?.today_views ?? 0;

  const timeAgo = (iso: string) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return t.timeJustNow;
    if (diff < 3600) return t.timeMinutes(Math.floor(diff / 60));
    if (diff < 86400) return t.timeHours(Math.floor(diff / 3600));
    return t.timeDays(Math.floor(diff / 86400));
  };

  return (
    <View style={styles.container} testID="visitors-screen">
      <LinearGradient
        colors={["#26D0CE", colors.surface]}
        style={[StyleSheet.absoluteFill, { opacity: 0.25 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.4 }}
      />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Icon name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} testID="visitors-title">
          {t.visitorsTitle}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.stats}>
        <LinearGradient
          colors={["#26D0CE", "#1A6D9E"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statCard}
        >
          <Icon name="today" size={28} color="#FFF" />
          <Text style={styles.statLabel}>{t.visitorsTodayLabel}</Text>
          <Text style={styles.statValue} testID="today-views">
            {today.toLocaleString()}
          </Text>
        </LinearGradient>
        <LinearGradient
          colors={[colors.purple, colors.purpleDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statCard}
        >
          <Icon name="eye" size={28} color="#FFF" />
          <Text style={styles.statLabel}>{t.visitorsLifetimeLabel}</Text>
          <Text style={styles.statValue} testID="lifetime-views">
            {lifetime.toLocaleString()}
          </Text>
        </LinearGradient>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} />
        </View>
      ) : visitors.length === 0 ? (
        <View style={styles.center} testID="visitors-empty">
          <Icon name="eye-off-outline" size={64} color={colors.muted} />
          <Text style={styles.emptyText}>{t.visitorsEmpty}</Text>
          <Text style={styles.emptySub}>{t.visitorsEmptySub}</Text>
        </View>
      ) : (
        <FlatList
          data={visitors}
          keyExtractor={(v, i) => (v?.viewer_id ?? "x") + i}
          onRefresh={refetch}
          refreshing={isRefetching}
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.sm,
            paddingBottom: insets.bottom + spacing.xxl,
          }}
          renderItem={({ item }) => (
            <Pressable
              testID={`visitor-${item.viewer_id}`}
              onPress={() => item?.viewer_id && router.push(`/user/${item.viewer_id}` as any)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <Image source={item.viewer_pub?.avatar_url} style={styles.avatar} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <VipName
                    name={item.viewer_pub?.nickname}
                    color={item.viewer_pub?.name_color} vipLevel={(item.viewer_pub as any)?.vip_level}
                    style={styles.name}
                  />
                  {!!item.viewer_pub?.country_flag && <CountryFlag flag={item.viewer_pub.country_flag} size={16} />}
                  {item.viewer_pub?.vip_level > 0 && (
                    <VipBadge level={item.viewer_pub.vip_level} />
                  )}
                </View>
                <Text style={styles.uid}>ID: {item.viewer_pub?.short_id || "—"}</Text>
                <Text style={styles.timeText}>{timeAgo(item.last_visit)}</Text>
              </View>
              <View style={styles.visitBadge}>
                <Text style={styles.visitBadgeCount}>×{item.visits}</Text>
                <Text style={styles.visitBadgeLabel}>{t.visitsPlural(item.visits || 1)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  stats: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  statCard: { flex: 1, borderRadius: radius.lg, padding: spacing.lg, alignItems: "flex-start", gap: 4 },
  statLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
  },
  statValue: { color: "#FFF", fontSize: 24, fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xxl },
  emptyText: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  emptySub: { color: colors.muted, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 2,
    borderColor: colors.border,
  },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  uid: { color: colors.muted, fontSize: 11, marginTop: 2, fontFamily: "monospace" },
  timeText: { color: colors.gold, fontSize: 11, marginTop: 2, fontWeight: "600" },
  vipMini: {
    backgroundColor: colors.gold,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  vipMiniText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: "800" },
  visitBadge: {
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  visitBadgeCount: { color: colors.gold, fontSize: 16, fontWeight: "900" },
  visitBadgeLabel: { color: colors.muted, fontSize: 10 },
});
