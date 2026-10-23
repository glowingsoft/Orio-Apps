import React from "react";
import { View, Text, StyleSheet, ViewStyle, StyleProp } from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop, RadialGradient } from "react-native-svg";
import { colors } from "@/src/theme";

/**
 * Diamond — the ONLY ORIO currency icon.
 * Premium 3D faceted gemstone rendered in SVG.
 * Blue/cyan brilliant-cut design with lighting facets.
 */
export function Diamond({ size = 24, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const s = size;
  return (
    <View style={[{ width: s, height: s }, style]}>
      <Svg width={s} height={s} viewBox="0 0 100 100">
        <Defs>
          {/* crown (top) light face */}
          <LinearGradient id="g_crown_light" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#E5FBFF" stopOpacity="1" />
            <Stop offset="1" stopColor="#7DD8FF" stopOpacity="1" />
          </LinearGradient>
          {/* crown right (mid tone) */}
          <LinearGradient id="g_crown_mid" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#4EB9F5" stopOpacity="1" />
            <Stop offset="1" stopColor="#1E7ED1" stopOpacity="1" />
          </LinearGradient>
          {/* crown far right dark */}
          <LinearGradient id="g_crown_dark" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#1E7ED1" stopOpacity="1" />
            <Stop offset="1" stopColor="#0A4B93" stopOpacity="1" />
          </LinearGradient>
          {/* pavilion (bottom) gradient */}
          <LinearGradient id="g_pav" x1="0.5" y1="0" x2="0.5" y2="1">
            <Stop offset="0" stopColor="#2B8FE0" stopOpacity="1" />
            <Stop offset="0.6" stopColor="#0F4C93" stopOpacity="1" />
            <Stop offset="1" stopColor="#062752" stopOpacity="1" />
          </LinearGradient>
          {/* pavilion side */}
          <LinearGradient id="g_pav_side" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#1B6FBF" stopOpacity="1" />
            <Stop offset="1" stopColor="#083775" stopOpacity="1" />
          </LinearGradient>
          {/* highlight */}
          <RadialGradient id="g_hl" cx="0.4" cy="0.25" rx="0.4" ry="0.15">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* crown top-left facet */}
        <Path d="M18 32 L50 22 L50 42 L30 42 Z" fill="url(#g_crown_light)" />
        {/* crown top-right facet */}
        <Path d="M50 22 L82 32 L70 42 L50 42 Z" fill="url(#g_crown_mid)" />
        {/* crown left small */}
        <Path d="M18 32 L30 42 L18 42 Z" fill="url(#g_crown_mid)" />
        {/* crown right small */}
        <Path d="M82 32 L82 42 L70 42 Z" fill="url(#g_crown_dark)" />

        {/* girdle strip */}
        <Path d="M18 42 L82 42 L82 44 L18 44 Z" fill="#0A4B93" />

        {/* pavilion (big lower triangle) split into 3 facets */}
        <Path d="M18 44 L50 88 L34 60 Z" fill="url(#g_pav_side)" />
        <Path d="M82 44 L50 88 L66 60 Z" fill="url(#g_pav)" />
        <Path d="M18 44 L34 60 L50 88 L66 60 L82 44 L50 62 Z" fill="url(#g_pav)" />
        <Path d="M18 44 L82 44 L50 62 Z" fill="url(#g_crown_mid)" opacity="0.9" />

        {/* culet accent line */}
        <Path d="M50 62 L50 88" stroke="#0A4B93" strokeWidth="0.5" opacity="0.5" />

        {/* specular highlight on crown */}
        <Path d="M28 30 L46 24 L44 32 L30 36 Z" fill="url(#g_hl)" />
      </Svg>
    </View>
  );
}

/**
 * Amount pill: <Diamond /> N,NNN
 */
export function DiamondAmount({ value, size = 16, textStyle }: { value: number | string; size?: number; textStyle?: any }) {
  return (
    <View style={styles.row}>
      <Diamond size={size} />
      <Text style={[{ color: colors.onSurface, fontWeight: "800", fontSize: size * 0.9, marginLeft: 5 }, textStyle]}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
