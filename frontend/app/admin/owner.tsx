/**
 * Iter-86 — Owner management (Owner only).
 * View and change the configured Owner email.
 */
import React, { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, Modal } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminGetOwner, apiAdminChangeOwner } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

export default function OwnerScreen() {
  const qc = useQueryClient();
  const [newEmail, setNewEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const q = useQuery({
    queryKey: ["admin", "owner"],
    queryFn: apiAdminGetOwner,
    staleTime: 10_000,
  });

  const change = useMutation({
    mutationFn: () => apiAdminChangeOwner(newEmail.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "owner"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      setConfirmOpen(false);
      setNewEmail("");
      // The current user may no longer be the owner — the layout will bounce
      // them to /admin/login if their email just stopped matching.
    },
  });

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim());

  return (
    <AdminShell title="Owner">
      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : q.isError ? (
        <View style={adminStyles.card}>
          <Text style={{ color: colors.error }}>Access denied.</Text>
        </View>
      ) : (
        <>
          <View style={adminStyles.card}>
            <Text style={styles.sectionLabel}>Current Owner</Text>
            <Text style={styles.ownerEmail}>{q.data?.owner_email}</Text>
            <Text style={styles.hint}>
              The Owner is identified by email match on every request. The
              configured email must be a Google account; the Owner authenticates
              via {"\u201c"}Continue with Google{"\u201d"} on the admin login page.
            </Text>
          </View>

          <View style={[adminStyles.card, { marginTop: spacing.lg }]}>
            <Text style={adminStyles.sectionTitle}>Change Owner Email</Text>
            <Text style={styles.warn}>
              ⚠ Only the current Owner can perform this action. Once changed:
              {"\n"}• The previous Owner email immediately loses Owner access.
              {"\n"}• The new email becomes the Owner / Superadmin.
              {"\n"}• The new Owner must authenticate via Google Sign-In.
              {"\n"}• This action is recorded in the audit log.
            </Text>

            <Text style={styles.fieldLabel}>New Owner Email</Text>
            <TextInput
              value={newEmail}
              onChangeText={setNewEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="new-owner@gmail.com"
              placeholderTextColor={colors.muted}
              style={adminStyles.input}
            />

            {change.isError && (
              <Text style={{ color: colors.error, marginTop: 8 }}>
                {(change.error as any)?.message || "Change failed"}
              </Text>
            )}

            <Pressable
              onPress={() => setConfirmOpen(true)}
              disabled={!valid || change.isPending}
              style={[
                adminStyles.primaryBtn,
                { marginTop: spacing.md, alignSelf: "flex-start" },
                (!valid || change.isPending) && { opacity: 0.5 },
              ]}>
              <Text style={adminStyles.primaryBtnText}>Change Owner Email</Text>
            </Pressable>
          </View>
        </>
      )}

      <Modal transparent animationType="fade" visible={confirmOpen} onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Transfer Owner Access</Text>
            <Text style={styles.modalBody}>
              You are about to transfer Owner access to:
            </Text>
            <Text style={styles.highlightEmail}>{newEmail}</Text>
            <Text style={styles.modalBody}>
              You will immediately lose Owner access and will be redirected to the admin login.
              Continue?
            </Text>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable
                onPress={() => change.mutate()}
                disabled={change.isPending}
                style={adminStyles.dangerBtn}>
                {change.isPending
                  ? <ActivityIndicator color={colors.error} />
                  : <Text style={adminStyles.dangerBtnText}>Yes, transfer</Text>}
              </Pressable>
              <Pressable onPress={() => setConfirmOpen(false)} style={adminStyles.ghostBtn}>
                <Text style={adminStyles.ghostBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.onSurfaceSecondary, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  ownerEmail: {
    color: colors.purple, fontSize: 20, fontWeight: "700",
    marginTop: 4,
  },
  hint: {
    color: colors.muted, fontSize: 12, marginTop: spacing.md,
    lineHeight: 18,
  },
  warn: {
    color: colors.warning, fontSize: 12, marginTop: spacing.sm,
    marginBottom: spacing.md, lineHeight: 18,
    backgroundColor: colors.surfaceTertiary, padding: spacing.sm,
    borderRadius: radius.sm, borderLeftWidth: 3, borderLeftColor: colors.warning,
  },
  fieldLabel: {
    color: colors.onSurfaceSecondary, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
  },
  modalBg: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: "center", alignItems: "center", padding: spacing.lg,
  },
  modal: {
    width: "100%", maxWidth: 480,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl,
  },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "700", marginBottom: spacing.md },
  modalBody: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 },
  highlightEmail: {
    color: colors.purple, fontSize: 16, fontWeight: "700",
    marginVertical: spacing.sm, textAlign: "center",
    backgroundColor: colors.surfaceTertiary, padding: spacing.sm, borderRadius: radius.sm,
  },
});
