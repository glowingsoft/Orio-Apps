/**
 * Room entrance: alpha animation (≤ 50% of the screen height, top fades to
 * full transparency, no rectangle) + synchronized sound + the user's real
 * name on a royal banner in their VIP colour. Plays ONLY on room entry.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useAudioPlayer } from "expo-audio";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from "react-native-reanimated";
import { ENTRANCE_EFFECTS, EntranceFx } from "@/src/entrance/effects";
import { VipName } from "@/src/components/VipName";
import { VipBadge } from "@/src/components/VipBadge";
import { shade } from "@/src/vip/vipAssets";

export type EntranceEntry = { key: number; effect: string; user: any };

export function EntranceOverlay({ entry, onDone }: { entry: EntranceEntry | null; onDone: () => void }) {
  const fx = entry ? ENTRANCE_EFFECTS[entry.effect] : null;
  if (!entry || !fx) return null;
  return <Playback key={entry.key} fx={fx} user={entry.user} onDone={onDone} />;
}

function Playback({ fx, user, onDone }: { fx: EntranceFx; user: any; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const audio = useAudioPlayer(fx.audio);
  const [loaded, setLoaded] = useState(false);
  const fade = useSharedValue(0);
  const banner = useSharedValue(0);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  // Full screen width, centred vertically in the room's display area (overlay
  // is pointer-transparent so chat controls / header stay usable).
  const w = width;
  const h = Math.min(width / fx.ratio, height * 0.62);

  useEffect(() => {
    if (!loaded) {
      const giveUp = setTimeout(() => done.current(), 20000); // media never arrived
      return () => clearTimeout(giveUp);
    }
    try { audio.seekTo(0); audio.play(); } catch {}
    fade.value = withTiming(1, { duration: 280 });
    banner.value = withDelay(350, withTiming(1, { duration: 520, easing: Easing.out(Easing.back(1.4)) }));
    const out = setTimeout(() => {
      fade.value = withTiming(0, { duration: 450 });
      banner.value = withTiming(0, { duration: 380 });
    }, fx.durationMs - 450);
    const end = setTimeout(() => done.current(), fx.durationMs + 50);
    return () => { clearTimeout(out); clearTimeout(end); };
  }, [loaded, audio, fade, banner, fx.durationMs]);

  const fadeSt = useAnimatedStyle(() => ({ opacity: fade.value }));
  const bannerSt = useAnimatedStyle(() => ({
    opacity: banner.value,
    transform: [{ scale: 0.7 + banner.value * 0.3 }, { translateY: (1 - banner.value) * 16 }],
  }));

  return (
    <View pointerEvents="none" style={[styles.layer, { height: h + 40, top: Math.max(0, (height - h) / 2 - 20) }]} testID="entrance-overlay">
      <Animated.View style={[{ width: w, height: h }, fadeSt]}>
        <Image
          testID={`entrance-anim-${fx.key}`}
          source={{ uri: fx.anim }}
          style={{ width: w, height: h }}
          contentFit="contain"
          autoplay
          cachePolicy="disk"
          onLoad={() => setLoaded(true)}
        />
      </Animated.View>
      <Animated.View style={[styles.bannerWrap, bannerSt]}>
        <LinearGradient
          colors={[shade(fx.tint, 0.15) + "00", shade(fx.tint, 0.55), fx.tint, shade(fx.tint, 0.55), shade(fx.tint, 0.15) + "00"]}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={[styles.banner, { borderColor: fx.accent + "CC" }]}
        >
          <VipBadge level={user?.vip_level} size="md" />
          <VipName testID="entrance-username" name={user?.nickname || user?.username || "VIP"} vipLevel={user?.vip_level}
            style={styles.name} numberOfLines={1} />
        </LinearGradient>
        <View style={[styles.rule, { backgroundColor: fx.accent }]} />
      </Animated.View>
    </View>
  );
}

// Fixed cinematic colours (white name + VIP palette on any room background).
const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "flex-end", zIndex: 50, elevation: 50 },
  bannerWrap: { position: "absolute", bottom: 0, alignItems: "center" },
  banner: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 34, paddingVertical: 7,
    borderTopWidth: 1, borderBottomWidth: 1, minWidth: 220, justifyContent: "center",
  },
  name: {
    color: "#FFFFFF", fontSize: 17, fontWeight: "900", letterSpacing: 0.4, maxWidth: 220,
  },
  rule: { height: 1, width: 140, marginTop: 3, opacity: 0.8 },
});

/** In-place preview (My Bag / Store): the SAME transparent room animation +
 * sound, played inside the given box, then back to the static artwork. */
export function InlineEntrance({ effectKey, width, height, onDone }: { effectKey: string; width: number; height: number; onDone: () => void }) {
  const fx = ENTRANCE_EFFECTS[effectKey];
  const audio = useAudioPlayer(fx?.audio);
  const [loaded, setLoaded] = useState(false);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!loaded || !fx) return;
    try { audio.seekTo(0); audio.play(); } catch {}
    const t = setTimeout(() => done.current(), fx.durationMs);
    return () => { clearTimeout(t); try { audio.pause(); } catch {} };
  }, [loaded, audio, fx]);
  if (!fx) return null;
  return (
    <Image testID={`entrance-inline-${fx.key}`} source={{ uri: fx.anim }} style={{ width, height }}
      contentFit="contain" autoplay cachePolicy="disk" onLoad={() => setLoaded(true)} />
  );
}
