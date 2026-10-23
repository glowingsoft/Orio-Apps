import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/auth-context";

/** Re-reads /auth/me on focus and every `ms` while the screen is focused
 * (live diamond balance + levels). */
export function useLiveUser(ms = 15000) {
  const { refresh } = useAuth();
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const h = setInterval(() => { void refresh(); }, ms);
      return () => clearInterval(h);
    }, [refresh, ms]),
  );
}
