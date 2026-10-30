import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getAccessToken } from "../api";

export type RoomEvent =
  | { type: "room_state"; room: any }
  | { type: "chat"; user: any; text: string; at: string }
  | { type: "user_joined"; user: any; present: any[] }
  | { type: "user_left"; user_id: string; present: any[] }
  | { type: "voice_state"; user_id: string; muted: boolean; speaking: boolean }
  | { type: "envelope_created"; envelope: any }
  | { type: "envelope_claimed"; env_id: string; user: any; amount: number; slots_remaining: number }
  | { type: "system"; kind: string; user?: any; user_id?: string; nickname?: string; text?: string; seat_index?: number; num_seats?: number; at: string }
  | { type: "content_blocked"; code?: string }
  | { type: "room_closed"; by?: any; at: string }
  | { type: "chat_cleared"; by?: any; at: string }
  | { type: "pong"; at: string };

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

function wsUrl(roomId: string, token: string) {
  const base = BACKEND.replace(/^http/i, "ws");
  return `${base}/api/ws/rooms/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`;
}

export function useRoomWs(roomId: string | null, onEvent: (e: RoomEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<any>(null);
  const backoffRef = useRef<number>(1000);
  const stoppedRef = useRef<boolean>(false);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (!roomId) return;
    const token = getAccessToken();
    if (!token) return;
    stoppedRef.current = false;
    try {
      const ws = new WebSocket(wsUrl(roomId, token));
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
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
      ws.onclose = () => {
        setConnected(false);
        if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
        if (!stoppedRef.current) {
          const delay = Math.min(backoffRef.current, 15000);
          backoffRef.current = Math.min(delay * 2, 15000);
          setTimeout(() => connect(), delay);
        }
      };
      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    } catch {
      setConnected(false);
    }
  }, [roomId, onEvent]);

  useEffect(() => {
    connect();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && !connected) connect();
    });
    return () => {
      stoppedRef.current = true;
      sub.remove();
      if (pingRef.current) clearInterval(pingRef.current);
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const send = useCallback((msg: any) => {
    try { wsRef.current?.send(JSON.stringify(msg)); } catch {}
  }, []);

  return { connected, send };
}
