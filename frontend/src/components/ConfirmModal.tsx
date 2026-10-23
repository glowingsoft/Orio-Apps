/**
 * ORIO Premium Confirmation Modal (iter-44)
 * ----------------------------------------------------------------------------
 * Use this for destructive / irreversible actions where a Toast is NOT
 * appropriate (exit the app, delete, leave room, etc). Dark luminous-purple
 * styled, ORIO logo at the top, title + body + primary/secondary actions.
 */
import React from "react";
import { View, Text, StyleSheet, Modal, Pressable, Platform } from "react-native";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

export type ConfirmModalProps = {
  visible: boolean;
  title: string;
  body?: string;
  primaryLabel: string;
  secondaryLabel?: string;
  primaryTone?: "default" | "danger";
  onPrimary: () => void;
  onSecondary?: () => void;
  onDismiss?: () => void;
  testID?: string;
  hideLogo?: boolean;
};

export function ConfirmModal({
  visible, title, body, primaryLabel, secondaryLabel, primaryTone = "default",
  onPrimary, onSecondary, onDismiss, testID, hideLogo,
}: ConfirmModalProps) {
  const { isRTL } = useI18n();
  const primaryBg = primaryTone === "danger" ? colors.error : colors.brandPrimary;
  const primaryText = primaryTone === "danger" ? colors.onError : colors.onBrandPrimary;
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={() => (onDismiss ?? onSecondary ?? (() => undefined))()}
      testID={testID}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => (onDismiss ?? onSecondary ?? (() => undefined))()}
      >
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.title, { textAlign: "center", writingDirection: isRTL ? "rtl" : "ltr" }]}>
            {title}
          </Text>
          {body ? (
            <Text style={[styles.body, { textAlign: "center", writingDirection: isRTL ? "rtl" : "ltr" }]}>
              {body}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: primaryBg }]}
              onPress={onPrimary}
              testID="confirm-primary"
            >
              <Text style={[styles.primaryText, { color: primaryText }]}>{primaryLabel}</Text>
            </Pressable>
            {secondaryLabel ? (
              <Pressable style={styles.secondaryBtn} onPress={onSecondary} testID="confirm-secondary">
                <Text style={styles.secondaryText}>{secondaryLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brandPrimary + "55",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 24,
  },
  logoWrapUnused: {
    width: 72, height: 72,
    marginBottom: spacing.md,
    borderRadius: 36,
    alignItems: "center", justifyContent: "center",
    backgroundColor: Platform.select({ ios: "rgba(155,108,255,0.08)", default: "rgba(155,108,255,0.14)" }),
    borderWidth: 1,
    borderColor: colors.brandPrimary + "44",
  },
  title: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  actions: {
    width: "100%",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  primaryBtn: {
    height: 50,
    borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  primaryText: { fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },
  secondaryBtn: {
    height: 46,
    borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  secondaryText: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
});

export default ConfirmModal;
