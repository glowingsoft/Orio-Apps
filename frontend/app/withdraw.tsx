import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  apiListPayoutMethods, apiWithdrawalConfig, apiMyEarnings, apiMyAgency,
  apiRequestWithdrawal, apiAgencyEarnings, apiRequestAgencyWithdrawal, ApiError,
} from "@/src/api";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function WithdrawScreen() {
  const { source } = useLocalSearchParams<{ source?: "host" | "agency" }>();
  const kind: "host" | "agency" = source === "agency" ? "agency" : "host";
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const qc = useQueryClient();

  const cfg = useQuery({ queryKey: ["withdraw", "cfg"], queryFn: apiWithdrawalConfig });
  const methods = useQuery({ queryKey: ["payout", "methods"], queryFn: apiListPayoutMethods });
  const hostE = useQuery({ queryKey: ["earnings"], queryFn: apiMyEarnings, enabled: kind === "host" });
  const myAg = useQuery({ queryKey: ["me", "agency"], queryFn: apiMyAgency, enabled: kind === "agency" });
  const agencyId = myAg.data?.agency?.id;
  const agE = useQuery({ queryKey: ["agency", agencyId, "earnings"], queryFn: () => apiAgencyEarnings(agencyId!), enabled: !!agencyId && kind === "agency" });

  const defaultPm = useMemo(
    () => methods.data?.items.find((m) => m.is_default) ?? methods.data?.items[0] ?? null,
    [methods.data],
  );
  const [selectedPm, setSelectedPm] = useState<string | null>(null);
  const effectivePm = selectedPm ?? defaultPm?.id ?? null;

  const [amtStr, setAmtStr] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const minUsd = cfg.data?.minimum_withdrawal_usd ?? 10;
  const maxUsd = cfg.data?.maximum_withdrawal_usd ?? 1000;
  const rate = cfg.data?.diamonds_per_usd ?? 9999;
  const availDiamonds =
    kind === "host"
      ? hostE.data?.available.host ?? 0
      : (agE.data?.available.agency ?? 0);
  const availUsd = Math.floor(availDiamonds / rate);

  const amt = Math.max(0, parseInt(amtStr || "0", 10) || 0);
  const canSubmit =
    !!effectivePm && amt >= minUsd && amt <= maxUsd && amt <= availUsd;

  const create = useMutation({
    mutationFn: async () => {
      const key = `wdr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (kind === "agency" && agencyId) {
        return apiRequestAgencyWithdrawal(agencyId, amt, effectivePm!, key);
      }
      return apiRequestWithdrawal(amt, effectivePm!, key);
    },
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ["earnings"] });
      qc.invalidateQueries({ queryKey: ["agency"] });
      qc.invalidateQueries({ queryKey: ["me", "transactions"] });
      router.replace(`/withdrawals/${w.id}` as any);
    },
    onError: (e: Error) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  return (
    <View style={styles.root} testID="withdraw-screen">
      <Stack.Screen options={{ title: t.withdraw, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}>
          {/* AVAILABLE */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{t.availableLabel} ({kind === "agency" ? "Agency" : "Host"})</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Diamond size={22} />
              <Text style={styles.heroAmount}>{availDiamonds.toLocaleString()}</Text>
            </View>
            <Text style={styles.heroSub}>≈ ${availUsd} USD · 1 USD = {rate.toLocaleString()} 💎</Text>
          </View>

          {/* METHOD SELECT */}
          <Text style={styles.sectionTitle}>{t.selectMethod}</Text>
          {methods.isLoading ? <ActivityIndicator color={colors.onSurface} /> :
            (methods.data?.items.length ?? 0) === 0 ? (
              <Pressable
                style={styles.addPm}
                onPress={() => router.push("/payout-methods/new" as any)}
                testID="withdraw-no-pm"
              >
                <Icon name="add-circle" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.addPmText}>{t.addPayoutMethod}</Text>
              </Pressable>
            ) : (
              <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
                {methods.data!.items.map((m) => {
                  const active = effectivePm === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      style={[styles.pmRow, active && styles.pmRowActive]}
                      onPress={() => setSelectedPm(m.id)}
                      testID={`choose-pm-${m.id}`}
                    >
                      <Icon name={active ? "radio-button-on" : "radio-button-off"} size={18} color={active ? colors.brandPrimary : colors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pmLabel}>{m.label}{m.is_default ? " · ★" : ""}</Text>
                        <Text style={styles.pmHint} numberOfLines={1}>{m.display_hint || ""}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )
          }

          {/* AMOUNT */}
          <Text style={styles.sectionTitle}>{t.amountUSD}</Text>
          <View style={styles.amountCard}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              value={amtStr}
              onChangeText={(v) => { setAmtStr(v.replace(/[^0-9]/g, "")); setErr(null); }}
              placeholder={`${minUsd}`}
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              style={styles.amountInput}
              testID="amount-input"
            />
            <Text style={styles.unit}>USD</Text>
          </View>
          <Text style={styles.minHint}>{t.minimumWithdrawal}: ${minUsd} · Max: ${maxUsd} · ≈ {(amt * rate).toLocaleString()} 💎</Text>

          {err && <Text style={styles.err} testID="withdraw-err">{err}</Text>}

          <Pressable
            style={[styles.submit, (!canSubmit || create.isPending) && { opacity: 0.5 }]}
            disabled={!canSubmit || create.isPending}
            onPress={() => { setErr(null); create.mutate(); }}
            testID="submit-withdraw"
          >
            {create.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <Text style={styles.submitText}>{t.confirmWithdraw}</Text>
            )}
          </Pressable>

          <Text style={styles.disclaimer}>
            {t.manualProcessing} · {t.reviewPeriod}: {cfg.data?.review_period_days ?? 7} days
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  heroLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  heroAmount: { color: colors.onSurface, fontSize: 28, fontWeight: "900" },
  heroSub: { color: colors.muted, fontSize: 12, marginTop: 4 },
  sectionTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "800", marginHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: 0.4 },
  pmRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pmRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "11" },
  pmLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  pmHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  addPm: { marginHorizontal: spacing.lg, backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.sm },
  addPmText: { color: colors.onBrandPrimary, fontWeight: "900" },
  amountCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  dollar: { color: colors.gold, fontSize: 24, fontWeight: "900" },
  amountInput: { flex: 1, color: colors.onSurface, fontSize: 24, fontWeight: "900", padding: 0 },
  unit: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  minHint: { color: colors.muted, fontSize: 11, marginTop: 4, marginHorizontal: spacing.lg },
  submit: { marginTop: spacing.xl, marginHorizontal: spacing.lg, backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md, alignItems: "center" },
  submitText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 15 },
  err: { color: colors.error, fontSize: 12, marginTop: spacing.sm, textAlign: "center" },
  disclaimer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.lg, paddingHorizontal: spacing.lg, fontStyle: "italic" },
});
