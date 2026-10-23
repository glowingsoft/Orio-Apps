/**
 * Iter-85 — Admin Dashboard: Overview page with key stats.
 */
import React, { useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminDashStats } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

function formatN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n ?? 0);
}

function StatCard({ icon, label, value, hint, tint, onPress }: {
  icon: string; label: string; value: string; hint?: string; tint?: string; onPress?: () => void;
}) {
  const Comp: any = onPress ? Pressable : View;
  return (
    <Comp onPress={onPress} style={[styles.stat, { borderColor: tint || colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: (tint || colors.brandPrimary) + "22" }]}>
        <Icon name={icon as any} size={20} color={tint || colors.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
        {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
      </View>
    </Comp>
  );
}

export default function AdminOverview() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cols = width >= 1200 ? 4 : width >= 800 ? 3 : width >= 500 ? 2 : 1;

  const q = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: apiAdminDashStats,
    refetchInterval: 30_000,
  });

  const refresh = useCallback(() => q.refetch(), [q]);
  const s = q.data;

  return (
    <AdminShell title="Overview">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>ORIO control center</Text>
          <Text style={styles.helloSub}>
            {s ? `Server time ${new Date(s.server_time).toLocaleString()}` : "Loading…"}
          </Text>
        </View>
        <Pressable onPress={refresh} style={adminStyles.ghostBtn}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="refresh-outline" size={14} color={colors.onSurface} />
            <Text style={adminStyles.ghostBtnText}>Refresh</Text>
          </View>
        </Pressable>
      </View>

      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} />
      ) : q.isError ? (
        <View style={adminStyles.card}>
          <Text style={{ color: colors.error }}>Failed to load stats. {(q.error as any)?.message}</Text>
          <Pressable onPress={refresh} style={[adminStyles.primaryBtn, { marginTop: spacing.md, alignSelf: "flex-start" }]}>
            <Text style={adminStyles.primaryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : s ? (
        <View style={{ gap: spacing.lg }}>
          <View style={[styles.grid, { gap: spacing.md }]}>
            <View style={{ width: `${100 / cols}%`, padding: spacing.sm }}>
              <StatCard icon="people-outline" label="Total users" value={formatN(s.users.total)}
                hint={`+${s.users.new_24h} today / +${s.users.new_7d} this week`}
                tint={colors.brandPrimary} onPress={() => router.push("/admin/users" as any)} />
            </View>
            <View style={{ width: `${100 / cols}%`, padding: spacing.sm }}>
              <StatCard icon="mic-outline" label="Rooms live" value={formatN(s.rooms.live)}
                hint={`of ${formatN(s.rooms.total)} total`}
                tint={colors.success} onPress={() => router.push("/admin/rooms" as any)} />
            </View>
            <View style={{ width: `${100 / cols}%`, padding: spacing.sm }}>
              <StatCard icon="diamond-outline" label="Diamonds in circulation" value={formatN(s.economy.diamonds)}
                hint={`${formatN(s.economy.coins)} coins`}
                tint={colors.info} onPress={() => router.push("/admin/wallet" as any)} />
            </View>
            <View style={{ width: `${100 / cols}%`, padding: spacing.sm }}>
              <StatCard icon="star-outline" label="VIP members" value={formatN(s.users.vip)}
                hint={`Levels V1–V10`}
                tint={colors.warning} onPress={() => router.push("/admin/vip" as any)} />
            </View>
            <View style={{ width: `${100 / cols}%`, padding: spacing.sm }}>
              <StatCard icon="shield-outline" label="Open reports" value={formatN(s.moderation.open_reports)}
                hint={`${s.moderation.pending_withdrawals} pending withdrawals`}
                tint={colors.error} onPress={() => router.push("/admin/reports" as any)} />
            </View>
            <View style={{ width: `${100 / cols}%`, padding: spacing.sm }}>
              <StatCard icon="shield-checkmark-outline" label="Admins" value={formatN(s.users.admins)}
                hint={`${formatN(s.users.banned)} banned users`}
                tint={colors.purple} onPress={() => router.push("/admin/users?filter=admins" as any)} />
            </View>
          </View>

          <View style={adminStyles.card}>
            <Text style={adminStyles.sectionTitle}>VIP breakdown</Text>
            <View style={styles.vipRow}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((lv) => {
                const count = s.vip_breakdown[String(lv)] || 0;
                return (
                  <View key={lv} style={styles.vipCell}>
                    <Text style={styles.vipLvl}>VIP{lv}</Text>
                    <Text style={styles.vipCount}>{formatN(count)}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={adminStyles.card}>
            <Text style={adminStyles.sectionTitle}>Quick actions</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              <Pressable onPress={() => router.push("/admin/users" as any)} style={adminStyles.primaryBtn}>
                <Text style={adminStyles.primaryBtnText}>Manage users</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/admin/rooms?filter=live" as any)} style={adminStyles.ghostBtn}>
                <Text style={adminStyles.ghostBtnText}>Live rooms</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/admin/reports?status=open" as any)} style={adminStyles.ghostBtn}>
                <Text style={adminStyles.ghostBtnText}>Open reports</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/admin/withdrawals" as any)} style={adminStyles.ghostBtn}>
                <Text style={adminStyles.ghostBtnText}>Withdrawals center</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    marginBottom: spacing.lg,
  },
  hello: { color: colors.onSurface, fontSize: 20, fontWeight: "700" },
  helloSub: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  grid: {
    flexDirection: "row", flexWrap: "wrap",
    marginHorizontal: -spacing.sm,
  },
  stat: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
  },
  statIcon: {
    width: 42, height: 42, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 2 },
  statHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  vipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  vipCell: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingVertical: 10, paddingHorizontal: spacing.md,
    minWidth: 72, alignItems: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  vipLvl: { color: colors.purple, fontSize: 12, fontWeight: "700" },
  vipCount: { color: colors.onSurface, fontSize: 16, fontWeight: "700", marginTop: 2 },
});
