import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiListRechargeAgents, apiListMyRechargeAgentTxs } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { Diamond } from "@/src/components/Diamond";

export default function RechargeAgentCenterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const agents = useQuery({ queryKey: ["recharge-agents"], queryFn: apiListRechargeAgents });
  const txs = useQuery({ queryKey: ["my-recharge-agent-txs"], queryFn: () => apiListMyRechargeAgentTxs(50) });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([agents.refetch(), txs.refetch()]);
    setRefreshing(false);
  }, [agents, txs]);

  return (
    <View style={styles.root} testID="recharge-agent-center">
      <Stack.Screen
        options={{
          title: t.rechargeAgentCenter,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.onSurface,
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl, paddingTop: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.onSurface} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Icon name="briefcase" size={30} color={colors.gold} />
          </View>
          <Text style={styles.heroTitle}>{t.financialIntermediary}</Text>
          <Text style={styles.heroSub}>{t.rechargeAgentIntro}</Text>
          <View style={styles.warnBox}>
            <Icon name="alert-circle" size={14} color={colors.warning} />
            <Text style={styles.warnText}>{t.rechargeAgentWarn}</Text>
          </View>
        </View>

        {/* Agents */}
        <Text style={styles.sectionTitle}>{t.chooseAgent}</Text>
        {agents.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xl }} />
        ) : (agents.data?.items.length ?? 0) === 0 ? (
          <View style={styles.empty}>
            <Icon name="person-remove" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>{t.noActiveAgents}</Text>
          </View>
        ) : (
          <View style={styles.agentList}>
            {agents.data!.items.map((a) => (
              <Pressable
                key={a.id}
                style={styles.agentCard}
                onPress={() => router.push(`/recharge-agent/new?agent_id=${a.id}` as any)}
                testID={`agent-${a.id}`}
              >
                <View style={styles.agentIcon}>
                  <Icon name="person-circle" size={30} color={colors.gold} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.agentName}>{a.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <View style={styles.codeBadge}>
                      <Text style={styles.codeText}>#{a.agent_code}</Text>
                    </View>
                    {a.country && <Text style={styles.subMeta}>{a.country}</Text>}
                  </View>
                  {a.contact && <Text style={styles.subMeta} numberOfLines={1}>{t.agentContact}: {a.contact}</Text>}
                </View>
                <Icon name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        )}

        {/* History */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>{t.rechargeHistory}</Text>
        {txs.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xl }} />
        ) : (txs.data?.items.length ?? 0) === 0 ? (
          <View style={styles.empty}>
            <Icon name="receipt-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>{t.noRechargeHistory}</Text>
          </View>
        ) : (
          <View style={styles.txList}>
            {txs.data!.items.map((tx) => (
              <Pressable
                key={tx.id}
                style={styles.txCard}
                onPress={() => router.push(`/recharge-agent/${tx.id}` as any)}
                testID={`tx-${tx.id}`}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 }}>
                  <View style={[styles.statusDot, tx.status === "verified" ? { backgroundColor: colors.success } : tx.status === "rejected" ? { backgroundColor: colors.error } : { backgroundColor: colors.warning }]} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Diamond size={14} />
                      <Text style={styles.txAmount}>{(tx.amount_usd * 9999).toLocaleString()}</Text>
                      <Text style={styles.txUsd}>(${tx.amount_usd})</Text>
                    </View>
                    <Text style={styles.txMeta} numberOfLines={1}>
                      {tx.agent?.name ?? "Agent"} · #{tx.agent?.agent_code ?? "—"}
                    </Text>
                    <Text style={styles.txMeta} numberOfLines={1}>TX: {tx.agent_tx_id}</Text>
                  </View>
                </View>
                <View style={[styles.statusPill, tx.status === "verified" ? { backgroundColor: colors.success + "22" } : tx.status === "rejected" ? { backgroundColor: colors.error + "22" } : { backgroundColor: colors.warning + "22" }]}>
                  <Text style={[styles.statusText, { color: tx.status === "verified" ? colors.success : tx.status === "rejected" ? colors.error : colors.warning }]}>
                    {tx.status === "verified" ? t.statusVerified : tx.status === "rejected" ? t.statusRejected : t.statusPending}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold + "33",
  },
  heroIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.gold + "22",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  heroTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900", textAlign: "center" },
  heroSub: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 },
  warnBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.warning + "15",
  },
  warnText: { color: colors.onSurface, fontSize: 11, flex: 1 },
  sectionTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "900",
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  empty: { marginHorizontal: spacing.lg, padding: spacing.xl, alignItems: "center", gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: "center" },
  agentList: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  agentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  agentIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold + "22", alignItems: "center", justifyContent: "center" },
  agentName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  codeBadge: { backgroundColor: colors.gold + "33", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  codeText: { color: colors.gold, fontSize: 10, fontWeight: "900" },
  subMeta: { color: colors.muted, fontSize: 11 },
  txList: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  txCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  txAmount: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  txUsd: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  txMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: 10, fontWeight: "900" },
});
