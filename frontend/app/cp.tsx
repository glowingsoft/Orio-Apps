import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { VipName } from "@/src/components/VipName";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { apiCp, apiCpAccept, apiCpRemove } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { useToast } from "@/src/components/Toast";
import { confirmAction } from "@/src/utils/confirm";
import { useAuth } from "@/src/auth-context";
import { AvatarImage } from "@/src/components/AvatarImage";

export default function Cp() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t } = useI18n();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const { data: list = [], isLoading } = useQuery({ queryKey: ["cp"], queryFn: apiCp });
  const toast = useToast();
  const refreshCp = () => { qc.invalidateQueries({ queryKey: ["cp"] }); qc.invalidateQueries({ queryKey: ["my-cps"] }); };
  const accept = useMutation({ mutationFn: (id: string) => apiCpAccept(id), onSuccess: refreshCp });
  const remove = useMutation({
    mutationFn: (v: { id: string; kind: "end" | "withdraw" }) => apiCpRemove(v.id),
    onSuccess: (_r, v) => {
      refreshCp();
      toast.show({ kind: "success", message: v.kind === "end" ? (isRTL ? "تم إنهاء CP" : "CP ended") : (isRTL ? "تم سحب طلب CP" : "CP request withdrawn") });
    },
    onError: (e: any) => toast.show({ kind: "error", message: e?.message || (isRTL ? "تعذّر تنفيذ الإجراء" : "Action failed") }),
  });
  const endCp = async (other: any) => {
    const ok = await confirmAction({
      title: isRTL ? "إنهاء CP؟" : "End CP?",
      message: isRTL
        ? `سينتهي ارتباطك مع ${other?.nickname || ""} وستفقد مستوى ونقاط CP.`
        : `You and ${other?.nickname || "your partner"} will no longer be CP, and your CP level and points will be lost.`,
      confirmText: isRTL ? "إنهاء" : "End CP",
      cancelText: isRTL ? "إلغاء" : "Cancel",
      destructive: true,
    });
    if (ok) remove.mutate({ id: other.id, kind: "end" });
  };
  const withdraw = async (other: any) => {
    const ok = await confirmAction({
      title: isRTL ? "سحب طلب CP؟" : "Withdraw CP request?",
      message: isRTL ? `سيتم إلغاء طلبك إلى ${other?.nickname || ""}.` : `Your request to ${other?.nickname || "this user"} will be cancelled.`,
      confirmText: isRTL ? "سحب" : "Withdraw",
      cancelText: isRTL ? "إلغاء" : "Cancel",
      destructive: true,
    });
    if (ok) remove.mutate({ id: other.id, kind: "withdraw" });
  };

  const active = list.find((r: any) => r.status === "accepted");
  const pending = list.filter((r: any) => r.status === "pending" && !r.requested_by_me);
  const sent = list.filter((r: any) => r.status === "pending" && r.requested_by_me);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="cp-screen">
      <View style={[styles.header]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
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
                  {/* You ♥ partner */}
                  <View style={styles.pairRow}>
                    <AvatarImage uri={me?.avatar_url} name={me?.nickname} style={styles.pairAvatar} />
                    <View style={styles.pairHeart}><Icon name="heart" size={22} color="#FF453A" /></View>
                    <AvatarImage uri={active.other?.avatar_url} name={active.other?.nickname} style={styles.pairAvatar} />
                  </View>
                  <Text style={styles.heroTitle}>{t.youAreCpWith}</Text>
                  {/* Plain white: a VIP name colour (often red) disappears on this gradient. */}
                  <Text style={styles.heroName} numberOfLines={1}>{active.other?.nickname}</Text>
                  <View style={styles.heroStats}>
                    <View style={styles.heroStat}><Text style={styles.heroStatVal}>{`Lv. ${active.level}`}</Text><Text style={styles.heroStatLabel}>{t.levelLabel}</Text></View>
                    <View style={styles.heroDivider} />
                    <View style={styles.heroStat}><Text style={styles.heroStatVal}>{active.points}</Text><Text style={styles.heroStatLabel}>{t.pointsLabel}</Text></View>
                  </View>
                  <Pressable
                    testID="cp-end-btn"
                    onPress={() => endCp(active.other)}
                    disabled={remove.isPending}
                    style={[styles.endBtn, remove.isPending && { opacity: 0.6 }]}
                  >
                    {remove.isPending ? <ActivityIndicator color="#FFF" size="small" /> : (
                      <>
                        <Icon name="heart-dislike-outline" size={15} color="#FFF" />
                        <Text style={styles.endText}>{isRTL ? "إنهاء CP" : "End CP"}</Text>
                      </>
                    )}
                  </Pressable>
                </LinearGradient>
              ) : (
                <View style={styles.emptyHero}>
                  <Icon name="heart-outline" size={60} color={colors.muted} />
                  <Text style={styles.emptyText}>{t.noActiveCp}</Text>
                  <Text style={styles.emptySub}>{t.requestCpFromProfile}</Text>
                  <Pressable testID="cp-find-btn" onPress={() => router.push("/search" as any)} style={styles.findBtn}>
                    <Icon name="search" size={15} color="#FFF" />
                    <Text style={styles.findText}>{isRTL ? "ابحث عن CP" : "Find a CP"}</Text>
                  </Pressable>
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
                <Pressable testID={`withdraw-cp-${item.id}`} onPress={() => withdraw(item.other)} disabled={remove.isPending} style={styles.withdrawBtn}>
                  <Text style={styles.withdrawText}>{isRTL ? "سحب" : "Withdraw"}</Text>
                </Pressable>
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
  heroName: {
    color: "#FFF", fontSize: 24, fontWeight: "900", maxWidth: "90%",
    textShadowColor: "rgba(0,0,0,0.25)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 },
  },
  pairRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.xs },
  pairAvatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: "#FFFFFF" },
  pairHeart: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: "#FFFFFF", marginHorizontal: -10, zIndex: 1,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  heroStats: {
    flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.15)",
  },
  heroDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.35)" },
  heroStat: { alignItems: "center", minWidth: 56 },
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
  endBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, minHeight: 36,
    paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.8)", backgroundColor: "rgba(0,0,0,0.15)",
  },
  endText: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  findBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, minHeight: 40,
    paddingHorizontal: spacing.lg, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.brandPrimary,
  },
  findText: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  withdrawBtn: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  withdrawText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
});
