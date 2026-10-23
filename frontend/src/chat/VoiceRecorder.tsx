/**
 * Iter-134 — voice recorder (max 30s): record → stop → preview playback →
 * send or cancel. Permission flow: check → ask (if allowed) → Open Settings.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking, ActivityIndicator } from "react-native";
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets, AudioModule, setAudioModeAsync,
  useAudioPlayer, useAudioPlayerStatus,
} from "expo-audio";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, spacing, radius } from "@/src/theme";

export const VOICE_MAX_MS = 30_000;

export function VoiceRecorder({ ar, onSend, onClose }: {
  ar: boolean; onSend: (uri: string, seconds: number) => Promise<void>; onClose: () => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rs = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<"idle" | "recording" | "review" | "denied" | "blocked" | "sending">("idle");
  const [uri, setUri] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const stopping = useRef(false);
  const preview = useAudioPlayer(uri ?? undefined);
  const ps = useAudioPlayerStatus(preview);

  const start = async () => {
    const cur = await AudioModule.getRecordingPermissionsAsync();
    let ok = cur.granted;
    if (!ok && cur.canAskAgain !== false) {
      const r = await AudioModule.requestRecordingPermissionsAsync();
      ok = r.granted;
      if (!ok) { setPhase(r.canAskAgain === false ? "blocked" : "denied"); return; }
    } else if (!ok) { setPhase("blocked"); return; }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    stopping.current = false;
    setPhase("recording");
  };

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    const ms = Math.min(VOICE_MAX_MS, rs.durationMillis || 0);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setSecs(Math.max(1, Math.round(ms / 1000)));
    setUri(recorder.uri);
    setPhase("review");
  };

  // Hard 30-second cap.
  useEffect(() => {
    if (phase === "recording" && (rs.durationMillis || 0) >= VOICE_MAX_MS) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs.durationMillis, phase]);

  useEffect(() => () => { if (recorder.isRecording) recorder.stop().catch(() => {}); }, [recorder]);

  const cancel = async () => {
    if (phase === "recording") { stopping.current = true; try { await recorder.stop(); } catch {} }
    try { preview.pause(); } catch {}
    onClose();
  };
  const send = async () => {
    if (!uri) return;
    setPhase("sending");
    try { preview.pause(); } catch {}
    try { await onSend(uri, secs); onClose(); } catch { setPhase("review"); }
  };

  const elapsed = Math.floor((rs.durationMillis || 0) / 1000);
  return (
    <View style={styles.wrap} testID="voice-recorder">
      {phase === "idle" && (
        <Pressable testID="voice-start" onPress={start} style={styles.main}>
          <Icon name="mic" size={20} color={colors.onBrandPrimary} />
          <Text style={styles.mainText}>{ar ? "اضغط لبدء التسجيل (30 ث كحد أقصى)" : "Tap to record (max 30s)"}</Text>
        </Pressable>
      )}
      {phase === "recording" && (
        <View style={styles.row}>
          <View style={styles.dot} />
          <Text style={styles.timer} testID="voice-timer">{`0:${String(elapsed).padStart(2, "0")} / 0:30`}</Text>
          <View style={{ flex: 1 }} />
          <Pressable testID="voice-stop" onPress={stop} style={styles.stopBtn}><Icon name="stop" size={18} color="#FFFFFF" /></Pressable>
        </View>
      )}
      {(phase === "review" || phase === "sending") && (
        <View style={styles.row}>
          <Pressable testID="voice-preview" onPress={() => { if (ps.playing) preview.pause(); else { preview.seekTo(0); preview.play(); } }} style={styles.iconBtn}>
            <Icon name={ps.playing ? "pause" : "play"} size={18} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.timer}>{`0:${String(secs).padStart(2, "0")}`}</Text>
          <View style={{ flex: 1 }} />
          <Pressable testID="voice-send" disabled={phase === "sending"} onPress={send} style={styles.sendBtn}>
            {phase === "sending" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="send" size={16} color={colors.onBrandPrimary} />}
          </Pressable>
        </View>
      )}
      {(phase === "denied" || phase === "blocked") && (
        <View style={styles.row}>
          <Text style={[styles.timer, { flex: 1 }]}>{ar ? "يلزم إذن الميكروفون لتسجيل الرسائل الصوتية" : "Microphone access is needed to record voice messages"}</Text>
          {phase === "denied" ? (
            <Pressable onPress={start} style={styles.linkBtn}><Text style={styles.link}>{ar ? "السماح" : "Allow"}</Text></Pressable>
          ) : (
            <Pressable testID="voice-open-settings" onPress={() => Linking.openSettings()} style={styles.linkBtn}><Text style={styles.link}>{ar ? "فتح الإعدادات" : "Open Settings"}</Text></Pressable>
          )}
        </View>
      )}
      <Pressable testID="voice-cancel" onPress={cancel} style={styles.cancel} hitSlop={8}>
        <Icon name="close" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, marginHorizontal: spacing.md, marginTop: spacing.sm },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderRadius: radius.pill, backgroundColor: colors.gold, paddingHorizontal: spacing.md, justifyContent: "center" },
  mainText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 13 },
  row: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error },
  timer: { color: colors.onSurface, fontWeight: "700", fontSize: 13, fontVariant: ["tabular-nums"] },
  stopBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  link: { color: colors.gold, fontWeight: "800" },
  cancel: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
