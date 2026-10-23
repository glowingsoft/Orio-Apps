/**
 * Iter-85 — Admin Dashboard: Wallet & Diamonds (recent transactions).
 */
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminDashTxs, AdminTx } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

const CURRENCY_TABS = [
  { key: "", label: "All" },
  { key: "diamonds", label: "Diamonds" },
  { key: "coins", label: "Coins" },
];

export default function AdminWallet() {
  const [currency, setCurrency] = useState("");
  const q = useQuery({
    queryKey: ["admin", "txs", currency],
    queryFn: () => apiAdminDashTxs({ currency: currency || undefined, limit: 200 }),
    staleTime: 10_000,
  });

  const items = q.data?.items || [];

  return (
    <AdminShell title="Wallet & Diamonds">
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {CURRENCY_TABS.map((c) => (
            <Pressable key={c.key} onPress={() => setCurrency(c.key)}
              style={[styles.pill, currency === c.key && styles.pillActive]}>
              <Text style={[styles.pillText, currency === c.key && { color: colors.onBrandPrimary }]}>{c.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} />
      ) : items.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 48, textAlign: "center" }}>No transactions yet.</Text>
      ) : (
        <View>
          <Text style={styles.count}>{q.data?.total ?? 0} transactions · showing latest {items.length}</Text>
          {items.map((tx) => <TxRow key={tx.id} tx={tx} />)}
        </View>
      )}
    </AdminShell>
  );
}

function TxRow({ tx }: { tx: AdminTx }) {
  const positive = (tx.amount ?? 0) >= 0;
  const sign = positive ? "+" : "";
  const icon = tx.currency === "diamonds" ? "diamond-outline" : "cash-outline";
  const color = positive ? colors.success : colors.error;
  return (
    <View style={adminStyles.rowCard}>
      <View style={[styles.iconWrap, { backgroundColor: color + "22" }]}>
        <Icon name={icon as any} size={18} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.type} numberOfLines={1}>{tx.type}</Text>
          <View style={[adminStyles.badge, { backgroundColor: colors.surfaceTertiary }]}>
            <Text style={[adminStyles.badgeText, { color: colors.onSurfaceSecondary }]}>{tx.currency}</Text>
          </View>
          {tx.status && tx.status !== "completed" && (
            <View style={[adminStyles.badge, { backgroundColor: colors.warning + "22" }]}>
              <Text style={[adminStyles.badgeText, { color: colors.warning }]}>{tx.status}</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={2}>
          {tx.description || "—"} · user {tx.user_id?.slice(-6)} · {tx.created_at ? new Date(tx.created_at).toLocaleString() : ""}
        </Text>
      </View>
      <Text style={[styles.amount, { color }]}>{sign}{tx.amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { marginBottom: spacing.lg },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  count: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  type: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  amount: { fontSize: 15, fontWeight: "800" },
});
