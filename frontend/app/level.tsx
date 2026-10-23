/**
 * Iter-102 — Levels screen.
 * The supplied GOLD / PURPLE artwork is shown at its original aspect ratio
 * (full width, height = width / ratio): no zoom, crop or stretch. It starts
 * at the very top of the screen behind the fixed header + tabs, and the whole
 * page scrolls vertically. The slot below the artwork is reserved for
 * future level content. RTL mirrors natively.
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, ScrollView, FlatList, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useI18n } from "@/src/i18n";
import { useQuery } from "@tanstack/react-query";
import { apiMyLevels } from "@/src/api";
import { abbrevNumber } from "@/src/utils/format";
import { ScreenHeader, TabBar, cosmeticStyles } from "@/src/cosmetics/ui";
import { LevelPager } from "@/src/levels/LevelPager";
import { WEALTH_ITEMS, CHARM_ITEMS, RANGE_TARGETS, badgeIndexFor, tonesFor } from "@/src/levels/badges";

type Sys = "wealth" | "charm";

/** Very dark page colour derived from the selected badge colour. */
function shadeHex(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.1));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const IMAGES = {
  wealth: { src: require("../assets/images/levels/wealth_gold.png"), ratio: 853 / 1843 },
  charm: { src: require("../assets/images/levels/charm_purple.png"), ratio: 853 / 1843 },
};

export default function LevelScreen() {
  const { lang, isRTL } = useI18n();
  const router = useRouter();
  const ar = lang === "ar";
  const { width, height } = useWindowDimensions();
  // Iter-117 — badges elsewhere deep-link here: ?sys=wealth|charm&lv=<earned level>.
  const params = useLocalSearchParams<{ sys?: string; lv?: string }>();
  const [sys, setSys] = useState<Sys>(params.sys === "charm" ? "charm" : "wealth");
  const [idx, setIdx] = useState(params.lv != null ? badgeIndexFor(Number(params.lv)) : 0);
  const img = IMAGES[sys];
  const items = sys === "wealth" ? WEALTH_ITEMS : CHARM_ITEMS;
  const rangeRef = useRef<FlatList<string>>(null);
  const tones = tonesFor(sys, idx);
  const theme = tones[Math.floor(tones.length / 2)];
  // Iter-115 — the user's REAL earned levels (server-side). Browsing never changes them.
  const { data: lv } = useQuery({ queryKey: ["my-levels"], queryFn: apiMyLevels, refetchOnMount: "always" });
  const earnedIdx = (s: Sys) => badgeIndexFor(Number(lv?.[s]?.level || 0));
  // Open on the earned badge once data arrives (and on every tab switch).
  const synced = useRef(false);
  useEffect(() => {
    if (lv && !synced.current) { synced.current = true; if (params.lv == null) setIdx(earnedIdx(sys)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lv]);
  // Current (earned) badge → NEXT level requirement. Any other badge →
  // remaining total through the LAST level of that range (LV5 … LV51).
  const prog = lv?.[sys];
  const onEarned = !!prog && idx === earnedIdx(sys) && !prog.is_max && prog.next_level != null;
  const target = onEarned ? Number(prog.next_level) : RANGE_TARGETS[idx];
  const cum = prog?.cumulative?.[target - 1];
  const remaining = cum == null ? null : Math.max(0, Number(cum) - Number(prog.points || 0));
  const progText = remaining == null ? "" : ar
    ? `للترقية إلى LV ${target} يتطلب ${abbrevNumber(remaining)} ألماسة`
    : `Upgrade to LV ${target} requires ${abbrevNumber(remaining)} diamonds`;
  // Keep the selected range tab centred in view (never snaps back to the start).
  useEffect(() => {
    const t = setTimeout(() => {
      // RTL: the bar is laid out LTR with reversed data, so offsets stay reliable.
      const di = isRTL ? RANGES.length - 1 - idx : idx;
      rangeRef.current?.scrollToIndex({ index: di, viewPosition: 0.5, animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [idx, sys, isRTL]);

  return (
    <View style={[cosmeticStyles.container, { backgroundColor: shadeHex(theme) }]} testID="level-screen">
      <ScrollView testID="level-scroll" style={StyleSheet.absoluteFill} showsVerticalScrollIndicator={false}>
        <Image
          testID={`level-image-${sys}`}
          source={img.src}
          style={{ width, height: width / img.ratio }}
          resizeMode="contain"
        />
        {/* Re-light the artwork in the selected badge's colour (hue only; detail kept). */}
        <View pointerEvents="none" style={[styles.tint, { height: width / img.ratio, backgroundColor: theme }]} />
        {/* Iter-107 — Wealth jewels pager, centered on screen over the artwork. Charm is empty for now. */}
        {/* Iter-111 — Charm levels: same pager/sizing system (10-slot scale like Wealth). */}
        {sys === "charm" && (
          <View style={[styles.pagerLayer, { height }]}>
            <LevelPager key="charm" items={CHARM_ITEMS} height={height} slots={10} index={idx} onIndexChange={setIdx} />
          </View>
        )}
        {sys === "wealth" && (
          <View style={[styles.pagerLayer, { height }]}>
            <LevelPager items={WEALTH_ITEMS} height={height} index={idx} onIndexChange={setIdx} />
          </View>
        )}
        {/* Iter-115 — real progress to the next level, below the badge. */}
        {progText ? (
          <View style={[styles.progWrap, { top: height * 0.8 }]} pointerEvents="none">
            <Text testID="level-progress-text" style={styles.progText}>{progText}</Text>
          </View>
        ) : null}
        {/* Future rewards — Wealth only: thin divider + 10 square placeholders. */}
        {sys === "wealth" ? (
          <View testID="level-future-content" style={styles.future}>
            <View style={[styles.divider, { backgroundColor: theme + "99" }]} />
            <View style={styles.rewardGrid}>
              {[0, 1, 2, 3].map((r) => (
                <View key={r} style={styles.rewardRow}>
                  {[0, 1, 2].map((c) => {
                    const i = r * 3 + c;
                    return i < 10
                      ? <View key={c} testID={`level-reward-slot-${i}`} style={[styles.rewardSlot, { borderColor: theme + "59", backgroundColor: theme + "29" }]} />
                      : <View key={c} style={styles.rewardSpacer} />;
                  })}
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View testID="level-future-content" style={{ minHeight: 24 }} />
        )}
      </ScrollView>

      {/* Fixed header + tabs on top of the artwork (unchanged layout). */}
      <View style={styles.overlay} pointerEvents="box-none">
        <ScreenHeader testID="level" title={ar ? "المستويات" : "Levels"} sideIcon="help-circle-outline" sideTestID="level-rules-btn" onSide={() => router.push("/level-rules" as any)} />
        <TabBar
          plain
          tabs={[
            { id: "wealth" as Sys, label: ar ? "الثروة" : "Wealth" },
            { id: "charm" as Sys, label: ar ? "الجاذبية" : "Charm" },
          ]}
          value={sys}
          onChange={(v) => { setSys(v); setIdx(earnedIdx(v)); }}
        />
        {/* Iter-113 — level-range tabs: each range = one badge. */}
        {/* direction:ltr + reversed data in Arabic = mirrored order with reliable scrolling. */}
        <View style={{ direction: "ltr" }}>
        <FlatList
          ref={rangeRef}
          horizontal
          data={isRTL ? [...RANGES].reverse() : RANGES}
          keyExtractor={(r) => r}
          showsHorizontalScrollIndicator={false}
          style={styles.rangeScroll}
          contentContainerStyle={styles.rangeRow}
          testID="level-range-tabs"
          getItemLayout={(_, i) => ({ length: TAB_W + TAB_GAP, offset: ROW_PAD + (TAB_W + TAB_GAP) * i, index: i })}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item: r, index: di }) => {
            const i = isRTL ? RANGES.length - 1 - di : di;
            return (
            <Pressable
              testID={`level-range-${i}`}
              onPress={() => setIdx(Math.min(i, items.length - 1))}
              style={styles.rangeTab}
            >
              <Text style={[styles.rangeText, idx === i && styles.rangeTextActive]}>{r}</Text>
            </Pressable>
            );
          }}
        />
        </View>
      </View>
    </View>
  );
}

const TAB_W = 64;
const TAB_GAP = 8;
const ROW_PAD = 16;

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0 },
  pagerLayer: { position: "absolute", top: 0, left: 0, right: 0 },
  tint: { position: "absolute", top: 0, left: 0, right: 0, mixBlendMode: "color", opacity: 0.55 },
  future: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 48 },
  // Fixed colours: elegant gold hairline + glassy reward squares on dark artwork.
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: "rgba(242,201,76,0.55)", marginBottom: 20, marginHorizontal: 12 },
  // Same layout as the VIP Center boxes: rows of 3 equal sections.
  rewardGrid: { gap: 12 },
  rewardRow: { flexDirection: "row", gap: 8 },
  rewardSlot: { flex: 1, height: 96, borderRadius: 12, borderWidth: 1 },
  rewardSpacer: { flex: 1 },
  progWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", paddingHorizontal: 24 },
  // Plain white text, no background (fixed colour on artwork).
  progText: {
    color: "#FFFFFF", fontSize: 14, fontWeight: "800", textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: "hidden",
  },
  rangeScroll: { flexGrow: 0, flexShrink: 0, marginTop: 6 },
  rangeRow: { paddingHorizontal: ROW_PAD, paddingVertical: 4 },
  // Subtle black glow pill behind every range tab (fixed: sits on photo artwork).
  rangeTab: {
    width: TAB_W, height: 32, marginEnd: TAB_GAP, alignItems: "center", justifyContent: "center",
    borderRadius: 16, backgroundColor: "rgba(0,0,0,0.28)",
    shadowColor: "#000000", shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  // White numbers with a subtle black glow (fixed: sits on photo artwork).
  rangeText: {
    color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.85)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 },
  },
  rangeTextActive: { color: "#FFFFFF", fontWeight: "900" },
});

const RANGES = ["1–5", "6–10", "11–15", "16–20", "21–25", "26–30", "31–35", "36–40", "41–45", "46–51"];
