import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  apiListPayoutMethods, apiDeletePayoutMethod, apiSetDefaultPayoutMethod,
  type PayoutMethodRow,
} from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { confirmDialog } from "@/src/utils/confirm";

export default function PayoutMethodsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const list = useQuery({ queryKey: ["payout", "methods"], queryFn: apiListPayoutMethods });

  const del = useMutation({
    mutationFn: apiDeletePayoutMethod,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payout", "methods"] }),
  });
  const setDefault = useMutation({
    mutationFn: apiSetDefaultPayoutMethod,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payout", "methods"] }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  }, [list]);

  return (
    <View style={styles.root} testID="payout-methods-screen">
      <Stack.Screen options={{ title: t.payoutMethods, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.onSurface }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.onSurface} />}
      >
        {/* Iter-42 — Financial Intermediary / Recharge Agent (first-class recharge channel).
            This is NOT a payout method; it's a recharge channel presented
            alongside payment icons as required. Separate route + data. */}
        <Pressable
          style={styles.intermediaryCard}
          onPress={() => router.push("/recharge-agent" as any)}
          testID="financial-intermediary-card"
        >
          <View style={styles.intermediaryIcon}>
            <Icon name="briefcase" size={26} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.intermediaryTitle}>{t.financialIntermediary}</Text>
            <Text style={styles.intermediarySub} numberOfLines={2}>{t.rechargeDescription}</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

        {list.isLoading ? (
          <ActivityIndicator color={colors.onSurface} style={{ padding: spacing.xxl }} />
        ) : (list.data?.items.length ?? 0) === 0 ? (
          <View style={styles.empty} testID="payout-empty">
            <Icon name="card-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyTitle}>{t.noPayoutMethods}</Text>
            <Text style={styles.emptySub}>{t.manualProcessing}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {list.data!.items.map((m) => (
              <PmRow
                key={m.id} m={m}
                onEdit={() => router.push(`/payout-methods/${m.id}` as any)}
                onDelete={() => confirmDialog("Delete", "Delete this payout method?", [
                  { text: t.cancel, style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => del.mutate(m.id) },
                ])}
                onDefault={() => setDefault.mutate(m.id)}
              />
            ))}
          </View>
        )}

        <Pressable
          style={styles.addBtn}
          onPress={() => router.push("/payout-methods/new" as any)}
          testID="add-payout-method"
        >
          <Icon name="add-circle" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>{t.addPayoutMethod}</Text>
        </Pressable>

        <Text style={styles.disclaimer}>{t.manualProcessing}</Text>
      </ScrollView>
    </View>
  );
}

function PmRow({
  m, onEdit, onDelete, onDefault,
}: {
  m: PayoutMethodRow; onEdit: () => void; onDelete: () => void; onDefault: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.pmCard} testID={`pm-${m.id}`}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.pmIcon}>
          <Icon name="wallet" size={22} color={colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={styles.pmLabel}>{m.label}</Text>
            {m.is_default && (
              <View style={styles.defaultPill}><Text style={styles.defaultPillText}>{t.defaultLabel}</Text></View>
            )}
            <View style={styles.verifPill}>
              <Text style={styles.verifText}>
                {m.verification_status === "verified" ? t.verified : t.unverified}
              </Text>
            </View>
          </View>
          <Text style={styles.pmHint} numberOfLines={1}>{m.display_hint || "—"}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
        {!m.is_default && (
          <Pressable style={styles.actionBtn} onPress={onDefault} testID={`pm-default-${m.id}`}>
            <Icon name="star" size={14} color={colors.gold} />
            <Text style={styles.actionText}>{t.setAsDefault}</Text>
          </Pressable>
        )}
        <Pressable style={styles.actionBtn} onPress={onEdit} testID={`pm-edit-${m.id}`}>
          <Icon name="create" size={14} color={colors.onSurface} />
          <Text style={styles.actionText}>Edit</Text>
        </Pressable>
        <Pressable style={[styles.actionBtn, { backgroundColor: colors.error + "22" }]} onPress={onDelete} testID={`pm-delete-${m.id}`}>
          <Icon name="trash" size={14} color={colors.error} />
          <Text style={[styles.actionText, { color: colors.error }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  empty: { marginHorizontal: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, alignItems: "center", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  emptyTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  emptySub: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18 },
  pmCard: { backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pmIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold + "22", alignItems: "center", justifyContent: "center" },
  pmLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  pmHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  defaultPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.gold + "33" },
  defaultPillText: { color: colors.gold, fontSize: 9, fontWeight: "900" },
  verifPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  verifText: { color: colors.muted, fontSize: 9, fontWeight: "800" },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  actionText: { color: colors.onSurface, fontSize: 11, fontWeight: "700" },
  addBtn: { marginHorizontal: spacing.lg, marginTop: spacing.lg, backgroundColor: colors.brandPrimary, padding: spacing.md, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  addText: { color: colors.onBrandPrimary, fontWeight: "900" },
  disclaimer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.lg, paddingHorizontal: spacing.lg, fontStyle: "italic" },
  intermediaryCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1.5,
    borderColor: colors.gold + "66",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  intermediaryIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.gold + "22",
    alignItems: "center", justifyContent: "center",
  },
  intermediaryTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900" },
  intermediarySub: { color: colors.muted, fontSize: 11, marginTop: 2, lineHeight: 15 },
});
