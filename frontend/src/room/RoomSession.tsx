/**
 * RoomSession — global provider that owns the ORIO room session so it survives
 * navigation. When the user "minimizes" the room, we navigate away but keep
 * the WebSocket + Agora publisher connected here. A FloatingMiniRoom is rendered
 * automatically whenever the user is off the /room/[id] screen.
 */
import { queryClient } from "@/src/query-client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  apiGetRoom,
  apiTaskHeartbeat,
  apiJoinRoom,
  apiLeaveRoom,
  getAccessToken,
} from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { musicPlay, musicPause, musicStop, musicVolume, onMusicEnded, currentUri } from "./musicEngine";
import { apiMusicControl, apiMusicState } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useAgora } from "@/src/hooks/useAgora";
import { RoomEvent } from "@/src/hooks/useRoomWs";
import { emitContentBlocked, emitChatRejected } from "@/src/room/contentBlocked";
import { requestRoomUnlock } from "@/src/room/RoomLockGate";
import { prefetchEntrances } from "@/src/entrance/effects";

// Deterministic 32-bit unsigned uid from a MongoDB ObjectId
export function uidFromObjectId(id: string | undefined | null): number {
  if (!id) return 1;
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h) ^ id.charCodeAt(i);
  return (h >>> 0) % 2_000_000_000 + 1;
}

export type ChatEntry =
  | { id: string; kind: "chat"; nickname: string; avatar_url?: string; vip_level?: number; wealth_level?: number; charm_level?: number; text: string; at: string; user_id?: string; is_new?: boolean }
  | { id: string; kind: "system"; text: string; at: string; user_id?: string; nickname?: string; welcome_msg?: string; owner?: any }
  | { id: string; kind: "gift"; nickname: string; text: string; at: string; user_id?: string; vip_level?: number }
  | { id: string; kind: "reaction"; nickname: string; emoji: string; text: string; at: string; user_id?: string; vip_level?: number; avatar_url?: string; wealth_level?: number; charm_level?: number };

type Ctx = {
  roomId: string | null;
  room: any | null;
  chat: ChatEntry[];
  wsConnected: boolean;
  isMinimized: boolean;
  voiceStatus: string;
  isLocalSpeaking: boolean;
  remoteAudioLevels: Record<number, number>;
  participants: any[];
  roomMuted: boolean;
  setRoomMuted: (v: boolean) => void;
  // Iter-34: pending mic invite (targeted at ME).
  pendingMicInvite: {
    seat_index: number;
    inviter: { id: string; nickname?: string; avatar_url?: string; vip_level?: number };
    expires_at: number;
  } | null;
  clearPendingMicInvite: () => void;
  // Iter-131 — equipped VIP entrance to play (set ONLY by a real room join).
  entrance: { key: number; effect: string; user: any } | null;
  clearEntrance: () => void;
  // Batch B — latest gift animation event (room-synchronized via gift_batch).
  giftFx: import("./GiftFxOverlay").GiftFxEvent | null;
  // Batch B — emoji reactions: seat overlays (5s) + sender.
  seatReactions: Record<number, { emoji: string; id: string }>;
  sendReaction: (emoji: string) => boolean;
  // Batch C — synchronized room music state (server-authoritative).
  music: any | null;
  setMusic: (m: any) => void;
  // Actions
  enter: (roomId: string) => void;
  minimize: () => void;
  restore: () => void;
  leave: () => Promise<void>;
  sendChat: (text: string) => void;
  pushSystem: (text: string) => void;
  pushGift: (nickname: string, vip_level: number, text: string) => void;
  clearChat: () => void;
  refreshRoom: () => Promise<void>;
  setLocalMuted: (muted: boolean) => void;
  wantPublisher: boolean;
  setWantPublisher: (v: boolean) => void;
  localMuted: boolean;
};

const RoomSessionCtx = createContext<Ctx | null>(null);

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

function wsUrl(roomId: string, token: string) {
  const base = BACKEND.replace(/^http/i, "ws");
  return `${base}/api/ws/rooms/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`;
}

export function RoomSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isRTL } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<any | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [wantPublisher, setWantPublisher] = useState(false);
  const [localMuted, setLocalMutedState] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [roomMuted, setRoomMutedState] = useState(false);
  const [pendingMicInvite, setPendingMicInvite] = useState<Ctx["pendingMicInvite"]>(null);
  const [entrance, setEntrance] = useState<Ctx["entrance"]>(null);
  const [giftFx, setGiftFx] = useState<Ctx["giftFx"]>(null);
  const [seatReactions, setSeatReactions] = useState<Ctx["seatReactions"]>({});
  const [music, setMusic] = useState<any | null>(null);
  // DJ driver: this device plays (and broadcasts via Agora mixing) only when it is the DJ.
  useEffect(() => {
    const me = user?.id;
    const m = music;
    if (!m || !me || m.dj_id !== me) { if (currentUri()) musicStop(); return; }
    const tr = m.queue?.[m.index];
    const uri = tr?.url || (tr?.owner_id === me ? tr?.local_uri : null);
    const iAmFullMuted = (room?.full_muted_users || []).includes(me);
    if (m.playing && uri && !iAmFullMuted) musicPlay(uri, m.volume ?? 80);
    else musicPause();
  }, [music?.rev, music?.playing, music?.index, music?.dj_id, user?.id, (room?.full_muted_users || []).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (music) musicVolume(music.volume ?? 80); }, [music?.volume]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onMusicEnded(() => { if (roomIdRef.current) apiMusicControl(roomIdRef.current, "ended").then(setMusic).catch(() => {}); });
    return () => onMusicEnded(null);
  }, []);
  const roomIdRef = useRef<string | null>(null);
  const reactionTimers = useRef<Record<number, any>>({});
  const lastReactionSent = useRef(0);
  const entranceSeen = useRef<Record<string, number>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<any>(null);
  const backoffRef = useRef<number>(1000);
  const stoppedRef = useRef(false);
  const joinedRef = useRef(false);

  // Agora publisher/subscriber for this session (global — persists across nav)
  const numericUid = useMemo(() => uidFromObjectId(user?.id), [user?.id]);
  const voice = useAgora({
    roomId,
    wantPublisher,
    localMuted,
    numericUid,
    enabled: !!roomId,
    roomMuted,
  });

  const pushChat = useCallback((entry: ChatEntry) => {
    setChat((prev) => {
      // Dedup — prevents replay-on-reconnect and double subscription issues
      if (prev.some((p) => p.id === entry.id)) return prev;
      return [...prev.slice(-199), entry];
    });
  }, []);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    setWsConnected(false);
    setRoomId(null);
    roomIdRef.current = null;
    setMusic(null);
    musicStop();
    setRoom(null);
    setChat([]);
    setIsMinimized(false);
    setWantPublisher(false);
    setLocalMutedState(false);
    setParticipants([]);
    setRoomMutedState(false);
    setPendingMicInvite(null);
    setGiftFx(null);
    joinedRef.current = false;
  }, []);

  // Sync my seat presence to `wantPublisher`. Full mute (profile card) forces the
  // mic off regardless of the voice-only toggle.
  const fullMuted = !!user?.id && (room?.full_muted_users || []).includes(user.id);
  useEffect(() => {
    if (!room || !user?.id) return;
    const mySeat = room.seats?.find((s: any) => s.user?.id === user.id);
    setWantPublisher(!!mySeat);
    if (mySeat) setLocalMutedState(!!mySeat.muted || fullMuted);
  }, [room, user?.id, fullMuted]);
  // Minimized → dismiss any active gift animation immediately.
  const minimizedRef = useRef(false);
  useEffect(() => { minimizedRef.current = isMinimized; if (isMinimized) setGiftFx(null); }, [isMinimized]);

  // Iter-117 — daily-task minute tracking (server verifies presence + seat).
  useEffect(() => {
    if (!roomId || !user?.id) return;
    const h = setInterval(() => { apiTaskHeartbeat(roomId).catch(() => {}); }, 60_000);
    return () => clearInterval(h);
  }, [roomId, user?.id]);

  // Bubble voice state
  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    try {
      wsRef.current.send(JSON.stringify({
        type: "voice_state",
        muted: localMuted || !wantPublisher,
        speaking: voice.isLocalSpeaking,
      }));
    } catch {}
  }, [wantPublisher, localMuted, voice.isLocalSpeaking]);

  // Handle WS events
  const onEvent = useCallback((evt: RoomEvent) => {
    if (evt.type === "room_state") {
      setRoom(evt.room);
      qc.setQueryData(["room", evt.room?.id], evt.room);
    } else if (evt.type === "chat") {
      const ev: any = evt;
      pushChat({
        id: ev.id ? `chat-${ev.id}` : `chat-${evt.at}-${evt.user?.id ?? "sys"}-${(evt.text || "").slice(0, 30)}`,
        kind: "chat",
        nickname: evt.user?.nickname || "User",
        avatar_url: evt.user?.avatar_url,
        vip_level: evt.user?.vip_level,
        wealth_level: evt.user?.wealth_level,
        charm_level: evt.user?.charm_level,
        age: (evt.user as any)?.age,
        text: evt.text,
        image_url: ev.kind === "image" ? ev.media_url : undefined,
        at: evt.at,
        user_id: evt.user?.id,
        // Iter-49 — server-authoritative "جديد" flag.
        is_new: !!evt.user?.is_new,
      } as any);
    } else if (evt.type === "user_joined") {
      if (Array.isArray((evt as any).present)) setParticipants((evt as any).present);
      // Iter-131 — equipped VIP entrance; ignore socket reconnect replays (90s per user).
      const fxKey = (evt.user as any)?.entrance_effect;
      if (fxKey && evt.user?.id) {
        // Server includes entrance_effect ONLY on a genuine new /join (claimed
        // once). Short local guard against duplicate socket deliveries.
        const last = entranceSeen.current[evt.user.id] || 0;
        if (Date.now() - last > 5_000) {
          entranceSeen.current[evt.user.id] = Date.now();
          setEntrance({ key: Date.now(), effect: fxKey, user: evt.user });
        }
      }
      // De-dup on self join
      if (evt.user?.id !== user?.id) {
        pushChat({
          id: `sys-join-${evt.user?.id}`,
          kind: "system",
          text: `${evt.user?.nickname || "Someone"} joined the room`,
          at: new Date().toISOString(),
          user_id: evt.user?.id,
          nickname: evt.user?.nickname,
          vip_level: (evt.user as any)?.vip_level,
          join: true,
        } as any);
      }
    } else if ((evt as any).type === "chat_rejected") {
      // Server refused: muted from chat / room chat muted (owner+mods only).
      emitChatRejected(String((evt as any).code || ""));
    } else if (evt.type === "content_blocked") {
      // Iter-135 — server rejected the chat line (never stored / broadcast).
      emitContentBlocked();
    } else if (evt.type === "user_left") {
      if (Array.isArray((evt as any).present)) setParticipants((evt as any).present);
      // no chat noise for anonymous leaves — presence panel already reflects the change
    } else if (evt.type === "system") {
      const name = (evt as any).nickname || evt.user?.nickname || "Someone";
      const actorId = (evt as any).user_id || evt.user?.id;
      let text = "";
      let stableId: string | null = null;
      // Mic seat actions (take / leave / move / mute / lock) are SILENT in chat —
      // they show only through the seats' own UI state.
      if (evt.kind === "welcome") {
        text = evt.text || "";
        // Only ONE welcome per joiner per session, even on reconnect / duplicate broadcasts.
        stableId = `sys-welcome-${actorId || "anon"}`;
      }
      else text = "";
      if (text) {
        pushChat({
          id: stableId ?? `sys-${evt.kind}-${evt.at}`,
          kind: "system",
          text,
          at: evt.at,
          user_id: actorId,
          nickname: name,
          welcome_msg: (evt as any).welcome_msg,
          owner: (evt as any).owner,
        });
      }
    } else if (evt.type === "room_closed") {
      pushChat({
        id: `sys-closed-${evt.at}`,
        kind: "system",
        text: `Room closed by ${evt.by?.nickname || "host"}`,
        at: evt.at,
      });
      // Tear down after a beat and return home
      setTimeout(() => {
        cleanup();
        router.replace("/(tabs)/home");
      }, 1200);
    } else if ((evt as any).type === "reaction") {
      const e: any = evt;
      if (typeof e.seat_index === "number") {
        const idx = e.seat_index as number;
        setSeatReactions((m) => ({ ...m, [idx]: { emoji: e.emoji, id: e.id } }));
        if (reactionTimers.current[idx]) clearTimeout(reactionTimers.current[idx]);
        reactionTimers.current[idx] = setTimeout(() => {
          setSeatReactions((m) => {
            if (m[idx]?.id !== e.id) return m;
            const n = { ...m }; delete n[idx]; return n;
          });
        }, 5000);
      } else {
        pushChat({
          id: `reaction-${e.id}`, kind: "reaction", emoji: e.emoji, text: "",
          nickname: e.user?.nickname || "User", user_id: e.user?.id, vip_level: e.user?.vip_level,
          avatar_url: e.user?.avatar_url, wealth_level: e.user?.wealth_level, charm_level: e.user?.charm_level, at: e.at,
        } as any);
      }
    } else if ((evt as any).type === "music_state") {
      setMusic((evt as any).music);
    } else if ((evt as any).type === "gift_batch") {
      const e: any = evt;
      // Never queue animations while the room is minimized (no replay on return).
      if (e.gift?.id && !minimizedRef.current) setGiftFx({ key: `${e.combo_id}-${e.at}`, gift: e.gift, sender: e.sender, quantity: e.quantity });
      pushChat({ id: `gift-${e.combo_id}-${e.at}`, kind: "gift", nickname: e.sender?.nickname || "User", user_id: e.sender?.id,
        vip_level: e.sender?.vip_level ?? 0, avatar_url: e.sender?.avatar_url, wealth_level: e.sender?.wealth_level, charm_level: e.sender?.charm_level,
        age: e.sender?.age, recipients: e.recipients || [], gift: e.gift, quantity: e.quantity ?? 1,
        text: `${e.gift?.name ?? ""} ×${e.quantity ?? 1}`, at: e.at } as any);
    } else if ((evt as any).type === "room_badges") {
      // Iter-122 — verified gift changed room-only Trophy/Star totals → refetch for every viewer.
      queryClient.invalidateQueries({ queryKey: ["room-support-badges", roomId] });
    } else if (evt.type === "chat_cleared") {
      setChat([{
        id: `sys-cleared-${evt.at}`,
        kind: "system",
        text: `Chat cleared by ${evt.by?.nickname || "host"}`,
        at: evt.at,
      }]);
    } else if ((evt as any).type === "mic_invite_request") {
      // Iter-34: targeted invite. Every socket receives it; only render the
      // modal on the intended recipient's client.
      const e: any = evt;
      if (e.target?.id === user?.id) {
        const ttl = Math.max(5, Number(e.expires_in_s || 60));
        setPendingMicInvite({
          seat_index: Number(e.seat_index ?? -1),
          inviter: e.inviter || {},
          expires_at: Date.now() + ttl * 1000,
        });
      }
    } else if ((evt as any).type === "mic_invite_rejected") {
      // If a stale invite happens to still be showing for me (shouldn't), clear it.
      const e: any = evt;
      if (e.target?.id === user?.id) setPendingMicInvite(null);
    }
  }, [pushChat, qc, router, user?.id, cleanup]);

  const connectWs = useCallback((rid: string) => {
    const token = getAccessToken();
    if (!token) return;
    stoppedRef.current = false;
    try {
      const ws = new WebSocket(wsUrl(rid, token));
      wsRef.current = ws;
      ws.onopen = () => {
        setWsConnected(true);
        backoffRef.current = 1000;
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = setInterval(() => {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
        }, 20000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          onEvent(msg as RoomEvent);
        } catch {}
      };
      ws.onclose = (ev: any) => {
        setWsConnected(false);
        if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
        if (ev?.code === 4403) {
          // Server refused: locked room and no valid entry grant.
          stoppedRef.current = true;
          cleanup();
          router.replace("/(tabs)/home" as any);
          requestRoomUnlock({ id: rid });
          return;
        }
        if (!stoppedRef.current && roomId === rid) {
          const delay = Math.min(backoffRef.current, 15000);
          backoffRef.current = Math.min(delay * 2, 15000);
          setTimeout(() => connectWs(rid), delay);
        }
      };
      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    } catch {
      setWsConnected(false);
    }
  }, [onEvent, roomId, cleanup, router]);

  const enter = useCallback((rid: string) => {
    // If entering the same room that's already active, just clear minimized state.
    if (rid === roomId) {
      setIsMinimized(false);
      return;
    }
    // If switching rooms, tear down the old session first.
    if (roomId && roomId !== rid) {
      cleanup();
    }
    setRoomId(rid);
    roomIdRef.current = rid;
    apiMusicState(rid).then(setMusic).catch(() => {});
    setChat([{
      id: "sys-notice-" + rid,
      kind: "system",
      notice: true,
      text: "",
      at: new Date().toISOString(),
    } as any]);
    setIsMinimized(false);
    // Register listener + fetch initial state
    // Room state + join run in parallel (fast entry); the socket opens right
    // after the server-side join so the access grant / chat cutoff exist.
    (async () => {
      const roomP = apiGetRoom(rid).then((r) => { if (r) setRoom(r); return r; }).catch(() => null);
      if (!joinedRef.current) {
        joinedRef.current = true;
        try {
          await apiJoinRoom(rid);
        } catch (e: any) {
          const m = String(e?.message || "");
          if (/locked|password|too many/i.test(m)) {
            // Locked room without a verified code → back out and ask for it.
            const r: any = await roomP;
            cleanup();
            router.replace("/(tabs)/home" as any);
            requestRoomUnlock({ id: rid, name: r?.name });
            return;
          }
        }
      }
      connectWs(rid);
    })();
  }, [roomId, cleanup, connectWs, router]);

  const leave = useCallback(async () => {
    const rid = roomId;
    cleanup();
    if (rid) await apiLeaveRoom(rid).catch(() => {});
  }, [roomId, cleanup]);

  const minimize = useCallback(() => setIsMinimized(true), []);
  const restore = useCallback(() => {
    setIsMinimized(false);
    if (roomId) router.push(`/room/${roomId}`);
  }, [roomId, router]);

  const sendChat = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    if (wsRef.current && wsRef.current.readyState === 1) {
      try { wsRef.current.send(JSON.stringify({ type: "chat", text: t })); } catch {}
    }
  }, []);

  // Returns false when throttled (client-side mirror of the 2.5s server cooldown).
  const sendReaction = useCallback((emoji: string) => {
    if (Date.now() - lastReactionSent.current < 2500) return false;
    if (!wsRef.current || wsRef.current.readyState !== 1) return false;
    lastReactionSent.current = Date.now();
    try { wsRef.current.send(JSON.stringify({ type: "reaction", emoji })); } catch { return false; }
    return true;
  }, []);

  const pushSystem = useCallback((text: string) => {
    pushChat({ id: `sys-local-${Date.now()}`, kind: "system", text, at: new Date().toISOString() });
  }, [pushChat]);

  const pushGift = useCallback((nickname: string, vip_level: number, text: string) => {
    pushChat({ id: `gift-${Date.now()}`, kind: "gift", nickname, vip_level, text, at: new Date().toISOString() });
  }, [pushChat]);

  const clearChat = useCallback(() => setChat([]), []);

  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      const r = await apiGetRoom(roomId);
      setRoom(r);
    } catch {}
  }, [roomId]);

  const setLocalMuted = useCallback((m: boolean) => setLocalMutedState(m), []);

  // AppState hook — reconnect WS if app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && roomId && !wsConnected) connectWs(roomId);
    });
    return () => sub.remove();
  }, [connectWs, roomId, wsConnected]);

  // If we deep-linked / refreshed into a room, the access token may load AFTER
  // RoomSession mounted. Whenever the user becomes available and we have a
  // roomId without an open socket, retry the connect.
  useEffect(() => {
    if (!roomId) return;
    if (wsConnected) return;
    if (!user?.id) return;
    if (!getAccessToken()) return;
    connectWs(roomId);
  }, [user?.id, roomId, wsConnected, connectWs]);

  // Auto-minimize when navigating away from /room/[id]
  const inRoomScreen = pathname?.startsWith("/room/") ?? false;
  useEffect(() => {
    if (roomId && !inRoomScreen && !isMinimized) setIsMinimized(true);
    if (roomId && inRoomScreen && isMinimized) setIsMinimized(false);
  }, [roomId, inRoomScreen, isMinimized]);

  // Iter-34: auto-expire a pending mic invite locally when the TTL passes.
  useEffect(() => {
    if (!pendingMicInvite) return;
    const ms = Math.max(500, pendingMicInvite.expires_at - Date.now());
    const t = setTimeout(() => setPendingMicInvite(null), ms);
    return () => clearTimeout(t);
  }, [pendingMicInvite]);

  const clearPendingMicInvite = useCallback(() => setPendingMicInvite(null), []);
  const clearEntrance = useCallback(() => setEntrance(null), []);
  // Warm entrance media once per app session → instant playback on join.
  useEffect(() => { if (user?.id) prefetchEntrances(); }, [user?.id]);

  const value: Ctx = {
    entrance,
    clearEntrance,
    giftFx,
    seatReactions,
    sendReaction,
    music,
    setMusic,
    roomId,
    room,
    chat,
    wsConnected,
    isMinimized,
    voiceStatus: voice.status,
    isLocalSpeaking: voice.isLocalSpeaking,
    remoteAudioLevels: voice.remoteAudioLevels ?? {},
    participants,
    roomMuted,
    setRoomMuted: setRoomMutedState,
    pendingMicInvite,
    clearPendingMicInvite,
    enter,
    minimize,
    restore,
    leave,
    sendChat,
    pushSystem,
    pushGift,
    clearChat,
    refreshRoom,
    setLocalMuted,
    wantPublisher,
    setWantPublisher,
    localMuted,
  };

  return <RoomSessionCtx.Provider value={value}>{children}</RoomSessionCtx.Provider>;
}

export function useRoomSession(): Ctx {
  const c = useContext(RoomSessionCtx);
  if (!c) throw new Error("useRoomSession must be used inside RoomSessionProvider");
  return c;
}
