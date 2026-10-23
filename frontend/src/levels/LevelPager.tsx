/**
 * Iter-107 — Swipeable / arrow-navigable pager for Level items (jewels).
 * Scalable: pass any number of items; images keep their exact aspect ratio.
 * RTL: "next" item comes from the left; the left-edge arrow always shows "<"
 * and the right-edge arrow always shows ">" (arrows sit in a flex row, which
 * mirrors natively, while page transforms are direction-aware).
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Image, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, SharedValue } from "react-native-reanimated";
import { useI18n } from "@/src/i18n";
import { AnimatedJewel } from "@/src/levels/AnimatedJewel";
import { LuxArrow } from "@/src/levels/LuxArrow";
import { tonesFor, flowMsFor, TintedImage, type LevelItem } from "@/src/levels/badges";
import { RadialGlow } from "@/src/components/RadialGlow";

export type { LevelItem };

function Page({ item, i, pos, drag, width, dir, w, total }: {
  item: LevelItem; i: number; pos: SharedValue<number>; drag: SharedValue<number>; width: number; dir: number; w: number; total: number;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (i - pos.value) * width * dir + drag.value }],
  }));
  // Iter-119 — exact approved palette applied to the artwork itself.
  const [sysName, n] = item.id.split("-");
  const idx = Number(n) - 1;
  const tint = tonesFor(sysName === "charm" ? "charm" : "wealth", idx);
  const flowMs = flowMsFor(idx);
  return (
    <Animated.View style={[styles.page, { width }, style]} testID={`level-item-${item.id}`}>
      {/* Final 3 levels: permanent static soft radial glow in the badge palette. */}
      {i >= total - 3 && <RadialGlow id={item.id} color={tint[Math.floor(tint.length / 2)]} size={w * 1.45} />}
      {item.fx ? (
        <AnimatedJewel source={item.source} w={w} h={w / item.ratio} tier={item.fx} kind={item.kind} tint={tint} flowMs={flowMs} />
      ) : (
        <TintedImage source={item.source} w={w} h={w / item.ratio} colors={tint} />
      )}
    </Animated.View>
  );
}

// Arrow column (6 pad + 44 btn) + 10 breathing room on each side.
const EDGE = 60;
const MIN_SCALE = 0.6;

export function LevelPager({ items, height, slots, index: ctrlIndex, onIndexChange }: {
  items: LevelItem[]; height: number;
  /** Size-scale slot count; pass the full tier count so sizes match across sections. */
  slots?: number;
  /** Optional controlled index (e.g. driven by level-range tabs). */
  index?: number;
  onIndexChange?: (i: number) => void;
}) {
  const { width } = useWindowDimensions();
  const { isRTL } = useI18n();
  const dir = isRTL ? -1 : 1;
  const [innerIndex, setInnerIndex] = useState(0);
  const index = ctrlIndex ?? innerIndex;
  const pos = useSharedValue(index);
  const drag = useSharedValue(0);
  // Box the largest (last) item fully fits in: between the arrows and within ~55% of the height.
  // Extra 20px reserve so animated tiers (rock + breathe) never reach the arrows.
  const maxW = Math.min(width - EDGE * 2 - 20, 420);
  const maxH = height * 0.55;
  const n = Math.max(slots ?? items.length, items.length);
  // Progressive sizes: item 1 smallest … last item largest; each keeps its own aspect ratio.
  const widthFor = (it: LevelItem, i: number) => {
    const scale = n > 1 ? MIN_SCALE + (1 - MIN_SCALE) * (i / (n - 1)) : 0.85;
    return Math.min(maxW, maxH * it.ratio) * scale;
  };

  // Animate whenever the (controlled or internal) index changes.
  useEffect(() => {
    pos.value = withTiming(index, { duration: 320 });
  }, [index, pos]);

  const goTo = useCallback((n: number) => {
    const next = Math.max(0, Math.min(items.length - 1, n));
    if (onIndexChange) onIndexChange(next); else setInnerIndex(next);
  }, [items.length, onIndexChange]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      const atStart = pos.value <= 0 && e.translationX * dir > 0;
      const atEnd = pos.value >= items.length - 1 && e.translationX * dir < 0;
      drag.value = atStart || atEnd ? e.translationX * 0.25 : e.translationX;
    })
    .onEnd((e) => {
      const step = Math.abs(e.translationX) > width * 0.2 || Math.abs(e.velocityX) > 600 ? (e.translationX * dir < 0 ? 1 : -1) : 0;
      drag.value = withTiming(0, { duration: 260 });
      if (step) runOnJS(goTo)(Math.round(pos.value) + step);
    });

  const canPrev = index > 0;
  const canNext = index < items.length - 1;

  return (
    <View style={[styles.wrap, { height }]} testID="level-pager">
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          {items.map((it, i) => (
            <Page key={it.id} item={it} i={i} pos={pos} drag={drag} width={width} dir={dir} w={widthFor(it, i)} total={items.length} />
          ))}
        </View>
      </GestureDetector>
      {/* Edge arrows: row mirrors in RTL so "previous" sits on the reading-start edge. */}
      <View style={styles.arrows} pointerEvents="box-none">
        <Pressable testID="level-prev" disabled={!canPrev} onPress={() => goTo(index - 1)} hitSlop={12} style={[styles.arrow, !canPrev && styles.dim]}>
          <LuxArrow direction={isRTL ? "right" : "left"} size={34} />
        </Pressable>
        <Pressable testID="level-next" disabled={!canNext} onPress={() => goTo(index + 1)} hitSlop={12} style={[styles.arrow, !canNext && styles.dim]}>
          <LuxArrow direction={isRTL ? "left" : "right"} size={34} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", overflow: "hidden" },
  page: { position: "absolute", top: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  arrows: { ...StyleSheet.absoluteFill, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6 },
  arrow: { width: 44, height: 64, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.35 },
});
