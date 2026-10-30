import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { apiListPayoutMethods, apiSupportedMethods, apiEditPayoutMethod, ApiError } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function EditPayoutMethodScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const qc = useQueryClient();
  const supported = useQuery({ queryKey: ["payout", "supported"], queryFn: apiSupportedMethods });
  const list = useQuery({ queryKey: ["payout", "methods"], queryFn: apiListPayoutMethods });
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const row = useMemo(() => list.data?.items.find((m) => m.id === id), [list.data, id]);
  const schema = useMemo(() => supported.data?.items.find((m) => m.key === row?.method) ?? null, [supported.data, row]);

  useEffect(() => {
    // Only hydrate NON-sensitive fields; sensitive ones remain blank so the
    // user must re-enter them to confirm the change.
    if (!row || !schema) return;
    const safe: Record<string, string> = {};
    for (const k of [...schema.required_fields, ...schema.optional_fields]) {
      if (["country", "currency", "pix_key_type", "bank_name", "branch"].includes(k)) {
        safe[k] = row.details[k] ?? "";
      }
    }
    setValues(safe);
  }, [row, schema]);

  const save = useMutation({
    mutationFn: () => apiEditPayoutMethod(id!, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payout", "methods"] }); safeBack(router); },
    onError: (e: Error) => setErr(e instanceof ApiError ? e.message : "Failed"),
  });

  if (!id || !row || !schema) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ title: t.payoutMethods, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
        <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} />
      </View>
    );
  }

  const canSubmit = schema.required_fields.every((f) => (values[f] || "").trim().length > 0);

  return (
    <View style={styles.root} testID="payout-edit-screen">
      <Stack.Screen options={{ title: `Edit ${row.label}`, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl, paddingHorizontal: spacing.lg }}>
          {[...schema.required_fields.map((f) => ({ name: f, req: true })),
            ...schema.optional_fields.map((f) => ({ name: f, req: false }))].map(({ name, req }) => (
            <View key={name} style={{ marginTop: spacing.md }}>
              <Text style={styles.fieldLabel}>{name.replace(/_/g, " ")}{req ? " *" : ""}</Text>
              <TextInput
                value={values[name] ?? ""}
                onChangeText={(v) => setValues((prev) => ({ ...prev, [name]: v }))}
                style={styles.input}
                autoCapitalize="none" autoCorrect={false}
                testID={`field-${name}`}
              />
            </View>
          ))}
          {err && <Text style={styles.err}>{err}</Text>}
          <Pressable
            style={[styles.submit, (!canSubmit || save.isPending) && { opacity: 0.5 }]}
            onPress={() => { setErr(null); save.mutate(); }}
            disabled={!canSubmit || save.isPending}
            testID="save-pm"
          >
            {save.isPending ? <ActivityIndicator color={colors.onBrandPrimary} /> :
              <Text style={styles.submitText}>Save</Text>}
          </Pressable>
          <Text style={styles.disclaimer}>{t.manualProcessing}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 },
  input: { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, fontSize: 14 },
  submit: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md, alignItems: "center" },
  submitText: { color: colors.onBrandPrimary, fontWeight: "900" },
  err: { color: colors.error, fontSize: 12, marginTop: spacing.sm, textAlign: "center" },
  disclaimer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.md, fontStyle: "italic" },
});
