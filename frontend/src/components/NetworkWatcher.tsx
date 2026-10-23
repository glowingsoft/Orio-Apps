/**
 * Real-time connectivity toasts: weak / lost / restored.
 * Only fires on state CHANGES (never repeats the same state).
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useToast } from "@/src/components/Toast";
import { useI18n } from "@/src/i18n";
import { API_BASE } from "@/src/api";

type NetState = "ok" | "weak" | "offline";
const WEAK_MS = 2500;
const PROBE_EVERY_MS = 30000;

export function NetworkWatcher() {
  const toast = useToast();
  const { t } = useI18n();
  const last = useRef<NetState>("ok");
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let alive = true;
    const apply = (next: NetState) => {
      if (!alive || next === last.current) return;
      const prev = last.current;
      last.current = next;
      if (next === "offline") toast.error(tRef.current.netLost, 3500);
      else if (next === "weak") toast.warning(tRef.current.netWeak, 3000);
      else if (prev === "offline") toast.success(tRef.current.netRestored);
    };

    const probe = async () => {
      if (AppState.currentState !== "active" || last.current === "offline") return;
      const start = Date.now();
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        await fetch(`${API_BASE}/`, { signal: ctrl.signal, cache: "no-store" as any });
        clearTimeout(to);
        apply(Date.now() - start > WEAK_MS ? "weak" : "ok");
      } catch {
        apply("weak");
      }
    };

    const unsub = NetInfo.addEventListener((s) => {
      if (s.isConnected === false || s.isInternetReachable === false) { apply("offline"); return; }
      const gen = (s.details as any)?.cellularGeneration;
      if (gen === "2g") { apply("weak"); return; }
      if (last.current === "offline") apply("ok");
    });
    const iv = setInterval(probe, PROBE_EVERY_MS);
    // Web: browser connectivity events fire instantly (NetInfo web can lag).
    const w: any = typeof window !== "undefined" && (window as any).addEventListener ? window : null;
    const onOff = () => apply("offline");
    const onOn = () => apply("ok");
    if (w) { w.addEventListener("offline", onOff); w.addEventListener("online", onOn); }
    return () => {
      alive = false; unsub(); clearInterval(iv);
      if (w) { w.removeEventListener("offline", onOff); w.removeEventListener("online", onOn); }
    };
  }, [toast]);

  return null;
}
