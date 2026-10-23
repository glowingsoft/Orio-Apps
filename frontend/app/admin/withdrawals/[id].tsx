import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiAdminGetWithdrawal, apiAdminWithdrawalAction, ApiError } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#4FC3F7", UNDER_REVIEW: "#4FC3F7", HOLD: "#FFB74D",
  NEEDS_INFORMATION: "#FFB74D", APPROVED: "#81C784", PROCESSING: "#64B5F6",
  PAID: "#4CAF50", REJECTED: "#E57373", CANCELLED: "#9E9E9E",
  FAILED: "#E57373", RETURNED: "#B39DDB",
};
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

type ActionKind = "review" | "hold" | "request-info" | "approve" | "reject" | "start-processing" | "mark-paid" | "mark-failed" | "mark-returned";

export default function AdminWithdrawalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ kind: ActionKind; title: string; needs: "reason" | "ref" | "note" | null } | null>(null);
  const [v1, setV1] = useState(""); const [v2, setV2] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const w = useQuery({ queryKey: ["admin", "withdrawal", id], queryFn: () => apiAdminGetWithdrawal(id!), enabled: !!id });

  const act = useMutation({
    mutationFn: ({ kind, body }: { kind: ActionKind; body?: Record<string, any> }) =>
      apiAdminWithdrawalAction(id!, kind, body ?? {}),
    onSuccess: () => {
      setModal(null); setV1(""); setV2(""); setErr(null);
      qc.invalidateQueries({ queryKey: ["admin", "withdrawals"] });
      qc.invalidateQueries({ queryKey: ["admin", "withdrawal", id] });
    },
    onError: (e: Error) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  if (!id) return <View style={styles.root}><Text style={{ color: colors.error }}>Missing id</Text></View>;

  const status = w.data?.status;
  const col = STATUS_COLORS[status ?? ""] ?? colors.muted;

  const quickActions: { kind: ActionKind; label: string; needs: "reason" | "ref" | "note" | null; show: boolean }[] = [
    { kind: "review", label: t.inReview, needs: null, show: status === "REQUESTED" },
    { kind: "hold", label: t.hold, needs: "reason", show: ["REQUESTED", "UNDER_REVIEW", "NEEDS_INFORMATION"].includes(status ?? "") },
    { kind: "request-info", label: t.requestInfo, needs: "reason", show: ["REQUESTED", "UNDER_REVIEW", "HOLD"].includes(status ?? "") },
    { kind: "approve", label: t.approve, needs: null, show: ["REQUESTED", "UNDER_REVIEW", "HOLD", "NEEDS_INFORMATION"].includes(status ?? "") },
    { kind: "reject", label: t.rejectAction, needs: "reason", show: ["REQUESTED", "UNDER_REVIEW", "HOLD", "NEEDS_INFORMATION", "APPROVED"].includes(status ?? "") },
    { kind: "start-processing", label: t.startProcessing, needs: null, show: status === "APPROVED" },
    { kind: "mark-paid", label: t.markPaid, needs: "ref", show: status === "PROCESSING" },
    { kind: "mark-failed", label: t.markFailed, needs: "reason", show: status === "PROCESSING" },
    { kind: "mark-returned", label: t.markReturned, needs: "note", show: ["FAILED", "PAID"].includes(status ?? "") },
  ];

  const openActionModal = (a: typeof quickActions[0]) => {
    setErr(null); setV1(""); setV2("");
    if (!a.needs) {
      act.mutate({ kind: a.kind, body: {} });
      return;
    }
    setModal({ kind: a.kind, title: a.label, needs: a.needs });
  };

  const submitModal = () => {
    if (!modal) return;
    const body: Record<string, any> = {};
    if (modal.needs === "reason") body.reason = v1.trim();
    if (modal.needs === "ref") { body.external_reference = v1.trim(); body.note = v2.trim() || undefined; }
    if (modal.needs === "note") body.note = v1.trim() || undefined;
    act.mutate({ kind: modal.kind, body });
  };

  return (
    <View style={styles.root} testID="admin-withdrawal-detail-screen">
      <Stack.Screen options={{ title: `#${(id || "").slice(0, 10)}`, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}>
        {w.isLoading ? <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} /> :
          w.data ? (
            <>
              <View style={styles.hero}>
                <Text style={styles.heroAmt}>${w.data.amount_usd}</Text>
                <Text style={styles.heroSub}>{w.data.amount_diamonds.toLocaleString()} 💎 · {w.data.exchange_rate}/USD</Text>
                <View style={[styles.statusPill, { backgroundColor: col + "22", borderColor: col }]}>
                  <Text style={[styles.statusPillText, { color: col }]}>{w.data.status.replace(/_/g, " ")}</Text>
                </View>
              </View>

              <View style={styles.panel}>
                <Field label="Owner" value={`${w.data.owner_type.toUpperCase()} · ${w.data.user_id.slice(0, 10)}…`} />
                {w.data.agency_id && <Field label="Agency" value={w.data.agency_id} />}
                <Field label="Method" value={w.data.method_label} />
                <Field label="Destination (full)" value={JSON.stringify(w.data.payout_method_snapshot?.details ?? {})} mono />
                <Field label={t.requestedOn} value={fmtDate(w.data.requested_at)} />
                <Field label={t.estimatedReview} value={fmtDate(w.data.review_ends_at)} />
                {w.data.processed_at && <Field label="Processing started" value={fmtDate(w.data.processed_at)} />}
                {w.data.paid_at && <Field label="Paid at" value={fmtDate(w.data.paid_at)} />}
                {w.data.returned_at && <Field label="Returned at" value={fmtDate(w.data.returned_at)} />}
                {w.data.external_reference && <Field label={t.externalReference} value={w.data.external_reference} mono />}
                {w.data.rejection_reason && <Field label={t.reason} value={w.data.rejection_reason} errorTone />}
                {w.data.failure_reason && <Field label="Failure" value={w.data.failure_reason} errorTone />}
                {w.data.info_request && <Field label="Info requested" value={w.data.info_request} warnTone />}
                <Field label="Withdrawal ID" value={w.data.withdrawal_id} mono />
              </View>

              <Text style={styles.actionsHeader}>Admin Actions</Text>
              <View style={styles.actions}>
                {quickActions.filter((a) => a.show).map((a) => (
                  <Pressable
                    key={a.kind}
                    style={styles.actionBtn}
                    onPress={() => openActionModal(a)}
                    disabled={act.isPending}
                    testID={`admin-action-${a.kind}`}
                  >
                    <Text style={styles.actionLabel}>{a.label}</Text>
                  </Pressable>
                ))}
                {quickActions.every((a) => !a.show) && (
                  <Text style={styles.noActions}>No actions available in this state.</Text>
                )}
              </View>

              {err && <Text style={styles.err}>{err}</Text>}
            </>
          ) : <Text style={{ color: colors.error, textAlign: "center" }}>Not found</Text>
        }
      </ScrollView>

      <Modal visible={!!modal} animationType="slide" transparent onRequestClose={() => setModal(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modal}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.modalTitle}>{modal?.title}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setModal(null)}><Icon name="close" size={22} color={colors.muted} /></Pressable>
            </View>
            {modal?.needs === "reason" && (
              <TextInput value={v1} onChangeText={setV1} placeholder={t.enterReason} placeholderTextColor={colors.muted} style={styles.modalInput} multiline testID="modal-reason" />
            )}
            {modal?.needs === "note" && (
              <TextInput value={v1} onChangeText={setV1} placeholder={t.note} placeholderTextColor={colors.muted} style={styles.modalInput} multiline testID="modal-note" />
            )}
            {modal?.needs === "ref" && (
              <>
                <TextInput value={v1} onChangeText={setV1} placeholder={t.enterExternalRef} placeholderTextColor={colors.muted} style={styles.modalInput} testID="modal-ref" />
                <TextInput value={v2} onChangeText={setV2} placeholder={t.note} placeholderTextColor={colors.muted} style={styles.modalInput} testID="modal-ref-note" />
              </>
            )}
            {err && <Text style={styles.err}>{err}</Text>}
            <Pressable style={[styles.submit, act.isPending && { opacity: 0.5 }]} onPress={submitModal} disabled={act.isPending} testID="modal-submit">
              {act.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Confirm</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Field({ label, value, mono, warnTone, errorTone }: { label: string; value: string; mono?: boolean; warnTone?: boolean; errorTone?: boolean }) {
  const tone = errorTone ? colors.error : warnTone ? colors.warning : colors.onSurface;
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>{label}</Text>
      <Text selectable style={{ color: tone, fontSize: 13, fontWeight: "700", marginTop: 2, fontFamily: mono ? "Courier" : undefined }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center" },
  heroAmt: { color: colors.onSurface, fontSize: 36, fontWeight: "900" },
  heroSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  statusPill: { marginTop: spacing.md, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  statusPillText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  panel: { marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  actionsHeader: { color: colors.onSurface, fontSize: 13, fontWeight: "800", marginHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.4 },
  actions: { marginHorizontal: spacing.lg, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  actionLabel: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 12 },
  noActions: { color: colors.muted, fontSize: 12 },
  err: { color: colors.error, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
  modalWrap: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  modalInput: { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, fontSize: 14, minHeight: 44 },
  submit: { backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md, alignItems: "center" },
  submitText: { color: colors.onBrandPrimary, fontWeight: "900" },
});
