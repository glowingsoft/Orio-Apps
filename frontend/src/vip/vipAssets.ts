/**
 * Shared VIP1–VIP10 assets: owner badge artwork, per-level colour theme and
 * the premium serif type used on the badges. Single source for the VIP
 * Center, VIP mini-badges and the Honor / room-profile level boxes.
 */
import { Platform } from "react-native";

export const VIP_MAX = 10;

export const VIP_BADGES = [
  require("../../assets/images/vip-badge-1.png"),
  require("../../assets/images/vip-badge-2.png"),
  require("../../assets/images/vip-badge-3.png"),
  require("../../assets/images/vip-badge-4.png"),
  require("../../assets/images/vip-badge-5.png"),
  require("../../assets/images/vip-badge-6.png"),
  require("../../assets/images/vip-badge-7.png"),
  require("../../assets/images/vip-badge-8.png"),
  require("../../assets/images/vip-badge-9.png"),
  require("../../assets/images/vip-badge-10.png"),
];

/** Colour theme per level, taken from each badge's artwork (index 0 = VIP1). */
/** Iter-136 — wide head strips (plaque/VIP text removed, right edge faded) for the pill badge. */
export const VIP_STRIPS = [
  require("../../assets/images/vip-strip/vip-strip-1.png"),
  require("../../assets/images/vip-strip/vip-strip-2.png"),
  require("../../assets/images/vip-strip/vip-strip-3.png"),
  require("../../assets/images/vip-strip/vip-strip-4.png"),
  require("../../assets/images/vip-strip/vip-strip-5.png"),
  require("../../assets/images/vip-strip/vip-strip-6.png"),
  require("../../assets/images/vip-strip/vip-strip-7.png"),
  require("../../assets/images/vip-strip/vip-strip-8.png"),
  require("../../assets/images/vip-strip/vip-strip-9.png"),
  require("../../assets/images/vip-strip/vip-strip-10.png"),
];
export const VIP_STRIP_RATIO = 1.45;

export const VIP_THEMES: { tint: string; accent: string }[] = [
  { tint: "#8FA3B8", accent: "#D5DEE8" }, // 1 deer — silver steel
  { tint: "#7D8A99", accent: "#D0D6DE" }, // 2 ram — slate silver
  { tint: "#12A37A", accent: "#5FE6B8" }, // 3 horse — emerald
  { tint: "#C9862B", accent: "#F2B85A" }, // 4 eagle — amber gold
  { tint: "#2F6BFF", accent: "#86B6FF" }, // 5 fox — royal blue
  { tint: "#3AA6D6", accent: "#A6E6FF" }, // 6 bear — ice blue
  { tint: "#D99A1E", accent: "#FFD36B" }, // 7 leopard — gold
  { tint: "#8B2BE2", accent: "#D49BFF" }, // 8 tiger — amethyst
  { tint: "#C8401C", accent: "#FFB25A" }, // 9 lion — crimson gold
  { tint: "#D0141E", accent: "#FF5A4E" }, // 10 dragon — dragon red
];

/** Clamp a real vip_level to a 0-based artwork index (null when not VIP). */
export function vipIndex(level?: number | null): number | null {
  const l = Math.floor(Number(level ?? 0));
  return l >= 1 ? Math.min(l, VIP_MAX) - 1 : null;
}

/** Premium engraved serif matching the "VIP n" lettering on the badges. */
export const VIP_FONT = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, 'Times New Roman', serif",
}) as string;

/** Serif with LINING figures (Georgia's old-style numerals drop below the
 * baseline) — used where "VIP" + level number sit together in small text. */
export const VIP_NUM_FONT = Platform.select({
  ios: "Times New Roman",
  android: "serif",
  default: "'Times New Roman', Times, serif",
}) as string;

/** Mix a hex colour toward black: amount 0 = black, 1 = original. */
export function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
