/**
 * Batch B — Room gift animation layer.
 * • Every gift plays a transparent animation (Noto Lottie when available,
 *   otherwise a layered pop/float of the transparent PNG artwork).
 * • Display width is hard-capped at 50% of the screen width.
 * • Luxury gifts (luxury_fx: dragon / phoenix) add a gold aura, rotating
 *   halo rings and rising sparkles — all vector layers, no video rectangles.
 * • Events queue and play one after another; never blocks touches.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import LottieView from "lottie-react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { mediaUrl } from "@/src/media/upload";

export type GiftFxEvent = {
  key: string;
  gift: { id: string; name: string; name_ar?: string; image_url?: string; animation_url?: string | null; luxury_fx?: string | null; video_url?: string | null };
  sender?: { nickname?: string };
  quantity?: number;
};

const NORMAL_MS = 2800;
const LUXURY_MS = 5200;
const VIDEO_MS = 12000; // custom gift videos are ≤ 10s
const GOLD = "#F5C451";

function Sparkle({ delay, x, size, color, run }: { delay: number; x: number; size: number; color: string; run: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, delay, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [run, delay, v]);
  return (
    <Animated.View
      style={{
        position: "absolute", left: `${x}%`, bottom: "10%",
        width: size, height: size, borderRadius: size / 2, backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -120] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.2] }) }],
      }}
    />
  );
}

function LuxuryLayers({ size, run, tint }: { size: number; run: number; tint: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    spin.setValue(0); pulse.setValue(0);
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [run, spin, pulse]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const rotateRev = spin.interpolate({ inputRange: [0, 1], outputRange: ["360deg", "0deg"] });
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]} pointerEvents="none">
      <Animated.View style={{
        position: "absolute", width: size * 0.95, height: size * 0.95, borderRadius: size,
        backgroundColor: tint, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.3] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.05] }) }],
      }} />
      <Animated.View style={{
        position: "absolute", width: size * 0.9, height: size * 0.9, borderRadius: size,
        borderWidth: 2, borderColor: GOLD, borderStyle: "dashed", opacity: 0.75, transform: [{ rotate }],
      }} />
      <Animated.View style={{
        position: "absolute", width: size * 0.72, height: size * 0.72, borderRadius: size,
        borderWidth: 1.5, borderColor: tint, opacity: 0.8, transform: [{ rotate: rotateRev }],
      }} />
      {[8, 22, 38, 55, 70, 86].map((x, i) => (
        <Sparkle key={x} x={x} delay={i * 220} size={i % 2 ? 5 : 7} color={i % 2 ? tint : GOLD} run={run} />
      ))}
    </View>
  );
}

export function GiftFxOverlay({ event, isRTL }: { event: GiftFxEvent | null; isRTL: boolean }) {
  const { width } = useWindowDimensions();
  const [queue, setQueue] = useState<GiftFxEvent[]>([]);
  const [current, setCurrent] = useState<GiftFxEvent | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.6)).current;
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!event || seen.current.has(event.key)) return;
    seen.current.add(event.key);
    setQueue((q) => [...q, event].slice(-12));
  }, [event]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
    setRun((r) => r + 1);
  }, [queue, current]);

  useEffect(() => {
    if (!current) return;
    const lux = !!current.gift.luxury_fx;
    const dur = current.gift.video_url ? VIDEO_MS : lux ? LUXURY_MS : NORMAL_MS;
    opacity.setValue(0); scale.setValue(0.6);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 320, useNativeDriver: true }).start(() => setCurrent(null));
    }, dur - 320);
    return () => clearTimeout(t);
  }, [current, opacity, scale]);

  if (!current) return null;
  // Custom video gifts: full-screen for everyone, aspect ratio preserved, auto-close on end.
  if (current.gift.video_url) {
    return (
      <View style={styles.videoRoot} pointerEvents="none" testID="gift-fx-overlay">
        <GiftVideo key={`${current.key}-${run}`} uri={mediaUrl(current.gift.video_url)!} onEnd={() => setCurrent(null)} />
      </View>
    );
  }
  const lux = current.gift.luxury_fx;
  const size = Math.min(width * 0.5, 320); // hard cap: ≤ 50% of screen width
  const tint = lux === "phoenix" ? "#FF7A2F" : lux === "dragon" ? "#36D399" : "#B47CFF";
  const name = (isRTL && current.gift.name_ar) || current.gift.name;

  return (
    <View style={styles.root} pointerEvents="none" testID="gift-fx-overlay">
      <Animated.View style={{ width: size, alignItems: "center", opacity, transform: [{ scale }] }}>
        <View style={{ width: size, height: size }}>
          {lux ? <LuxuryLayers size={size} run={run} tint={tint} /> : null}
          {current.gift.animation_url ? (
            <LottieView
              key={`${current.key}-${run}`}
              source={{ uri: current.gift.animation_url }}
              autoPlay
              loop
              style={{ width: size, height: size }}
              webStyle={{ width: size, height: size }}
            />
          ) : (
            <FloatImage uri={current.gift.image_url} size={size} run={run} />
          )}
        </View>
        {lux ? (
          <LinearGradient colors={["#7A5A12", GOLD, "#7A5A12"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.luxTag}>
            <Text style={styles.luxTagText} numberOfLines={1}>{name}{current.quantity && current.quantity > 1 ? ` ×${current.quantity}` : ""}</Text>
          </LinearGradient>
        ) : current.quantity && current.quantity > 1 ? (
          <Text style={styles.qty}>×{current.quantity}</Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

function GiftVideo({ uri, onEnd }: { uri: string; onEnd: () => void }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.play(); });
  useEffect(() => {
    const sub = player.addListener("playToEnd", onEnd);
    const err = player.addListener("statusChange", (e: any) => { if (e?.status === "error") onEnd(); });
    return () => { sub.remove(); err.remove(); };
  }, [player, onEnd]);
  return (
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} testID="gift-fx-video" />
  );
}

function FloatImage({ uri, size, run }: { uri?: string; size: number; run: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [run, v]);
  return (
    <Animated.View style={{
      width: size, height: size, alignItems: "center", justifyContent: "center",
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, -6] }) },
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-4deg", "4deg"] }) },
      ],
    }}>
      <Image source={{ uri: mediaUrl(uri) }} style={{ width: size * 0.78, height: size * 0.78 }} contentFit="contain" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", zIndex: 60 },
  videoRoot: { ...StyleSheet.absoluteFill, zIndex: 60, backgroundColor: "rgba(0,0,0,0.35)" },
  luxTag: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 4, borderRadius: 999 },
  luxTagText: { color: "#2B1A00", fontSize: 13, fontWeight: "900" },
  qty: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", marginTop: 4, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 },
});
