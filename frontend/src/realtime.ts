/**
 * Single app-wide realtime socket (/api/ws/global). The server pushes small
 * events (dm_update, call_update, luxury_gift…); screens react to them instead
 * of polling. Polling stays only as a slow fallback while the socket is down.
 */
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { getAccessToken } from "@/src/api";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const ACTIVE_EVERY_MS = 10_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export type RealtimeEvent = { type: string; [k: string]: any };
type Handler = (ev: RealtimeEvent) => void;

const handlers = new Set<Handler>();
const statusListeners = new Set<() => void>();
let connected = false;
let userId: string | null = null;
let ws: WebSocket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = BACKOFF_MIN_MS;
let hadConnection = false;
let appSub: { remove: () => void } | null = null;

function setConnected(v: boolean) {
  if (connected === v) return;
  connected = v;
  statusListeners.forEach((l) => l());
}

function emit(ev: RealtimeEvent) {
  handlers.forEach((h) => { try { h(ev); } catch {} });
}

function sendActive() {
  try {
    if (ws && ws.readyState === 1) ws.send(AppState.currentState === "active" ? "active" : "ping");
  } catch {}
}

function clearTimers() {
  if (timer) { clearInterval(timer); timer = null; }
  if (retry) { clearTimeout(retry); retry = null; }
}

function open() {
  if (!userId || ws) return;
  const token = getAccessToken();
  if (!token) { retry = setTimeout(open, 3000); return; }
  const sock = new WebSocket(`${BACKEND.replace(/^http/i, "ws")}/api/ws/global?token=${encodeURIComponent(token)}`);
  ws = sock;
  sock.onopen = () => {
    backoff = BACKOFF_MIN_MS;
    setConnected(true);
    sendActive();
    if (timer) clearInterval(timer);
    timer = setInterval(sendActive, ACTIVE_EVERY_MS);
    // Events may have been missed while offline → let listeners resync once.
    if (hadConnection) emit({ type: "reconnected" });
    hadConnection = true;
  };
  sock.onmessage = (e) => {
    try {
      const m = JSON.parse(String(e.data));
      if (m && typeof m.type === "string") emit(m);
    } catch {}
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    setConnected(false);
    if (timer) { clearInterval(timer); timer = null; }
    if (userId) {
      retry = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  };
  sock.onerror = () => { try { sock.close(); } catch {} };
}

export function startRealtime(uid: string) {
  if (userId === uid) return;
  stopRealtime();
  userId = uid;
  hadConnection = false;
  backoff = BACKOFF_MIN_MS;
  open();
  appSub = AppState.addEventListener("change", (s) => {
    if (s !== "active" || !userId) return;
    if (ws && ws.readyState === 1) { sendActive(); return; }
    if (retry) { clearTimeout(retry); retry = null; }
    backoff = BACKOFF_MIN_MS;
    open();
  });
}

export function stopRealtime() {
  userId = null;
  clearTimers();
  appSub?.remove();
  appSub = null;
  const s = ws;
  ws = null;
  try { s?.close(); } catch {}
  setConnected(false);
}

export function onRealtime(h: Handler): () => void {
  handlers.add(h);
  return () => { handlers.delete(h); };
}

export function isRealtimeConnected() { return connected; }

export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    (cb) => { statusListeners.add(cb); return () => { statusListeners.delete(cb); }; },
    () => connected,
    () => false,
  );
}

/** refetchInterval helper: slow safety net when the socket is up, faster when down. */
export function pollMs(isConnected: boolean, whenUp: number | false, whenDown: number): number | false {
  return isConnected ? whenUp : whenDown;
}
