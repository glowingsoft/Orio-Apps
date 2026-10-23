/**
 * Iter-135 — real presence heartbeat: pings the server every 30s ONLY while
 * the app is in the foreground; marks offline when backgrounded.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import { apiPresencePing } from "@/src/api";
import { useAuth } from "@/src/auth-context";

export function PresenceHeartbeat() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    let iv: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      apiPresencePing().catch(() => {});
      if (!iv) iv = setInterval(() => apiPresencePing().catch(() => {}), 30000);
    };
    const stop = () => { if (iv) { clearInterval(iv); iv = null; } };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (s) => (s === "active" ? start() : stop()));
    return () => { stop(); sub.remove(); };
  }, [user?.id]);
  return null;
}
