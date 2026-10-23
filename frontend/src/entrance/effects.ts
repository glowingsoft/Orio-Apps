/**
 * VIP entrance effects (Iter-131). Real AI-rendered cinematic clips:
 *  - `anim`    alpha animated WebP (black keyed out, top faded) for rooms
 *  - `audio`   the clip's synchronized soundtrack
 *  - `preview` the original clip with sound (VIP Center / My Bag preview)
 * Heavy media streams from the backend; thumbnails ship with the app.
 */
import { Platform } from "react-native";
import { VIP_THEMES } from "@/src/vip/vipAssets";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/static/entrances`;
// Web gets VP9/Opus (plays in every browser); native gets H.264/AAC.
const PV = Platform.OS === "web" ? "webm" : "mp4";

export type EntranceFx = {
  key: string; vip: number; name_en: string; name_ar: string;
  thumb: number; anim: string; audio: string; preview: string;
  ratio: number; durationMs: number; tint: string; accent: string;
};

export const ENTRANCE_EFFECTS: Record<string, EntranceFx> = {
  ice_bear: {
    key: "ice_bear", vip: 6, name_en: "Ice Bear", name_ar: "الدب الجليدي",
    thumb: require("../../assets/images/entrances/ice_bear.png"),
    anim: `${BASE}/ice_bear_v3.webp`, audio: `${BASE}/ice_bear_v3.m4a`, preview: `${BASE}/ice_bear_v3_preview.${PV}`,
    ratio: 540 / 550, durationMs: 5000, tint: VIP_THEMES[5].tint, accent: VIP_THEMES[5].accent,
  },
  golden_leopard: {
    key: "golden_leopard", vip: 7, name_en: "Golden Leopard", name_ar: "الفهد الذهبي",
    thumb: require("../../assets/images/entrances/golden_leopard.png"),
    anim: `${BASE}/golden_leopard_v3.webp`, audio: `${BASE}/golden_leopard_v3.m4a`, preview: `${BASE}/golden_leopard_v3_preview.${PV}`,
    ratio: 540 / 550, durationMs: 5000, tint: VIP_THEMES[6].tint, accent: VIP_THEMES[6].accent,
  },
};

/** VIP Center: 0-based VIP tab index → entrance reward shown in its first box. */
/** Warm the disk cache so an entrance plays the instant a VIP joins. */
export function prefetchEntrances() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Image } = require("expo-image");
    Image.prefetch(Object.values(ENTRANCE_EFFECTS).map((f) => f.anim), "disk");
  } catch {}
}

export const ENTRANCE_BY_VIP_INDEX: Record<number, string> = { 5: "ice_bear", 6: "golden_leopard" };
