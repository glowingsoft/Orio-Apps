import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { VipName } from "@/src/components/VipName";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiFriendRequests, apiFriendRequestAct } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { RowSeparator } from "@/src/components/RowSeparator";
import { VipBadge } from "@/src/components/VipBadge";
import { ScreenHeader } from "@/src/cosmetics/ui";

export default function FriendRequests() {
  const router = useRouter();
  const qc = useQueryClient();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { data, isLoading } = useQuery({ queryKey: ["friend-requests"], queryFn: apiFriendRequests });
  const items = data?.items ?? [];

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "reject" }) => apiFriendRequestAct(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["friend-requests"] });
      qc.invalidateQueries({ queryKey: ["inbox-overview"] });
      qc.invalidateQueries({ queryKey: ["friendship"] });
    },
  });

  return (
    <View style={styles.container} testID="friend-requests-screen">
      <ScreenHeader testID="friend-requests" title={ar ? "طلبات الصداقة" : "Friend Requests"} />
      {isLoading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Icon name="person-add-outline" size={56} color={colors.muted} />
          <Text style={styles.empty}>{ar ? "لا توجد طلبات صداقة حالياً" : "No friend requests right now"}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r: any) => r.user.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ItemSeparatorComponent={() => <RowSeparator gap={spacing.md} />}
          renderItem={({ item }: any) => (
            <View style={styles.row} testID={`fr-${item.user.id}`}>
              <Pressable onPress={() => router.push(`/user/${item.user.id}` as any)}>
                <Image source={item.user.avatar_url} style={styles.avatar} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <VipName style={styles.name} numberOfLines={1} name={item.user?.nickname} color={(item.user as any)?.name_color} vipLevel={(item.user as any)?.vip_level} />
                  {item.user.vip_level > 0 && <VipBadge level={item.user.vip_level} />}
                </View>
                <Text style={styles.sub}>
                  {item.source === "request" ? (ar ? "يريد أن يصبح صديقك" : "Wants to be your friend") : (ar ? "يتابعك" : "Follows you")}
                </Text>
              </View>
              <Pressable
                testID={`fr-reject-${item.user.id}`}
                disabled={act.isPending}
                onPress={() => act.mutate({ id: item.user.id, action: "reject" })}
                style={[styles.btn, styles.rejectBtn]}
              >
                <Text style={styles.rejectText}>{ar ? "رفض" : "Reject"}</Text>
              </Pressable>
              <Pressable
                testID={`fr-accept-${item.user.id}`}
                disabled={act.isPending}
                onPress={() => act.mutate({ id: item.user.id, action: "accept" })}
                style={[styles.btn, styles.acceptBtn]}
              >
                <Text style={styles.acceptText}>{ar ? "قبول" : "Accept"}</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  empty: { color: colors.muted, fontSize: 14, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  btn: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, minHeight: 36, justifyContent: "center" },
  acceptBtn: { backgroundColor: colors.gold },
  acceptText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12 },
  rejectBtn: { backgroundColor: colors.error + "22", borderWidth: 1, borderColor: colors.error },
  rejectText: { color: colors.error, fontWeight: "800", fontSize: 12 },
});
