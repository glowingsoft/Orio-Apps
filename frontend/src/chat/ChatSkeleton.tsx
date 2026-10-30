
import React, { useEffect, useState } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";
import { colors, spacing, radius } from "@/src/theme";

const ROWS: [boolean, number, number][] = [
  [false, 55, 36], [true, 40, 36], [true, 62, 52], [false, 70, 36],
  [false, 45, 36], [true, 58, 36], [false, 50, 52], [true, 35, 36],
];

export function ChatSkeleton() {
  const [pulse] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.root, { opacity: pulse }]} pointerEvents="none" testID="chat-skeleton">
      {ROWS.map(([mine, w, h], i) => (
        <View
          key={i}
          style={[
            styles.bubble,
            { width: `${w}%`, height: h },
            mine ? styles.mine : styles.theirs,
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end", padding: spacing.md, gap: spacing.md, overflow: "hidden" },
  bubble: { borderRadius: radius.lg },
  mine: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary + "33", borderBottomEndRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderBottomStartRadius: 4, borderWidth: 0.5, borderColor: colors.border },
});
