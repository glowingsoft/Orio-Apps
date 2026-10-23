/**
 * Iter-137 — premium PUSH-TO-TALK voice messages.
 * Press & hold → record (after permission + session init) · release → stop,
 * upload, send · slide away (>70px) / interruption / app background → cancel
 * (discarded) · < 1s → discarded · 30s hard cap → auto-send.
 * Upload failure keeps the clip and offers Retry (never marked as sent).
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, AppState, Linking, ActivityIndicator } from "react-native";
import { useAudioRecorder, useAudioRecorderState, RecordingPresets, AudioModule, setAudioModeAsync } from "expo-audio";
import Icon from "@react-native-vector-icons/ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, radius } from "@/src/theme";

const MAX_MS = 30_000;
const MIN_MS = 1_000;
const CANCEL_PX = 70;

export function HoldToTalkMic({ ar, onSend }: { ar: boolean; onSend: (uri: string, seconds: number, waveform?: number[]) => Promise<void> }) {
  // Metering on → real input level (dBFS) sampled every 100 ms for the waveform.
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const rs = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<"idle" | "recording" | "sending" | "failed">("idle");
  const levels = useRef<number[]>([]);
  useEffect(() => {
    if (phase !== "recording" || typeof rs.metering !== "number") return;
    // dBFS (-60..0) → 0..1
    levels.current.push(Math.max(0, Math.min(1, (rs.metering + 60) / 60)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs.metering, rs.durationMillis]);
  const packWave = () => {
    const src = levels.current;
    if (!src.length) return undefined;
    const n = Math.min(48, src.length);
    return Array.from({ length: n }, (_, i) => {
      const seg = src.slice(Math.floor((i * src.length) / n), Math.max(Math.floor((i * src.length) / n) + 1, Math.floor(((i + 1) * src.length) / n)));
      return Math.round(Math.max(...seg) * 1000) / 1000;
    });
  };
  const [cancelArmed, setCancelArmed] = useState(false);
  const [note, setNote] = useState<{ text: string; settings?: boolean } | null>(null);
  const failed = useRef<{ uri: string; secs: number; wave?: number[] } | null>(null);
  const holding = useRef(false);
  const busy = useRef(false); // prevents overlapping recordings / duplicate sends
  const start = useRef({ x: 0, y: 0 });
  const cancelRef = useRef(false);

  const send = async (uri: string, secs: number, wave?: number[]) => {
    setPhase("sending");
    try {
      await onSend(uri, secs, wave);
      failed.current = null;
      setPhase("idle");
    } catch {
      failed.current = { uri, secs, wave };
      setPhase("failed");
    } finally { busy.current = false; }
  };

  const finish = async (mode: "send" | "cancel") => {
    if (!recorder.isRecording && phase !== "recording") { busy.current = false; return; }
    const ms = Math.min(MAX_MS, rs.durationMillis || 0);
    try { await recorder.stop(); } catch {}
    try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch {}
    setCancelArmed(false);
    const uri = recorder.uri;
    if (mode === "cancel" || !uri) { setPhase("idle"); busy.current = false; if (mode === "cancel") setNote({ text: ar ? "تم إلغاء التسجيل" : "Recording cancelled" }); return; }
    if (ms < MIN_MS) { setPhase("idle"); busy.current = false; setNote({ text: ar ? "اضغط مطولًا للتسجيل" : "Hold to record" }); return; }
    await send(uri, Math.max(1, Math.round(ms / 1000)), packWave());
  };

  const begin = async () => {
    if (busy.current) return;
    busy.current = true;
    setNote(null);
    try {
      const cur = await AudioModule.getRecordingPermissionsAsync();
      if (!cur.granted) {
        // Ask contextually; recording starts on the NEXT hold once granted.
        const r = cur.canAskAgain !== false ? await AudioModule.requestRecordingPermissionsAsync() : cur;
        busy.current = false;
        if (!r.granted) setNote({ text: ar ? "يلزم إذن الميكروفون لإرسال الرسائل الصوتية" : "Microphone access is needed for voice messages", settings: r.canAskAgain === false });
        else setNote({ text: ar ? "اضغط مطولًا للتسجيل" : "Hold to record" });
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!holding.current) { busy.current = false; return; } // released during init → nothing sent
      levels.current = [];
      recorder.record();
      setPhase("recording");
    } catch {
      busy.current = false;
      setPhase("idle");
      setNote({ text: ar ? "تعذّر بدء التسجيل" : "Couldn't start recording" });
    }
  };

  // 30-second cap → auto stop & send.
  useEffect(() => {
    if (phase === "recording" && (rs.durationMillis || 0) >= MAX_MS) { holding.current = false; finish("send"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs.durationMillis, phase]);

  // App backgrounding = interruption → discard.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active" && holding.current) { holding.current = false; finish("cancel"); } });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const secs = Math.floor((rs.durationMillis || 0) / 1000);
  return (
    <View style={styles.wrap}>
      {phase === "recording" && (
        <View style={[styles.pill, cancelArmed && styles.pillCancel]} testID="ptt-recording">
          <View style={styles.dot} />
          <Text style={styles.pillText}>{`0:${String(secs).padStart(2, "0")}`}</Text>
          <Text style={styles.pillHint}>{cancelArmed ? (ar ? "أفلت للإلغاء" : "Release to cancel") : (ar ? "أفلت للإرسال · اسحب بعيدًا للإلغاء" : "Release to send · slide away to cancel")}</Text>
        </View>
      )}
      {phase === "sending" && (
        <View style={styles.pill} testID="ptt-sending"><ActivityIndicator size="small" color={colors.brandPrimary} /><Text style={styles.pillHint}>{ar ? "جارٍ إرسال الرسالة الصوتية…" : "Sending voice message…"}</Text></View>
      )}
      {phase === "failed" && (
        <View style={[styles.pill, styles.pillCancel]} testID="ptt-failed">
          <Icon name="alert-circle" size={16} color={colors.error} />
          <Text style={styles.pillHint}>{ar ? "فشل الإرسال" : "Failed to send"}</Text>
          <Pressable testID="ptt-retry" onPress={() => { const f = failed.current; if (f && !busy.current) { busy.current = true; send(f.uri, f.secs, f.wave); } }} hitSlop={8}>
            <Text style={styles.link}>{ar ? "إعادة المحاولة" : "Retry"}</Text>
          </Pressable>
          <Pressable testID="ptt-discard" onPress={() => { failed.current = null; setPhase("idle"); }} hitSlop={8}>
            <Icon name="close" size={16} color={colors.muted} />
          </Pressable>
        </View>
      )}
      {phase === "idle" && note && (
        <View style={styles.pill} testID="ptt-note">
          <Text style={styles.pillHint}>{note.text}</Text>
          {note.settings && <Pressable testID="ptt-open-settings" onPress={() => Linking.openSettings()} hitSlop={8}><Text style={styles.link}>{ar ? "فتح الإعدادات" : "Open Settings"}</Text></Pressable>}
        </View>
      )}
      <View
        testID="chat-tool-voice"
        accessibilityRole="button"
        accessibilityLabel={ar ? "اضغط مطولًا للتسجيل" : "Hold to record"}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          holding.current = true; cancelRef.current = false;
          start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
          begin();
        }}
        onResponderMove={(e) => {
          const dx = e.nativeEvent.pageX - start.current.x, dy = e.nativeEvent.pageY - start.current.y;
          const far = Math.hypot(dx, dy) > CANCEL_PX;
          if (far !== cancelRef.current) { cancelRef.current = far; setCancelArmed(far); }
        }}
        onResponderRelease={() => { holding.current = false; finish(cancelRef.current ? "cancel" : "send"); }}
        onResponderTerminate={() => { holding.current = false; finish("cancel"); }}
        style={styles.btnHit}
      >
        <LinearGradient
          colors={phase === "recording" ? [colors.error, "#FF7A6E"] : [colors.brandPrimary, "#C59BFF"]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.btn, phase === "recording" && styles.btnActive]}
        >
          <Icon name="mic" size={20} color="#FFFFFF" />
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-end" },
  btnHit: { width: 48, height: 44, alignItems: "center", justifyContent: "center" },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowColor: colors.brandPrimary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  btnActive: { transform: [{ scale: 1.18 }] },
  pill: {
    position: "absolute", bottom: 52, end: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, height: 36,
    borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4, maxWidth: 300, justifyContent: "center",
  },
  pillCancel: { borderColor: colors.error },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  pillText: { color: colors.onSurface, fontWeight: "800", fontVariant: ["tabular-nums"] },
  pillHint: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  link: { color: colors.brandPrimary, fontWeight: "800", fontSize: 12 },
});
