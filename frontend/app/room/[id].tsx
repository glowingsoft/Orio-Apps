import { CountryFlag } from "@/src/components/CountryFlag";
import { pickAndCrop } from "@/src/media/ImageCropper";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { VipName } from "@/src/components/VipName";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Modal,
  Alert,
  Share,
  Switch,
  useWindowDimensions,
  StatusBar,
} from "react-native";
import {
  KeyboardStickyView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import {
  apiTakeSeat,
  apiLeaveSeat,
  apiToggleMute,
  apiGifts,
  apiSendGift,
  apiSendGiftMulti,
  apiListMyCustomGifts,
  apiCustomGiftSettings,
  apiCreateCustomGift,
  apiGetRoom,
  apiChangeLayout,
  apiRoomChatMute,
  apiRoomChatLock,
  apiUpdateRoomSettings,
  apiCloseRoom,
  apiClearRoomChat,
  apiRoomModerate,
  apiMicInvite,
  apiMicInviteAccept,
  apiMicInviteReject,
  apiMicChangeSeat,
  apiModerate,
  apiRoomLock,
  apiRoomUnlock,
  apiPkStart,
  apiPkEnd,
  apiRoomFollow,
  apiRoomUnfollow,
  apiRoomFollowStatus,
  apiRoomMembershipRequest,
} from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";
import { Diamond } from "@/src/components/Diamond";
import { GiftCard } from "@/src/room/GiftCard";
import { pickMedia, uploadMedia, type PickedMedia } from "@/src/media/upload";
import { GiftFxOverlay } from "@/src/room/GiftFxOverlay";
import { RoomComboButton, type GiftCombo } from "@/src/room/RoomComboButton";
import { EmojiPicker } from "@/src/reactions/EmojiPicker";
import { AnimatedEmoji } from "@/src/reactions/AnimatedEmoji";
import { useRoomSession, uidFromObjectId } from "@/src/room/RoomSession";
import { useI18n } from "@/src/i18n";
import { confirmDialog } from "@/src/utils/confirm";
import { RoomUserCard } from "@/src/room/RoomUserCard";
import { MusicSheet } from "@/src/room/MusicSheet";
import { OrioHeart, OrioMembership } from "@/src/components/OrioIcons";
import { InRoomGameSurface } from "@/src/components/InRoomGameSurface";
import { useToast } from "@/src/components/Toast";
import { SpeakerRing } from "@/src/components/SpeakerRing";
import { NewUserBadge } from "@/src/components/NewUserBadge";
import { VipBadge } from "@/src/components/VipBadge";
import { ChatIdentityRow } from "@/src/room/ChatIdentityRow";
import {
  RoomSystemNotice,
  RoomGiftMessage,
  RoomImageMessage,
} from "@/src/room/RoomChatExtras";
import { apiRoomChatImage, apiRoomFullMute } from "@/src/api";
import { RoomTitleSheet } from "@/src/room/RoomTitleSheet";
import { EntranceOverlay } from "@/src/entrance/EntranceOverlay";
import { onContentBlocked, onChatRejected } from "@/src/room/contentBlocked";
import { apiRoomMembers } from "@/src/api";
import {
  apiRoomGamesCatalog,
  type RoomGameEntry,
  apiModerateRoomCover,
  apiUpdateRoomCover,
  apiRoomBackgroundsCatalog,
  apiSetRoomBackgroundPreset,
  type PremiumRoomBackground,
  apiSubmitCustomRoomBackground,
  ROOM_BG_CUSTOM_COST,
  apiPurchaseCustomBgPass,
  apiGetCustomBgEntitlement,
  type CustomBgEntitlement,
} from "@/src/api";

type Seat = { index: number; user?: any; muted?: boolean; locked?: boolean };

// Iter-48 — Yellow @mentions. Splits message text so any token matching
// `@word` (ASCII + Arabic) renders in warm yellow (NOT purple).
const MENTION_YELLOW = "#FFD60A";
const _MENTION_RE = /(@[\w\u0600-\u06FF][\w\u0600-\u06FF_.]{0,24})/g;
function renderMessageText(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(_MENTION_RE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p[0] === "@" && p.length > 1) {
      return (
        <Text key={i} style={{ color: MENTION_YELLOW, fontWeight: "700" }}>
          {p}
        </Text>
      );
    }
    return <Text key={i}>{p}</Text>;
  });
}

export default function RoomDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { isRTL } = useI18n();
  const qc = useQueryClient();
  const session = useRoomSession();
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Ensure the global session is bound to *this* room
  useEffect(() => {
    if (id && session.roomId !== id) session.enter(id);
    // We deliberately DO NOT auto-leave on unmount — the session may be minimized.
  }, [id]);

  // Query fallback so a hard refresh still loads room shape (session state stays authoritative once WS lands)
  const { data: roomFallback, isLoading } = useQuery({
    queryKey: ["room", id],
    queryFn: () => apiGetRoom(id!),
    enabled: !!id && !session.room,
  });
  const room = session.room ?? roomFallback;
  // Room members (count shown in the title sheet).
  const { data: roomMembers = [] } = useQuery({
    queryKey: ["room-members", id],
    queryFn: () => apiRoomMembers(id!),
    enabled: !!id,
  });
  const [titleSheetOpen, setTitleSheetOpen] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const chatInputRef = useRef<any>(null);
  const keyboardOpen = useKeyboardState((s) => s.isVisible);
  const [giftOpen, setGiftOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [combo, setCombo] = useState<(GiftCombo & { key: number }) | null>(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [selectedGiftRecipient, setSelectedGiftRecipient] = useState<any>(null);
  const [cardUserId, setCardUserId] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [micActionSeat, setMicActionSeat] = useState<Seat | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [changeSeatFrom, setChangeSeatFrom] = useState<number | null>(null);
  const [lockPromptOpen, setLockPromptOpen] = useState(false);
  const [bottomMoreOpen, setBottomMoreOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [pkOpen, setPkOpen] = useState(false);
  // Iter-73 — Room background preset picker (Room Tools → "الخلفية").
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  // Iter-43 — in-room half-screen game surface. Null when no game is open.
  // The Room component NEVER unmounts just because a game opens, so Agora
  // voice, seats, mic permissions and chat state are preserved.
  const [activeGame, setActiveGame] = useState<null | {
    game_type: "ludo" | "billiards";
  }>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  const mySeat: Seat | undefined = room?.seats?.find(
    (s: any) => s.user?.id === user?.id,
  );
  const onSeat = !!mySeat;
  const isOwner = !!user && !!room && room.owner_id === user.id;
  const isMod =
    isOwner || (user?.id && (room?.moderators ?? []).includes(user.id));
  // Live participant list from WS presence
  const liveParticipants: any[] = session.participants || [];

  const takeMut = useMutation({
    mutationFn: (seatIdx: number) => apiTakeSeat(id!, seatIdx),
    onSuccess: () => session.refreshRoom(),
  });
  const leaveMut = useMutation({
    mutationFn: () => apiLeaveSeat(id!),
    onSuccess: () => session.refreshRoom(),
  });
  // Owner/mod kick from seat (used by RoomUserCard when the viewed user is someone else on a mic)
  const kickMut = useMutation({
    mutationFn: (seat_index: number) =>
      apiModerate(id!, "kick_seat", seat_index),
    onSuccess: () => session.refreshRoom(),
    onError: (e: any) =>
      Alert.alert("Error", e?.message ?? "Cannot remove user from seat"),
  });
  const muteMut = useMutation({
    mutationFn: () => apiToggleMute(id!),
    onSuccess: () => session.refreshRoom(),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  // Staff-only: mute/unmute another seated user's microphone (server-enforced).
  const staffMicMut = useMutation({
    mutationFn: ({ idx, mute }: { idx: number; mute: boolean }) =>
      apiModerate(id!, mute ? "mute_seat" : "unmute_seat", idx),
    onSuccess: () => session.refreshRoom(),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const layoutMut = useMutation({
    mutationFn: (n: 8 | 15 | 20) => apiChangeLayout(id!, n),
    onSuccess: () => {
      session.refreshRoom();
      setLayoutPickerOpen(false);
      setMenuOpen(false);
      setBottomMoreOpen(false);
    },
    onError: (e: any) =>
      Alert.alert("Error", e?.message ?? "Layout change failed"),
  });
  const closeMut = useMutation({
    mutationFn: () => apiCloseRoom(id!),
    onSuccess: () => {
      setMenuOpen(false);
      // Let WS "room_closed" event drive navigation (fallback: navigate now).
      setTimeout(() => router.replace("/(tabs)/home"), 400);
    },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Failed"),
  });
  const clearChatMut = useMutation({
    mutationFn: () => apiClearRoomChat(id!),
    onSuccess: () => {
      session.clearChat();
      setMenuOpen(false);
    },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Failed"),
  });
  const settingsMut = useMutation({
    mutationFn: (patch: any) => apiUpdateRoomSettings(id!, patch),
    onSuccess: () => session.refreshRoom(),
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Failed"),
  });

  // Mic management (owner/mod)
  const micLockMut = useMutation({
    mutationFn: (payload: { seat_index: number; lock: boolean }) =>
      apiRoomModerate(
        id!,
        payload.lock ? "lock_seat" : "unlock_seat",
        payload.seat_index,
      ),
    onSuccess: () => {
      session.refreshRoom();
      setMicActionSeat(null);
    },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Failed"),
  });
  const micInviteMut = useMutation({
    mutationFn: (payload: { target_user_id: string; seat_index: number }) =>
      apiMicInvite(id!, payload.target_user_id, payload.seat_index),
    onSuccess: () => {
      // Iter-34: this is now a real invitation request — no seating on send.
      // Close the inviter's UI; the target receives a WS event.
      setInviteOpen(false);
      setMicActionSeat(null);
    },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Invite failed"),
  });
  const micInviteAcceptMut = useMutation({
    mutationFn: () => apiMicInviteAccept(id!),
    onSuccess: () => {
      session.clearPendingMicInvite();
      session.refreshRoom();
    },
    onError: (e: any) => {
      session.clearPendingMicInvite();
      Alert.alert("Error", e?.message ?? "Failed to accept invitation");
    },
  });
  const micInviteRejectMut = useMutation({
    mutationFn: () => apiMicInviteReject(id!),
    onSuccess: () => session.clearPendingMicInvite(),
    onError: () => session.clearPendingMicInvite(),
  });
  const micChangeSeatMut = useMutation({
    mutationFn: (payload: { from_index: number; to_index: number }) =>
      apiMicChangeSeat(id!, payload.from_index, payload.to_index),
    onSuccess: () => {
      session.refreshRoom();
      setChangeSeatFrom(null);
      setMicActionSeat(null);
    },
    onError: (e: any) =>
      Alert.alert("Error", e?.message ?? "Change seat failed"),
  });
  const lockRoomMut = useMutation({
    mutationFn: (pin: string) => apiRoomLock(id!, pin),
    onSuccess: () => {
      setLockPromptOpen(false);
      setMenuOpen(false);
      session.refreshRoom();
    },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Lock failed"),
  });
  const unlockRoomMut = useMutation({
    mutationFn: () => apiRoomUnlock(id!),
    onSuccess: () => {
      setMenuOpen(false);
      session.refreshRoom();
    },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Unlock failed"),
  });

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    setTimeout(
      () => chatScrollRef.current?.scrollToEnd({ animated: true }),
      40,
    );
  }, [session.chat.length]);

  const toast = useToast();
  // Iter-135 — server moderation rejected a chat line → localized warning.
  useEffect(
    () =>
      onContentBlocked(() =>
        toast.show({
          kind: "error",
          message: isRTL
            ? "لا يمكن الإرسال: يحتوي النص على كلمات مسيئة أو محظورة."
            : "Can't send: this text contains abusive or prohibited words.",
        }),
      ),
    [toast, isRTL],
  );
  const handleSeat = (seat: Seat) => {
    // iter-44 Phase 4 — Owner-seat toast: when a non-owner taps the HOST
    // chair (seat.index === 0), show the premium ORIO toast instead of a
    // silent no-op. Does NOT change seat state, Agora, or room state.
    if (
      seat.index === 0 &&
      !isOwner &&
      !(seat.user && seat.user.id === user?.id)
    ) {
      // Host chair: no popup / toast. If the owner sits there, open their card.
      if (seat.user) setCardUserId(seat.user.id);
      return;
    }
    // Iter-51 §11 — Owner/mod tapping a seated OTHER user must open the
    // normal profile card first (Change Seat lives inside the card). The old
    // 3-action sheet is still used only for empty/managed seats below.
    if (isMod && !(seat.user && seat.user.id === user?.id)) {
      if (seat.user) {
        setCardUserId(seat.user.id);
        return;
      }
      // Owner/mod tapping an empty mic → original actions sheet (Take Mic / Lock / Invite).
      setMicActionSeat(seat);
      return;
    }
    // Any seated user (including MY OWN seat) → open the RoomUserCard.
    // Card handles Leave Seat + Send Gifts for on-mic users (iter-29).
    if (seat.user) {
      setCardUserId(seat.user.id);
      return;
    }
    // Empty unlocked seat → normal users take/switch directly. Backend take_seat
    // frees any previous seat this user held, so this also performs a real seat
    // switch when the user is already on another mic.
    if (!seat.locked) {
      takeMut.mutate(seat.index, {
        onError: (e: any) =>
          toast.error(
            e?.message ?? (isRTL ? "تعذر الجلوس" : "Cannot take seat"),
          ),
      });
    }
  };

  // Room chat moderation state (server-enforced; UI mirrors it).
  const iAmChatMuted =
    !isMod && !!user?.id && (room?.chat_muted_users || []).includes(user.id);
  const chatBlockedForMe = iAmChatMuted || (!isMod && !!room?.chat_locked);
  useEffect(
    () =>
      onChatRejected((code) => {
        toast.error(
          code === "CHAT_MUTED"
            ? isRTL
              ? "تم كتمك من الدردشة في هذه الغرفة"
              : "You are muted from this room's chat"
            : isRTL
              ? "الدردشة مقفلة — المالك والمشرفون فقط"
              : "Room chat is muted — only owner & moderators can send",
        );
      }),
    [isRTL, toast],
  );
  const chatMuteMut = useMutation({
    mutationFn: ({ uid, muted }: { uid: string; muted: boolean }) =>
      apiRoomChatMute(id!, uid, muted),
    onSuccess: () => session.refreshRoom(),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const chatLockMut = useMutation({
    mutationFn: (locked: boolean) => apiRoomChatLock(id!, locked),
    onSuccess: () => session.refreshRoom(),
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const sendChat = () => {
    const t = chatInput.trim();
    if (!t || chatBlockedForMe) return;
    session.sendChat(t);
    setChatInput("");
  };
  // VIP5+ image messages (public room media; shown as thumbnails).
  const [imgBusy, setImgBusy] = useState(false);
  const sendImage = async () => {
    if (chatBlockedForMe) return;
    if (Number(user?.vip_level ?? 0) < 5) {
      toast.show({ message: "يرجى الترقية إلى VIP5" });
      return;
    }
    const picked = await pickMedia("image", 1);
    if (picked === "denied") {
      toast.error(
        isRTL ? "يرجى السماح بالوصول إلى الصور" : "Please allow photo access",
      );
      return;
    }
    if (!picked.length) return;
    setImgBusy(true);
    try {
      const url = await uploadMedia(picked[0], "post");
      await apiRoomChatImage(id!, url);
    } catch (e: any) {
      toast.error(
        e?.message || (isRTL ? "تعذر إرسال الصورة" : "Couldn't send image"),
      );
    } finally {
      setImgBusy(false);
    }
  };
  const iAmFullMuted =
    !!user?.id && (room?.full_muted_users || []).includes(user.id);
  const fullMuteMut = useMutation({
    mutationFn: ({ uid, mute }: { uid: string; mute: boolean }) =>
      apiRoomFullMute(id!, uid, mute),
    onSuccess: () => session.refreshRoom(),
    onError: (e: any) =>
      toast.error(
        /MUTED_BY_STAFF/.test(String(e?.message))
          ? isRTL
            ? "تم كتمك من قبل المشرف"
            : "Muted by a moderator"
          : (e?.message ?? "Failed"),
      ),
  });

  const seatSpeaking = useCallback(
    (seat: Seat) => {
      const u = seat?.user;
      if (!u) return false;
      if (u.id === user?.id)
        return session.isLocalSpeaking && !session.localMuted;
      const uid = uidFromObjectId(u.id);
      return (session.remoteAudioLevels[uid] ?? 0) > 5;
    },
    [
      user?.id,
      session.isLocalSpeaking,
      session.localMuted,
      session.remoteAudioLevels,
    ],
  );

  // iter-44 Phase 4 — compute normalised 0..1 audio level for the SpeakerRing.
  // Agora raw levels are 0..255 (native) or 0..100 (web). We feed the ring
  // only when the seated user is actually speaking + not muted.
  const seatLevel = useCallback(
    (seat: Seat): number => {
      const u = seat?.user;
      if (!u || seat?.muted) return 0;
      const raw =
        u.id === user?.id
          ? session.isLocalSpeaking
            ? 160
            : 0
          : (session.remoteAudioLevels[uidFromObjectId(u.id)] ?? 0);
      return Math.max(0, Math.min(1, raw / 180));
    },
    [user?.id, session.isLocalSpeaking, session.remoteAudioLevels],
  );

  const voicePill = useMemo(() => {
    switch (session.voiceStatus) {
      case "connected":
        return { color: colors.success, text: "VOICE ON" };
      case "connecting":
      case "requesting-permission":
        return { color: colors.warning, text: "CONNECTING" };
      case "reconnecting":
        return { color: colors.warning, text: "RECONNECTING" };
      case "no-permission":
        return { color: colors.error, text: "MIC BLOCKED" };
      case "error":
        return { color: colors.error, text: "VOICE ERR" };
      case "disabled":
        return { color: colors.muted, text: "VOICE OFF" };
      default:
        return { color: colors.muted, text: "VOICE IDLE" };
    }
  }, [session.voiceStatus]);

  const handleShare = useCallback(async () => {
    if (!room) return;
    try {
      await Share.share({
        message: `Join me on Yazeen — ${room.name} (Room ID: ${String(room.id).slice(-6).toUpperCase()})`,
      });
      setMenuOpen(false);
    } catch {}
  }, [room]);

  const handleMinimize = () => {
    setMenuOpen(false);
    // Session (WS + Agora + mic seat + mute state) lives in RoomSession, so
    // leaving this screen never disconnects audio.
    session.minimize();
    router.navigate("/(tabs)/home" as any);
  };

  const handleExit = () => {
    // Exit is available to ALL users. Owners keep their room open by default.
    (async () => {
      await session.leave();
      safeBack(router);
    })();
  };

  const numberedMicSeats = room?.num_seats ?? 8;
  const [headerH, setHeaderH] = useState(insets.top + 56);
  const seatMetrics = useMemo(
    () => computeSeatMetrics(numberedMicSeats, screenW, screenH, headerH),
    [numberedMicSeats, screenW, screenH, headerH],
  );

  if ((isLoading && !room) || !room) {
    return (
      <View
        style={[
          styles.container,
          { alignItems: "center", justifyContent: "center" },
        ]}
      >
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  const seats: Seat[] = room.seats ?? [];

  return (
    <View style={styles.container} testID="room-detail-screen">
      <RoomTitleSheet
        visible={titleSheetOpen}
        room={room}
        isOwner={!!user && user.id === room.owner_id}
        memberCount={(roomMembers as any[]).length}
        onClose={() => setTitleSheetOpen(false)}
        onOpenSettings={() => {
          setTitleSheetOpen(false);
          router.push(`/room/${id}/info` as any);
        }}
        onOpenOwner={(uid) => {
          setTitleSheetOpen(false);
          setCardUserId(uid);
        }}
      />
      {/* Iter-75 — Backdrop. When the owner has explicitly chosen a preset
          (or their approved custom image), render it SHARP (no blur) so the
          selected scenery is clearly visible. Otherwise we fall back to the
          cover image with the original blur treatment. Either way the image
          is scoped strictly to this room screen — never applied globally. */}
      {/* Dark room backdrop → light status-bar icons while inside the room. */}
      <StatusBar barStyle="light-content" />
      {room.background_preset_id ? (
        <Image
          source={room.background_url}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          testID="room-backdrop-sharp"
        />
      ) : (
        <Image
          source={room.cover_url}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          testID="room-backdrop-blurred"
        />
      )}
      <LinearGradient
        colors={[
          "rgba(13,13,13,0.25)",
          "rgba(13,13,13,0.45)",
          "rgba(13,13,13,0.7)",
        ]}
        style={StyleSheet.absoluteFill}
      />

      {/* Restored top header:
          [Room Name (with translucent plate)]  [People Count] [•••]
          Room name is tappable → opens the full Room Info / Settings screen
          (same screen for owner and non-owner; the Room Avatar editor is
          the first section inside Room Settings for the owner). */}
      <View
        style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (Math.abs(h - headerH) > 1) setHeaderH(h);
        }}
      >
        <Pressable
          testID="room-name-btn"
          onPress={() => setTitleSheetOpen(true)}
          style={[styles.headerTitleBlock, isRTL && { alignItems: "flex-end" }]}
          hitSlop={6}
        >
          <View style={styles.roomNamePlate}>
            <Text
              style={[styles.roomName, isRTL && { textAlign: "right" }]}
              numberOfLines={1}
              testID="room-name"
            >
              {room.name}
            </Text>
          </View>
        </Pressable>
        {/* Iter-52 — Trophy icon beside the room name opens the room's
            supporter ranking page ("ترتيب الداعمين"). */}
        <Pressable
          testID="room-trophy-btn"
          onPress={() => router.push(`/room-ranking?id=${room.id}` as any)}
          hitSlop={8}
          style={styles.trophyBtn}
          accessibilityLabel={isRTL ? "ترتيب الداعمين" : "Supporter Ranking"}
        >
          <Icon name="trophy" size={18} color="#FFD60A" />
        </Pressable>
        <View style={{ flex: 1 }} />
        {/* Viewers / participant count — real-time via WS presence */}
        <Pressable
          testID="header-viewers-btn"
          onPress={() => setParticipantsOpen(true)}
          style={styles.headerViewersBtn}
          hitSlop={6}
        >
          <Icon name="people" size={14} color={ROOM_FG} />
          <Text style={styles.headerViewersCount} testID="header-viewers-count">
            {liveParticipants.length}
          </Text>
        </Pressable>
        {/* Three-dot menu button */}
        <Pressable
          testID="header-menu-btn"
          onPress={() => setMenuOpen(true)}
          style={styles.headerMenuBtn}
          hitSlop={6}
        >
          <Icon name="ellipsis-horizontal" size={18} color={ROOM_FG} />
        </Pressable>
      </View>

      {/* People strip removed (iter-22): participant count now lives only in the header. */}

      {/* Notice banner moved into the chat area (iter-26): appears once as a
          system-style message inside the chat scroll. See notice injection below. */}

      {/* Mic Area — Iter-74/75/76/82: hard-capped at the upper 50% of the
          screen with `overflow: hidden`. Iter-82 adds extra top padding so
          the grid sits a touch lower than the room header, and keeps the
          row vertical breathing room introduced in Iter-80/81 so each
          seat's avatar + username never bleeds into the row below. */}
      <View
        testID="mic-area"
        style={{
          paddingTop: MIC_PAD_TOP,
          height: seatMetrics.areaH,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {/* Dedicated HOST chair — restored (Iter-74) to its original place
            directly above the numbered mic rows. The large circular avatar
            is the owner's live profile photo and taps open the owner card. */}
        <View
          style={[styles.hostChairWrap, isRTL && { alignSelf: "flex-end" }]}
          testID="host-chair-wrap"
        >
          <SeatBubble
            seat={seats[0] ?? { index: 0 }}
            fullMuted={
              !!seats[0]?.user &&
              (room?.full_muted_users || []).includes(seats[0].user.id)
            }
            size={seatMetrics.hostSize}
            colW={seatMetrics.hostSize + 24}
            isOwner
            hideIndex
            testID="host-chair"
            speaking={seatSpeaking(seats[0] ?? { index: 0 })}
            audioLevel={seatLevel(seats[0] ?? { index: 0 })}
            reaction={session.seatReactions[0]}
            onPress={() => handleSeat(seats[0] ?? { index: 0 })}
          />
        </View>

        {seatMetrics.rows.map((rowLen, rowIdx) => {
          // seat[0] is the host, so numbered seats begin at index 1.
          const startIndex =
            1 + seatMetrics.rows.slice(0, rowIdx).reduce((a, b) => a + b, 0);
          return (
            <View
              key={rowIdx}
              style={[
                styles.seatsRow,
                { marginTop: rowIdx === 0 ? 0 : seatMetrics.rowGap },
              ]}
            >
              {Array.from({ length: rowLen }).map((_, i) => {
                const seatIdx = startIndex + i;
                const seat: Seat = seats[seatIdx] ?? { index: seatIdx };
                return (
                  <SeatBubble
                    key={seatIdx}
                    seat={seat}
                    size={seatMetrics.seatSize}
                    colW={seatMetrics.colW}
                    hideIndex
                    speaking={seatSpeaking(seat)}
                    audioLevel={seatLevel(seat)}
                    reaction={session.seatReactions[seatIdx]}
                    fullMuted={
                      !!seat.user &&
                      (room?.full_muted_users || []).includes(seat.user.id)
                    }
                    onPress={() => handleSeat(seat)}
                  />
                );
              })}
            </View>
          );
        })}
      </View>

      {/* Chat area — flows below the mic grid; has its own independent scroll.
          NEVER overlaps mic seats. No solid dark panel behind — background stays
          continuous with the room. On very small screens the chat viewport
          shrinks; the mic grid stays put. */}
      <ScrollView
        ref={chatScrollRef}
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: 3,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Room Announcement (Notice) — injected once at the top of the chat area
            with the real owner name clickable. Uses the actual saved notice. */}
        {!!room.notice && (
          <View
            key="room-notice-in-chat"
            style={styles.chatMsg}
            testID="room-notice-in-chat"
          >
            {/* Iter-122 — row layout so VIP6+ rainbow names render natively (no Text nesting). */}
            <View style={styles.nameLine}>
              <Pressable
                onPress={() => room.owner?.id && setCardUserId(room.owner.id)}
                testID="room-notice-owner"
              >
                <VipName
                  style={[
                    styles.chatMsgText,
                    { color: colors.gold, fontWeight: "900" },
                  ]}
                  name={room.owner?.nickname || "Owner"}
                  vipLevel={room.owner_vip_level ?? room.owner?.vip_level ?? 0}
                />
              </Pressable>
              <Text style={[styles.chatMsgText, { color: colors.gold }]}>
                :{" "}
              </Text>
              <Text
                style={[
                  styles.chatMsgText,
                  { color: ROOM_FG, flexShrink: 1 },
                  isRTL && { textAlign: "right" },
                ]}
              >
                {room.notice}
              </Text>
            </View>
          </View>
        )}
        {session.chat.map((m) => (
          <View key={m.id} style={styles.chatMsg}>
            {(m as any).notice ? (
              <RoomSystemNotice isRTL={isRTL} />
            ) : (m as any).image_url ? (
              <RoomImageMessage
                m={m}
                isRTL={isRTL}
                onOpen={(uid) => setCardUserId(uid)}
              />
            ) : m.kind === "system" && (m as any).owner && m.welcome_msg ? (
              // Iter-117 — personalized welcome, sent as the room owner.
              <ChatIdentityRow
                testID={`chat-welcome-${m.user_id ?? ""}`}
                user={(m as any).owner}
                text={m.welcome_msg}
                isRTL={isRTL}
                onOpen={(uid) => setCardUserId(uid)}
              />
            ) : m.kind === "system" ? (
              m.user_id ? (
                <View style={styles.nameLine}>
                  <Pressable
                    testID={`sys-actor-${m.user_id}`}
                    onPress={() => setCardUserId(m.user_id!)}
                  >
                    {(m as any).join &&
                    Number((m as any).vip_level ?? 0) < 6 ? (
                      <Text
                        style={[
                          styles.sysMsg,
                          { color: "#FFD54A", fontWeight: "800" },
                        ]}
                      >
                        {m.nickname || "User"}
                      </Text>
                    ) : (
                      <VipName
                        style={[
                          styles.sysMsg,
                          {
                            color: (m as any).join ? "#FFD54A" : colors.gold,
                            fontWeight: "800",
                          },
                        ]}
                        name={m.nickname || "User"}
                        vipLevel={(m as any).vip_level ?? 0}
                      />
                    )}
                  </Pressable>
                  <Text
                    style={[
                      styles.sysMsg,
                      { flexShrink: 1 },
                      isRTL && { textAlign: "right" },
                    ]}
                  >
                    {" "}
                    {(m as any).join
                      ? isRTL
                        ? "انضم إلى الغرفة"
                        : "joined the room"
                      : m.welcome_msg
                        ? `👋 ${m.welcome_msg}`
                        : m.text.startsWith(m.nickname || "")
                          ? m.text.slice((m.nickname || "").length).trimStart()
                          : m.text}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.sysMsg, isRTL && { textAlign: "right" }]}>
                  {m.text}
                </Text>
              )
            ) : m.kind === "reaction" ? (
              <ChatIdentityRow
                testID={`chat-reaction-${m.user_id ?? ""}`}
                user={{
                  id: m.user_id,
                  nickname: m.nickname,
                  avatar_url: (m as any).avatar_url,
                  vip_level: (m as any).vip_level,
                  wealth_level: (m as any).wealth_level,
                  charm_level: (m as any).charm_level,
                }}
                text=""
                isRTL={isRTL}
                onOpen={(uid) => setCardUserId(uid)}
                content={
                  <AnimatedEmoji emoji={(m as any).emoji} size={44} loop />
                }
              />
            ) : m.kind === "gift" ? (
              <RoomGiftMessage
                m={m}
                isRTL={isRTL}
                onOpen={(uid) => setCardUserId(uid)}
              />
            ) : (
              <ChatIdentityRow
                testID={`chat-author-${m.user_id ?? ""}`}
                user={{
                  id: m.user_id,
                  nickname: m.nickname,
                  avatar_url: (m as any).avatar_url,
                  vip_level: (m as any).vip_level,
                  wealth_level: (m as any).wealth_level,
                  charm_level: (m as any).charm_level,
                  is_new: (m as any).is_new,
                }}
                text={m.text}
                isRTL={isRTL}
                onOpen={(uid) => setCardUserId(uid)}
                renderText={renderMessageText}
              />
            )}
          </View>
        ))}
      </ScrollView>

      {keyboardOpen && (
        <Pressable
          testID="room-keyboard-dismiss"
          style={StyleSheet.absoluteFill}
          onPress={() => Keyboard.dismiss()}
        />
      )}

      {/* Bottom action bar with always-visible chat input — normal flow, below chat */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <KeyboardStickyView
          enabled={Platform.OS === "android"}
          offset={{ closed: 0, opened: insets.bottom }}
        >
          <View
            style={[
              styles.actionBar,
              { paddingBottom: insets.bottom + spacing.sm },
            ]}
          >
            <View
              style={[
                styles.chatInputBox,
                styles.chatInputRow,
                chatBlockedForMe && { opacity: 0.5 },
              ]}
              testID={chatBlockedForMe ? "chat-input-disabled" : undefined}
            >
              <Pressable
                testID="chat-image-btn"
                onPress={sendImage}
                hitSlop={6}
                style={styles.inBoxBtn}
                disabled={imgBusy}
              >
                {imgBusy ? (
                  <ActivityIndicator size="small" color={ROOM_FG} />
                ) : (
                  <Icon name="image-outline" size={18} color={ROOM_FG_DIM} />
                )}
              </Pressable>
              <TextInput
                ref={chatInputRef}
                testID="chat-input"
                value={chatInput}
                onChangeText={setChatInput}
                editable={!chatBlockedForMe}
                placeholder={
                  chatBlockedForMe
                    ? iAmChatMuted
                      ? "تم كتمك من الدردشة مؤقتاً"
                      : "لقد تم كتم دردشة الغرفة مؤقتاً"
                    : isRTL
                      ? "اكتب رسالة…"
                      : "Say something…"
                }
                placeholderTextColor={ROOM_FG_DIM}
                style={[styles.chatInput, isRTL && { textAlign: "right" }]}
                onSubmitEditing={sendChat}
                returnKeyType="send"
                maxLength={500}
              />
              <Pressable
                testID="chat-send-btn"
                onPress={sendChat}
                hitSlop={6}
                style={styles.inBoxBtn}
              >
                <Icon
                  name="send"
                  size={17}
                  color={chatInput.trim() ? colors.gold : ROOM_FG_DIM}
                  style={isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
                />
              </Pressable>
              {chatBlockedForMe && (
                // Blocks focus/keyboard; tapping shows the ORIO bottom toast.
                <Pressable
                  testID="chat-input-blocker"
                  style={StyleSheet.absoluteFill}
                  onPress={() =>
                    toast.show({
                      message: iAmChatMuted
                        ? "تم كتمك من الدردشة مؤقتاً"
                        : "لقد تم كتم دردشة الغرفة مؤقتاً",
                    })
                  }
                />
              )}
            </View>
            <View style={[styles.actionsRow, styles.actionButtonsRow]}>
              {/* Mic toggle — voice-only mute. Disabled + dimmed while a full mute is active. */}
              {onSeat && (
                <Pressable
                  testID="mic-btn"
                  onPress={() =>
                    iAmFullMuted
                      ? toast.warning(
                          isRTL
                            ? "تم كتم المايك بالكامل"
                            : "Your mic is fully muted",
                        )
                      : muteMut.mutate()
                  }
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor:
                        mySeat?.muted || iAmFullMuted
                          ? colors.micMuted
                          : colors.micActive,
                    },
                    iAmFullMuted && { opacity: 0.4 },
                  ]}
                >
                  <Icon
                    name={!(mySeat?.muted || iAmFullMuted) ? "mic" : "mic-off"}
                    size={18}
                    color={ROOM_FG}
                  />
                </Pressable>
              )}
              <Pressable
                testID="emoji-btn"
                onPress={() => setEmojiOpen(true)}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: "rgba(0,0,0,0.55)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.35)",
                  },
                ]}
              >
                <Icon name="happy-outline" size={19} color={ROOM_FG} />
              </Pressable>
              <Pressable
                testID="gift-btn"
                onPress={() => {
                  setSelectedGiftRecipient(room.owner);
                  setGiftOpen(true);
                }}
                style={[styles.actionBtn, { backgroundColor: colors.gold }]}
              >
                <Icon name="gift" size={18} color={colors.onBrandPrimary} />
              </Pressable>
              {/* Mute Room — LOCAL (personal) mute of all remote audio. Instant, no server call. */}
              <Pressable
                testID="mute-room-btn"
                onPress={() => session.setRoomMuted(!session.roomMuted)}
                style={[
                  styles.actionBtn,
                  // Clearly visible on any room background; red while incoming audio is muted locally.
                  {
                    backgroundColor: session.roomMuted
                      ? colors.error
                      : "rgba(0,0,0,0.55)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.35)",
                  },
                ]}
              >
                <Icon
                  name={
                    session.roomMuted ? "volume-mute" : "volume-high-outline"
                  }
                  size={18}
                  color={ROOM_FG}
                />
              </Pressable>
              {/* Section 15: bottom four-dot menu (Music + PK Challenge) — replaces the old Exit button */}
              <Pressable
                testID="room-more-btn"
                onPress={() => setBottomMoreOpen(true)}
                style={[
                  styles.actionBtn,
                  { backgroundColor: colors.brandSecondary },
                ]}
              >
                <Icon name="apps" size={16} color={ROOM_FG} />
              </Pressable>
            </View>
          </View>
        </KeyboardStickyView>
      </KeyboardAvoidingView>

      {/* Gifts sheet (iter-37 rewrite: multi-recipient + tabs + qty presets + repeat combo) */}
      {giftOpen && (
        <GiftPanel
          preselectedRecipient={selectedGiftRecipient}
          roomId={id!}
          seats={seats}
          participants={session.participants || []}
          me={user}
          owner={room?.owner}
          onClose={() => setGiftOpen(false)}
          onSent={(c: GiftCombo) => setCombo({ ...c, key: Date.now() })}
        />
      )}
      {combo && (
        <RoomComboButton
          combo={combo}
          roomId={id!}
          isRTL={isRTL}
          bottom={insets.bottom + 64}
          onDone={() => setCombo(null)}
          onError={(m) => toast.error(m)}
          onBalance={() => refresh?.().catch?.(() => {})}
        />
      )}

      {/* Room menu — permission-aware. Menu button hides while this is open */}
      <RoomMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onExit={handleExit}
        onShare={handleShare}
        onMinimize={handleMinimize}
        onMuteSelf={() => onSeat && muteMut.mutate()}
        onClearChat={() => clearChatMut.mutate()}
        onToggleEntrance={(v) => settingsMut.mutate({ entrance_effects: v })}
        onToggleNoise={(v) => settingsMut.mutate({ noise_reduction: v })}
        onOpenLayoutPicker={() => {
          setMenuOpen(false);
          setLayoutPickerOpen(true);
        }}
        onToggleRoomMute={() => session.setRoomMuted(!session.roomMuted)}
        roomMuted={session.roomMuted}
        onLockRoom={() => {
          setLockPromptOpen(true);
          setMenuOpen(false);
        }}
        onUnlockRoom={() => unlockRoomMut.mutate()}
        isRoomLocked={!!room?.is_locked}
        isOwnerOrMod={!!isMod}
        isOnSeat={onSeat}
        currentSelfMuted={!!mySeat?.muted}
        room={room}
        onReport={() => {
          setMenuOpen(false);
          router.push(`/report?room_id=${id}` as any);
        }}
        chatLocked={!!room?.chat_locked}
        onToggleChatLock={(v) => chatLockMut.mutate(v)}
      />

      <LayoutPicker
        visible={layoutPickerOpen}
        current={numberedMicSeats}
        loading={layoutMut.isPending}
        onClose={() => setLayoutPickerOpen(false)}
        onPick={(n) => layoutMut.mutate(n)}
      />

      <RoomBackgroundPicker
        visible={bgPickerOpen}
        roomId={id!}
        currentUrl={room.background_url || room.cover_url}
        currentPresetId={room.background_preset_id || null}
        customUrl={room.custom_background_url || null}
        onClose={() => setBgPickerOpen(false)}
        onApplied={() => {
          session.refreshRoom();
          setBgPickerOpen(false);
        }}
        isRTL={isRTL}
      />

      {/* User popup card — tap any avatar in the room */}
      <RoomUserCard
        visible={!!cardUserId}
        userId={cardUserId}
        isOnSeat={!!seats.find((s) => s.user?.id === cardUserId)}
        isMe={cardUserId === user?.id}
        isViewerOwner={isOwner}
        isViewerMod={!!isMod}
        targetIsPriv={
          !!cardUserId &&
          (cardUserId === room?.owner_id ||
            (room?.moderators || []).includes(cardUserId))
        }
        chatMuted={
          !!cardUserId && (room?.chat_muted_users || []).includes(cardUserId)
        }
        onToggleChatMute={
          isMod && cardUserId
            ? () =>
                chatMuteMut.mutate({
                  uid: cardUserId,
                  muted: !(room?.chat_muted_users || []).includes(cardUserId),
                })
            : undefined
        }
        roomId={room?.id}
        seatIndex={seats.find((s) => s.user?.id === cardUserId)?.index}
        seatMuted={
          !!cardUserId && (room?.full_muted_users || []).includes(cardUserId)
        }
        onToggleMic={() => {
          if (!cardUserId || !seats.find((s) => s.user?.id === cardUserId))
            return;
          if (cardUserId !== user?.id && !isMod) return;
          fullMuteMut.mutate({
            uid: cardUserId,
            mute: !(room?.full_muted_users || []).includes(cardUserId),
          });
        }}
        seats={seats}
        onClose={() => setCardUserId(null)}
        onLeaveSeat={() => {
          setCardUserId(null);
          // Iter-50 — Leave Seat is self-only in the card now, so this branch
          // only fires for the current user leaving their own seat.
          if (cardUserId === user?.id) {
            leaveMut.mutate();
          }
        }}
        onSendGift={() => {
          const target =
            seats.find((s) => s.user?.id === cardUserId)?.user ?? room.owner;
          setSelectedGiftRecipient(target);
          setCardUserId(null);
          setGiftOpen(true);
        }}
        onOpenFullProfile={() => {
          const id = cardUserId;
          setCardUserId(null);
          if (id) router.push(`/user/${id}` as any);
        }}
        onMention={(u) => {
          // Iter-51 §5 — Insert "@nickname " into ROOM CHAT input (not private
          // chat) and focus the input so the user can continue typing. The
          // mention renders yellow when sent, via Iter-48 renderMessageText.
          setChatInput((prev) => {
            const prefix =
              prev.length && !prev.endsWith(" ") ? prev + " " : prev;
            return `${prefix}@${u.nickname} `;
          });
          setTimeout(() => {
            try {
              chatInputRef.current?.focus?.();
            } catch {}
          }, 60);
        }}
      />

      {/* Real-time participants sheet */}
      <ParticipantsSheet
        visible={participantsOpen}
        participants={liveParticipants}
        onClose={() => setParticipantsOpen(false)}
        onOpenUser={(uid: string) => {
          setParticipantsOpen(false);
          setCardUserId(uid);
        }}
      />

      {/* Iter-68 — Avatar editing was moved back into the full Room Settings
          screen (`/room/{id}/info`) as a dedicated "Room Avatar" section. The
          in-room avatar modal is no longer rendered. */}

      {/* Mic action sheet — privileged (owner/mod) full or limited (regular user) Sit/Leave */}
      <MicActionSheet
        seat={micActionSeat}
        isRTL={isRTL}
        isPrivileged={!!isMod}
        isSelfOnSeat={onSeat}
        myUserId={user?.id}
        onClose={() => setMicActionSeat(null)}
        onTakeMic={() => {
          if (!micActionSeat) return;
          const idx = micActionSeat.index;
          setMicActionSeat(null);
          takeMut.mutate(idx, {
            onError: (e: any) =>
              Alert.alert("Error", e?.message ?? "Cannot take mic"),
          });
        }}
        onChangeSeat={() => {
          if (micActionSeat) {
            setChangeSeatFrom(micActionSeat.index);
            setMicActionSeat(null);
          }
        }}
        onInvite={() => setInviteOpen(true)}
        onLock={(lock: boolean) =>
          micActionSeat &&
          micLockMut.mutate({ seat_index: micActionSeat.index, lock })
        }
        onSit={() => {
          if (!micActionSeat) return;
          const idx = micActionSeat.index;
          setMicActionSeat(null);
          takeMut.mutate(idx, {
            onError: (e: any) =>
              Alert.alert("Error", e?.message ?? "Cannot take seat"),
          });
        }}
        onLeave={() => {
          setMicActionSeat(null);
          leaveMut.mutate();
        }}
      />

      {/* Owner/moderator invite → seat picker of in-room non-seated users */}
      <InviteToSeatSheet
        visible={inviteOpen}
        seat={micActionSeat}
        participants={liveParticipants}
        seatedIds={new Set(seats.filter((s) => s.user).map((s) => s.user!.id))}
        onClose={() => setInviteOpen(false)}
        onPick={(uid: string) =>
          micActionSeat &&
          micInviteMut.mutate({
            target_user_id: uid,
            seat_index: micActionSeat.index,
          })
        }
      />

      {/* Owner/moderator change-seat destination picker */}
      <ChangeSeatSheet
        visible={changeSeatFrom !== null}
        fromIndex={changeSeatFrom ?? -1}
        seats={seats}
        onClose={() => setChangeSeatFrom(null)}
        onPick={(to: number) =>
          changeSeatFrom !== null &&
          micChangeSeatMut.mutate({ from_index: changeSeatFrom, to_index: to })
        }
      />

      {/* Iter-131 — equipped VIP entrance (room entry only; respects the room toggle). */}
      {room?.settings?.entrance_effects !== false && (
        <EntranceOverlay
          entry={session.entrance}
          onDone={session.clearEntrance}
        />
      )}

      {/* Batch B — synchronized transparent gift animations (≤ 50% width). */}
      <GiftFxOverlay event={session.giftFx} isRTL={isRTL} />
      <EmojiPicker
        visible={emojiOpen}
        isRTL={isRTL}
        onClose={() => setEmojiOpen(false)}
        onPick={(k) => {
          setEmojiOpen(false);
          if (!session.sendReaction(k))
            toast.info(
              isRTL
                ? "انتظر قليلاً قبل إرسال تفاعل آخر"
                : "Please wait a moment before reacting again",
            );
        }}
      />

      {/* Iter-34: incoming mic invitation for THIS user (Accept / Reject).
          Fed by RoomSession.pendingMicInvite via the mic_invite_request WS event. */}
      <MicInviteIncoming
        visible={!!session.pendingMicInvite}
        invite={session.pendingMicInvite}
        isRTL={isRTL}
        accepting={micInviteAcceptMut.isPending}
        rejecting={micInviteRejectMut.isPending}
        onAccept={() => micInviteAcceptMut.mutate()}
        onReject={() => micInviteRejectMut.mutate()}
      />
      {/* Room lock 5-digit code prompt (owner/mod) */}
      <LockRoomPrompt
        visible={lockPromptOpen}
        onClose={() => setLockPromptOpen(false)}
        loading={lockRoomMut.isPending}
        onSubmit={(pin: string) => lockRoomMut.mutate(pin)}
      />

      {/* Bottom four-dot menu — Iter-73: Room Tools (Music + PK + Games + Mic Mode + Background). Minimize is Room Controls only. */}
      <BottomMoreSheet
        visible={bottomMoreOpen}
        onClose={() => setBottomMoreOpen(false)}
        onMusic={() => {
          setBottomMoreOpen(false);
          setMusicOpen(true);
        }}
        onPk={() => {
          setBottomMoreOpen(false);
          setPkOpen(true);
        }}
        onGames={() => {
          setBottomMoreOpen(false);
          router.push(`/games?room_id=${id}` as any);
        }}
        onOpenInRoomGame={(gameType) => {
          setBottomMoreOpen(false);
          setActiveGame({ game_type: gameType });
        }}
        onMicMode={() => {
          setBottomMoreOpen(false);
          setLayoutPickerOpen(true);
        }}
        onBackground={() => {
          setBottomMoreOpen(false);
          setBgPickerOpen(true);
        }}
        isOwnerOrMod={!!isMod}
      />
      {/* Iter-43 — In-room half-screen game surface. Preserves Agora, seats, mic state. */}
      {activeGame && id && (
        <InRoomGameSurface
          roomId={id}
          gameType={activeGame.game_type}
          onClose={() => setActiveGame(null)}
        />
      )}
      {/* Real Music sheet — expo-document-picker + expo-audio */}
      <MusicSheet
        visible={musicOpen}
        onClose={() => setMusicOpen(false)}
        roomId={id!}
        isSeated={!!mySeat}
        isRTL={isRTL}
      />

      {/* PK Challenge panel */}
      <PkPanel
        visible={pkOpen}
        onClose={() => setPkOpen(false)}
        roomId={id!}
        seats={seats}
        isMod={!!isMod}
      />
    </View>
  );
}

// ------------------------------- Seat metrics --------------------------------

// Fixed geometry of the mic area (all values in dp). Every seat reserves the
// SAME box (avatar + fixed-height name slot) whether occupied or empty, so
// seats never move, grow or shrink when users join / leave.
// Room surface sits on a (dark) custom background → light foreground.
const ROOM_FG = "#FFFFFF";
const ROOM_FG_DIM = "rgba(255,255,255,0.72)";
const MIC_PAD_TOP = 8;
const MIC_PAD_BOTTOM = 8;
const SEAT_LABEL_H = 16; // name slot below every seat (occupied or empty)
const HOST_BADGE_H = 0; // "HOST" label removed (Batch C) — host seat unchanged
const HOST_GAP = 6; // host block → first mic row

function computeSeatMetrics(
  numberedMicSeats: number,
  screenW: number,
  screenH: number,
  headerH: number,
) {
  // Row structures (host chair always sits above, separate):
  //   8 → 2 × 4 · 15 → 3 × 5 · 20 → 4 × 5
  const rows: number[] =
    numberedMicSeats <= 8
      ? [4, 4]
      : numberedMicSeats <= 15
        ? [5, 5, 5]
        : [5, 5, 5, 5];
  const perRow = Math.max(...rows);
  const sidePad = 12;
  // Equal-width columns → even horizontal distribution; names are clamped
  // to their column so neighbours never overlap.
  const colW = Math.floor((screenW - sidePad * 2) / perRow);
  const hostRatio = rows.length >= 4 ? 1.25 : rows.length === 3 ? 1.35 : 1.5;
  // Strict budget: header + mic area must end at or above screenH × 0.5.
  const budget = Math.max(140, Math.floor(screenH * 0.5 - headerH));
  const n = rows.length;
  const MIN_GAP = 6;
  const fixed =
    MIC_PAD_TOP +
    MIC_PAD_BOTTOM +
    HOST_BADGE_H +
    SEAT_LABEL_H +
    HOST_GAP +
    n * SEAT_LABEL_H +
    (n - 1) * MIN_GAP;
  const seatByH = Math.floor((budget - fixed) / (hostRatio + n));
  const seatByW = colW - 14;
  let seatSize = Math.max(
    22,
    Math.min(perRow === 4 ? 64 : 56, seatByW, seatByH),
  );
  // Hard clamp: shrink until the whole block fits the 50 % budget (tiny screens).
  while (
    seatSize > 22 &&
    fixed + Math.round(seatSize * hostRatio) + n * seatSize > budget
  )
    seatSize--;
  const hostSize = Math.round(seatSize * hostRatio);
  // Spread any leftover height into the row gaps (comfortable vertical
  // spacing) but never beyond the 50 % budget.
  const used = fixed + hostSize + n * seatSize;
  const rowGap =
    n > 1
      ? Math.min(
          26,
          MIN_GAP + Math.max(0, Math.floor((budget - used) / (n - 1))),
        )
      : 0;
  const areaH =
    MIC_PAD_TOP +
    HOST_BADGE_H +
    hostSize +
    SEAT_LABEL_H +
    HOST_GAP +
    n * (seatSize + SEAT_LABEL_H) +
    (n - 1) * rowGap +
    MIC_PAD_BOTTOM;
  return { rows, seatSize, hostSize, colW, rowGap, areaH };
}

// ------------------------------- Seat bubble ---------------------------------

function SeatBubble({
  seat,
  onPress,
  size,
  isOwner,
  speaking,
  audioLevel,
  hideIndex,
  testID,
  colW,
  reaction,
  fullMuted,
}: {
  fullMuted?: boolean;
  seat: Seat;
  size: number;
  /** Batch B — active emoji reaction over this seat (5s). */
  reaction?: { emoji: string; id: string };
  /** Fixed column width reserved for this seat (never changes with occupancy). */
  colW: number;
  onPress: () => void;
  isOwner?: boolean;
  speaking?: boolean;
  /** Normalised 0..1 audio level for the SpeakerRing waveform. */
  audioLevel?: number;
  hideIndex?: boolean;
  testID?: string;
}) {
  const u = seat?.user;
  const muted = seat?.muted || fullMuted;
  const locked = seat?.locked;
  // Numbered mic seats display seat.index (1..N) since the host occupies index 0.
  const seatNumber = seat?.index ?? 0;
  // Only draw the watery white ring when the user is actually speaking + not muted.
  const level = speaking && !muted ? (audioLevel ?? 0.4) : 0;
  return (
    <View
      style={{
        alignItems: "center",
        width: colW,
        height: size + SEAT_LABEL_H,
        position: "relative",
      }}
    >
      <View style={{ width: size, height: size, position: "relative" }}>
        {/* iter-44 Phase 4 — watery white speaker-ring overlay. Lives outside
            the Pressable's image so it NEVER covers the avatar. */}
        <SpeakerRing level={level} size={size} />
        <Pressable
          testID={testID ?? `seat-${seatNumber}`}
          onPress={onPress}
          style={({ pressed }) => [
            styles.seat,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
            },
            // Owner identifier border (NOT a mic glow — kept as a stable role
            // marker). The SpeakerRing above is the ONLY speaking indicator.
            isOwner && {
              borderWidth: 2,
              borderColor: colors.brandPrimary + "99",
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          {u ? (
            <>
              <Image
                source={u.avatar_url}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              {/* Iter-71 — No VIP badges / crowns / frames / icons overlaid on
                seat avatars. Mic seats stay visually clean per spec. */}
            </>
          ) : locked ? (
            <View style={styles.emptySeat}>
              <Icon name="lock-closed" size={16} color={ROOM_FG_DIM} />
            </View>
          ) : (
            <View style={styles.emptySeat}>
              <Icon name="add" size={20} color={ROOM_FG_DIM} />
            </View>
          )}
        </Pressable>
        {u && reaction && (
          <View
            style={[
              StyleSheet.absoluteFill,
              { alignItems: "center", justifyContent: "center" },
            ]}
            pointerEvents="none"
            testID={`seat-reaction-${seatNumber}`}
          >
            <AnimatedEmoji
              emoji={reaction.emoji}
              size={size}
              playKey={reaction.id}
            />
          </View>
        )}
      </View>
      {/* Section 13: mute badge rendered OUTSIDE the Pressable so it can visually
          sit outside the avatar circle without being clipped by overflow:hidden. */}
      {u && fullMuted && (
        <View
          testID={`seat-full-muted-${seatNumber}`}
          style={[
            styles.mutedOverlay,
            {
              // Positioned just outside the bottom-right of the circular avatar.
              // wrapper width is (size + 8) with the seat centered → half margin = 4.
              bottom: SEAT_LABEL_H - 4,
              right: Math.max(0, (colW - size) / 2 - 6),
            },
          ]}
          pointerEvents="none"
        >
          <Icon name="mic-off" size={12} color="#FFFFFF" />
        </View>
      )}
      {/* Bottom label: occupied → nickname; empty numbered seat → seat number */}
      <View style={styles.seatLabelSlot}>
        {u ? (
          <VipName
            style={[styles.seatName, { maxWidth: colW - 4 }]}
            numberOfLines={1}
            name={u?.nickname}
            color={(u as any)?.name_color}
            vipLevel={(u as any)?.vip_level}
          />
        ) : !hideIndex ? (
          <Text style={styles.seatIdx} numberOfLines={1}>
            {seatNumber}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ------------------------------- Room menu -----------------------------------

function RoomMenu({
  visible,
  onClose,
  onExit,
  onShare,
  onMinimize,
  onMuteSelf,
  onClearChat,
  onToggleEntrance,
  onToggleNoise,
  onOpenLayoutPicker,
  onToggleRoomMute,
  roomMuted,
  onLockRoom,
  onUnlockRoom,
  isRoomLocked,
  isOwnerOrMod,
  isOnSeat,
  currentSelfMuted,
  room,
  onReport,
  chatLocked,
  onToggleChatLock,
}: {
  onReport: () => void;
  chatLocked: boolean;
  onToggleChatLock: (v: boolean) => void;
  visible: boolean;
  onClose: () => void;
  onExit: () => void;
  onShare: () => void;
  onMinimize: () => void;
  onMuteSelf: () => void;
  onClearChat: () => void;
  onToggleEntrance: (v: boolean) => void;
  onToggleNoise: (v: boolean) => void;
  onOpenLayoutPicker: () => void;
  onToggleRoomMute: () => void;
  roomMuted: boolean;
  onLockRoom: () => void;
  onUnlockRoom: () => void;
  isRoomLocked: boolean;
  isOwnerOrMod: boolean;
  isOnSeat: boolean;
  currentSelfMuted: boolean;
  room: any;
}) {
  const insets = useSafeAreaInsets();
  const { isRTL } = useI18n();
  const settings = room?.settings || {
    entrance_effects: true,
    noise_reduction: true,
  };
  const [pinging, setPinging] = useState(false);
  const [ping, setPing] = useState<number | null>(null);

  const measurePing = useCallback(async () => {
    setPinging(true);
    setPing(null);
    try {
      const start = performance.now();
      const url = `${process.env.EXPO_PUBLIC_BACKEND_URL ?? ""}/api/rtc/config`;
      await fetch(url).catch(() => null);
      const end = performance.now();
      setPing(Math.round(end - start));
    } finally {
      setPinging(false);
    }
  }, []);

  useEffect(() => {
    if (visible) measurePing();
  }, [visible, measurePing]);

  if (!visible) return null;

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="room-menu"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>Room controls</Text>

          <View style={styles.menuGrid}>
            {/* Row 1: Share, Exit, Minimize */}
            <MenuItem
              icon="share-social-outline"
              label="Share"
              testID="menu-share"
              onPress={onShare}
            />
            <MenuItem
              icon="log-out-outline"
              label="Exit"
              tone="danger"
              testID="menu-exit"
              onPress={onExit}
            />
            <MenuItem
              icon="contract-outline"
              label="Minimize"
              testID="menu-minimize"
              onPress={onMinimize}
            />
            <MenuItem
              icon="flag-outline"
              label="Report"
              tone="danger"
              testID="menu-report-room"
              onPress={onReport}
            />
            {/* Row 2: Clear Chat, Mute (Iter-73 — Mic Mode moved to Room Tools) */}
            {/* Owner/mod-only tools are hidden entirely for regular users. */}
            {isOwnerOrMod && (
              <MenuItem
                icon="trash-outline"
                label="Clear chat"
                tone="danger"
                testID="menu-clear-chat"
                onPress={() =>
                  confirmDialog(
                    "Clear chat?",
                    "This clears the room's chat history for everyone.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Clear",
                        style: "destructive",
                        onPress: onClearChat,
                      },
                    ],
                  )
                }
              />
            )}
            {isOwnerOrMod && (
              <MenuItem
                icon={chatLocked ? "chatbubbles" : "chatbubbles-outline"}
                label={
                  chatLocked
                    ? isRTL
                      ? "إلغاء كتم الدردشة"
                      : "Unmute Chat"
                    : isRTL
                      ? "كتم الدردشة"
                      : "Mute Chat"
                }
                testID="menu-mute-chat"
                onPress={() => onToggleChatLock(!chatLocked)}
              />
            )}
          </View>

          <View style={styles.togglesBox}>
            {isOwnerOrMod && (
              <>
                <ToggleRow
                  icon="sparkles-outline"
                  label="Entrance effects"
                  value={!!settings.entrance_effects}
                  onChange={onToggleEntrance}
                  testID="menu-entrance-effects"
                />
                <View style={styles.divider} />
                <ToggleRow
                  icon="filter-outline"
                  label="Noise reduction"
                  value={!!settings.noise_reduction}
                  onChange={onToggleNoise}
                  testID="menu-noise-reduction"
                />
                <View style={styles.divider} />
              </>
            )}
            <View style={styles.togglesRow}>
              <Icon
                name="speedometer-outline"
                size={18}
                color={colors.onSurfaceSecondary}
              />
              <Text style={styles.togglesLabel}>Network speed</Text>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={measurePing}
                disabled={pinging}
                hitSlop={10}
                testID="menu-network-speed"
              >
                <Text style={styles.pingText}>
                  {pinging ? "…" : ping != null ? `${ping} ms` : "test"}
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  tone,
  disabled,
  testID,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  tone?: "danger";
  disabled?: boolean;
  testID?: string;
}) {
  const color = tone === "danger" ? colors.error : colors.onSurface;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.menuItem,
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View
        style={[
          styles.menuIconWrap,
          tone === "danger" && { backgroundColor: colors.error + "22" },
        ]}
      >
        <Icon name={icon} size={22} color={color} />
      </View>
      <Text style={[styles.menuLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onChange,
  disabled,
  testID,
}: {
  icon: any;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.togglesRow}>
      <Icon name={icon} size={18} color={colors.onSurfaceSecondary} />
      <Text style={styles.togglesLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        thumbColor={value ? colors.gold : colors.muted}
        trackColor={{ true: colors.gold + "66", false: colors.surfaceTertiary }}
        testID={testID}
      />
    </View>
  );
}

// ------------------------------- Layout picker -------------------------------

function LayoutPicker({
  visible,
  current,
  loading,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: number;
  loading: boolean;
  onClose: () => void;
  onPick: (n: 8 | 15 | 20) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const options: { n: 8 | 15 | 20; sub: string }[] = [
    { n: 8, sub: "Cozy — 1 host + 8 mic seats" },
    { n: 15, sub: "Party — 1 host + 15 mic seats" },
    { n: 20, sub: "Concert — 1 host + 20 mic seats" },
  ];
  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="layout-picker"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>Mic Mode / وضعيات الميكات</Text>
          <Text style={styles.menuHint}>
            Applies instantly to everyone in the room.
          </Text>
          {options.map((o) => (
            <Pressable
              key={o.n}
              testID={`layout-option-${o.n}`}
              onPress={() => onPick(o.n)}
              disabled={loading || current === o.n}
              style={[
                styles.layoutRow,
                current === o.n && { borderColor: colors.gold, borderWidth: 2 },
              ]}
            >
              <View style={styles.layoutBadge}>
                <Text style={styles.layoutBadgeText}>{o.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.layoutName}>{o.n} seats</Text>
                <Text style={styles.layoutSub}>{o.sub}</Text>
              </View>
              {current === o.n && (
                <Icon name="checkmark-circle" size={22} color={colors.gold} />
              )}
            </Pressable>
          ))}
          {loading && (
            <View style={{ marginTop: 8, alignItems: "center" }}>
              <ActivityIndicator color={colors.gold} />
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ------------------------------- Background picker ---------------------------

function RoomBackgroundPicker({
  visible,
  roomId,
  currentUrl,
  currentPresetId,
  customUrl,
  onClose,
  onApplied,
  isRTL,
}: {
  visible: boolean;
  roomId: string;
  currentUrl?: string | null;
  currentPresetId?: string | null;
  customUrl?: string | null;
  onClose: () => void;
  onApplied: () => void;
  isRTL: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  // Iter-82 — Custom-image access flow state.
  const [customSheetOpen, setCustomSheetOpen] = useState(false);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyBusy, setBuyBusy] = useState(false);
  const { data: entitlement } = useQuery({
    queryKey: ["custom-bg-entitlement"],
    queryFn: apiGetCustomBgEntitlement,
    enabled: visible,
    staleTime: 10_000,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["room-bg-catalog"],
    queryFn: apiRoomBackgroundsCatalog,
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  if (!visible) return null;

  const apply = async (bg: PremiumRoomBackground) => {
    setApplyingId(bg.id);
    setErr(null);
    try {
      await apiSetRoomBackgroundPreset(roomId, bg.id);
      onApplied();
    } catch (e: any) {
      setErr(e?.message || "Could not apply background");
    } finally {
      setApplyingId(null);
    }
  };

  // Iter-82 — the actual upload runs only AFTER access is granted (either
  // VIP6+ unlimited or the 15-day 50 000 Diamonds pass is active).
  const launchUpload = async () => {
    setErr(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErr(
          isRTL
            ? "يرجى السماح بالوصول إلى الصور."
            : "Please allow photo library access.",
        );
        return;
      }
      const res = await pickAndCrop({ aspect: [9, 16], base64: true });
      if (res.canceled) return;
      const a = res.assets?.[0];
      if (!a) return;
      const mime = (a.mimeType || "").toLowerCase();
      const uriLow = (a.uri || "").toLowerCase();
      const nameLow = (a.fileName || "").toLowerCase();
      let looksGif =
        mime.includes("gif") ||
        uriLow.endsWith(".gif") ||
        nameLow.endsWith(".gif");
      if (!looksGif && a.base64 && a.base64.slice(0, 16).startsWith("R0lGOD"))
        looksGif = true;
      if (looksGif || mime.startsWith("video")) {
        setErr(isRTL ? "صور ثابتة فقط." : "Static images only.");
        return;
      }
      const dataUri = a.base64
        ? `data:${mime || "image/jpeg"};base64,${a.base64}`
        : a.uri;
      setCustomBusy(true);
      try {
        const r = await apiSubmitCustomRoomBackground(roomId, dataUri);
        Alert.alert(
          isRTL ? "تم الإرسال" : "Submitted",
          r?.message ||
            (isRTL
              ? "ستتم المراجعة خلال 24 ساعة."
              : "Will be reviewed within 24 hours."),
        );
        onClose();
      } catch (e: any) {
        setErr(e?.message || (isRTL ? "تعذر الإرسال." : "Submission failed."));
      } finally {
        setCustomBusy(false);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed");
      setCustomBusy(false);
    }
  };

  // Iter-82 — the "+ Custom Image" tile opens a 3-option bottom sheet
  // instead of jumping straight into the upload flow.
  const confirmUpload = () => {
    setCustomSheetOpen(true);
  };

  const handleBuyPass = async () => {
    setBuyBusy(true);
    setErr(null);
    try {
      await apiPurchaseCustomBgPass();
      setBuyModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["custom-bg-entitlement"] });
      await launchUpload();
    } catch (e: any) {
      setErr(e?.message || (isRTL ? "تعذر الشراء" : "Purchase failed"));
    } finally {
      setBuyBusy(false);
    }
  };

  const handleVip6Path = () => {
    setCustomSheetOpen(false);
    const vipLvl = entitlement?.vip_level ?? 0;
    if (vipLvl >= 6) {
      launchUpload();
    } else {
      onClose();
      router.push("/vip" as any);
    }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="bg-picker"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md, maxHeight: "80%" },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>
            {isRTL ? "الخلفية" : "Room Background"}
          </Text>
          <Text style={styles.menuHint}>
            {isRTL
              ? "اختر خلفية فاخرة جاهزة لتطبيقها على غرفتك فورًا."
              : "Pick a premium backdrop and apply it to your room instantly."}
          </Text>
          {err && (
            <Text
              style={{
                color: colors.error,
                textAlign: "center",
                marginBottom: 6,
                fontWeight: "700",
              }}
            >
              {err}
            </Text>
          )}
          <ScrollView
            testID="bg-picker-scroll"
            contentContainerStyle={{ paddingBottom: spacing.md }}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <ActivityIndicator
                color={colors.gold}
                style={{ padding: spacing.lg }}
              />
            ) : (
              <View style={bgStyles.grid}>
                {/* Iter-74 — Custom upload tile, always listed first. */}
                <Pressable
                  testID="bg-custom"
                  disabled={customBusy || !!applyingId}
                  onPress={confirmUpload}
                  style={({ pressed }) => [
                    bgStyles.tile,
                    bgStyles.customTile,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={bgStyles.customInner}>
                    <Icon
                      name="add-circle-outline"
                      size={28}
                      color={colors.gold}
                    />
                    <Text style={bgStyles.customTitle} numberOfLines={1}>
                      {isRTL ? "صورة مخصصة" : "Custom Image"}
                    </Text>
                    <Text style={bgStyles.customPrice} numberOfLines={1}>
                      {`${ROOM_BG_CUSTOM_COST.toLocaleString()} 💎`}
                    </Text>
                  </View>
                  {customBusy && (
                    <View style={bgStyles.busyWrap}>
                      <ActivityIndicator color="#FFFFFF" />
                    </View>
                  )}
                </Pressable>
                {/* Iter-75 — "My Custom" tile: appears after the owner's
                    custom bg has been approved. Lets them switch back to it
                    at any time without re-uploading or re-paying. */}
                {!!customUrl && (
                  <Pressable
                    testID="bg-my-custom"
                    disabled={customBusy || !!applyingId}
                    onPress={async () => {
                      setApplyingId("my_custom");
                      setErr(null);
                      try {
                        await apiSetRoomBackgroundPreset(roomId, "my_custom");
                        onApplied();
                      } catch (e: any) {
                        setErr(
                          e?.message || "Could not apply custom background",
                        );
                      } finally {
                        setApplyingId(null);
                      }
                    }}
                    style={({ pressed }) => [
                      bgStyles.tile,
                      currentPresetId === "my_custom" && bgStyles.tileSelected,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Image
                      source={customUrl}
                      style={bgStyles.tileImg}
                      contentFit="cover"
                    />
                    <View style={bgStyles.tileOverlay}>
                      <Text style={bgStyles.tileTitle} numberOfLines={1}>
                        {isRTL ? "خلفيتي المخصصة" : "My Custom"}
                      </Text>
                    </View>
                    {currentPresetId === "my_custom" && (
                      <View style={bgStyles.checkDot}>
                        <Icon
                          name="checkmark"
                          size={14}
                          color={colors.onBrandPrimary}
                        />
                      </View>
                    )}
                    {applyingId === "my_custom" && (
                      <View style={bgStyles.busyWrap}>
                        <ActivityIndicator color="#FFFFFF" />
                      </View>
                    )}
                  </Pressable>
                )}
                {items.map((bg) => {
                  const selected = currentPresetId === bg.id;
                  const busy = applyingId === bg.id;
                  return (
                    <Pressable
                      key={bg.id}
                      testID={`bg-${bg.id}`}
                      onPress={() => apply(bg)}
                      disabled={!!applyingId || customBusy}
                      style={({ pressed }) => [
                        bgStyles.tile,
                        selected && bgStyles.tileSelected,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Image
                        source={bg.image_url}
                        style={bgStyles.tileImg}
                        contentFit="cover"
                      />
                      <View style={bgStyles.tileOverlay}>
                        <Text style={bgStyles.tileTitle} numberOfLines={1}>
                          {isRTL ? bg.title_ar : bg.title_en}
                        </Text>
                      </View>
                      {selected && (
                        <View style={bgStyles.checkDot}>
                          <Icon
                            name="checkmark"
                            size={14}
                            color={colors.onBrandPrimary}
                          />
                        </View>
                      )}
                      {busy && (
                        <View style={bgStyles.busyWrap}>
                          <ActivityIndicator color="#FFFFFF" />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
      {/* Iter-82 — 3-option bottom sheet shown when the user taps "+ Custom Image". */}
      {customSheetOpen && (
        <Pressable
          testID="bg-custom-sheet"
          style={bgStyles.sheetOverlay}
          onPress={() => setCustomSheetOpen(false)}
        >
          <Pressable
            style={[
              bgStyles.sheetWrap,
              { paddingBottom: insets.bottom + spacing.md },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.dragHandle} />
            {/* Option A — Buy 15-day pass */}
            <Pressable
              testID="bg-custom-buy"
              style={bgStyles.sheetOption}
              onPress={() => {
                setCustomSheetOpen(false);
                setBuyModalOpen(true);
              }}
            >
              <Text style={bgStyles.sheetOptionTitle}>
                {isRTL
                  ? "شراء خلفية مخصصة - 15 يومًا"
                  : "Buy Custom Background — 15 Days"}
              </Text>
              <Text style={bgStyles.sheetOptionSub}>
                {isRTL
                  ? "لا يُشترط أي مستوى VIP. اشترِ وفعِّل صورة مخصصة فورًا."
                  : "No VIP level is required. Purchase and activate a custom image immediately."}
              </Text>
            </Pressable>
            {/* Option B — VIP6+ unlimited */}
            <Pressable
              testID="bg-custom-vip6"
              style={bgStyles.sheetOption}
              onPress={handleVip6Path}
            >
              <Text style={bgStyles.sheetOptionTitle}>
                {isRTL
                  ? "VIP6+ — خلفيات مخصصة غير محدودة"
                  : "VIP6+ — Unlimited Custom Backgrounds"}
              </Text>
              <Text style={bgStyles.sheetOptionSub}>
                {isRTL
                  ? "يمكن لأعضاء VIP6+ تخصيص الخلفية بدون أي حد."
                  : "VIP6+ members can customize their background without limits."}
              </Text>
            </Pressable>
            {/* Option C — Cancel (red) */}
            <Pressable
              testID="bg-custom-cancel"
              style={bgStyles.sheetCancel}
              onPress={() => setCustomSheetOpen(false)}
            >
              <Text style={bgStyles.sheetCancelText}>
                {isRTL ? "إلغاء" : "Cancel"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
      {/* Iter-82 — Buy Custom Background modal (50 000 Diamonds). */}
      {buyModalOpen && (
        <Pressable
          testID="bg-buy-modal"
          style={bgStyles.buyOverlay}
          onPress={() => !buyBusy && setBuyModalOpen(false)}
        >
          <Pressable
            style={bgStyles.buyCard}
            onPress={(e) => e.stopPropagation()}
          >
            <Image
              source={
                "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=800&q=85"
              }
              style={bgStyles.buyPreview}
              contentFit="cover"
            />
            <Text style={bgStyles.buyTitle}>
              {isRTL ? "شراء خلفية مخصصة" : "Buy Custom Background"}
            </Text>
            <Text style={bgStyles.buyBody}>
              {isRTL
                ? "لا تحتاج إلى VIP6+ أو أي مستوى VIP لتفعيل صورة مخصصة. اشترِها وفعّلها فورًا."
                : "You do not need VIP6+ or any VIP level to activate a custom image. Purchase it and activate it immediately."}
            </Text>
            {err && (
              <Text
                style={{
                  color: colors.error,
                  textAlign: "center",
                  marginTop: 8,
                  fontWeight: "700",
                }}
              >
                {err}
              </Text>
            )}
            <Pressable
              testID="bg-buy-confirm"
              disabled={buyBusy}
              onPress={handleBuyPass}
              style={({ pressed }) => [
                bgStyles.buyBtn,
                pressed && { opacity: 0.9 },
              ]}
            >
              {buyBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={bgStyles.buyBtnText}>
                  {`💎 ${ROOM_BG_CUSTOM_COST.toLocaleString()} ${isRTL ? "ألماس" : "Diamonds"}`}
                </Text>
              )}
            </Pressable>
            <Pressable
              testID="bg-buy-close"
              disabled={buyBusy}
              onPress={() => setBuyModalOpen(false)}
              style={bgStyles.buyClose}
            >
              <Text style={bgStyles.buyCloseText}>
                {isRTL ? "إلغاء" : "Cancel"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </Modal>
  );
}

const bgStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingTop: spacing.sm,
    justifyContent: "space-between",
  },
  // Portrait phone aspect ratio so previews match the way the backdrop
  // will actually render inside the room (vertical, full-screen).
  tile: {
    width: "48%",
    aspectRatio: 9 / 16,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
  },
  tileSelected: {
    borderColor: colors.gold,
    borderWidth: 2,
  },
  // Iter-74 — Custom upload tile (dashed gold border, no background image).
  customTile: {
    borderStyle: "dashed",
    borderColor: colors.gold,
    borderWidth: 2,
    backgroundColor: "rgba(255,214,10,0.07)",
    alignItems: "center",
    justifyContent: "center",
  },
  customInner: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 8,
  },
  customTitle: {
    color: colors.onSurface,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  customPrice: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  tileImg: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  tileOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  tileTitle: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  checkDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  busyWrap: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  // Iter-82 — bottom sheet (3 options) + buy modal styles.
  sheetOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheetWrap: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  sheetOption: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  sheetOptionTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  sheetOptionSub: {
    color: "#FFFFFF",
    opacity: 0.95,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
  },
  sheetCancel: {
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: "rgba(239,68,68,0.15)",
    borderWidth: 1,
    borderColor: colors.error,
    marginTop: 2,
  },
  sheetCancelText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  buyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  buyCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  buyPreview: {
    width: "100%",
    aspectRatio: 9 / 16,
    maxHeight: 160,
    borderRadius: radius.md,
    marginBottom: 10,
  },
  buyTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 6,
    textAlign: "center",
  },
  buyBody: {
    color: "#FFFFFF",
    opacity: 0.9,
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 18,
  },
  buyBtn: {
    marginTop: 14,
    width: "100%",
    paddingVertical: 12,
    borderRadius: radius.pill,
    backgroundColor: "#8B5CF6", // purple
    alignItems: "center",
  },
  buyBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  buyClose: {
    marginTop: 8,
    paddingVertical: 8,
  },
  buyCloseText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
});

// ------------------------------- Gift panel ----------------------------------

// ------------------------------------------------------------------------
// Iter-37 — GiftPanel v2: multi-recipient, category tabs, quantity presets,
// real total, real balance + wallet shortcut, and post-send repeat combo.
// ------------------------------------------------------------------------
const GIFT_CATEGORIES: { key: string; en: string; ar: string }[] = [
  { key: "gift", en: "Gift", ar: "هدية" },
  { key: "lucky", en: "Lucky", ar: "محظوظ" },
  { key: "privilege", en: "Privilege", ar: "امتيازات" },
  { key: "custom", en: "Custom", ar: "مخصص" },
  { key: "relationship", en: "Relationship", ar: "علاقة" },
  { key: "fashion", en: "Fashion", ar: "أزياء" },
  { key: "countries", en: "Countries", ar: "الدول" },
];

const QTY_PRESETS = [1, 7, 77, 777] as const;

function GiftPanel({
  preselectedRecipient,
  roomId,
  seats,
  participants,
  me,
  owner,
  onClose,
  onSent,
}: any) {
  const insets = useSafeAreaInsets();
  const { isRTL } = useI18n();
  const { refresh: refreshAuth } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: catalog = [] } = useQuery({
    queryKey: ["gifts", "v2"],
    queryFn: apiGifts,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: customData } = useQuery({
    queryKey: ["custom-gifts-mine"],
    queryFn: apiListMyCustomGifts,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: customCfg } = useQuery({
    queryKey: ["custom-gift-settings"],
    queryFn: apiCustomGiftSettings,
  });
  const [cat, setCat] = useState<string>("gift");
  const [selected, setSelected] = useState<any>(null);
  const [qty, setQty] = useState<number>(1);
  const [customQty, setCustomQty] = useState<string>("");
  const [qtyMode, setQtyMode] = useState<"preset" | "custom">("preset");
  const [customGiftOpen, setCustomGiftOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Recipient selection state — start with the pre-selected recipient if any.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(preselectedRecipient?.id ? [preselectedRecipient.id] : []),
  );

  // Mic users (from seats) and Room users (from WS presence).
  const micUsers = useMemo(() => {
    const list: any[] = [];
    for (const s of seats || []) {
      const u = s?.user;
      if (u && u.id !== me?.id) list.push(u);
    }
    return list;
  }, [seats, me?.id]);
  const roomUsers = useMemo(() => {
    return (participants || []).filter((p: any) => p?.id && p.id !== me?.id);
  }, [participants, me?.id]);
  const micIds = useMemo(
    () => new Set<string>(micUsers.map((u: any) => u.id)),
    [micUsers],
  );
  const roomIds = useMemo(
    () => new Set<string>(roomUsers.map((u: any) => u.id)),
    [roomUsers],
  );
  const allMicSelected =
    micIds.size > 0 && [...micIds].every((id: string) => selectedIds.has(id));
  const allRoomSelected =
    roomIds.size > 0 && [...roomIds].every((id: string) => selectedIds.has(id));

  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectAllMic = () =>
    setSelectedIds(
      new Set(allMicSelected ? [] : micUsers.map((u: any) => u.id)),
    );
  const selectAllRoom = () =>
    setSelectedIds(
      new Set(allRoomSelected ? [] : roomUsers.map((u: any) => u.id)),
    );

  // Live catalog filtered by category. Custom gifts pulled from custom_gifts endpoint.
  const gifts = useMemo(() => {
    if (cat === "custom")
      return (customData?.items ?? [])
        .filter((g: any) => g.status === "approved")
        .map((g: any) => ({ ...g, id: g.gift_id }));
    const list = catalog as any[];
    // Iter-37: "gift" tab is the default catalog — show everything that either
    // has category==="gift" OR no category set (legacy). All other tabs use
    // strict equality until the admin assigns categories.
    if (cat === "gift")
      return list.filter((g: any) => !g.category || g.category === "gift");
    return list.filter((g: any) => g.category === cat);
  }, [catalog, customData, cat]);

  const finalQty =
    qtyMode === "custom"
      ? Math.max(1, Math.min(9999, parseInt(customQty || "0", 10) || 0))
      : qty;
  const recipientCount = selectedIds.size;
  const total = selected ? selected.price * finalQty * recipientCount : 0;
  const [liveBal, setLiveBal] = useState<number | null>(null);
  const balance = liveBal ?? me?.coins ?? 0;
  const canSend =
    !!selected && finalQty > 0 && recipientCount > 0 && balance >= total;

  const doSend = useCallback(async () => {
    if (!selected) return;
    setSending(true);
    setErr(null);
    try {
      const res = await apiSendGiftMulti(
        selected.id,
        [...selectedIds],
        finalQty,
        roomId,
      );
      if (typeof (res as any)?.new_balance === "number")
        setLiveBal((res as any).new_balance);
      refreshAuth?.().catch?.(() => {});
      // Refresh balances / progress
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      qc.invalidateQueries({ queryKey: ["vip-progress"] });
      // Close the panel and hand the combo to the room screen (red Combo button).
      onSent({
        giftId: selected.id,
        giftName: selected.name,
        qty: finalQty,
        recipients: [...selectedIds],
        combo_id: res.combo_id,
      });
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }, [
    selected,
    selectedIds,
    finalQty,
    roomId,
    qc,
    onSent,
    onClose,
    refreshAuth,
  ]);

  // Recipient chip list — room owner pinned first (even when off-mic), then
  // mic users, then non-mic room users.
  const recipientChips = useMemo(() => {
    const nonMic = roomUsers.filter((u: any) => !micIds.has(u.id));
    const list = [
      ...micUsers.map((u: any) => ({ ...u, _onMic: true })),
      ...nonMic.map((u: any) => ({ ...u, _onMic: false })),
    ];
    if (owner?.id && owner.id !== me?.id) {
      const idx = list.findIndex((u: any) => u.id === owner.id);
      const ownerChip =
        idx >= 0 ? list.splice(idx, 1)[0] : { ...owner, _onMic: false };
      list.unshift({ ...ownerChip, _isOwner: true });
    }
    return list;
  }, [micUsers, roomUsers, micIds, owner, me?.id]);

  return (
    <Pressable onPress={onClose} style={styles.giftOverlay} testID="gift-panel">
      <Pressable
        onPress={() => {}}
        style={[
          styles.giftSheet,
          { paddingBottom: insets.bottom + spacing.md, maxHeight: "88%" },
        ]}
      >
        <View style={styles.dragHandle} />

        {/* Recipient row: [الجميع+room] [الجميع+mic] then individual chips (owner pinned) */}
        <View style={styles.giftHeader}>
          <Text style={styles.giftTitle}>{isRTL ? "الهدايا" : "Gifts"}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recipientRow}
        >
          <Pressable
            testID="recip-all-room"
            onPress={selectAllRoom}
            style={[
              styles.recipChip,
              allRoomSelected && styles.recipChipActive,
            ]}
          >
            <Icon
              name="home"
              size={11}
              color={allRoomSelected ? colors.brandPrimary : colors.muted}
            />
            <Text
              style={[
                styles.recipChipText,
                allRoomSelected && { color: colors.brandPrimary },
              ]}
            >
              {isRTL ? "الجميع" : "All"}
            </Text>
          </Pressable>
          <Pressable
            testID="recip-all-mic"
            onPress={selectAllMic}
            style={[styles.recipChip, allMicSelected && styles.recipChipActive]}
          >
            <Icon
              name="mic"
              size={11}
              color={allMicSelected ? colors.brandPrimary : colors.muted}
            />
            <Text
              style={[
                styles.recipChipText,
                allMicSelected && { color: colors.brandPrimary },
              ]}
            >
              {isRTL ? "الجميع" : "All"}
            </Text>
          </Pressable>
          {recipientChips.map((u: any) => {
            const sel = selectedIds.has(u.id);
            return (
              <Pressable
                key={u.id}
                testID={`recip-${u.id}`}
                onPress={() => toggleId(u.id)}
                style={[
                  styles.recipAvatarWrap,
                  sel && { borderColor: colors.gold, borderWidth: 2 },
                ]}
              >
                <Image
                  source={{ uri: u.avatar_url }}
                  style={styles.recipAvatar}
                  contentFit="cover"
                />
                {u._onMic && (
                  <View style={styles.recipMicDot}>
                    <Icon name="mic" size={8} color={colors.onBrandPrimary} />
                  </View>
                )}
                {u._isOwner && (
                  <View
                    style={[
                      styles.recipMicDot,
                      {
                        left: -2,
                        right: undefined,
                        top: -2,
                        bottom: undefined,
                      },
                    ]}
                    testID="recip-owner-pin"
                  >
                    <Icon name="star" size={8} color={colors.onBrandPrimary} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Category tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
        >
          {GIFT_CATEGORIES.map((c) => {
            const active = cat === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`gift-cat-${c.key}`}
                onPress={() => {
                  setCat(c.key);
                  setSelected(null);
                }}
                style={[styles.catChip, active && styles.catChipActive]}
              >
                <Text
                  style={[
                    styles.catChipText,
                    active && styles.catChipTextActive,
                  ]}
                >
                  {isRTL ? c.ar : c.en}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Gift grid */}
        <ScrollView
          contentContainerStyle={styles.giftGrid}
          showsVerticalScrollIndicator={false}
        >
          {cat === "custom" && customCfg && (
            <View style={styles.customBanner}>
              {customCfg.eligible ? (
                <Pressable
                  testID="create-custom-gift"
                  onPress={() => setCustomGiftOpen(true)}
                  style={styles.customCreateBtn}
                >
                  <Icon name="add-circle" size={18} color={colors.gold} />
                  <Text style={styles.customCreateText}>
                    {isRTL ? "تخصيص هدية" : "Customize Gift"} ·{" "}
                    {Number(customCfg.price).toLocaleString("en-US")}
                  </Text>
                  <Diamond size={13} />
                </Pressable>
              ) : (
                <Text style={styles.customLockedText}>
                  🔒{" "}
                  {isRTL
                    ? `الهدايا المخصصة متاحة لـ VIP${customCfg.min_vip_level}+`
                    : `Custom Gifts unlock at VIP ${customCfg.min_vip_level}+`}
                </Text>
              )}
            </View>
          )}
          {gifts.length === 0 && cat !== "custom" && (
            <Text style={styles.emptyCat}>No gifts in this category yet.</Text>
          )}
          {gifts.map((g: any) => (
            <GiftCard
              key={g.id}
              gift={g}
              selected={selected?.id === g.id}
              onSelect={() => setSelected(g)}
            />
          ))}
        </ScrollView>

        {err && (
          <Text
            style={{ color: colors.error, textAlign: "center", marginTop: 4 }}
          >
            {err}
          </Text>
        )}

        {/* Quantity presets + custom */}
        <View style={styles.qtyPresetsRow}>
          {QTY_PRESETS.map((n) => {
            const active = qtyMode === "preset" && qty === n;
            return (
              <Pressable
                key={n}
                testID={`qty-preset-${n}`}
                onPress={() => {
                  setQtyMode("preset");
                  setQty(n);
                }}
                style={[
                  styles.qtyPresetBtn,
                  active && styles.qtyPresetBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.qtyPresetText,
                    active && styles.qtyPresetTextActive,
                  ]}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
          {qtyMode === "custom" ? (
            <TextInput
              testID="qty-custom-input"
              value={customQty}
              onChangeText={(t: string) =>
                setCustomQty(t.replace(/[^0-9]/g, "").slice(0, 4))
              }
              placeholder="1-9999"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={4}
              style={[styles.qtyPresetBtn, styles.qtyCustomInput]}
            />
          ) : (
            <Pressable
              testID="qty-preset-other"
              onPress={() => {
                setQtyMode("custom");
                setCustomQty("");
              }}
              style={styles.qtyPresetBtn}
            >
              <Text style={styles.qtyPresetText}>Other</Text>
            </Pressable>
          )}
        </View>

        {/* Footer: balance (→ Wallet) + compact Gift button */}
        <View style={styles.giftFooter}>
          <Pressable
            style={styles.walletChip}
            testID="wallet-shortcut"
            onPress={() => {
              onClose();
              router.push("/(tabs)/wallet" as any);
            }}
            hitSlop={6}
          >
            <Diamond size={16} />
            <Text style={styles.walletChipValue}>
              {Number(balance).toLocaleString()}
            </Text>
            <Icon name="add" size={16} color={colors.brandPrimary} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {
            <Pressable
              testID="send-gift-btn"
              onPress={() => doSend()}
              disabled={!canSend || sending}
              style={[
                styles.sendGiftBtn,
                (!canSend || sending) && { opacity: 0.45 },
              ]}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.brandPrimary} />
              ) : (
                <>
                  <View style={styles.sendGiftDot} />
                  <Text style={styles.sendGiftText}>
                    {isRTL ? "إهداء" : "Gift"}
                  </Text>
                  {selected && total > 0 ? (
                    <View style={styles.sendGiftTotal}>
                      <Diamond size={12} />
                      <Text style={styles.sendGiftTotalText}>
                        {total.toLocaleString()}
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </Pressable>
          }
        </View>
      </Pressable>
      {/* Customize Gift — separate full-screen page above the panel. */}
      {customGiftOpen && (
        <CustomGiftCreator
          price={customCfg?.price ?? 4999}
          isRTL={isRTL}
          onClose={() => setCustomGiftOpen(false)}
          onCreated={async (gid) => {
            setCustomGiftOpen(false);
            const fresh: any = await qc.fetchQuery({
              queryKey: ["custom-gifts-mine"],
              queryFn: apiListMyCustomGifts,
            });
            const g = (fresh?.items ?? []).find((x: any) => x.gift_id === gid);
            if (g) setSelected({ ...g, id: g.gift_id });
          }}
        />
      )}
    </Pressable>
  );
}

// Custom Gift Creator (VIP5+): cover image + ≤10s video, fixed 4,999 diamonds. Uploads go
// through ORIO object storage (purpose=gift); the server validates ownership,
// media kind and VIP level, and the gift appears in the panel immediately.
function CustomGiftCreator({
  price,
  isRTL,
  onClose,
  onCreated,
}: {
  price: number;
  isRTL: boolean;
  onClose: () => void;
  onCreated: (giftId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<PickedMedia | null>(null);
  const [video, setVideo] = useState<PickedMedia | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const pick = async () => {
    setErr(null);
    try {
      const r = await pickMedia("image", 1, false);
      if (r === "denied") {
        setErr(
          isRTL
            ? "يرجى السماح بالوصول إلى الصور من الإعدادات"
            : "Please allow photo access in Settings",
        );
        return;
      }
      if (r[0]) setPicked(r[0]);
    } catch (e: any) {
      setErr(e?.message || "Failed to pick image");
    }
  };
  const pickVideo = async () => {
    setErr(null);
    try {
      const r = await pickMedia("video", 1, false);
      if (r === "denied") {
        setErr(
          isRTL
            ? "يرجى السماح بالوصول إلى الصور من الإعدادات"
            : "Please allow photo access in Settings",
        );
        return;
      }
      const v = r[0];
      if (!v) return;
      if (v.duration == null || v.duration > 10.5) {
        setErr(
          isRTL
            ? "يجب ألا تتجاوز مدة الفيديو 10 ثوانٍ"
            : "Video must be 10 seconds or shorter",
        );
        return;
      }
      setVideo(v);
    } catch (e: any) {
      setErr(e?.message || "Failed to pick video");
    }
  };

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setErr(null);
    setProgress(0);
    try {
      const media_url = await uploadMedia(picked, "gift", (p) =>
        setProgress(video ? p / 2 : p),
      );
      const video_url = video
        ? await uploadMedia(video, "gift", (p) => setProgress(0.5 + p / 2))
        : undefined;
      const res: any = await apiCreateCustomGift({
        media_url,
        media_type: "image",
        name: name || undefined,
        video_url,
      });
      onCreated(`cg_${res.id}`);
    } catch (e: any) {
      setErr(e?.message || "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  const insetsTop = insets.top;
  const ready = !!picked && !!video && !busy;
  return (
    <View
      style={[styles.customGiftOverlay, { paddingTop: insetsTop }]}
      testID="custom-gift-creator"
      onStartShouldSetResponder={() => true}
    >
      <View style={styles.cgHeader}>
        <Pressable
          testID="custom-cancel"
          onPress={onClose}
          hitSlop={10}
          style={styles.cgBack}
        >
          <Icon
            name={isRTL ? "chevron-forward" : "chevron-back"}
            size={24}
            color={colors.onSurface}
          />
        </Pressable>
        <Text style={styles.giftTitle}>
          {isRTL ? "تخصيص هدية" : "Customize Gift"}
        </Text>
        <View style={styles.cgBack} />
      </View>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <Text style={styles.cgLabel}>{isRTL ? "اسم الهدية" : "Gift Name"}</Text>
        <TextInput
          testID="custom-gift-name"
          value={name}
          onChangeText={(t: string) => setName(t.slice(0, 40))}
          placeholder={isRTL ? "أدخل اسم الهدية" : "Enter gift name"}
          placeholderTextColor={colors.muted}
          style={[styles.customNameInput, isRTL && { textAlign: "right" }]}
          maxLength={40}
        />
        <View style={styles.cgPriceRow}>
          <Text style={styles.cgLabel}>
            {isRTL ? "السعر الثابت" : "Fixed price"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.cgPrice} testID="custom-gift-price">
              {price.toLocaleString("en-US")}
            </Text>
            <Diamond size={14} />
          </View>
        </View>
        <View style={styles.cgBoxes}>
          <Pressable
            testID="custom-pick-video"
            onPress={pickVideo}
            style={[styles.cgBox, video && styles.customPickBtnActive]}
          >
            <Icon
              name={video ? "checkmark-circle" : "videocam"}
              size={28}
              color={video ? colors.success : colors.onSurface}
            />
            <Text style={styles.customPickText}>
              {isRTL ? "فيديو الهدية" : "Gift Video"}
            </Text>
            <Text style={styles.cgHint}>
              {video
                ? `${Math.round(video.duration ?? 0)}s`
                : isRTL
                  ? "حتى 10 ثوانٍ"
                  : "Up to 10 seconds"}
            </Text>
          </Pressable>
          <Pressable
            testID="custom-pick-image"
            onPress={pick}
            style={[styles.cgBox, picked && styles.customPickBtnActive]}
          >
            {picked ? (
              <Image
                source={{ uri: picked.uri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
            ) : (
              <>
                <Icon name="image" size={28} color={colors.onSurface} />
                <Text style={styles.customPickText}>
                  {isRTL ? "غلاف الهدية" : "Gift Cover"}
                </Text>
                <Text style={styles.cgHint}>{isRTL ? "صورة" : "Image"}</Text>
              </>
            )}
          </Pressable>
        </View>
        {busy && progress > 0 && progress < 1 ? (
          <Text style={[styles.customLockedText, { textAlign: "center" }]}>
            {Math.round(progress * 100)}%
          </Text>
        ) : null}
        {err && (
          <Text style={{ color: colors.error, textAlign: "center" }}>
            {err}
          </Text>
        )}
        <Pressable
          testID="custom-submit"
          onPress={submit}
          disabled={!ready}
          style={[styles.cgSubmit, !ready && { opacity: 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text
              style={[
                styles.customPickText,
                { color: colors.onBrandPrimary, fontWeight: "900" },
              ]}
            >
              {isRTL ? "تأكيد" : "Confirm"}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  roomName: { color: ROOM_FG, fontSize: 16, fontWeight: "800" },
  trophyBtn: {
    marginLeft: 6,
    marginRight: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,214,10,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,214,10,0.35)",
  },
  roomNamePlate: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    maxWidth: "100%",
    overflow: "hidden",
  },
  headerViewersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    marginLeft: 4,
  },
  headerViewersCount: { color: ROOM_FG, fontSize: 12, fontWeight: "800" },
  headerMenuBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  roomMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.error,
  },
  liveText: {
    color: colors.error,
    fontSize: 10,
    fontWeight: "800",
    marginRight: 4,
  },
  roomTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.gold + "33",
    borderWidth: 1,
    borderColor: colors.gold,
  },
  roomTypeText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  metaDot: { color: ROOM_FG_DIM, marginHorizontal: 4 },
  voicePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  voicePillDot: { width: 6, height: 6, borderRadius: 3 },
  voicePillText: { fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
  metaText: { color: ROOM_FG_DIM, fontSize: 11 },
  hostLabel: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: spacing.sm,
  },

  // Dedicated host chair — corner-placed, always separate from numbered mic seats.
  hostChairWrap: {
    alignSelf: "flex-start",
    marginStart: spacing.md,
    marginBottom: HOST_GAP,
    alignItems: "center",
    gap: 2,
  },
  hostBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    height: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
  },
  hostBadgeText: {
    color: colors.onBrandPrimary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },

  seatsRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  seatLabelSlot: {
    height: SEAT_LABEL_H,
    justifyContent: "flex-end",
    alignItems: "center",
    overflow: "hidden",
  },
  noticePin: {
    marginTop: 4,
    marginHorizontal: spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: colors.gold + "66",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  noticePinText: { color: ROOM_FG, fontSize: 12, flex: 1 },

  // Original transparent glass mic seat (room background shows through).
  seat: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  emptySeat: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  seatIdx: {
    color: ROOM_FG_DIM,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  seatVip: {
    position: "absolute",
    top: -4,
    right: -4,
    alignItems: "center",
    justifyContent: "center",
  },
  seatVipBadge: {
    borderWidth: 2,
    borderColor: colors.surface,
  },
  // Section 13: mute indicator sits OUTSIDE the avatar circle (bottom-right, offset).
  mutedOverlay: {
    position: "absolute",
    bottom: -6,
    right: -6,
    backgroundColor: "#E53935",
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
  seatName: {
    color: ROOM_FG,
    fontSize: 10,
    fontWeight: "700",
    maxWidth: 82,
    textAlign: "center",
    lineHeight: 13,
    includeFontPadding: false,
    // Iter-51 §13 — no black transparent backplate under the mic username.
    // Clean text on top of the room background.
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },

  chatFeed: {
    position: "absolute",
    left: spacing.sm,
    right: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    maxHeight: 200,
  },
  chatMsg: { paddingVertical: 3 },
  chatMsgText: { color: ROOM_FG, fontSize: 13, lineHeight: 18 },
  sysMsg: { color: ROOM_FG_DIM, fontSize: 12, fontStyle: "italic" },

  actionBar: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    overflow: "hidden",
  },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Full-width input on its own row; buttons in a row below, aligned to the end.
  chatInputRow: {
    flex: 0,
    alignSelf: "stretch",
    height: 40,
    marginBottom: spacing.sm,
  },
  actionButtonsRow: { justifyContent: "flex-end", gap: 10 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chatInputBox: {
    flex: 1,
    minWidth: 60,
    height: 36,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  inBoxBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  chatInput: {
    flex: 1,
    minWidth: 40,
    height: 36,
    backgroundColor: "transparent",
    paddingHorizontal: 4,
    color: ROOM_FG,
    fontSize: 13,
  },

  // Menu
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  micInviteOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  menuSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: "90%",
  },
  dragHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  menuTitle: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  menuHint: {
    color: colors.muted,
    textAlign: "center",
    fontSize: 12,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  menuGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  menuItem: {
    width: "31%",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  menuIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  menuLabel: { fontSize: 12, fontWeight: "600" },
  menuTile: {
    width: "31%",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  menuSubLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  catalogDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  catalogSectionTitle: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "900",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  lockBadge: {
    position: "absolute",
    right: -4,
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontStyle: "italic",
  },

  togglesBox: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  togglesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  togglesLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  pingText: { color: colors.gold, fontSize: 13, fontWeight: "800" },

  // Layout picker rows
  layoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
    marginBottom: spacing.sm,
  },
  layoutBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  layoutBadgeText: {
    color: colors.onBrandPrimary,
    fontWeight: "900",
    fontSize: 16,
  },
  layoutName: { color: colors.onSurface, fontWeight: "800", fontSize: 15 },
  layoutSub: { color: colors.muted, fontSize: 12 },

  // Gift panel
  giftOverlay: {
    position: "absolute",
    inset: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
    // Gift panel always stays ABOVE gift / entrance / video effects.
    zIndex: 500,
    elevation: 500,
  },
  giftSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "75%",
  },
  giftHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  giftTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  giftRecipient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  giftRecipientName: {
    color: colors.onSurface,
    fontSize: 12,
    fontWeight: "600",
  },
  giftGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  giftCard: {
    width: "31%",
    aspectRatio: 0.85,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  giftImg: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  giftName: {
    color: colors.onSurface,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
  giftPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 2,
  },
  giftPrice: { color: colors.gold, fontSize: 11, fontWeight: "800" },
  giftFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: {
    color: colors.onSurface,
    fontWeight: "800",
    minWidth: 24,
    textAlign: "center",
  },
  sendGiftBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandPrimary + "66",
    backgroundColor: colors.surface,
  },
  sendGiftDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brandPrimary,
  },
  sendGiftText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 14 },
  sendGiftTotal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginStart: 2,
  },
  sendGiftTotalText: { color: colors.muted, fontWeight: "700", fontSize: 11 },
  // Iter-37 gift panel additions
  recipientRow: {
    paddingHorizontal: spacing.md,
    gap: 6,
    paddingBottom: 6,
    alignItems: "center",
  },
  recipChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recipChipActive: { borderColor: colors.brandPrimary },
  recipChipText: { color: colors.onSurface, fontSize: 10.5, fontWeight: "700" },
  recipAvatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    position: "relative",
  },
  recipAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceSecondary,
  },
  recipMicDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
  catRow: { paddingHorizontal: spacing.md, gap: 6, paddingBottom: 6 },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
  },
  catChipActive: { borderColor: colors.brandPrimary },
  catChipText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  catChipTextActive: { color: colors.brandPrimary },
  emptyCat: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    width: "100%",
    padding: spacing.lg,
    fontStyle: "italic",
  },
  customBanner: { width: "100%", marginBottom: spacing.sm },
  customCreateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold + "88",
    backgroundColor: colors.gold + "18",
  },
  customCreateText: { color: colors.gold, fontSize: 13, fontWeight: "900" },
  customLockedText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    padding: spacing.md,
  },
  qtyPresetsRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    justifyContent: "space-between",
  },
  qtyPresetBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qtyPresetBtnActive: { borderColor: colors.brandPrimary },
  qtyPresetText: { color: colors.onSurface, fontSize: 13, fontWeight: "900" },
  qtyPresetTextActive: { color: colors.brandPrimary },
  qtyCustomInput: {
    color: colors.onSurface,
    textAlign: "center",
    paddingVertical: 0,
  },
  walletChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
  },
  walletChipValue: {
    color: colors.brandPrimary,
    fontSize: 14,
    fontWeight: "900",
  },
  customGiftOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surface,
    zIndex: 600,
    elevation: 600,
  },
  cgHeader: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  cgBack: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  cgLabel: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  cgPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.surfaceSecondary,
  },
  cgPrice: { color: colors.gold, fontSize: 16, fontWeight: "900" },
  cgBoxes: { flexDirection: "row", gap: spacing.md },
  cgBox: {
    flex: 1,
    aspectRatio: 0.85,
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  cgHint: { color: colors.muted, fontSize: 11 },
  cgSubmit: {
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  customGiftSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
  },
  customPickBtn: {
    flex: 1,
    minHeight: 60,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customPickBtnActive: {
    borderColor: colors.gold,
    backgroundColor: colors.gold + "22",
  },
  customPickText: { color: colors.onSurface, fontSize: 12, fontWeight: "800" },
  customNameInput: {
    marginTop: spacing.sm,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Header follow/membership cluster (iter-18)
  headerRightCluster: { flexDirection: "row", alignItems: "center", gap: 8 },
  // People strip (iter-19)
  peopleStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    marginTop: 2,
  },
  stripAvatarWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: colors.surfaceTertiary,
  },
  stripAvatar: { width: "100%", height: "100%" },
  stripCountPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "rgba(20,10,40,0.7)",
    borderWidth: 1,
    borderColor: colors.gold + "55",
    marginRight: spacing.md,
  },
  stripCountText: { color: colors.gold, fontWeight: "900", fontSize: 11 },
  followBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(20,10,40,0.55)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  followCount: { color: colors.onSurface, fontWeight: "800", fontSize: 12 },
  membershipBtn: {
    width: 36,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(20,10,40,0.55)",
    borderWidth: 1,
    borderColor: colors.gold + "44",
  },

  // Header participants button
  headerTitleBlock: {
    alignItems: "flex-start",
    paddingHorizontal: spacing.sm,
    maxWidth: "60%",
  },
  participantsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1,
    borderColor: colors.gold + "44",
    marginHorizontal: 4,
  },
  participantsCount: { color: colors.gold, fontWeight: "900", fontSize: 12 },

  // Participants sheet
  participantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  participantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceTertiary,
  },
  participantName: { color: colors.onSurface, fontWeight: "700" },
  nameLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },

  // Mic action rows
  micActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  micActionText: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },

  // Change-seat picker
  changeSeatOpt: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  changeSeatOptText: { color: colors.gold, fontWeight: "900", fontSize: 16 },

  // Lock room PIN input
  pinInput: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 8,
    textAlign: "center",
    color: colors.gold,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.gold + "44",
  },

  // PK
  pkVs: {
    color: colors.onSurface,
    fontWeight: "800",
    fontSize: 16,
    textAlign: "center",
    marginTop: 4,
  },
  pkBar: {
    flexDirection: "row",
    height: 32,
    borderRadius: 16,
    overflow: "hidden",
    marginTop: spacing.md,
    backgroundColor: colors.surfaceTertiary,
  },
  pkSideA: {
    backgroundColor: "#5AC8FA",
    alignItems: "center",
    justifyContent: "center",
  },
  pkSideB: {
    backgroundColor: "#FF453A",
    alignItems: "center",
    justifyContent: "center",
  },
  pkScore: { color: colors.onSurface, fontWeight: "900" },
  pkPick: {
    alignItems: "center",
    gap: 4,
    padding: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: "transparent",
    width: 88,
  },
  pkPickAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  pkPickName: { color: colors.onSurface, fontSize: 11, fontWeight: "700" },

  // Iter-34: incoming mic invitation card
  micInviteCard: {
    width: "82%",
    maxWidth: 340,
    alignSelf: "center",
    // Iter-117 — sits below screen centre.
    transform: [{ translateY: 150 }],
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.gold + "55",
    alignItems: "center",
    gap: spacing.sm,
  },
  micInviteAvatarWrap: {
    padding: 3,
    borderRadius: 999,
    backgroundColor: colors.gold + "33",
  },
  micInviteAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.surfaceTertiary,
  },
  micInviteName: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 6,
  },
  micInviteText: {
    color: colors.onSurface,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 4,
  },
  micInviteBtnRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    width: "100%",
  },
  micInviteBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  micInviteBtnText: { fontSize: 15, fontWeight: "900" },
});

// ============================== NEW SHEETS ==============================

/* Iter-67 — Owner-only centered room-avatar editor.
 *
 * Shows the current room cover enlarged, a camera button to pick a new
 * image, and a Save/Cancel row. New images go through the server
 * moderation hook (`/rooms/cover/moderate`) which rejects inappropriate
 * images and blocks them for 3 days. On success we call
 * `/rooms/{id}/cover` which persists the new cover and broadcasts
 * `room_state` so every connected client refreshes immediately.
 */
function RoomAvatarEditorModal({
  visible,
  onClose,
  roomId,
  currentCover,
  roomName,
  isRTL,
}: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  currentCover?: string | null;
  roomName: string;
  isRTL: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (visible) {
      setPicked(null);
      setErr(null);
      setBusy(false);
    }
  }, [visible]);

  const pick = async () => {
    setErr(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErr(
          isRTL
            ? "يُرجى منح إذن الوصول إلى الصور"
            : "Photo library permission required",
        );
        return;
      }
      const res = await pickAndCrop({ aspect: [1, 1], base64: true });
      if (res.canceled) return;
      const a = res.assets?.[0];
      if (!a) return;
      const dataUri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
      setBusy(true);
      try {
        await apiModerateRoomCover(dataUri);
        setPicked(dataUri);
      } catch (e: any) {
        setErr(e?.message || (isRTL ? "تم رفض الصورة" : "Image was rejected"));
      } finally {
        setBusy(false);
      }
    } catch (e: any) {
      setErr(
        e?.message || (isRTL ? "تعذّر اختيار الصورة" : "Could not pick image"),
      );
    }
  };

  const save = async () => {
    if (!picked) return;
    setErr(null);
    setBusy(true);
    try {
      await apiUpdateRoomCover(roomId, picked);
      // Optimistically invalidate the common caches so the new cover propagates everywhere immediately.
      qc.invalidateQueries({ queryKey: ["room", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["rooms-mine"] });
      qc.invalidateQueries({ queryKey: ["rooms-mine-gate"] });
      onClose();
    } catch (e: any) {
      setErr(e?.message || (isRTL ? "فشل الحفظ" : "Save failed"));
    } finally {
      setBusy(false);
    }
  };

  const preview = picked || currentCover || null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={_aStyles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={_aStyles.card}>
          <Text style={_aStyles.title} numberOfLines={1}>
            {roomName}
          </Text>
          <Text style={_aStyles.subtitle}>
            {isRTL ? "تحديث صورة الغرفة" : "Update Room Avatar"}
          </Text>

          <Pressable
            testID="room-avatar-edit-image"
            onPress={pick}
            disabled={busy}
            style={({ pressed }) => [
              _aStyles.avatarWrap,
              pressed && { opacity: 0.9 },
            ]}
          >
            {preview ? (
              <Image
                source={preview}
                style={_aStyles.avatarImg}
                contentFit="cover"
              />
            ) : (
              <View style={_aStyles.placeholder}>
                <Icon name="camera" size={32} color={colors.brandPrimary} />
              </View>
            )}
            <View style={_aStyles.pen}>
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Icon name="camera" size={14} color="#FFFFFF" />
              )}
            </View>
          </Pressable>

          {err ? <Text style={_aStyles.err}>{err}</Text> : null}

          <View
            style={{ flexDirection: "row", gap: 10, marginTop: spacing.lg }}
          >
            <Pressable
              testID="room-avatar-cancel"
              onPress={onClose}
              style={[_aStyles.btn, _aStyles.btnGhost]}
            >
              <Text style={_aStyles.btnGhostText}>
                {isRTL ? "إلغاء" : "Cancel"}
              </Text>
            </Pressable>
            <Pressable
              testID="room-avatar-save"
              onPress={save}
              disabled={!picked || busy}
              style={[
                _aStyles.btn,
                !picked || busy ? _aStyles.btnDim : _aStyles.btnActive,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={_aStyles.btnActiveText}>
                  {isRTL ? "حفظ" : "Save"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const _aStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.4)",
    alignItems: "center",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  title: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
    marginBottom: spacing.lg,
    fontWeight: "700",
  },

  avatarWrap: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
    borderColor: "rgba(139,92,246,0.6)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  avatarImg: { width: 156, height: 156, borderRadius: 78 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  pen: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#8B5CF6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
  err: {
    color: colors.error,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.md,
  },

  btn: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  btnGhostText: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  btnDim: {
    backgroundColor: "rgba(139,92,246,0.2)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.3)",
  },
  btnActive: {
    backgroundColor: "#8B5CF6",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  btnActiveText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
});

function ParticipantsSheet({
  visible,
  participants,
  onClose,
  onOpenUser,
}: {
  visible: boolean;
  participants: any[];
  onClose: () => void;
  onOpenUser: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="room-participants-sheet"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md, maxHeight: "70%" },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>
            In-room now · {participants.length}
          </Text>
          <ScrollView
            style={{ marginTop: spacing.md }}
            contentContainerStyle={{ paddingBottom: spacing.md }}
            showsVerticalScrollIndicator={false}
          >
            {participants.length === 0 ? (
              <Text
                style={{
                  color: colors.muted,
                  textAlign: "center",
                  marginVertical: spacing.xl,
                }}
              >
                No participants yet
              </Text>
            ) : (
              participants.map((p) => (
                <Pressable
                  key={p.id}
                  testID={`participant-${p.id}`}
                  onPress={() => onOpenUser(p.id)}
                  style={styles.participantRow}
                >
                  <Image
                    source={p.avatar_url}
                    style={styles.participantAvatar}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <VipName
                      style={styles.participantName}
                      numberOfLines={1}
                      name={p.nickname || "User"}
                      vipLevel={p.vip_level ?? 0}
                    />
                    {!!p.country_flag && (
                      <CountryFlag flag={p.country_flag} size={14} />
                    )}
                  </View>
                  <Icon name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MicActionSheet({
  seat,
  isRTL,
  isPrivileged,
  isSelfOnSeat,
  myUserId,
  onClose,
  onTakeMic,
  onChangeSeat,
  onInvite,
  onLock,
  onSit,
  onLeave,
}: {
  seat: Seat | null;
  isRTL: boolean;
  isPrivileged: boolean;
  isSelfOnSeat: boolean;
  myUserId?: string;
  onClose: () => void;
  onTakeMic: () => void;
  onChangeSeat: () => void;
  onInvite: () => void;
  onLock: (lock: boolean) => void;
  onSit: () => void;
  onLeave: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!seat) return null;
  const isLocked = !!seat.locked;
  const hasUser = !!seat.user;
  const isMineSeat = hasUser && seat.user?.id === myUserId;

  // Owner/mod see the full privileged sheet.
  if (isPrivileged) {
    const canTake = !hasUser && !isLocked; // Take Mic — empty & unlocked seat
    const canMove = hasUser && !isLocked; // Change Seat — occupied & unlocked seat
    const canInvite = !hasUser && !isLocked; // Invite — empty & unlocked seat
    const lockLabel = isLocked
      ? isRTL
        ? "فتح المايك"
        : "Unlock"
      : isRTL
        ? "قفل"
        : "Lock";
    const lockIcon = isLocked ? "lock-open" : "lock-closed-outline";
    const lockColor = isLocked ? colors.gold : colors.error;
    // Iter-34: first row reflects the SEAT's occupancy, not the caller's.
    //   • Empty & unlocked → "Take Mic"   (self takes THIS seat)
    //   • Occupied & unlocked → "Change Seat" (moves the seated user)
    //   • Locked → row hidden
    const showChangeSeat = canMove; // seat has someone we can relocate
    const showTakeMic = canTake && !hasUser; // seat is empty
    return (
      <Modal transparent animationType="slide" visible onRequestClose={onClose}>
        <Pressable
          style={styles.menuOverlay}
          onPress={onClose}
          testID="mic-action-sheet"
        >
          <Pressable
            style={[
              styles.menuSheet,
              { paddingBottom: insets.bottom + spacing.md, maxHeight: "80%" },
            ]}
          >
            <View style={styles.dragHandle} />
            <Text style={styles.menuTitle}>
              {isLocked
                ? isRTL
                  ? "مايك مقفل"
                  : "Locked mic"
                : `${isRTL ? "المايك" : "Mic"} ${seat.index}`}
            </Text>
            {showChangeSeat && (
              <Pressable
                testID="mic-action-change-seat"
                onPress={onChangeSeat}
                style={styles.micActionRow}
              >
                <Icon
                  name="swap-horizontal"
                  size={18}
                  color={colors.onSurface}
                />
                <Text style={styles.micActionText}>
                  {isRTL ? "تغيير المقعد" : "Change Seat"}
                </Text>
              </Pressable>
            )}
            {showTakeMic && (
              <Pressable
                testID="mic-action-take-mic"
                onPress={onTakeMic}
                style={styles.micActionRow}
              >
                <Icon name="mic" size={18} color={colors.gold} />
                <Text style={[styles.micActionText, { color: colors.gold }]}>
                  {isRTL ? "خذ ميك" : "Take Mic"}
                </Text>
              </Pressable>
            )}
            {/* Lock / Unlock — always enabled */}
            <Pressable
              testID="mic-action-lock"
              onPress={() => onLock(!isLocked)}
              style={styles.micActionRow}
            >
              <Icon name={lockIcon} size={18} color={lockColor} />
              <Text style={[styles.micActionText, { color: lockColor }]}>
                {lockLabel}
              </Text>
            </Pressable>
            {/* Invite — empty & unlocked only */}
            <Pressable
              testID="mic-action-invite"
              onPress={() => canInvite && onInvite()}
              disabled={!canInvite}
              style={[styles.micActionRow, !canInvite && { opacity: 0.4 }]}
            >
              <Icon
                name="person-add-outline"
                size={18}
                color={colors.onSurface}
              />
              <Text style={styles.micActionText}>
                {isRTL ? "دعوة" : "Invite"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // Regular user — limited sheet: Sit (empty seat) OR Leave (own seat). All
  // privileged controls (Lock / Change Seat / Invite) are HIDDEN.
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="mic-action-sheet"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md, maxHeight: "80%" },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>
            {isLocked
              ? isRTL
                ? "مايك مقفل"
                : "Locked mic"
              : `${isRTL ? "المايك" : "Mic"} ${seat.index}`}
          </Text>
          {isMineSeat ? (
            <Pressable
              testID="mic-action-leave"
              onPress={onLeave}
              style={styles.micActionRow}
            >
              <Icon name="log-out-outline" size={18} color={colors.error} />
              <Text style={[styles.micActionText, { color: colors.error }]}>
                {isRTL ? "مغادرة المقعد" : "Leave Seat"}
              </Text>
            </Pressable>
          ) : !hasUser && !isLocked ? (
            <Pressable
              testID="mic-action-sit"
              onPress={onSit}
              style={styles.micActionRow}
            >
              <Icon name="mic" size={18} color={colors.gold} />
              <Text style={[styles.micActionText, { color: colors.gold }]}>
                {isRTL ? "الجلوس هنا" : "Sit here"}
              </Text>
            </Pressable>
          ) : (
            <Text
              style={{
                color: colors.muted,
                textAlign: "center",
                paddingVertical: spacing.md,
              }}
            >
              {isRTL ? "لا توجد إجراءات متاحة" : "No actions available"}
            </Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function InviteToSeatSheet({
  visible,
  seat,
  participants,
  seatedIds,
  onClose,
  onPick,
}: {
  visible: boolean;
  seat: Seat | null;
  participants: any[];
  seatedIds: Set<string>;
  onClose: () => void;
  onPick: (uid: string) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible || !seat) return null;
  const eligible = participants.filter((p) => !seatedIds.has(p.id));
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="invite-sheet"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md, maxHeight: "70%" },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>Invite to Mic {seat.index}</Text>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.md }}
          >
            {eligible.length === 0 ? (
              <Text
                style={{
                  color: colors.muted,
                  textAlign: "center",
                  marginVertical: spacing.xl,
                }}
              >
                No off-mic users in the room
              </Text>
            ) : (
              eligible.map((p) => (
                <Pressable
                  key={p.id}
                  testID={`invite-${p.id}`}
                  onPress={() => onPick(p.id)}
                  style={styles.participantRow}
                >
                  <Image
                    source={p.avatar_url}
                    style={styles.participantAvatar}
                    contentFit="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <VipName
                      style={styles.participantName}
                      numberOfLines={1}
                      name={p.nickname || "User"}
                      vipLevel={p.vip_level ?? 0}
                    />
                  </View>
                  <Icon name="person-add" size={18} color={colors.gold} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChangeSeatSheet({
  visible,
  fromIndex,
  seats,
  onClose,
  onPick,
}: {
  visible: boolean;
  fromIndex: number;
  seats: Seat[];
  onClose: () => void;
  onPick: (idx: number) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  const options = seats
    .map((s) => s)
    .filter((s) => s.index !== fromIndex && !s.user && !s.locked);
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="change-seat-sheet"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md, maxHeight: "70%" },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>Move to seat…</Text>
          <ScrollView
            contentContainerStyle={{
              paddingBottom: spacing.md,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "center",
            }}
          >
            {options.length === 0 ? (
              <Text
                style={{
                  color: colors.muted,
                  textAlign: "center",
                  marginVertical: spacing.xl,
                }}
              >
                No empty seats
              </Text>
            ) : (
              options.map((s) => (
                <Pressable
                  key={s.index}
                  testID={`change-seat-to-${s.index}`}
                  onPress={() => onPick(s.index)}
                  style={styles.changeSeatOpt}
                >
                  <Text style={styles.changeSeatOptText}>
                    {s.index === 0 ? "★" : s.index}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Iter-34: Incoming mic invitation modal (shown to the invited user only).
// Real Accept → seats via POST /rooms/{id}/mic-invite/accept.
// Real Reject → clears + notifies via POST /rooms/{id}/mic-invite/reject.
function MicInviteIncoming({
  visible,
  invite,
  isRTL,
  accepting,
  rejecting,
  onAccept,
  onReject,
}: {
  visible: boolean;
  invite: {
    seat_index: number;
    inviter: {
      id: string;
      nickname?: string;
      avatar_url?: string;
      vip_level?: number;
    };
    expires_at: number;
  } | null;
  isRTL: boolean;
  accepting: boolean;
  rejecting: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  if (!visible || !invite) return null;
  const inviter = invite.inviter || {};
  const name =
    inviter.nickname || (isRTL ? "أحد أعضاء الغرفة" : "Someone in the room");
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onReject}>
      <Pressable
        style={styles.micInviteOverlay}
        onPress={onReject}
        testID="mic-invite-incoming"
      >
        <Pressable style={styles.micInviteCard}>
          {/* Iter-117 — no avatar image; card sits just below screen centre. */}
          <Text style={styles.micInviteName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.micInviteText}>
            {isRTL
              ? `${name} يدعوك للصعود على المايك\nهل تريد الصعود على المايك؟`
              : `${name} is inviting you to take Mic ${invite.seat_index}.\nDo you want to join the mic?`}
          </Text>
          <View style={styles.micInviteBtnRow}>
            <Pressable
              testID="mic-invite-reject"
              onPress={onReject}
              disabled={rejecting}
              style={[
                styles.micInviteBtn,
                { backgroundColor: colors.surfaceTertiary },
              ]}
            >
              <Text
                style={[styles.micInviteBtnText, { color: colors.onSurface }]}
              >
                {rejecting ? "…" : isRTL ? "رفض" : "Reject"}
              </Text>
            </Pressable>
            <Pressable
              testID="mic-invite-accept"
              onPress={onAccept}
              disabled={accepting}
              style={[styles.micInviteBtn, { backgroundColor: colors.gold }]}
            >
              <Text
                style={[
                  styles.micInviteBtnText,
                  { color: colors.onBrandPrimary },
                ]}
              >
                {accepting ? "…" : isRTL ? "قبول" : "Accept"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function LockRoomPrompt({
  visible,
  onClose,
  loading,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  loading: boolean;
  onSubmit: (pin: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState("");
  useEffect(() => {
    if (!visible) setPin("");
  }, [visible]);
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="lock-room-prompt"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>Set 5-digit room code</Text>
          <Text
            style={{
              color: colors.muted,
              textAlign: "center",
              marginBottom: spacing.md,
            }}
          >
            New joiners will need this code to enter.
          </Text>
          <TextInput
            testID="lock-room-pin-input"
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, "").slice(0, 5))}
            keyboardType="number-pad"
            placeholder="00000"
            placeholderTextColor={colors.muted}
            style={styles.pinInput}
            maxLength={5}
          />
          <Pressable
            testID="lock-room-submit"
            onPress={() => pin.length === 5 && onSubmit(pin)}
            disabled={pin.length !== 5 || loading}
            style={[
              styles.sendGiftBtn,
              (pin.length !== 5 || loading) && {
                opacity: 0.5,
                marginTop: spacing.md,
              },
              { marginTop: spacing.md },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.sendGiftText}>Lock room</Text>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BottomMoreSheet({
  visible,
  onClose,
  onMusic,
  onPk,
  onGames,
  onOpenInRoomGame,
  onMicMode,
  onBackground,
  isOwnerOrMod,
}: {
  visible: boolean;
  onClose: () => void;
  onMusic: () => void;
  onPk: () => void;
  onGames: () => void;
  onOpenInRoomGame: (gameType: "ludo" | "billiards") => void;
  onMicMode: () => void;
  onBackground: () => void;
  isOwnerOrMod: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { t, isRTL } = useI18n();
  const catalog = useQuery({
    queryKey: ["room-games-catalog"],
    queryFn: apiRoomGamesCatalog,
    enabled: visible,
    staleTime: 30_000,
  });
  if (!visible) return null;

  const entertainment = catalog.data?.entertainment ?? [];
  const betting = catalog.data?.betting ?? [];
  const entertainmentLabel = isRTL
    ? "ألعاب الغرفة الترفيهية"
    : "Room Entertainment Games";
  const bettingLabel = isRTL ? "ألعاب الرهان" : "Betting Games";

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={styles.menuOverlay}
        onPress={onClose}
        testID="room-more-sheet"
      >
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md, maxHeight: "80%" },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.dragHandle} />
          <ScrollView
            contentContainerStyle={{ paddingBottom: spacing.md }}
            showsVerticalScrollIndicator={false}
            testID="room-more-scroll"
          >
            {/* Section 1 — Room Tools. Iter-73: Minimize moved OUT (Room
                Controls only); Mic Mode moved IN; new "Background" option. */}
            <Text style={styles.menuTitle}>Room tools</Text>
            <View style={styles.menuGrid}>
              <MenuItem
                icon="musical-notes-outline"
                label="Music"
                testID="more-music"
                onPress={onMusic}
              />
              <MenuItem
                icon="flash-outline"
                label="PK Challenge"
                testID="more-pk"
                onPress={onPk}
              />
              <MenuItem
                icon="game-controller-outline"
                label="Games"
                testID="more-games"
                onPress={onGames}
              />
              {isOwnerOrMod && (
                <MenuItem
                  icon="grid-outline"
                  label="Mic Mode"
                  testID="more-mic-mode"
                  onPress={onMicMode}
                />
              )}
              {isOwnerOrMod && (
                <MenuItem
                  icon="image-outline"
                  label={isRTL ? "الخلفية" : "Background"}
                  testID="more-background"
                  onPress={onBackground}
                />
              )}
            </View>

            {/* Section 2 — Entertainment games (no wagering). */}
            <View style={styles.catalogDivider} />
            <Text style={styles.catalogSectionTitle} numberOfLines={1}>
              {entertainmentLabel}
            </Text>
            {catalog.isLoading ? (
              <ActivityIndicator
                color={colors.onSurface}
                style={{ padding: spacing.lg }}
              />
            ) : entertainment.length === 0 ? (
              <Text style={styles.emptyText}>
                No entertainment games configured
              </Text>
            ) : (
              <View style={styles.menuGrid}>
                {entertainment.map((g) => (
                  <MenuItem
                    key={g.id}
                    icon={(g.icon as any) || "game-controller-outline"}
                    label={isRTL ? g.title_ar : g.title_en}
                    testID={`entertainment-${g.game_type}`}
                    onPress={() => {
                      if (
                        g.game_type === "ludo" ||
                        g.game_type === "billiards"
                      ) {
                        onClose();
                        onOpenInRoomGame(g.game_type);
                      }
                    }}
                  />
                ))}
              </View>
            )}

            {/* Section 3 — Betting games (admin + licensed provider gated). */}
            <View style={styles.catalogDivider} />
            <Text style={styles.catalogSectionTitle} numberOfLines={1}>
              {bettingLabel}
            </Text>
            {catalog.isLoading ? null : betting.length === 0 ? (
              <Text style={styles.emptyText}>
                {isRTL
                  ? "لا توجد ألعاب رهان مُفعلة. تتطلب إعدادات مزود مرخّص."
                  : "No betting games enabled. Requires a licensed provider configuration."}
              </Text>
            ) : (
              <View style={styles.menuGrid}>
                {betting.map((g) => (
                  <BettingTile key={g.id} entry={g} isRTL={isRTL} />
                ))}
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BettingTile({
  entry,
  isRTL,
}: {
  entry: RoomGameEntry;
  isRTL: boolean;
}) {
  const unavailable = !entry.enabled;
  return (
    <View
      style={[styles.menuTile, unavailable && { opacity: 0.55 }]}
      testID={`betting-${entry.game_type}`}
    >
      <View style={styles.menuIconWrap}>
        <Icon
          name={(entry.icon as any) || "diamond-outline"}
          size={20}
          color={colors.gold}
        />
        {unavailable && (
          <View style={styles.lockBadge}>
            <Icon name="lock-closed" size={10} color={colors.onError} />
          </View>
        )}
      </View>
      <Text style={styles.menuLabel} numberOfLines={1}>
        {isRTL ? entry.title_ar : entry.title_en}
      </Text>
      <Text style={styles.menuSubLabel} numberOfLines={1}>
        {unavailable
          ? isRTL
            ? "غير متاح"
            : "Unavailable"
          : isRTL
            ? "متاح"
            : "Available"}
      </Text>
    </View>
  );
}

function PkPanel({
  visible,
  onClose,
  roomId,
  seats,
  isMod,
}: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  seats: Seat[];
  isMod: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [seatA, setSeatA] = useState<number | null>(null);
  const [seatB, setSeatB] = useState<number | null>(null);
  const qc = useQueryClient();
  const { data: pk } = useQuery({
    queryKey: ["pk", roomId],
    queryFn: () => import("@/src/api").then((m) => m.apiPkState(roomId)),
    enabled: visible,
    refetchInterval: visible ? 3000 : false,
  });
  const startMut = useMutation({
    mutationFn: () => apiPkStart(roomId, seatA!, seatB!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pk", roomId] }),
    onError: (e: any) => Alert.alert("Error", e?.message || "Failed"),
  });
  const endMut = useMutation({
    mutationFn: () => apiPkEnd(roomId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pk", roomId] }),
  });
  if (!visible) return null;
  const active = pk && pk.status === "active";
  const seated = seats.filter((s) => s.user);
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose} testID="pk-panel">
        <Pressable
          style={[
            styles.menuSheet,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.dragHandle} />
          <Text style={styles.menuTitle}>PK Challenge</Text>
          {active ? (
            <View>
              <Text style={styles.pkVs}>
                {pk.user_a?.nickname} vs {pk.user_b?.nickname}
              </Text>
              <View style={styles.pkBar}>
                <View
                  style={[styles.pkSideA, { flex: Math.max(1, pk.score_a) }]}
                >
                  <Text style={styles.pkScore}>{pk.score_a}</Text>
                </View>
                <View
                  style={[styles.pkSideB, { flex: Math.max(1, pk.score_b) }]}
                >
                  <Text style={styles.pkScore}>{pk.score_b}</Text>
                </View>
              </View>
              <Text
                style={{
                  color: colors.muted,
                  fontSize: 12,
                  textAlign: "center",
                  marginTop: 6,
                }}
              >
                Send gifts to a side to add to their score.
              </Text>
              {isMod && (
                <Pressable
                  testID="pk-end-btn"
                  onPress={() => endMut.mutate()}
                  style={[
                    styles.sendGiftBtn,
                    { marginTop: spacing.md, backgroundColor: colors.error },
                  ]}
                >
                  <Text
                    style={[styles.sendGiftText, { color: colors.onSurface }]}
                  >
                    End PK
                  </Text>
                </Pressable>
              )}
            </View>
          ) : isMod ? (
            <View>
              <Text
                style={{
                  color: colors.muted,
                  textAlign: "center",
                  marginBottom: spacing.md,
                }}
              >
                Pick two seated users for the 1v1 battle.
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  gap: 6,
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                {seated.map((s) => (
                  <Pressable
                    key={s.index}
                    testID={`pk-pick-${s.index}`}
                    onPress={() => {
                      if (seatA === s.index) setSeatA(null);
                      else if (seatB === s.index) setSeatB(null);
                      else if (seatA === null) setSeatA(s.index);
                      else if (seatB === null) setSeatB(s.index);
                    }}
                    style={[
                      styles.pkPick,
                      (seatA === s.index || seatB === s.index) && {
                        borderColor: colors.gold,
                        borderWidth: 2,
                      },
                    ]}
                  >
                    <Image
                      source={s.user!.avatar_url}
                      style={styles.pkPickAvatar}
                    />
                    <VipName
                      style={styles.pkPickName}
                      numberOfLines={1}
                      name={s.user!?.nickname}
                      color={(s.user! as any)?.name_color}
                      vipLevel={(s.user! as any)?.vip_level}
                    />
                  </Pressable>
                ))}
              </View>
              <Pressable
                testID="pk-start-btn"
                disabled={
                  seatA === null || seatB === null || startMut.isPending
                }
                onPress={() => startMut.mutate()}
                style={[
                  styles.sendGiftBtn,
                  { marginTop: spacing.md },
                  (seatA === null || seatB === null) && { opacity: 0.5 },
                ]}
              >
                <Text style={styles.sendGiftText}>Start PK (3 min)</Text>
              </Pressable>
            </View>
          ) : (
            <Text
              style={{
                color: colors.muted,
                textAlign: "center",
                marginVertical: spacing.xl,
              }}
            >
              Waiting for the host to start a PK.
            </Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---- Custom ORIO room follow heart + membership button (iter-18) ----
function RoomFollowHeart({
  roomId,
  initialCount,
}: {
  roomId: string;
  initialCount: number;
}) {
  const qc = useQueryClient();
  const [reqPending, setReqPending] = useState(false);
  const { data: status } = useQuery({
    queryKey: ["room-follow-status", roomId],
    queryFn: () => apiRoomFollowStatus(roomId),
    initialData: {
      is_following: false,
      is_member: false,
      has_pending_request: false,
      follow_count: initialCount,
      member_count: 0,
    },
    staleTime: 30_000,
  });
  const followMut = useMutation({
    mutationFn: () => apiRoomFollow(roomId),
    onSuccess: (d) =>
      qc.setQueryData(["room-follow-status", roomId], (prev: any) => ({
        ...(prev || {}),
        is_following: true,
        follow_count: d.follow_count,
      })),
  });
  const unfollowMut = useMutation({
    mutationFn: () => apiRoomUnfollow(roomId),
    onSuccess: (d) =>
      qc.setQueryData(["room-follow-status", roomId], (prev: any) => ({
        ...(prev || {}),
        is_following: false,
        has_pending_request: false,
        follow_count: d.follow_count,
      })),
  });
  const requestMembership = useMutation({
    mutationFn: () => apiRoomMembershipRequest(roomId),
    onMutate: () => setReqPending(true),
    onSuccess: () =>
      qc.setQueryData(["room-follow-status", roomId], (prev: any) => ({
        ...(prev || {}),
        has_pending_request: true,
      })),
    onSettled: () => setReqPending(false),
    onError: (e: any) => Alert.alert("Membership", e?.message ?? "Failed"),
  });

  const isFollowing = !!status?.is_following;
  return (
    <View style={styles.headerRightCluster}>
      <Pressable
        testID="room-follow-heart"
        hitSlop={6}
        onPress={() =>
          isFollowing ? unfollowMut.mutate() : followMut.mutate()
        }
        style={styles.followBtn}
      >
        <OrioHeart size={22} active={isFollowing} />
        <Text style={styles.followCount} testID="room-follow-count">
          {Number(status?.follow_count ?? initialCount).toLocaleString()}
        </Text>
      </Pressable>
      {isFollowing && (
        <Pressable
          testID="room-membership-btn"
          hitSlop={6}
          onPress={() =>
            status?.is_member
              ? undefined
              : status?.has_pending_request
                ? Alert.alert("Membership", "Your request is pending review")
                : requestMembership.mutate()
          }
          style={styles.membershipBtn}
        >
          {reqPending ? (
            <ActivityIndicator color={colors.gold} size="small" />
          ) : (
            <OrioMembership size={22} active={!!status?.is_member} />
          )}
        </Pressable>
      )}
    </View>
  );
}

// ---- Iter-19: People strip (real WS presence) ----
function RoomPeopleStrip({
  participants,
  onOpenUser,
}: {
  participants: any[];
  onOpenUser: (id: string) => void;
}) {
  // De-duplicate: WebSocket presence maps unique user id → user. Even if the
  // same account reconnects, we render them once.
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const p of participants || []) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }, [participants]);
  return (
    <View style={styles.peopleStrip} testID="room-people-strip">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          gap: 6,
          alignItems: "center",
        }}
      >
        {unique.map((p) => (
          <Pressable
            key={p.id}
            testID={`strip-person-${p.id}`}
            hitSlop={4}
            onPress={() => onOpenUser(p.id)}
            style={styles.stripAvatarWrap}
          >
            <Image
              source={p.avatar_url}
              style={styles.stripAvatar}
              contentFit="cover"
            />
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.stripCountPill}>
        <Icon name="people" size={11} color={colors.gold} />
        <Text style={styles.stripCountText} testID="room-people-count">
          {unique.length}
        </Text>
      </View>
    </View>
  );
}
