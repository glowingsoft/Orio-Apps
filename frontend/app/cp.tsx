import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { VipName } from "@/src/components/VipName";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCp, apiCpAccept } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

export default function Cp() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t } = useI18n();
  const qc = useQueryClient();
  const { data: list = [], isLoading } = useQuery({ queryKey: ["cp"], queryFn: apiCp });
  const accept = useMutation({ mutationFn: (id: string) => apiCpAccept(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["cp"] }) });

  const active = list.find((r: any) => r.status === "accepted");
  const pending = list.filter((r: any) => r.status === "pending" && !r.requested_by_me);
  const sent = list.filter((r: any) => r.status === "pending" && r.requested_by_me);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="cp-screen">
      <View style={[styles.header]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.cpTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <FlatList
          data={pending.concat(sent)}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ListHeaderComponent={() => (
            <>
              {active ? (
                <LinearGradient colors={["#FF453A", "#BF5AF2"]} style={styles.hero}>
                  <Icon name="heart" size={40} color="#FFF" />
                  <Text style={styles.heroTitle}>{t.youAreCpWith}</Text>
                  <VipName style={styles.heroName} name={active.other?.nickname} color={(active.other as any)?.name_color} vipLevel={(active.other as any)?.vip_level} />
                  <View style={styles.heroStats}>
                    <View style={styles.heroStat}><Text style={styles.heroStatVal}>{`Lv. ${active.level}`}</Text><Text style={styles.heroStatLabel}>{t.levelLabel}</Text></View>
                    <View style={styles.heroStat}><Text style={styles.heroStatVal}>{active.points}</Text><Text style={styles.heroStatLabel}>{t.pointsLabel}</Text></View>
                  </View>
                </LinearGradient>
              ) : (
                <View style={styles.emptyHero}>
                  <Icon name="heart-outline" size={60} color={colors.muted} />
                  <Text style={styles.emptyText}>{t.noActiveCp}</Text>
                  <Text style={styles.emptySub}>{t.requestCpFromProfile}</Text>
                </View>
              )}
              {pending.length > 0 && <Text style={styles.sectionTitle}>{t.incomingRequestsShort}</Text>}
            </>
          )}
          renderItem={({ item }) => (
            <View style={[styles.row]} testID={`cp-${item.id}`}>
              <Image source={item.other?.avatar_url} style={styles.avatar} />
              <View style={{ flex: 1 }}>
                <VipName style={styles.name} name={item.other?.nickname} color={(item.other as any)?.name_color} vipLevel={(item.other as any)?.vip_level} />
                <Text style={styles.sub}>{item.requested_by_me ? t.waitingForResponse : t.wantsToCpWithYou}</Text>
              </View>
              {!item.requested_by_me ? (
                <Pressable testID={`accept-cp-${item.id}`} onPress={() => accept.mutate(item.other.id)} style={styles.acceptBtn}>
                  <Text style={styles.acceptText}>{t.acceptCp}</Text>
                </Pressable>
              ) : (
                <Icon name="time-outline" size={20} color={colors.muted} />
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { padding: spacing.xl, borderRadius: radius.lg, alignItems: "center", gap: spacing.sm },
  heroTitle: { color: "rgba(255,255,255,0.8)", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" },
  heroName: { color: "#FFF", fontSize: 26, fontWeight: "900" },
  heroStats: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.md },
  heroStat: { alignItems: "center" },
  heroStatVal: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  heroStatLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, marginTop: 2 },
  emptyHero: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyText: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  emptySub: { color: colors.muted, fontSize: 13, textAlign: "center" },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  acceptBtn: { backgroundColor: colors.error, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  acceptText: { color: "#FFF", fontWeight: "800", fontSize: 12 },
});
