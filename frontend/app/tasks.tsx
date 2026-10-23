import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiTasks, apiTaskClaim } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth-context";
import { Diamond } from "@/src/components/Diamond";
import { colors, spacing, radius } from "@/src/theme";

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { lang, isRTL } = useI18n();
  const { refresh } = useAuth();

  const { data, isLoading, refetch } = useQuery({ queryKey: ["tasks"], queryFn: apiTasks, refetchOnMount: "always" });
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const tasks = data ?? [];

  // Iter-117 — "Go" routes straight to the activity that completes the task.
  const goFor = (id: string) => {
    if (id === "recharge") return "/(tabs)/wallet";
    if (id === "post_5") return "/create-post";
    if (id === "view_10_profiles") return "/search";
    return "/(tabs)/home"; // room / mic tasks
  };
  const claim = useMutation({
    mutationFn: (task_id: string) => apiTaskClaim(task_id),
    onSuccess: async (r: any) => {
      Alert.alert(lang === "ar" ? "تم" : "Claimed", `+${r.reward} 💎`);
      await refresh();
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await refetch();
    },
    onError: (e: any) => Alert.alert(lang === "ar" ? "خطأ" : "Error", e?.message || "Failed"),
  });

  return (
    <View style={styles.container} testID="tasks-screen">
      <LinearGradient colors={[colors.purpleDeep, colors.surface]} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 0, y: 0.5 }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="tasks-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{lang === "ar" ? "المهام اليومية" : "Daily Tasks"}</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md }}>
          {tasks.map((t: any) => {
            const label = lang === "ar" ? t.name_ar : t.name_en;
            const pct = Math.min(1, (t.progress || 0) / (t.target || 1));
            const canClaim = t.completed && !t.claimed;
            return (
              <View key={t.id} style={styles.card} testID={`task-${t.id}`}>
                <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={[styles.icon, canClaim && { backgroundColor: colors.gold + "22", borderColor: colors.gold }]}>
                    <Icon name={t.claimed ? "checkmark-done" : canClaim ? "gift" : "time"} size={20} color={t.claimed ? colors.success : canClaim ? colors.gold : colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskName}>{label}</Text>
                    <View style={styles.progressBg}>
                      <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
                    </View>
                    <Text style={styles.progressText}>{Math.min(t.progress, t.target)} / {t.target}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Diamond size={14} />
                      <Text style={styles.reward}>+{t.reward}</Text>
                    </View>
                    <Pressable
                      testID={`task-claim-${t.id}`}
                      disabled={t.claimed || claim.isPending}
                      onPress={() => (canClaim ? claim.mutate(t.id) : router.push(goFor(t.id) as any))}
                      style={({ pressed }) => [
                        styles.claimBtn,
                        !canClaim && !t.claimed && { backgroundColor: colors.brandPrimary },
                        t.claimed && { backgroundColor: colors.success + "33" },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text testID={`task-action-${t.id}`} style={[styles.claimText, !canClaim && !t.claimed && { color: colors.onBrandPrimary }, t.claimed && { color: colors.success }]}>
                        {t.claimed ? (lang === "ar" ? "استُلم" : "Claimed") : canClaim ? (lang === "ar" ? "استلام" : "Claim") : (lang === "ar" ? "اذهب" : "Go")}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
          <Text style={styles.footer}>{lang === "ar" ? "تُعاد المهام يوميًا في منتصف الليل UTC" : "Tasks reset daily at midnight UTC"}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  taskName: { color: colors.onSurface, fontSize: 14, fontWeight: "700", marginBottom: 6 },
  progressBg: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.gold, borderRadius: 3 },
  progressText: { color: colors.muted, fontSize: 11, marginTop: 4, fontWeight: "600" },
  reward: { color: colors.gold, fontWeight: "900", fontSize: 13 },
  claimBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.gold, minWidth: 88, alignItems: "center" },
  claimText: { color: "#000", fontWeight: "900", fontSize: 12 },
  footer: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.md, fontStyle: "italic" },
});
