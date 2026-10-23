/**
 * Iter-91 — Synchronous RTL bootstrap.
 *
 * React Native Web compiles StyleSheet.create() styles into atomic CSS classes
 * AT MODULE LOAD TIME, using the current value of `I18nManager.isRTL`. If we
 * flip I18nManager AFTER styles are compiled, existing stylesheets do NOT
 * retroactively mirror `flexDirection: row` → `row-reverse`.
 *
 * Fix: on web, read the saved language from localStorage SYNCHRONOUSLY and
 * call `I18nManager.forceRTL(true)` BEFORE any screen module (and thus any
 * StyleSheet.create call) runs. This file is imported from app/_layout.tsx
 * as the FIRST statement so it executes before all other imports resolve.
 *
 * On native, `I18nManager.forceRTL` only applies after reload — this file is
 * harmless there (and the i18n provider's reloadAsync() call still runs).
 */
import { I18nManager, Platform } from "react-native";

const LANG_KEY = "orio_lang";  // must match src/i18n.tsx KEY

if (Platform.OS === "web") {
  try {
    // localStorage is synchronous on web — perfect for this.
    // @ts-ignore
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
    const wantRTL = saved === "ar";
    if (I18nManager.isRTL !== wantRTL) {
      try { I18nManager.allowRTL(wantRTL); } catch {}
      try { I18nManager.forceRTL(wantRTL); } catch {}
    }
    // Also flip the document direction so CSS logical properties cascade.
    // @ts-ignore
    if (typeof document !== "undefined" && document?.documentElement) {
      // @ts-ignore
      document.documentElement.dir = wantRTL ? "rtl" : "ltr";
      // @ts-ignore
      document.documentElement.lang = wantRTL ? "ar" : "en";
      // Inject a global style to prevent horizontal overflow caused by
      // absolute-positioned decorative glows etc. that still use physical
      // left/right offsets. Also hides webkit scrollbars.
      // @ts-ignore
      try {
        // @ts-ignore
        if (!document.getElementById("__orio_global_css__")) {
          // @ts-ignore
          const s = document.createElement("style");
          s.id = "__orio_global_css__";
          s.innerHTML = `
            html, body { overflow-x: hidden !important; }
            *::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
            * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
          `;
          // @ts-ignore
          document.head && document.head.appendChild(s);
        }
      } catch {}
    }
  } catch {
    // Best-effort — any failure here falls back to default LTR.
  }
}
