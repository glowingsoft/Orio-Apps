/**
 * Iter-85 — Admin Dashboard: Users management.
 */
import React, { useState } from "react";
import {
  View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Image, Modal, ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminDashUsers, apiAdminDashPatchUser, AdminUser } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "new", label: "New (7d)" },
  { key: "vip", label: "VIP" },
  { key: "admins", label: "Admins" },
  { key: "banned", label: "Banned" },
];

export default function AdminUsers() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<string>(params.filter || "all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const q = useQuery({
    queryKey: ["admin", "users", debounced, filter],
    queryFn: () => apiAdminDashUsers({ q: debounced || undefined, filter: filter === "all" ? undefined : filter, limit: 100 }),
    staleTime: 10_000,
  });

  const items = q.data?.items || [];

  return (
    <AdminShell title="Users">
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Icon name="search-outline" size={16} color={colors.onSurfaceSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search email, username, nickname, or numeric ID…"
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
        <Text style={{ color: colors.muted, marginTop: 48, textAlign: "center" }}>No users match.</Text>
      ) : (
        <View>
          <Text style={styles.count}>{q.data?.total ?? 0} users</Text>
          {items.map((u) => <UserRow key={u.id} user={u} onEdit={() => setEditing(u)} />)}
        </View>
      )}

      <EditUserModal user={editing} onClose={() => setEditing(null)} />
    </AdminShell>
  );
}

function Badge({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <View style={[adminStyles.badge, { backgroundColor: bg }]}>
      <Text style={[adminStyles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

function UserRow({ user, onEdit }: { user: AdminUser; onEdit: () => void }) {
  const router = useRouter();
  return (
    <View style={adminStyles.rowCard}>
      {user.avatar_url ? (
        <Image source={{ uri: user.avatar_url }} style={adminStyles.avatar} />
      ) : (
        <View style={[adminStyles.avatar, { backgroundColor: colors.brandPrimary }]} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={styles.userName} numberOfLines={1}>{user.nickname}</Text>
          <Text style={styles.userHandle}>@{user.username}</Text>
          {user.vip_level > 0 && <Badge text={`VIP${user.vip_level}`} bg={colors.warning + "22"} fg={colors.warning} />}
          {user.is_banned && <Badge text="BANNED" bg={colors.error + "22"} fg={colors.error} />}
        </View>
        <Text style={styles.userMeta} numberOfLines={1}>
          {user.email} · ID {user.numeric_id || "—"} · 💎 {user.diamonds} · 🪙 {user.coins}
        </Text>
      </View>
      <Pressable testID={`admin-user-detail-${user.id}`} onPress={() => router.push(`/admin/user/${user.id}` as any)} style={adminStyles.primaryBtn}>
        <Text style={adminStyles.primaryBtnText}>Details</Text>
      </Pressable>
      <Pressable onPress={onEdit} style={adminStyles.ghostBtn}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="create-outline" size={14} color={colors.onSurface} />
          <Text style={adminStyles.ghostBtnText}>Manage</Text>
        </View>
      </Pressable>
    </View>
  );
}

function EditUserModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();

  const [vipLv, setVipLv] = useState<string>("");
  const [vipDays, setVipDays] = useState<string>("");
  const [dDelta, setDDelta] = useState<string>("");
  const [cDelta, setCDelta] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  React.useEffect(() => {
    if (user) {
      setVipLv(String(user.vip_level ?? 0));
      setVipDays(""); setDDelta(""); setCDelta(""); setReason("");
    }
  }, [user]);

  const patch = useMutation({
    mutationFn: (body: any) => apiAdminDashPatchUser(user!.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      onClose();
    },
  });

  if (!user) return null;

  return (
    <Modal transparent animationType="fade" visible={!!user} onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.modal}>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              {user.avatar_url ? (
                <Image source={{ uri: user.avatar_url }} style={{ width: 56, height: 56, borderRadius: 28 }} />
              ) : (
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{user.nickname}</Text>
                <Text style={styles.userMeta}>@{user.username} · {user.email}</Text>
                <Text style={styles.userMeta}>ID {user.numeric_id || "—"}</Text>
              </View>
              <Pressable onPress={onClose}><Icon name="close-outline" size={24} color={colors.onSurface} /></Pressable>
            </View>

            <Text style={[adminStyles.sectionTitle, { marginTop: spacing.lg }]}>Status</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              <Pressable
                disabled={patch.isPending}
                onPress={() => patch.mutate({ is_banned: !user.is_banned, reason })}
                style={user.is_banned ? adminStyles.primaryBtn : adminStyles.dangerBtn}>
                <Text style={user.is_banned ? adminStyles.primaryBtnText : adminStyles.dangerBtnText}>
                  {user.is_banned ? "Unban user" : "Ban user"}
                </Text>
              </Pressable>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>
              Admin access is managed from the Admin Team page.
            </Text>

            <Text style={[adminStyles.sectionTitle, { marginTop: spacing.xl }]}>VIP</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Level (0–10)</Text>
                <TextInput value={vipLv} onChangeText={setVipLv} keyboardType="number-pad" style={adminStyles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Days to add</Text>
                <TextInput value={vipDays} onChangeText={setVipDays} keyboardType="number-pad" placeholder="30" placeholderTextColor={colors.muted} style={adminStyles.input} />
              </View>
            </View>
            <Pressable
              disabled={patch.isPending}
              onPress={() => patch.mutate({
                vip_level: Math.max(0, Math.min(10, parseInt(vipLv || "0", 10) || 0)),
                vip_days: parseInt(vipDays || "0", 10) || undefined,
                reason,
              })}
              style={[adminStyles.primaryBtn, { marginTop: spacing.sm, alignSelf: "flex-start" }]}>
              <Text style={adminStyles.primaryBtnText}>Apply VIP</Text>
            </Pressable>

            <Text style={[adminStyles.sectionTitle, { marginTop: spacing.xl }]}>Wallet adjustments (ledger-tracked)</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Diamonds Δ</Text>
                <TextInput value={dDelta} onChangeText={setDDelta} keyboardType="numbers-and-punctuation" placeholder="e.g. 500 or -100" placeholderTextColor={colors.muted} style={adminStyles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Coins Δ</Text>
                <TextInput value={cDelta} onChangeText={setCDelta} keyboardType="numbers-and-punctuation" placeholder="e.g. 1000" placeholderTextColor={colors.muted} style={adminStyles.input} />
              </View>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Reason (shown in ledger)</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder="e.g. compensation for issue #1234" placeholderTextColor={colors.muted} style={adminStyles.input} />

            <Pressable
              disabled={patch.isPending}
              onPress={() => patch.mutate({
                diamonds_delta: dDelta ? parseInt(dDelta, 10) : undefined,
                coins_delta: cDelta ? parseInt(cDelta, 10) : undefined,
                reason,
              })}
              style={[adminStyles.primaryBtn, { marginTop: spacing.md, alignSelf: "flex-start" }]}>
              {patch.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> :
                <Text style={adminStyles.primaryBtnText}>Apply wallet changes</Text>}
            </Pressable>

            {patch.isError ? (
              <Text style={{ color: colors.error, marginTop: spacing.md }}>
                {(patch.error as any)?.message || "Update failed"}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  userName: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  userHandle: { color: colors.onSurfaceSecondary, fontSize: 12 },
  userMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  modal: {
    width: "100%", maxWidth: 560, maxHeight: "90%",
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
  },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
});
