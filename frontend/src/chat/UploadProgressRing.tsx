
import { useEffect } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  Easing, SharedValue, useAnimatedProps, useAnimatedReaction, useSharedValue, withSequence, withTiming,
} from "react-native-reanimated";

const SIZE = 56;
const STROKE = 4;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const MIN = 0.03;
const CREEP_MAX = 0.9;
const CREEP_MS = 8000;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedText = Animated.createAnimatedComponent(TextInput);

function creepTo(from: number) {
  "worklet";
  return withTiming(CREEP_MAX, { duration: Math.max(0, CREEP_MS * (1 - from / CREEP_MAX)), easing: Easing.out(Easing.cubic) });
}

// Ring and percentage both run on the UI thread from one shared value, so they
// stay in sync and keep moving while JS is busy encoding / sending the upload.
// `progress` (0..1) is written by the uploader without React re-renders. The
// ring creeps towards 90% on its own (the app gets few real progress events)
// and never moves backwards.
export function UploadProgressRing({ progress }: { progress: SharedValue<number> }) {
  const v = useSharedValue(0);

  useEffect(() => {
    v.set(creepTo(0));
  }, [v]);

  useAnimatedReaction(
    () => progress.get(),
    (target) => {
      if (target >= 1) v.set(withTiming(1, { duration: 250 }));
      else if (target > v.get()) v.set(withSequence(withTiming(target, { duration: 300, easing: Easing.linear }), creepTo(target)));
    },
  );

  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - Math.max(MIN, v.get())) }));
  const textProps = useAnimatedProps(() => ({ text: `${Math.round(v.get() * 100)}%`, defaultValue: "" }) as any);

  return (
    <View style={styles.wrap} testID="upload-progress-ring">
      <Svg width={SIZE} height={SIZE} style={styles.svg}>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(255,255,255,0.3)" strokeWidth={STROKE} fill="none" />
        <AnimatedCircle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          stroke="#FFFFFF" strokeWidth={STROKE} fill="none" strokeLinecap="round"
          strokeDasharray={`${C} ${C}`}
          animatedProps={arcProps}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </Svg>
      <AnimatedText
        editable={false}
        defaultValue="0%"
        underlineColorAndroid="transparent"
        style={styles.pct}
        animatedProps={textProps}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  svg: { position: "absolute" },
  pct: { width: SIZE, padding: 0, margin: 0, textAlign: "center", color: "#FFFFFF", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
