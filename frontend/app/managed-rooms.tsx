/**
 * Rooms I Manage — every room where I'm currently a moderator (server list),
 * rendered with the same RoomCard as room discovery.
 */
import React from "react";
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { apiRoomsManaged } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing } from "@/src/theme";
import { RoomCard } from "@/src/components/RoomCard";
import { OrioRefreshControl } from "@/src/components/OrioRefreshControl";

export default function ManagedRooms() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isRTL } = useI18n();
  const { data = [], isLoading, refetch, isRefetching } = useQuery({ queryKey: ["rooms-managed"], queryFn: apiRoomsManaged, staleTime: 15_000 });
  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="managed-rooms-screen">
      <View style={styles.header}>
        <Pressable onPress={() => safeBack(router)} hitSlop={10} style={styles.back} testID="managed-rooms-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isRTL ? "الغرف التي أديرها" : "Rooms I Manage"}</Text>
        <View style={styles.back} />
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={data as any[]}
          keyExtractor={(r: any) => r.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm }}
          refreshControl={<OrioRefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          renderItem={({ item }) => <RoomCard room={item} testID={`managed-room-${item.id}`} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="managed-rooms-empty">
              <Icon name="shield-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>{isRTL ? "لست مشرفًا في أي غرفة حاليًا" : "You don't moderate any rooms yet"}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, height: 52 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 17, fontWeight: "900" },
  empty: { alignItems: "center", gap: spacing.md, marginTop: spacing.xxxl },
  emptyText: { color: colors.muted, fontSize: 14 },
});
