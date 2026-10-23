/**
 * Iter-117 — half-screen room info sheet (tap the room title).
 * Settings gear is visible ONLY to the room owner → opens the Room Settings page.
 */
import React from "react";
import { VipName } from "@/src/components/VipName";
import { View, Text, Modal, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

export function RoomTitleSheet({ visible, room, isOwner, memberCount, onClose, onOpenSettings, onOpenOwner }: {
  visible: boolean; room: any; isOwner: boolean; memberCount: number;
  onClose: () => void; onOpenSettings: () => void; onOpenOwner: (uid: string) => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isRTL } = useI18n();
  if (!visible || !room) return null;
  const ta = { textAlign: isRTL ? "right" : "left" } as const;
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} testID="room-title-sheet-overlay">
        <Pressable style={[styles.sheet, { height: height * 0.5, paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()} testID="room-title-sheet">
          <View style={styles.handle} />
          <View style={[styles.head, { flexDirection: "row" }]}>
            <Image source={room.cover_url} style={styles.cover} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <View style={styles.namePlate}><Text style={[styles.name, ta]} numberOfLines={2} testID="room-title-sheet-name">{room.name}</Text></View>
              {!!room.numeric_id && <Text style={[styles.sub, ta]}>ID: {room.numeric_id}</Text>}
              <Text style={[styles.sub, ta]}>{isRTL ? `الأعضاء: ${memberCount}` : `Members: ${memberCount}`}</Text>
            </View>
            {isOwner && (
              <Pressable testID="room-settings-gear" onPress={onOpenSettings} hitSlop={8} style={styles.gear} accessibilityLabel={isRTL ? "إعدادات الغرفة" : "Room settings"}>
                <Icon name="settings" size={22} color={colors.onSurface} />
              </Pressable>
            )}
          </View>
          {!!room.owner?.id && (
            <Pressable onPress={() => onOpenOwner(room.owner.id)} style={[styles.owner, { flexDirection: "row" }]} testID="room-title-sheet-owner">
              <Image source={room.owner.avatar_url} style={styles.ownerAvatar} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.ownerLabel, ta]}>{isRTL ? "مالك الغرفة" : "Room owner"}</Text>
                <VipName style={[styles.ownerName, ta]} numberOfLines={1} name={room.owner?.nickname} color={(room.owner as any)?.name_color} vipLevel={(room.owner as any)?.vip_level} />
              </View>
            </Pressable>
          )}
          {!!room.notice && (
            <View style={styles.notice}>
              <Text style={[styles.ownerLabel, ta]}>{isRTL ? "الإعلان" : "Announcement"}</Text>
              <Text style={[styles.noticeText, ta]} numberOfLines={4}>{room.notice}</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  head: { gap: spacing.md, alignItems: "center" },
  cover: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  name: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  namePlate: { alignSelf: "flex-start", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, maxWidth: "100%" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  gear: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  owner: { gap: spacing.md, alignItems: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  ownerAvatar: { width: 40, height: 40, borderRadius: 20 },
  ownerLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  ownerName: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  notice: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 4 },
  noticeText: { color: colors.onSurface, fontSize: 13, lineHeight: 18 },
});
