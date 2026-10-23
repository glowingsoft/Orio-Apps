import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { apiGetMyRechargeAgentTx } from "@/src/api";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function RechargeAgentTxDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["my-recharge-agent-tx", id], queryFn: () => apiGetMyRechargeAgentTx(id!) , enabled: !!id });

  return (
    <View style={styles.root} testID="recharge-agent-tx-detail">
      <Stack.Screen options={{ title: "Transaction", headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, gap: spacing.md }}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} />
        ) : !q.data ? (
          <Text style={styles.err}>Not found</Text>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={[styles.statusCircle, q.data.status === "verified" ? { backgroundColor: colors.success + "22" } : q.data.status === "rejected" ? { backgroundColor: colors.error + "22" } : { backgroundColor: colors.warning + "22" }]}>
                <Icon name={q.data.status === "verified" ? "checkmark-circle" : q.data.status === "rejected" ? "close-circle" : "time"} size={48} color={q.data.status === "verified" ? colors.success : q.data.status === "rejected" ? colors.error : colors.warning} />
              </View>
              <Text style={styles.statusLabel}>{q.data.status === "verified" ? t.statusVerified : q.data.status === "rejected" ? t.statusRejected : t.statusPending}</Text>
              <View style={styles.amountRow}>
                <Diamond size={22} />
                <Text style={styles.amountText}>{(q.data.amount_usd * 9999).toLocaleString()}</Text>
              </View>
              <Text style={styles.amountSub}>${q.data.amount_usd} USD × 9,999</Text>
            </View>

            <Row label="Agent" value={q.data.agent?.name ?? "—"} />
            <Row label={t.agentCode} value={q.data.agent?.agent_code ? `#${q.data.agent.agent_code}` : "—"} />
            <Row label={t.agentTxId} value={q.data.agent_tx_id} mono />
            <Row label={t.paidAt} value={new Date(q.data.paid_at).toLocaleString()} />
            <Row label="Submitted" value={new Date(q.data.created_at).toLocaleString()} />
            {q.data.verified_at && <Row label="Processed" value={new Date(q.data.verified_at).toLocaleString()} />}
            {q.data.status === "verified" && (
              <Row label={t.diamondsCredited} value={q.data.diamonds_credited.toLocaleString()} />
            )}
            {q.data.rejection_reason && (
              <View style={styles.rejectBox}>
                <Icon name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.rejectText}>{q.data.rejection_reason}</Text>
              </View>
            )}
            {q.data.note && <Row label={t.note} value={q.data.note} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && { fontFamily: Platformize("Menlo", "monospace") }]}>{value}</Text>
    </View>
  );
}
function Platformize(ios: string, android: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Platform } = require("react-native");
  return Platform.OS === "ios" ? ios : android;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { alignItems: "center", padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  statusCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  statusLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  amountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  amountText: { color: colors.onSurface, fontSize: 28, fontWeight: "900" },
  amountSub: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  rowLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  rowValue: { color: colors.onSurface, fontSize: 13, fontWeight: "800", flex: 1, textAlign: "right" },
  rejectBox: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.error + "15", alignItems: "center" },
  rejectText: { color: colors.onSurface, fontSize: 12, flex: 1 },
  err: { color: colors.error, textAlign: "center", padding: spacing.xl },
});
