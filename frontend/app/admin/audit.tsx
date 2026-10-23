/**
 * Iter-85 — Admin Dashboard: Audit log.
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { adminP1 } from "@/src/api";
import { colors, spacing } from "@/src/theme";

export default function AdminAudit() {
  const router = useRouter();
  // Iter-118 — searchable audit: text, action prefix, admin email, user id, date range (ISO, to the second).
  const [f, setF] = useState({ q: "", action: "", admin_email: "", target_user_id: "", date_from: "", date_to: "" });
  const [applied, setApplied] = useState(f);
  const q = useQuery({
    queryKey: ["admin", "audit", applied],
    queryFn: () => adminP1.audit({ ...applied, limit: "200" }),
    refetchInterval: 15_000,
  });

  const items = q.data?.items || [];

  return (
    <AdminShell title="Audit Log">
      <View style={styles.filters} testID="audit-filters">
        {([
          ["q", "Search text"], ["action", "Action (e.g. bans, wallet)"], ["admin_email", "Admin email"],
          ["target_user_id", "Target user id"], ["date_from", "From (YYYY-MM-DDTHH:MM:SS)"], ["date_to", "To (YYYY-MM-DDTHH:MM:SS)"],
        ] as const).map(([k, ph]) => (
          <TextInput key={k} testID={`audit-filter-${k}`} placeholder={ph} placeholderTextColor={colors.muted}
            value={(f as any)[k]} onChangeText={(v) => setF({ ...f, [k]: v })} style={[adminStyles.input, styles.fInput]} autoCapitalize="none" />
        ))}
        <Pressable testID="audit-apply" onPress={() => setApplied(f)} style={adminStyles.primaryBtn}><Text style={adminStyles.primaryBtnText}>Search</Text></Pressable>
      </View>
      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} />
      ) : items.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 48, textAlign: "center" }}>No admin actions recorded yet.</Text>
      ) : (
        <View>
          <Text style={styles.count}>{q.data?.total ?? 0} actions · showing latest {items.length}</Text>
          {items.map((a: any) => (
            <View key={a.id} style={adminStyles.rowCard}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={styles.actor} numberOfLines={1}>
                    {a.admin_email || `Admin ${a.admin_id?.slice(-6) || "?"}`}
                  </Text>
                  {a.target_user_id && (
                    <Pressable testID={`audit-user-${a.id}`} onPress={() => router.push(`/admin/user/${a.target_user_id}` as any)} style={[adminStyles.badge, { backgroundColor: colors.brandPrimary + "22" }]}>
                      <Text style={[adminStyles.badgeText, { color: colors.brandPrimary }]}>
                        USER {a.target_user_id.slice(-6)}
                      </Text>
                    </Pressable>
                  )}
                  {a.target_room_id && (
                    <View style={[adminStyles.badge, { backgroundColor: colors.success + "22" }]}>
                      <Text style={[adminStyles.badgeText, { color: colors.success }]}>
                        ROOM {a.target_room_id.slice(-6)}
                      </Text>
                    </View>
                  )}
                  {a.target_report_id && (
                    <View style={[adminStyles.badge, { backgroundColor: colors.warning + "22" }]}>
                      <Text style={[adminStyles.badgeText, { color: colors.warning }]}>
                        REPORT {a.target_report_id.slice(-6)}
                      </Text>
                    </View>
                  )}
                  {a.action && (
                    <View style={[adminStyles.badge, { backgroundColor: colors.error + "22" }]}>
                      <Text style={[adminStyles.badgeText, { color: colors.error }]}>{a.action}</Text>
                    </View>
                  )}
                </View>
                {a.before != null && (
                  <Text style={styles.detail} numberOfLines={3}>before: {JSON.stringify(a.before)}</Text>
                )}
                {a.after != null && (
                  <Text style={styles.detail} numberOfLines={3}>{a.before != null ? "after: " : ""}{JSON.stringify(a.after)}</Text>
                )}
                {a.note ? <Text style={styles.note}>“{a.note}”</Text> : null}
                <Text style={styles.ts}>{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md, alignItems: "center" },
  fInput: { minWidth: 200, flexGrow: 1 },
  count: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  actor: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  detail: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: 4, fontFamily: "monospace" } as any,
  note: { color: colors.purple, fontSize: 12, fontStyle: "italic", marginTop: 2 },
  ts: { color: colors.muted, fontSize: 10, marginTop: 4 },
});
