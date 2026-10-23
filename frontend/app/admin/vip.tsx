/**
 * Iter-85 — Admin Dashboard: VIP members.
 */
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { VipBadge } from "@/src/components/VipBadge";
import { apiAdminDashVip, AdminUser } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

export default function AdminVip() {
  const [minLevel, setMinLevel] = useState(1);
  const q = useQuery({
    queryKey: ["admin", "vip", minLevel],
    queryFn: () => apiAdminDashVip({ min_level: minLevel, limit: 200 }),
    staleTime: 10_000,
  });

  const items = q.data?.items || [];

  return (
    <AdminShell title="VIP Members">
      <View style={styles.toolbar}>
        <Text style={styles.hint}>Minimum VIP level:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => (
            <Pressable key={l} onPress={() => setMinLevel(l)}
              style={[styles.chip, minLevel === l && styles.chipActive]}>
              <Text style={[styles.chipText, minLevel === l && { color: colors.onBrandPrimary }]}>VIP{l}+</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} />
      ) : items.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 48, textAlign: "center" }}>No VIP members at V{minLevel}+.</Text>
      ) : (
        <View>
          <Text style={styles.count}>{q.data?.total ?? 0} VIP members at V{minLevel}+</Text>
          {items.map((u) => <VipRow key={u.id} user={u} />)}
        </View>
      )}
    </AdminShell>
  );
}

function VipRow({ user }: { user: AdminUser }) {
  const expiresLabel = user.vip_expires_at
    ? new Date(user.vip_expires_at).toLocaleDateString()
    : "No expiry";
  return (
    <View style={adminStyles.rowCard}>
      {user.avatar_url ? (
        <Image source={{ uri: user.avatar_url }} style={adminStyles.avatar} />
      ) : (
        <View style={[adminStyles.avatar, { backgroundColor: colors.brandPrimary }]} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.name} numberOfLines={1}>{user.nickname}</Text>
          {(user.vip_level ?? 0) > 0 && <VipBadge level={user.vip_level} size="sm" />}
        </View>
        <Text style={styles.meta}>@{user.username} · ID {user.numeric_id || "—"}</Text>
        <Text style={styles.meta}>Expires: {expiresLabel} · 💎 {user.diamonds}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { marginBottom: spacing.lg, gap: 8 },
  hint: { color: colors.onSurfaceSecondary, fontSize: 12 },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  count: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
});
