/**
 * ORIO Typography presets (iter-44)
 * ----------------------------------------------------------------------------
 * Centralised font/weight/letter-spacing values so section titles across
 * Rooms / Posts / Me / Messages feel consistent and premium. Reuse these
 * instead of re-declaring font sizes everywhere.
 */
import { StyleSheet, Platform } from "react-native";
import { colors } from "@/src/theme";

export const typography = StyleSheet.create({
  // Big screen title ("Party rooms", "المنشورات", "Message", "أنا").
  screenTitle: {
    color: colors.onSurface,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.6,
    includeFontPadding: false as any,
    // Slight weight bump + luminous shadow for the premium feel. Shadow is
    // kept subtle so Arabic shaping is not affected.
    ...Platform.select({
      ios: { textShadowColor: colors.brandPrimary + "55", textShadowRadius: 10 },
      default: { textShadowColor: colors.brandPrimary + "33", textShadowRadius: 6 },
    }),
  },
  // Luminous ORIO purple variant used when the title is the primary brand
  // emphasis (e.g. "Party rooms").
  screenTitleAccent: {
    color: colors.brandPrimary,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.6,
    includeFontPadding: false as any,
    ...Platform.select({
      ios: { textShadowColor: colors.brandPrimary + "66", textShadowRadius: 12 },
      default: { textShadowColor: colors.brandPrimary + "44", textShadowRadius: 8 },
    }),
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});

export default typography;
