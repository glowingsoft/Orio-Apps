/**
 * ORIO Premium Toast System (iter-44)
 * ----------------------------------------------------------------------------
 * One centralized provider powering ALL informational notifications across the
 * app. Dark translucent surface, ORIO icon, luminous purple accent, auto RTL,
 * smooth entrance + progress-bar countdown. Use this for ALL short in-app
 * messages — gift sent, copy succeeded, owner-only seat, generic errors, etc.
 *
 * Not for destructive confirmations — use the `ConfirmModal` for those.
 *
 * Usage anywhere in the app:
 *   import { useToast } from "@/src/components/Toast";
 *   const toast = useToast();
 *   toast.show({ message: "تم نسخ المعرف بنجاح" });
 *   toast.success("تم إرسال الهدية بنجاح");
 *   toast.error("حدث خطأ\nيرجى المحاولة مرة أخرى لاحقًا");
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Animated, Easing, Pressable, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";

// Official ORIO planet logo (user-supplied artwork, untouched colors).
const TOAST_LOGO = require("../../assets/images/yazeen-logo-small.png");
import { colors, spacing } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type ToastKind = "info" | "success" | "error" | "warning";

type ToastInput = {
  message: string;
  kind?: ToastKind;
  durationMs?: number;
};

type ToastInstance = ToastInput & { id: number };

type ToastContextType = {
  show: (input: ToastInput) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
  warning: (message: string, durationMs?: number) => void;
};

const ToastCtx = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Graceful degradation — allow calls before provider mounts (no crashes).
    return {
      show: () => undefined,
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ToastInstance[]>([]);
  const nextId = useRef(1);

  const show = useCallback((input: ToastInput) => {
    // Iter-48 — DEDUPE: if the same message is already visible, suppress the
    // duplicate. This stops the "tap once, 4 identical banners" bug on the
    // login screen when Facebook/Phone providers are disabled.
    setQueue((q) => {
      if (q.some((t) => t.message === input.message)) return q;
      const t: ToastInstance = { ...input, id: nextId.current++ };
      return [...q.slice(-2), t]; // keep at most 3 concurrent toasts
    });
  }, []);

  const remove = useCallback((id: number) => {
    setQueue((q) => q.filter((x) => x.id !== id));
  }, []);

  const ctx = useMemo<ToastContextType>(() => ({
    show,
    success: (m, d) => show({ message: m, kind: "success", durationMs: d }),
    error: (m, d) => show({ message: m, kind: "error", durationMs: d ?? 3200 }),
    info: (m, d) => show({ message: m, kind: "info", durationMs: d }),
    warning: (m, d) => show({ message: m, kind: "warning", durationMs: d }),
  }), [show]);

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      <ToastHost toasts={queue} onDismiss={remove} />
    </ToastCtx.Provider>
  );
}

function ToastHost({ toasts, onDismiss }: { toasts: ToastInstance[]; onDismiss: (id: number) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        // Iter-50 — Toasts now anchor to the BOTTOM so they never cover the
        // ORIO logo / login controls / top-of-room profile card.
        // Bottom, above tab bar / input controls.
        // Iter-143 — set top:'auto' (not undefined) so React Native Web
        // actually clears the host's default `top:0` and the toast truly
        // anchors to the bottom. Also justifyContent:'flex-end' guarantees
        // children stack from the bottom even if the host stretches.
        { bottom: insets.bottom + 96, top: "auto", justifyContent: "flex-end" },
      ]}
    >
      {/* Pre-warms the logo so it renders even when the toast fires offline (web). */}
      <Image source={TOAST_LOGO} style={{ width: 1, height: 1, opacity: 0, position: "absolute" }} />
      {toasts.map((t, i) => (
        <ToastItem key={t.id} toast={t} index={i} onDismiss={() => onDismiss(t.id)} />
      ))}
    </View>
  );
}

function ToastItem({ toast, index, onDismiss }: { toast: ToastInstance; index: number; onDismiss: () => void }) {
  const { isRTL } = useI18n();
  // Iter-50 — animate from BELOW (bottom-anchored host).
  // Fade in / fade out ONLY — no sliding or movement.
  const opacity = useRef(new Animated.Value(0)).current;
  const totalDuration = toast.durationMs ?? 2600;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const dismissTimer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 240, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onDismiss());
    }, totalDuration);
    return () => clearTimeout(dismissTimer);
  }, [onDismiss, opacity, totalDuration]);

  const accent = (() => {
    switch (toast.kind) {
      case "success": return colors.success;
      case "error": return colors.error;
      case "warning": return colors.warning;
      default: return colors.brandPrimary;
    }
  })();

  const iconName = (() => {
    switch (toast.kind) {
      case "success": return "checkmark-circle";
      case "error": return "alert-circle";
      case "warning": return "warning";
      default: return null;
    }
  })();

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toastSlot,
        { marginTop: index === 0 ? 0 : spacing.sm },
      ]}
    >
      <Animated.View
        testID="orio-toast"
        style={[styles.toast, { opacity, flexDirection: "row" }]}
      >
        <Pressable onPress={onDismiss} style={{ flexShrink: 1 }} hitSlop={6}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={styles.iconWrap}>
              <Image source={TOAST_LOGO} style={styles.logo} resizeMode="cover" />
              {iconName && (
                <View style={[styles.badge, { backgroundColor: accent }]}>
                  <Icon name={iconName as any} size={7} color="#FFFFFF" />
                </View>
              )}
            </View>
            <Text
              testID="orio-toast-message"
              style={[styles.message, { writingDirection: isRTL ? "rtl" : "ltr" }]}
            >
              {toast.message}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    alignItems: "center",
    zIndex: 9999,
    pointerEvents: "box-none",
  },
  // Compact: the slot shrinks to the message width (short messages stay small)
  // and grows up to 88% of the screen for long ones.
  toastSlot: {
    maxWidth: "88%",
    alignSelf: "center",
  },
  // Black rounded ORIO toast (reference design). Grows with long messages;
  // the logo tile keeps a fixed size.
  toast: {
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 42,
    borderRadius: 21,
    backgroundColor: "#16171B",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  // ~30% smaller than the previous 40px tile. Square, softly rounded.
  iconWrap: {
    width: 28, height: 28,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  logo: { width: 28, height: 28, borderRadius: 7 },
  badge: {
    position: "absolute", right: -2, bottom: -2,
    width: 11, height: 11, borderRadius: 6,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#16171B",
  },
  message: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "600",
    flexShrink: 1,
    lineHeight: 17,
  },
});

export default ToastProvider;
