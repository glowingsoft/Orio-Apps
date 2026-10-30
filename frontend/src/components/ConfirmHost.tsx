import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import Icon from "@react-native-vector-icons/ionicons";
import { registerConfirmHost, type ConfirmRequest } from "@/src/utils/confirm";
import { colors, spacing, radius } from "@/src/theme";

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(
    () =>
      registerConfirmHost((next) => {
        setReq((prev) => {
          prev?.resolve(false);
          return next;
        });
      }),
    [],
  );

  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };

  return (
    <Modal visible={!!req} transparent animationType="fade" onRequestClose={() => close(false)} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={() => close(false)} testID="confirm-backdrop">
        <Pressable style={styles.card} onPress={() => {}} testID="confirm-dialog">
          <View style={[styles.iconWrap, req?.destructive ? styles.iconDanger : styles.iconInfo]}>
            <Icon
              name={req?.destructive ? "warning-outline" : "help-circle-outline"}
              size={26}
              color={req?.destructive ? colors.error : colors.brandPrimary}
            />
          </View>
          <Text style={styles.title}>{req?.title}</Text>
          {!!req?.message && <Text style={styles.message}>{req.message}</Text>}
          <View style={styles.actions}>
            <Pressable onPress={() => close(false)} style={[styles.btn, styles.cancelBtn]} testID="confirm-cancel">
              <Text style={styles.cancelText}>{req?.cancelText}</Text>
            </Pressable>
            <Pressable
              onPress={() => close(true)}
              style={[styles.btn, req?.destructive ? styles.dangerBtn : styles.primaryBtn]}
              testID="confirm-ok"
            >
              <Text style={styles.okText}>{req?.confirmText}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: {
    width: "100%", maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.lg, alignItems: "center", gap: spacing.sm,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  iconDanger: { backgroundColor: colors.error + "1A" },
  iconInfo: { backgroundColor: colors.brandPrimary + "1A" },
  title: { color: colors.onSurface, fontSize: 17, fontWeight: "800", textAlign: "center" },
  message: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, alignSelf: "stretch" },
  btn: { flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  cancelBtn: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  primaryBtn: { backgroundColor: colors.brandPrimary },
  dangerBtn: { backgroundColor: colors.error },
  cancelText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  okText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
