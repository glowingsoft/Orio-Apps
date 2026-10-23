import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  TextInput, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  apiGetRechargeAgent, apiListRechargeAgents, apiSubmitRechargeAgentTx, ApiError,
} from "@/src/api";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function NewRechargeAgentTxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useI18n();
  const { agent_id } = useLocalSearchParams<{ agent_id?: string }>();

  const agents = useQuery({ queryKey: ["recharge-agents"], queryFn: apiListRechargeAgents, enabled: !agent_id });
  const agentQ = useQuery({
    queryKey: ["recharge-agent", agent_id],
    queryFn: () => apiGetRechargeAgent(agent_id!),
    enabled: !!agent_id,
  });

  const [agentTxId, setAgentTxId] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [paidAt, setPaidAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  });
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const amt = parseInt(amountUsd || "0", 10) || 0;
  const diamonds = amt * 9999;
  const canSubmit = !!agent_id && amt > 0 && amt <= 10000 && agentTxId.trim().length >= 4 && paidAt.length >= 10;

  const submit = useMutation({
    mutationFn: async () => {
      const d = new Date(paidAt);
      return apiSubmitRechargeAgentTx({
        agent_id: agent_id!,
        agent_tx_id: agentTxId.trim(),
        amount_usd: amt,
        paid_at: d.toISOString(),
        note: note.trim() || undefined,
      });
    },
    onSuccess: (tx) => {
      qc.invalidateQueries({ queryKey: ["my-recharge-agent-txs"] });
      Alert.alert(t.statusPending, "Submitted — admin will verify soon.");
      router.replace(`/recharge-agent/${tx.id}` as any);
    },
    onError: (e: Error) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  const noAgent = !agent_id;

  return (
    <View style={styles.root} testID="new-recharge-agent-tx">
      <Stack.Screen
        options={{ title: t.submitRecharge, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}>
          {noAgent ? (
            <View style={styles.block}>
              <Text style={styles.label}>{t.chooseAgent}</Text>
              {agents.isLoading ? (
                <ActivityIndicator color={colors.onSurface} />
              ) : (agents.data?.items ?? []).map((a) => (
                <Pressable
                  key={a.id}
                  style={styles.agentPick}
                  onPress={() => router.setParams({ agent_id: a.id })}
                  testID={`pick-agent-${a.id}`}
                >
                  <View style={styles.agentIcon}><Icon name="person-circle" size={22} color={colors.gold} /></View>
                  <Text style={styles.pickName}>{a.name}</Text>
                  <View style={styles.codeBadge}><Text style={styles.codeText}>#{a.agent_code}</Text></View>
                </Pressable>
              ))}
            </View>
          ) : agentQ.isLoading ? (
            <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xl }} />
          ) : agentQ.data ? (
            <View style={styles.block}>
              <View style={styles.selectedAgent}>
                <View style={styles.agentIcon}><Icon name="person-circle" size={26} color={colors.gold} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickName}>{agentQ.data.name}</Text>
                  <Text style={styles.subMeta}>#{agentQ.data.agent_code}{agentQ.data.country ? ` · ${agentQ.data.country}` : ""}</Text>
                  {agentQ.data.contact && <Text style={styles.subMeta}>{t.agentContact}: {agentQ.data.contact}</Text>}
                </View>
              </View>

              {/* Transaction ID */}
              <Text style={styles.label}>{t.agentTxId}</Text>
              <Text style={styles.hint}>{t.agentTxIdHint}</Text>
              <TextInput
                style={styles.input}
                value={agentTxId}
                onChangeText={setAgentTxId}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="TXN-XXXX-XXXX"
                placeholderTextColor={colors.muted}
                testID="input-agent-tx-id"
              />

              {/* Amount USD */}
              <Text style={styles.label}>{t.amountUSD}</Text>
              <TextInput
                style={styles.input}
                value={amountUsd}
                onChangeText={(v) => setAmountUsd(v.replace(/[^0-9]/g, ""))}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor={colors.muted}
                testID="input-amount-usd"
              />
              <View style={styles.conversionBox}>
                <Diamond size={16} />
                <Text style={styles.conversionText}>{diamonds.toLocaleString()}</Text>
                <Text style={styles.conversionSub}>= ${amt} × 9,999</Text>
              </View>

              {/* Paid At */}
              <Text style={styles.label}>{t.paidAt}</Text>
              <TextInput
                style={styles.input}
                value={paidAt}
                onChangeText={setPaidAt}
                placeholder="2026-10-01T14:30"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                testID="input-paid-at"
              />
              <Text style={styles.hint}>{t.recentOnly}</Text>

              {/* Note */}
              <Text style={styles.label}>{t.note} ({t.optional ?? "optional"})</Text>
              <TextInput
                style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
                value={note}
                onChangeText={setNote}
                multiline
                placeholder=""
                placeholderTextColor={colors.muted}
                testID="input-note"
              />

              {err && <Text style={styles.err}>{err}</Text>}

              <Pressable
                style={[styles.submitBtn, !canSubmit && { opacity: 0.4 }]}
                disabled={!canSubmit || submit.isPending}
                onPress={() => { setErr(null); submit.mutate(); }}
                testID="submit-recharge-tx"
              >
                {submit.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                  <>
                    <Icon name="paper-plane" size={18} color={colors.onBrandPrimary} />
                    <Text style={styles.submitText}>{t.submitRecharge}</Text>
                  </>
                )}
              </Pressable>
              <Text style={styles.disclaimer}>{t.rechargeAgentWarn}</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  block: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  label: { color: colors.onSurface, fontSize: 13, fontWeight: "800", marginTop: spacing.md },
  hint: { color: colors.muted, fontSize: 11 },
  input: {
    backgroundColor: colors.surfaceSecondary,
    color: colors.onSurface,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontSize: 15,
  },
  selectedAgent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold + "33",
  },
  agentIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold + "22", alignItems: "center", justifyContent: "center" },
  pickName: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  subMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  agentPick: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  codeBadge: { backgroundColor: colors.gold + "33", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, marginLeft: "auto" },
  codeText: { color: colors.gold, fontSize: 10, fontWeight: "900" },
  conversionBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    padding: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.gold + "15",
  },
  conversionText: { color: colors.onSurface, fontSize: 15, fontWeight: "900" },
  conversionSub: { color: colors.muted, fontSize: 11, marginLeft: "auto" },
  submitBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandPrimary,
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
  },
  submitText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" },
  err: { color: colors.error, fontSize: 12, marginTop: spacing.sm },
  disclaimer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.md, fontStyle: "italic" },
});
