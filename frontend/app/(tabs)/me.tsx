import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useLiveUser } from "@/src/hooks/useLiveUser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";
import { RowSeparator } from "@/src/components/RowSeparator";
import { FoluCoin } from "@/src/components/FoluCoin";
import { tierFor } from "@/src/components/OrioVipEmblem";
import { useQuery } from "@tanstack/react-query";
import { apiMyAgency, apiMyInvitations, apiMyVisitors, apiMyConnections } from "@/src/api";
import { VipName } from "@/src/components/VipName";
import { VipBadge } from "@/src/components/VipBadge";
import { ProfileStatChips } from "@/src/profile/StatChips";
import { useI18n } from "@/src/i18n";
import { TabBackground } from "@/src/components/TabBackground";
import * as Clipboard from "expo-clipboard";

type MenuItem = { id: string; icon: string; label: string; sub?: string; href: string; badge?: string; iconColor?: string };

export default function Me() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  // Live sync: diamonds balance + levels refresh on focus and every 15s.
  useLiveUser();
  const myAgency = useQuery({ queryKey: ["me", "agency"], queryFn: apiMyAgency, enabled: !!user });
  // Iter-99 — live Friends / Following / Followers counts.
  const conn = useQuery({ queryKey: ["connections", "friends"], queryFn: () => apiMyConnections("friends"), enabled: !!user });
  const myInvites = useQuery({ queryKey: ["me", "invitations"], queryFn: apiMyInvitations, enabled: !!user });
  // Reuses the shared visitors query key so the Visitors screen and this
  // tab share one cached payload — zero extra network cost. Refetches when
  // the Me tab regains focus thanks to React Query's refetchOnMount default.
  const myVisitors = useQuery({
    queryKey: ["visitors"],
    queryFn: apiMyVisitors,
    enabled: !!user,
    staleTime: 15_000,
  });
  const { t } = useI18n();
  if (!user) return null;

  const invCount = myInvites.data?.items.length ?? 0;
  const todayViews: number = myVisitors.data?.today_views ?? 0;
  const agencyLabel = myAgency.data?.agency
    ? `${myAgency.data.agency.name}${myAgency.data.role === "AGENCY_OWNER" ? t.agencyOwnerSuffix : ""}`
    : invCount > 0 ? t.pendingInvitationLabel(invCount) : t.notInAgency;


  const menu: MenuItem[] = [
    { id: "vip",        icon: "star",             label: t.vipPrivileges,     sub: user.vip_level ? undefined : t.unlockPremium,  href: "/vip",         badge: undefined, iconColor: colors.gold },
    { id: "earnings",   icon: "trending-up",      label: t.earnings,          sub: t.yourHostEarnings,                               href: "/earnings",    iconColor: colors.success },
    { id: "agency",     icon: "business",         label: t.agencyCenter,      sub: agencyLabel,                                                  href: "/agency",      badge: invCount > 0 ? String(invCount) : undefined, iconColor: colors.gold },
    ...(user.is_admin ? [{ id: "admin-wdr", icon: "shield-checkmark" as const, label: t.adminWithdrawalCenterLabel, sub: t.reviewPayoutRequests, href: "/admin/withdrawals", iconColor: colors.purple }] : []),
    { id: "tasks",      icon: "checkmark-done",   label: t.dailyTasks,        sub: t.earnDiamondsEveryDay,                                   href: "/tasks",       iconColor: colors.brandPrimary },
    { id: "visitors",   icon: "eye",              label: t.visitorsTitle,       sub: t.visitorsSubRow(todayViews), href: "/visitors", badge: todayViews > 0 ? String(todayViews) : undefined, iconColor: "#26D0CE" },
    { id: "myrooms",    icon: "mic",              label: t.myRoomsTitle,      sub: t.roomsYouOwn,                                             href: "/my-rooms",    iconColor: colors.purple },
    { id: "wallet",     icon: "wallet",           label: t.walletTab,         sub: t.diamondsCount(user.coins?.toLocaleString() || "0"),             href: "/(tabs)/wallet", iconColor: "#0A84FF" },
    { id: "family",     icon: "home",             label: t.familyLabel,       sub: t.familyPrivateChat,                                    href: "/families",    iconColor: "#FF9500" },
    { id: "cp",         icon: "heart",            label: t.cpRelationships,   sub: t.yourSpecialOne,                                          href: "/cp",          iconColor: "#FF453A" },
    { id: "invite",     icon: "gift",             label: t.inviteFriendsLabel, sub: t.earnDiamondsLabel,                                             href: "/invite",      iconColor: "#26D0CE" },
    { id: "settings",   icon: "settings",         label: t.settingsLabel,     sub: t.languageSecurityPrivacy,                               href: "/settings",    iconColor: colors.muted },
  ];

  // Iter-56 — 4 premium ORIO shortcuts under the stat chips.
  // All route to real, functional screens (no fake destinations):
  //   Level (المستوى) → /vip  (level/VIP progression)
  //   Bag  (حقيبتي) → /wallet (user's assets / currency bag)
  //   Store (المتجر) → /recharge-agent (diamond store)
  //   Medal (ميدالية) → /tasks (achievements/medals)
  const shortcuts: {
    id: string; icon: any; label: string; href: string;
    color: string; glow: string;
  }[] = [
    { id: "level",  icon: "trophy",     label: t.shortcutLevel,    href: "/level",           color: "#FFD60A", glow: "#FFE68A" },
    { id: "bag",    icon: "briefcase",  label: t.shortcutMyBag,    href: "/bag",             color: "#BF5AF2", glow: "#D9A8FF" },
    { id: "store",  icon: "storefront", label: t.shortcutStore,    href: "/store",           color: "#38BDF8", glow: "#8CE2FF" },
    { id: "medal",  icon: "medal",      label: t.shortcutMedal,    href: "/medal",           color: "#F43F5E", glow: "#FFA3B3" },
  ];

  return (
    <View style={styles.container} testID="me-screen">
      {/* Iter-66 — soft purple top glow only. */}
      <TabBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        {/* Cover / header */}
        <View style={{ paddingTop: insets.top }}>
          <View style={styles.banner} />

          <View style={styles.headerContent}>
            <Pressable
              testID="me-open-profile"
              onPress={() => router.push("/(tabs)/profile")}
              style={{ flexDirection: "row", flex: 1, alignItems: "center" }}
            >
              {/* Iter-99 — photo and name both open the user's own profile. */}
              <Image testID="me-avatar" source={user.avatar_url} style={styles.avatar} contentFit="cover" />
              {/* Same comfortable spacing in EN & AR: start-aligned column (mirrors natively). */}
              <View style={{ flex: 1, marginStart: spacing.xl + 8, alignItems: "flex-start", gap: 8 }}>
                <VipName
                  name={user.nickname}
                  color={(user as any).name_color}
                  style={styles.name}
                  numberOfLines={1}
                />
                <ProfileStatChips user={user} testIDPrefix="me-stat" />
                {/* Iter-121 — copy icon + "ID: n" only; copies the numeric ID silently. */}
                <Pressable
                  onPress={(e) => { e.stopPropagation?.(); if (user.numeric_id) Clipboard.setStringAsync(String(user.numeric_id)); }}
                  hitSlop={8}
                  style={styles.meId}
                  testID="me-copy-id"
                  accessibilityLabel={`ID: ${user.numeric_id ?? ""}`}
                >
                  <Icon name="copy-outline" size={13} color={colors.muted} />
                  <Text style={styles.meIdText}>{`ID: ${user.numeric_id ?? ""}`}</Text>
                </Pressable>
              </View>
            </Pressable>
          </View>

          {/* Iter-99 — Friends | Following | Followers (owner-only lists). */}
          <View style={styles.chips}>
            {([
              { type: "friends", label: t.friends, value: conn.data?.counts.friends ?? user.friends ?? 0 },
              { type: "following", label: t.following, value: conn.data?.counts.following ?? user.following ?? 0 },
              { type: "followers", label: t.followers, value: conn.data?.counts.followers ?? user.followers ?? 0 },
            ]).map((c) => (
              <Pressable
                key={c.type}
                testID={`me-conn-${c.type}`}
                onPress={() => router.push(`/connections?type=${c.type}` as any)}
                style={styles.chip}
              >
                <Text style={styles.chipValue}>{Number(c.value).toLocaleString()}</Text>
                <Text style={styles.chipLabel}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Iter-56 — 4 premium ORIO shortcuts (Level · Bag · Store · Medal) */}
          <View style={[styles.shortcutRow, { flexDirection: "row" }]}>
            {shortcuts.map((s) => (
              <Pressable
                key={s.id}
                testID={`me-shortcut-${s.id}`}
                onPress={() => router.push(s.href as any)}
                style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
                accessibilityLabel={s.label}
              >
                <View style={[styles.shortcutGlow, { borderColor: s.color + "55" }]}>
                  <Icon name={s.icon} size={22} color={s.color} />
                </View>
                <Text style={styles.shortcutLabel} numberOfLines={1}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Iter-66 — ORIO orb banner removed; the subtle top-of-screen purple
            glow (rendered once at the container root) replaces it. */}

        {/* Menu grid */}
        <View style={styles.menu}>
          {menu.map((m, idx) => (
            <React.Fragment key={m.id}>
            {idx > 0 && <RowSeparator gap={spacing.sm} />}
            <Pressable
              testID={`me-${m.id}`}
              onPress={() => router.push(m.href as any)}
              style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.menuIcon}>
                <Icon name={m.icon as any} size={20} color={m.iconColor || colors.onSurface} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={styles.menuLabel}>{m.label}</Text>
                  {m.id === "vip" && (user.vip_level ?? 0) > 0 && (
                    <View style={{ marginHorizontal: 6 }}>
                      <VipBadge level={user.vip_level} size="sm" />
                    </View>
                  )}
                  {m.badge && (
                    <View style={styles.miniBadge}><Text style={styles.miniBadgeText}>{m.badge}</Text></View>
                  )}
                </View>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
            </React.Fragment>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  meId: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, alignSelf: "flex-start", minHeight: 24 },
  meIdText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  container: { flex: 1, backgroundColor: colors.surface },
  banner: { height: 112, overflow: "hidden", backgroundColor: colors.purpleGlow },
  headerContent: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, marginTop: -50 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceSecondary },
  name: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  uid: { color: colors.muted, fontSize: 12, fontFamily: "monospace", fontWeight: "700" },
  uidRow: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  vipBadge: { backgroundColor: colors.gold, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.pill },
  vipText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800" },
  walletRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  walletChip: { flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  walletText: { color: colors.onSurface, fontWeight: "700", fontSize: 12 },
  chips: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg, justifyContent: "space-between" },
  // Iter-56 — Premium shortcut row
  shortcutRow: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  shortcut: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  shortcutGlow: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  shortcutLabel: {
    color: colors.onSurface,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  chip: { flex: 1, flexDirection: "column", alignItems: "center", gap: 2, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, justifyContent: "center" },
  chipLabel: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  chipValue: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  menu: { paddingHorizontal: spacing.lg, marginTop: spacing.xl, gap: spacing.sm },
  menuItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md },
  menuIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  menuLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  menuSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  miniBadge: { backgroundColor: colors.gold, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, marginLeft: spacing.sm },
  miniBadgeText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800" },
});
