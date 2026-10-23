/**
 * Batch B — Post comments sheet: avatar + VIP-aware name + age/VIP/Wealth/Charm
 * badges, one-level replies, Reply / Report under other users' comments.
 * Tapping a commenter's avatar closes the sheet and opens their profile
 * (deleted accounts → ORIO toast, no navigation).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, FlatList, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { apiPostComments, apiAddPostComment } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth-context";
import { useToast } from "@/src/components/Toast";
import { VipName } from "@/src/components/VipName";
import { VipBadge } from "@/src/components/VipBadge";
import { AgeBadge, LevelBadgeChip } from "@/src/levels/badges";
import { colors, spacing, radius } from "@/src/theme";

const AVATAR_FALLBACK = "https://api.dicebear.com/7.x/avataaars/png?seed=orio";

export function CommentsSheet({ post, onClose, onCommentAdded }: {
  post: { id: string } | null; onClose: () => void; onCommentAdded: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [replyTo, setReplyTo] = useState<any | null>(null);

  const { data: comments = [], isLoading } = useQuery<any[]>({
    queryKey: ["post-comments", post?.id],
    queryFn: () => apiPostComments(post!.id),
    enabled: !!post?.id,
  });

  // Top-level comments followed by their replies (one level).
  const rows = useMemo(() => {
    const top = comments.filter((c) => !c.parent_id);
    const kids: Record<string, any[]> = {};
    comments.filter((c) => c.parent_id).forEach((c) => { (kids[c.parent_id] ||= []).push(c); });
    const out: any[] = [];
    top.forEach((c) => { out.push(c); (kids[c.id] || []).forEach((r) => out.push({ ...r, _reply: true })); });
    return out;
  }, [comments]);

  const send = useMutation({
    mutationFn: (v: string) => apiAddPostComment(post!.id, v, replyTo?.id),
    onSuccess: () => {
      setMsg(""); setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["post-comments", post?.id] });
      onCommentAdded();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const submit = useCallback(() => {
    const v = msg.trim();
    if (!v || !post) return;
    send.mutate(v);
  }, [msg, post, send]);

  const openProfile = (a: any) => {
    if (!a?.id) return;
    if (a.is_deleted) { toast.info(isRTL ? "تم حذف حساب هذا المستخدم" : "This user's account has been deleted"); return; }
    onClose();
    setTimeout(() => router.push(`/user/${a.id}` as any), 0);
  };

  const report = (c: any) => {
    onClose();
    setTimeout(() => router.push(`/report?comment_id=${c.id}` as any), 0);
  };

  return (
    <Modal visible={!!post} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable onPress={onClose} style={styles.overlay}>
          <Pressable onPress={() => {}} style={[styles.sheet, { paddingBottom: insets.bottom || spacing.md }]} testID="comments-sheet">
            <View style={styles.handle} />
            <Text style={styles.title}>{t.comments}</Text>
            <View style={{ flex: 1 }}>
              {isLoading ? (
                <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
              ) : rows.length === 0 ? (
                <View style={styles.center}>
                  <Icon name="chatbubbles-outline" size={44} color={colors.muted} />
                  <Text style={styles.empty}>{t.noCommentsYet}</Text>
                </View>
              ) : (
                <FlatList
                  data={rows}
                  keyExtractor={(c) => c.id}
                  contentContainerStyle={{ paddingVertical: spacing.md }}
                  renderItem={({ item }) => {
                    const a = item.author || {};
                    const mine = a.id === user?.id;
                    return (
                      <View style={[styles.row, item._reply && { marginStart: 40 }]} testID={`comment-${item.id}`}>
                        <Pressable onPress={() => openProfile(a)} testID={`comment-avatar-${item.id}`} hitSlop={4}>
                          <Image source={a.avatar_url || AVATAR_FALLBACK} style={[styles.avatar, item._reply && styles.avatarSm]} contentFit="cover" />
                        </Pressable>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.nameRow}>
                            <VipName name={a.nickname ?? t.userFallback} color={a.name_color} vipLevel={a.vip_level} style={styles.name} numberOfLines={1} />
                          </View>
                          <View style={styles.badges}>
                            {!!a.age && <AgeBadge age={a.age} gender={a.gender} />}
                            {Number(a.vip_level ?? 0) > 0 && <VipBadge level={a.vip_level} size="sm" />}
                            <LevelBadgeChip size="sm" sys="wealth" level={Math.max(1, Number(a.wealth_level ?? 0))} />
                            {Number(a.charm_level ?? 0) >= 1 && <LevelBadgeChip size="sm" sys="charm" level={Number(a.charm_level)} />}
                          </View>
                          <Text style={[styles.text, { writingDirection: isRTL ? "rtl" : "ltr", textAlign: isRTL ? "right" : "left" }]}>
                            {item.reply_to?.nickname ? <Text style={styles.replyTo}>@{item.reply_to.nickname} </Text> : null}
                            {item.text}
                          </Text>
                          {!mine && (
                            <View style={styles.actions}>
                              <Pressable onPress={() => setReplyTo({ id: item.id, nickname: a.nickname })} testID={`comment-reply-${item.id}`} hitSlop={6}>
                                <Text style={styles.action}>{isRTL ? "رد" : "Reply"}</Text>
                              </Pressable>
                              <Pressable onPress={() => report(item)} testID={`comment-report-${item.id}`} hitSlop={6}>
                                <Text style={styles.action}>{isRTL ? "إبلاغ" : "Report"}</Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  }}
                />
              )}
            </View>
            {replyTo && (
              <View style={styles.replyBar} testID="comment-replying">
                <Text style={styles.replyBarText} numberOfLines={1}>{isRTL ? `الرد على ${replyTo.nickname}` : `Replying to ${replyTo.nickname}`}</Text>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={8}><Icon name="close" size={16} color={colors.muted} /></Pressable>
              </View>
            )}
            <View style={styles.composer}>
              <TextInput
                testID="comment-input"
                value={msg}
                onChangeText={setMsg}
                placeholder={t.writeComment}
                placeholderTextColor={colors.muted}
                maxLength={500}
                style={[styles.input, isRTL && { textAlign: "right" }]}
                onSubmitEditing={submit}
                returnKeyType="send"
              />
              <Pressable testID="submit-comment-btn" onPress={submit} disabled={!msg.trim() || send.isPending}
                style={[styles.send, (!msg.trim() || send.isPending) && { opacity: 0.5 }]}>
                {send.isPending ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Icon name="send" size={18} color={colors.onBrandPrimary} />}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { height: "75%", backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "800", textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  empty: { color: colors.muted, fontSize: 13 },
  row: { flexDirection: "row", gap: 10, marginBottom: spacing.md },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary },
  avatarSm: { width: 28, height: 28, borderRadius: 14 },
  nameRow: { flexDirection: "row", alignItems: "center" },
  name: { color: colors.onSurface, fontWeight: "800", fontSize: 13, maxWidth: 200 },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 3 },
  text: { color: colors.onSurface, fontSize: 14, marginTop: 4, lineHeight: 20 },
  replyTo: { color: colors.brandPrimary, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 16, marginTop: 4 },
  action: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  replyBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  replyBarText: { color: colors.muted, fontSize: 12, flex: 1 },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: spacing.sm, borderTopWidth: 0.5, borderTopColor: colors.border },
  input: { flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, color: colors.onSurface },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
});
