/** Iter-151 — Web Admin: live custom gifts (VIP5+ creations) with removal. */
import React from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminCustomGifts, apiAdminDeleteCustomGift } from "@/src/api";
import { mediaUrl } from "@/src/media/upload";
import { colors, spacing, radius } from "@/src/theme";

export default function AdminCustomGifts() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-custom-gifts"], queryFn: apiAdminCustomGifts });
  const remove = async (id: string) => {
    await apiAdminDeleteCustomGift(id).catch(() => {});
    qc.invalidateQueries({ queryKey: ["admin-custom-gifts"] });
  };
  return (
    <AdminShell title="Custom Gifts · الهدايا المخصصة">
      {isLoading ? <ActivityIndicator color={colors.gold} /> : (
        <View style={{ gap: spacing.sm }}>
          {(data?.items ?? []).length === 0 && <Text style={styles.sub}>No custom gifts · لا توجد هدايا مخصصة</Text>}
          {(data?.items ?? []).map((g) => (
            <View key={g.id} style={[adminStyles.card, styles.row]} testID={`admin-cg-${g.id}`}>
              <Image source={mediaUrl(g.image_url)} style={styles.img} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.h}>{g.name}</Text>
                <Text style={styles.sub}>{g.owner_nickname} · {g.video_url ? "🎬 video" : "image"} · {g.created_at?.slice(0, 10)}</Text>
              </View>
              <Pressable onPress={() => remove(g.id)} style={styles.del} testID={`admin-cg-del-${g.id}`}>
                <Text style={styles.delText}>Remove · حذف</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  img: { width: 56, height: 56, borderRadius: 14 },
  h: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  sub: { color: colors.muted, fontSize: 12 },
  del: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.error, alignItems: "center", justifyContent: "center" },
  delText: { color: colors.error, fontWeight: "800", fontSize: 12 },
});
