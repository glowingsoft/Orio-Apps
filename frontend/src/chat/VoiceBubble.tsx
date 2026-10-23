/**
 * Voice message bubble — compact rounded rectangle with chart-like waveform
 * bars. Bar heights come from the REAL volume samples metered while the
 * clip was recorded; bars fill in as playback progresses.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Icon from "@react-native-vector-icons/ionicons";

const BARS = 28;

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
  const player = useAudioPlayer(uri);
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
  return (
    <Pressable onPress={toggle} style={styles.row} testID={testID} hitSlop={6}>
      <View style={[styles.play, { backgroundColor: color + "26" }]}>
        <Icon name={st.playing ? "pause" : "play"} size={16} color={color} />
      </View>
      <View style={styles.wave} testID={testID ? `${testID}-wave` : undefined}>
        {bars.map((h, i) => (
          <View key={i} style={[styles.bar, { height: 4 + h * 20, backgroundColor: color, opacity: i / BARS <= pct && pct > 0 ? 1 : 0.42 }]} />
        ))}
      </View>
      <Text style={[styles.dur, { color }]}>{`${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, "0")}`}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 170 },
  play: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  wave: { flexDirection: "row", alignItems: "center", gap: 2, height: 26 },
  bar: { width: 2.5, borderRadius: 1.5 },
  dur: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
