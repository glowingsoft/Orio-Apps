import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { apiRoomEvents } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { RowSeparator } from "@/src/components/RowSeparator";
import { ScreenHeader, TabBar } from "@/src/cosmetics/ui";

type Scope = "all" | "mine";
type Phase = "ongoing" | "upcoming";

const STATUS_COLOR: Record<string, string> = { pending: colors.warning, approved: colors.success, rejected: colors.error };

export default function Activities() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [scope, setScope] = useState<Scope>("all");
  const [phase, setPhase] = useState<Phase>("ongoing");
  const { data, isLoading } = useQuery({
    queryKey: ["room-events", scope, phase],
    queryFn: () => apiRoomEvents(scope, phase),
  });
  const items = data?.items ?? [];
  const statusLabel = (s: string) =>
    s === "approved" ? (ar ? "مقبول" : "Approved") : s === "rejected" ? (ar ? "مرفوض" : "Rejected") : (ar ? "قيد المراجعة" : "Under review");

  return (
    <View style={styles.container} testID="activities-screen">
      <ScreenHeader testID="activities" title={ar ? "الأنشطة" : "Activities"} />
      <TabBar
        tabs={[
          { id: "all" as Scope, icon: "sparkles-outline", label: ar ? "الأنشطة" : "Activities" },
          { id: "mine" as Scope, icon: "person-outline", label: ar ? "أنشطتي" : "My Activities" },
        ]}
        value={scope}
        onChange={setScope}
      />
      {scope === "all" && (
      <View style={styles.subTabs}>
        {([
          { id: "ongoing" as Phase, label: ar ? "جار الآن" : "Live Now" },
          { id: "upcoming" as Phase, label: ar ? "تبدأ قريباً" : "Starting Soon" },
        ]).map((p) => (
          <Pressable
            key={p.id}
            testID={`subtab-${p.id}`}
            onPress={() => setPhase(p.id)}
            style={[styles.subTab, phase === p.id && styles.subTabActive]}
          >
            <Text style={[styles.subTabText, phase === p.id && styles.subTabTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      )}

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center} testID="activities-empty">
          <Icon name="sparkles-outline" size={56} color={colors.muted} />
          <Text style={styles.emptyText}>{ar ? "لا توجد أنشطة جارية حالياً." : "No activities are currently running."}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i: any) => i.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ItemSeparatorComponent={() => <RowSeparator gap={spacing.md} />}
          renderItem={({ item }: any) => (
            <Pressable
              testID={`activity-${item.id}`}
              disabled={!item.room_id}
              onPress={() => router.push(`/room/${item.room_id}` as any)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <Image source={item.image_url} style={styles.cover} contentFit="cover" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {item.room_name ? <Text style={styles.room} numberOfLines={1}>{item.room_name}</Text> : null}
                <Text style={styles.date}>{item.start_at ? new Date(item.start_at).toLocaleDateString() : ""}</Text>
                {scope === "mine" && (
                  <View style={[styles.status, { borderColor: STATUS_COLOR[item.status] || colors.muted }]}>
                    <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] || colors.muted }]}>{statusLabel(item.status)}</Text>
                  </View>
                )}
              </View>
              <Icon name={ar ? "chevron-back" : "chevron-forward"} size={18} color={colors.muted} />
            </Pressable>
          )}
        />
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="activities-apply" onPress={() => router.push("/activity-apply" as any)} style={styles.applyBtn}>
          <Text style={styles.applyText}>{ar ? "قدّم الآن" : "Apply Now"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  subTabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md, flexShrink: 0 },
  subTab: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, minHeight: 32, justifyContent: "center", flexShrink: 0 },
  subTabActive: { borderColor: colors.gold, backgroundColor: colors.gold + "22" },
  subTabText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  subTabTextActive: { color: colors.gold },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cover: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  room: { color: colors.muted, fontSize: 12 },
  date: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  status: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: "800" },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, flexShrink: 0 },
  applyBtn: { backgroundColor: colors.gold, borderRadius: radius.pill, height: 50, alignItems: "center", justifyContent: "center" },
  applyText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900" },
});
