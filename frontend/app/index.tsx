/**
 * Splash / Index — Iter-66.
 *
 * Clean premium splash: purple → black backdrop, a soft purple glow at the
 * top edge, and the ORIO logo + "Orio" wordmark + tagline centered. No
 * rings, no orb banner, no decorative shapes.
 */
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { spacing } from "@/src/theme";
import { TopPurpleGlow } from "@/src/components/TopPurpleGlow";

const LOGO = require("../assets/images/orio-toast-logo.png");

export default function Index() {
  useAuth();
  const { t, isRTL } = useI18n();
  return (
    <View style={styles.container} testID="splash-screen">
      {/* Purple → black base backdrop */}
      <LinearGradient
        colors={["#1B0B33", "#0A0014", "#000000"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft purple top glow (shared with the rest of the app) */}
      <TopPurpleGlow height={220} />

      {/* Centered brand lockup */}
      <View style={styles.content}>
        <View style={styles.logoHalo}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" />
        </View>
        <Text style={[styles.wordmark, isRTL && { marginTop: spacing.xl + 4 }]}>{t.orioBrand}</Text>
        <Text style={[styles.tagline, isRTL && { marginTop: spacing.lg, lineHeight: 24 }]}>{t.voiceChatPartyGames}</Text>
        {/* No spinner / progress — initialization continues silently. */}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", alignItems: "center" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 60,
  },
  // ~15% smaller logo with softly rounded corners (artwork unchanged).
  logoHalo: {
    width: 187,
    height: 187,
    borderRadius: 40,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.6,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 0 },
  },
  logo: { width: 187, height: 187, borderRadius: 40 },
  wordmark: {
    color: "#FFFFFF",
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: 2,
    marginTop: spacing.xl,
    textShadowColor: "rgba(168,85,247,0.65)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  tagline: {
    color: "#EDE9FE",
    fontSize: 14,
    marginTop: spacing.md,
    letterSpacing: 0.4,
    fontWeight: "600",
    opacity: 0.92,
    textAlign: "center",
  },
});
