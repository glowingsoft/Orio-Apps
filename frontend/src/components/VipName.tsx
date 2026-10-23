/**
 * VipName — Iter-59.
 *
 * Rainbow effect now sweeps across the ENTIRE username, from first glyph to
 * last. We measure the rendered width via `onLayout`, size the gradient to
 * 3× the text width, and translate from `-width` to `0` so one full gradient
 * cycle moves across every character of any length name.
 *
 *   name_color = "rainbow"  → animated full-text sweep (VIP 6-7).
 *   name_color = "red"      → static red (VIP 2-5).
 *   name_color = null/other → inherit style.color.
 *
 * Server-authoritative: users cannot select this color themselves.
 */
import React, { useEffect, useState } from "react";
import {
  Text, TextProps, StyleSheet, View, Platform,
  StyleProp, TextStyle, LayoutChangeEvent,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";

export type VipNameColor = "red" | "rainbow" | null | undefined | string;

type Props = {
  name?: string | null;
  color?: VipNameColor;
  /** Fallback when `color` is absent: VIP6+ rainbow · VIP2–5 red · else normal. */
  vipLevel?: number | null;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
} & Omit<TextProps, "children" | "style">;

const RAINBOW = ["#FF4E50", "#FFB300", "#FFEA00", "#4CFF61", "#00E0FF", "#5A6BFF", "#D154FF", "#FF4E50"];

// Iter-120 — make sure the web keyframes exist (+html.tsx is not always applied in dev).
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("orio-vipname-kf")) {
  const st = document.createElement("style");
  st.id = "orio-vipname-kf";
  st.textContent = `@keyframes orio-rainbow-shine {
    0% { background-position: 150% 50%, 0% 50%; }
    80% { background-position: -50% 50%, 160% 50%; }
    100% { background-position: -50% 50%, 200% 50%; }
  }`;
  document.head.appendChild(st);
}

export function nameColorForVip(vip?: number | null): VipNameColor {
  const v = Number(vip || 0);
  return v >= 6 ? "rainbow" : v >= 2 ? "red" : null;
}

export function VipName({ name, color: colorProp, vipLevel, style, numberOfLines, ...rest }: Props) {
  const text = name ?? "";
  // Live VIP level wins so colour changes apply everywhere immediately.
  const color = vipLevel != null ? nameColorForVip(vipLevel) : colorProp;

  if (color === "rainbow") {
    return <RainbowName text={text} style={style} numberOfLines={numberOfLines} {...rest} />;
  }

  if (color === "red") {
    return (
      <Text {...rest} numberOfLines={numberOfLines} style={[style, { color: "#FF3B30" }]}>
        {text}
      </Text>
    );
  }

  return (
    <Text {...rest} numberOfLines={numberOfLines} style={style}>
      {text}
    </Text>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated rainbow text — full-span sweep (VIP 6-7)                 */
/* ------------------------------------------------------------------ */
function RainbowName({ text, style, numberOfLines, ...rest }: { text: string } & Omit<Props, "name" | "color">) {
  // Measure the rendered text width so the gradient can be sized to span
  // ALL glyphs regardless of name length.
  const [w, setW] = useState<number>(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const nw = Math.ceil(e.nativeEvent.layout.width);
    if (nw > 0 && nw !== w) setW(nw);
  };

  // Phase 0 → 1 shifts translateX from -gradientWidth/3 → +gradientWidth/3 so a
  // full gradient cycle flows across the whole word.
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.linear }),
      -1,
      false
    );
  }, [t]);

  // Gradient is 3× the measured text so one full cycle = exact text width.
  const GRAD_W = Math.max(w * 3, 240);
  const animatedStyle = useAnimatedStyle(() => {
    const shift = interpolate(
      t.value,
      [0, 1],
      [-GRAD_W / 3, GRAD_W / 3],
      Extrapolation.EXTEND
    );
    return { transform: [{ translateX: shift }] };
  });

  // Shine: sweeps from before the first glyph to past the last, then rests.
  const sh = useSharedValue(0);
  useEffect(() => {
    sh.value = 0;
    sh.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [sh]);
  const shineStyle = useAnimatedStyle(() => {
    const band = Math.max(24, w * 0.45);
    return { transform: [{ translateX: interpolate(sh.value, [0, 0.8, 1], [-band, w, w], Extrapolation.CLAMP) }] };
  });

  // ---- Web fallback (CSS background-clip:text + keyframe) -------------
  if (Platform.OS === "web") {
    return (
      <Text
        {...rest}
        numberOfLines={numberOfLines}
        style={[
          style,
          {
            // @ts-expect-error — RN Web passes CSS through
            // Iter-120 — glossy white→dark shine layered over the rainbow.
            backgroundImage: `linear-gradient(100deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.95) 46%, rgba(25,25,35,0.55) 54%, rgba(255,255,255,0) 65%), linear-gradient(90deg, ${RAINBOW.join(", ")})`,
            // @ts-expect-error
            WebkitBackgroundClip: "text",
            // @ts-expect-error
            backgroundClip: "text",
            color: "transparent",
            // @ts-expect-error
            backgroundSize: "300% 100%, 200% 100%",
            // @ts-expect-error
            backgroundRepeat: "no-repeat, repeat",
            // @ts-expect-error
            animation: "orio-rainbow-shine 2.8s linear infinite",
          },
        ]}
      >
        {text}
      </Text>
    );
  }

  // ---- Native (iOS/Android) — MaskedView + animated gradient ---------
  // Before measurement: render a hidden-sized text to get the width.
  if (w === 0) {
    return (
      <Text
        {...rest}
        onLayout={onLayout}
        numberOfLines={numberOfLines}
        style={[style, { opacity: 0 }]}
      >
        {text}
      </Text>
    );
  }

  return (
    <View style={styles.wrap}>
      <MaskedView
        style={{ width: w }}
        maskElement={
          <Text {...rest} numberOfLines={numberOfLines} style={[style, { backgroundColor: "transparent" }]}>
            {text}
          </Text>
        }
      >
        <Animated.View style={[{ width: GRAD_W, height: "100%" }, animatedStyle]}>
          <LinearGradient
            colors={RAINBOW as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Spacer that keeps the row height identical to the masked text. */}
          <Text {...rest} numberOfLines={numberOfLines} style={[style, { opacity: 0 }]}>
            {text}
          </Text>
        </Animated.View>
        {/* Iter-120 — glossy white→dark shine sweeping first→last glyph, full letter height. */}
        <Animated.View pointerEvents="none" style={[styles.shine, { width: Math.max(24, w * 0.45) }, shineStyle]}>
          <LinearGradient
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.95)", "rgba(25,25,35,0.55)", "rgba(255,255,255,0)"]}
            locations={[0, 0.45, 0.6, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </MaskedView>
      {/* Hidden layout probe so the width stays live if the text changes. */}
      <Text
        onLayout={onLayout}
        numberOfLines={numberOfLines}
        style={[style, StyleSheet.absoluteFill, { opacity: 0 }]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center" },
  shine: { position: "absolute", top: 0, bottom: 0, left: 0 },
});
