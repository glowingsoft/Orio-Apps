import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiMyRooms } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

export default function MyRooms() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t } = useI18n();
  const { data: rooms = [], isLoading } = useQuery({ queryKey: ["my-rooms"], queryFn: apiMyRooms });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="my-rooms-screen">
      <View style={[styles.header]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.myRoomsTitle}</Text>
        <Pressable testID="create-btn" onPress={() => router.push("/create-room")} style={styles.iconBtnGold}>
          <Icon name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : rooms.length === 0 ? (
        <View style={styles.center}>
          <Icon name="mic-outline" size={64} color={colors.muted} />
          <Text style={styles.empty}>{t.noOwnedRoomsLong}</Text>
          <Pressable testID="empty-create-btn" onPress={() => router.push("/create-room")} style={styles.emptyCta}>
            <Text style={styles.emptyCtaText}>{t.createARoom}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          renderItem={({ item }) => (
            <Pressable testID={`myroom-${item.id}`} onPress={() => router.push(`/room/${item.id}`)} style={styles.card}>
              <Image source={item.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.85)"]} style={StyleSheet.absoluteFill} />
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>{t.liveLabel}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.roomName}>{item.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Icon name="people" size={12} color={colors.muted} />
                  <Text style={styles.listeners}>{t.listenersCountLabel(item.listeners_count ?? 0)}</Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  iconBtnGold: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xxl },
  empty: { color: colors.muted, textAlign: "center" },
  emptyCta: { backgroundColor: colors.gold, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill },
  emptyCtaText: { color: colors.onBrandPrimary, fontWeight: "800" },
  card: { height: 160, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceSecondary },
  liveBadge: { position: "absolute", top: spacing.md, left: spacing.md, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.error },
  liveText: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  info: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md },
  roomName: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  listeners: { color: colors.muted, fontSize: 12 },
});
