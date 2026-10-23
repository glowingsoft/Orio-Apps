/**
 * Shared Wealth / Charm badge artwork + helpers.
 * 10 badges per system, each covering a 5-level range (last one 46–51).
 * Artwork is always rendered with resizeMode "contain" — never cropped,
 * stretched or mirrored.
 */
import React, { useEffect } from "react";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from "react-native-reanimated";
import { View, Text, Image, StyleSheet, ImageSourcePropType, Pressable, Platform } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { Asset } from "expo-asset";
import Icon from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { abbrevNumber } from "@/src/utils/format";
import { CountryFlag } from "@/src/components/CountryFlag";

export type LevelSys = "wealth" | "charm";
export type LevelItem = { id: string; source: ImageSourcePropType; ratio: number; fx?: number; kind?: "wealth" | "charm" };

// Add new Wealth jewels here (smallest → largest) — the pager scales automatically.
export const WEALTH_ITEMS: LevelItem[] = [
  { id: "wealth-1", source: require("../../assets/images/levels/wealth_item_1.png"), ratio: 1173 / 1341 },
  { id: "wealth-2", source: require("../../assets/images/levels/wealth_item_2.png"), ratio: 1126 / 1397 },
  { id: "wealth-3", source: require("../../assets/images/levels/wealth_item_3.png"), ratio: 1125 / 1398 },
  { id: "wealth-4", source: require("../../assets/images/levels/wealth_item_4.png"), ratio: 1084 / 1451 },
  { id: "wealth-5", source: require("../../assets/images/levels/wealth_item_5.png"), ratio: 1088 / 1446 },
  { id: "wealth-6", source: require("../../assets/images/levels/wealth_item_6.png"), ratio: 1086 / 1448 },
  // Final 4 tiers: animated (float/rock + sparkles), intensity grows with fx.
  { id: "wealth-7", source: require("../../assets/images/levels/wealth_item_7.png"), ratio: 1080 / 1456, fx: 1 },
  { id: "wealth-8", source: require("../../assets/images/levels/wealth_item_8.png"), ratio: 1061 / 1482, fx: 2 },
  { id: "wealth-9", source: require("../../assets/images/levels/wealth_item_9.png"), ratio: 1071 / 1469, fx: 3 },
  { id: "wealth-10", source: require("../../assets/images/levels/wealth_item_10.png"), ratio: 1101 / 1429, fx: 4 },
];

// Charm levels (sizes follow the same 10-slot scale as Wealth).
export const CHARM_ITEMS: LevelItem[] = [
  { id: "charm-1", source: require("../../assets/images/levels/charm_item_1.png"), ratio: 1101 / 1429 },
  { id: "charm-2", source: require("../../assets/images/levels/charm_item_2.png"), ratio: 1156 / 1361 },
  { id: "charm-3", source: require("../../assets/images/levels/charm_item_3.png"), ratio: 1092 / 1440 },
  { id: "charm-4", source: require("../../assets/images/levels/charm_item_4.png"), ratio: 1082 / 1454 },
  { id: "charm-5", source: require("../../assets/images/levels/charm_item_5.png"), ratio: 1062 / 1482 },
  { id: "charm-6", source: require("../../assets/images/levels/charm_item_6.png"), ratio: 1028 / 1530 },
  // Final 4 Charm tiers: float + light + flapping wings + heart sparkles.
  { id: "charm-7", source: require("../../assets/images/levels/charm_item_7.png"), ratio: 1012 / 1555, fx: 1, kind: "charm" },
  { id: "charm-8", source: require("../../assets/images/levels/charm_item_8.png"), ratio: 1033 / 1522, fx: 2, kind: "charm" },
  { id: "charm-9", source: require("../../assets/images/levels/charm_item_9.png"), ratio: 1006 / 1563, fx: 3, kind: "charm" },
  { id: "charm-10", source: require("../../assets/images/levels/charm_item_10.png"), ratio: 1079 / 1457, fx: 4, kind: "charm" },
];

/** Last level of each badge range: LV5, LV10, … LV45, LV51. */
export const RANGE_TARGETS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 51];

/** Badge index (0..9) for an earned level; level 0 uses the first badge. */
export function badgeIndexFor(level: number): number {
  const l = Math.floor(Number(level) || 0);
  return l >= 1 ? Math.min(9, Math.floor((l - 1) / 5)) : 0;
}

// Fixed palettes (identical in every theme): richer/darker every 5 levels.
// Exact owner-specified palettes (fixed in every theme). Badges 1–6 static;
// badges 7–10 (LV31–51) animate the same palette across the whole chip.
const WEALTH_TONES: string[][] = [
  ["#73859A", "#E6F6FF", "#A6B7C8"],
  ["#062E91", "#246BFF", "#82D9FF"],
  ["#005B49", "#00C69B", "#C6F7DB"],
  ["#40109A", "#A145FA", "#E0B5FF"],
  ["#E7B65B", "#8B35D6"],
  ["#3DDDF3", "#F0C97A"],
  ["#C51848", "#FFD36D"],
  ["#7732E9", "#4EF5FF"],
  ["#F7D06C", "#FF75B7", "#8C5BFF", "#5CEBFA", "#FFFFFF"],
  ["#FFF6D5", "#F8C94E", "#F66CD6", "#7952FF", "#39E7F8", "#FFFFFF"],
];
const CHARM_TONES: string[][] = [
  ["#F6B7D2", "#FFE5F0", "#E88AB6"],
  ["#D75B9C", "#FF91C5", "#FFD0E5"],
  ["#A66BEA", "#D6A8FF", "#F4DFFF"],
  ["#E82B99", "#A536CE", "#FF8BD8"],
  ["#FF6FBA", "#8540DB"],
  ["#F2A6B7", "#7833C8"],
  ["#F12C85", "#6420A8"],
  ["#D827C8", "#B59AFF"],
  ["#FF82BE", "#D94BE8", "#8751E9", "#FFD5ED", "#FFFFFF"],
  ["#FFE6F3", "#FF62B5", "#ED54EA", "#8C4DFF", "#F6B9FF", "#FFFFFF"],
];
// Animation speed per badge index (7→10 progressively faster / richer).
const FLOW_MS: Record<number, number> = { 6: 7000, 7: 5200, 8: 3800, 9: 2600 };
const FLOW_PERIOD = 90; // px of one full palette cycle

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Seamless horizontal colour flow using the exact palette (GPU transform only). */
function FlowingGradient({ colors: c, duration, period = FLOW_PERIOD }: { colors: string[]; duration: number; period?: number }) {
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = 0;
    x.value = withRepeat(withTiming(-period, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(x);
  }, [duration, period, x]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const stops = [...c, ...c, c[0]]; // period-repeating sequence
  return (
    <Animated.View style={[styles.flow, { width: period * 2 }, st]} pointerEvents="none">
      <LinearGradient colors={stops as any} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

export function tonesFor(sys: LevelSys, idx: number): string[] {
  return (sys === "wealth" ? WEALTH_TONES : CHARM_TONES)[Math.max(0, Math.min(9, idx))];
}
export const flowMsFor = (idx: number): number | undefined => FLOW_MS[idx];

/** Fills its parent with the exact palette for a level (static 1–6, flowing 7–10). */
export function PaletteFill({ sys, level }: { sys: LevelSys; level: number }) {
  const idx = badgeIndexFor(level);
  const tone = tonesFor(sys, idx);
  return FLOW_MS[idx]
    ? <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none"><FlowingGradient colors={tone} duration={FLOW_MS[idx]} period={180} /></View>
    : <LinearGradient pointerEvents="none" colors={tone as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />;
}

/**
 * Recolours the ORIGINAL artwork with the exact palette using a "color" blend
 * (keeps the artwork's own light/shade detail; shape, size and pixels of the
 * source file are untouched). Clipped to the artwork's alpha: MaskedView on
 * native, CSS mask-image on web. Badges 7–10 flow the palette across the art.
 */
export function TintedImage({ source, w, h, colors: c, flowMs }: { source: ImageSourcePropType; w: number; h: number; colors: string[]; flowMs?: number }) {
  const img = <Image source={source} style={{ width: w, height: h }} resizeMode="contain" />;
  const grad = flowMs
    ? <FlowingGradient colors={c} duration={flowMs} period={w} />
    : <LinearGradient colors={c as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />;
  const layer = (
    <View style={{ width: w, height: h }}>
      {img}
      <View style={[StyleSheet.absoluteFill, { overflow: "hidden", mixBlendMode: "color" } as any]}>{grad}</View>
    </View>
  );
  if (Platform.OS === "web") {
    const mask = `url("${Asset.fromModule(source as number).uri}")`;
    return (
      <View testID="tinted-image" style={[{ width: w, height: h, isolation: "isolate", maskImage: mask, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" } as any]}>
        {layer}
      </View>
    );
  }
  return (
    <MaskedView testID="tinted-image" style={{ width: w, height: h }} maskElement={img}>
      {layer}
    </MaskedView>
  );
}

export function badgeSource(sys: LevelSys, level: number) {
  return (sys === "wealth" ? WEALTH_ITEMS : CHARM_ITEMS)[badgeIndexFor(level)].source;
}

/** Static badge artwork in a square box, aspect ratio preserved.
 * `pressable` → opens the Levels screen on this system at the earned badge. */
export function LevelBadgeImage({ sys, level, size, testID, pressable }: { sys: LevelSys; level: number; size: number; testID?: string; pressable?: boolean }) {
  const router = useRouter();
  // Same palette-recoloured artwork as the Levels screen, so colours match everywhere.
  const tinted = <TintedImage source={badgeSource(sys, level)} w={size} h={size} colors={tonesFor(sys, badgeIndexFor(level))} />;
  const img = <View testID={pressable ? undefined : testID}>{tinted}</View>;
  if (!pressable) return img;
  return (
    <Pressable testID={testID} hitSlop={6} onPress={() => router.push(`/level?sys=${sys}&lv=${level}` as any)}>
      {img}
    </Pressable>
  );
}

/** Compact pill: badge artwork + exact "LV n" on the owner-specified palette. Tappable → Levels.
 * Small badges are ALWAYS static (only colour/number change with the level).
 * `size` mirrors VipBadge sizes (sm 16px / md 22px) so rows stay uniform. */
export function LevelBadgeChip({ sys, level, testID, size = "md" }: { sys: LevelSys; level: number; testID?: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const idx = badgeIndexFor(level);
  const tone = (sys === "wealth" ? WEALTH_TONES : CHARM_TONES)[idx];
  const light = tone.reduce((a, h) => a + lum(h), 0) / tone.length > 0.45;
  const sm = size === "sm";
  return (
    <Pressable testID={testID} hitSlop={4} onPress={() => router.push(`/level?sys=${sys}&lv=${level}` as any)} style={[styles.chip, sm && styles.chipSm]} accessibilityLabel={`${sys} LV ${level}`}>
      <LinearGradient colors={tone as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LevelBadgeImage sys={sys} level={level} size={BADGE_ART} />
      <Text style={[styles.chipText, sm && styles.chipTextSm, { color: light ? "#1A1530" : "#FFFFFF" }]}>
        {`LV${level}`}
      </Text>
    </Pressable>
  );
}

/** Supporter badge: trophy + total eligible diamonds spent on gifts (K/M). Static. */
export function SupporterBadge({ total, testID }: { total?: number | null; testID?: string }) {
  return (
    <View testID={testID} style={[styles.chip, styles.ageChip, { borderColor: "#F2C94C66", backgroundColor: "#F2C94C1F" }]} accessibilityLabel={`Supporter ${total ?? 0}`}>
      <Icon name="trophy" size={12} color="#F2C94C" />
      <Text style={[styles.chipText, { color: "#F2C94C", fontStyle: "normal" }]}>{abbrevNumber(Number(total || 0))}</Text>
    </View>
  );
}

/** Country flag that fills its circular container completely (shared CountryFlag). */
export function FlagCircle({ flag, code, size = BADGE_H, testID }: { flag?: string | null; code?: string | null; size?: number; testID?: string }) {
  if (!flag && !code) return null;
  return <CountryFlag testID={testID} flag={flag} code={code} size={size} />;
}

/** Age badge: number followed by the ♂/♀ arrow indicator (not tappable). */
export function AgeBadge({ age, gender, testID }: { age?: number | null; gender?: string | null; testID?: string }) {
  const female = gender === "female";
  const c = female ? "#FF69B4" : "#5AC8FA";
  if (typeof age !== "number" && !gender) return null;
  return (
    <View testID={testID} style={[styles.chip, styles.ageChip, { borderColor: c + "66", backgroundColor: c + "1F" }]}>
      {typeof age === "number" && <Text style={[styles.chipText, { color: c, fontStyle: "normal" }]}>{age}</Text>}
      {!!gender && <Icon name={female ? "female" : "male"} size={10} color={c} />}
    </View>
  );
}

// Iter-137 — ONE shared size token for all four badge types (Age · VIP ·
// Wealth · Charm): identical outer height everywhere (sm and md alike).
export const BADGE_H = 16;
export const BADGE_FONT = 9;
export const BADGE_ART = 14;

const styles = StyleSheet.create({
  ageChip: { paddingHorizontal: 6, gap: 2, borderWidth: 0.75 },
  chip: {
    height: BADGE_H, borderRadius: BADGE_H / 2, overflow: "hidden", paddingStart: 2, paddingEnd: 6,
    flexDirection: "row", alignItems: "center", gap: 2,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.45)",
  },
  flow: { position: "absolute", top: 0, bottom: 0, left: 0, width: FLOW_PERIOD * 2 },
  chipText: { fontSize: BADGE_FONT, fontWeight: "900", fontStyle: "italic", includeFontPadding: false },
  chipSm: { height: BADGE_H, borderRadius: BADGE_H / 2, paddingStart: 1, paddingEnd: 5 },
  chipTextSm: { fontSize: BADGE_FONT },
});
