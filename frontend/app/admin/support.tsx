/**
 * Iter-98 — Admin: Support Inbox (reply to VIP4+ users' support chats).
 */
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput, Image } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminSupportThreads, apiAdminSupportThread, apiAdminSupportReply } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

export default function AdminSupport() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const threads = useQuery({ queryKey: ["admin", "support"], queryFn: apiAdminSupportThreads, refetchInterval: 15000 });
  const thread = useQuery({
    queryKey: ["admin", "support", sel], queryFn: () => apiAdminSupportThread(sel!), enabled: !!sel, refetchInterval: 10000,
  });
  const reply = useMutation({
    mutationFn: () => apiAdminSupportReply(sel!, text.trim()),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["admin", "support"] }); },
  });
  const items = threads.data?.items || [];

  return (
    <AdminShell title="Support Inbox">
      {threads.isLoading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 48 }} /> : (
        <View style={{ gap: spacing.lg }}>
          {items.length === 0 ? <Text style={styles.muted}>No support conversations yet.</Text> : items.map((t: any) => (
            <Pressable key={t.user.id} onPress={() => setSel(t.user.id)}
              style={[adminStyles.rowCard, sel === t.user.id && { borderColor: colors.brandPrimary }]}>
              {t.user.avatar_url ? <Image source={{ uri: t.user.avatar_url }} style={adminStyles.avatar} /> : <View style={adminStyles.avatar} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{t.user.nickname || t.user.id} {t.user.vip_level ? `· VIP${t.user.vip_level}` : ""}</Text>
                <Text style={styles.muted} numberOfLines={1}>{t.last_text}</Text>
              </View>
              {t.unread > 0 && <View style={[adminStyles.badge, { backgroundColor: colors.error + "22" }]}><Text style={[adminStyles.badgeText, { color: colors.error }]}>{t.unread}</Text></View>}
            </Pressable>
          ))}
          {sel && (
            <View style={styles.thread}>
              {(thread.data?.items || []).map((m) => (
                <View key={m.id} style={[styles.bubble, m.from_support ? styles.mine : styles.theirs]}>
                  <Text style={styles.bubbleText}>{m.text}</Text>
                  <Text style={styles.time}>{new Date(m.created_at).toLocaleString()}</Text>
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                <TextInput value={text} onChangeText={setText} placeholder="Reply as ORIO Support" placeholderTextColor={colors.muted} style={[adminStyles.input, { flex: 1 }]} />
                <Pressable disabled={!text.trim() || reply.isPending} onPress={() => reply.mutate()} style={adminStyles.primaryBtn}>
                  <Text style={adminStyles.primaryBtnText}>Send</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 12 },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  thread: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  bubble: { maxWidth: "80%", borderRadius: radius.md, padding: spacing.sm },
  mine: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary + "33" },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceTertiary },
  bubbleText: { color: colors.onSurface, fontSize: 14 },
  time: { color: colors.muted, fontSize: 10, marginTop: 2 },
});
