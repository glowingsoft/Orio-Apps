import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter, Stack } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiSupportedMethods, apiAddPayoutMethod, ApiError } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function NewPayoutMethodScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const qc = useQueryClient();
  const supported = useQuery({ queryKey: ["payout", "supported"], queryFn: apiSupportedMethods });
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const schema = useMemo(() => supported.data?.items.find((m) => m.key === selected) ?? null, [supported.data, selected]);

  const add = useMutation({
    mutationFn: () => apiAddPayoutMethod(selected!, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payout", "methods"] });
      safeBack(router);
    },
    onError: (e: Error) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  const canSubmit = !!selected && schema && schema.required_fields.every((f) => (values[f] || "").trim().length > 0);

  return (
    <View style={styles.root} testID="payout-new-screen">
      <Stack.Screen options={{ title: t.addPayoutMethod, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}>
          <Text style={styles.sectionTitle}>{t.selectMethod}</Text>
          <View style={styles.methodGrid}>
            {supported.isLoading ? <ActivityIndicator color={colors.onSurface} /> :
              supported.data?.items.map((m) => (
                <Pressable
                  key={m.key}
                  style={[styles.methodCard, selected === m.key && styles.methodCardActive]}
                  onPress={() => { setSelected(m.key); setValues({}); setErr(null); }}
                  testID={`method-${m.key}`}
                >
                  <Icon name="card" size={16} color={selected === m.key ? colors.onBrandPrimary : colors.gold} />
                  <Text style={[styles.methodLabel, selected === m.key && { color: colors.onBrandPrimary }]} numberOfLines={1}>{m.label}</Text>
                </Pressable>
              ))}
          </View>

          {schema && (
            <View style={styles.form}>
              <Text style={styles.formTitle}>{schema.label}</Text>
              {schema.network && <Text style={styles.networkHint}>Network: {schema.network}</Text>}
              {[...schema.required_fields.map((f) => ({ name: f, req: true })),
                ...schema.optional_fields.map((f) => ({ name: f, req: false }))].map(({ name, req }) => (
                <View key={name} style={{ marginTop: spacing.md }}>
                  <Text style={styles.fieldLabel}>{humanizeField(name)}{req ? " *" : ""}</Text>
                  <TextInput
                    value={values[name] ?? ""}
                    onChangeText={(v) => setValues((prev) => ({ ...prev, [name]: v }))}
                    placeholder={placeholderFor(name)}
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    autoCapitalize={autoCapFor(name)}
                    autoCorrect={false}
                    testID={`field-${name}`}
                  />
                </View>
              ))}
              {err && <Text style={styles.err}>{err}</Text>}
              <Pressable
                style={[styles.submit, (!canSubmit || add.isPending) && { opacity: 0.5 }]}
                onPress={() => { setErr(null); add.mutate(); }}
                disabled={!canSubmit || add.isPending}
                testID="submit-pm"
              >
                {add.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> :
                  <Text style={styles.submitText}>{t.addPayoutMethod}</Text>}
              </Pressable>
              <Text style={styles.disclaimer}>{t.manualProcessing}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function humanizeField(f: string) {
  return f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function placeholderFor(f: string) {
  if (f.includes("email")) return "name@example.com";
  if (f.includes("number") || f.includes("wallet")) return "numeric or address";
  if (f.includes("holder") || f.includes("legal")) return "Full legal name";
  if (f === "country") return "e.g. US, EG, PH";
  return "";
}
function autoCapFor(f: string): "none" | "words" {
  if (f.includes("holder") || f.includes("legal") || f === "bank_name" || f === "city") return "words";
  return "none";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  sectionTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "800", marginHorizontal: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.4 },
  methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg },
  methodCard: { width: "48%", flexDirection: "row", alignItems: "center", gap: 6, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  methodCardActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  methodLabel: { color: colors.onSurface, fontSize: 12, fontWeight: "700", flex: 1 },
  form: { marginTop: spacing.xl, marginHorizontal: spacing.lg, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  formTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "900" },
  networkHint: { color: colors.gold, fontSize: 11, marginTop: 2, fontWeight: "700" },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 },
  input: { backgroundColor: colors.surface, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, fontSize: 14 },
  submit: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md, alignItems: "center" },
  submitText: { color: colors.onBrandPrimary, fontWeight: "900" },
  err: { color: colors.error, fontSize: 12, marginTop: spacing.sm, textAlign: "center" },
  disclaimer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.md, fontStyle: "italic" },
});
