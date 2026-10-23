/**
 * ORIO Speaker Ring (iter-44 Phase 4)
 * ----------------------------------------------------------------------------
 * Three-layer watery white ring that pulses in time with the real audio level
 * supplied by the Agora audio-volume-indication callback. Rendered as an
 * absolutely-positioned overlay around the seat bubble so the avatar/background
 * is NEVER touched or recolored. The animation is a bloom scale + opacity
 * fade on each ring, timed to current audio level so silent speakers get no
 * movement at all (not a fake permanent animation).
 *
 * Usage:
 *   <SeatBubble ...>
 *     <SpeakerRing level={audioLevel01} size={seatSize} />
 *   </SeatBubble>
 *
 * `level` must be 0..1 (0 silent, 1 loudest). Hook callers normalise Agora's
 * raw volume (0..255 on native, 0..100 on web) before passing in.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

export type SpeakerRingProps = {
  /** Normalised audio level 0..1. 0 freezes animation. */
  level: number;
  /** Diameter of the host seat/avatar circle this ring wraps. */
  size: number;
  /** Base color — white per spec. */
  color?: string;
};

export function SpeakerRing({ level, size, color = "#FFFFFF" }: SpeakerRingProps) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Stop any previous loop before starting a new one.
    loopRef.current?.stop();
    if (level <= 0.03) {
      // Fully silent — collapse the rings and do nothing.
      a.setValue(0); b.setValue(0); c.setValue(0);
      return;
    }
    // Loop duration shortens with level (louder = faster waves).
    const dur = Math.max(900, 1600 - level * 1200);
    const makeRing = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: dur,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const l = Animated.parallel([makeRing(a, 0), makeRing(b, dur / 3), makeRing(c, (2 * dur) / 3)]);
    loopRef.current = l;
    l.start();
    return () => { l.stop(); };
  }, [level, a, b, c]);

  // Ring scale travels from 1 → 1.0 + maxScale, maxScale grows with level.
  const maxScale = 0.3 + level * 0.5;  // 0.35..0.8 at full
  const mkStyle = (anim: Animated.Value): any => ({
    transform: [{
      scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + maxScale] }),
    }],
    opacity: anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.55, 0.3, 0] }),
  });
  const half = size / 2;
  // Iter-51 §1 — When the user is NOT speaking, render NOTHING. No permanent
  // ring, no halo, no decorative glow. The ONLY speaking indicator in ORIO is
  // the animated SpeakerRing — and only when the real Agora level crosses
  // the audible threshold.
  if (level <= 0.03) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]} testID="speaker-ring">
      {[a, b, c].map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            {
              position: "absolute",
              width: size,
              height: size,
              borderRadius: half,
              borderWidth: 2.5,
              borderColor: color,
              shadowColor: color,
              shadowOpacity: 0.9,
              shadowRadius: 10 + level * 10,
              shadowOffset: { width: 0, height: 0 },
            },
            mkStyle(anim),
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});

export default SpeakerRing;
