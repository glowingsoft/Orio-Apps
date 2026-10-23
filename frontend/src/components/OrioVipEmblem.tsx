/**
 * OrioVipEmblem — a single, standalone premium 3D "V".
 *
 * No circle, no ring, no bezel, no rays, no orbiting particles.
 * The V floats directly on the dark ORIO background with only its
 * own subtle animations (float + breathing glow + sheen sweep).
 *
 * Palette + prestige progress with the VIP level.
 * Public API kept stable so `vip.tsx` still works:
 *   • `OrioVipEmblem` component
 *   • `VIP_TIERS`  (used for tier colors)
 *   • `tierFor(level)`
 */
import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";

/* --------------------------------------------------------------
 * Tier palette. The optional `head` field is retained only so
 * callers importing older types still compile — nothing renders
 * from it. Codenames intentionally removed from the UI per spec.
 * ------------------------------------------------------------ */
export type AnimalHead = "v";
export type TierStyle = {
  level: number;
  head: AnimalHead;
  codename_en: string;
  codename_ar: string;
  colorA: string;
  colorB: string;
  colorAccent: string;
  particles: number;
  aura: number;
};

export const VIP_TIERS: TierStyle[] = [
  { level: 1, head: "v", codename_en: "", codename_ar: "", colorA: "#34D399", colorB: "#065F46", colorAccent: "#D1FAE5", particles: 0, aura: 0.55 },
  { level: 2, head: "v", codename_en: "", codename_ar: "", colorA: "#38BDF8", colorB: "#0369A1", colorAccent: "#E0F2FE", particles: 0, aura: 0.62 },
  { level: 3, head: "v", codename_en: "", codename_ar: "", colorA: "#F5C542", colorB: "#B45309", colorAccent: "#FEF3C7", particles: 0, aura: 0.72 },
  { level: 4, head: "v", codename_en: "", codename_ar: "", colorA: "#A855F7", colorB: "#5B21B6", colorAccent: "#EDE9FE", particles: 0, aura: 0.80 },
  { level: 5, head: "v", codename_en: "", codename_ar: "", colorA: "#EF4444", colorB: "#7F1D1D", colorAccent: "#FEE2E2", particles: 0, aura: 0.86 },
  { level: 6, head: "v", codename_en: "", codename_ar: "", colorA: "#3B82F6", colorB: "#1E3A8A", colorAccent: "#DBEAFE", particles: 0, aura: 0.92 },
  { level: 7, head: "v", codename_en: "", codename_ar: "", colorA: "#FDE68A", colorB: "#B45309", colorAccent: "#FFFBEB", particles: 0, aura: 1.00 },
];

export function tierFor(level: number): TierStyle {
  return VIP_TIERS.find((t) => t.level === level) ?? VIP_TIERS[0];
}

/* --------------------------------------------------------------
 * The V geometry (drawn on a 100×100 viewBox and scaled by `size`).
 *
 *  • Two chunky arms with front + top bevel + inner bevel
 *  • Bright top highlight strip
 *  • Sheen band across the left arm
 *  • Dark rim + drop shadow for chrome depth
 *  • Bottom vertex droplet highlight + corner sparkles
 * ------------------------------------------------------------ */
const V_LEFT_FRONT  = "M 12,18 L 30,18 L 55,74 L 50,88 L 44,88 Z";
const V_LEFT_TOP    = "M 12,18 L 30,18 L 32,22 L 14,22 Z";
const V_LEFT_INNER  = "M 30,18 L 32,22 L 55,74 L 50,74 Z";
const V_RIGHT_FRONT = "M 88,18 L 70,18 L 45,74 L 50,88 L 56,88 Z";
const V_RIGHT_TOP   = "M 88,18 L 70,18 L 68,22 L 86,22 Z";
const V_RIGHT_INNER = "M 70,18 L 68,22 L 45,74 L 50,74 Z";
const V_OUTLINE     = "M 12,18 L 30,18 L 50,64 L 70,18 L 88,18 L 55,90 L 45,90 Z";
const V_TOP_HL      = "M 14,18 L 32,18 L 32,20.5 L 14,20.5 Z M 68,18 L 86,18 L 86,20.5 L 68,20.5 Z";
const V_LEFT_SHEEN  = "M 20,22 L 26,22 L 42,58 L 36,60 Z";

type Props = {
  level: number;
  size?: number;
  animated?: boolean;
};

export function OrioVipEmblem({ level, size = 260, animated = true }: Props) {
  const tier = tierFor(level);
  const S = size;
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);

  // Progressive metallic intensity: higher tier → brighter mid-stop + stronger shadow.
  const shadowOpacity = 0.35 + tier.aura * 0.3;
  const highlightIntensity = 0.6 + tier.aura * 0.4;

  /* ---------- Subtle animations (V only) ---------- */
  const float = useSharedValue(0);
  const glow = useSharedValue(0);
  const sheen = useSharedValue(0);
  React.useEffect(() => {
    if (!animated) return;
    float.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.quad) }), -1, true);
    glow.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
    sheen.value = withRepeat(withTiming(1, { duration: 4800, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => { float.value = 0; glow.value = 0; sheen.value = 0; };
  }, [animated, float, glow, sheen]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -6 + float.value * 12 - 6 * (1 - float.value) },
      { scale: 0.995 + glow.value * 0.015 },
    ],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + glow.value * 0.55,
    transform: [{ scale: 0.9 + glow.value * 0.1 }],
  }));
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: 0.0 + sheen.value * 0.55,
    transform: [{ translateX: -S * 0.6 + sheen.value * S * 1.2 }],
  }));

  /* ---------- Renders ---------- */
  return (
    // Iter-55 — fixed square container keeps the ambient circle + V fully
    // contained; the floatStyle used to allow the V to visually breach the
    // ambient glow. We clip it with overflow:hidden so it stays inside.
    <View style={{ width: S, height: S * 1.05, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {/* Very soft ambient glow directly behind the V — NO circle outline */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glowStyle]}>
        <Svg width={S} height={S * 1.05}>
          <Defs>
            <LinearGradient id={`amb-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={tier.colorA} stopOpacity={String(shadowOpacity)} />
              <Stop offset="100%" stopColor={tier.colorB} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          {/* Soft rounded rectangle glow (no circle outline) */}
          <Path
            d={`M ${S * 0.14},${S * 0.55} Q ${S * 0.5},${S * 0.9} ${S * 0.86},${S * 0.55} L ${S * 0.86},${S * 0.2} Q ${S * 0.5},${S * -0.05} ${S * 0.14},${S * 0.2} Z`}
            fill={`url(#amb-${uid})`}
          />
        </Svg>
      </Animated.View>

      {/* Floating V */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, floatStyle]}>
        <Svg width={S} height={S * 1.05} viewBox="0 0 100 105">
          <Defs>
            <LinearGradient id={`face-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={tier.colorAccent} stopOpacity="1" />
              <Stop offset="55%" stopColor={tier.colorA} stopOpacity="1" />
              <Stop offset="100%" stopColor={tier.colorB} stopOpacity="1" />
            </LinearGradient>
            <LinearGradient id={`bev-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={String(highlightIntensity)} />
              <Stop offset="100%" stopColor={tier.colorAccent} stopOpacity="0.9" />
            </LinearGradient>
            <LinearGradient id={`hi-${uid}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <Stop offset="100%" stopColor={tier.colorAccent} stopOpacity="0.15" />
            </LinearGradient>
          </Defs>
          <G>
            {/* Drop shadow */}
            <Path d={V_OUTLINE} fill="#000000" opacity="0.55" transform="translate(2.8 4.2)" />
            {/* Left arm */}
            <Path d={V_LEFT_FRONT} fill={`url(#face-${uid})`} />
            <Path d={V_LEFT_TOP} fill={`url(#bev-${uid})`} />
            <Path d={V_LEFT_INNER} fill={tier.colorB} opacity="0.75" />
            {/* Right arm */}
            <Path d={V_RIGHT_FRONT} fill={`url(#face-${uid})`} />
            <Path d={V_RIGHT_TOP} fill={`url(#bev-${uid})`} />
            <Path d={V_RIGHT_INNER} fill={tier.colorB} opacity="0.75" />
            {/* Sheen */}
            <Path d={V_LEFT_SHEEN} fill={tier.colorAccent} opacity={String(0.45 + tier.aura * 0.25)} />
            <Path d="M 74,22 L 80,22 L 60,58 L 56,60 Z" fill={tier.colorAccent} opacity="0.3" />
            {/* Rim + top highlight */}
            <Path d={V_OUTLINE} fill="none" stroke="#0B0313" strokeWidth="1.1" opacity="0.7" />
            <Path d={V_TOP_HL} fill={`url(#hi-${uid})`} opacity="0.95" />
            {/* Curved specular */}
            <Path d="M 22,32 Q 50,42 78,32" stroke={tier.colorAccent} strokeWidth="1.2" fill="none" opacity="0.5" strokeLinecap="round" />
            {/* Bottom vertex droplet + corner sparkles */}
            <Path d="M 47,84 L 53,84 L 51,89 L 49,89 Z" fill={tier.colorAccent} opacity="0.85" />
            <Path d="M 12,18 L 16,18 L 16,22 L 12,22 Z" fill={tier.colorAccent} opacity="0.95" />
            <Path d="M 84,18 L 88,18 L 88,22 L 84,22 Z" fill={tier.colorAccent} opacity="0.95" />
          </G>
        </Svg>
      </Animated.View>

      {/* Moving sheen band — extra chrome life across the V */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, sheenStyle]}>
        <Svg width={S} height={S * 1.05}>
          <Defs>
            <LinearGradient id={`sw-${uid}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
              <Stop offset="50%" stopColor={tier.colorAccent} stopOpacity="0.55" />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path
            d={`M ${S * 0.1},${S * 0.9} L ${S * 0.45},${S * 0.1} L ${S * 0.6},${S * 0.1} L ${S * 0.25},${S * 0.9} Z`}
            fill={`url(#sw-${uid})`}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
