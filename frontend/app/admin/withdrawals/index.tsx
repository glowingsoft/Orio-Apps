import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiAdminListWithdrawals } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const FILTERS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "REQUESTED", label: "New" },
  { key: "UNDER_REVIEW", label: "Review" },
  { key: "APPROVED", label: "Approved" },
  { key: "PROCESSING", label: "Processing" },
  { key: "PAID", label: "Paid" },
  { key: "REJECTED", label: "Rejected" },
  { key: "FAILED", label: "Failed" },
  { key: "RETURNED", label: "Returned" },
];
const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#4FC3F7", UNDER_REVIEW: "#4FC3F7", HOLD: "#FFB74D",
  NEEDS_INFORMATION: "#FFB74D", APPROVED: "#81C784", PROCESSING: "#64B5F6",
  PAID: "#4CAF50", REJECTED: "#E57373", CANCELLED: "#9E9E9E",
  FAILED: "#E57373", RETURNED: "#B39DDB",
};

function fmtDate(iso?: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return iso; }
}

export default function AdminWithdrawalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const list = useQuery({ queryKey: ["admin", "withdrawals", filter], queryFn: () => apiAdminListWithdrawals(filter, undefined, 200) });

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await list.refetch(); setRefreshing(false);
  }, [list]);

  return (
    <View style={styles.root} testID="admin-withdrawals-screen">
      <Stack.Screen options={{ title: t.adminWithdrawalCenter, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.label}
            style={[styles.filter, filter === f.key && styles.filterActive]}
            onPress={() => setFilter(f.key)}
            testID={`filter-${f.label.toLowerCase()}`}
          >
            <Text style={[styles.filterText, filter === f.key && { color: colors.onBrandPrimary }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.onSurface} />}
      >
        {list.isLoading ? <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} /> :
          (list.data?.items.length ?? 0) === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No withdrawals</Text></View>
          ) : (
            <View style={styles.list}>
              {list.data!.items.map((w) => {
                const col = STATUS_COLORS[w.status] ?? colors.muted;
                return (
                  <Pressable
                    key={w.id}
                    style={styles.row}
                    onPress={() => router.push(`/admin/withdrawals/${w.id}` as any)}
                    testID={`admin-wrow-${w.id}`}
                  >
                    <View style={styles.rowIcon}><Icon name="cash" size={18} color={col} /></View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.rowTitle}>${w.amount_usd}</Text>
                        <View style={[styles.pill, { backgroundColor: col + "22", borderColor: col }]}>
                          <Text style={[styles.pillText, { color: col }]}>{w.status.replace(/_/g, " ")}</Text>
                        </View>
                        <View style={styles.ownerPill}><Text style={styles.ownerText}>{w.owner_type.toUpperCase()}</Text></View>
                      </View>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {w.method_label} · {w.destination_hint || "—"}
                      </Text>
                      <Text style={styles.rowDate}>
                        {fmtDate(w.requested_at)} · User {w.user_id.slice(0, 8)}…
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
  filter: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  filterActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurface, fontWeight: "700", fontSize: 11 },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowDate: { color: colors.muted, fontSize: 10, marginTop: 2 },
  pill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1 },
  pillText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  ownerPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.gold + "33" },
  ownerText: { color: colors.gold, fontSize: 9, fontWeight: "900" },
  empty: { padding: spacing.xxxl, alignItems: "center" },
  emptyText: { color: colors.muted, fontSize: 12 },
});
