import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { VipName } from "@/src/components/VipName";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiThreads, apiInboxOverview, fmtCount, apiThreadPin, apiThreadDelete } from "@/src/api";
import { pollMs, useRealtimeConnected } from "@/src/realtime";
import { ActionSheet } from "@/src/components/ActionSheet";
import { AgeBadge, LevelBadgeChip } from "@/src/levels/badges";
import { VipBadge } from "@/src/components/VipBadge";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { TabBackground } from "@/src/components/TabBackground";

export default function Messages() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t } = useI18n();
  const live = useRealtimeConnected();
  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["threads"],
    queryFn: apiThreads,
    refetchInterval: pollMs(live, 60_000, 5000),
  });
  const qc = useQueryClient();
  const [menuFor, setMenuFor] = useState<any | null>(null);
  const setThreads = (fn: (l: any[]) => any[]) => qc.setQueryData(["threads"], (old: any) => fn(Array.isArray(old) ? old : []));
  const togglePin = async (th: any) => {
    const pinned = !th.pinned;
    setThreads((l) => {
      const next = l.map((x) => (x.user.id === th.user.id ? { ...x, pinned } : x));
      return [...next.filter((x) => x.pinned), ...next.filter((x) => !x.pinned)];
    });
    try { await apiThreadPin(th.user.id, pinned); } finally { qc.invalidateQueries({ queryKey: ["threads"] }); }
  };
  const deleteThread = async (th: any) => {
    setThreads((l) => l.filter((x) => x.user.id !== th.user.id));
    qc.removeQueries({ queryKey: ["messages", th.user.id] });
    try { await apiThreadDelete(th.user.id); } finally {
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["unread-count"] });
    }
  };
  const { data: inbox } = useQuery({
    queryKey: ["inbox-overview"],
    queryFn: apiInboxOverview,
    refetchInterval: 20000,
  });

  // Iter-94 — Four fixed inbox tiles under the header. Every item is
  // backend-connected (apiInboxOverview) and navigates to a real screen.
  const inboxTiles: {
    id: string; icon: string; iconColor: string; label: string; sub: string;
    count?: number; href: string;
  }[] = [
    {
      id: "friend-requests",
      icon: "person-add",
      iconColor: "#32D74B",
      label: t.friendRequests,
      sub: t.friendRequestsSub,
      count: inbox?.friend_requests?.count ?? 0,
      href: "/friend-requests",
    },
    {
      id: "system-notifications",
      icon: "notifications",
      iconColor: "#FFD60A",
      label: t.systemNotifications,
      sub: t.systemNotificationsSub,
      count: inbox?.system_notifications?.count ?? 0,
      href: "/notifications",
    },
    {
      id: "support-team",
      icon: "headset",
      iconColor: "#0A84FF",
      label: t.supportTeam,
      sub: t.supportTeamSub,
      count: inbox?.support_team?.count ?? 0,
      href: "/support",
    },
    {
      id: "activities",
      icon: "sparkles",
      iconColor: "#BF5AF2",
      label: t.activitiesLabel,
      sub: t.activitiesSub,
      count: 0, // Activities count is not an unread signal
      href: "/activities",
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="messages-screen">
      {/* Iter-66 — soft purple top glow only. */}
      <TabBackground />
      {/* Iter-49 — Messages header: premium title + Add Friend icon */}
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Text style={styles.title}>{t.messagesTitle}</Text>
        <Pressable
          testID="messages-add-friend-btn"
          onPress={() => router.push("/search?mode=id" as any)}
          hitSlop={10}
          style={({ pressed }) => [styles.addFriendBtn, pressed && { opacity: 0.75 }]}
          accessibilityLabel={t.addFriend}
        >
          <Icon name="person-add" size={20} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {/* Iter-95 — Compact horizontal row of 4 inbox items (replaces vertical tiles). */}
      <View style={styles.quickRow}>
        {inboxTiles.map((tile) => (
          <Pressable
            key={tile.id}
            testID={`inbox-tile-${tile.id}`}
            onPress={() => router.push(tile.href as any)}
            style={({ pressed }) => [styles.quickItem, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.quickIconWrap}>
              <Icon name={tile.icon as any} size={22} color={tile.iconColor} />
              {(tile.count ?? 0) > 0 && (
                <View style={styles.quickBadge}>
                  <Text style={styles.quickBadgeText}>{tile.count! > 99 ? "99+" : String(tile.count)}</Text>
                </View>
              )}
            </View>
            <Text style={styles.quickLabel} numberOfLines={1}>{tile.label}</Text>
          </Pressable>
        ))}
      </View>


      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : threads.length === 0 ? (
        <View style={styles.center}>
          <Icon name="chatbubbles-outline" size={56} color={colors.muted} />
          <Text style={styles.emptyText}>{t.noMessagesYet}</Text>
          <Text style={styles.emptySub}>{t.startConversationsSub}</Text>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(i, idx) => i.user.id + idx}
          renderItem={({ item }) => (
            <Pressable
              testID={`thread-${item.user.id}`}
              onPress={() => router.push(`/chat/${item.user.id}`)}
              onLongPress={() => setMenuFor(item)}
              delayLongPress={350}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              {item.user.is_official ? (
                <View style={[styles.avatar, { alignItems: "center", justifyContent: "center" }]} testID="thread-official-logo"><Icon name="shield-checkmark" size={26} color={colors.brandPrimary} /></View>
              ) : (
                <View>
                  <Image source={item.user.avatar_url} style={styles.avatar} contentFit="cover" />
                  {/* Real server presence (app heartbeat) — hidden when offline. */}
                  {(item.user as any).online && <View style={styles.onlineDot} testID={`thread-online-${item.user.id}`} />}
                </View>
              )}
              <View style={{ flex: 1, gap: 3, alignItems: "flex-start" }}>
                {/* Name hugs the avatar side in both LTR and RTL (native start alignment). */}
                <View style={styles.nameRow}>
                  <VipName style={styles.name} numberOfLines={1} name={item.user?.nickname} color={(item.user as any)?.name_color} vipLevel={(item.user as any)?.vip_level} />
                  {!!(item as any).pinned && <Icon name="pin" size={13} color={colors.brandPrimary} style={{ marginStart: 4 }} testID={`thread-pinned-${item.user.id}`} />}
                </View>
                {!item.user.is_official && (
                  <View style={styles.badgeRow} testID={`thread-badges-${item.user.id}`}>
                    <AgeBadge age={(item.user as any).age} gender={(item.user as any).gender} />
                    {Number((item.user as any).vip_level ?? 0) > 0 && <VipBadge level={(item.user as any).vip_level} size="sm" />}
                    <LevelBadgeChip size="sm" sys="wealth" level={Math.max(1, Number((item.user as any).wealth_level ?? 0))} />
                    {Number((item.user as any).charm_level ?? 0) >= 1 && <LevelBadgeChip size="sm" sys="charm" level={Number((item.user as any).charm_level)} />}
                  </View>
                )}
                <Text style={[styles.last, { alignSelf: "stretch" }, (item as any).last_kind === "unsent" && { fontStyle: "italic" }]} numberOfLines={1}>
                  {(item as any).last_kind === "unsent" ? (isRTL ? "تم إلغاء إرسال الرسالة" : "Message Unsent") : item.last_message}
                </Text>
              </View>
              {Number((item as any).unread) > 0 ? (
                <View style={styles.unread} testID={`thread-unread-${item.user.id}`}>
                  <Text style={styles.unreadText}>{fmtCount((item as any).unread)}</Text>
                </View>
              ) : (
                <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={20} color={colors.muted} />
              )}
            </Pressable>
          )}
        />
      )}
      <ActionSheet
        visible={!!menuFor}
        onClose={() => setMenuFor(null)}
        testID="thread-actions"
        actions={menuFor ? [
          { key: "pin", icon: menuFor.pinned ? "pin-outline" : "pin", label: menuFor.pinned ? (isRTL ? "إلغاء التثبيت" : "Unpin") : (isRTL ? "تثبيت" : "Pin"), onPress: () => togglePin(menuFor) },
          { key: "delete", icon: "trash", label: isRTL ? "حذف" : "Delete", onPress: () => deleteThread(menuFor) },
        ] : []}
        cancelLabel={isRTL ? "إلغاء" : "Cancel"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "800", letterSpacing: 0.3 },
  addFriendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.brandPrimary + "22",
    borderWidth: 1, borderColor: colors.brandPrimary + "55",
  },
  tilesWrap: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  quickRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  quickItem: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  quickIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
    position: "relative",
  },
  quickBadge: {
    position: "absolute",
    top: -4, right: -4,
    minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.surface,
  },
  quickBadgeText: { color: "#FFF", fontSize: 10, fontWeight: "800" },
  quickLabel: {
    color: colors.onSurface,
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    maxWidth: 76,
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  tileLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  tileSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  badge: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: colors.error, alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurface, fontSize: 17, fontWeight: "600" },
  emptySub: { color: colors.muted, fontSize: 14, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceSecondary },
  onlineDot: { position: "absolute", bottom: 1, end: 1, width: 13, height: 13, borderRadius: 7, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.surface },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 3, flexWrap: "wrap" },
  unread: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  unreadText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", maxWidth: "100%" },
  last: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
