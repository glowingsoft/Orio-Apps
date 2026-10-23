/**
 * Iter-85 — Admin Dashboard: Reports & Moderation.
 */
import React, { useState } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Image, Modal, ScrollView, TextInput,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import {
  apiAdminDashReports, apiAdminDashReportDetail, apiAdminDashActReport, AdminReport,
} from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

const STATUS_TABS = [
  { key: "open", label: "Open", tint: colors.warning },
  { key: "resolved", label: "Resolved", tint: colors.success },
  { key: "dismissed", label: "Dismissed", tint: colors.muted },
];

export default function AdminReports() {
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState(params.status || "open");
  const [sel, setSel] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin", "reports", status],
    queryFn: () => apiAdminDashReports({ status, limit: 100 }),
    staleTime: 10_000,
  });

  const items = q.data?.items || [];

  return (
    <AdminShell title="Reports & Moderation">
      <View style={styles.toolbar}>
        {STATUS_TABS.map((s) => (
          <Pressable key={s.key} onPress={() => setStatus(s.key)}
            style={[styles.pill, status === s.key && { backgroundColor: s.tint, borderColor: s.tint }]}>
            <Text style={[styles.pillText, status === s.key && { color: colors.onSurface }]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {q.isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} />
      ) : items.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 48, textAlign: "center" }}>No {status} reports.</Text>
      ) : (
        <View>
          <Text style={styles.count}>{q.data?.total ?? 0} {status} reports</Text>
          {items.map((r) => <ReportRow key={r.id} report={r} onOpen={() => setSel(r.id)} />)}
        </View>
      )}

      <ReportModal reportId={sel} onClose={() => setSel(null)} />
    </AdminShell>
  );
}

function ReportRow({ report, onOpen }: { report: AdminReport; onOpen: () => void }) {
  const r = report.reported;
  return (
    <Pressable onPress={onOpen} style={adminStyles.rowCard}>
      {r?.avatar_url ? (
        <Image source={{ uri: r.avatar_url }} style={adminStyles.avatar} />
      ) : (
        <View style={[adminStyles.avatar, { backgroundColor: colors.error }]} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={styles.name} numberOfLines={1}>{r?.nickname || "?"}</Text>
          <View style={[adminStyles.badge, { backgroundColor: colors.error + "22" }]}>
            <Text style={[adminStyles.badgeText, { color: colors.error }]}>{report.reason || "other"}</Text>
          </View>
          {report.has_media && (
            <View style={[adminStyles.badge, { backgroundColor: colors.info + "22" }]}>
              <Text style={[adminStyles.badgeText, { color: colors.info }]}>{report.media_kind?.toUpperCase() || "MEDIA"}</Text>
            </View>
          )}
        </View>
        <Text style={styles.detail} numberOfLines={2}>{report.details || "No details"}</Text>
        <Text style={styles.meta}>
          Reporter: {report.reporter?.nickname || "?"} · {report.created_at ? new Date(report.created_at).toLocaleString() : ""}
        </Text>
      </View>
      <Icon name="chevron-forward-outline" size={20} color={colors.onSurfaceSecondary} />
    </Pressable>
  );
}

function ReportModal({ reportId, onClose }: { reportId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const detail = useQuery({
    queryKey: ["admin", "report", reportId],
    queryFn: () => apiAdminDashReportDetail(reportId!),
    enabled: !!reportId,
  });

  React.useEffect(() => { setNote(""); }, [reportId]);

  const act = useMutation({
    mutationFn: ({ action }: { action: "resolve" | "dismiss" | "ban_reported" | "warn_reported" }) =>
      apiAdminDashActReport(reportId!, action, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      onClose();
    },
  });

  const r = detail.data;

  return (
    <Modal transparent animationType="fade" visible={!!reportId} onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.modal}>
          <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.modalTitle}>Report details</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={onClose}><Icon name="close-outline" size={24} color={colors.onSurface} /></Pressable>
            </View>
            {detail.isLoading || !r ? (
              <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 32 }} />
            ) : (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Reason</Text>
                  <Text style={styles.blockValue}>{r.reason}</Text>
                </View>
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Details</Text>
                  <Text style={styles.blockValue}>{r.details || "—"}</Text>
                </View>
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Reported user</Text>
                  <Text style={styles.blockValue}>
                    {r.reported?.nickname} (@{r.reported?.username}) · ID {r.reported?.numeric_id || "—"}
                  </Text>
                </View>
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Reporter</Text>
                  <Text style={styles.blockValue}>
                    {r.reporter?.nickname} (@{r.reporter?.username})
                  </Text>
                </View>
                {r.media_data_url && r.media_kind === "image" && (
                  <Image source={{ uri: r.media_data_url }} style={styles.media} resizeMode="contain" />
                )}
                {r.media_data_url && r.media_kind === "video" && (
                  <Text style={styles.blockValue}>Video attachment: open the raw data URL in a new tab to inspect.</Text>
                )}

                <Text style={[adminStyles.sectionTitle, { marginTop: spacing.md }]}>Resolution note</Text>
                <TextInput value={note} onChangeText={setNote} placeholder="Optional note shown in audit log"
                  placeholderTextColor={colors.muted} style={adminStyles.input} multiline numberOfLines={3} />

                {r.status === "open" ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
                    <Pressable disabled={act.isPending} onPress={() => act.mutate({ action: "resolve" })} style={adminStyles.primaryBtn}>
                      <Text style={adminStyles.primaryBtnText}>Resolve</Text>
                    </Pressable>
                    <Pressable disabled={act.isPending} onPress={() => act.mutate({ action: "dismiss" })} style={adminStyles.ghostBtn}>
                      <Text style={adminStyles.ghostBtnText}>Dismiss</Text>
                    </Pressable>
                    <Pressable disabled={act.isPending} onPress={() => act.mutate({ action: "ban_reported" })} style={adminStyles.dangerBtn}>
                      <Text style={adminStyles.dangerBtnText}>Resolve & ban</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ marginTop: spacing.sm }}>
                    <View style={[adminStyles.badge, { backgroundColor: colors.success + "22" }]}>
                      <Text style={[adminStyles.badgeText, { color: colors.success }]}>Already {r.status}</Text>
                    </View>
                  </View>
                )}

                {act.isError ? <Text style={{ color: colors.error, marginTop: 8 }}>{(act.error as any)?.message}</Text> : null}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  pill: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  pillText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  count: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  detail: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  modal: {
    width: "100%", maxWidth: 640, maxHeight: "90%",
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
  },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "700" },
  block: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  blockLabel: { color: colors.onSurfaceSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  blockValue: { color: colors.onSurface, fontSize: 14 },
  media: { width: "100%", height: 240, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
});
