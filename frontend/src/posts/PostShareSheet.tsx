/**
 * Post share sheet — external share + copy link, then ORIO mutual friends
 * (plus search by user ID) to send the post as real private messages.
 * Server enforces visibility + blocking on /posts/{id}/share.
 */
import React, { useMemo, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, TextInput, ScrollView, Share, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { apiMyMutuals, apiSearchUsers, apiSharePost } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius } from "@/src/theme";
import { VipName } from "@/src/components/VipName";

export function PostShareSheet({ post, onClose }: { post: any | null; onClose: () => void }) {
  const { isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const { data: mutuals = [] } = useQuery({ queryKey: ["my-mutuals"], queryFn: apiMyMutuals, enabled: !!post, staleTime: 30_000 });
  const qId = q.trim();
  const { data: found, isFetching } = useQuery({
    queryKey: ["share-search", qId],
    queryFn: () => apiSearchUsers(qId, 10),
    enabled: !!post && /^\d{4,12}$/.test(qId),
  });
  const people: any[] = useMemo(() => {
    if (/^\d{4,12}$/.test(qId)) return (found?.items || []) as any[];
    return mutuals as any[];
  }, [qId, found, mutuals]);
  const link = post ? Linking.createURL(`/post/${post.id}`) : "";
  const close = () => { setQ(""); setSel({}); onClose(); };

  const send = async () => {
    const ids = Object.keys(sel);
    if (!post || !ids.length) return;
    setBusy(true);
    try {
      const r = await apiSharePost(post.id, ids);
      toast.show({
        kind: r.sent.length ? "success" : "error",
        message: r.skipped.length
          ? (isRTL ? `أُرسل إلى ${r.sent.length}، وتعذّر ${r.skipped.length}` : `Sent to ${r.sent.length}, ${r.skipped.length} not allowed`)
          : (isRTL ? "تمت المشاركة" : "Shared"),
      });
      close();
    } catch (e: any) {
      toast.show({ kind: "error", message: e?.message || "Failed" });
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={!!post} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}} testID="post-share-sheet">
          <View style={styles.handle} />
          <View style={styles.extRow}>
            <Pressable testID="post-share-external" style={styles.ext} onPress={() => Share.share({ message: `${post?.text ? post.text.slice(0, 80) + "\n" : ""}${link}`, url: link }).catch(() => {})}>
              <View style={styles.extIcon}><Icon name="share-social" size={22} color={colors.brandPrimary} /></View>
              <Text style={styles.extText}>{isRTL ? "مشاركة خارجية" : "Share to apps"}</Text>
            </Pressable>
            <Pressable testID="post-share-copy" style={styles.ext} onPress={() => { Clipboard.setStringAsync(link).then(() => toast.show({ kind: "success", message: isRTL ? "تم نسخ الرابط" : "Link copied" })).catch(() => {}); }}>
              <View style={styles.extIcon}><Icon name="link" size={22} color={colors.brandPrimary} /></View>
              <Text style={styles.extText}>{isRTL ? "نسخ الرابط" : "Copy link"}</Text>
            </Pressable>
          </View>
          <TextInput
            testID="post-share-search"
            value={q}
            onChangeText={setQ}
            placeholder={isRTL ? "ابحث عن مستخدم بالـ ID" : "Search users by ID"}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            style={[styles.search, { textAlign: isRTL ? "right" : "left" }]}
          />
          <Text style={styles.section}>{/^\d{4,12}$/.test(qId) ? (isRTL ? "نتائج البحث" : "Search results") : (isRTL ? "الأصدقاء المتبادلون" : "Mutual friends")}</Text>
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
            {isFetching ? <ActivityIndicator color={colors.brandPrimary} /> : people.length === 0 ? (
              <Text style={styles.empty} testID="post-share-empty">{isRTL ? "لا يوجد مستخدمون" : "No users"}</Text>
            ) : people.map((u) => {
              const on = !!sel[u.id];
              return (
                <Pressable key={u.id} testID={`post-share-user-${u.id}`} style={styles.userRow}
                  onPress={() => setSel((s) => { const n = { ...s }; if (on) delete n[u.id]; else n[u.id] = u; return n; })}>
                  <Image source={u.avatar_url} style={styles.avatar} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <VipName style={styles.name} numberOfLines={1} name={u.nickname || "User"} color={u.name_color} vipLevel={u.vip_level} />
                    {!!u.numeric_id && <Text style={styles.sub}>ID: {u.numeric_id}</Text>}
                  </View>
                  <Icon name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? colors.brandPrimary : colors.muted} />
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable testID="post-share-send" disabled={!Object.keys(sel).length || busy} onPress={send}
            style={[styles.sendBtn, (!Object.keys(sel).length || busy) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <Text style={styles.sendText}>{isRTL ? `إرسال (${Object.keys(sel).length})` : `Send (${Object.keys(sel).length})`}</Text>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  extRow: { flexDirection: "row", gap: spacing.lg, justifyContent: "center", paddingVertical: spacing.sm },
  ext: { alignItems: "center", gap: 6, minWidth: 96 },
  extIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  extText: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  search: { height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, color: colors.onSurface },
  section: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 4 },
  empty: { color: colors.muted, textAlign: "center", paddingVertical: spacing.lg },
  userRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 56 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  sub: { color: colors.muted, fontSize: 11 },
  sendBtn: { height: 48, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  sendText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 15 },
});
