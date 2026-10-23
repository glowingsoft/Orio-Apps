/**
 * Iter-85 — Admin Dashboard: Rooms management.
 */
import React, { useState } from "react";
import {
  View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Image, ScrollView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminDashRooms, apiAdminDashPatchRoom, AdminRoom } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "locked", label: "Locked" },
  { key: "new", label: "New (7d)" },
];

export default function AdminRooms() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<string>(params.filter || "all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const q = useQuery({
    queryKey: ["admin", "rooms", debounced, filter],
    queryFn: () => apiAdminDashRooms({ q: debounced || undefined, filter: filter === "all" ? undefined : filter, limit: 100 }),
    staleTime: 10_000,
  });

  const items = q.data?.items || [];

  return (
    <AdminShell title="Rooms">
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Icon name="search-outline" size={16} color={colors.onSurfaceSecondary} />
          <TextInput
            value={query} onChangeText={setQuery}
            placeholder="Search by room title or owner…"
            placeholderTextColor={colors.muted}
            style={[adminStyles.input, { flex: 1, backgroundColor: "transparent", borderWidth: 0, paddingVertical: 10 }]}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {FILTERS.map((f) => (
            <Pressable key={f.key} onPress={() => setFilter(f.key)}
              style={[styles.pill, filter === f.key && styles.pillActive]}>
              <Text style={[styles.pillText, filter === f.key && { color: colors.onBrandPrimary }]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} />
      ) : items.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 48, textAlign: "center" }}>No rooms match.</Text>
      ) : (
        <View>
          <Text style={styles.count}>{q.data?.total ?? 0} rooms</Text>
          {items.map((r) => <RoomRow key={r.id} room={r} />)}
        </View>
      )}
    </AdminShell>
  );
}

function RoomRow({ room }: { room: AdminRoom }) {
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (body: any) => apiAdminDashPatchRoom(room.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "rooms"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
  });

  return (
    <View style={adminStyles.rowCard}>
      {room.cover_url ? (
        <Image source={{ uri: room.cover_url }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, { backgroundColor: colors.brandPrimary }]} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={styles.title} numberOfLines={1}>{room.title || room.name || "Untitled"}</Text>
          {room.is_live ? (
            <View style={[adminStyles.badge, { backgroundColor: colors.success + "22" }]}>
              <Text style={[adminStyles.badgeText, { color: colors.success }]}>LIVE</Text>
            </View>
          ) : (
            <View style={[adminStyles.badge, { backgroundColor: colors.muted + "22" }]}>
              <Text style={[adminStyles.badgeText, { color: colors.muted }]}>OFFLINE</Text>
            </View>
          )}
          {room.is_locked && (
            <View style={[adminStyles.badge, { backgroundColor: colors.warning + "22" }]}>
              <Text style={[adminStyles.badgeText, { color: colors.warning }]}>LOCKED</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          Owner: {room.owner_nickname || room.owner_username || "?"} · {room.num_seats} seats · {room.listeners_count} listeners
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {room.is_live && (
          <Pressable
            disabled={patch.isPending}
            onPress={() => patch.mutate({ is_live: false, reason: "Admin closed" })}
            style={adminStyles.dangerBtn}>
            <Text style={adminStyles.dangerBtnText}>{patch.isPending ? "…" : "Close"}</Text>
          </Pressable>
        )}
        <Pressable
          disabled={patch.isPending}
          onPress={() => patch.mutate({ is_locked: !room.is_locked })}
          style={adminStyles.ghostBtn}>
          <Text style={adminStyles.ghostBtnText}>{room.is_locked ? "Unlock" : "Lock"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: spacing.sm, marginBottom: spacing.lg },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  count: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  cover: { width: 48, height: 48, borderRadius: 8 },
  title: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 11, marginTop: 4 },
});
