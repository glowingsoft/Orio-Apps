/**
 * Iter-86 — Admin Team management (Owner only).
 * Add/update/disable/remove admins with per-permission checkboxes.
 */
import React, { useState } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView, TextInput,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import {
  apiAdminTeamList, apiAdminTeamAdd, apiAdminTeamPatch, apiAdminTeamRemove,
  type AdminTeamMember,
} from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

const GROUPS: { label: string; perms: { key: string; label: string }[] }[] = [
  { label: "Users", perms: [
    { key: "users.view", label: "View users" },
    { key: "users.manage", label: "Manage users" },
    { key: "users.ban", label: "Ban / unban users" },
    { key: "users.edit_profile", label: "Edit user profiles" },
    { key: "users.levels", label: "Adjust VIP / Wealth / Charm levels" },
    { key: "users.sessions", label: "Sign out user sessions" },
  ]},
  { label: "Bans", perms: [
    { key: "bans.view", label: "View bans" },
    { key: "bans.manage", label: "Create / remove bans" },
  ]},
  { label: "Messages", perms: [
    { key: "messages.review", label: "Review messages (report-linked, audited)" },
  ]},
  { label: "Rooms", perms: [
    { key: "rooms.view", label: "View rooms" },
    { key: "rooms.manage", label: "Manage rooms" },
    { key: "rooms.lock", label: "Lock rooms" },
    { key: "rooms.close", label: "Close rooms" },
  ]},
  { label: "Reports", perms: [
    { key: "reports.view", label: "View reports" },
    { key: "reports.resolve", label: "Resolve reports" },
    { key: "reports.dismiss", label: "Dismiss reports" },
    { key: "reports.ban", label: "Ban reported users" },
  ]},
  { label: "VIP", perms: [
    { key: "vip.view", label: "View VIP" },
    { key: "vip.manage", label: "Manage VIP" },
  ]},
  { label: "Wallet", perms: [
    { key: "wallet.view", label: "View wallet" },
    { key: "wallet.adjust", label: "Adjust wallet" },
  ]},
  { label: "Withdrawals", perms: [
    { key: "withdrawals.view", label: "View withdrawals" },
    { key: "withdrawals.approve", label: "Approve withdrawals" },
    { key: "withdrawals.reject", label: "Reject withdrawals" },
  ]},
  { label: "Audit", perms: [
    { key: "audit.view", label: "View audit log" },
  ]},
];

export default function AdminTeamScreen() {
  const [editing, setEditing] = useState<AdminTeamMember | "new" | null>(null);

  const q = useQuery({
    queryKey: ["admin", "team"],
    queryFn: apiAdminTeamList,
    staleTime: 10_000,
  });

  if (q.isLoading) {
    return (
      <AdminShell title="Admin Team">
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} />
      </AdminShell>
    );
  }

  if (q.isError) {
    return (
      <AdminShell title="Admin Team">
        <View style={adminStyles.card}>
          <Text style={{ color: colors.error }}>
            Access denied or load failed. Only the Owner can manage the admin team.
          </Text>
          <Text style={{ color: colors.muted, marginTop: 6, fontSize: 12 }}>
            {(q.error as any)?.message}
          </Text>
        </View>
      </AdminShell>
    );
  }

  const data = q.data!;
  return (
    <AdminShell title="Admin Team">
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ownerLabel}>Current Owner</Text>
          <Text style={styles.ownerValue}>{data.owner_email}</Text>
        </View>
        <Pressable onPress={() => setEditing("new")} style={adminStyles.primaryBtn}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="add-outline" size={16} color={colors.onBrandPrimary} />
            <Text style={adminStyles.primaryBtnText}>Add Admin</Text>
          </View>
        </Pressable>
      </View>

      {data.items.length === 0 ? (
        <View style={[adminStyles.card, { marginTop: spacing.lg }]}>
          <Text style={{ color: colors.onSurfaceSecondary }}>
            No approved admins yet. Add one to delegate specific permissions.
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          {data.items.map((a) => (
            <TeamRow key={a.email} admin={a} onEdit={() => setEditing(a)} />
          ))}
        </View>
      )}

      <TeamEditor
        member={editing}
        onClose={() => setEditing(null)}
      />
    </AdminShell>
  );
}

function TeamRow({ admin, onEdit }: { admin: AdminTeamMember; onEdit: () => void }) {
  return (
    <View style={adminStyles.rowCard}>
      <View style={[styles.avatar, { backgroundColor: admin.enabled ? colors.brandPrimary : colors.muted }]}>
        <Icon name="shield-outline" size={18} color={colors.onBrandPrimary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={styles.email} numberOfLines={1}>{admin.email}</Text>
          <View style={[adminStyles.badge, {
            backgroundColor: (admin.enabled ? colors.success : colors.muted) + "22",
          }]}>
            <Text style={[adminStyles.badgeText, { color: admin.enabled ? colors.success : colors.muted }]}>
              {admin.enabled ? "ENABLED" : "DISABLED"}
            </Text>
          </View>
        </View>
        <Text style={styles.perms} numberOfLines={2}>
          {admin.permissions.length === 0
            ? "No permissions granted"
            : admin.permissions.join(" · ")}
        </Text>
      </View>
      <Pressable onPress={onEdit} style={adminStyles.ghostBtn}>
        <Text style={adminStyles.ghostBtnText}>Manage</Text>
      </Pressable>
    </View>
  );
}

function TeamEditor({ member, onClose }: {
  member: AdminTeamMember | "new" | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isNew = member === "new";
  const existing = isNew ? null : (member as AdminTeamMember | null);

  const [email, setEmail] = useState(existing?.email || "");
  const [checked, setChecked] = useState<Set<string>>(new Set(existing?.permissions || []));
  const [confirmDel, setConfirmDel] = useState(false);

  React.useEffect(() => {
    if (member === "new") {
      setEmail(""); setChecked(new Set()); setConfirmDel(false);
    } else if (member) {
      setEmail(member.email); setChecked(new Set(member.permissions || [])); setConfirmDel(false);
    }
  }, [member]);

  const toggle = (perm: string) => {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(perm)) next.delete(perm); else next.add(perm);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const perms = Array.from(checked);
      if (isNew) {
        return apiAdminTeamAdd(email.trim(), perms);
      }
      return apiAdminTeamPatch(existing!.email, { permissions: perms });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "team"] }); onClose(); },
  });

  const toggleEnabled = useMutation({
    mutationFn: () => apiAdminTeamPatch(existing!.email, { enabled: !existing!.enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "team"] }); onClose(); },
  });

  const remove = useMutation({
    mutationFn: () => apiAdminTeamRemove(existing!.email),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "team"] }); onClose(); },
  });

  if (!member) return null;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Modal transparent animationType="fade" visible={!!member} onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.modal}>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.modalTitle}>{isNew ? "Add Admin" : "Manage Admin"}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={onClose}>
                <Icon name="close-outline" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="moderator@example.com"
                placeholderTextColor={colors.muted}
                editable={isNew}
                style={[adminStyles.input, !isNew && { opacity: 0.65 }]}
              />
            </View>

            <Text style={[adminStyles.sectionTitle, { marginTop: spacing.lg }]}>Permissions</Text>
            {GROUPS.map((g) => (
              <View key={g.label} style={styles.groupCard}>
                <Text style={styles.groupLabel}>{g.label}</Text>
                {g.perms.map((p) => {
                  const on = checked.has(p.key);
                  return (
                    <Pressable
                      key={p.key}
                      onPress={() => toggle(p.key)}
                      style={styles.permRow}
                    >
                      <View style={[styles.checkbox, on && styles.checkboxOn]}>
                        {on && <Icon name="checkmark-outline" size={14} color={colors.onBrandPrimary} />}
                      </View>
                      <Text style={styles.permLabel}>{p.label}</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={styles.permKey}>{p.key}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {save.isError && (
              <Text style={{ color: colors.error, marginTop: 8 }}>
                {(save.error as any)?.message || "Save failed"}
              </Text>
            )}

            <Pressable
              onPress={() => save.mutate()}
              disabled={save.isPending || (isNew && !emailValid)}
              style={[adminStyles.primaryBtn, { marginTop: spacing.lg, alignSelf: "stretch", alignItems: "center" }]}>
              {save.isPending
                ? <ActivityIndicator color={colors.onBrandPrimary} />
                : <Text style={adminStyles.primaryBtnText}>{isNew ? "Save Admin" : "Save changes"}</Text>}
            </Pressable>

            {!isNew && existing && (
              <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                <Pressable
                  onPress={() => toggleEnabled.mutate()}
                  disabled={toggleEnabled.isPending}
                  style={adminStyles.ghostBtn}>
                  <Text style={adminStyles.ghostBtnText}>
                    {existing.enabled ? "Disable admin" : "Re-enable admin"}
                  </Text>
                </Pressable>
                {!confirmDel ? (
                  <Pressable onPress={() => setConfirmDel(true)} style={adminStyles.dangerBtn}>
                    <Text style={adminStyles.dangerBtnText}>Remove admin</Text>
                  </Pressable>
                ) : (
                  <View style={styles.confirmBox}>
                    <Text style={{ color: colors.onSurface, marginBottom: 6, fontSize: 13 }}>
                      This will revoke admin access immediately. The user{"\u2019"}s normal
                      Yazeen account will NOT be deleted. Continue?
                    </Text>
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <Pressable onPress={() => remove.mutate()} disabled={remove.isPending} style={adminStyles.dangerBtn}>
                        <Text style={adminStyles.dangerBtnText}>{remove.isPending ? "Removing…" : "Yes, remove"}</Text>
                      </Pressable>
                      <Pressable onPress={() => setConfirmDel(false)} style={adminStyles.ghostBtn}>
                        <Text style={adminStyles.ghostBtnText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  ownerLabel: {
    color: colors.onSurfaceSecondary, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  ownerValue: { color: colors.purple, fontSize: 16, fontWeight: "700", marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  email: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  perms: { color: colors.muted, fontSize: 11, marginTop: 4 },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  modal: {
    width: "100%", maxWidth: 640, maxHeight: "92%",
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "700" },
  fieldLabel: {
    color: colors.onSurfaceSecondary, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
  },
  groupCard: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  groupLabel: {
    color: colors.purple, fontSize: 11, textTransform: "uppercase",
    letterSpacing: 1, fontWeight: "700", marginBottom: spacing.sm,
  },
  permRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 6,
  },
  checkbox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkboxOn: {
    backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary,
  },
  permLabel: { color: colors.onSurface, fontSize: 13 },
  permKey: { color: colors.muted, fontSize: 11, fontFamily: "monospace" } as any,
  confirmBox: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
    padding: spacing.md,
  },
});
