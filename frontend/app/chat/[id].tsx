import { useState, useEffect, useRef, useMemo } from "react";
import { View, Text, StyleSheet, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform, Modal, Alert, Linking } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useLocalSearchParams, useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { apiGetUser, apiMessagesWith, apiSendMessage, apiSendChatMedia, apiMessageUnsend, apiMessageDelete, apiSendChatReaction } from "@/src/api";
import { EmojiPicker } from "@/src/reactions/EmojiPicker";
import { AnimatedEmoji } from "@/src/reactions/AnimatedEmoji";
import { GiftFxOverlay, type GiftFxEvent } from "@/src/room/GiftFxOverlay";
import { mediaUrl } from "@/src/media/upload";
import { useQuery as usePresenceQuery } from "@tanstack/react-query";
import { apiPresence } from "@/src/api";
import { pollMs, useRealtimeConnected } from "@/src/realtime";
import * as Clipboard from "expo-clipboard";
import { ActionSheet, SheetAction } from "@/src/components/ActionSheet";
import { uploadMedia, pickMedia, captureImage, privateMediaUrl } from "@/src/media/upload";
import { AgeBadge, LevelBadgeChip } from "@/src/levels/badges";
import { VoiceBubble } from "@/src/chat/VoiceBubble";
import { HoldToTalkMic } from "@/src/chat/HoldToTalkMic";
import { ChatSkeleton } from "@/src/chat/ChatSkeleton";
import { UploadProgressRing } from "@/src/chat/UploadProgressRing";
import { useSharedValue } from "react-native-reanimated";
import { ChatGiftSheet } from "@/src/chat/ChatGiftSheet";
import { useCalls } from "@/src/calls/CallProvider";
import { useToast } from "@/src/components/Toast";
import { useImageViewer } from "@/src/components/ImageViewer";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { VipName } from "@/src/components/VipName";
import { VipBadge } from "@/src/components/VipBadge";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { isRTL, t } = useI18n();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const listRef = useRef<FlatList>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();
  const calls = useCalls();
  const viewer = useImageViewer();
  const [msgMenu, setMsgMenu] = useState<any | null>(null);
  // Optimistic local update, then the server; the peer syncs via polling.
  const patchMsgs = (fn: (l: any[]) => any[]) => qc.setQueryData(["messages", id], (old: any) => fn(Array.isArray(old) ? old : []));
  const msgAction = async (m: any, kind: "unsend" | "me" | "everyone") => {
    if (kind === "unsend") patchMsgs((l) => l.map((x) => (x.id === m.id ? { ...x, kind: "unsent", text: "Message Unsent", media_url: null } : x)));
    else if (kind === "everyone") patchMsgs((l) => l.map((x) => (x.id === m.id ? { ...x, kind: "deleted", media_url: null } : x)));
    else patchMsgs((l) => l.filter((x) => x.id !== m.id));
    try {
      if (kind === "unsend") await apiMessageUnsend(m.id); else await apiMessageDelete(m.id, kind);
    } catch (e: any) {
      toast.show({ kind: "error", message: e?.message || (isRTL ? "تعذّر تنفيذ الإجراء" : "Action failed") });
    } finally {
      refetch();
      qc.invalidateQueries({ queryKey: ["threads"] });
    }
  };
  const msgActions = (m: any): SheetAction[] => {
    if (!m) return [];
    const mine = m.sender_id === user?.id;
    const out: SheetAction[] = [];
    if ((m.kind || "text") === "text") {
      out.push({ key: "copy", icon: "copy-outline", label: isRTL ? "نسخ" : "Copy",
        onPress: () => { Clipboard.setStringAsync(m.text || "").then(() => toast.show({ kind: "success", message: isRTL ? "تم النسخ" : "Copied" })).catch(() => {}); } });
    }
    // Unsend / Delete for Everyone: own messages, within 2 minutes (server-enforced too).
    const fresh = mine && m.created_at && Date.now() - new Date(m.created_at).getTime() < 120_000;
    if (fresh && m.kind !== "unsent") out.push({ key: "unsend", icon: "arrow-undo-outline", label: isRTL ? "إلغاء الإرسال" : "Unsend", onPress: () => msgAction(m, "unsend") });
    out.push({ key: "delete-me", icon: "trash-outline", label: isRTL ? "حذف لدي" : "Delete for Me", destructive: true, onPress: () => msgAction(m, "me") });
    if (fresh) out.push({ key: "delete-all", icon: "trash", label: isRTL ? "حذف لدى الجميع" : "Delete for Everyone", destructive: true, onPress: () => msgAction(m, "everyone") });
    return out;
  };

  const { data: other } = useQuery({ queryKey: ["user", id], queryFn: () => apiGetUser(id!), enabled: !!id });
  const { data: presence } = usePresenceQuery({ queryKey: ["presence", id], queryFn: () => apiPresence(id!), enabled: !!id, refetchInterval: 20000 });
  // Iter-118 — official Orio Team conversation is read-only (server-enforced too).
  const readOnly = !!(other as any)?.is_official;
  const live = useRealtimeConnected();
  const { data: messages = [], refetch, isPending: messagesPending } = useQuery({
    queryKey: ["messages", id],
    queryFn: () => apiMessagesWith(id!),
    enabled: !!id,
    refetchInterval: pollMs(live, 60_000, 3000),
  });

  useEffect(() => { qc.invalidateQueries({ queryKey: ["unread-count"] }); qc.invalidateQueries({ queryKey: ["threads"] }); }, [messages?.length, qc]);

  // Inverted list: newest message first, drawn at the bottom. Offset 0 is the
  // latest message, so the chat opens there with no jump, and new messages
  // appear in place while you are at the bottom (data built below `failed`).
  const scrollToLatest = () => {
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
  };

  const keyboardOpen = useKeyboardState((s) => s.isVisible);
  const keyboardHeight = useKeyboardState((s) => s.height);
  const keyboardPad = Platform.OS === "android" && keyboardOpen ? Math.max(0, keyboardHeight - insets.bottom) : 0;
  useEffect(() => {
    if (keyboardPad > 0) scrollToLatest();
  }, [keyboardPad]);

  // Outgoing messages the server refused (block, network) stay visible with a red "!".
  const [failed, setFailed] = useState<any[]>([]);
  const listData = useMemo(() => dedupeById([...(messages as any[]), ...failed]).reverse(), [messages, failed]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [giftPlay, setGiftPlay] = useState<GiftFxEvent | null>(null);
  const sendReaction = async (k: string) => {
    setEmojiOpen(false);
    if (!id) return;
    scrollToLatest();
    try { await apiSendChatReaction(id, k); await refetch(); } catch (e: any) {
      toast.show({ kind: "error", message: /slow/i.test(String(e?.message)) ? (isRTL ? "انتظر قليلاً قبل إرسال تفاعل آخر" : "Please wait a moment before reacting again") : String(e?.message || "Error") });
    }
  };
  const send = async () => {
    if (!text.trim() || !id) return;
    const t = text.trim();
    setText("");
    scrollToLatest();
    try { await apiSendMessage(id, t); await refetch(); } catch (e: any) {
      const m = String(e?.message || "");
      if (/BLOCKED/i.test(m) || !/prohibited|abusive|محظور/i.test(m)) {
        setFailed((l) => [...l, { id: `failed-${Date.now()}`, sender_id: user?.id, text: t, kind: "text", failed: true }]);
        if (/BLOCKED/i.test(m)) qc.invalidateQueries({ queryKey: ["user", id] });
      } else {
        // Iter-135 — rejected (prohibited words): never shown as sent.
        setText(t);
      }
      toast.show({ kind: "error", durationMs: 4500, message: /BLOCKED/i.test(m) ? (isRTL ? "لا يمكن إرسال رسائل لهذا المستخدم" : "You can't message this user") : (m || (isRTL ? "تعذّر الإرسال" : "Could not send")) });
    }
  };
  const isBlocked = !!(other as any)?.is_blocked_view;


  const [pendingImg, setPendingImg] = useState<{ uri: string } | null>(null);
  const uploadProgress = useSharedValue(0);
  const hasPendingImg = !!pendingImg;
  useEffect(() => {
    if (hasPendingImg) scrollToLatest();
  }, [hasPendingImg]);
  const sendMedia = async (m: any, kind: "image" | "voice", duration?: number, waveform?: number[]) => {
    if (!id) return;
    setUploading(true);
    if (kind === "image") { uploadProgress.set(0); setPendingImg({ uri: m.uri }); }
    try {
      const url = await uploadMedia(m, "chat", kind === "image" ? (p) => uploadProgress.set(p) : undefined);
      await apiSendChatMedia(id, kind, url, duration, waveform);
      await refetch();
    } catch (e: any) {
      toast.show({ kind: "error", message: isRTL ? "تعذّر الإرسال" : `Could not send: ${e?.message || ""}` });
      throw e;
    } finally { setUploading(false); setPendingImg(null); }
  };
  const sendVoice = async (uri: string, seconds: number, waveform?: number[]) => {
    const mime = Platform.OS === "web" ? "audio/webm" : "audio/mp4";
    await sendMedia({ uri, kind: "audio", mime, size: 0, duration: seconds }, "voice", seconds, waveform);
  };
  const permAlert = (blocked: boolean, what: "camera" | "photos") => {
    const msg = what === "camera"
      ? (isRTL ? "يلزم إذن الكاميرا لالتقاط الصور" : "Camera access is needed to take photos")
      : (isRTL ? "يلزم إذن الصور لاختيار صورة" : "Photo access is needed to pick a photo");
    Alert.alert(isRTL ? "الإذن مطلوب" : "Permission needed", msg,
      blocked ? [{ text: isRTL ? "إلغاء" : "Cancel", style: "cancel" }, { text: isRTL ? "فتح الإعدادات" : "Open Settings", onPress: () => Linking.openSettings() }]
        : [{ text: "OK" }]);
  };
  const pickPhoto = async () => {
    setMoreOpen(false);
    const r = await pickMedia("image", 1);
    if (r === "denied") { permAlert(true, "photos"); return; }
    if (r.length) sendMedia(r[0], "image").catch(() => {});
  };
  const takePhoto = async () => {
    setMoreOpen(false);
    const r = await captureImage();
    if (r === "denied" || r === "blocked") { permAlert(r === "blocked", "camera"); return; }
    if (r) sendMedia(r, "image").catch(() => {});
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {/* Iter-135 — identity in the corner opposite the back arrow. */}
        <View style={styles.headId} testID="chat-header-identity">
          <View style={styles.headText}>
            <View style={styles.headNameRow}>
              {readOnly && <Icon name="shield-checkmark" size={18} color={colors.brandPrimary} />}
              <VipName
                name={other?.nickname || t.chatFallback}
                color={(other as any)?.name_color}
                vipLevel={(other as any)?.vip_level}
                style={styles.title}
                numberOfLines={1}
                testID="chat-header-name"
              />
            </View>
            {!readOnly && (
              <View style={styles.headBadges} testID="chat-header-badges">
                <AgeBadge age={(other as any)?.age} gender={(other as any)?.gender} />
                {Number((other as any)?.vip_level ?? 0) > 0 && <VipBadge level={(other as any)?.vip_level} size="sm" />}
                <LevelBadgeChip size="sm" sys="wealth" level={Math.max(1, Number((other as any)?.wealth_level ?? 0))} />
                {Number((other as any)?.charm_level ?? 0) >= 1 && <LevelBadgeChip size="sm" sys="charm" level={Number((other as any)?.charm_level)} />}
              </View>
            )}
            {!readOnly && presence && (
              <Text style={[styles.presence, presence.online && { color: "#22C55E" }]} testID="chat-presence" numberOfLines={1}>
                {presenceLabel(presence, isRTL)}
              </Text>
            )}
          </View>
          <Pressable onPress={() => !readOnly && id && router.push(`/user/${id}` as any)} hitSlop={6} testID="chat-header-avatar-btn">
            {(other as any)?.avatar_url
              ? <Image source={(other as any).avatar_url} style={styles.headAvatar} contentFit="cover" testID="chat-header-avatar" />
              : <View style={[styles.headAvatar, { backgroundColor: colors.surfaceTertiary }]} />}
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        inverted
        style={{ flex: 1 }}
        data={listData}
        keyExtractor={(m: any, i) => m.id || i.toString()}
        // Inverted: paddingTop is the visual bottom (room for the keyboard).
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.md + keyboardPad, gap: spacing.md }}
        renderItem={({ item, index }) => {
          const mine = item.sender_id === user?.id;
          const kind = item.kind || "text";
          return (
            <View style={[styles.msgRow, { justifyContent: mine ? "flex-end" : "flex-start" }]} testID={`msg-${index}`}>
              <Pressable
                onLongPress={() => item.id && !item.failed && !readOnly && !["voice", "gift", "call", "deleted", "emoji"].includes(kind) && setMsgMenu(item)}
                disabled={kind === "emoji"}
                delayLongPress={350}
                testID={`msg-press-${index}`}
                style={[styles.bubble, mine ? styles.mine : styles.theirs, kind === "image" && styles.imgBubble, kind === "emoji" && styles.emojiBubble, (kind === "unsent" || kind === "deleted") && styles.unsentBubble, kind === "voice" && styles.voiceBubble]}
              >
                {kind === "deleted" ? (
                  <View style={styles.unsentRow} testID={`msg-deleted-${index}`}>
                    <Icon name="trash-outline" size={14} color={colors.muted} />
                    <Text style={styles.unsentText}>{isRTL ? "تم حذف هذه الرسالة لدى الجميع." : "This message was deleted for everyone."}</Text>
                  </View>
                ) : kind === "call" ? (
                  <View style={styles.unsentRow} testID={`msg-call-${index}`}>
                    <Icon name={item.call_status === "answered" ? "call" : "call-outline"} size={15} color={item.call_status === "answered" ? (mine ? colors.onBrandPrimary : colors.success) : colors.error} />
                    <Text style={[styles.bubbleText, { color: mine ? colors.onBrandPrimary : colors.onSurface }]}>
                      {item.call_status === "answered"
                        ? `${isRTL ? "مكالمة صوتية" : "Voice call"} ${Math.floor((item.duration || 0) / 60)}:${String((item.duration || 0) % 60).padStart(2, "0")}`
                        : (isRTL ? "لا يوجد رد" : "No Answer")}
                    </Text>
                  </View>
                ) : kind === "unsent" ? (
                  <View style={styles.unsentRow} testID={`msg-unsent-${index}`}>
                    <Icon name="ban-outline" size={14} color={colors.muted} />
                    <Text style={styles.unsentText}>{isRTL ? "تم إلغاء إرسال الرسالة" : "Message Unsent"}</Text>
                  </View>
                ) : kind === "image" ? (
                  <Pressable onPress={() => viewer.show(privateMediaUrl(item.media_url))}>
                    <Image source={privateMediaUrl(item.media_url)} style={styles.photo} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={item.id} testID={`msg-image-${index}`} />
                  </Pressable>
                ) : kind === "voice" ? (
                  <VoiceBubble uri={privateMediaUrl(item.media_url)!} duration={item.duration} waveform={item.waveform} color={mine ? colors.onBrandPrimary : colors.onSurface} testID={`msg-voice-${index}`} />
                ) : kind === "post" ? (
                  <Pressable onPress={() => item.post_id && router.push(`/post/${item.post_id}` as any)} style={styles.postCard} testID={`msg-post-${index}`}>
                    <Icon name="newspaper-outline" size={18} color={mine ? colors.onBrandPrimary : colors.brandPrimary} />
                    <Text style={[styles.bubbleText, { color: mine ? colors.onBrandPrimary : colors.onSurface, flexShrink: 1 }]} numberOfLines={2}>{item.text}</Text>
                  </Pressable>
                ) : kind === "emoji" ? (
                  <AnimatedEmoji
                    emoji={item.emoji}
                    size={72}
                    loop
                    testID={`msg-emoji-${index}`}
                  />
                ) : kind === "gift" ? (
                  <View style={styles.giftRow} testID={`msg-gift-${index}`}>
                    {item.gift?.image_url ? <Image source={mediaUrl(item.gift.image_url)} style={styles.giftImg} contentFit="contain" /> : <Text style={{ fontSize: 26 }}>🎁</Text>}
                    <Text style={[styles.bubbleText, { color: mine ? colors.onBrandPrimary : colors.onSurface, fontWeight: "800" }]}>
                      {`${isRTL ? item.gift?.name_ar || item.gift?.name : item.gift?.name || "Gift"} x${item.gift?.quantity ?? 1}`}
                    </Text>
                    {(item.gift?.animation_url || item.gift?.luxury_fx) && (
                      <Pressable
                        testID={`msg-gift-play-${index}`}
                        hitSlop={8}
                        onPress={() => setGiftPlay({ key: `${item.id}-${Date.now()}`, gift: item.gift, quantity: item.gift?.quantity })}
                        style={styles.giftPlay}
                      >
                        <Icon name="play" size={11} color="#FFFFFF" />
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <Text style={[styles.bubbleText, { color: mine ? colors.onBrandPrimary : colors.onSurface }]}>{item.text}</Text>
                )}
              </Pressable>
              {item.failed && (
                <View style={styles.failedDot} testID={`msg-failed-${index}`}><Text style={styles.failedDotText}>!</Text></View>
              )}
            </View>
          );
        }}
        // Inverted: the header sits at the visual bottom, below the latest message.
        ListHeaderComponent={pendingImg ? (
          <View style={[styles.msgRow, { justifyContent: "flex-end", marginTop: spacing.md }]} testID="msg-image-uploading">
            <View style={[styles.bubble, styles.mine, styles.imgBubble]}>
              <Image source={pendingImg.uri} style={styles.photo} contentFit="cover" blurRadius={12} />
              <View style={styles.uploadOverlay}>
                <UploadProgressRing progress={uploadProgress} />
              </View>
            </View>
          </View>
        ) : null}
      />
      {messagesPending && <ChatSkeleton />}
      </View>
      {isBlocked ? (
        <View style={[styles.readOnly, { paddingBottom: insets.bottom + spacing.md, gap: 6 }]} testID="chat-blocked">
          <Text style={styles.readOnlyText}>
            {(other as any)?.i_blocked
              ? (isRTL ? "لقد حظرت هذا المستخدم. ألغِ الحظر لإرسال الرسائل." : "You blocked this user. Unblock them to send messages.")
              : (isRTL ? "قام هذا المستخدم بحظرك. لا يمكنك عرض محتواه." : "This user has blocked you. You cannot view their content.")}
          </Text>
          <Icon name="ban" size={22} color={colors.error} />
        </View>
      ) : readOnly ? (
        <View style={[styles.readOnly, { paddingBottom: insets.bottom + spacing.md }]} testID="chat-readonly">
          <Text style={styles.readOnlyText}>{isRTL ? "محادثة رسمية للقراءة فقط" : "Official read-only conversation"}</Text>
        </View>
      ) : (
      <KeyboardStickyView enabled={Platform.OS === "android"} offset={{ closed: 0, opened: insets.bottom }}>
      <View style={{ backgroundColor: colors.surfaceSecondary, borderTopWidth: 0.5, borderTopColor: colors.border }}>
        {!!uploading && !pendingImg && <Text style={styles.uploading} testID="chat-uploading">{isRTL ? "جارٍ الإرسال…" : "Sending…"}</Text>}
        <View style={[styles.inputRow, { borderTopWidth: 0 }]}>
          <TextInput testID="chat-text-input" value={text} onChangeText={setText} placeholder={t.typeMessagePh} placeholderTextColor={colors.muted} style={[styles.input, { textAlign: isRTL ? "right" : "left" }]} onSubmitEditing={send} />
          <Pressable testID="send-btn" onPress={send} style={styles.sendBtn}>
            <Icon name="send" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
        <View style={[styles.toolbar, { paddingBottom: insets.bottom + spacing.sm }]} testID="chat-toolbar">
          <HoldToTalkMic ar={isRTL} onSend={sendVoice} />
          <Pressable testID="chat-tool-gift" onPress={() => setGiftOpen(true)} style={styles.tool}>
            <Icon name="gift" size={22} color={colors.gold} />
          </Pressable>
          <Pressable testID="chat-tool-emoji" onPress={() => setEmojiOpen(true)} style={styles.tool}>
            <Icon name="happy-outline" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable testID="chat-tool-more" onPress={() => setMoreOpen(true)} style={styles.tool}>
            <Icon name="ellipsis-horizontal" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>
      </KeyboardStickyView>
      )}
      <ActionSheet visible={!!msgMenu} onClose={() => setMsgMenu(null)} actions={msgActions(msgMenu)} cancelLabel={isRTL ? "إلغاء" : "Cancel"} testID="msg-actions" />
      {giftOpen && id && <ChatGiftSheet recipientId={id} ar={isRTL} onClose={() => setGiftOpen(false)} onSent={() => refetch()} />}
      <EmojiPicker visible={emojiOpen} isRTL={isRTL} onClose={() => setEmojiOpen(false)} onPick={sendReaction} />
      <GiftFxOverlay event={giftPlay} isRTL={isRTL} />
      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={styles.moreBackdrop} onPress={() => setMoreOpen(false)}>
          <View style={[styles.moreSheet, { paddingBottom: insets.bottom + spacing.md }]} testID="chat-more-sheet">
            {([
              ["gallery", "images", isRTL ? "المعرض" : "Gallery", pickPhoto],
              ["camera", "camera", isRTL ? "الكاميرا" : "Camera", takePhoto],
              ["call", "call", isRTL ? "اتصال" : "Call", () => { setMoreOpen(false); if (id) calls.startCall(id); }],
            ] as const).map(([k, icon, label, fn]) => (
              <Pressable key={k} testID={`chat-more-${k}`} onPress={fn} style={styles.moreItem}>
                <View style={styles.moreIcon}><Icon name={icon} size={24} color={colors.gold} /></View>
                <Text style={styles.moreText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  msgRow: { flexDirection: "row" },
  imgBubble: { padding: 4 },
  uploadOverlay: { position: "absolute", top: 4, left: 4, right: 4, bottom: 4, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: "rgba(0,0,0,0.15)" },
  emojiBubble: { backgroundColor: "transparent", padding: 0, borderWidth: 0 },
  giftPlay: { width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", marginStart: 4 },
  presence: { color: colors.muted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  voiceBubble: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16 },
  postCard: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 240 },
  failedDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", marginStart: 6, alignSelf: "center" },
  failedDotText: { color: "#FFFFFF", fontWeight: "900", fontSize: 13 },
  unsentBubble: { backgroundColor: colors.surfaceSecondary, borderWidth: 0.5, borderColor: colors.border },
  unsentRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  unsentText: { color: colors.muted, fontSize: 13, fontStyle: "italic" },
  photo: { width: 180, height: 180, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  giftRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  giftImg: { width: 34, height: 34 },
  uploading: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: spacing.xs },
  toolbar: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: spacing.lg, paddingTop: 2 },
  tool: { width: 48, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  toolOn: { backgroundColor: colors.gold },
  moreBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  moreSheet: { flexDirection: "row", justifyContent: "space-around", backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.lg },
  moreItem: { alignItems: "center", gap: 6, minWidth: 80, paddingVertical: spacing.sm },
  moreIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  moreText: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  readOnly: { alignItems: "center", paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  readOnlyText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: "800", maxWidth: 200 },
  headId: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headText: { alignItems: "flex-end", gap: 3 },
  headNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headBadges: { flexDirection: "row", alignItems: "center", gap: 3 },
  headAvatar: { width: 40, height: 40, borderRadius: 20 },
  bubble: { maxWidth: "80%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  // Iter-135 — mine: purple · received: black/dark. Bubbles hold content only.
  mine: { backgroundColor: colors.brandPrimary, borderBottomEndRadius: 4 },
  theirs: { backgroundColor: colors.surfaceSecondary, borderBottomStartRadius: 4, borderWidth: 0.5, borderColor: colors.border },
  bubbleText: { fontSize: 14 },
  inputRow: { flexDirection: "row", padding: spacing.md, gap: spacing.sm, borderTopWidth: 0.5, borderTopColor: colors.border, backgroundColor: colors.surfaceSecondary },
  input: { flex: 1, backgroundColor: colors.surfaceTertiary, color: colors.onSurface, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 44 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
});

/** Stable de-duplication (server id or client id) — never render a message twice. */
function dedupeById(list: any[]) {
  const seen = new Set<string>();
  return list.filter((m) => {
    const k = String(m?.id ?? m?.client_id ?? "");
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Online Now (green) or last-seen, capped at "7 days". */
function presenceLabel(p: { online: boolean; last_seen_at: string | null }, ar: boolean) {
  if (p.online) return ar ? "متصل الآن" : "Online Now";
  if (!p.last_seen_at) return ar ? "غير متصل" : "Offline";
  const s = Math.max(0, (Date.now() - new Date(p.last_seen_at).getTime()) / 1000);
  if (s < 60) return ar ? "آخر ظهور منذ لحظات" : "Last seen just now";
  if (s < 3600) { const m = Math.floor(s / 60); return ar ? `آخر ظهور منذ ${m} دقيقة` : `Last seen ${m}m ago`; }
  if (s < 86400) { const h = Math.floor(s / 3600); return ar ? `آخر ظهور منذ ${h} ساعة` : `Last seen ${h}h ago`; }
  const d = Math.floor(s / 86400);
  if (d >= 7) return ar ? "آخر ظهور منذ 7 أيام" : "Last seen 7 days ago";
  return ar ? `آخر ظهور منذ ${d} يوم` : `Last seen ${d}d ago`;
}
