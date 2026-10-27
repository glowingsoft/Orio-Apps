/**
 * useAgora — ORIO voice-room hook (NATIVE implementation).
 *
 * Responsibilities:
 *   • Fetch App ID from /api/rtc/config (Certificate stays on server).
 *   • Ask for RECORD_AUDIO permission at runtime.
 *   • Fetch a fresh RTC token via /api/rtc/token (server decides publisher/subscriber).
 *   • Join the channel, publish audio when the user occupies a seat, unpublish otherwise.
 *   • Bubble active-speaker + connection events out to callers.
 *   • Auto-renew tokens before expiry, tear down cleanly on unmount / channel change.
 *
 * Never touches the App Certificate. All secrets remain on the backend.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, PermissionsAndroid } from "react-native";
import { attachMusicEngine, handleMixingState, isMusicActive, setMuteReapply, detachMusicEngine } from "@/src/room/musicEngine";
// Type-only: erased at compile time, so this never touches the native module.
// The runtime module is lazy-required below — its own top-level code calls
// into the native side on import, which crashes in Expo Go (unsupported
// there; works fine in a development build).
import type {
  createAgoraRtcEngine as CreateAgoraRtcEngine,
  ChannelProfileType as ChannelProfileTypeT,
  ClientRoleType as ClientRoleTypeT,
  IRtcEngine,
  RtcConnection,
  IRtcEngineEventHandler,
  AudioProfileType as AudioProfileTypeT,
  AudioScenarioType as AudioScenarioTypeT,
  ChannelMediaOptions,
} from "react-native-agora";
import { apiRtcConfig, apiRtcToken } from "../api";
import { isExpoGo } from "@/src/isExpoGo";

let _agora: typeof import("react-native-agora") | null = null;
function loadAgora(): typeof import("react-native-agora") | null {
  if (isExpoGo) return null;
  if (!_agora) _agora = require("react-native-agora");
  return _agora;
}

export type AgoraStatus =
  | "idle"
  | "requesting-permission"
  | "no-permission"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "disabled" // backend does not have Agora keys configured
  | "error";

export type AgoraSpeakerState = { uid: number; volume: number };

export type UseAgoraOptions = {
  roomId: string | null;
  wantPublisher: boolean;
  localMuted: boolean;
  numericUid: number;
  enabled?: boolean;
  /**
   * When true, mute ALL remote audio playback ("Mute Room"). The publisher
   * side is unaffected — we keep publishing (if seated) so other users still
   * hear us; only local playback of remote audio is silenced. Client-side.
   */
  roomMuted?: boolean;
};

export type UseAgoraReturn = {
  status: AgoraStatus;
  error?: string;
  activeSpeakers: AgoraSpeakerState[];
  remoteAudioLevels: Record<number, number>;
  isLocalSpeaking: boolean;
};

const TOKEN_RENEW_MARGIN_S = 60; // renew a minute before expiry

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS === "android") {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Microphone Permission",
        message: "Yazeen needs access to your microphone to join voice rooms.",
        buttonPositive: "OK",
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  // iOS: the Agora SDK triggers the OS permission prompt on joinChannel.
  return true;
}

export function useAgora({ roomId, wantPublisher, localMuted, numericUid, enabled = true, roomMuted = false }: UseAgoraOptions): UseAgoraReturn {
  const [status, setStatus] = useState<AgoraStatus>("idle");
  const [error, setError] = useState<string | undefined>();
  const [activeSpeakers, setActiveSpeakers] = useState<AgoraSpeakerState[]>([]);
  const [remoteAudioLevels, setRemoteAudioLevels] = useState<Record<number, number>>({});
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);

  const engineRef = useRef<IRtcEngine | null>(null);
  const joinedChannelRef = useRef<string | null>(null);
  const roleRef = useRef<"publisher" | "subscriber" | null>(null);
  const levelSigRef = useRef<string>("");
  const renewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teardownRef = useRef<() => Promise<void>>(async () => {});

  const channel = useMemo(() => (roomId ? `orio_${roomId}` : null), [roomId]);

  const renewToken = useCallback(async () => {
    const ch = joinedChannelRef.current;
    if (!ch || !engineRef.current) return;
    try {
      const t = await apiRtcToken(ch, numericUid);
      engineRef.current.renewToken(t.token);
      if (t.expires_at) {
        const secs = Math.max(30, t.expires_at - Math.floor(Date.now() / 1000) - TOKEN_RENEW_MARGIN_S);
        if (renewTimerRef.current) clearTimeout(renewTimerRef.current);
        renewTimerRef.current = setTimeout(() => { renewToken(); }, secs * 1000);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to renew token");
    }
  }, [numericUid]);

  // Set up event handler + engine lifecycle
  useEffect(() => {
    if (!enabled || !channel) return;

    let cancelled = false;
    const start = async () => {
      try {
        // Expo Go can't load the native Agora module — voice rooms need a
        // development build there; everything else in the app still works.
        const agora = loadAgora();
        if (!agora) {
          if (!cancelled) setStatus("disabled");
          return;
        }
        const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType, AudioProfileType, AudioScenarioType } = agora;
        // 1) Backend has Agora configured?
        const cfg = await apiRtcConfig();
        if (!cfg.enabled || !cfg.app_id) {
          if (!cancelled) setStatus("disabled");
          return;
        }
        // 2) Mic permission (Android)
        if (!cancelled) setStatus("requesting-permission");
        const ok = await ensureMicPermission();
        if (!ok) {
          if (!cancelled) setStatus("no-permission");
          return;
        }
        if (cancelled) return;
        setStatus("connecting");

        // 3) Init engine (once per session)
        if (!engineRef.current) {
          const engine = createAgoraRtcEngine();
          attachMusicEngine(engine);
          engine.initialize({
            appId: cfg.app_id,
            channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
          });
          // Voice-room tuning: speech-optimised profile (lower bitrate → far
          // fewer jitter-buffer stalls on mobile networks) + chatroom scenario
          // (hardware AEC, fast mic hand-over), AI noise suppression and
          // 3A processing for clear voices.
          engine.setAudioProfile(
            AudioProfileType.AudioProfileDefault,
            AudioScenarioType.AudioScenarioChatroom
          );
          engine.enableAudio();
          try { (engine as any).setAINSMode?.(true, 0); } catch {}
          try {
            engine.setParameters('{"che.audio.aec.enable":true}');
            engine.setParameters('{"che.audio.ans.enable":true}');
            engine.setParameters('{"che.audio.agc.enable":true}');
          } catch {}
          engine.enableAudioVolumeIndication(400, 3, true);

          const handler: IRtcEngineEventHandler = {
            onJoinChannelSuccess: () => { if (!cancelled) setStatus("connected"); },
            onAudioMixingStateChanged: (state: number, reason: number) => handleMixingState(state, reason),
            onConnectionStateChanged: (_c: RtcConnection, state: number) => {
              // 1 disconnected, 2 connecting, 3 connected, 4 reconnecting, 5 failed
              if (cancelled) return;
              if (state === 3) setStatus("connected");
              else if (state === 4) setStatus("reconnecting");
              else if (state === 5) setStatus("error");
              else if (state === 1) setStatus("disconnected");
            },
            onError: (err: number, msg: string) => {
              if (cancelled) return;
              setError(`Agora error ${err}: ${msg}`);
              setStatus("error");
            },
            onTokenPrivilegeWillExpire: () => { renewToken(); },
            onRequestToken: () => { renewToken(); },
            onAudioVolumeIndication: (
              _conn: RtcConnection,
              speakers: { uid: number; volume: number }[],
              _speakerNumber: number,
              _totalVolume: number,
            ) => {
              if (cancelled) return;
              // Quantise volumes and only push state when something visibly
              // changed — avoids re-rendering the whole room ~3×/s which
              // starved the JS thread and caused audible UI-induced hiccups.
              const list = speakers?.map((s) => ({ uid: s.uid, volume: Math.round(s.volume / 32) * 32 })) || [];
              const sig = list.map((s) => `${s.uid}:${s.volume}`).join(",");
              if (sig === levelSigRef.current) return;
              levelSigRef.current = sig;
              setActiveSpeakers(list);
              const localS = list.find((s) => s.uid === 0);
              setIsLocalSpeaking(!!localS && localS.volume > 5);
              const levels: Record<number, number> = {};
              for (const s of list) if (s.uid !== 0) levels[s.uid] = s.volume;
              setRemoteAudioLevels(levels);
            },
          };
          engine.registerEventHandler(handler);
          engineRef.current = engine;
        }

        // 4) Fetch token + join
        const role = wantPublisher ? "publisher" : "subscriber";
        roleRef.current = role;
        const tok = await apiRtcToken(channel, numericUid);
        engineRef.current.setClientRole(
          role === "publisher" ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience
        );
        engineRef.current.joinChannel(tok.token, channel, numericUid, {
          publishMicrophoneTrack: role === "publisher" && !localMuted,
          autoSubscribeAudio: true,
          // Listeners get ultra-low-latency delivery (≈ real-time voice).
          audienceLatencyLevel: 2,
          clientRoleType:
            role === "publisher" ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience,
        });
        joinedChannelRef.current = channel;

        // Schedule renewal
        if (tok.expires_at) {
          const secs = Math.max(30, tok.expires_at - Math.floor(Date.now() / 1000) - TOKEN_RENEW_MARGIN_S);
          if (renewTimerRef.current) clearTimeout(renewTimerRef.current);
          renewTimerRef.current = setTimeout(() => { renewToken(); }, secs * 1000);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Voice init failed");
        setStatus("error");
      }
    };

    teardownRef.current = async () => {
      try {
        if (renewTimerRef.current) { clearTimeout(renewTimerRef.current); renewTimerRef.current = null; }
        if (engineRef.current && joinedChannelRef.current) {
          engineRef.current.leaveChannel();
        }
        joinedChannelRef.current = null;
      } catch {}
    };

    start();

    return () => {
      cancelled = true;
      teardownRef.current().catch(() => {});
    };
    // Re-run when the channel or enabled flag changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, enabled]);

  // React to seat/publisher role changes without re-joining.
  // Also update the channel media options + local audio publish state so that a
  // user who joined the channel as a subscriber can start publishing the moment
  // they occupy a mic (and vice-versa) WITHOUT leaving/rejoining.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !joinedChannelRef.current) return;
    const agora = loadAgora();
    if (!agora) return;
    const { ClientRoleType } = agora;
    const nextRole = wantPublisher ? "publisher" : "subscriber";
    const roleChanged = roleRef.current !== nextRole;
    if (roleChanged) {
      try {
        engine.setClientRole(
          nextRole === "publisher" ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience
        );
      } catch {}
    }
    try {
      // Actually gate microphone publishing on the SDK side — critical for
      // real multi-user voice: when 5 people occupy mics, each of them
      // becomes an active publisher, and every other participant (mic or
      // listener) auto-subscribes to all of them.
      const opts: ChannelMediaOptions = {
        publishMicrophoneTrack: wantPublisher && !localMuted,
        autoSubscribeAudio: true,
        clientRoleType:
          nextRole === "publisher"
            ? ClientRoleType.ClientRoleBroadcaster
            : ClientRoleType.ClientRoleAudience,
      };
      (engine as any).updateChannelMediaOptions?.(opts);
    } catch {}
    try {
      // Belt & suspenders — SDKs differ slightly in behaviour between
      // setClientRole + updateChannelMediaOptions. Directly toggling the
      // local mic track guarantees the audio stream flips correctly.
      // Only (re)start capture when the role actually flips — restarting
      // the mic on every mute toggle caused audible drop-outs.
      if (roleChanged) engine.enableLocalAudio(wantPublisher);
      applyMute();
    } catch {}
    roleRef.current = nextRole;
  }, [wantPublisher, localMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mic mute vs. room music: while the DJ's music is mixing, keep the stream
  // published but silence the microphone signal (music keeps broadcasting).
  function applyMute() {
    const engine = engineRef.current as any;
    if (!engine) return;
    try {
      if (isMusicActive() && wantPublisher) {
        engine.muteLocalAudioStream(false);
        engine.adjustRecordingSignalVolume(localMuted ? 0 : 100);
      } else {
        engine.adjustRecordingSignalVolume(100);
        engine.muteLocalAudioStream(!wantPublisher || localMuted);
      }
    } catch {}
  }
  useEffect(() => { setMuteReapply(applyMute); return () => setMuteReapply(null); }); // latest closure

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        if (engineRef.current) {
          engineRef.current.leaveChannel();
          engineRef.current.unregisterEventHandler({});
          detachMusicEngine();
          engineRef.current.release();
          engineRef.current = null;
        }
      } catch {}
    };
  }, []);

  // "Mute Room" — silence all remote audio playback locally without dropping
  // Agora, and without affecting our own publisher. Reactive to prop changes.
  useEffect(() => {
    if (!engineRef.current || !joinedChannelRef.current) return;
    try {
      // Native + Web IRtcEngine both expose these — swallow if unavailable.
      const eng: any = engineRef.current;
      if (typeof eng.muteAllRemoteAudioStreams === "function") {
        eng.muteAllRemoteAudioStreams(!!roomMuted);
      } else if (typeof eng.adjustPlaybackSignalVolume === "function") {
        eng.adjustPlaybackSignalVolume(roomMuted ? 0 : 100);
      }
    } catch {}
  }, [roomMuted]);

  return { status, error, activeSpeakers, remoteAudioLevels, isLocalSpeaking };
}
