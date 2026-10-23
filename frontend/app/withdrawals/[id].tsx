import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGetMyWithdrawal, apiCancelMyWithdrawal } from "@/src/api";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { confirmDialog } from "@/src/utils/confirm";

const CANCELABLE = new Set(["REQUESTED", "UNDER_REVIEW", "HOLD", "NEEDS_INFORMATION"]);
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

export default function WithdrawalDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const qc = useQueryClient();

  const w = useQuery({ queryKey: ["me", "withdrawals", id], queryFn: () => apiGetMyWithdrawal(id!), enabled: !!id });
  const cancel = useMutation({
    mutationFn: () => apiCancelMyWithdrawal(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "withdrawals"] });
      qc.invalidateQueries({ queryKey: ["earnings"] });
      qc.invalidateQueries({ queryKey: ["me", "withdrawals", id] });
    },
  });

  if (!id) return <View style={styles.root}><Text style={{ color: colors.error }}>Missing id</Text></View>;

  return (
    <View style={styles.root} testID="withdrawal-details-screen">
      <Stack.Screen options={{ title: t.withdrawalDetails, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}>
        {w.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} />
        ) : w.data ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroAmt}>${w.data.amount_usd}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                <Diamond size={12} />
                <Text style={styles.heroSub}>{w.data.amount_diamonds.toLocaleString()} diamonds</Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: (STATUS_COLORS[w.data.status] ?? colors.muted) + "22", borderColor: STATUS_COLORS[w.data.status] ?? colors.muted }]}>
                <Text style={[styles.statusPillText, { color: STATUS_COLORS[w.data.status] ?? colors.muted }]}>{w.data.status.replace(/_/g, " ")}</Text>
              </View>
            </View>

            <View style={styles.panel}>
              <Field label="Method" value={w.data.method_label} />
              <Field label="Destination" value={w.data.destination_hint || "—"} />
              <Field label={t.requestedOn} value={fmtDate(w.data.requested_at)} />
              <Field label={t.estimatedReview} value={fmtDate(w.data.review_ends_at)} />
              {w.data.external_reference && <Field label={t.externalReference} value={w.data.external_reference} />}
              {w.data.rejection_reason && <Field label={t.reason} value={w.data.rejection_reason} errorTone />}
              {w.data.failure_reason && <Field label="Failure" value={w.data.failure_reason} errorTone />}
              {w.data.info_request && <Field label="Info requested" value={w.data.info_request} warnTone />}
              <Field label="Withdrawal ID" value={w.data.withdrawal_id} mono />
            </View>

            {CANCELABLE.has(w.data.status) && (
              <Pressable
                style={styles.cancelBtn}
                onPress={() => confirmDialog(t.cancelWithdrawal, t.confirmCancelWithdrawal, [
                  { text: t.cancel, style: "cancel" },
                  { text: t.cancelWithdrawal, style: "destructive", onPress: () => cancel.mutate() },
                ])}
                disabled={cancel.isPending}
                testID="cancel-withdrawal"
              >
                {cancel.isPending ? <ActivityIndicator color={colors.error} /> : (
                  <>
                    <Icon name="close-circle" size={18} color={colors.error} />
                    <Text style={styles.cancelText}>{t.cancelWithdrawal}</Text>
                  </>
                )}
              </Pressable>
            )}

            <Text style={styles.disclaimer}>{t.manualProcessing}</Text>
          </>
        ) : (
          <Text style={{ color: colors.error, textAlign: "center" }}>Not found</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Field({ label, value, mono, warnTone, errorTone }: { label: string; value: string; mono?: boolean; warnTone?: boolean; errorTone?: boolean }) {
  const tone = errorTone ? colors.error : warnTone ? colors.warning : colors.onSurface;
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</Text>
      <Text style={{ color: tone, fontSize: 14, fontWeight: "700", marginTop: 2, fontFamily: mono ? "Courier" : undefined }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center" },
  heroAmt: { color: colors.onSurface, fontSize: 40, fontWeight: "900" },
  heroSub: { color: colors.muted, fontSize: 12 },
  statusPill: { marginTop: spacing.md, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  statusPillText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  panel: { marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cancelBtn: { marginHorizontal: spacing.lg, marginTop: spacing.lg, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.error + "22", borderWidth: 1, borderColor: colors.error + "66" },
  cancelText: { color: colors.error, fontWeight: "800" },
  disclaimer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.lg, paddingHorizontal: spacing.lg, fontStyle: "italic" },
});
