import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiFriendship, apiFriendshipAccept } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";
import { VipBadge } from "@/src/components/VipBadge";
import { VipName } from "@/src/components/VipName";

export default function Friendship() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { isRTL, t } = useI18n();
  const qc = useQueryClient();

  const { data: list = [], isLoading, refetch } = useQuery({ queryKey: ["friendship"], queryFn: apiFriendship });
  const accept = useMutation({
    mutationFn: (id: string) => apiFriendshipAccept(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["friendship"] }),
  });

  const accepted = list.filter((r: any) => r.status === "accepted");
  const pending = list.filter((r: any) => r.status === "pending" && !r.requested_by_me);
  const sent = list.filter((r: any) => r.status === "pending" && r.requested_by_me);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="friendship-screen">
      <View style={[styles.header]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.friendshipTitle}</Text>
        <View style={{ width: 40 }} />
      </View>
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Icon name="people-outline" size={64} color={colors.muted} />
          <Text style={styles.empty}>{t.noFriendshipsYet}</Text>
          <Text style={styles.emptySub}>{t.sendFriendshipRequestsHint}</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ListHeaderComponent={() => (
            <>
              {pending.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>{t.incomingRequests(pending.length)}</Text>
                  {pending.map((r: any) => (
                    <View key={r.id} style={[styles.row]} testID={`inc-${r.id}`}>
                      <Image source={r.other?.avatar_url} style={styles.avatar} />
                      <View style={{ flex: 1 }}>
                        <VipName style={styles.name} name={r.other?.nickname} color={(r.other as any)?.name_color} vipLevel={(r.other as any)?.vip_level} />
                        <Text style={styles.sub}>{t.wantsToBeFriends}</Text>
                      </View>
                      <Pressable testID={`accept-${r.id}`} onPress={() => accept.mutate(r.other.id)} style={styles.acceptBtn}>
                        <Text style={styles.acceptText}>{t.accept}</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              )}
              {accepted.length > 0 && <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>{t.friendsCountLabel(accepted.length)}</Text>}
            </>
          )}
          renderItem={({ item }) => item.status === "pending" ? null : (
            <Pressable style={[styles.row]} testID={`friend-${item.id}`} onPress={() => router.push(`/chat/${item.other.id}`)}>
              <Image source={item.other?.avatar_url} style={styles.avatar} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <VipName style={styles.name} name={item.other?.nickname} color={(item.other as any)?.name_color} vipLevel={(item.other as any)?.vip_level} />
                  {item.other?.vip_level > 0 && <VipBadge level={item.other.vip_level} />}
                </View>
                <Text style={styles.sub}>{t.lvPts(item.level, item.points)}</Text>
              </View>
              <Icon name="chatbubble" size={18} color={colors.gold} />
            </Pressable>
          )}
          ListFooterComponent={() => sent.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>{t.sentRequestsLabel(sent.length)}</Text>
              {sent.map((r: any) => (
                <View key={r.id} style={[styles.row]}>
                  <Image source={r.other?.avatar_url} style={styles.avatar} />
                  <View style={{ flex: 1 }}>
                    <VipName style={styles.name} name={r.other?.nickname} color={(r.other as any)?.name_color} vipLevel={(r.other as any)?.vip_level} />
                    <Text style={styles.sub}>{t.pendingDots}</Text>
                  </View>
                  <Icon name="time-outline" size={20} color={colors.muted} />
                </View>
              ))}
            </>
          ) : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  empty: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  emptySub: { color: colors.muted, fontSize: 13, textAlign: "center" },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: radius.md },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  vipMini: { backgroundColor: colors.gold, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.pill },
  vipMiniText: { color: colors.onBrandPrimary, fontSize: 9, fontWeight: "800" },
  acceptBtn: { backgroundColor: colors.gold, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  acceptText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12 },
});
