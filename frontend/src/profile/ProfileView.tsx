/**
 * ProfileView — the ORIO premium profile screen.
 * Rendered by both /(tabs)/profile (own profile) and /user/[id] (other user).
 * Passing an explicit `userId` shows that user; omitting it shows the current user (owner mode).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Platform, Modal, Alert, TextInput, Animated,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import * as Clipboard from "expo-clipboard";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

import { colors, spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import {
  apiGetUser, apiMyRooms,
  apiFriendship, apiCp, apiFamiliesMine,
  apiFollow, apiUnfollow, apiBlockUser, apiUnblockUser, apiReportUser, apiUserPosts,
  apiRecordView,
  getAccessToken,
} from "@/src/api";
import { MarqueeText } from "@/src/components/MarqueeText";
import { VipName } from "@/src/components/VipName";
import { VipBadge } from "@/src/components/VipBadge";
import { useImageViewer } from "@/src/components/ImageViewer";
import { LevelBadgeChip, AgeBadge, FlagCircle, BADGE_H, BADGE_FONT } from "@/src/levels/badges";
import { mediaUrl } from "@/src/media/upload";
import { LevelBoxes } from "@/src/levels/LevelBoxes";
import { RoomCard } from "@/src/components/RoomCard";
import { NewUserBadge } from "@/src/components/NewUserBadge";
import { OrioRefreshControl } from "@/src/components/OrioRefreshControl";

type Tab = "profile" | "honor" | "relationships";

export function ProfileView({ userId }: { userId?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [headerOn, setHeaderOn] = useState(false);
  const { user: me } = useAuth();
  const { t, isRTL } = useI18n();
  const imageViewer = useImageViewer();

  const targetId = userId ?? me?.id;
  const isOwner = !userId || (me?.id === userId);
  const qc = useQueryClient();
  const toast = useToast();

  const { data: user, isLoading, refetch, isRefetching, error: profileErr } = useQuery({
    queryKey: ["profile", targetId],
    queryFn: () => (targetId ? apiGetUser(targetId) : Promise.resolve(null)),
    enabled: !!targetId,
    retry: (n, e: any) => !/not found|deleted/i.test(String(e?.message || "")) && n < 2,
    initialData: isOwner ? me : undefined,
  });

  const onRefresh = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["user-posts"] });
    qc.invalidateQueries({ queryKey: ["profile-friends", targetId] });
    qc.invalidateQueries({ queryKey: ["profile-cp", targetId] });
    qc.invalidateQueries({ queryKey: ["profile-rooms", targetId] });
  };

  // ----- Profile Visitor Tracking (iter-53) -----
  // Fire-and-forget: record a profile view whenever someone opens another
  // user's profile. The backend enforces a 5-minute per-pair dedup window
  // and silently ignores self-views, so this is safe to call on every mount.
  useEffect(() => {
    if (!targetId || isOwner) return;
    apiRecordView(targetId).catch(() => {});
  }, [targetId, isOwner]);

  const [tab, setTab] = useState<Tab>("profile");

  const [copied, setCopied] = useState(false);
  const copyId = useCallback(async () => {
    if (!user?.numeric_id) return;
    try {
      await Clipboard.setStringAsync(String(user.numeric_id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [user?.numeric_id]);

  const share = useCallback(async () => {
    // Placeholder: the top share icon was replaced (iter-33) by a three-dot
    // menu with real Follow/Unfollow + Block + Report actions.
  }, []);
  // Suppress unused warning while we keep the placeholder above.
  void share;

  // Iter-30: sticky Follow → Chat CTA at the bottom of another user's profile.
  const isFollowing = !!user?.is_following;
  const followMut = useMutation({
    mutationFn: () => apiFollow(targetId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile", targetId] });
      qc.setQueryData(["profile", targetId], (old: any) => (old ? { ...old, is_following: true } : old));
    },
  });
  const unfollowMut = useMutation({
    mutationFn: () => apiUnfollow(targetId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile", targetId] });
      qc.setQueryData(["profile", targetId], (old: any) => (old ? { ...old, is_following: false } : old));
    },
  });
  const blockMut = useMutation({
    mutationFn: () => apiBlockUser(targetId!),
    onSuccess: () => {
      // Blocking also breaks any follow relationship server-side; reflect that locally.
      // Stay on the page — it switches to the blocked view (server hides all details).
      qc.invalidateQueries({ queryKey: ["profile", targetId] });
      qc.invalidateQueries({ queryKey: ["user", targetId] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (e: any) => Alert.alert("Error", e?.message || "Failed to block user"),
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("spam");
  const [reportDetails, setReportDetails] = useState<string>("");
  const reportMut = useMutation({
    mutationFn: () => apiReportUser(targetId!, { reason: reportReason, details: reportDetails }),
    onSuccess: () => {
      setReportOpen(false);
      setReportDetails("");
      setReportReason("spam");
      Alert.alert(t.reportSubmittedTitle, t.reportSubmittedBody);
    },
    onError: (e: any) => Alert.alert("Error", e?.message || "Failed to submit report"),
  });
  const openChat = () => targetId && router.push(`/chat/${targetId}` as any);

  const confirmBlock = useCallback(() => {
    setMenuOpen(false);
    Alert.alert(
      isRTL ? "تنبيه" : "Notice",
      isRTL ? "هل أنت متأكد أنك تريد حظر هذا المستخدم؟" : "Are you sure you want to block this user?",
      [
        { text: isRTL ? "لا" : "No", style: "cancel" },
        { text: isRTL ? "نعم" : "Yes", style: "destructive", onPress: () => blockMut.mutate() },
      ],
    );
  }, [blockMut, isRTL]);
  const unblockMut = useMutation({
    mutationFn: () => apiUnblockUser(targetId!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["profile", targetId] }); qc.invalidateQueries({ queryKey: ["user", targetId] }); },
  });

  const accountAgeDays = useMemo(() => {
    if (!user?.created_at) return 1;
    const created = new Date(user.created_at).getTime();
    const diffMs = Date.now() - created;
    // Registration day counts as Day 1
    return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
  }, [user?.created_at]);

  const customCover = user && Number(user.vip_level ?? 0) >= 5 ? mediaUrl(user.cover_url || user.background_url) : undefined;

  // Deleted / missing account → premium toast, stay on the previous screen.
  useEffect(() => {
    if (!profileErr || !/not found|deleted/i.test(String((profileErr as any)?.message || ""))) return;
    toast.info(isRTL ? "تم حذف حساب هذا المستخدم" : "This user's account has been deleted");
    if (router.canGoBack()) router.back();
  }, [profileErr]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !user) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  if ((user as any).is_blocked_view) {
    const iBlocked = !!(user as any).i_blocked;
    return (
      <View style={[styles.container, { paddingTop: insets.top }]} testID="profile-blocked-view">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))} hitSlop={10} style={styles.blockedBack} testID="profile-blocked-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={26} color={colors.onSurface} />
        </Pressable>
        <View style={styles.blockedBody}>
          <Text style={styles.blockedText} testID={iBlocked ? "profile-blocked-by-me" : "profile-blocked-me"}>
            {iBlocked
              ? (isRTL ? "لعرض معلومات هذا المستخدم، قم بإلغاء حظره." : "To view this user's information, unblock them.")
              : (isRTL ? "قام هذا المستخدم بحظرك. لا يمكنك عرض محتواه." : "This user has blocked you. You cannot view their content.")}
          </Text>
          <Icon name="ban" size={44} color={colors.error} testID="profile-blocked-icon" />
          {iBlocked && (
            <Pressable onPress={() => unblockMut.mutate()} disabled={unblockMut.isPending} style={styles.unblockBtn} testID="profile-unblock">
              <Text style={styles.unblockText}>{isRTL ? "إلغاء الحظر" : "Unblock"}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="profile-view-screen">
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + (isOwner ? spacing.xxxl : 96) }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
          listener: (e: any) => { const on = e.nativeEvent.contentOffset.y > 150; if (on !== headerOn) setHeaderOn(on); },
        })}
        refreshControl={<OrioRefreshControl refreshing={!!isRefetching} onRefresh={onRefresh} />}
      >
        {/* ---------- Cover / Header ---------- */}
        <View style={styles.coverWrap}>
          {/* Inner clip layer for blurred/cover art. Sits BEHIND the avatar which
              is allowed to overflow outside (coverWrap has overflow:visible). */}
          <View style={styles.coverInner}>
            <Pressable
              onPress={() => {/* future: full-screen viewer */}}
              style={StyleSheet.absoluteFill}
              testID="cover-tap"
            >
              {/* VIP5+ custom cover → shown sharp (no blur). Everyone else keeps
                  the default blurred-avatar cover. */}
              <Image
                testID={customCover ? "profile-custom-cover" : "profile-default-cover"}
                source={customCover || user.avatar_url}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={customCover ? 0 : 20}
              />
              <LinearGradient
                colors={customCover ? ["rgba(0,0,0,0.25)", "rgba(0,0,0,0)", "rgba(0,0,0,0)", colors.surface] : ["rgba(15,10,30,0.15)", "rgba(15,10,30,0.5)", colors.surface]}
                locations={customCover ? [0, 0.3, 0.75, 1] : undefined}
                style={StyleSheet.absoluteFill}
              />
            </Pressable>
          </View>
          {/* top action row */}
          <View style={[styles.topActionsRow, { paddingTop: insets.top + spacing.sm }]}>
            {isOwner ? (
              <Pressable
                testID="profile-edit-btn"
                onPress={() => router.push("/edit-profile")}
                style={styles.circleBtn}
                accessibilityLabel="Edit profile"
              >
                <Icon name="pencil" size={16} color={colors.onSurface} />
              </Pressable>
            ) : (
              <Pressable
                testID="profile-more-btn"
                onPress={() => setMenuOpen(true)}
                style={styles.circleBtn}
                accessibilityLabel="More options"
              >
                <Icon name="ellipsis-horizontal" size={18} color={colors.onSurface} />
              </Pressable>
            )}
            <View style={{ flex: 1 }} />
            <Pressable
              testID="profile-back-btn"
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(tabs)/home");
              }}
              style={styles.circleBtn}
              accessibilityLabel="Back"
            >
              <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={20} color={colors.onSurface} />
            </Pressable>
          </View>

          {/* Centered avatar — Iter-99: tap to view the photo. */}
          <Pressable testID="profile-avatar-view" onPress={() => imageViewer.show(user.avatar_url)} style={styles.avatarRing}>
            <Image source={user.avatar_url} style={styles.avatar} contentFit="cover" transition={200} />
          </Pressable>
        </View>

        {/* ---------- Identity ---------- */}
        <View style={styles.identity}>
          <View style={styles.nameRow}>
            {(user as any).name_color === "rainbow" ? (
              /* Iter-57 — VIP 6-7 animated rainbow username. Server-authoritative;
                 no marquee here as the gradient needs a stable layout box. */
              <VipName
                name={user.nickname || "User"}
                color="rainbow"
                style={styles.name}
                numberOfLines={1}
              />
            ) : (
              <MarqueeText
                text={user.nickname || t.userFallback}
                maxWidth={260}
                style={[styles.name, (user as any).name_color === "red" && { color: "#FF3B30" }]}
              />
            )}
          </View>

          {/* Numeric ID + copy */}
          <Pressable
            testID="copy-id-btn"
            onPress={copyId}
            style={({ pressed }) => [styles.idRow, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Copy ID"
          >
            <Icon name={copied ? "checkmark" : "copy-outline"} size={13} color={colors.muted} />
            <Text style={styles.idText}>
              ID: {user.numeric_id ?? "—"}
              {copied ? "  ✓" : ""}
            </Text>
          </Pressable>

          {/* Info chip row (scrollable).
              Iter-93 — Drop the scaleX:-1 trick for RTL; it visually mirrored
              Arabic glyphs. Use proper RTL ordering via row-reverse content so
              Arabic reads naturally while chips still start from the right. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.infoRow]}
          >
            {/* Below username + ID: Flag · Age · Days · New User, then level badges. */}
            <FlagCircle testID="chip-flag" flag={user.country_flag} size={BADGE_H} />
            <AgeBadge testID="chip-age" age={user.age} gender={user.gender} />
            <InfoChip color={colors.gold}>
              {`${accountAgeDays} ${t.days || "days"}`}
            </InfoChip>
            <NewUserBadge isNew={user.is_new} size="md" style={styles.newBadge} />
            {user.family_name && (
              <InfoChip icon="home-outline" color="#FF9500">
                {user.family_name}
              </InfoChip>
            )}
            {/* Iter-117 — real earned Wealth/Charm badges (tap → Levels at that system). */}
            {Number(user.charm_level ?? 0) >= 1 && (
              <LevelBadgeChip testID="chip-charm" sys="charm" level={Number(user.charm_level)} />
            )}
            <LevelBadgeChip testID="chip-wealth" sys="wealth" level={Math.max(1, Number(user.wealth_level ?? 0))} />
            {/* Iter-96 — VIP represented by the real VipBadge icon only.
                No text-based "V + number" rendering anywhere. */}
            {(user.vip_level ?? 0) > 0 && (
              <Pressable
                testID="chip-vip"
                onPress={() => router.push("/vip" as any)}
                accessibilityLabel={`VIP ${user.vip_level}`}
              >
                <VipBadge level={user.vip_level} size="md" />
              </Pressable>
            )}
            {/* Iter-88: Nobility removed from the app per owner request. */}
          </ScrollView>

          {/* Bio */}
          <View style={styles.bioBox}>
            {user.bio ? (
              <Text style={[styles.bio, isRTL && { textAlign: "right" }]}>{user.bio}</Text>
            ) : (
              <Text style={styles.bioEmpty}>
                {isOwner ? (t.bioEmptyOwner || "Add a short bio about yourself") : (t.bioEmpty || "No bio yet")}
              </Text>
            )}
          </View>

          {/* Voice bio placeholder (Coming Soon) */}
          <View style={styles.voiceBio} accessibilityLabel="Voice bio coming soon">
            <View style={styles.voiceBioIcon}>
              <Icon name="mic-outline" size={18} color={colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.voiceBioTitle, isRTL && { textAlign: "right" }]}>
                {t.voiceBio || "Voice Bio"}
              </Text>
              <Text style={[styles.voiceBioSub, isRTL && { textAlign: "right" }]}>
                {t.comingSoonLabel || "Coming Soon"}
              </Text>
            </View>
            <View style={styles.soonPill}>
              <Text style={styles.soonPillText}>{t.soon || "Soon"}</Text>
            </View>
          </View>

          {/* Stats row — Iter-99: lists are owner-only; others see counts but cannot open them. */}
          <View style={[styles.statsRow]}>
            <StatCell
              testID="stat-friends"
              label={t.friends || "Friends"}
              value={user.friends ?? 0}
              onPress={isOwner ? () => router.push("/connections?type=friends" as any) : undefined}
            />
            <View style={styles.statSep} />
            <StatCell
              testID="stat-following"
              label={t.following || "Following"}
              value={user.following ?? 0}
              onPress={isOwner ? () => router.push("/connections?type=following" as any) : undefined}
            />
            <View style={styles.statSep} />
            <StatCell
              testID="stat-followers"
              label={t.followers || "Followers"}
              value={user.followers ?? 0}
              onPress={isOwner ? () => router.push("/connections?type=followers" as any) : undefined}
            />
          </View>
        </View>

        {/* ---------- Tabs ---------- */}
        <View style={[styles.tabsRow]}>
          <TabBtn
            testID="tab-profile"
            label={t.profileTab || "Profile"}
            active={tab === "profile"}
            onPress={() => setTab("profile")}
          />
          <TabBtn
            testID="tab-honor"
            label={t.honorTab || "Honor"}
            active={tab === "honor"}
            onPress={() => setTab("honor")}
          />
          <TabBtn
            testID="tab-relationships"
            label={t.relationshipsTab || "Relationships"}
            active={tab === "relationships"}
            onPress={() => setTab("relationships")}
          />
        </View>

        {tab === "profile" && <ProfileTab user={user} isOwner={isOwner} isRTL={isRTL} t={t} />}
        {tab === "honor" && <HonorTab user={user} isRTL={isRTL} t={t} />}
        {tab === "relationships" && <RelationshipsTab user={user} isOwner={isOwner} isRTL={isRTL} t={t} />}
      </Animated.ScrollView>
      {/* Batch B — scroll header: background + centered username fade in on scroll. */}
      <Animated.View
        pointerEvents={headerOn ? "box-none" : "none"}
        style={[styles.scrollHeader, { height: insets.top + 52, paddingTop: insets.top, opacity: scrollY.interpolate({ inputRange: [110, 170], outputRange: [0, 1], extrapolate: "clamp" }) }]}
        testID="profile-scroll-header"
      >
        {isOwner ? (
          <Pressable onPress={() => router.push("/edit-profile")} style={styles.scrollHeaderBtn} hitSlop={8}>
            <Icon name="pencil" size={16} color={colors.onSurface} />
          </Pressable>
        ) : (
          <Pressable onPress={() => setMenuOpen(true)} style={styles.scrollHeaderBtn} hitSlop={8} testID="profile-scroll-more">
            <Icon name="ellipsis-horizontal" size={18} color={colors.onSurface} />
          </Pressable>
        )}
        <View style={styles.scrollHeaderTitle}>
          <VipName name={user.nickname || t.userFallback} color={(user as any).name_color} vipLevel={(user as any).vip_level} style={styles.scrollHeaderName} numberOfLines={1} />
        </View>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))} style={styles.scrollHeaderBtn} hitSlop={8} testID="profile-scroll-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={20} color={colors.onSurface} />
        </Pressable>
      </Animated.View>
      {/* Iter-33: sticky Chat + Follow CTAs at the bottom of another user's profile.
          Before follow → both buttons render side-by-side (Chat on the left, Follow on the right).
          After follow → Follow disappears and Chat expands to full width. */}
      {!isOwner && (
        <View style={[styles.stickyCta, styles.stickyCtaRow, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable
            testID="profile-chat-btn"
            onPress={openChat}
            style={[styles.stickyBtn, { flex: 1, backgroundColor: colors.brandPrimary }]}
          >
            <Icon name="chatbubble-ellipses" size={18} color={colors.onBrandPrimary} />
            <Text style={[styles.stickyBtnText, { color: colors.onBrandPrimary }]}>{t.chatCta}</Text>
          </Pressable>
          {!isFollowing && (
            <Pressable
              testID="profile-follow-btn"
              disabled={followMut.isPending}
              onPress={() => followMut.mutate()}
              style={[styles.stickyBtn, { flex: 1, backgroundColor: colors.gold }]}
            >
              <Icon name="person-add" size={18} color={colors.onBrandPrimary} />
              <Text style={[styles.stickyBtnText, { color: colors.onBrandPrimary }]}>
                {followMut.isPending ? t.followingDots : t.followAction}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Iter-33: three-dot menu for another user's profile. Uses real
          follow/unfollow/block/report mutations. No fake / visual-only actions. */}
      {!isOwner && (
        <Modal
          visible={menuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
            <Pressable style={styles.menuSheet} onPress={() => { /* stop propagation */ }}>
              {isFollowing ? (
                <Pressable
                  testID="menu-unfollow"
                  disabled={unfollowMut.isPending}
                  onPress={() => { setMenuOpen(false); unfollowMut.mutate(); }}
                  style={styles.menuItem}
                >
                  <Icon name="person-remove-outline" size={18} color={colors.onSurface} />
                  <Text style={styles.menuItemText}>{unfollowMut.isPending ? t.unfollowingDots : t.unfollowAction}</Text>
                </Pressable>
              ) : (
                <Pressable
                  testID="menu-follow"
                  disabled={followMut.isPending}
                  onPress={() => { setMenuOpen(false); followMut.mutate(); }}
                  style={styles.menuItem}
                >
                  <Icon name="person-add-outline" size={18} color={colors.onSurface} />
                  <Text style={styles.menuItemText}>{followMut.isPending ? t.followingDots : t.followAction}</Text>
                </Pressable>
              )}
              <View style={styles.menuSep} />
              <Pressable
                testID="menu-block"
                onPress={confirmBlock}
                style={styles.menuItem}
              >
                <Icon name="ban-outline" size={18} color={colors.error} />
                <Text style={[styles.menuItemText, { color: colors.error }]}>{t.blockAction}</Text>
              </Pressable>
              <View style={styles.menuSep} />
              <Pressable
                testID="menu-report"
                onPress={() => { setMenuOpen(false); router.push(`/report?user_id=${targetId}` as any); }}
                style={styles.menuItem}
              >
                <Icon name="flag-outline" size={18} color={colors.error} />
                <Text style={[styles.menuItemText, { color: colors.error }]}>{t.reportAction}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Report dialog — real submission via /users/{id}/report */}
      {!isOwner && (
        <Modal
          visible={reportOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setReportOpen(false)}
        >
          <Pressable style={styles.menuBackdrop} onPress={() => setReportOpen(false)}>
            <Pressable style={styles.reportSheet} onPress={() => { /* stop propagation */ }}>
              <Text style={styles.reportTitle}>{t.reportUserTitle}</Text>
              <Text style={styles.reportHint}>{t.reportUserHint}</Text>
              <View style={styles.reasonRow}>
                {([
                  { id: "spam", label: t.reportSpam },
                  { id: "harassment", label: t.reportHarassment },
                  { id: "inappropriate", label: t.reportInappropriate },
                  { id: "scam", label: t.reportScam },
                  { id: "other", label: t.reportOther },
                ] as const).map((r) => (
                  <Pressable
                    key={r.id}
                    testID={`report-reason-${r.id}`}
                    onPress={() => setReportReason(r.id)}
                    style={[styles.reasonPill, reportReason === r.id && styles.reasonPillActive]}
                  >
                    <Text style={[styles.reasonText, reportReason === r.id && styles.reasonTextActive]}>
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                testID="report-details"
                value={reportDetails}
                onChangeText={setReportDetails}
                placeholder={t.reportDetailsPh}
                placeholderTextColor={colors.muted}
                multiline
                maxLength={1000}
                style={styles.reportInput}
              />
              <View style={styles.reportBtnRow}>
                <Pressable
                  testID="report-cancel"
                  onPress={() => setReportOpen(false)}
                  style={[styles.reportBtn, { backgroundColor: colors.surfaceSecondary }]}
                >
                  <Text style={[styles.reportBtnText, { color: colors.onSurface }]}>{t.cancel}</Text>
                </Pressable>
                <Pressable
                  testID="report-submit"
                  disabled={reportMut.isPending}
                  onPress={() => reportMut.mutate()}
                  style={[styles.reportBtn, { backgroundColor: colors.error }]}
                >
                  <Text style={[styles.reportBtnText, { color: colors.onSurface }]}>
                    {reportMut.isPending ? t.submittingDots : t.submitLabel}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// ---------- Chips / tabs / stats ----------

function InfoChip({ icon, color, children }: { icon?: any; color: string; children: React.ReactNode }) {
  return (
    <View style={[styles.chip, { borderColor: color + "55" }]}>
      {icon && <Icon name={icon} size={10} color={color} />}
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>{children as any}</Text>
    </View>
  );
}

function StatCell({ label, value, onPress, testID }: { label: string; value: number; onPress?: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]}>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function TabBtn({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.tab}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
    </Pressable>
  );
}

// ---------- Profile tab ----------

function ProfileTab({ user, isOwner, isRTL, t }: any) {
  const router = useRouter();

  const { data: myRooms = [] } = useQuery({
    queryKey: ["profile-rooms", user.id],
    queryFn: async () => {
      // We only have /rooms/mine for the current user. For other users, filter server-side rooms by owner.
      if (isOwner) return apiMyRooms();
      // Fallback: /rooms and filter by owner.id
      const all = await (await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/rooms`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` }
      })).json();
      return (all || []).filter((r: any) => r.owner?.id === user.id);
    },
    enabled: !!user?.id,
  });

  // Latest 5 posts by this user (server applies visibility/block rules).
  const { data: myPosts = [] } = useQuery({
    queryKey: ["user-posts", user.id],
    queryFn: () => apiUserPosts(user.id, 5),
    enabled: !!user?.id,
  });

  const { data: myFamilies = [] } = useQuery({
    queryKey: ["families-mine-view", user.id, isOwner],
    queryFn: async () => (isOwner ? apiFamiliesMine() : []),
    enabled: isOwner,
  });

  return (
    <View style={styles.tabBody}>
      {/* User room */}
      <SectionHeader label={t.userRoom || "User Room"} rtl={isRTL} />
      {myRooms.length ? (
        <RoomCard room={myRooms[0]} testID="profile-user-room" />
      ) : (
        <EmptyState icon="mic-off-outline" text={t.noRoomYet || "No active room"} />
      )}

      {/* Family */}
      <SectionHeader label={t.family || "Family"} rtl={isRTL} />
      {myFamilies.length ? (
        <Pressable
          testID="profile-family-card"
          onPress={() => router.push(`/families/${myFamilies[0].id}` as any)}
          style={styles.familyCard}
        >
          <LinearGradient
            colors={["#7B4B14", "#4B2C05"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.familyBanner}>
            <Image
              source={myFamilies[0].cover_url || myFamilies[0].avatar_url || user.avatar_url}
              style={styles.familyBannerImg}
              contentFit="cover"
            />
          </View>
          <View style={styles.familyCardBody}>
            <Text style={styles.familyName} numberOfLines={1}>{myFamilies[0].name}</Text>
            <View style={styles.familyMembersPill}>
              <Icon name="people" size={11} color={colors.onSurface} />
              <Text style={styles.familyMembersText}>{myFamilies[0].members_count ?? 0}</Text>
            </View>
          </View>
        </Pressable>
      ) : (
        <EmptyState icon="home-outline" text={t.noFamily || "Not in a family"} />
      )}

      {/* Posts */}
      <SectionHeader label={t.myPosts || "Posts"} rtl={isRTL} />
      {myPosts.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.postsRow} testID="profile-posts-row">
          {(myPosts as any[]).slice(0, 5).map((p: any) => {
            const img = p.images?.[0] || p.image_url;
            return (
              <Pressable key={p.id} testID={`profile-post-${p.id}`} onPress={() => router.push(`/user-posts?author_id=${user.id}&focus=${p.id}` as any)}>
                <View style={styles.postTile}>
                  {p.video_url ? (
                    <View style={[StyleSheet.absoluteFill, styles.postSquareVideo]}><Icon name="play-circle" size={26} color="#FFFFFF" /></View>
                  ) : img ? (
                    <Image source={mediaUrl(img)} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, styles.postTileText]}><Text style={styles.postTileTextBody} numberOfLines={5}>{p.text}</Text></View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <EmptyState icon="newspaper-outline" text={t.noPostsYet || "No posts yet"} />
      )}
    </View>
  );
}

// ---------- Honor tab ----------

function HonorTab({ user, isRTL, t }: any) {
  // Gift Gallery — use existing gifts endpoint as the master + we filter by recipient
  // Real gift-transactions endpoint doesn't have a "received" listing, so we use user's medals[]
  // and read the top 8 unique gifts they've received via /users/{id}/gifts if it exists.
  // Fall back: use user.medals for future medal support (empty list for now).
  const { data: allGifts = [] } = useQuery({
    queryKey: ["gifts-catalog"],
    queryFn: async () => (await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/gifts`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    })).json(),
  });
  const receivedGifts = (user.received_gifts ?? []) as any[];
  const fashion = (user.fashion ?? []) as any[];
  const medals = (user.medals ?? []) as any[];

  return (
    <View style={styles.tabBody}>
      {/* Level squares — enlarged to fill the former Nobility space; order kept: Charm · Wealth · VIP. */}
      <LevelBoxes user={user} labels={{ wealth: t.wealth || "Wealth", charm: t.charm || "Charm" }} />

      {/* Gift Gallery */}
      <GalleryFrame title={t.giftGallery || "Gift Gallery"} rtl={isRTL}>
        {receivedGifts.length ? (
          <View style={styles.galleryRow}>
            {receivedGifts.slice(0, 8).map((g: any, i: number) => (
              <GalleryTile key={i} image={g.image_url} label={g.name} count={g.count} />
            ))}
          </View>
        ) : (
          <View style={styles.galleryRow}>
            {allGifts.slice(0, 4).map((g: any) => (
              <GalleryTile key={g.id} image={g.image_url} label={g.name} locked />
            ))}
          </View>
        )}
      </GalleryFrame>

      {/* Medal Gallery */}
      <GalleryFrame title={t.medalGallery || "Medal Gallery"} rtl={isRTL} tone="navy">
        {medals.length ? (
          <View style={styles.galleryRow}>
            {medals.slice(0, 8).map((m: any, i: number) => (
              <GalleryTile key={i} image={m.image_url} label={m.name} />
            ))}
          </View>
        ) : (
          <View style={styles.emptyGallery}>
            <Icon name="ribbon-outline" size={36} color={colors.muted} />
            <Text style={styles.emptyGalleryText}>{t.noMedalsYet || "No medals earned yet"}</Text>
          </View>
        )}
      </GalleryFrame>

      {/* Fashion Gallery */}
      <GalleryFrame title={t.fashionGallery || "Fashion Gallery"} rtl={isRTL} tone="amber">
        {fashion.length ? (
          <View style={styles.galleryRow}>
            {fashion.slice(0, 8).map((f: any, i: number) => (
              <GalleryTile key={i} image={f.image_url} label={f.name} />
            ))}
          </View>
        ) : (
          <View style={styles.emptyGallery}>
            <Icon name="shirt-outline" size={36} color={colors.muted} />
            <Text style={styles.emptyGalleryText}>{t.noFashionYet || "No fashion owned yet"}</Text>
          </View>
        )}
      </GalleryFrame>
    </View>
  );
}

function GalleryFrame({ title, rtl, tone, children }: any) {
  const colorPair: [string, string] =
    tone === "navy" ? ["#1a2f57", "#0d1b38"]
    : tone === "amber" ? ["#5B4310", "#2d2308"]
    : ["#3a1e6b", "#1c0d3d"];
  return (
    <View style={styles.galleryFrame}>
      <LinearGradient colors={colorPair} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.galleryHeaderBar}>
        <Text style={[styles.galleryTitle, rtl && { textAlign: "right" }]}>{title}</Text>
      </View>
      <View style={{ padding: spacing.md }}>{children}</View>
    </View>
  );
}

function GalleryTile({ image, label, count, locked }: any) {
  return (
    <View style={[styles.galleryTile, locked && { opacity: 0.35 }]}>
      <View style={styles.galleryTileImgWrap}>
        {image ? (
          <Image source={image} style={{ width: "100%", height: "100%" }} contentFit="contain" />
        ) : (
          <Icon name="help-outline" size={28} color={colors.muted} />
        )}
      </View>
      {typeof count === "number" && count > 1 && (
        <View style={styles.galleryTileCount}>
          <Text style={styles.galleryTileCountText}>×{count}</Text>
        </View>
      )}
      {label && <Text style={styles.galleryTileLabel} numberOfLines={1}>{label}</Text>}
    </View>
  );
}

// ---------- Relationships tab ----------

function RelationshipsTab({ user, isOwner, isRTL, t }: any) {
  const router = useRouter();
  const { data: friends = [] } = useQuery({
    queryKey: ["profile-friends", user.id],
    queryFn: apiFriendship,
    enabled: isOwner,
  });
  const { data: cps = [] } = useQuery({
    queryKey: ["profile-cp", user.id],
    queryFn: apiCp,
    enabled: isOwner,
  });

  const acceptedFriends = useMemo(
    () => (friends || []).filter((f: any) => f.status === "accepted"),
    [friends]
  );
  const activeCp = useMemo(
    () => (cps || []).find((c: any) => c.status === "accepted"),
    [cps]
  );

  return (
    <View style={styles.tabBody}>
      {/* Rank button (top) */}
      <Pressable
        testID="rel-request"
        onPress={() => router.push("/friendship")}
        style={styles.notifyBar}
      >
        <Icon name="notifications-outline" size={16} color={colors.gold} />
        <Text style={styles.notifyText}>{t.relationshipRequests || "Relationship requests"}</Text>
        <View style={{ flex: 1 }} />
        <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={16} color={colors.muted} />
      </Pressable>

      {/* CP section header row */}
      <View style={[styles.cpHeaderRow]}>
        <Text style={styles.cpHeaderTitle}>{t.myCP || "My CP"}</Text>
        <Pressable
          testID="cp-privileges"
          onPress={() => router.push("/cp")}
          style={{ marginLeft: spacing.sm, flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Text style={styles.cpHeaderLink}>{t.viewPrivileges || "View privileges"}</Text>
          <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={12} color={colors.gold} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          testID="cp-ranking"
          onPress={() => router.push("/rankings" as any)}
          style={styles.cpRankPill}
        >
          <Icon name="trophy" size={12} color={colors.purpleGlow} />
          <Text style={styles.cpRankPillText}>{t.cpRanking || "CP Ranking"}</Text>
        </Pressable>
      </View>

      {/* CP card */}
      <View style={styles.cpCard}>
        <LinearGradient
          colors={["#8A1D5A", "#4A0F2F"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.cpCardRow}>
          <Pressable
            testID="cp-partner-slot"
            onPress={() => router.push("/cp")}
            style={styles.cpSlot}
          >
            {activeCp?.partner ? (
              <>
                <Image source={activeCp.partner.avatar_url} style={styles.cpSlotImage} contentFit="cover" />
                <VipName style={styles.cpSlotName} numberOfLines={1} name={activeCp.partner?.nickname} color={(activeCp.partner as any)?.name_color} vipLevel={(activeCp.partner as any)?.vip_level} />
              </>
            ) : (
              <>
                <View style={styles.cpSlotEmpty}>
                  <Icon name="add" size={26} color="#FFF" />
                </View>
                <Text style={styles.cpSlotName}>—</Text>
              </>
            )}
          </Pressable>

          <View style={styles.cpMiddle}>
            <Icon name="heart" size={32} color="#FFF" />
            {!activeCp && (
              <View style={styles.cpBadge}>
                <Text style={styles.cpBadgeText}>{t.noCp || "No CP"}</Text>
              </View>
            )}
          </View>

          <View style={styles.cpSlot}>
            <Image source={user.avatar_url} style={styles.cpSlotImage} contentFit="cover" />
            <VipName style={styles.cpSlotName} numberOfLines={1} name={user?.nickname} color={(user as any)?.name_color} vipLevel={(user as any)?.vip_level} />
          </View>
        </View>

        {isOwner && !activeCp && (
          <Pressable
            testID="cp-invite-btn"
            onPress={() => router.push("/cp?openSearch=1" as any)}
            style={styles.cpMicBtn}
          >
            <Icon name="search" size={16} color={colors.onSurface} />
          </Pressable>
        )}
      </View>

      {/* Friends header */}
      <View style={[styles.friendsHeader]}>
        <Text style={styles.friendsHeaderTitle}>{t.myFriends || "My Friends"}</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          testID="friends-ranking"
          onPress={() => router.push("/rankings" as any)}
          style={[styles.cpRankPill, { backgroundColor: colors.surfaceTertiary }]}
        >
          <Icon name="trophy" size={12} color={colors.gold} />
          <Text style={[styles.cpRankPillText, { color: colors.gold }]}>{t.friendsRanking || "Friends Ranking"}</Text>
        </Pressable>
      </View>

      {/* Friends grid */}
      <View style={styles.friendsGrid}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const f = acceptedFriends[i];
          return (
            <FriendSlot
              key={i}
              friend={f}
              isOwner={isOwner}
              t={t}
              onInvite={() => router.push("/friendship?openSearch=1" as any)}
              onOpen={f ? () => router.push(`/user/${f.partner?.id}` as any) : undefined}
            />
          );
        })}
      </View>
    </View>
  );
}

function FriendSlot({ friend, isOwner, t, onInvite, onOpen }: any) {
  return (
    <View style={styles.friendSlot}>
      {friend ? (
        <Pressable onPress={onOpen} style={styles.friendSlotInner} testID={`friend-slot-${friend.partner?.id}`}>
          <Image source={friend.partner?.avatar_url} style={styles.friendAvatar} contentFit="cover" />
          <VipName style={styles.friendName} numberOfLines={1} name={friend.partner?.nickname} color={(friend.partner as any)?.name_color} vipLevel={(friend.partner as any)?.vip_level} />
        </Pressable>
      ) : (
        <View style={styles.friendSlotInner}>
          <View style={[styles.friendAvatar, styles.friendAvatarEmpty]}>
            <Icon name="person-outline" size={30} color={colors.muted} />
          </View>
          <Text style={[styles.friendName, { color: colors.muted }]}>{t.none || "None"}</Text>
          {isOwner && (
            <Pressable testID="friend-invite" onPress={onInvite} style={styles.friendInviteBtn}>
              <Text style={styles.friendInviteText}>{t.invite || "Invite"}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ---------- Bits ----------

function SectionHeader({ label, rtl }: { label: string; rtl?: boolean }) {
  return (
    <Text style={[styles.sectionHeader, rtl && { textAlign: "right" }]}>{label}</Text>
  );
}
function EmptyState({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={28} color={colors.muted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

// ---------- Styles ----------

const AVATAR_SIZE = 108;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  scrollHeader: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
    flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  scrollHeaderBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  scrollHeaderTitle: { flex: 1, alignItems: "center", paddingHorizontal: spacing.sm },
  scrollHeaderName: { color: colors.onSurface, fontSize: 16, fontWeight: "800", maxWidth: 220 },
  center: { alignItems: "center", justifyContent: "center" },
  stickyCta: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface + "f2",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stickyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: radius.pill,
  },
  stickyBtnText: { fontSize: 15, fontWeight: "900", letterSpacing: 0.4 },
  stickyCtaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // Three-dot menu (iter-33)
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  menuSheet: {
    width: "80%",
    maxWidth: 320,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  menuItemText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  menuSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  // Report dialog (iter-33)
  reportSheet: {
    width: "90%",
    maxWidth: 380,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  reportTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  reportHint: { color: colors.muted, fontSize: 12 },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingVertical: spacing.xs },
  reasonPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonPillActive: {
    backgroundColor: colors.error + "33",
    borderColor: colors.error,
  },
  reasonText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  reasonTextActive: { color: colors.error },
  reportInput: {
    minHeight: 80,
    color: colors.onSurface,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    padding: spacing.sm,
    textAlignVertical: "top",
    fontSize: 13,
  },
  reportBtnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  reportBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  reportBtnText: { fontSize: 14, fontWeight: "800" },
  rowRtl: { flexDirection: "row-reverse" },

  // Cover header
  coverWrap: { height: 260, overflow: "visible", position: "relative", zIndex: 5, elevation: 5 },
  coverInner: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" },
  topActionsRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: spacing.sm,
  },
  circleBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  avatarRing: {
    position: "absolute", bottom: -AVATAR_SIZE / 2 - 4, alignSelf: "center",
    width: AVATAR_SIZE + 8, height: AVATAR_SIZE + 8, borderRadius: (AVATAR_SIZE + 8) / 2,
    borderWidth: 3, borderColor: colors.gold,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface,
    zIndex: 10,
  },
  avatar: {
    width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.surfaceSecondary,
  },

  // Identity
  identity: { paddingTop: AVATAR_SIZE / 2 + spacing.md, alignItems: "center", paddingHorizontal: spacing.lg },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: "100%" },
  name: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  idRow: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6,
    paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  idText: { color: colors.muted, fontSize: 12, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },

  infoRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, marginTop: spacing.md, paddingVertical: 2 },
  // Shared badge token (BADGE_H / BADGE_FONT) — identical outer height and
  // boundaries as Age · VIP · Wealth · Charm badges.
  chip: {
    flexDirection: "row", alignItems: "center", gap: 2,
    paddingHorizontal: 6, height: BADGE_H, borderRadius: BADGE_H / 2,
    borderWidth: 0.75, backgroundColor: colors.surfaceSecondary, overflow: "hidden",
  },
  chipText: { fontSize: BADGE_FONT, fontWeight: "900", includeFontPadding: false },
  // NEW badge sized like every other small badge; spacing comes from the row gap.
  newBadge: { height: BADGE_H, justifyContent: "center", paddingVertical: 0, marginLeft: 0, marginRight: 0 },

  // Bio
  bioBox: {
    alignSelf: "stretch",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
  },
  bio: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },
  bioEmpty: { color: colors.muted, fontSize: 13, fontStyle: "italic", textAlign: "center" },

  // Voice bio placeholder
  voiceBio: {
    alignSelf: "stretch", marginTop: spacing.md,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.gold + "33",
    opacity: 0.85,
  },
  voiceBioIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.gold + "22",
    alignItems: "center", justifyContent: "center",
  },
  voiceBioTitle: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  voiceBioSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  soonPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
    backgroundColor: colors.gold + "22", borderWidth: 1, borderColor: colors.gold,
  },
  soonPillText: { color: colors.gold, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  // Stats
  statsRow: {
    alignSelf: "stretch",
    flexDirection: "row", justifyContent: "space-around", alignItems: "center",
    backgroundColor: colors.surfaceSecondary, marginTop: spacing.lg,
    borderRadius: radius.md, paddingVertical: spacing.md,
  },
  stat: { alignItems: "center", flex: 1 },
  statValue: { color: colors.onSurface, fontWeight: "900", fontSize: 20 },
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  statSep: { width: 1, height: 24, backgroundColor: colors.border },

  // Tabs
  tabsRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, marginTop: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.md },
  tabLabel: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  tabLabelActive: { color: colors.onSurface },
  tabUnderline: {
    marginTop: 6, width: 24, height: 3, borderRadius: 2, backgroundColor: "transparent",
  },
  tabUnderlineActive: { backgroundColor: colors.gold },

  tabBody: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },

  // Section headers
  sectionHeader: { color: colors.muted, fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },

  // Family card
  familyCard: {
    height: 96, borderRadius: radius.md, overflow: "hidden",
    flexDirection: "row", alignItems: "center", position: "relative",
    borderWidth: 1, borderColor: "#7B4B14",
    padding: spacing.md, gap: spacing.md,
  },
  familyBanner: {
    width: 80, height: 80, borderRadius: 12, overflow: "hidden",
    borderWidth: 2, borderColor: "#FFD68A",
  },
  familyBannerImg: { width: "100%", height: "100%" },
  familyCardBody: { flex: 1, gap: 6 },
  familyName: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  familyMembersPill: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.35)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
  },
  familyMembersText: { color: colors.onSurface, fontSize: 11, fontWeight: "700" },

  // Posts row
  postsRow: { flexDirection: "row", gap: 8, paddingRight: spacing.md, paddingVertical: 4 },
  postSquareVideo: { backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  postTile: {
    width: 96, aspectRatio: 1, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary, overflow: "hidden",
  },
  postTileText: { padding: 8, backgroundColor: colors.brandTertiary + "aa", justifyContent: "center", alignItems: "center" },
  postTileTextBody: { color: colors.onSurface, fontSize: 11, textAlign: "center" },
  postTileFooter: {
    position: "absolute", bottom: 4, right: 4,
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  postTileFooterText: { color: colors.onSurface, fontSize: 10, fontWeight: "700" },

  // Honor gallery
  galleryFrame: {
    borderRadius: radius.lg, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  galleryHeaderBar: {
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.1)",
  },
  galleryTitle: { color: colors.gold, fontWeight: "800", letterSpacing: 0.4, fontSize: 13 },

  galleryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  galleryTile: {
    width: 72, alignItems: "center",
  },
  galleryTileImgWrap: {
    width: 60, height: 60, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 4,
  },
  galleryTileCount: {
    position: "absolute", top: -4, right: 4,
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill,
    backgroundColor: colors.gold,
  },
  galleryTileCountText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800" },
  galleryTileLabel: { color: colors.onSurface, fontSize: 10, marginTop: 2, textAlign: "center" },
  emptyGallery: { alignItems: "center", paddingVertical: spacing.lg, gap: 4 },
  emptyGalleryText: { color: colors.muted, fontSize: 12 },

  // Relationships
  notifyBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  notifyText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },

  cpHeaderRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.md },
  cpHeaderTitle: { color: "#FF69B4", fontWeight: "800", fontSize: 14 },
  cpHeaderLink: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  cpRankPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#5A0D3E", paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
  },
  cpRankPillText: { color: "#FFD1E7", fontSize: 11, fontWeight: "800" },

  cpCard: {
    marginTop: spacing.sm, height: 140,
    borderRadius: radius.lg, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,182,193,0.25)",
    position: "relative",
  },
  cpCardRow: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  cpSlot: { alignItems: "center", width: 80, gap: 6 },
  cpSlotImage: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, borderColor: "#FFB6C1",
    backgroundColor: colors.surfaceSecondary,
  },
  cpSlotEmpty: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, borderColor: "#FFB6C1", backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  cpSlotName: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
  cpMiddle: { alignItems: "center", gap: 6 },
  cpBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill,
    backgroundColor: "#FF69B4",
  },
  cpBadgeText: { color: colors.onSurface, fontSize: 10, fontWeight: "800" },
  cpMicBtn: {
    position: "absolute", bottom: spacing.md, right: spacing.md,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)", borderWidth: 1, borderColor: "#FFB6C1",
    alignItems: "center", justifyContent: "center",
  },

  friendsHeader: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg },
  friendsHeaderTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },

  friendsGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.sm,
    backgroundColor: "#0d3236", borderRadius: radius.lg, padding: spacing.md,
  },
  friendSlot: {
    width: "31%",
  },
  friendSlotInner: { alignItems: "center", gap: 6 },
  friendAvatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  friendAvatarEmpty: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  friendName: { color: colors.onSurface, fontSize: 11, fontWeight: "700", maxWidth: 76, textAlign: "center" },
  friendInviteBtn: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  friendInviteText: { color: colors.onSurface, fontSize: 11, fontWeight: "700" },

  empty: { alignItems: "center", paddingVertical: spacing.lg, gap: 4 },
  emptyText: { color: colors.muted, fontSize: 12 },
  blockedBack: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginStart: spacing.sm },
  blockedBody: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: 80 },
  blockedText: { color: colors.onSurface, fontSize: 16, fontWeight: "700", textAlign: "center", lineHeight: 24 },
  unblockBtn: { height: 44, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  unblockText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 15 },
});
