import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { apiPackages, apiRecharge, apiTransactions } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Diamond } from "@/src/components/Diamond";
import { VipBadge } from "@/src/components/VipBadge";
import { useLiveUser } from "@/src/hooks/useLiveUser";

export default function Wallet() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  useLiveUser();
  const { isRTL, t, lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [payMsg, setPayMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const checking = false;
  const inflight = useRef(false);
  const [tab, setTab] = useState<"packages" | "history">("packages");
  const channel: "mobile" | "web" = Platform.OS === "web" ? "web" : "mobile";

  const { data: packages = [], isLoading: pkgLoading } = useQuery({ queryKey: ["packages", channel], queryFn: () => apiPackages(channel) });
  const { data: txs = [], refetch: refetchTx } = useQuery({ queryKey: ["transactions"], queryFn: apiTransactions });


  const rechargeMut = useMutation({
    mutationFn: async (id: string) => {
      if (inflight.current) return null;
      inflight.current = true;
      try {
        // One request_id per tap → the server never credits it twice.
        return await apiRecharge(id, `rc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
      } finally { inflight.current = false; }
    },
    onSuccess: async (r: any) => {
      if (!r) return;
      await refresh(); await refetchTx();
      qc.invalidateQueries({ queryKey: ["vip-progress"] });
      setPayMsg({ ok: true, text: ar ? `تمت إضافة ${Number(r.credited || 0).toLocaleString("en-US")} ماسة` : `+${Number(r.credited || 0).toLocaleString("en-US")} Diamonds added` });
    },
    onError: (e: any) => setPayMsg({ ok: false, text: String(e?.message || "").includes("unavailable") ? (ar ? "الشحن التجريبي غير مفعّل في هذه البيئة" : "Test recharge is disabled in this environment") : (ar ? "تعذّر الشحن" : "Recharge failed") }),
  });

  const bestValueId = packages.length > 0 ? packages[Math.floor(packages.length / 2)]?.id : null;

  // Iter-64 — RTL/LTR aware back navigation.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.push("/home" as any);
  };

  return (
    <View style={styles.container} testID="wallet-screen">
      {/* Ambient background */}
      <LinearGradient colors={[colors.purpleGlow, colors.surface]} style={[StyleSheet.absoluteFill, { opacity: 0.7 }]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.5 }} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm, flexDirection: "row" }]}>
          <Pressable
            testID="wallet-back"
            onPress={goBack}
            hitSlop={10}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}
            accessibilityLabel={t.backLabel}
          >
            <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>{t.walletTitle}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Balance hero card */}
        <View style={{ paddingHorizontal: spacing.lg }}>
          <LinearGradient
            colors={["#1F9CFF", "#0057B7", "#062752"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroTop}>
              <Diamond size={44} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.heroLabel}>{t.diamondsBalance}</Text>
                <Text style={styles.heroValue} testID="diamonds-balance">{user?.coins?.toLocaleString() || 0}</Text>
              </View>
            </View>
            <View style={styles.heroFoot}>
              <Text style={styles.heroFootText}>{`${t.levelLabel} ${user?.level || 1}`}</Text>
              <View style={styles.heroDot} />
              <Text style={styles.heroFootText}>{`${t.wealthLabel} ${user?.wealth_level || 0}`}</Text>
              {user?.vip_level > 0 && (
                <>
                  <View style={styles.heroDot} />
                  <VipBadge level={user.vip_level} />
                </>
              )}
            </View>
          </LinearGradient>
        </View>

        {/* Iter-64 — Tabs: Recharge | Agent | History (Agent routes to the
            existing /recharge-agent system). */}
        <View style={styles.tabs}>
          <Pressable testID="tab-packages" onPress={() => setTab("packages")} style={[styles.tab, tab === "packages" && styles.tabActive]}>
            <Icon name="diamond-outline" size={14} color={tab === "packages" ? colors.onBrandPrimary : colors.muted} />
            <Text style={[styles.tabText, tab === "packages" && styles.tabTextActive]} numberOfLines={1}>
              {t.rechargeTab}
            </Text>
          </Pressable>
          <Pressable
            testID="tab-agent"
            onPress={() => router.push("/recharge-agent" as any)}
            style={[styles.tab]}
          >
            <Icon name="people-outline" size={14} color={colors.muted} />
            <Text style={[styles.tabText]} numberOfLines={1}>
              {t.agentTab}
            </Text>
          </Pressable>
          <Pressable testID="tab-history" onPress={() => setTab("history")} style={[styles.tab, tab === "history" && styles.tabActive]}>
            <Icon name="time-outline" size={14} color={tab === "history" ? colors.onBrandPrimary : colors.muted} />
            <Text style={[styles.tabText, tab === "history" && styles.tabTextActive]} numberOfLines={1}>
              {t.historyTab}
            </Text>
          </Pressable>
        </View>

        {tab === "packages" ? (
          pkgLoading ? (
            <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
          ) : (
            <View>
            {payMsg && (
              <View testID="payment-status" style={[styles.payMsg, payMsg.ok === true && styles.payOk, payMsg.ok === false && styles.payErr]}>
                {checking ? <ActivityIndicator size="small" color={colors.gold} /> : (
                  <Icon name={payMsg.ok ? "checkmark-circle" : "information-circle"} size={16} color={payMsg.ok ? colors.success : colors.gold} />
                )}
                <Text style={styles.payMsgText}>{payMsg.text}</Text>
              </View>
            )}
            <View style={styles.pkgGrid}>
              {packages.map((p: any) => {
                const isBest = p.id === bestValueId;
                const total = p.coins + (p.bonus || 0);
                return (
                  <Pressable
                    key={p.id}
                    testID={`package-${p.id}`}
                    onPress={() => rechargeMut.mutate(p.id)}
                    disabled={rechargeMut.isPending}
                    style={({ pressed }) => [styles.pkg, isBest && styles.pkgBest, pressed && { opacity: 0.85 }]}
                  >
                    {isBest && (
                      <View style={styles.bestBadge}>
                        <Icon name="flame" size={9} color="#FFF" />
                        <Text style={styles.bestBadgeText}>{t.bestValue}</Text>
                      </View>
                    )}
                    {p.bonus > 0 && (
                      <View style={styles.bonusBadge}><Text style={styles.bonusBadgeText}>{t.bonusPrefix(p.bonus.toLocaleString("en-US"))}</Text></View>
                    )}
                    <Diamond size={38} />
                    <Text style={styles.pkgCoins}>{total.toLocaleString("en-US")}</Text>
                    <Text style={styles.pkgLabel}>{t.pkgLabel(p.label)}</Text>
                    <View style={styles.pkgPrice}><Text style={styles.pkgPriceText}>${Number(p.price_usd).toFixed(2)}</Text></View>
                  </Pressable>
                );
              })}
            </View>
            </View>
          )
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
            {txs.length === 0 ? (
              <Text style={styles.emptyText}>{t.noTransactionsYet}</Text>
            ) : (
              txs.map((t: any, i: number) => (
                <View key={i} style={styles.txRow} testID={`tx-${i}`}>
                  <View style={[styles.txIcon, { backgroundColor: t.amount > 0 ? "rgba(50,215,75,0.15)" : "rgba(255,69,58,0.15)" }]}>
                    <Icon name={t.amount > 0 ? "arrow-down" : "arrow-up"} size={16} color={t.amount > 0 ? colors.success : colors.error} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txDesc}>{t.description || t.type}</Text>
                    <Text style={styles.txDate}>{new Date(t.created_at).toLocaleString()}</Text>
                  </View>
                  <View style={styles.txAmountRow}>
                    <Diamond size={12} />
                    <Text style={[styles.txAmount, { color: t.amount > 0 ? colors.success : colors.error }]}>{t.amount > 0 ? "+" : ""}{t.amount.toLocaleString()}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
        {rechargeMut.isPending && <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.lg }} />}
        <Text style={styles.footNote}>{t.diamondsVirtualNote}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "900" },
  hero: { borderRadius: radius.xl, padding: spacing.xl, shadowColor: "#0057B7", shadowOffset: { width: 0, height: 6 }, shadowRadius: 20, shadowOpacity: 0.5, elevation: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  heroTop: { flexDirection: "row", alignItems: "center" },
  heroLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700", letterSpacing: 2, textTransform: "uppercase" },
  heroValue: { color: "#FFF", fontSize: 34, fontWeight: "900", marginTop: 2 },
  heroFoot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 0.5, borderTopColor: "rgba(255,255,255,0.15)" },
  heroFootText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700" },
  heroDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.4)" },
  vipBadge: { flexDirection: "row", gap: 3, alignItems: "center", backgroundColor: colors.gold, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  vipText: { color: "#000", fontSize: 10, fontWeight: "900" },
  tabs: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  tab: { flex: 1, flexDirection: "row", gap: 6, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.gold },
  tabText: { color: colors.muted, fontWeight: "800" },
  tabTextActive: { color: colors.onBrandPrimary },
  pkgGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.md },
  pkg: { width: "47%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.border, position: "relative" },
  pkgBest: { borderColor: colors.gold, backgroundColor: "rgba(245,197,66,0.08)" },
  bestBadge: { position: "absolute", top: -8, left: -1, right: -1, backgroundColor: colors.error, paddingVertical: 4, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 4, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  bestBadgeText: { color: "#FFF", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  bonusBadge: { position: "absolute", top: 8, right: 8, backgroundColor: colors.purple, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  bonusBadgeText: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  payMsg: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  payOk: { borderColor: colors.success },
  payErr: { borderColor: colors.gold },
  payMsgText: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  pkgCoins: { color: colors.onSurface, fontSize: 18, fontWeight: "900", marginTop: 4 },
  pkgLabel: { color: colors.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  pkgPrice: { backgroundColor: colors.gold, paddingHorizontal: spacing.lg, paddingVertical: 6, borderRadius: radius.pill, marginTop: 4 },
  pkgPriceText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 13 },
  emptyText: { color: colors.muted, textAlign: "center", marginTop: spacing.xl },
  txRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txDesc: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  txDate: { color: colors.muted, fontSize: 11, marginTop: 2 },
  txAmountRow: { flexDirection: "row", gap: 4, alignItems: "center" },
  txAmount: { fontSize: 14, fontWeight: "900" },
  footNote: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.xl, paddingHorizontal: spacing.xl },
});
