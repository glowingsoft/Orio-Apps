/**
 * Iter-99 — Owner-only Friends / Following / Followers lists.
 * Always the signed-in user's own data (GET /api/me/connections).
 */
import { useState } from "react";
import { VipName } from "@/src/components/VipName";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiMyConnections, apiFollow, apiUnfollow } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { RowSeparator } from "@/src/components/RowSeparator";
import { VipBadge } from "@/src/components/VipBadge";
import { ScreenHeader, TabBar } from "@/src/cosmetics/ui";

type T = "friends" | "following" | "followers";

export default function Connections() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ type?: string }>();
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const initial: T = params.type === "following" || params.type === "followers" ? params.type : "friends";
  const [type, setType] = useState<T>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["connections", type], queryFn: () => apiMyConnections(type) });
  const items = data?.items ?? [];
  const counts = data?.counts;

  const toggle = async (u: any) => {
    setBusy(u.id);
    try {
      if (u.is_following) await apiUnfollow(u.id); else await apiFollow(u.id);
      await qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["profile", u.id] });
    } finally { setBusy(null); }
  };

  const label = (k: T) => `${k === "friends" ? t.friends : k === "following" ? t.following : t.followers}${counts ? ` ${counts[k]}` : ""}`;

  return (
    <View style={styles.container} testID="connections-screen">
      <ScreenHeader testID="connections" title={ar ? "علاقاتي" : "My Connections"} />
      <TabBar
        tabs={(["friends", "following", "followers"] as T[]).map((k) => ({ id: k, label: label(k) }))}
        value={type}
        onChange={setType}
      />
      {isLoading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
      ) : items.length === 0 ? (
        <View style={styles.center} testID="connections-empty">
          <Icon name="people-outline" size={52} color={colors.muted} />
          <Text style={styles.empty}>{ar ? "لا يوجد أحد هنا بعد" : "No one here yet"}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(u: any) => u.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          ItemSeparatorComponent={() => <RowSeparator gap={spacing.sm} />}
          renderItem={({ item }: any) => (
            <Pressable testID={`conn-${item.id}`} onPress={() => router.push(`/user/${item.id}` as any)} style={styles.row}>
              <Image source={item.avatar_url} style={styles.avatar} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.nameRow}>
                  <VipName style={styles.name} numberOfLines={1} name={item?.nickname} color={(item as any)?.name_color} vipLevel={(item as any)?.vip_level} />
                  {item.vip_level > 0 && <VipBadge level={item.vip_level} />}
                </View>
                {item.numeric_id ? <Text style={styles.sub}>ID: {item.numeric_id}</Text> : null}
              </View>
              <Pressable
                testID={`conn-follow-${item.id}`}
                disabled={busy === item.id}
                onPress={() => toggle(item)}
                style={[styles.btn, item.is_following ? styles.btnGhost : styles.btnSolid]}
              >
                <Text style={[styles.btnText, item.is_following && { color: colors.onSurface }]}>
                  {item.is_following ? (ar ? "إلغاء المتابعة" : "Unfollow") : (ar ? "متابعة" : "Follow")}
                </Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  empty: { color: colors.muted, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceTertiary },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  sub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  btn: { paddingHorizontal: spacing.md, minHeight: 34, borderRadius: radius.pill, justifyContent: "center" },
  btnSolid: { backgroundColor: colors.gold },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12 },
});
