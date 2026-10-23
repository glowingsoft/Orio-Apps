import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiMyEarnings, apiMyTransactions, apiMyAgency, type LedgerEntry } from "@/src/api";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

function fmt(n: number) {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function statusColor(s: string): string {
  switch (s) {
    case "completed": return colors.success;
    case "refunded":
    case "reversed": return colors.warning;
    case "pending": return colors.info;
    case "failed": return colors.error;
    default: return colors.muted;
  }
}

export default function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);

  const earnings = useQuery({ queryKey: ["earnings"], queryFn: apiMyEarnings });
  const txns = useQuery({ queryKey: ["earnings", "txns"], queryFn: () => apiMyTransactions(100) });
  const myAg = useQuery({ queryKey: ["me", "agency"], queryFn: apiMyAgency });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([earnings.refetch(), txns.refetch(), myAg.refetch()]);
    setRefreshing(false);
  }, [earnings, txns, myAg]);

  const available = earnings.data?.available.host ?? 0;
  const pending = earnings.data?.pending.host ?? 0;
  const total = available + pending;
  const grossAvailable = earnings.data?.available.gross ?? 0;

  return (
    <View style={styles.root} testID="earnings-screen">
      <Stack.Screen options={{ title: t.earnings, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.onSurface} />}
      >
        {/* HERO BALANCE */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{t.availableEarnings}</Text>
          <View style={styles.heroAmountRow}>
            <Diamond size={28} />
            <Text style={styles.heroAmount} testID="earnings-available">{fmt(available)}</Text>
          </View>
          <Text style={styles.heroHint}>{t.diamondsNotCash}</Text>
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.pendingEarnings}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue} testID="earnings-pending">{fmt(pending)}</Text>
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.totalEarnings}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue} testID="earnings-total">{fmt(total)}</Text>
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>{t.gross}</Text>
              <View style={styles.statValueRow}>
                <Diamond size={14} />
                <Text style={styles.statValue} testID="earnings-gross">{fmt(grossAvailable)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* AGENCY LINK */}
        <Pressable
          style={styles.agencyCard}
          onPress={() => router.push("/agency")}
          testID="earnings-open-agency"
        >
          <View style={styles.agencyIcon}>
            <Icon name="business" size={22} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            {myAg.data?.agency ? (
              <>
                <Text style={styles.agencyName} numberOfLines={1}>{myAg.data.agency.name}</Text>
                <Text style={styles.agencySub}>
                  {myAg.data.role === "AGENCY_OWNER" ? t.agencyOwnerLabel : t.hostLabel} · {myAg.data.agency.status}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.agencyName}>{t.noAgency}</Text>
                <Text style={styles.agencySub}>{t.agencyCenter}</Text>
              </>
            )}
          </View>
          <Icon name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        {/* WITHDRAW / HISTORY ACTIONS */}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionBtn, styles.actionPrimary]}
            onPress={() => router.push("/withdraw" as any)}
            testID="earnings-withdraw"
          >
            <Icon name="arrow-up-circle" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.actionPrimaryText}>{t.withdraw}</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionGhost]}
            onPress={() => router.push("/withdrawals" as any)}
            testID="earnings-history"
          >
            <Icon name="receipt" size={18} color={colors.onSurface} />
            <Text style={styles.actionGhostText}>{t.myWithdrawals}</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.ghostRow}
          onPress={() => router.push("/payout-methods" as any)}
          testID="earnings-payout-methods"
        >
          <Icon name="card" size={16} color={colors.gold} />
          <Text style={styles.ghostRowText}>{t.payoutMethods}</Text>
          <Icon name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>

        {/* TRANSACTION HISTORY */}
        <Text style={styles.sectionTitle}>{t.transactionHistory}</Text>
        <View style={styles.txList}>
          {txns.isLoading ? (
            <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xl }} />
          ) : (txns.data?.items.length ?? 0) === 0 ? (
            <View style={styles.empty} testID="earnings-empty">
              <Icon name="receipt-outline" size={28} color={colors.muted} />
              <Text style={styles.emptyText}>{t.noTransactions}</Text>
            </View>
          ) : (
            txns.data!.items.map((it) => <TxRow key={it.transaction_id} it={it} t={t} />)
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function TxRow({ it, t }: { it: LedgerEntry; t: any }) {
  const isReversal = it.type === "reversal";
  const amountColor = isReversal ? colors.error : colors.success;
  const sign = isReversal ? "−" : "+";
  const label =
    it.source === "gift" ? t.giftReceived :
    it.source === "refund" ? t.refundLabel :
    it.source;
  return (
    <View style={styles.txRow} testID={`tx-${it.transaction_id}`}>
      <View style={[styles.txIcon, { backgroundColor: isReversal ? colors.error + "22" : colors.success + "22" }]}>
        <Icon name={isReversal ? "arrow-undo" : "gift"} size={18} color={isReversal ? colors.error : colors.success} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.txLabel} numberOfLines={1}>{label}</Text>
          <View style={[styles.badge, { borderColor: statusColor(it.status), backgroundColor: statusColor(it.status) + "22" }]}>
            <Text style={[styles.badgeText, { color: statusColor(it.status) }]}>{it.status}</Text>
          </View>
        </View>
        <Text style={styles.txSub} numberOfLines={1}>
          {fmtDate(it.created_at)} · {it.reference_id.slice(0, 10)}…
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Text style={[styles.txAmount, { color: amountColor }]}>{sign}{fmt(Math.abs(it.host_amount))}</Text>
          <Diamond size={12} />
        </View>
        <Text style={styles.txGross}>of {fmt(Math.abs(it.gross_amount))}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heroLabel: { color: colors.muted, fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: "700" },
  heroAmountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  heroAmount: { color: colors.onSurface, fontSize: 36, fontWeight: "900" },
  heroHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  statCard: {
    flex: 1, backgroundColor: colors.surface, padding: spacing.md,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  statValueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  statValue: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  agencyCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md,
    borderRadius: radius.md, flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  agencyIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold + "22", alignItems: "center", justifyContent: "center" },
  agencyName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  agencySub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: spacing.md, borderRadius: radius.md },
  actionPrimary: { backgroundColor: colors.brandPrimary },
  actionPrimaryText: { color: colors.onBrandPrimary, fontWeight: "900" },
  actionGhost: { backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  actionGhostText: { color: colors.onSurface, fontWeight: "800" },
  ghostRow: { marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ghostRowText: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  sectionTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800", marginHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: 0.4 },
  txList: { marginHorizontal: spacing.lg, gap: spacing.sm },
  txRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md,
  },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  txLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  txSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: "800" },
  txGross: { color: colors.muted, fontSize: 10, marginTop: 2 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1 },
  badgeText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  empty: { padding: spacing.xxl, alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
  emptyText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
});
