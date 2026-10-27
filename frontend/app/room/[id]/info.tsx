/**
 * Room Information / Management screen (iter-18).
 *
 * Reachable by tapping the room name inside a room. Loads the real room data
 * (background, name, owner, follow/member counts) and exposes three horizontal
 * management sections: Members, Moderators, Banned Users. Owner sees the
 * pending Membership Requests row at the top. Share + Settings live in the
 * header (right side).
 *
 * Everything is server-authoritative. Non-owners get a read-only view with
 * management actions hidden. Attempting a management API as a non-owner still
 * returns 403 from the backend so this UI cannot be bypassed to escalate role.
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { VipName } from "@/src/components/VipName";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, TextInput, Share,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import {
  apiGetRoom,
  apiRoomFollow,
  apiRoomUnfollow,
  apiRoomFollowStatus,
  apiRoomMembershipRequest,
  apiRoomMembershipPending,
  apiRoomMembershipReview,
  apiRoomMembers,
  apiRoomModerators,
  apiRoomModAdd,
  apiRoomModRemove,
  apiRoomBans,
  apiRoomBanRemove,
  apiRoomUpdateSettings,
  apiRoomPasswordSet,
  apiRoomPasswordClear,
  apiDeleteRoom,
  apiModerateRoomCover,
  apiUpdateRoomCover,
} from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { copyIdToClipboard } from "@/src/utils/copyId";
import { OrioHeart, OrioMembership } from "@/src/components/OrioIcons";
import { ChangePhotoChooser, type ChangePhotoChooserRef } from "@/src/components/ChangePhotoChooser";
import * as ImagePicker from "expo-image-picker";

export default function RoomInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { t, isRTL } = useI18n();
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [welcome, setWelcome] = useState("");
  const [pw, setPw] = useState("");
  const [roomName, setRoomName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const { data: room } = useQuery({ queryKey: ["room-info", id], queryFn: () => apiGetRoom(id!), enabled: !!id });
  const { data: status } = useQuery({
    queryKey: ["room-follow-status", id],
    queryFn: () => apiRoomFollowStatus(id!),
    enabled: !!id,
  });
  const { data: members = [] } = useQuery({ queryKey: ["room-members", id], queryFn: () => apiRoomMembers(id!), enabled: !!id });
  const { data: mods = [] } = useQuery({ queryKey: ["room-mods", id], queryFn: () => apiRoomModerators(id!), enabled: !!id });
  const { data: bans = [] } = useQuery({ queryKey: ["room-bans", id], queryFn: () => apiRoomBans(id!), enabled: !!id });
  const isOwner = !!(user && room && user.id === room.owner_id);
  const isMod = isOwner || !!(user && room?.moderators?.includes(user.id));
  const { data: pending = [] } = useQuery({
    queryKey: ["room-membership-pending", id],
    queryFn: () => apiRoomMembershipPending(id!),
    enabled: !!id && isMod,
  });

  const followMut = useMutation({
    mutationFn: () => (status?.is_following ? apiRoomUnfollow(id!) : apiRoomFollow(id!)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["room-follow-status", id] }),
  });
  const memberMut = useMutation({
    mutationFn: () => apiRoomMembershipRequest(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["room-follow-status", id] }),
    onError: (e: any) => Alert.alert("Membership", e?.message ?? "Failed"),
  });
  const reviewMut = useMutation({
    mutationFn: (payload: { request_id: string; action: "approve" | "reject" }) =>
      apiRoomMembershipReview(id!, payload.request_id, payload.action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["room-membership-pending", id] });
      qc.invalidateQueries({ queryKey: ["room-members", id] });
    },
  });
  const modAddMut = useMutation({
    mutationFn: (uid: string) => apiRoomModAdd(id!, uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["room-mods", id] }),
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Failed"),
  });
  const modRemoveMut = useMutation({
    mutationFn: (uid: string) => apiRoomModRemove(id!, uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["room-mods", id] }),
  });
  const unbanMut = useMutation({
    mutationFn: (uid: string) => apiRoomBanRemove(id!, uid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["room-bans", id] }),
  });
  const settingsMut = useMutation({
    mutationFn: (payload: { name?: string; notice?: string; welcome_msg?: string }) => apiRoomUpdateSettings(id!, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["room-info", id] }); qc.invalidateQueries({ queryKey: ["room", id] }); Alert.alert("Saved", "Room settings updated"); },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Failed"),
  });
  const passwordSetMut = useMutation({
    mutationFn: (pass: string) => apiRoomPasswordSet(id!, pass),
    onSuccess: () => { setPw(""); qc.invalidateQueries({ queryKey: ["room-info", id] }); Alert.alert("Saved", "Room Password enabled"); },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Password must be exactly 5 digits"),
  });
  const passwordClearMut = useMutation({
    mutationFn: () => apiRoomPasswordClear(id!),
    onSuccess: () => { setPw(""); qc.invalidateQueries({ queryKey: ["room-info", id] }); Alert.alert("Removed", "Room Password disabled"); },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Failed"),
  });

  // Hydrate notice/welcome once room data arrives
  useEffect(() => {
    if (room && !hydrated) {
      setNotice(room.notice || "");
      setWelcome(room.welcome_msg || "");
      setRoomName(room.name || "");
      setHydrated(true);
    }
  }, [room, hydrated]);

  const copyId = async () => {
    if (!room?.owner?.numeric_id) return;
    const ok = await copyIdToClipboard(room.owner.numeric_id);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1200); }
  };

  const onShare = async () => {
    if (!room) return;
    const link = Linking.createURL(`/room/${id}`);
    try {
      await Share.share({ message: `${room.name} — join me on Yazeen! ${link}` });
    } catch {}
  };

  const modIds = useMemo(() => new Set(mods.map((m: any) => m.user_id)), [mods]);

  if (!room) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="room-info-screen">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
      >
        {/* Cover / background */}
        <View style={styles.cover}>
          <Image source={room.background_url || room.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={["rgba(11,7,20,0)", "rgba(11,7,20,0.6)", "rgba(11,7,20,1)"]}
            style={StyleSheet.absoluteFill}
          />
          {/* Header buttons overlay */}
          <View style={styles.coverHeader}>
            <Pressable testID="room-info-back" onPress={() => router.back()} style={styles.roundBtn}>
              <Icon name="chevron-back" size={22} color={colors.onSurface} />
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID="room-info-share" onPress={onShare} style={styles.roundBtn}>
                <Icon name="share-social-outline" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Identity */}
        <View style={styles.identity}>
          <Text style={styles.roomName} testID="room-info-name">{room.name}</Text>
          {/* Follow heart + Membership */}
          <View style={styles.actionCluster}>
            <Pressable
              testID="room-info-follow"
              onPress={() => followMut.mutate()}
              style={styles.followPill}
            >
              <OrioHeart size={22} active={!!status?.is_following} />
              <Text style={styles.followCount} testID="room-info-follow-count">
                {Number(status?.follow_count ?? room.follow_count ?? 0).toLocaleString()}
              </Text>
            </Pressable>
            {status?.is_following && (
              <Pressable
                testID="room-info-membership"
                onPress={() => (status?.is_member ? undefined : (status?.has_pending_request ? Alert.alert("Membership", "Your request is pending review") : memberMut.mutate()))}
                style={styles.membershipPill}
              >
                <OrioMembership size={22} active={!!status?.is_member} />
                <Text style={[styles.membershipText, status?.is_member && { color: colors.gold }]}>
                  {status?.is_member ? "Member" : status?.has_pending_request ? "Pending" : "Join"}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Iter-52 §1 / Iter-74 — Smaller clickable owner card (avatar+name+ID)
              that opens the owner's real user profile. */}
          <Pressable
            testID="room-info-owner-card"
            onPress={() => room.owner?.id && router.push(`/user/${room.owner.id}` as any)}
            style={styles.ownerRow}
            hitSlop={6}
          >
            <View style={styles.ownerAvatarWrap} testID="owner-avatar-wrap">
              <Image source={room.owner?.avatar_url} style={styles.ownerAvatar} contentFit="cover" />
            </View>
            <View style={{ flex: 1 }}>
              <VipName style={styles.ownerName} name={room.owner?.nickname || "—"} vipLevel={room.owner_vip_level ?? room.owner?.vip_level ?? 0} />
              <Pressable onPress={copyId} testID="room-info-owner-id" style={styles.ownerIdRow}>
                <Icon name={copied ? "checkmark-circle" : "id-card-outline"} size={11} color={copied ? colors.success : colors.muted} />
                <Text style={[styles.ownerId, copied && { color: colors.success }]}>
                  {copied ? "Copied!" : `ID: ${room.owner?.numeric_id || "—"}`}
                </Text>
                {!copied && <Icon name="copy-outline" size={10} color={colors.muted} />}
              </Pressable>
            </View>
            <View style={styles.countPill}>
              <Icon name="people" size={12} color={colors.gold} />
              <Text style={styles.countText}>{status?.member_count ?? room.member_count ?? 0}</Text>
            </View>
          </Pressable>
        </View>

        {/* Iter-68 — Owner-only "Room Avatar" section at the TOP of Room
            Settings. Tappable room avatar with camera overlay, moderation
            gate, and real-time propagation. */}
        {isOwner && (
          <RoomAvatarSection
            roomId={id!}
            currentCover={room.cover_url || room.background_url}
            isRTL={isRTL}
          />
        )}

        {/* Owner-only Room Settings: Notice + Welcome + Password */}
        {isOwner && (
          <SectionCard title={t.roomSettings} testID="section-room-settings">
            {/* Iter-52 §3 — Delete Room (owner only). Confirmation required. */}
            <Pressable
              testID="delete-room-btn"
              onPress={() => {
                if (!id) return;
                Alert.alert(
                  isRTL ? "هل أنت متأكد من حذف الغرفة؟" : "Delete this room?",
                  undefined,
                  [
                    { text: isRTL ? "إلغاء" : "Cancel", style: "cancel" },
                    {
                      text: isRTL ? "تأكيد" : "Confirm",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await apiDeleteRoom(id);
                          qc.invalidateQueries({ queryKey: ["rooms"] });
                          router.replace("/(tabs)/home" as any);
                        } catch (e: any) {
                          Alert.alert("Error", e?.message ?? "Delete failed");
                        }
                      },
                    },
                  ],
                );
              }}
              style={styles.deleteRoomBtn}
            >
              <Icon name="trash" size={16} color="#FFF" />
              <Text style={styles.deleteRoomText}>{isRTL ? "حذف الغرفة" : "Delete Room"}</Text>
            </Pressable>

            {/* Iter-117 — Room Name (owner only) */}
            {isOwner && (
              <>
                <Text style={styles.settingLabel} testID="setting-name-label">{isRTL ? "اسم الغرفة" : "Room Name"}</Text>
                <TextInput
                  testID="input-room-name"
                  value={roomName}
                  onChangeText={setRoomName}
                  placeholderTextColor={colors.muted}
                  maxLength={40}
                  style={styles.settingInput}
                />
                <Pressable
                  testID="save-room-name"
                  onPress={() => roomName.trim() && settingsMut.mutate({ name: roomName.trim() })}
                  style={[styles.saveBtn, { marginBottom: spacing.md }]}
                >
                  <Text style={styles.saveBtnText}>{settingsMut.isPending ? t.saving : (isRTL ? "حفظ الاسم" : "Save Name")}</Text>
                </Pressable>
              </>
            )}

            {/* Room Notice */}
            <Text style={styles.settingLabel} testID="setting-notice-label">{t.roomNotice}</Text>
            <TextInput
              testID="input-room-notice"
              value={notice}
              onChangeText={setNotice}
              placeholder={t.roomNoticePlaceholder}
              placeholderTextColor={colors.muted}
              multiline
              maxLength={500}
              style={styles.settingInput}
            />
            <Pressable
              testID="save-room-notice"
              onPress={() => settingsMut.mutate({ notice })}
              style={styles.saveBtn}
            >
              <Text style={styles.saveBtnText}>{settingsMut.isPending ? t.saving : t.saveNotice}</Text>
            </Pressable>

            {/* Personalized Welcome Message */}
            <Text style={[styles.settingLabel, { marginTop: spacing.md }]} testID="setting-welcome-label">
              {t.welcomeMessage}
            </Text>
            <Text style={styles.settingHint}>{t.welcomeHint}</Text>
            <TextInput
              testID="input-room-welcome"
              value={welcome}
              onChangeText={setWelcome}
              placeholder={t.welcomePlaceholder}
              placeholderTextColor={colors.muted}
              multiline
              maxLength={200}
              style={styles.settingInput}
            />
            <Pressable
              testID="save-room-welcome"
              onPress={() => settingsMut.mutate({ welcome_msg: welcome })}
              style={styles.saveBtn}
            >
              <Text style={styles.saveBtnText}>{settingsMut.isPending ? t.saving : t.saveWelcome}</Text>
            </Pressable>

            {/* Room Password — 5 digits */}
            <Text style={[styles.settingLabel, { marginTop: spacing.md }]} testID="setting-password-label">
              {t.roomPassword}
            </Text>
            <Text style={styles.settingHint}>
              {room.has_room_password ? t.roomPasswordEnabled : t.roomPasswordDisabled}
            </Text>
            <TextInput
              testID="input-room-password"
              value={pw}
              onChangeText={(t2) => setPw(t2.replace(/\D/g, "").slice(0, 5))}
              placeholder="•••••"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={5}
              secureTextEntry
              style={[styles.settingInput, { fontSize: 22, letterSpacing: 6, textAlign: "center" }]}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                testID="save-room-password"
                disabled={pw.length !== 5 || passwordSetMut.isPending}
                onPress={() => passwordSetMut.mutate(pw)}
                style={[styles.saveBtn, { flex: 1 }, pw.length !== 5 && { opacity: 0.4 }]}
              >
                <Text style={styles.saveBtnText}>{room.has_room_password ? t.updatePassword : t.enablePassword}</Text>
              </Pressable>
              {room.has_room_password && (
                <Pressable
                  testID="clear-room-password"
                  disabled={passwordClearMut.isPending}
                  onPress={() => passwordClearMut.mutate()}
                  style={[styles.saveBtn, { flex: 1, backgroundColor: colors.error + "aa" }]}
                >
                  <Text style={styles.saveBtnText}>{t.disablePassword}</Text>
                </Pressable>
              )}
            </View>
          </SectionCard>
        )}

        {/* Pending membership (owner only) */}
        {isOwner && pending.length > 0 && (
          <SectionCard title={`Pending requests · ${pending.length}`} testID="section-pending">
            {pending.map((p: any) => (
              <View key={p.id} style={styles.userRow}>
                <Image source={p.user?.avatar_url} style={styles.userRowAvatar} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <VipName style={styles.userRowName} numberOfLines={1} name={p.user?.nickname} color={(p.user as any)?.name_color} vipLevel={(p.user as any)?.vip_level} />
                  <Text style={styles.userRowId}>ID: {p.user?.numeric_id || "—"}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable testID={`pending-approve-${p.id}`} onPress={() => reviewMut.mutate({ request_id: p.id, action: "approve" })} style={[styles.actionBtnSm, { backgroundColor: colors.success + "33", borderColor: colors.success }]}>
                    <Text style={{ color: colors.success, fontWeight: "800", fontSize: 12 }}>Approve</Text>
                  </Pressable>
                  <Pressable testID={`pending-reject-${p.id}`} onPress={() => reviewMut.mutate({ request_id: p.id, action: "reject" })} style={[styles.actionBtnSm, { backgroundColor: colors.error + "33", borderColor: colors.error }]}>
                    <Text style={{ color: colors.error, fontWeight: "800", fontSize: 12 }}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </SectionCard>
        )}

        {/* Members */}
        <SectionCard title={`Members · ${members.length}`} testID="section-members" horizontal>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No members yet</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 4 }}>
              {members.map((m: any) => (
                <Pressable
                  key={m.user_id}
                  testID={`member-${m.user_id}`}
                  onPress={() => router.push(`/user/${m.user_id}` as any)}
                  style={styles.userTile}
                >
                  <Image source={m.user?.avatar_url} style={styles.userTileAvatar} contentFit="cover" />
                  <VipName style={styles.userTileName} numberOfLines={1} name={m.user?.nickname} color={(m.user as any)?.name_color} vipLevel={(m.user as any)?.vip_level} />
                  {isOwner && (
                    modIds.has(m.user_id) ? (
                      <Pressable testID={`mod-remove-${m.user_id}`} onPress={(e) => { e.stopPropagation?.(); modRemoveMut.mutate(m.user_id); }} style={styles.smallGoldBtn}>
                        <Text style={styles.smallGoldBtnText}>Remove mod</Text>
                      </Pressable>
                    ) : (
                      <Pressable testID={`mod-add-${m.user_id}`} onPress={(e) => { e.stopPropagation?.(); modAddMut.mutate(m.user_id); }} style={styles.smallGoldBtn}>
                        <Text style={styles.smallGoldBtnText}>Make mod</Text>
                      </Pressable>
                    )
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </SectionCard>

        {/* Moderators */}
        <SectionCard title={`Moderators · ${mods.length}`} testID="section-mods" horizontal>
          {mods.length === 0 ? (
            <Text style={styles.emptyText}>No moderators yet</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 4 }}>
              {mods.map((m: any) => (
                <Pressable
                  key={m.user_id}
                  testID={`moderator-${m.user_id}`}
                  onPress={() => router.push(`/user/${m.user_id}` as any)}
                  style={styles.userTile}
                >
                  <Image source={m.avatar_url} style={styles.userTileAvatar} contentFit="cover" />
                  <VipName style={styles.userTileName} numberOfLines={1} name={m?.nickname} color={(m as any)?.name_color} vipLevel={(m as any)?.vip_level} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </SectionCard>

        {/* Banned users */}
        <SectionCard title={`Banned users · ${bans.length}`} testID="section-bans" horizontal>
          {bans.length === 0 ? (
            <Text style={styles.emptyText}>No banned users</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 4 }}>
              {bans.map((b: any) => (
                <View key={b.user_id} style={styles.userTile}>
                  <Image source={b.user?.avatar_url} style={styles.userTileAvatar} contentFit="cover" />
                  <VipName style={styles.userTileName} numberOfLines={1} name={b.user?.nickname} color={(b.user as any)?.name_color} vipLevel={(b.user as any)?.vip_level} />
                  {isMod && (
                    <Pressable testID={`ban-remove-${b.user_id}`} onPress={() => unbanMut.mutate(b.user_id)} style={styles.smallGoldBtn}>
                      <Text style={styles.smallGoldBtnText}>Unban</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </SectionCard>
      </ScrollView>
    </View>
  );
}

function SectionCard({ title, testID, children, horizontal }: any) {
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={horizontal ? { minHeight: 120 } : undefined}>{children}</View>
    </View>
  );
}

/* ---------------- Iter-68 — Room Avatar section ---------------- */
function RoomAvatarSection({
  roomId, currentCover, isRTL,
}: {
  roomId: string;
  currentCover?: string | null;
  isRTL: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chooserRef = useRef<ChangePhotoChooserRef>(null);

  const display = pending || currentCover || null;
  const dirty = !!pending;

  const onPicked = (dataUri: string, _kind: "photo" | "gif") => {
    setErr(null);
    if (dataUri === "__NOT_GIF__") {
      setErr(isRTL ? "يرجى اختيار ملف GIF فقط" : "Please pick a GIF file only");
      return;
    }
    if (dataUri === "__NOT_PHOTO__") {
      setErr(isRTL ? "يرجى اختيار صورة فقط (ليس GIF أو فيديو)" : "Please pick an image (no GIFs or videos)");
      return;
    }
    if (dataUri.startsWith("__GIF_TOO_LARGE__")) {
      const mb = dataUri.replace("__GIF_TOO_LARGE__", "");
      setErr(isRTL ? `حجم GIF كبير جدًا (${mb} ميجا، الحد الأقصى 5 ميجا)` : `GIF too large (${mb} MB, max 5 MB)`);
      return;
    }
    // Iter-70 — DEFER save. Only preview locally until Save tapped.
    setPending(dataUri);
  };

  const save = async () => {
    if (!pending) return;
    setErr(null); setBusy(true);
    try {
      // Iter-70 — real server-side validation + moderation, THEN persist.
      await apiModerateRoomCover(pending);
      await apiUpdateRoomCover(roomId, pending);
      qc.invalidateQueries({ queryKey: ["room", roomId] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["rooms-mine"] });
      qc.invalidateQueries({ queryKey: ["rooms-mine-gate"] });
      setPending(null);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("USER_MEDIA_BLOCKED")) {
        chooserRef.current?.openBlockedModal();
        setPending(null);
      } else if (msg.includes("GIF_VIP5_REQUIRED")) {
        setErr(isRTL ? "GIF يتطلب VIP 5" : "GIF requires VIP 5+");
      } else {
        setErr(e?.message || (isRTL ? "تم رفض الصورة" : "Image was rejected"));
      }
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => { setPending(null); setErr(null); };

  return (
    <View style={styles.section} testID="section-room-avatar">
      <Text style={styles.sectionTitle}>{isRTL ? "صورة الغرفة" : "Room Avatar"}</Text>
      <Pressable
        testID="room-avatar-edit"
        onPress={() => chooserRef.current?.open()}
        disabled={busy}
        style={({ pressed }) => [_avatarStyles.wrap, pressed && { opacity: 0.9 }]}
      >
        {display ? (
          <Image source={display} style={_avatarStyles.img} contentFit="cover" />
        ) : (
          <View style={_avatarStyles.placeholder}>
            <Icon name="camera" size={34} color={colors.brandPrimary} />
          </View>
        )}
        <View style={_avatarStyles.pen}>
          {busy
            ? <ActivityIndicator color="#FFFFFF" />
            : <Icon name="camera" size={16} color="#FFFFFF" />}
        </View>
      </Pressable>
      <Text style={_avatarStyles.hint}>
        {isRTL
          ? "اضغط لاختيار الصورة، ثم احفظ لتطبيق التغيير."
          : "Tap to pick, then Save to apply."}
      </Text>
      {err ? <Text style={_avatarStyles.err}>{err}</Text> : null}

      {dirty && (
        <View style={_avatarStyles.actions}>
          <Pressable testID="room-avatar-cancel" onPress={cancel} disabled={busy} style={[_avatarStyles.btn, _avatarStyles.btnGhost]}>
            <Text style={_avatarStyles.btnGhostText}>{isRTL ? "إلغاء" : "Cancel"}</Text>
          </Pressable>
          <Pressable testID="room-avatar-save" onPress={save} disabled={busy} style={[_avatarStyles.btn, _avatarStyles.btnPrimary, busy && { opacity: 0.6 }]}>
            {busy
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={_avatarStyles.btnPrimaryText}>{isRTL ? "حفظ" : "Save"}</Text>}
          </Pressable>
        </View>
      )}
      <ChangePhotoChooser ref={chooserRef} isRTL={isRTL} onPicked={onPicked} gifMinVip={5} />
    </View>
  );
}

const _avatarStyles = StyleSheet.create({
  wrap: {
    width: 140, height: 140, borderRadius: 70,
    alignSelf: "center",
    marginTop: spacing.md,
    backgroundColor: "rgba(139,92,246,0.08)",
    borderWidth: 2, borderColor: "rgba(139,92,246,0.55)",
    alignItems: "center", justifyContent: "center",
    overflow: "visible",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  img: { width: 136, height: 136, borderRadius: 68 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  pen: {
    position: "absolute",
    right: 2, bottom: 2,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#8B5CF6",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#0B0714",
  },
  hint: { color: colors.muted, fontSize: 11, marginTop: spacing.sm, textAlign: "center" },
  err: { color: colors.error, fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 8 },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: spacing.md,
    justifyContent: "center",
  },
  btn: {
    flex: 1,
    maxWidth: 140,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  btnGhostText: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  btnPrimary: {
    backgroundColor: "#8B5CF6",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  btnPrimaryText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
});


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B0714" },
  cover: { width: "100%", aspectRatio: 1.6, position: "relative" },
  coverHeader: {
    position: "absolute",
    top: spacing.md, left: spacing.md, right: spacing.md,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  roundBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },

  identity: { paddingHorizontal: spacing.lg, marginTop: -spacing.xl },
  roomName: { color: colors.onSurface, fontSize: 24, fontWeight: "900" },
  actionCluster: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md },
  followPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(30,10,60,0.7)",
    borderWidth: 1, borderColor: "#7EC8FF44",
  },
  followCount: { color: colors.onSurface, fontWeight: "800", fontSize: 13 },
  membershipPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "rgba(60,30,10,0.5)",
    borderWidth: 1, borderColor: colors.gold + "55",
  },
  membershipText: { color: colors.onSurface, fontSize: 12, fontWeight: "800" },

  ownerRow: {
    flexDirection: "row", alignItems: "center",
    paddingTop: 14, paddingBottom: 10,
    gap: 12,
  },
  // Iter-52 §1 / Iter-74 / Iter-75 — Smaller circular owner avatar (44 dp)
  // that sits slightly below the room name (no negative overlap). Clickable
  // via the parent Pressable → opens the real owner's user profile.
  ownerAvatarWrap: {
    width: 44, height: 44, borderRadius: 22,
    marginTop: 6,
    borderWidth: 2, borderColor: colors.surface,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
  },
  ownerAvatar: { width: "100%", height: "100%" },
  // Iter-52 §3 — Delete Room (owner only) prominent destructive button at the
  // top of the settings card.
  deleteRoomBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.error,
    marginBottom: spacing.md,
  },
  deleteRoomText: { color: "#FFF", fontWeight: "900", fontSize: 14, letterSpacing: 0.3 },
  ownerName: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  ownerIdRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  ownerId: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  countPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.gold + "44",
  },
  countText: { color: colors.gold, fontWeight: "900", fontSize: 12 },

  section: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: "#150B24",
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionTitle: { color: colors.gold, fontSize: 12, fontWeight: "900", letterSpacing: 0.6, marginBottom: spacing.md },
  emptyText: { color: colors.muted, textAlign: "center", fontSize: 12, marginVertical: spacing.md },

  userRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  userRowAvatar: { width: 40, height: 40, borderRadius: 20 },
  userRowName: { color: colors.onSurface, fontWeight: "700" },
  userRowId: { color: colors.muted, fontSize: 11, marginTop: 2 },
  actionBtnSm: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1,
  },

  userTile: { width: 84, alignItems: "center", gap: 4 },
  userTileAvatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceTertiary },
  userTileName: { color: colors.onSurface, fontSize: 11, fontWeight: "700", textAlign: "center", maxWidth: 80 },
  smallGoldBtn: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
    backgroundColor: colors.gold + "22", borderWidth: 1, borderColor: colors.gold + "88",
    marginTop: 2,
  },
  smallGoldBtnText: { color: colors.gold, fontSize: 9, fontWeight: "800" },
  settingLabel: { color: colors.onSurface, fontSize: 12, fontWeight: "800", marginBottom: 4 },
  settingHint: { color: colors.muted, fontSize: 11, marginBottom: 6 },
  settingInput: {
    backgroundColor: "#0B0714",
    color: colors.onSurface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 44,
    marginBottom: 8,
  },
  saveBtn: {
    backgroundColor: colors.gold,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    alignSelf: "stretch",
  },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 12, letterSpacing: 0.5 },
});
