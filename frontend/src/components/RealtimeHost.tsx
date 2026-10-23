/**
 * Owns the global realtime socket for the signed-in user and turns server
 * events into React Query invalidations (unread count, threads, open chats).
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/src/auth-context";
import { onRealtime, startRealtime, stopRealtime } from "@/src/realtime";

export function RealtimeHost() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user?.id) { stopRealtime(); return; }
    startRealtime(user.id);
    return () => stopRealtime();
  }, [user?.id]);

  useEffect(() => onRealtime((ev) => {
    if (ev.type === "dm_update" || ev.type === "reconnected") {
      qc.invalidateQueries({ queryKey: ["unread-count"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
    }
  }), [qc]);

  return null;
}
