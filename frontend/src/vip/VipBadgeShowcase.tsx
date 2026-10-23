/**
 * VIP Center — VIP1–VIP10 badge pager.
 * One badge at a time, centred; switching works like the Wealth/Charm pager
 * (horizontal slide, swipe or tap). Badge artwork is shown as provided
 * (`contain`, original proportions) with nothing behind it, except a
 * colour-matched light beam for VIP8–VIP10. Crown controls sit on both sides
 * and dim at VIP1 / VIP10. The badge floats gently up and down, with a few
 * small glow particles around it.
 */
import React, { useCallback, useEffect, useMemo } from "react";
import { View, StyleSheet, PanResponder } from "react-native";
import { Image } from "expo-image";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay,
  Easing, interpolate, SharedValue,
} from "react-native-reanimated";
import { useI18n } from "@/src/i18n";
import { RadialGlow } from "@/src/components/RadialGlow";
import { VIP_BADGES, VIP_THEMES } from "@/src/vip/vipAssets";

const PARTICLES = [
  { x: 0.16, y: 0.78, r: 3, d: 5600, dl: 0 }, { x: 0.28, y: 0.86, r: 4, d: 6200, dl: 1400 },
  { x: 0.40, y: 0.74, r: 2, d: 6600, dl: 500 }, { x: 0.60, y: 0.82, r: 3, d: 5900, dl: 2300 },
  { x: 0.72, y: 0.88, r: 4, d: 5400, dl: 900 }, { x: 0.84, y: 0.76, r: 3, d: 6800, dl: 1900 },
];

function Particle({ p, w, h, color }: { p: (typeof PARTICLES)[number]; w: number; h: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(p.dl, withRepeat(withTiming(1, { duration: p.d, easing: Easing.inOut(Easing.sin) }), -1, false));
  }, [p.d, p.dl, t]);
  const st = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.2, 0.75, 1], [0, 0.8, 0.45, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -h * 0.3]) },
      { translateX: Math.sin(t.value * Math.PI * 2) * 6 },
    ],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.particle, {
      left: p.x * w - p.r, top: p.y * h - p.r, width: p.r * 2, height: p.r * 2, borderRadius: p.r,
      backgroundColor: color, shadowColor: color, shadowRadius: p.r * 2.5,
    }, st]} />
  );
}

function Page({ i, pos, drag, width, dir, size }: {
  i: number; pos: SharedValue<number>; drag: SharedValue<number>; width: number; dir: number; size: number;
}) {
  const st = useAnimatedStyle(() => ({
    transform: [{ translateX: (i - pos.value) * width * dir + drag.value }],
    opacity: interpolate(Math.abs(i - pos.value), [0, 1], [1, 0.2], "clamp"),
  }));
  return (
    <Animated.View style={[styles.page, { width }, st]} pointerEvents="none">
      {/* VIP8–VIP10: permanent static soft radial glow in the badge colour. */}
      {i >= 7 && <RadialGlow strong id={`vip-${i}`} color={VIP_THEMES[i].accent} size={Math.min(width, size * 1.9)} />}
      <Image testID={`vip-badge-${i + 1}`} source={VIP_BADGES[i]} style={{ width: size, height: size }} contentFit="contain" pointerEvents="none" />
    </Animated.View>
  );
}

export function VipBadgeShowcase({ width, height, index, onIndexChange }: {
  width: number; height: number; index: number; onIndexChange: (i: number) => void;
}) {
  const { isRTL } = useI18n();
  const dir = isRTL ? -1 : 1;
  const pos = useSharedValue(index);
  const drag = useSharedValue(0);
  const float = useSharedValue(0);
  const size = Math.min(width * 0.6, height * 0.62);
  const last = VIP_BADGES.length - 1;

  useEffect(() => {
    float.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [float]);
  useEffect(() => { pos.value = withTiming(index, { duration: 320 }); }, [index, pos]);

  const goTo = useCallback((n: number) => onIndexChange(Math.max(0, Math.min(last, n))), [last, onIndexChange]);

  // PanResponder cooperates with the parent vertical ScrollView on native AND web
  // (horizontal-dominant drags only; vertical drags keep scrolling the page).
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.3,
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.3,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      const atStart = index <= 0 && g.dx * dir > 0;
      const atEnd = index >= last && g.dx * dir < 0;
      drag.set(atStart || atEnd ? g.dx * 0.25 : g.dx);
    },
    onPanResponderRelease: (_, g) => {
      const step = Math.abs(g.dx) > width * 0.2 || Math.abs(g.vx) > 0.6 ? (g.dx * dir < 0 ? 1 : -1) : 0;
      drag.set(withTiming(0, { duration: 260 }));
      if (step) goTo(index + step);
    },
    onPanResponderTerminate: () => { drag.set(withTiming(0, { duration: 260 })); },
  }), [drag, index, dir, last, width, goTo]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(float.value, [0, 1], [-10, 10]) }],
  }));
  const accent = VIP_THEMES[index].accent;

  return (
    <View style={[styles.stage, { width, height }]} testID="vip-showcase" {...pan.panHandlers}>
      {PARTICLES.map((p, i) => <Particle key={i} p={p} w={width} h={height} color={accent} />)}
      <Animated.View style={[StyleSheet.absoluteFill, floatStyle]}>
        {VIP_BADGES.map((_, i) => (
          <Page key={i} i={i} pos={pos} drag={drag} width={width} dir={dir} size={size} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { overflow: "hidden" },
  page: { position: "absolute", top: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  particle: { position: "absolute", shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } },
});
