/**
 * Iter-155 — Android/iOS release diagnostics. Native JS exceptions, render
 * crashes and console.error lines are sent to the backend so real-device
 * problems (blank screens etc.) can be diagnosed without ADB. Web is skipped.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";

const URL_ = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/client-errors`;
let sent = 0;
const seen = new Set<string>();
let currentRoute = "";

export function setDiagRoute(r: string) { currentRoute = r; }

export function reportClientError(kind: string, err: any, extra = "") {
  if (Platform.OS === "web" || sent >= 40) return;
  try {
    const message = String(err?.message ?? err ?? "").slice(0, 600);
    const key = `${kind}:${message}`;
    if (!message || seen.has(key)) return;
    seen.add(key);
    sent += 1;
    fetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind, message,
        stack: String(err?.stack ?? "").slice(0, 3000),
        extra: String(extra).slice(0, 2000),
        platform: Platform.OS, os_version: String(Platform.Version),
        app_version: Constants.expoConfig?.version ?? "", route: currentRoute,
      }),
    }).catch(() => {});
  } catch {}
}

export function installDiagnostics() {
  if (Platform.OS === "web") return;
  const EU: any = (globalThis as any).ErrorUtils;
  const prev = EU?.getGlobalHandler?.();
  EU?.setGlobalHandler?.((e: any, isFatal?: boolean) => {
    reportClientError(isFatal ? "fatal" : "js", e);
    prev?.(e, isFatal);
  });
  const origErr = console.error;
  console.error = (...args: any[]) => {
    try {
      const first = args[0];
      reportClientError("console", first instanceof Error ? first : { message: args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)?.slice(0, 200))).join(" ") });
    } catch {}
    origErr(...args);
  };
}
