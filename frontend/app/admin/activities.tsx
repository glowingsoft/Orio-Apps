/**
 * Iter-98 — Admin: Activity Applications review (approve / reject).
 */
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminRoomEvents, apiAdminRoomEventDecision } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

const TABS = ["pending", "approved", "rejected"];

export default function AdminActivities() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const q = useQuery({ queryKey: ["admin", "room-events", status], queryFn: () => apiAdminRoomEvents(status) });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => apiAdminRoomEventDecision(id, approve),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "room-events"] }),
  });
  const items = q.data?.items || [];

  return (
    <AdminShell title="Activity Applications">
      <View style={styles.toolbar}>
        {TABS.map((s) => (
          <Pressable key={s} onPress={() => setStatus(s)} style={[styles.pill, status === s && { backgroundColor: colors.brandPrimary }]}>
            <Text style={styles.pillText}>{s[0].toUpperCase() + s.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {q.isLoading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} /> :
        items.length === 0 ? <Text style={styles.muted}>No {status} applications.</Text> : items.map((e: any) => (
          <View key={e.id} style={adminStyles.rowCard}>
            <Image source={{ uri: e.image_url }} style={styles.cover} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name}>{e.name}</Text>
              <Text style={styles.muted}>Room: {e.room_name || e.room_id} · {e.start_at ? new Date(e.start_at).toLocaleDateString() : ""}</Text>
            </View>
            {status === "pending" && (
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Pressable disabled={decide.isPending} onPress={() => decide.mutate({ id: e.id, approve: true })} style={adminStyles.primaryBtn}>
                  <Text style={adminStyles.primaryBtnText}>Approve</Text>
                </Pressable>
                <Pressable disabled={decide.isPending} onPress={() => decide.mutate({ id: e.id, approve: false })} style={adminStyles.dangerBtn}>
                  <Text style={adminStyles.dangerBtnText}>Reject</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  pillText: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 12 },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  cover: { width: 96, height: 54, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
});
