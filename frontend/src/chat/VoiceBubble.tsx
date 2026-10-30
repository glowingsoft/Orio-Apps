/**
 * Voice message bubble — compact rounded rectangle with chart-like waveform
 * bars. Bar heights come from the REAL volume samples metered while the
 * clip was recorded; bars fill in as playback progresses.

 */
import React from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Icon from "@react-native-vector-icons/ionicons";

const BARS = 28;
const BAR_W = 2.5;
const BAR_GAP = 2;
const WAVE_W = BARS * BAR_W + (BARS - 1) * BAR_GAP;

function resample(src: number[] | null | undefined): number[] {
  if (!src || !src.length) return Array.from({ length: BARS }, () => 0.15);
  return Array.from({ length: BARS }, (_, i) => {
    const a = Math.floor((i * src.length) / BARS), b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / BARS));
    const seg = src.slice(a, b);
    return Math.max(0.08, Math.min(1, seg.reduce((x, y) => Math.max(x, y), 0)));
  });
}

export function VoiceBubble({ uri, duration, waveform, color, testID }: {
  uri: string; duration?: number | null; waveform?: number[] | null; color: string; testID?: string;
}) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const st = useAudioPlayerStatus(player);
  const total = Math.round(duration || st.duration || 0);
  const bars = React.useMemo(() => resample(waveform), [waveform]);
  const toggle = () => {
    if (st.playing) { player.pause(); return; }
    if (st.didJustFinish || (st.duration && st.currentTime >= st.duration - 0.1)) player.seekTo(0);
    player.play();
  };
  const pct = st.duration ? Math.min(1, st.currentTime / st.duration) : 0;
  const shown = st.playing || pct > 0 ? Math.round(pct * total) : total;

  const [fill] = React.useState(() => new Animated.Value(0));
  const anchor = React.useRef<{ from: number; at: number } | null>(null);
  React.useEffect(() => {
    const dur = st.duration || 0;
    if (!st.playing || !dur) {
      fill.stopAnimation();
      fill.setValue(pct * WAVE_W);
      anchor.current = null;
      return;
    }
    // While playing, only re-sync when the real position drifts from the animation
    // (start, seek, buffering); otherwise let the linear animation run untouched.
    const a = anchor.current;
    if (a && Math.abs(a.from + (Date.now() - a.at) / 1000 - st.currentTime) < 0.35) return;
    anchor.current = { from: st.currentTime, at: Date.now() };
    fill.stopAnimation();
    fill.setValue(pct * WAVE_W);
    Animated.timing(fill, {
      toValue: WAVE_W, duration: Math.max(0, (dur - st.currentTime) * 1000), easing: Easing.linear, useNativeDriver: false,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.playing, st.currentTime, st.duration]);

  const renderBars = (opacity: number) => bars.map((h, i) => (
    <View key={i} style={[styles.bar, { height: 4 + h * 20, backgroundColor: color, opacity }]} />
  ));

  return (
    <Pressable onPress={toggle} style={styles.row} testID={testID} hitSlop={6}>
      <View style={[styles.play, { backgroundColor: color + "26" }]}>
        <Icon name={st.playing ? "pause" : "play"} size={16} color={color} />
      </View>
      <View style={styles.wave} testID={testID ? `${testID}-wave` : undefined}>
        {renderBars(0.42)}
        <Animated.View style={[styles.fill, { width: fill }]} pointerEvents="none">
          <View style={[styles.wave, { width: WAVE_W }]}>{renderBars(1)}</View>
        </Animated.View>
      </View>
      <Text style={[styles.dur, { color }]}>{`${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, "0")}`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 170 },
  play: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  wave: { flexDirection: "row", alignItems: "center", gap: BAR_GAP, height: 26, width: WAVE_W },
  fill: { position: "absolute", start: 0, top: 0, bottom: 0, overflow: "hidden" },
  bar: { width: BAR_W, borderRadius: 1.5 },
  dur: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
