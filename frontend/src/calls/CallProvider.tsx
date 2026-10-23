/**
 * Iter-134 — one-to-one voice calls: incoming ringing, accept/reject,
 * outgoing ringing/cancel, in-call mic + speaker controls, hang-up, cleanup.
 * The backend is the source of truth (status pushed via the realtime socket,
 * polled every 2s only while a call is active) and enforces
 * the "no calls while inside a voice room" rule.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, PanResponder, Animated, useWindowDimensions, AppState } from "react-native";
import { Image } from "expo-image";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import Icon from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiCallAccept, apiCallCurrent, apiCallEnd, apiCallStart, apiCallToken, CallInfo, CallRtc } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { useRoomSession } from "@/src/room/RoomSession";
import { colors, spacing } from "@/src/theme";
import { VipName } from "@/src/components/VipName";
import { joinCall, leaveCall, renewCallToken, setCallMuted, setCallSpeaker } from "@/src/calls/callEngine";
import { isRealtimeConnected, onRealtime } from "@/src/realtime";

export const CALL_IN_ROOM_AR = "لا يمكنك إجراء مكالمة خاصة أثناء وجودك داخل غرفة صوتية.";
export const CALL_IN_ROOM_EN = "You cannot make a private call while inside a voice room.";
export const CALLEE_IN_ROOM_AR = "لا يمكن الاتصال بهذا المستخدم لأنه داخل غرفة صوتية حاليًا.";
export const CALLEE_IN_ROOM_EN = "This user is currently in a voice room and cannot receive private calls.";

type Ctx = { startCall: (peerId: string) => Promise<void>; active: boolean };
const CallCtx = createContext<Ctx>({ startCall: async () => {}, active: false });
export const useCalls = () => useContext(CallCtx);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const toast = useToast();
  const session = useRoomSession();
  const [call, setCall] = useState<CallInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const tickRef = useRef<() => void>(() => {});
  const rtcRef = useRef<CallRtc | null>(null);
  const joinedRef = useRef<string | null>(null);
  const callRef = useRef<CallInfo | null>(null);
  useEffect(() => { callRef.current = call; }, [call]);
  const ring = useAudioPlayer(require("../../assets/sounds/ringtone.wav"));

  const blockedMsg = ar ? CALL_IN_ROOM_AR : CALL_IN_ROOM_EN;
  const calleeMsg = ar ? CALLEE_IN_ROOM_AR : CALLEE_IN_ROOM_EN;
  const roomMsg = (m: string) => (m.includes("CALLEE_IN_ROOM") ? calleeMsg : m.includes("CALLER_IN_ROOM") ? blockedMsg : null);

  const cleanup = useCallback(() => {
    console.trace("[call] cleanup()");
    leaveCall();
    joinedRef.current = null;
    rtcRef.current = null;
    setMuted(false); setSpeaker(false); setElapsed(0); setMinimized(false);
    setCall(null);
  }, []);

  const join = useCallback(async (c: CallInfo, rtc: CallRtc) => {
    if (joinedRef.current === c.id) return;
    joinedRef.current = c.id;
    try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }); } catch {}
    await joinCall(rtc, {
      onPeerJoined: () => {},
      // Peer dropped from the RTC channel → re-check the server right away.
      onPeerLeft: () => tickRef.current(),
      onError: (m) => {
        if (m === "mic") toast.show({ kind: "error", message: ar ? "يلزم إذن الميكروفون للمكالمة" : "Microphone permission is required for calls" });
        else toast.show({ kind: "error", message: (ar ? "تعذّر الاتصال الصوتي: " : "Voice connection failed: ") + m });
      },
      onTokenWillExpire: async () => { try { const t = await apiCallToken(c.id); renewCallToken(t.token); } catch {} },
    });
  }, [ar, toast]);

  // Server-authoritative polling (ringing, accepted, ended by the peer).
  useEffect(() => {
    if (!user?.id) return;
    let stop = false;
    const tick = async () => {
      // Presence: only poll (= heartbeat that lets calls ring) while ORIO is in
      // the foreground; an ongoing call keeps syncing in the background.
      if (AppState.currentState !== "active" && !callRef.current) return;
      try {
        const { call: srv, last } = await apiCallCurrent() as any;
        if (stop) return;
        const local = callRef.current;
        if (!srv) {
          if (local) {
            cleanup();
            // Tell this side why the call ended (peer rejected / joined a voice room / no answer).
            if (last && last.id === local.id && !last.ended_by_me) {
              toast.show({ kind: "info", message:
                last.end_reason === "joined_room" ? (ar ? "انتهت المكالمة: دخل المستخدم الآخر غرفة صوتية" : "Call ended: the other user joined a voice room")
                : last.status === "rejected" ? (ar ? "تم رفض المكالمة" : "Call declined")
                : last.status === "missed" ? (ar ? "لم يتم الرد" : "No answer")
                : (ar ? "انتهت المكالمة" : "Call ended") });
            }
          }
          return;
        }
        if (local && local.id !== srv.id) cleanup();
        setCall(srv);
        if (srv.status === "accepted" && rtcRef.current && joinedRef.current !== srv.id) join(srv, rtcRef.current);
      } catch {}
    };
    tickRef.current = tick;
    tick();
    // Calls are pushed over the realtime socket; poll fast only while a call is
    // in progress (ring timeout / peer-left detection), slowly otherwise.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const delay = callRef.current ? 2000 : isRealtimeConnected() ? 30_000 : 1500;
      timer = setTimeout(async () => { await tick(); if (!stop) schedule(); }, delay);
    };
    schedule();
    const off = onRealtime((ev) => {
      if (ev.type !== "call_update" && ev.type !== "reconnected") return;
      if (timer) clearTimeout(timer);
      tick().finally(() => { if (!stop) schedule(); });
    });
    return () => { stop = true; if (timer) clearTimeout(timer); off(); };
  }, [user?.id, cleanup, join]);

  // Entering a voice room terminates the private call (server also enforces it).
  useEffect(() => {
    const c = callRef.current;
    if (session.roomId && c) { cleanup(); apiCallEnd(c.id).catch(() => {}); }
  }, [session.roomId, cleanup]);

  // Ringtone while ringing (incoming ring / outgoing ringback).
  const ringing = call?.status === "ringing";
  useEffect(() => {
    try {
      const p: any = ring;
      if (ringing) { p.loop = true; p.volume = call?.direction === "incoming" ? 1 : 0.35; p.seekTo(0); p.play(); }
      else ring.pause();
    } catch {}
  }, [ringing, call?.direction, ring]);

  // Call timer.
  useEffect(() => {
    if (call?.status !== "accepted") return;
    const start = call.accepted_at ? new Date(call.accepted_at).getTime() : Date.now();
    const iv = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000))), 1000);
    return () => clearInterval(iv);
  }, [call?.status, call?.accepted_at]);

  const startCall = useCallback(async (peerId: string) => {
    if (session.roomId) { toast.show({ kind: "error", message: blockedMsg }); return; }
    if (callRef.current) return;
    try {
      const r = await apiCallStart(peerId);
      rtcRef.current = r.rtc;
      setCall(r.call);
    } catch (e: any) {
      const m = String(e?.message || "");
      toast.show({
        kind: "error",
        message: roomMsg(m) ? roomMsg(m)!
          : m.includes("CALL_BUSY") ? (ar ? "المستخدم في مكالمة أخرى" : "User is busy on another call")
          : m.includes("CALLEE_UNAVAILABLE") ? (ar ? "لا يوجد رد — المستخدم غير متصل بالتطبيق حاليًا" : "No Answer — the user isn't in ORIO right now")
          : (ar ? "تعذّر بدء المكالمة" : "Could not start the call"),
      });
    }
  }, [session.roomId, blockedMsg, ar, toast]);

  const accept = async () => {
    if (!call) return;
    try {
      const r = await apiCallAccept(call.id);
      rtcRef.current = r.rtc;
      setCall(r.call);
      join(r.call, r.rtc);
    } catch (e: any) {
      const m = String(e?.message || "");
      toast.show({ kind: "error", message: roomMsg(m) || (ar ? "انتهت المكالمة" : "Call ended") });
      cleanup();
    }
  };
  const hangup = async () => {
    const c = callRef.current;
    cleanup();
    if (c) { try { await apiCallEnd(c.id); } catch {} }
  };

  return (
    <CallCtx.Provider value={{ startCall, active: !!call }}>
      {children}
      {call && minimized && call.status === "accepted" && (
        <MiniCall call={call} elapsed={elapsed} muted={muted} onExpand={() => setMinimized(false)} onHangup={hangup} />
      )}
      {call && !(minimized && call.status === "accepted") && (
        <CallScreen call={call} ar={ar} muted={muted} speaker={speaker} elapsed={elapsed}
          onAccept={accept} onHangup={hangup} onMinimize={() => setMinimized(true)}
          onMute={() => { setCallMuted(!muted); setMuted(!muted); }}
          onSpeaker={() => { setCallSpeaker(!speaker); setSpeaker(!speaker); }} />
      )}
    </CallCtx.Provider>
  );
}

function fmt(s: number) { return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

/** Floating mini call window — draggable, stays above every ORIO screen. */
function MiniCall({ call, elapsed, muted, onExpand, onHangup }: {
  call: CallInfo; elapsed: number; muted: boolean; onExpand: () => void; onHangup: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
    onPanResponderGrant: () => { pos.extractOffset(); },
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => { pos.flattenOffset(); },
  })).current;
  return (
    <Animated.View
      {...pan.panHandlers}
      style={[styles.mini, { top: insets.top + 60, maxWidth: width - 24, transform: pos.getTranslateTransform() }]}
      testID="call-mini"
    >
      <Pressable onPress={onExpand} style={styles.miniMain} testID="call-mini-expand">
        {call.peer.avatar_url
          ? <Image source={call.peer.avatar_url} style={styles.miniAvatar} contentFit="cover" />
          : <View style={[styles.miniAvatar, { backgroundColor: colors.surfaceTertiary }]} />}
        <View>
          <VipName style={styles.miniName} numberOfLines={1} name={call.peer.nickname || "ORIO"} color={(call.peer as any).name_color} vipLevel={(call.peer as any).vip_level} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name={muted ? "mic-off" : "mic"} size={11} color={colors.success} />
            <Text style={styles.miniTime} testID="call-mini-time">{fmt(elapsed)}</Text>
          </View>
        </View>
      </Pressable>
      <Pressable onPress={onHangup} style={styles.miniHang} testID="call-mini-hangup" hitSlop={6}>
        <Icon name="call" size={16} color="#FFFFFF" style={{ transform: [{ rotate: "135deg" }] }} />
      </Pressable>
    </Animated.View>
  );
}

function CallScreen({ call, ar, muted, speaker, elapsed, onAccept, onHangup, onMute, onSpeaker, onMinimize }: {
  call: CallInfo; ar: boolean; muted: boolean; speaker: boolean; elapsed: number;
  onAccept: () => void; onHangup: () => void; onMute: () => void; onSpeaker: () => void; onMinimize: () => void;
}) {
  const insets = useSafeAreaInsets();
  const incoming = call.direction === "incoming" && call.status === "ringing";
  const status = call.status === "accepted" ? fmt(elapsed)
    : incoming ? (ar ? "مكالمة صوتية واردة…" : "Incoming voice call…")
    : (ar ? "جارٍ الاتصال…" : "Calling…");
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onHangup} statusBarTranslucent>
      <View style={[styles.wrap, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]} testID="call-screen">
        {call.status === "accepted" && (
          <Pressable onPress={onMinimize} style={[styles.minBtn, { top: insets.top + spacing.sm }]} testID="call-minimize" hitSlop={8}
            accessibilityLabel={ar ? "تصغير المكالمة" : "Minimize call"}>
            <Icon name="contract" size={22} color={colors.onSurface} />
          </Pressable>
        )}
        <View style={styles.center}>
          <View style={styles.avatarRing}>
            {call.peer.avatar_url
              ? <Image source={call.peer.avatar_url} style={styles.avatar} contentFit="cover" />
              : <View style={[styles.avatar, { backgroundColor: colors.surfaceTertiary }]} />}
          </View>
          <VipName style={styles.name} numberOfLines={1} testID="call-peer-name" name={call.peer.nickname || "ORIO"} color={(call.peer as any).name_color} vipLevel={(call.peer as any).vip_level} />
          <Text style={styles.status} testID="call-status">{status}</Text>
        </View>
        {incoming ? (
          <View style={styles.row}>
            <Pressable testID="call-reject" onPress={onHangup} style={[styles.bigBtn, { backgroundColor: colors.error }]}>
              <Icon name="call" size={28} color="#FFFFFF" style={{ transform: [{ rotate: "135deg" }] }} />
            </Pressable>
            <Pressable testID="call-accept" onPress={onAccept} style={[styles.bigBtn, { backgroundColor: colors.success }]}>
              <Icon name="call" size={28} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.row}>
            {call.status === "accepted" && (
              <Pressable testID="call-mute" onPress={onMute} style={[styles.smallBtn, muted && styles.smallOn]}>
                <Icon name={muted ? "mic-off" : "mic"} size={24} color={muted ? "#FFFFFF" : colors.onSurface} />
              </Pressable>
            )}
            <Pressable testID="call-hangup" onPress={onHangup} style={[styles.bigBtn, { backgroundColor: colors.error }]}>
              <Icon name="call" size={28} color="#FFFFFF" style={{ transform: [{ rotate: "135deg" }] }} />
            </Pressable>
            {call.status === "accepted" && (
              <Pressable testID="call-speaker" onPress={onSpeaker} style={[styles.smallBtn, speaker && styles.smallOn]}>
                <Icon name={speaker ? "volume-high" : "volume-medium"} size={24} color={speaker ? "#FFFFFF" : colors.onSurface} />
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surface, justifyContent: "space-between", alignItems: "center" },
  center: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xxl },
  avatarRing: { padding: 4, borderRadius: 72, borderWidth: 2, borderColor: colors.gold },
  avatar: { width: 128, height: 128, borderRadius: 64 },
  name: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: spacing.md, maxWidth: 280 },
  status: { color: colors.muted, fontSize: 15, fontWeight: "600" },
  minBtn: { position: "absolute", start: spacing.lg, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  mini: { position: "absolute", end: 12, zIndex: 9999, elevation: 30, flexDirection: "row", alignItems: "center", gap: 10, paddingStart: 6, paddingEnd: 6, height: 56, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  miniMain: { flexDirection: "row", alignItems: "center", gap: 8 },
  miniAvatar: { width: 44, height: 44, borderRadius: 22 },
  miniName: { color: colors.onSurface, fontSize: 13, fontWeight: "800", maxWidth: 110 },
  miniTime: { color: colors.success, fontSize: 12, fontWeight: "800" },
  miniHang: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 40 },
  bigBtn: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  smallBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  smallOn: { backgroundColor: colors.brandPrimary },
});
