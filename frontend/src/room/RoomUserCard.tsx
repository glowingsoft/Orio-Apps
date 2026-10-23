/**
 * RoomUserCard — a floating info card shown when the user taps an avatar
 * inside the room. Fetches the target user's real profile and shows
 * ID / country / gender / age / VIP / wealth / charm / family / gifts.
 *
 * The card overlays the room; opening it does NOT change seat state, does NOT
 * remove the tapped user from their seat, and does NOT affect Agora.
 *
 * Iter-50 — Full-width + square corners + role-aware Settings menu + @ button.
 *   - "Leave Seat" only visible to the account currently sitting on the seat (self)
 *   - Settings (top-right): Normal user → Report only.
 *                           Owner → Assign Mod / Remove from Mic / Kick / Block / Report
 *   - @ button (top-left) → inserts "@username " into room chat input via a callback
 */
import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  apiGetUser, apiUserGiftsReceived, apiFollow, apiUnfollow,
  apiReportUser, apiBlockUser,
  apiRoomModerate, apiMicChangeSeat,
  apiRoomModAdd as apiRoomAddModerator,
  apiRoomBanAdd as apiRoomAddBan,
} from "@/src/api";
import { VipName } from "@/src/components/VipName";
import { useToast } from "@/src/components/Toast";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { FlagCircle } from "@/src/levels/badges";
import { LevelBoxes } from "@/src/levels/LevelBoxes";
import { RoomSupportBadges } from "@/src/room/RoomSupportBadges";
import { copyIdToClipboard } from "@/src/utils/copyId";
import { NewUserBadge } from "@/src/components/NewUserBadge";

type Seat = { index: number; user: any | null; muted: boolean; locked: boolean };

type Props = {
  visible: boolean;
  userId: string | null;
  isOnSeat: boolean;    // whether this target user occupies a seat
  isMe: boolean;        // whether the target is the current user
  // Iter-50 — role & room context for role-aware admin actions.
  isViewerOwner?: boolean;  // the current signed-in user is the room owner
  isViewerMod?: boolean;    // the current user is a room moderator
  targetIsPriv?: boolean;   // target is the owner / a moderator
  chatMuted?: boolean;      // target is currently muted from room chat
  onToggleChatMute?: () => void;
  roomId?: string;
  seatIndex?: number;   // the seat index the target user occupies (if any)
  // Iter-51 §8-10 — live seat snapshot so the owner can pick a destination
  // seat without the picker having to refetch the room.
  seats?: Seat[];
  onClose: () => void;
  onLeaveSeat: () => void;
  onSendGift: () => void;
  /** Mic mute toggle: self (own seat) or staff muting a seated user. */
  onToggleMic?: () => void;
  seatMuted?: boolean;
  onOpenFullProfile: () => void;
  onMention?: (user: { id: string; nickname: string }) => void;
};

export function RoomUserCard(props: Props) {
  const {
    visible, userId, isOnSeat, isMe,
    isViewerOwner = false, isViewerMod = false, targetIsPriv = false, chatMuted = false, onToggleChatMute, roomId, seatIndex, seats = [],
    onClose, onLeaveSeat, onSendGift, onOpenFullProfile, onMention, onToggleMic, seatMuted = false,
  } = props;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { isRTL, t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Iter-51 §8-10 — seat-picker modal state for the owner's Change-Seat flow.
  const [seatPickerOpen, setSeatPickerOpen] = useState(false);

  const { data: u, isLoading } = useQuery({
    queryKey: ["profile", userId],
    queryFn: () => apiGetUser(userId!),
    enabled: !!userId && visible,
  });

  const isFollowing = !!u?.is_following;
  const followMut = useMutation({
    mutationFn: () => apiFollow(userId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile", userId] });
      qc.setQueryData(["profile", userId], (old: any) =>
        old ? { ...old, is_following: true } : old,
      );
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to follow"),
  });
  const unfollowMut = useMutation({
    mutationFn: () => apiUnfollow(userId!),
    onSuccess: () => {
      qc.setQueryData(["profile", userId], (old: any) => (old ? { ...old, is_following: false } : old));
      qc.invalidateQueries({ queryKey: ["profile", userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  // ---- Iter-50 admin mutations (owner-only). Permissions are enforced
  // server-side; these just surface friendly errors. ----
  const reportMut = useMutation({
    mutationFn: () => apiReportUser(userId!, { reason: "room_profile_report" }),
    onSuccess: () => {
      setMenuOpen(false);
      toast.success(isRTL ? "تم إرسال البلاغ" : "Report submitted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Report failed"),
  });

  const blockMut = useMutation({
    mutationFn: () => apiBlockUser(userId!),
    onSuccess: () => {
      setMenuOpen(false);
      toast.success(isRTL ? "تم الحظر" : "Blocked");
    },
    onError: (e: any) => toast.error(e?.message ?? "Block failed"),
  });

  const assignModMut = useMutation({
    mutationFn: () => apiRoomAddModerator(roomId!, userId!),
    onSuccess: () => {
      setMenuOpen(false);
      toast.success(isRTL ? "تم تعيين مشرف" : "Moderator assigned");
    },
    onError: (e: any) => toast.error(e?.message ?? "Assign failed"),
  });

  const removeFromMicMut = useMutation({
    mutationFn: () => apiRoomModerate(roomId!, "kick_seat", seatIndex ?? -1),
    onSuccess: () => {
      setMenuOpen(false);
      onClose();
      toast.success(isRTL ? "تمت الإزالة من المايك" : "Removed from mic");
    },
    onError: (e: any) => toast.error(e?.message ?? "Remove failed"),
  });

  const kickMut = useMutation({
    mutationFn: () => apiRoomAddBan(roomId!, userId!, "kicked_from_profile_card"),
    onSuccess: () => {
      setMenuOpen(false);
      onClose();
      toast.success(isRTL ? "تم الطرد" : "User kicked");
    },
    onError: (e: any) => toast.error(e?.message ?? "Kick failed"),
  });

  // Iter-51 §8-10 — Change Seat (owner only). Moves the target user from
  // their current seat to a chosen destination seat. The server rejects
  // 409 if the destination is occupied / 403 if the destination is locked /
  // 403 if the caller lacks the owner-or-mod role.
  const changeSeatMut = useMutation({
    mutationFn: (toIndex: number) =>
      apiMicChangeSeat(roomId!, seatIndex ?? -1, toIndex),
    onSuccess: () => {
      setSeatPickerOpen(false);
      onClose();
      toast.success(isRTL ? "تم تحريك المستخدم" : "Seat changed");
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (/occupied/i.test(msg) || /409/.test(msg)) {
        toast.error(isRTL ? "المقعد مشغول" : "Seat is occupied");
      } else if (/locked/i.test(msg)) {
        toast.error(isRTL ? "المقعد مقفل" : "Seat is locked");
      } else {
        toast.error(msg || "Change seat failed");
      }
    },
  });

  const openChat = () => {
    if (!userId) return;
    onClose();
    router.push(`/chat/${userId}` as any);
  };

  const { data: giftsData } = useQuery({
    queryKey: ["gifts-received", userId],
    queryFn: () => apiUserGiftsReceived(userId!),
    enabled: !!userId && visible,
  });
  const previewGifts: any[] = (giftsData?.gifts || []).slice(0, 4);

  const accountAgeDays = useMemo(() => {
    if (!u?.created_at) return 1;
    const created = new Date(u.created_at).getTime();
    return Math.max(1, Math.floor((Date.now() - created) / 86_400_000) + 1);
  }, [u?.created_at]);

  const copyId = async () => {
    if (!u?.numeric_id) return;
    const ok = await copyIdToClipboard(u.numeric_id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const openGiftsPage = () => {
    if (!userId) return;
    onClose();
    router.push(`/user/${userId}/gifts` as any);
  };

  // --- Mention: insert @nickname into room chat input via the parent callback ---
  const mention = () => {
    if (!u || !userId) return;
    onMention?.({ id: userId, nickname: u.nickname || "user" });
    onClose();
  };

  // --- Role-aware action buttons for the Settings menu ---
  // Normal user → Report only. Owner → full admin set.
  const menuItems: {
    key: string;
    label: string;
    icon: string;
    danger?: boolean;
    onPress: () => void;
    disabled?: boolean;
  }[] = [];
  if (!isMe) {
    // Owner (anyone except self) / moderator (regular users only).
    if (onToggleChatMute && (isViewerOwner || (isViewerMod && !targetIsPriv))) {
      menuItems.push({
        key: chatMuted ? "chat-unmute" : "chat-mute",
        label: chatMuted ? (isRTL ? "إلغاء الكتم" : "Unmute") : (isRTL ? "كتم من الدردشة" : "Mute from Chat"),
        icon: chatMuted ? "chatbubble-ellipses-outline" : "chatbubble-outline",
        onPress: () => { setMenuOpen(false); onToggleChatMute(); },
      });
    }
    if (isViewerOwner) {
      menuItems.push({
        key: "assign-mod",
        label: isRTL ? "تعيين كمشرف للغرفة" : "Assign as Room Moderator",
        icon: "shield-checkmark",
        onPress: () => assignModMut.mutate(),
        disabled: assignModMut.isPending,
      });
      if (isOnSeat && typeof seatIndex === "number" && seatIndex > 0) {
        menuItems.push({
          key: "remove-mic",
          label: isRTL ? "سحب من الميك" : "Remove from Mic",
          icon: "mic-off",
          onPress: () => removeFromMicMut.mutate(),
          disabled: removeFromMicMut.isPending,
        });
      }
      menuItems.push({
        key: "kick",
        label: isRTL ? "طرد" : "Kick",
        icon: "exit",
        danger: true,
        onPress: () => kickMut.mutate(),
        disabled: kickMut.isPending,
      });
      menuItems.push({
        key: "block",
        label: isRTL ? "حظر" : "Block",
        icon: "ban",
        danger: true,
        onPress: () => blockMut.mutate(),
        disabled: blockMut.isPending,
      });
    }
    menuItems.push({
      key: "report",
      label: isRTL ? "إبلاغ" : "Report",
      icon: "flag",
      danger: !isViewerOwner,
      // Iter-51 §6 — Report must open the dedicated إبلاغ page (not an inline toast).
      onPress: () => {
        setMenuOpen(false);
        onClose();
        router.push(`/report?user_id=${userId}` as any);
      },
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop} testID="room-user-card" pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Pressable
          style={[styles.card, { paddingBottom: insets.bottom }]}
          onPress={(e) => { e.stopPropagation?.(); setMenuOpen(false); }}
        >
          {/* Iter-50/51 header: @ (left) + Change-Seat arrow (owner only, when target on mic) + Settings (right) */}
          <View style={[styles.headerBar, { flexDirection: "row" }]}>
            {!isMe ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Pressable
                  testID="card-mention"
                  onPress={mention}
                  hitSlop={10}
                  style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.75 }]}
                  accessibilityLabel={isRTL ? "ذكر" : "Mention"}
                >
                  <Text style={styles.atText}>@</Text>
                </Pressable>
                {/* Iter-51 §8-10: Change Seat arrow — owner only, target must be on a numbered mic. */}
                {isViewerOwner && isOnSeat && typeof seatIndex === "number" && seatIndex > 0 && (
                  <Pressable
                    testID="card-change-seat"
                    onPress={() => { setMenuOpen(false); setSeatPickerOpen(true); }}
                    hitSlop={10}
                    style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.75 }]}
                    accessibilityLabel={isRTL ? "تبديل المقعد" : "Change Seat"}
                  >
                    <Icon name="swap-horizontal" size={22} color="#141414" />
                  </Pressable>
                )}
              </View>
            ) : <View style={{ width: 40 }} />}

            <View style={{ flex: 1 }} />

            {menuItems.length > 0 ? (
              <Pressable
                testID="card-settings-btn"
                onPress={() => setMenuOpen((x) => !x)}
                hitSlop={10}
                style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.75 }]}
                accessibilityLabel={isRTL ? "الإعدادات" : "Settings"}
              >
                <Icon name="ellipsis-horizontal" size={22} color="#141414" />
              </Pressable>
            ) : <View style={{ width: 40 }} />}
          </View>

          {/* Settings menu — anchors to the top-right (or top-left in RTL) */}
          {menuOpen && (
            <View
              testID="card-settings-menu"
              style={[
                styles.menu,
                isRTL ? { left: spacing.lg } : { right: spacing.lg },
              ]}
            >
              {menuItems.map((it) => (
                <Pressable
                  key={it.key}
                  testID={`card-action-${it.key}`}
                  disabled={it.disabled}
                  onPress={it.onPress}
                  style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.surfaceSecondary }]}
                >
                  <Icon
                    name={it.icon as any}
                    size={16}
                    color={it.danger ? colors.error : "#141414"}
                  />
                  <Text style={[styles.menuLabel, it.danger && { color: colors.error }]}>
                    {it.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {u && (
            <Pressable
              onPress={onOpenFullProfile}
              style={styles.avatarWrap}
              testID="card-open-profile"
            >
              <Image source={u.avatar_url} style={styles.avatar} contentFit="cover" />
            </Pressable>
          )}
          {isLoading || !u ? (
            <View style={{ height: 220, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} style={styles.bodyScroll}>
              <View style={styles.body}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                  <VipName name={u.nickname} color={(u as any).name_color} style={styles.name} numberOfLines={1} />
                  <NewUserBadge isNew={u.is_new} />
                </View>
                <Pressable
                  testID="card-copy-id"
                  onPress={copyId}
                  style={styles.idRow}
                  hitSlop={6}
                >
                  <Icon name={copied ? "checkmark-circle" : "id-card-outline"} size={12} color={copied ? colors.success : "rgba(0,0,0,0.6)"} />
                  <Text style={[styles.idText, copied && { color: colors.success }]}>
                    {copied ? "Copied!" : `ID: ${u.numeric_id || "—"}`}
                  </Text>
                  {!copied && <Icon name="copy-outline" size={11} color={"rgba(0,0,0,0.6)"} />}
                </Pressable>

                <View style={styles.infoRow}>
                  <FlagCircle testID="card-flag" flag={u.country_flag} size={26} />
                  {u.gender && (
                    <View style={[styles.genderPill, { backgroundColor: (u.gender === "female" ? "#FF69B4" : "#5AC8FA") + "22", borderColor: u.gender === "female" ? "#FF69B4" : "#5AC8FA" }]}>
                      <Icon name={u.gender === "female" ? "female" : "male"} size={12} color={u.gender === "female" ? "#FF69B4" : "#5AC8FA"} />
                      {typeof u.age === "number" && (
                        <Text style={[styles.genderText, { color: u.gender === "female" ? "#FF69B4" : "#5AC8FA" }]}>{u.age}</Text>
                      )}
                    </View>
                  )}
                  <View style={styles.pill}>
                    <Icon name="calendar-outline" size={12} color={colors.brandPrimary} />
                    <Text style={[styles.pillText, { color: colors.brandPrimary }]}>{`${accountAgeDays} ${t.days || "days"}`}</Text>
                  </View>
                  {/* Iter-122 — room-only: Trophy (sent) → Star (received), after Days. */}
                  <RoomSupportBadges roomId={roomId} userId={userId} />
                </View>

                <View style={{ marginTop: spacing.md }}>
                  <LevelBoxes user={u} testIDPrefix="card" onNavigate={onClose} labels={{ wealth: t.wealth || "Wealth", charm: t.charm || "Charm" }} />
                </View>

                <Text style={styles.sectionLabel}>{isRTL ? "الهدايا المستلمة" : "Gifts Received"}</Text>
                <Pressable
                  testID="card-gifts-gallery"
                  onPress={openGiftsPage}
                  style={styles.giftGallery}
                >
                  <View style={styles.giftGridRow}>
                    {previewGifts.length === 0 ? (
                      [0, 1, 2, 3].map((i) => (
                        <View key={i} style={styles.giftTile}>
                          <Icon name="gift-outline" size={18} color="rgba(0,0,0,0.45)" />
                        </View>
                      ))
                    ) : (
                      previewGifts.map((g: any, i: number) => (
                        <View key={g.gift_id + i} style={styles.giftTileReal}>
                          <Image source={g.gift_image} style={styles.giftTileImg} contentFit="cover" />
                          <View style={styles.giftTileBadge}>
                            <Text style={styles.giftTileBadgeText}>×{g.total_quantity}</Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                </Pressable>
              </View>
            </ScrollView>
          )}

          {/* Compact one-row actions.
              Others: Send Gift | Follow/Unfollow | Mute (staff only, target on mic)
              Me:     Leave Seat | Send Gift | Mute/Unmute (when on mic) */}
          {u && (
            <View style={[styles.actionRow, { flexDirection: "row" }]} testID="card-action-row">
              {isMe ? (
                <>
                  {isOnSeat && (
                    <Pressable testID="card-leave-seat" onPress={onLeaveSeat} style={styles.chip}>
                      <Icon name="log-out-outline" size={15} color="#FF6B6B" />
                      <Text style={styles.chipText}>{isRTL ? "مغادرة المقعد" : "Leave Seat"}</Text>
                    </Pressable>
                  )}
                  <Pressable testID="card-send-gift" onPress={onSendGift} style={styles.chip}>
                    <Icon name="gift" size={15} color={colors.brandPrimary} />
                    <Text style={styles.chipText}>{isRTL ? "إرسال هدية" : "Send Gift"}</Text>
                  </Pressable>
                  {isOnSeat && onToggleMic && (
                    <Pressable testID="card-mic-toggle" onPress={onToggleMic} style={styles.chip}>
                      <Icon name={seatMuted ? "mic-off" : "mic"} size={15} color={seatMuted ? "#FF4D4F" : "#141414"} />
                      <Text style={styles.chipText}>{seatMuted ? (isRTL ? "إلغاء الكتم" : "Unmute") : (isRTL ? "كتم" : "Mute")}</Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <>
                  <Pressable testID="card-send-gift" onPress={onSendGift} style={styles.chip}>
                    <Icon name="gift" size={15} color={colors.brandPrimary} />
                    <Text style={styles.chipText}>{isRTL ? "إرسال هدية" : "Send Gift"}</Text>
                  </Pressable>
                  <Pressable
                    testID={isFollowing ? "card-unfollow" : "card-follow"}
                    disabled={followMut.isPending || unfollowMut.isPending}
                    onPress={() => (isFollowing ? unfollowMut.mutate() : followMut.mutate())}
                    style={styles.chip}
                  >
                    <Icon name={isFollowing ? "person-remove-outline" : "person-add-outline"} size={15} color="#141414" />
                    <Text style={styles.chipText}>{isFollowing ? (isRTL ? "إلغاء المتابعة" : "Unfollow") : (isRTL ? "متابعة" : "Follow")}</Text>
                  </Pressable>
                  {isViewerMod && !targetIsPriv && isOnSeat && onToggleMic && (
                    <Pressable testID="card-mic-toggle" onPress={onToggleMic} style={styles.chip}>
                      <Icon name={seatMuted ? "mic-off" : "mic"} size={15} color={seatMuted ? "#FF4D4F" : "#141414"} />
                      <Text style={styles.chipText}>{seatMuted ? (isRTL ? "إلغاء الكتم" : "Unmute") : (isRTL ? "كتم" : "Mute")}</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          )}
        </Pressable>

        {/* Iter-51 §9: Change Seat picker — owner selects an available mic.
            Only available seats (empty & unlocked, excluding seat 0 host chair)
            are shown; occupied/locked seats are disabled with a clear reason. */}
        {seatPickerOpen && (
          <View style={styles.seatPickerBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSeatPickerOpen(false)} />
            <View style={[styles.seatPickerCard, { paddingBottom: insets.bottom + spacing.lg }]} testID="change-seat-picker">
              <View style={{ alignItems: "center" }}>
                <View style={styles.sheetHandle} />
                <Text style={styles.seatPickerTitle}>
                  {isRTL ? "اختر مقعد الوجهة" : "Choose destination seat"}
                </Text>
              </View>
              <View style={styles.seatGrid}>
                {seats
                  .filter((s) => s.index > 0 && s.index !== seatIndex)
                  .map((s) => {
                    const taken = !!s.user;
                    const locked = !!s.locked;
                    const disabled = taken || locked || changeSeatMut.isPending;
                    return (
                      <Pressable
                        key={s.index}
                        testID={`seat-pick-${s.index}`}
                        disabled={disabled}
                        onPress={() => changeSeatMut.mutate(s.index)}
                        style={({ pressed }) => [
                          styles.seatPickTile,
                          taken && { opacity: 0.4 },
                          locked && { opacity: 0.4, borderColor: colors.muted },
                          pressed && !disabled && { backgroundColor: colors.brandPrimary + "22" },
                        ]}
                      >
                        <Icon
                          name={locked ? "lock-closed" : taken ? "person" : "mic"}
                          size={18}
                          color={taken || locked ? colors.muted : colors.brandPrimary}
                        />
                        <Text style={styles.seatPickLabel}>
                          {isRTL ? `مقعد ${s.index}` : `Mic ${s.index}`}
                        </Text>
                        {(taken || locked) && (
                          <Text style={styles.seatPickHint}>
                            {locked ? (isRTL ? "مقفل" : "Locked") : (isRTL ? "مشغول" : "Taken")}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "transparent", justifyContent: "flex-end" },
  // Iter-50/51 — Full width, sharp corners, no clipping. Content fits via
  // the inner ScrollView; no fixed height clipping the bottom buttons.
  card: {
    backgroundColor: "#FFFFFF",
    width: "100%",
    maxHeight: "85%",
    borderTopWidth: 1,
    borderTopColor: colors.brandPrimary + "33",
    // Iter-56 — allow avatar to visually overlap above the card.
    overflow: "visible",
  },
  headerBar: {
    height: 48,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    // Iter-51 §3 — no visible divider line under the header bar.
  },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  atText: {
    color: "#141414", fontWeight: "900", fontSize: 22, lineHeight: 24,
  },
  menu: {
    position: "absolute",
    top: 48,
    minWidth: 180,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.brandPrimary + "33",
    borderRadius: radius.md,
    paddingVertical: 4,
    zIndex: 50,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuLabel: { color: "#141414", fontSize: 14, fontWeight: "600" },

  avatarWrap: {
    // Iter-63 — Avatar is anchored to the card's TOP edge with the top half
    // extending above the card and the bottom half sitting inside. Absolute
    // positioning (not negative margin) is required so the avatar actually
    // breaks the top border instead of just being pulled below the header bar.
    position: "absolute",
    top: -44,                                 // exactly 50% outside the card
    left: "50%",
    marginLeft: -44,                          // center horizontally (half width)
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.surface,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.28)",
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
    zIndex: 20,
  },
  avatar: { width: "100%", height: "100%" },
  // Iter-63 — reserve top space inside the scroll body equal to the avatar's
  // inside-half (44) + a small gap so content never collides with the avatar.
  bodyScroll: { marginTop: 52 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  name: { color: "#141414", fontSize: 17, fontWeight: "800", textAlign: "center" },
  idRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4,
    alignSelf: "center", paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill, backgroundColor: "#F2F2F5",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(0,0,0,0.08)",
  },
  idText: { color: "rgba(0,0,0,0.6)", fontSize: 12, fontWeight: "700" },
  infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  genderPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  genderText: { fontSize: 11, fontWeight: "800" },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: "#F5F5F8", borderWidth: 1, borderColor: colors.brandPrimary + "44" },
  pillText: { fontSize: 11, fontWeight: "700" },
  sectionLabel: { color: "rgba(0,0,0,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: 6 },
  giftGallery: {},
  giftGridRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  giftTile: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#F2F2F5", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(0,0,0,0.08)" },
  giftTileReal: {
    width: 48, height: 48, borderRadius: 10,
    backgroundColor: "#F2F2F5",
    borderWidth: 1, borderColor: colors.brandPrimary + "44",
    overflow: "hidden", position: "relative",
  },
  giftTileImg: { width: "100%", height: "100%" },
  giftTileBadge: {
    position: "absolute", right: -2, bottom: -2,
    backgroundColor: colors.brandPrimary, borderRadius: 6, paddingHorizontal: 3, paddingVertical: 1,
    borderWidth: 1, borderColor: "#FFFFFF",
  },
  giftTileBadgeText: { color: colors.onBrandPrimary, fontSize: 8, fontWeight: "900" },

  actionBar: { flexDirection: "row", padding: spacing.md, gap: spacing.sm },
  actionRow: { justifyContent: "center", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, height: 34,
    borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.05)", borderWidth: 1, borderColor: "rgba(0,0,0,0.12)",
  },
  chipText: { color: "#141414", fontSize: 12, fontWeight: "700" },
  followRow: { flexDirection: "row", paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: radius.pill },
  actionText: { color: "#FFFFFF", fontWeight: "800" },

  // Iter-51 §8-10 — Change Seat picker (overlay inside the card modal).
  seatPickerBackdrop: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end",
  },
  seatPickerCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg, paddingTop: 10,
    borderTopWidth: 1, borderColor: colors.brandPrimary + "33",
  },
  sheetHandle: {
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.18)",
    marginBottom: spacing.md,
  },
  seatPickerTitle: {
    color: "#141414", fontSize: 15, fontWeight: "800",
    marginBottom: spacing.md,
  },
  seatGrid: {
    flexDirection: "row", flexWrap: "wrap",
    gap: 10, paddingBottom: spacing.md,
  },
  seatPickTile: {
    width: "30%",
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
    gap: 4,
    backgroundColor: "#F2F2F5",
    borderWidth: 1, borderColor: "rgba(0,0,0,0.08)",
  },
  seatPickLabel: { color: "#141414", fontSize: 12, fontWeight: "700" },
  seatPickHint: { color: "rgba(0,0,0,0.6)", fontSize: 10 },
});
