/**
 * Small red "كومبو / Combo" button (bottom, just above the mic mute button). A ring drains over 3s
 * with no numbers. Each tap re-sends the same gift to the same recipients with
 * the same quantity (real charge, new idempotency key) and restarts the ring.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { apiSendGiftMulti } from "@/src/api";

export type GiftCombo = { giftId: string; giftName: string; qty: number; recipients: string[]; combo_id: string };

const SIZE = 56;
const STROKE = 3.5;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const WINDOW_MS = 3000;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function RoomComboButton({ combo, roomId, isRTL, bottom, onDone, onError, onBalance }: {
  combo: GiftCombo & { key: number }; roomId: string; isRTL: boolean; bottom: number;
  onDone: () => void; onError: (msg: string) => void; onBalance: () => void;
}) {
  const ring = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const [runId, setRunId] = useState(0);
  const inflight = useRef(0);
  const closing = useRef(false);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => onDone());
  };

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [fade]);

  // (Re)start the 3-second ring; when it completes and nothing is in flight, fade out.
  useEffect(() => {
    ring.stopAnimation();
    ring.setValue(0);
    const a = Animated.timing(ring, { toValue: 1, duration: WINDOW_MS, easing: Easing.linear, useNativeDriver: false });
    a.start(({ finished }) => { if (finished && inflight.current === 0) close(); });
    return () => a.stop();
  }, [runId, combo.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const tap = async () => {
    if (closing.current) return;
    // Hold the ring while the send is in flight; restart it on success.
    ring.stopAnimation();
    Animated.sequence([
      Animated.timing(press, { toValue: 0.86, duration: 60, useNativeDriver: true }),
      Animated.spring(press, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
    inflight.current += 1;
    try {
      await apiSendGiftMulti(combo.giftId, combo.recipients, combo.qty, roomId, combo.combo_id);
      onBalance();
      setRunId((n) => n + 1);
    } catch (e: any) {
      const m = String(e?.message || "");
      onError(/insufficient|balance|not enough/i.test(m)
        ? (isRTL ? "رصيد الألماس غير كافٍ" : "Not enough diamonds")
        : m || (isRTL ? "تعذر إرسال الهدية" : "Failed to send gift"));
      inflight.current -= 1;
      close();
      return;
    }
    inflight.current -= 1;
  };


  const offset = ring.interpolate({ inputRange: [0, 1], outputRange: [0, CIRC] });

  return (
    <Animated.View style={[styles.wrap, { bottom, opacity: fade, transform: [{ scale: press }] }]} pointerEvents="box-none">
      <Pressable onPress={tap} testID="room-combo-btn" hitSlop={6} style={styles.btn}>
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(255,255,255,0.25)" strokeWidth={STROKE} fill="none" />
          <AnimatedCircle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            stroke="#FFFFFF" strokeWidth={STROKE} fill="none" strokeLinecap="round"
            strokeDasharray={`${CIRC} ${CIRC}`} strokeDashoffset={offset as any}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.inner}>
          <Text style={styles.label} numberOfLines={1}>{isRTL ? "كومبو" : "Combo"}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sits just above the bottom-bar mic button (mirrors natively in RTL via `end`).
  wrap: { position: "absolute", end: 160, zIndex: 70 },
  btn: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  inner: {
    width: SIZE - 10, height: SIZE - 10, borderRadius: (SIZE - 10) / 2,
    backgroundColor: "#E53935", alignItems: "center", justifyContent: "center",
    shadowColor: "#E53935", shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  label: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "900" },
});
