/**
 * Shared bottom action sheet (long-press menus). `destructive` actions and
 * the Cancel row are red per spec.
 */
import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import Icon from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius } from "@/src/theme";

export type SheetAction = { key: string; icon: string; label: string; onPress: () => void; destructive?: boolean };

export function ActionSheet({ visible, onClose, actions, cancelLabel, testID }: {
  visible: boolean; onClose: () => void; actions: SheetAction[]; cancelLabel: string; testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]} onPress={() => {}} testID={testID}>
          {actions.map((a) => (
            <Pressable
              key={a.key}
              testID={testID ? `${testID}-${a.key}` : undefined}
              onPress={() => { onClose(); a.onPress(); }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Icon name={a.icon as any} size={20} color={a.destructive ? colors.error : colors.onSurface} />
              <Text style={[styles.label, a.destructive && { color: colors.error }]}>{a.label}</Text>
            </Pressable>
          ))}
          <Pressable testID={testID ? `${testID}-cancel` : undefined} onPress={onClose} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.sm, paddingHorizontal: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: 14, height: 54, paddingHorizontal: spacing.md, borderRadius: radius.md },
  pressed: { backgroundColor: colors.surfaceSecondary },
  label: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  cancel: { height: 54, alignItems: "center", justifyContent: "center", marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, borderRadius: radius.md },
  cancelText: { color: colors.error, fontSize: 16, fontWeight: "800" },
});
