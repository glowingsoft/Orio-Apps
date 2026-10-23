/**
 * 🏠 popup anchored under the Rooms header house button:
 *  • My Room — opens the room I own (or Create Room if I have none)
 *  • Rooms I Manage — rooms where I'm currently a moderator (server list)
 * Data is prefetched by the Rooms screen → opens and navigates instantly.
 */
import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

export function HomeRoomsMenu({ anchorY, onClose, myRoom, managed, onOpen }: {
  anchorY: number | null; onClose: () => void; myRoom: any | null; managed: any[]; onOpen: (path: string) => void;
}) {
  const { isRTL } = useI18n();
  const close = onClose;
  return (
    <Modal visible={anchorY != null} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} testID="home-menu-backdrop">
        <View style={[styles.anchor, { top: anchorY ?? 0 }]} pointerEvents="box-none">
          <Pressable style={styles.card} onPress={() => {}} testID="home-rooms-menu">
            <View style={styles.caret} />
            <Pressable
              testID="home-menu-my-room"
              onPress={() => onOpen(myRoom?.id ? `/room/${myRoom.id}` : "/create-room")}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Icon name="home" size={18} color={colors.brandPrimary} />
              <Text style={styles.label}>{isRTL ? "غرفتي" : "My Room"}</Text>
              {!myRoom && <Text style={styles.hint}>{isRTL ? "إنشاء" : "Create"}</Text>}
            </Pressable>
            <View style={styles.sep} />
            <Pressable
              testID="home-menu-managed"
              onPress={() => onOpen("/managed-rooms")}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Icon name="shield-checkmark" size={18} color={colors.gold} />
              <Text style={styles.label}>{isRTL ? "الغرف التي أديرها" : "Rooms I Manage"}</Text>
              <Text style={styles.hint}>{managed.length}</Text>
              <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={14} color={colors.muted} />
            </Pressable>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Anchored to the END edge (where the 🏠 button sits) — mirrors natively in RTL.
  anchor: { position: "absolute", left: 0, right: 0, alignItems: "flex-end", paddingHorizontal: spacing.lg },
  card: {
    width: 240, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 12,
  },
  caret: { position: "absolute", top: -6, end: 16, width: 12, height: 12, backgroundColor: colors.surface, borderLeftWidth: 1, borderTopWidth: 1, borderColor: colors.border, transform: [{ rotate: "45deg" }] },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, height: 48 },
  pressed: { backgroundColor: colors.surfaceSecondary },
  label: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.md },
});
