/**
 * Iter-109 — Premium living-jewel effect for the top Wealth tiers.
 * The ORIGINAL image is never altered: it moves as ONE unified element with a
 * slow, vertical-only float (top ↔ bottom), and tiny diamond sparkles
 * fade/drift over and around it. `tier` (1..4) gently increases float
 * amplitude and sparkle count so each level feels more impressive.
 */
import React, { useEffect, useMemo } from "react";
import { View, Image, StyleSheet, ImageSourcePropType, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import Icon from "@react-native-vector-icons/ionicons";
import { Asset } from "expo-asset";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, withSequence, Easing, cancelAnimation,
} from "react-native-reanimated";

import { TintedImage } from "@/src/levels/badges";

const EASE = Easing.inOut(Easing.sin);

function Sparkle({ x, y, size, delay, duration, drift, heart }: { x: number; y: number; size: number; delay: number; duration: number; drift: number; heart?: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, false));
    return () => cancelAnimation(t);
  }, [t, delay, duration]);
  const style = useAnimatedStyle(() => {
    // fade in → hold → fade out, while drifting slowly upward
    const o = t.value < 0.5 ? t.value * 2 : (1 - t.value) * 2;
    return {
      opacity: o,
      transform: [{ translateY: -drift * t.value }, { scale: 0.5 + o * 0.9 }, { rotate: heart ? "0deg" : "45deg" }],
    };
  });
  if (heart) {
    // Small clean heart sparkle (Charm tiers): soft glow = larger translucent heart, no shadows.
    const hs = size * 1.6;
    return (
      <Animated.View pointerEvents="none" style={[styles.heartWrap, { left: x - hs, top: y - hs, width: hs * 2, height: hs * 2 }, style]}>
        <Icon name="heart" size={hs * 1.7} color="rgba(255,140,215,0.28)" style={styles.heartGlow} />
        <Icon name="heart" size={hs} color="#FFE3F4" />
      </Animated.View>
    );
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.sparkle, { left: x - size / 2, top: y - size / 2, width: size, height: size }, style]}
    />
  );
}

/**
 * Wing "flap" for Charm tiers: the ORIGINAL image is shown as three slices of
 * itself (left wing | centre | right wing). Only the outer slices animate a
 * gentle scaleX anchored at their inner seam, so at rest the badge is
 * pixel-identical and the seams stay continuous. `tier` drives the strength.
 */
function WingedImage({ source, w, h, tier, tint, flowMs }: { source: ImageSourcePropType; w: number; h: number; tier: number; tint?: string[]; flowMs?: number }) {
  const f = useSharedValue(0);
  useEffect(() => {
    f.value = withRepeat(withSequence(
      withTiming(1, { duration: 1700, easing: EASE }),
      withTiming(0, { duration: 1700, easing: EASE }),
    ), -1, false);
    return () => cancelAnimation(f);
  }, [f]);
  // Degrees of wing lift per tier — kept very gentle so the wings never look cut or distorted.
  const amp = [0, 0.4, 0.7, 1.0, 1.3][tier] ?? 0.4;
  const sw = w * 0.3;   // wing slice width (outer edge → seam)
  const ov = w * 0.03;  // small overlap past the seam (covers any sub-pixel gap)
  const lw = sw + ov;
  const pivotY = 0; // pivot at the vertical middle of the seam → smallest seam offset
  const dxL = sw - lw / 2;          // seam x relative to left slice centre
  const dxR = ov - lw / 2;          // seam x relative to right slice centre
  const left = useAnimatedStyle(() => ({
    transform: [
      { translateX: dxL }, { translateY: pivotY },
      { rotate: `${f.value * amp}deg` },
      { translateX: -dxL }, { translateY: -pivotY },
    ],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [
      { translateX: dxR }, { translateY: pivotY },
      { rotate: `${-f.value * amp}deg` },
      { translateX: -dxR }, { translateY: -pivotY },
    ],
  }));
  // Iter-119 — each wing slice carries the recoloured artwork so colour moves with the wings.
  const img = tint ? <TintedImage source={source} w={w} h={h} colors={tint} flowMs={flowMs} /> : <Image source={source} style={{ width: w, height: h }} resizeMode="contain" />;
  // direction:"ltr" keeps the slices in their true positions in Arabic (no mirroring).
  return (
    <View style={{ width: w, height: h, direction: "ltr" }} testID="winged-image">
      <View style={{ position: "absolute", left: sw, top: 0, width: w - sw * 2, height: h, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: -sw, top: 0 }}>{img}</View>
      </View>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: lw, height: h, overflow: "hidden" }, left]}>
        {img}
      </Animated.View>
      <Animated.View style={[{ position: "absolute", left: w - lw, top: 0, width: lw, height: h, overflow: "hidden" }, right]}>
        <View style={{ position: "absolute", left: -(w - lw), top: 0 }}>{img}</View>
      </Animated.View>
    </View>
  );
}

// Deterministic pseudo-random so sparkle layout is stable across renders.
function rand(seed: number) {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  return s - Math.floor(s);
}

export function AnimatedJewel({ source, w, h, tier, kind = "wealth", tint, flowMs }: { source: ImageSourcePropType; w: number; h: number; tier: number; kind?: "wealth" | "charm"; tint?: string[]; flowMs?: number }) {
  const charm = kind === "charm";
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withSequence(
      withTiming(1, { duration: 4200 - tier * 200, easing: EASE }),
      withTiming(0, { duration: 4200 - tier * 200, easing: EASE }),
    ), -1, false);
    return () => cancelAnimation(p);
  }, [p, tier]);

  // Vertical-only motion (no rotation/scale → zero horizontal movement).
  const amp = 8 + tier * 2.5;       // float px: 10.5 → 18
  const jewelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (p.value - 0.5) * 2 * amp }],
  }));

  const sparkles = useMemo(() => {
    // More sparkles per tier, noticeably more on tiers 3–4 (levels 9–10).
    const count = (charm ? [0, 18, 26, 34, 44] : [0, 14, 21, 28, 36])[tier] ?? 14;
    return Array.from({ length: count }, (_, i) => {
      const r1 = rand(tier * 100 + i), r2 = rand(tier * 200 + i), r3 = rand(tier * 300 + i);
      return {
        key: i,
        x: w * (0.08 + r1 * 0.84),
        y: h * (0.06 + r2 * 0.88),
        size: 4 + r3 * (4 + tier),
        delay: Math.round(r2 * 3000),
        duration: 2200 + Math.round(r1 * 2600),
        drift: 6 + r3 * 14,
      };
    });
  }, [w, h, tier, charm]);

  return (
    <Animated.View style={[{ width: w, height: h }, !charm && jewelStyle]}>
      {/* Restored (pre-Iter-113): wings flap on Charm only; Wealth image is static inside its float. */}
      {charm ? <WingedImage source={source} w={w} h={h} tier={tier} tint={tint} flowMs={flowMs} />
        : tint ? <TintedImage source={source} w={w} h={h} colors={tint} flowMs={flowMs} />
        : <Image source={source} style={{ width: w, height: h }} resizeMode="contain" />}
      {/* Full-badge moving light (Wealth + Charm), stronger with each tier. */}
      <BadgeSweep source={source} w={w} h={h} tier={tier} />
      {/* Charm badges stay static: only wings + heart sparkles animate. */}
      {!charm && <DecoShimmer source={source} w={w} h={h} tier={tier} />}
      {!charm && <JewelSheen w={w} h={h} tier={tier} />}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {sparkles.map(({ key, ...s }) => <Sparkle key={key} heart={charm} {...s} />)}
      </View>
    </Animated.View>
  );
}

/**
 * Light band that slowly sweeps across the center jewel (clipped to a
 * rhombus inside the opaque jewel area) so the jewel appears to turn.
 * Pure overlay — the image itself is untouched.
 */
function JewelSheen({ w, h, tier }: { w: number; h: number; tier: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(800, withRepeat(withSequence(
      withTiming(1, { duration: 3200, easing: EASE }),
      withTiming(1, { duration: 1400 }),            // rest
      withTiming(0, { duration: 0 }),
    ), -1, false));
    return () => cancelAnimation(t);
  }, [t]);
  // Rhombus centred on the main jewel (≈ middle of the artwork).
  const hw = w * 0.17;
  const hh = h * 0.2;
  const side = hw * Math.SQRT2;
  const band = useAnimatedStyle(() => ({
    transform: [{ translateX: -side * 1.2 + t.value * side * 2.4 }],
    opacity: t.value < 0.08 ? t.value / 0.08 : t.value > 0.92 ? (1 - t.value) / 0.08 : 1,
  }));
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute", left: w / 2 - side / 2, top: h * 0.53 - side / 2, width: side, height: side,
        overflow: "hidden", transform: [{ scaleY: hh / hw }, { rotate: "45deg" }],
      }}
    >
      <Animated.View style={[{ position: "absolute", top: -side, bottom: -side, width: side * 0.55 }, band]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", `rgba(255,250,230,${0.38 + tier * 0.05})`, "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/**
 * Gentle shimmer passing over the gold rings/decorations. Masked by the
 * image's own alpha (native), so light only appears on the artwork.
 * MaskedView is a no-op on web, so this effect is native-only.
 */
function DecoShimmer({ source, w, h, tier }: { source: ImageSourcePropType; w: number; h: number; tier: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(2200, withRepeat(withSequence(
      withTiming(1, { duration: 4600, easing: EASE }),
      withTiming(1, { duration: 1200 }),
      withTiming(0, { duration: 0 }),
    ), -1, false));
    return () => cancelAnimation(t);
  }, [t]);
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: -w + t.value * w * 2 }, { rotate: "20deg" }] }));
  if (Platform.OS === "web") return null;
  return (
    <MaskedView
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      maskElement={<Image source={source} style={{ width: w, height: h }} resizeMode="contain" />}
    >
      <Animated.View style={[{ position: "absolute", top: -h * 0.2, height: h * 1.4, width: w * 0.45 }, band]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", `rgba(255,244,210,${0.18 + tier * 0.04})`, "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </MaskedView>
  );
}

/**
 * Iter-113 — Premium light sweep travelling across the ENTIRE badge.
 * Masked by the image's own alpha so light only touches the artwork:
 * MaskedView on native, CSS mask-image on web. Image pixels are untouched.
 */
function BadgeSweep({ source, w, h, tier }: { source: ImageSourcePropType; w: number; h: number; tier: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(600, withRepeat(withSequence(
      withTiming(1, { duration: 3800, easing: EASE }),
      withTiming(1, { duration: 1600 }),
      withTiming(0, { duration: 0 }),
    ), -1, false));
    return () => cancelAnimation(t);
  }, [t]);
  const band = useAnimatedStyle(() => ({
    transform: [{ translateX: -w * 0.9 + t.value * w * 1.8 }, { rotate: "18deg" }],
  }));
  // Graduated strength: brighter, wider light on every higher tier.
  const peak = [0, 0.42, 0.52, 0.62, 0.74][tier] ?? 0.42;
  const bw = w * ([0, 0.42, 0.48, 0.54, 0.6][tier] ?? 0.42);
  const bandEl = (
    <>
      <Animated.View style={[{ position: "absolute", top: -h * 0.25, height: h * 1.5, left: (w - bw) / 2, width: bw }, band]}>
        <LinearGradient
          colors={["rgba(255,255,255,0)", `rgba(255,248,225,${peak * 0.45})`, `rgba(255,255,250,${peak})`, `rgba(255,248,225,${peak * 0.45})`, "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {/* Thin bright core streak for the premium top tiers. */}
      {tier >= 3 && (
        <Animated.View style={[{ position: "absolute", top: -h * 0.25, height: h * 1.5, left: w / 2 - w * 0.04, width: w * 0.08 }, band]}>
          <LinearGradient
            colors={["rgba(255,255,255,0)", `rgba(255,255,255,${tier === 4 ? 0.7 : 0.5})`, "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </>
  );
  if (Platform.OS === "web") {
    const uri = Asset.fromModule(source as number).uri;
    const mask = `url("${uri}")`;
    return (
      <View
        pointerEvents="none"
        testID="badge-sweep"
        style={[StyleSheet.absoluteFill, { overflow: "hidden" },
          // CSS alpha mask (react-native-web passes/prefixes mask* styles).
          { maskImage: mask, maskSize: "100% 100%", maskRepeat: "no-repeat" } as any]}
      >
        {bandEl}
      </View>
    );
  }
  return (
    <MaskedView
      pointerEvents="none"
      testID="badge-sweep"
      style={StyleSheet.absoluteFill}
      maskElement={<Image source={source} style={{ width: w, height: h }} resizeMode="contain" />}
    >
      {bandEl}
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  heartWrap: { position: "absolute", alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  heartGlow: { position: "absolute" },
  // Diamond-shaped sparkle with a warm glow (fixed colours: they belong to the artwork).
  sparkle: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
    borderRadius: 1,
    shadowColor: "#FFE7A8",
    shadowOpacity: 1,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
    borderWidth: 0.5,
    borderColor: "#FFF6D6",
  },
});
