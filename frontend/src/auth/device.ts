/**
 * Iter-118 — stable per-install device identifier, sent as X-Device-Id on
 * every API call (used for device bans). Limitation: an app reinstall or
 * clearing browser storage produces a new id; hardware IDs are not exposed
 * to apps on modern iOS/Android, so device bans are best-effort.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "orio_device_id";
let cached: string | null = null;

function gen() {
  const r = () => Math.random().toString(36).slice(2, 10);
  return `${Platform.OS}-${Date.now().toString(36)}-${r()}${r()}`;
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    if (Platform.OS === "web") {
      cached = localStorage.getItem(KEY);
      if (!cached) { cached = gen(); localStorage.setItem(KEY, cached); }
    } else {
      cached = await SecureStore.getItemAsync(KEY);
      if (!cached) { cached = gen(); await SecureStore.setItemAsync(KEY, cached); }
    }
  } catch {
    cached = cached || gen();
  }
  return cached!;
}

// ---- global ban signal (server returns 403 {detail:{code:"BANNED"}}) ----
export type BanInfo = { message: string; permanent: boolean; expires_at: string | null; server_now: string; receivedAt: number };
type L = (b: BanInfo | null) => void;
const listeners = new Set<L>();
let current: BanInfo | null = null;
export function emitBan(b: BanInfo | null) { current = b; listeners.forEach((l) => l(b)); }
export function onBan(l: L) { listeners.add(l); l(current); return () => { listeners.delete(l); }; }
