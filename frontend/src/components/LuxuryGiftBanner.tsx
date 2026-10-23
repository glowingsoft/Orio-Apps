/**
 * Batch B — Global GOLD luxury-gift announcement (gifts > 2,999 diamonds).
 * Listens on /api/ws/global (all signed-in users, every screen). Tapping the
 * banner asks to jump to the source room; "Go" navigates (room lock rules
 * still apply in the room screen), "Cancel" keeps the current screen.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { onRealtime } from "@/src/realtime";
import { VipName } from "@/src/components/VipName";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { mediaUrl } from "@/src/media/upload";

const SHOW_MS = 6000;

type Lux = {
  id: string; room_id: string; room_name?: string;
  sender: { id: string; nickname?: string; avatar_url?: string; vip_level?: number; name_color?: string | null };
  recipient?: { nickname?: string }; recipient_count?: number;
  gift: { name: string; name_ar?: string; image_url?: string };
  quantity: number;
};

export function LuxuryGiftBanner() {
  const { user } = useAuth();
  const { isRTL } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [queue, setQueue] = useState<Lux[]>([]);
  const [current, setCurrent] = useState<Lux | null>(null);
  const [confirm, setConfirm] = useState<Lux | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const opacity = useRef(new Animated.Value(0)).current;

  // Global socket (owned by RealtimeHost) — only subscribe to luxury-gift events here.
  useEffect(() => {
    if (!user?.id) return;
    return onRealtime((m) => {
      if (m?.type !== "luxury_gift" || !m.id || seen.current.has(m.id)) return;
      seen.current.add(m.id);
      setQueue((q) => [...q, m as unknown as Lux].slice(-10));
    });
  }, [user?.id]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
  }, [queue, current]);

  useEffect(() => {
    if (!current) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setCurrent(null));
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [current, opacity]);

  const giftName = (g: Lux["gift"]) => (isRTL && g.name_ar) || g.name;

  return (
    <>
      {current && (
        <Animated.View style={[styles.wrap, { top: insets.top + 6, opacity }]} pointerEvents="box-none">
          <Pressable onPress={() => setConfirm(current)} testID="luxury-gift-banner">
            <LinearGradient
              colors={["#6B4A0C", "#E9B949", "#FFE7A3", "#E9B949", "#6B4A0C"]}
              start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={[styles.banner, { flexDirection: "row" }]}
            >
              <Image source={{ uri: current.sender.avatar_url }} style={styles.avatar} contentFit="cover" />
              <View style={styles.textCol}>
                <VipName
                  name={current.sender.nickname || "ORIO"}
                  color={current.sender.name_color}
                  vipLevel={current.sender.vip_level}
                  style={styles.sender}
                  numberOfLines={1}
                />
                <Text style={[styles.line, { writingDirection: isRTL ? "rtl" : "ltr" }]} numberOfLines={1}>
                  {isRTL
                    ? `أهدى ${giftName(current.gift)} ×${current.quantity}${current.recipient?.nickname ? ` إلى ${current.recipient.nickname}` : ""}`
                    : `sent ${giftName(current.gift)} ×${current.quantity}${current.recipient?.nickname ? ` to ${current.recipient.nickname}` : ""}`}
                </Text>
              </View>
              <Image source={{ uri: mediaUrl(current.gift.image_url) }} style={styles.gift} contentFit="contain" />
            </LinearGradient>
          </Pressable>
        </Animated.View>
      )}
      <ConfirmModal
        visible={!!confirm}
        title={isRTL ? "سيتم نقلك إلى غرفة الهدية!" : "You will be taken to the gift room!"}
        primaryLabel={isRTL ? "انتقال" : "Go"}
        secondaryLabel={isRTL ? "إلغاء" : "Cancel"}
        onPrimary={() => {
          const rid = confirm?.room_id;
          setConfirm(null);
          if (rid) router.push(`/room/${rid}` as any);
        }}
        onSecondary={() => setConfirm(null)}
        testID="luxury-gift-confirm"
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", alignSelf: "center", width: "78%", maxWidth: 320, zIndex: 9999, elevation: 30 },
  banner: {
    alignItems: "center", gap: 6, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 6,
    borderWidth: 1, borderColor: "#FFF3C4",
  },
  avatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: "#FFF3C4", backgroundColor: "#3A2A05" },
  textCol: { flex: 1, minWidth: 0 },
  sender: { color: "#2B1A00", fontSize: 12, fontWeight: "900" },
  line: { color: "#3A2600", fontSize: 10.5, fontWeight: "700" },
  gift: { width: 30, height: 30 },
});
