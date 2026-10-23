/**
 * Gift Received page — shows all gifts a specific user has been gifted.
 * Real backend data (no placeholders). Accessible from any RoomUserCard
 * and from a user's profile Gift Gallery.
 */
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from "react-native";
import { VipName } from "@/src/components/VipName";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { apiUserGiftsReceived } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";
import { Diamond } from "@/src/components/Diamond";
import { OrioRefreshControl } from "@/src/components/OrioRefreshControl";

export default function ReceivedGiftsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["gifts-received-page", id],
    queryFn: () => apiUserGiftsReceived(id!),
    enabled: !!id,
  });

  const gifts: any[] = data?.gifts || [];
  const user = data?.user;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="gifts-received-screen">
      {/* Header */}
      <View style={styles.header}>
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Icon name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title}>Gifts Received</Text>
          {user?.nickname && (
            <VipName style={styles.subtitle} numberOfLines={1} name={user?.nickname} color={(user as any)?.name_color} vipLevel={(user as any)?.vip_level} />
          )}
        </View>
        <View style={styles.iconBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <FlatList
          data={gifts}
          keyExtractor={(g) => g.gift_id}
          testID="gifts-received-list"
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm }}
          numColumns={3}
          columnWrapperStyle={{ gap: spacing.sm }}
          refreshControl={<OrioRefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />}
          ListHeaderComponent={() => (
            <View style={styles.summary}>
              <Image source={user?.avatar_url} style={styles.summaryAvatar} />
              <View style={{ flex: 1 }}>
                <VipName style={styles.summaryName} name={user?.nickname || "—"} vipLevel={user?.vip_level ?? 0} />
                <Text style={styles.summaryId}>ID: {user?.numeric_id || "—"}</Text>
              </View>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryStatLabel}>Total gifts</Text>
                <Text style={styles.summaryStatValue}>{data?.total_gifts ?? 0}</Text>
              </View>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryStatLabel}>Value</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Diamond size={13} />
                  <Text style={styles.summaryStatValue}>{data?.total_value ?? 0}</Text>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={() => (
            <View style={styles.emptyWrap}>
              <Icon name="gift-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>No gifts received yet</Text>
              <Text style={styles.emptyHint}>Gifts sent to this user will appear here.</Text>
            </View>
          )}
          renderItem={({ item }: any) => (
            <View style={styles.giftCard} testID={`gift-card-${item.gift_id}`}>
              <View style={styles.giftImgWrap}>
                <Image source={item.gift_image} style={styles.giftImg} contentFit="cover" />
                <View style={styles.giftQtyBadge}>
                  <Text style={styles.giftQtyText}>×{item.total_quantity}</Text>
                </View>
              </View>
              <Text style={styles.giftName} numberOfLines={1}>{item.gift_name}</Text>
              <View style={styles.giftPriceRow}>
                <Diamond size={11} />
                <Text style={styles.giftPriceText}>{item.total_cost}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center",
  },
  title: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },

  summary: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.gold + "22",
  },
  summaryAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceTertiary },
  summaryName: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  summaryId: { color: colors.muted, fontSize: 11, marginTop: 2 },
  summaryStat: { alignItems: "center", minWidth: 60 },
  summaryStatLabel: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  summaryStatValue: { color: colors.gold, fontSize: 14, fontWeight: "900" },

  giftCard: {
    flex: 1, maxWidth: "31.5%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, padding: spacing.sm,
    alignItems: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  giftImgWrap: { width: 64, height: 64, borderRadius: 12, overflow: "hidden", position: "relative", backgroundColor: colors.surfaceTertiary },
  giftImg: { width: "100%", height: "100%" },
  giftQtyBadge: {
    position: "absolute", right: -2, bottom: -2,
    backgroundColor: colors.gold, paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 8, borderWidth: 1, borderColor: colors.surface,
  },
  giftQtyText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "900" },
  giftName: { color: colors.onSurface, fontSize: 12, fontWeight: "700", marginTop: 6, textAlign: "center" },
  giftPriceRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 },
  giftPriceText: { color: colors.gold, fontSize: 11, fontWeight: "800" },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl * 2 },
  emptyText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  emptyHint: { color: colors.muted, fontSize: 12, textAlign: "center", maxWidth: 220 },
});
