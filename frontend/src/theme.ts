import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  // Surfaces
  // Iter-137 — GLOBAL PURE WHITE theme.
  surface: "#FFFFFF",
  onSurface: "#111114",
  surfaceSecondary: "#F5F5F7",
  onSurfaceSecondary: "#3A3A3C",
  surfaceTertiary: "#EDEDF1",
  onSurfaceTertiary: "#48484A",
  surfaceElevated: "#FFFFFF",
  surfaceInverse: "#121212",
  onSurfaceInverse: "#FFFFFF",
  card: "#FFFFFF",
  muted: "#7C7C84",

  // Brand — iter-44 Phase 4 luminous ORIO purple palette (brighter + stronger glow per user).
  //   - `brandPrimary` boosted from #9B6CFF → #B47CFF for more luminous feel.
  //   - `purpleGlow` kept as the bloom highlight for shadow/ring effects.
  brand: "#6D28D9",
  onBrand: "#FFFFFF",
  brandPrimary: "#8B4DFF",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#6A0DAD",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#4B0082",
  onBrandTertiary: "#FFFFFF",

  // Semantic
  success: "#32D74B",
  onSuccess: "#000000",
  warning: "#FFD60A",
  onWarning: "#000000",
  error: "#FF453A",
  onError: "#FFFFFF",
  info: "#0A84FF",
  onInfo: "#FFFFFF",

  // Lines
  border: "#E6E6EB",
  borderStrong: "#D1D1D6",
  divider: "#EFEFF3",

  // App-specific
  // iter-44 — `gold` is intentionally kept as a key for existing call-sites
  // (gift-badge, section titles, tab accents) but now points to the luminous
  // ORIO purple so NO per-file sweep is required. VIP-tier colors are
  // preserved separately so VIP visual identity is unchanged.
  gold: "#8B4DFF",
  purple: "#8B4DFF",
  purpleGlow: "#E9D5FF",
  purpleDeep: "#4B0082",
  micActive: "#32D74B",
  micMuted: "#FF453A",
  seatEmpty: "rgba(255,255,255,0.08)",
  seatLocked: "rgba(255,255,255,0.02)",
  vipBronze: "#CD7F32",
  vipSilver: "#C0C0C0",
  vipGold: "#FFD700",
  vipDiamond: "#B9F2FF",
  rarityCommon: "#8E8E93",
  rarityRare: "#0A84FF",
  rarityEpic: "#BF5AF2",
  rarityLegendary: "#FFD60A",
  overlay: "rgba(0,0,0,0.6)",
  glassBg: "rgba(255,255,255,0.88)",
};

export type ThemeColors = typeof dark;
export const defaultScheme = "dark" satisfies ColorScheme;
export const themes: { light?: ThemeColors; dark: ThemeColors } = { dark };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}
setColorScheme?.(defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = "dark";
  return { scheme, colors: themes.dark };
}

export const colors = dark;

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, xl: 28, pill: 999 };
