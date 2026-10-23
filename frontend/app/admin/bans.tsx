/**
 * Iter-118 — Admin: active & historical bans.
 */
import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { adminP1 } from "@/src/api";
import { colors, spacing } from "@/src/theme";

export default function AdminBans() {
  const router = useRouter();
  const [active, setActive] = useState(true);
  const q = useQuery({ queryKey: ["admin", "bans", active], queryFn: () => adminP1.bans(active), refetchInterval: 10_000 });
  return (
    <AdminShell title="Bans">
      <View style={{ flexDirection: "row", gap: 8, marginBottom: spacing.md }}>
        {[true, false].map((a) => (
          <Pressable key={String(a)} testID={`bans-filter-${a ? "active" : "all"}`} onPress={() => setActive(a)} style={[adminStyles.ghostBtn, active === a && { borderColor: colors.brandPrimary }]}>
            <Text style={adminStyles.ghostBtnText}>{a ? "Active" : "All history"}</Text>
          </Pressable>
        ))}
      </View>
      {q.isLoading ? <ActivityIndicator color={colors.brandPrimary} /> : (q.data?.items || []).length === 0 ? (
        <Text style={{ color: colors.muted }}>No bans.</Text>
      ) : (q.data?.items || []).map((b: any) => (
        <Pressable key={b.id} testID={`ban-row-${b.id}`} onPress={() => router.push(`/admin/user/${b.user_id}` as any)} style={adminStyles.rowCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{b.nickname || b.user_id} · ID {b.numeric_id || "—"}</Text>
            <Text style={styles.meta}>{b.type} · until {b.expires_at ? new Date(b.expires_at).toLocaleString() : "PERMANENT"} · {b.active ? "ACTIVE" : b.ended_reason} · by {b.created_by}</Text>
            <Text style={styles.meta}>“{b.reason}” · {new Date(b.created_at).toLocaleString()}</Text>
          </View>
        </Pressable>
      ))}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.onSurface, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
