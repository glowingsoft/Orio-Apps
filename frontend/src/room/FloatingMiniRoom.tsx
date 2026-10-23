import { useRef, useState, useEffect } from "react";
import { View, Pressable, StyleSheet, Animated, PanResponder, useWindowDimensions, Platform } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, spacing } from "@/src/theme";
import { useRoomSession } from "./RoomSession";
import { usePathname } from "expo-router";

// Mini room is shown ONLY on the four main tabs; hidden elsewhere and
// restored automatically when returning to one of them.
const MAIN_TABS = new Set(["/home", "/me", "/messages", "/posts"]);

/**
 * FloatingMiniRoom — a compact draggable pill rendered at root when a session
 * is minimized. Purple rounded rectangle with an X on the LEFT and the room
 * preview image on the RIGHT (matches the user's reference screenshot). Stays
 * clamped inside the viewport respecting safe-area and the tab bar. Agora
 * voice keeps running regardless of position.
 */
const WIDTH = 150;
const HEIGHT = 48;
const TAB_BAR_H = 80;

export function FloatingMiniRoom() {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { roomId, room, isMinimized, restore, leave, isLocalSpeaking, localMuted } = useRoomSession();
  const pathname = usePathname();

  // Position ref (top-left corner). Initialized just above tab bar, right side.
  const initX = Math.max(spacing.md, screenW - WIDTH - spacing.md);
  const initY = Math.max(insets.top + 20, screenH - insets.bottom - TAB_BAR_H - HEIGHT - spacing.md);
  const pos = useRef(new Animated.ValueXY({ x: initX, y: initY })).current;
  const [dragging, setDragging] = useState(false);

  // Re-clamp when screen size changes (rotation) or safe-area changes.
  useEffect(() => {
    // @ts-ignore accessing __getValue is fine for one-shot clamp
    const cur = { x: (pos.x as any).__getValue?.() ?? initX, y: (pos.y as any).__getValue?.() ?? initY };
    const nx = clamp(cur.x, spacing.sm, screenW - WIDTH - spacing.sm);
    const ny = clamp(cur.y, insets.top + spacing.sm, screenH - insets.bottom - TAB_BAR_H - HEIGHT - spacing.sm);
    pos.setValue({ x: nx, y: ny });
  }, [screenW, screenH, insets.top, insets.bottom, initX, initY, pos]);

  const panResponder = useRef(
    PanResponder.create({
      // Only capture start if this is a real touch on native — on web, the
      // outer PanResponder swallows mouse-clicks intended for the inner
      // Pressable (tap-to-restore / X button), so defer to child handlers
      // and only claim the responder once movement clearly begins.
      onStartShouldSetPanResponder: () => Platform.OS !== "web",
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        setDragging(true);
        // @ts-ignore
        pos.setOffset({ x: (pos.x as any).__getValue?.() ?? 0, y: (pos.y as any).__getValue?.() ?? 0 });
        pos.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pos.flattenOffset();
        // Clamp inside safe viewport
        // @ts-ignore
        const rawX = (pos.x as any).__getValue?.() ?? 0;
        // @ts-ignore
        const rawY = (pos.y as any).__getValue?.() ?? 0;
        // Dock to the nearest LEFT / RIGHT edge — never left mid-screen.
        const nx = rawX + WIDTH / 2 < screenW / 2 ? spacing.sm : screenW - WIDTH - spacing.sm;
        const ny = clamp(rawY, insets.top + spacing.sm, screenH - insets.bottom - TAB_BAR_H - HEIGHT - spacing.sm);
        Animated.spring(pos, { toValue: { x: nx, y: ny }, useNativeDriver: false, friction: 8, tension: 60 }).start();
        setTimeout(() => setDragging(false), 60);
      },
    }),
  ).current;

  if (!roomId || !isMinimized || !room || !MAIN_TABS.has(pathname)) return null;

  const cover = room?.cover_url || "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop";

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { transform: pos.getTranslateTransform() }]}
      testID="mini-room-widget"
      {...panResponder.panHandlers}
    >
      <Pressable
        onPress={() => { if (!dragging) restore(); }}
        style={styles.card}
        testID="mini-room-restore"
      >
        {/* X close on the LEFT (per reference) */}
        <Pressable
          testID="mini-room-close"
          hitSlop={12}
          onPress={leave}
          style={styles.exitBtn}
        >
          <Icon name="close" size={20} color={colors.onSurface} />
        </Pressable>
        {/* Flex spacer so image is pinned to the right */}
        <View style={{ flex: 1 }} />
        {/* Room / avatar preview on the RIGHT (per reference) */}
        <View style={styles.avatarWrap}>
          <Image source={cover} style={styles.avatar} contentFit="cover" />
          {isLocalSpeaking && !localMuted && <View style={styles.speakingRing} />}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    width: WIDTH,
    height: HEIGHT,
  },
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: "#B47CFF",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  avatarWrap: {
    position: "relative",
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    overflow: "hidden",
  },
  avatar: { width: 38, height: 38, borderRadius: 11 },
  speakingRing: {
    position: "absolute", inset: 0, borderRadius: 12,
    borderWidth: 2, borderColor: colors.success,
  },
  exitBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
});
