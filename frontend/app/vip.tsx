/**
 * VIP Center.
 * ONLY the header (Back · title · ?) is fixed. Everything else — the full
 * owner-supplied background artwork (crown → lower golden ornament), the
 * VIP1–VIP10 badge pager and the 30×3 sections — scrolls together as ONE page.
 * The artwork keeps its exact intrinsic aspect ratio (853×1843). The whole
 * page (artwork lighting, page colour, sections, header, controls) follows
 * the colour theme of the selected VIP badge.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolateColor } from "react-native-reanimated";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth-context";
import { spacing, radius } from "@/src/theme";
import { VipBadgeShowcase } from "@/src/vip/VipBadgeShowcase";
import { VipUnlockHint } from "@/src/vip/VipUnlockHint";
import { VIP_THEMES, VIP_FONT, VIP_NUM_FONT, shade } from "@/src/vip/vipAssets";
import { ENTRANCE_EFFECTS, ENTRANCE_BY_VIP_INDEX } from "@/src/entrance/effects";
import { EntrancePreviewModal } from "@/src/entrance/EntrancePreviewModal";
import { PlayBadge } from "@/src/entrance/EntranceRewardModal";

const BG = require("../assets/images/vip-center-bg.png");
const BG_RATIO = 1843 / 853; // height / width of the original image
const ROWS = Array.from({ length: 30 }, (_, i) => i); // 30 rows × 3 sections = 90
const STEPS = VIP_THEMES.map((_, i) => i);
const TINTS = VIP_THEMES.map((t) => t.tint);

const TAB_W = 56;
const TAB_GAP = 8;
const TAB_PAD = 16;

export default function VipCenterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isRTL } = useI18n();
  const { user } = useAuth();
  // Opens directly on the user's current VIP level (VIP1 → index 0).
  const [index, setIndex] = useState(() => Math.max(0, Math.min(STEPS.length - 1, Number(user?.vip_level || 0) - 1)));
  // Auth may still be loading on deep links → jump once the level is known.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current || user?.vip_level == null) return;
    syncedRef.current = true;
    setIndex(Math.max(0, Math.min(STEPS.length - 1, Number(user.vip_level || 0) - 1)));
  }, [user?.vip_level]);
  const [preview, setPreview] = useState<string | null>(null);
  const t = useSharedValue(0);
  const headerH = insets.top + spacing.sm + 44 + 50;
  const tabsRef = useRef<ScrollView>(null);
  const imgH = width * BG_RATIO;
  const theme = VIP_THEMES[index];
  const pageBg = shade(theme.tint, 0.08);

  useEffect(() => { t.value = withTiming(index, { duration: 420 }); }, [index, t]);
  // Keep the selected VIP tab centred in view (works for taps AND swipes).
  // RTL: the bar is laid out LTR with reversed order, so offsets stay reliable.
  useEffect(() => {
    const di = isRTL ? STEPS.length - 1 - index : index;
    const x = TAB_PAD + di * (TAB_W + TAB_GAP) + TAB_W / 2 - width / 2;
    tabsRef.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [index, isRTL, width]);

  // Re-lights the artwork in the selected badge's colour (hue/saturation only;
  // the artwork's own light & shadow detail is kept by the `color` blend).
  const tintStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(t.value, STEPS, TINTS) }));

  return (
    <View style={[styles.container, { backgroundColor: pageBg }]} testID="vip-screen">
      <ScrollView
        testID="vip-scroll"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width, height: imgH }}>
          <Image testID="vip-bg" source={BG} style={StyleSheet.absoluteFill} contentFit="contain" />
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.tint, tintStyle]} />
          {/* Badge centred between the upper crown (~22%) and lower ornament (~80%). */}
          <View style={[styles.showcase, { top: imgH * 0.23, height: imgH * 0.48 }]}>
            <VipBadgeShowcase width={width} height={imgH * 0.48} index={index} onIndexChange={setIndex} />
          </View>
          <View style={[styles.showcase, { top: imgH * 0.655 }]}>
            <VipUnlockHint index={index} />
          </View>
        </View>
        <View style={styles.list}>
          {ROWS.map((r) => (
            <View key={r} style={styles.row}>
              {[0, 1, 2].map((c) => {
                const n = r * 3 + c;
                const fx = n === 0 ? ENTRANCE_EFFECTS[ENTRANCE_BY_VIP_INDEX[index]] : undefined;
                return (
                  <Pressable
                    key={c}
                    disabled={!fx}
                    onPress={() => fx && setPreview(fx.key)}
                    testID={`vip-box-${n + 1}`}
                    style={[styles.box, { backgroundColor: shade(theme.tint, 0.16), borderColor: theme.accent + "59" }]}
                  >
                    {fx && (
                      <>
                        <Image testID={`vip-reward-${fx.key}`} source={fx.thumb} style={styles.rewardImg} contentFit="contain" />
                        <View style={styles.rewardPlay}>
                          <PlayBadge testID={`vip-reward-play-${fx.key}`} color={theme.accent} onPress={() => setPreview(fx.key)} size={26} />
                        </View>
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <EntrancePreviewModal effectKey={preview} onClose={() => setPreview(null)} />

      {/* Fixed header floats above the scrolling page. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, height: headerH }]} pointerEvents="box-none">
        <LinearGradient colors={[pageBg + "D9", pageBg + "00"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={8}>
            <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={theme.accent} />
          </Pressable>
          <Text testID="vip-title" style={[styles.title, { textShadowColor: theme.tint }]}>VIP</Text>
          <Pressable onPress={() => router.push("/vip-guide")} style={styles.iconBtn} testID="vip-help-btn" hitSlop={8}>
            <Icon name="help-circle-outline" size={24} color={theme.accent} />
          </Pressable>
        </View>
        {/* VIP1–VIP10 tabs — identical rounded squares in each level's colour. */}
        <View style={{ direction: "ltr" }}>
          <ScrollView
            ref={tabsRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
            testID="vip-tabs"
          >
            {(isRTL ? [...STEPS].reverse() : STEPS).map((i) => {
              const on = i === index;
              const th = VIP_THEMES[i];
              return (
                <Pressable
                  key={i}
                  testID={`vip-tab-${i + 1}`}
                  onPress={() => setIndex(i)}
                  style={[styles.tab, { borderColor: on ? "#FFFFFF" : th.accent + "66", opacity: on ? 1 : 0.62 }, on && { transform: [{ scale: 1.06 }] }]}
                  accessibilityState={{ selected: on }}
                >
                  <LinearGradient colors={[th.tint, shade(th.tint, 0.45)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <Text style={styles.tabText} numberOfLines={1}>{`VIP${i + 1}`}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

// Fixed palette: every colour is derived from the selected VIP badge theme.
const styles = StyleSheet.create({
  container: { flex: 1 },
  tint: { mixBlendMode: "color", opacity: 0.85 },
  header: { position: "absolute", top: 0, left: 0, right: 0 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  tabsRow: { paddingHorizontal: TAB_PAD, paddingVertical: 6, gap: TAB_GAP },
  tab: {
    width: TAB_W, height: 34, borderRadius: 10, overflow: "hidden", borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  tabText: {
    color: "#FFFFFF", fontFamily: VIP_NUM_FONT, fontWeight: "700", fontSize: 13, letterSpacing: 0.4,
    includeFontPadding: false, fontVariant: ["lining-nums"],
    textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 },
  },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFFFFF", fontFamily: VIP_FONT, fontSize: 22, fontWeight: "700", letterSpacing: 2, textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, gap: spacing.md },
  showcase: { position: "absolute", left: 0, right: 0 },
  row: { flexDirection: "row", gap: spacing.sm },
  box: { flex: 1, height: 96, borderRadius: radius.md, borderWidth: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  rewardImg: { width: "86%", height: "86%" },
  rewardPlay: { position: "absolute", bottom: 5, end: 5 },
});
