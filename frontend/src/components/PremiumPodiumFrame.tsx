/**
 * PremiumPodiumFrame — Iter-61.
 *
 * Clean compact layout per user spec:
 *   • Avatar fully INSIDE the card (no 50% overlap, no external crown).
 *   • Shield rank badge on the left.
 *   • Avatar + decorative laurel wreath in the center-left area.
 *   • Clean text column (name · flag · VIP · ID · gifts) — fully readable.
 *   • Diamond amount top-right.
 *   • NO GOLD/SILVER/BRONZE text pill — the frame color itself represents
 *     the tier.
 *
 * Animated metallic sheen sweeps every ~3s. Tier palette drives rim, frame
 * stops, and shield color.
 */
import { CountryFlag } from "@/src/components/CountryFlag";
import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Image } from "expo-image";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
  interpolate, Extrapolation,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { VipName } from "@/src/components/VipName";
import { VipBadge } from "@/src/components/VipBadge";
import { RankMedalBadge, type MedalTier } from "@/src/components/RankMedalBadge";
import { colors, radius } from "@/src/theme";

export type PodiumTier = "gold" | "silver" | "bronze";

type UserLike = {
  id: string;
  nickname: string;
  avatar_url?: string;
  vip_level?: number;
  numeric_id?: string;
  country_flag?: string;
  name_color?: string | null;
};

type Props = {
  tier: PodiumTier;
  rank: number;
  user: UserLike;
  amount: number;
  giftCount?: number;
  countLabel?: string;
  amountIcon?: string;
  onPress?: () => void;
  isRTL?: boolean;
};

/* ---------------- Tier palettes ---------------- */
const TIERS: Record<PodiumTier, {
  rim: string;
  stops: [string, string, string, string];
  glow: string;
  textOnRim: string;
}> = {
  gold: {
    rim: "#F6C13F",
    stops: ["#1F1300", "#8A5B10", "#F2BE44", "#8A5B10"],
    glow: "#FFE68A",
    textOnRim: "#2A1A00",
  },
  silver: {
    rim: "#D9DDE5",
    stops: ["#0F1116", "#596170", "#D9DDE5", "#596170"],
    glow: "#F2F5FA",
    textOnRim: "#13161B",
  },
  bronze: {
    rim: "#D9823E",
    stops: ["#160704", "#6E3614", "#D9823E", "#6E3614"],
    glow: "#FFC79B",
    textOnRim: "#1A0A03",
  },
};

/* ---------------- Main frame ---------------- */
const CARD_H = 96;
const AVATAR_D = 60;

export function PremiumPodiumFrame({
  tier, rank, user, amount, giftCount, countLabel, amountIcon = "💎",
  onPress, isRTL,
}: Props) {
  const t = TIERS[tier];

  // Animated metallic sheen sweeps across the frame.
  const sheen = useSharedValue(0);
  useEffect(() => {
    sheen.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.quad) }),
      -1, false
    );
  }, [sheen]);
  const sheenStyle = useAnimatedStyle(() => {
    const x = interpolate(sheen.value, [0, 1], [-320, 320], Extrapolation.EXTEND);
    const op = interpolate(sheen.value, [0, 0.5, 1], [0, 0.5, 0], Extrapolation.CLAMP);
    return { transform: [{ translateX: x }, { skewX: "-20deg" }], opacity: op };
  });

  // Soft pulsing rim glow.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1, true
    );
  }, [pulse]);
  const outerRimStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(pulse.value, [0, 1], [0.4, 0.9], Extrapolation.CLAMP) as any,
  }));

  return (
    <Pressable
      testID={`luxe-rank-${rank}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
    >
      {/* --- Full-card gradient layers --- */}
      <LinearGradient
        colors={[t.stops[0], t.stops[1], t.stops[2] + "AA", t.stops[3]] as any}
        locations={[0, 0.4, 0.75, 1]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[t.glow + "26", "transparent"]}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Animated sheen */}
      <Animated.View style={[styles.sheen, sheenStyle, { backgroundColor: t.glow }]} />

      {/* --- Full-card armored rim (wraps everything, rounded corners) --- */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.outerRim,
          { borderColor: t.rim, shadowColor: t.glow },
          outerRimStyle,
        ]}
      />
      <View pointerEvents="none" style={[styles.innerRim, { borderColor: t.rim + "66" }]} />

      {/* --- Left: metallic laurel rank medal (fully INSIDE the card) --- */}
      <View style={styles.leftZone} pointerEvents="none">
        <RankMedalBadge tier={tier as MedalTier} rank={rank} size={58} />
      </View>

      <View style={styles.avatarZone} pointerEvents="none">
        <View style={[styles.avatarRing, { borderColor: t.rim, shadowColor: t.glow }]}>
          <View style={[styles.avatarInner, { borderColor: t.stops[1] }]}>
            <Image source={user.avatar_url} style={styles.avatar} contentFit="cover" />
          </View>
        </View>
      </View>

      {/* --- Text column (fills remaining space between avatar and amount) --- */}
      <View style={styles.textCol}>
        <View style={[styles.nameRow]}>
          <VipName
            name={user.nickname}
            color={user?.name_color} vipLevel={(user as any)?.vip_level}
            style={styles.name}
            numberOfLines={1}
          />
          {user.country_flag ? <CountryFlag flag={user.country_flag} size={16} /> : null}
          {(user.vip_level ?? 0) > 0 ? <VipBadge level={user.vip_level} /> : null}
        </View>
        {user.numeric_id ? (
          <Text style={styles.id} numberOfLines={1}>ID: {user.numeric_id}</Text>
        ) : null}
        <Text style={styles.hint} numberOfLines={1}>
          {giftCount ?? 0} {countLabel ?? "gifts"}
        </Text>
      </View>

      {/* --- Diamond amount (right) --- */}
      <View style={styles.amountCol} pointerEvents="none">
        <Text style={[styles.amount, { color: t.rim }]} numberOfLines={1}>
          {amountIcon} {amount.toLocaleString()}
        </Text>
      </View>
    </Pressable>
  );
}

/* ---------------- Styles ---------------- */
const MEDAL_W = 58;
const AVATAR_LEFT = MEDAL_W + 6;   // avatar sits right of medal
const TEXT_LEFT = AVATAR_LEFT + AVATAR_D + 12;

const styles = StyleSheet.create({
  card: {
    position: "relative",
    minHeight: CARD_H,
    borderRadius: 22,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 10, shadowColor: "#000" },
      android: { elevation: 6 },
      default: {},
    }),
  },
  outerRim: {
    ...StyleSheet.absoluteFill,
    borderRadius: 22,
    borderWidth: 2,
    ...Platform.select({
      ios: { shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
      default: {},
    }),
  },
  innerRim: {
    position: "absolute",
    top: 4, left: 4, right: 4, bottom: 4,
    borderRadius: 18,
    borderWidth: 1,
  },
  sheen: {
    position: "absolute",
    top: 0, bottom: 0,
    width: 90,
    opacity: 0,
  },

  // Rank medal on the far-left of the card
  leftZone: {
    position: "absolute",
    left: 6,
    top: (CARD_H - 68) / 2,
    width: MEDAL_W,
    alignItems: "center",
    zIndex: 3,
  },

  // Avatar cluster — fully INSIDE the card (iter-61 spec, no crown — the
  // laurel medal on the left represents the tier/rank).
  avatarZone: {
    position: "absolute",
    left: AVATAR_LEFT,
    top: (CARD_H - AVATAR_D) / 2,
    width: AVATAR_D,
    alignItems: "center",
    zIndex: 2,
  },
  avatarRing: {
    width: AVATAR_D, height: AVATAR_D, borderRadius: AVATAR_D / 2,
    borderWidth: 2.5,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#0B0714",
    ...Platform.select({
      ios: { shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 8 },
      default: {},
    }),
  },
  avatarInner: {
    width: AVATAR_D - 10, height: AVATAR_D - 10,
    borderRadius: (AVATAR_D - 10) / 2,
    borderWidth: 1,
    overflow: "hidden",
  },
  avatar: {
    width: AVATAR_D - 10, height: AVATAR_D - 10,
    borderRadius: (AVATAR_D - 10) / 2,
    backgroundColor: colors.surfaceSecondary,
  },

  // Text column
  textCol: {
    position: "absolute",
    left: TEXT_LEFT,
    right: 108,
    top: 12,
    bottom: 10,
    justifyContent: "center",
    gap: 2,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  name: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", maxWidth: 150 },
  flag: { fontSize: 14 },
  id: { color: "rgba(255,255,255,0.82)", fontSize: 11, fontFamily: "monospace" },
  hint: { color: "rgba(255,255,255,0.82)", fontSize: 12, fontWeight: "600" },

  amountCol: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    alignItems: "flex-end",
    justifyContent: "center",
    maxWidth: 110,
    zIndex: 3,
  },
  amount: { fontWeight: "900", fontSize: 14 },
});

// Keep radius referenced so bundlers don't drop it from theme imports in dev
void radius;
