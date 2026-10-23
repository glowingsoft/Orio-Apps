/**
 * RankMedalBadge — Iter-62.
 *
 * Elegant metallic circular medal with a laurel wreath used to represent
 * Top 1 / Top 2 / Top 3 in Global & Room Ranking screens.
 *
 *   - Gold medal   → Top 1 (rich gold leaves, polished center)
 *   - Silver medal → Top 2 (cool platinum laurel)
 *   - Bronze medal → Top 3 (warm copper laurel)
 *
 * The rank number is rendered in the center with a soft metallic bevel.
 * Pure SVG — zero image assets — so it scales crisply and matches each
 * tier's premium frame colors.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, {
  Defs, LinearGradient as SvgLinearGradient, RadialGradient, Stop, Path,
  Circle, Text as SvgText,
} from "react-native-svg";

export type MedalTier = "gold" | "silver" | "bronze";

const PALETTE: Record<MedalTier, {
  base: string;       // mid metallic
  bright: string;     // highlight
  deep: string;       // shadow
  rim: string;        // outer rim stroke
  numberColor: string;
}> = {
  gold: {
    base: "#F6C13F",
    bright: "#FFF4B8",
    deep: "#7A4E05",
    rim: "#D59E14",
    numberColor: "#3A2600",
  },
  silver: {
    base: "#D9DDE5",
    bright: "#FFFFFF",
    deep: "#4F5460",
    rim: "#A6ABB5",
    numberColor: "#1A1D24",
  },
  bronze: {
    base: "#D9823E",
    bright: "#FFD1A3",
    deep: "#5E2C10",
    rim: "#A3581E",
    numberColor: "#2A1004",
  },
};

type Props = { tier: MedalTier; rank: number; size?: number };

export function RankMedalBadge({ tier, rank, size = 58 }: Props) {
  const p = PALETTE[tier];
  // SVG design on a 68x80 viewBox: laurel left/right + central disc + rank number
  return (
    <View style={{ width: size, height: size * (80 / 68), alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size * (80 / 68)} viewBox="0 0 68 80">
        <Defs>
          <RadialGradient id={`disc-${tier}`} cx="34" cy="32" rx="22" ry="22" fx="28" fy="26">
            <Stop offset="0%" stopColor={p.bright} stopOpacity="1" />
            <Stop offset="55%" stopColor={p.base} stopOpacity="1" />
            <Stop offset="100%" stopColor={p.deep} stopOpacity="1" />
          </RadialGradient>
          <SvgLinearGradient id={`leaf-${tier}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={p.bright} stopOpacity="0.95" />
            <Stop offset="50%" stopColor={p.base} stopOpacity="1" />
            <Stop offset="100%" stopColor={p.deep} stopOpacity="1" />
          </SvgLinearGradient>
          <SvgLinearGradient id={`rimG-${tier}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={p.bright} stopOpacity="1" />
            <Stop offset="100%" stopColor={p.deep} stopOpacity="1" />
          </SvgLinearGradient>
          <SvgLinearGradient id={`sheen-${tier}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.75" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </SvgLinearGradient>
        </Defs>

        {/* ---------- Laurel wreath ---------- */}
        {/* Left branch — stem */}
        <Path
          d="M 6,54 Q 2,38 10,22 Q 18,10 28,8"
          stroke={p.deep}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
        {/* Left leaves (5 pairs) */}
        {[
          "M 8,46 Q 2,40 6,34 Q 12,34 12,42 Z",
          "M 10,38 Q 4,32 8,26 Q 14,26 14,34 Z",
          "M 13,30 Q 7,24 11,18 Q 17,18 17,26 Z",
          "M 17,22 Q 11,16 15,10 Q 21,10 21,18 Z",
          "M 23,16 Q 19,10 25,6 Q 30,8 28,14 Z",
        ].map((d, i) => (
          <Path key={`l-leaf-${i}`} d={d} fill={`url(#leaf-${tier})`} stroke={p.deep} strokeWidth="0.5" />
        ))}
        {/* Inner left leaves facing disc */}
        {[
          "M 14,48 Q 20,46 22,52 Q 18,56 12,54 Z",
          "M 16,40 Q 22,38 24,44 Q 20,48 14,46 Z",
          "M 19,32 Q 25,30 27,36 Q 23,40 17,38 Z",
          "M 23,24 Q 29,22 30,28 Q 26,32 21,30 Z",
        ].map((d, i) => (
          <Path key={`l-ileaf-${i}`} d={d} fill={`url(#leaf-${tier})`} stroke={p.deep} strokeWidth="0.4" opacity="0.95" />
        ))}

        {/* Right branch — stem (mirror) */}
        <Path
          d="M 62,54 Q 66,38 58,22 Q 50,10 40,8"
          stroke={p.deep}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
        {/* Right leaves */}
        {[
          "M 60,46 Q 66,40 62,34 Q 56,34 56,42 Z",
          "M 58,38 Q 64,32 60,26 Q 54,26 54,34 Z",
          "M 55,30 Q 61,24 57,18 Q 51,18 51,26 Z",
          "M 51,22 Q 57,16 53,10 Q 47,10 47,18 Z",
          "M 45,16 Q 49,10 43,6 Q 38,8 40,14 Z",
        ].map((d, i) => (
          <Path key={`r-leaf-${i}`} d={d} fill={`url(#leaf-${tier})`} stroke={p.deep} strokeWidth="0.5" />
        ))}
        {[
          "M 54,48 Q 48,46 46,52 Q 50,56 56,54 Z",
          "M 52,40 Q 46,38 44,44 Q 48,48 54,46 Z",
          "M 49,32 Q 43,30 41,36 Q 45,40 51,38 Z",
          "M 45,24 Q 39,22 38,28 Q 42,32 47,30 Z",
        ].map((d, i) => (
          <Path key={`r-ileaf-${i}`} d={d} fill={`url(#leaf-${tier})`} stroke={p.deep} strokeWidth="0.4" opacity="0.95" />
        ))}

        {/* Tie at the bottom where branches meet */}
        <Path
          d="M 28,54 Q 34,58 40,54 L 42,62 L 34,58 L 26,62 Z"
          fill={`url(#rimG-${tier})`}
          stroke={p.deep}
          strokeWidth="0.6"
        />

        {/* ---------- Central disc ---------- */}
        <Circle cx="34" cy="32" r="20" fill={`url(#disc-${tier})`} stroke={p.rim} strokeWidth="1.6" />
        {/* Inner bevel ring */}
        <Circle cx="34" cy="32" r="16" fill="none" stroke={p.deep} strokeOpacity="0.4" strokeWidth="0.8" />
        {/* Sheen highlight */}
        <Path
          d="M 20,22 Q 30,16 46,22 Q 40,28 32,28 Q 26,28 20,22 Z"
          fill={`url(#sheen-${tier})`}
          opacity="0.7"
        />

        {/* ---------- Rank Number ---------- */}
        <SvgText
          x="34"
          y="40"
          textAnchor="middle"
          fontSize="22"
          fontWeight="900"
          fill={p.numberColor}
        >
          {rank}
        </SvgText>
      </Svg>
    </View>
  );
}

/* Keep StyleSheet import happy for RN typing even though we don't use it */
void StyleSheet;
