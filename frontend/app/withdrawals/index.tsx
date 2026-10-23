import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiListMyWithdrawals, type WithdrawalRow } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#4FC3F7", UNDER_REVIEW: "#4FC3F7", HOLD: "#FFB74D",
  NEEDS_INFORMATION: "#FFB74D", APPROVED: "#81C784", PROCESSING: "#64B5F6",
  PAID: "#4CAF50", REJECTED: "#E57373", CANCELLED: "#9E9E9E",
  FAILED: "#E57373", RETURNED: "#B39DDB",
};

function statusLabel(s: WithdrawalRow["status"], t: any): string {
  const map: Record<string, string> = {
    REQUESTED: t.inReview, UNDER_REVIEW: t.inReview, HOLD: t.holdLabel,
    NEEDS_INFORMATION: t.needsInfoLabel, APPROVED: "Approved",
    PROCESSING: t.processingLabel, PAID: t.paidLabel, REJECTED: t.rejectedLabel,
    CANCELLED: t.cancelledLabel, FAILED: t.failedLabel, RETURNED: t.returnedLabel,
  };
  return map[s] ?? s;
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  try { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return iso; }
}

export default function MyWithdrawalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = useState(false);
  const list = useQuery({ queryKey: ["me", "withdrawals"], queryFn: () => apiListMyWithdrawals(100) });

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await list.refetch(); setRefreshing(false);
  }, [list]);

  return (
    <View style={styles.root} testID="my-withdrawals-screen">
      <Stack.Screen options={{ title: t.myWithdrawals, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.onSurface} />}
      >
        {list.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} />
        ) : (list.data?.items.length ?? 0) === 0 ? (
          <View style={styles.empty} testID="withdrawals-empty">
            <Icon name="receipt-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyTitle}>{t.noWithdrawals}</Text>
            <Text style={styles.emptySub}>{t.manualProcessing}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {list.data!.items.map((w) => {
              const col = STATUS_COLORS[w.status] ?? colors.muted;
              return (
                <Pressable
                  key={w.id}
                  style={styles.row}
                  onPress={() => router.push(`/withdrawals/${w.id}` as any)}
                  testID={`wrow-${w.id}`}
                >
                  <View style={styles.rowIcon}><Icon name="arrow-up-circle" size={20} color={col} /></View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={styles.rowTitle}>${w.amount_usd}</Text>
                      <View style={[styles.pill, { backgroundColor: col + "22", borderColor: col }]}>
                        <Text style={[styles.pillText, { color: col }]}>{statusLabel(w.status, t)}</Text>
                      </View>
                    </View>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {w.method_label} · {w.destination_hint || "—"}
                    </Text>
                    <Text style={styles.rowDate}>
                      {t.requestedOn}: {fmtDate(w.requested_at)} · {t.reviewUntil} {fmtDate(w.review_ends_at)}
                    </Text>
                  </View>
                  <Icon name="chevron-forward" size={18} color={colors.muted} />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "900" },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowDate: { color: colors.muted, fontSize: 10, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  pillText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  empty: { marginHorizontal: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, alignItems: "center", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  emptyTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  emptySub: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 },
});
