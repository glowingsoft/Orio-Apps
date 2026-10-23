/**
 * Iter-85 — Admin Dashboard shared shell (sidebar + topbar + content).
 * Pure React Native — renders cleanly on web via Expo Router.
 */
import React, { useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Image, useWindowDimensions, Platform,
} from "react-native";
import { useRouter, useSegments } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";

type NavItem = { href: string; label: string; labelAr: string; icon: string; ownerOnly?: boolean; perm?: string };

// Iter-118 — each section requires a permission; admins see ONLY what the
// Owner granted (backend enforces the same permissions on every endpoint).
const BASE_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", labelAr: "نظرة عامة", icon: "grid-outline" },
  { href: "/admin/users", label: "Users", labelAr: "المستخدمون", icon: "people-outline", perm: "users.view" },
  { href: "/admin/bans", label: "Bans", labelAr: "الحظر", icon: "ban-outline", perm: "bans.view" },
  { href: "/admin/rooms", label: "Rooms", labelAr: "الغرف", icon: "mic-outline", perm: "rooms.view" },
  { href: "/admin/wallet", label: "Wallet & Diamonds", labelAr: "المحفظة والألماس", icon: "diamond-outline", perm: "wallet.view" },
  { href: "/admin/vip", label: "VIP Members", labelAr: "أعضاء VIP", icon: "star-outline", perm: "vip.view" },
  { href: "/admin/reports", label: "Reports & Moderation", labelAr: "البلاغات والإشراف", icon: "shield-checkmark-outline", perm: "reports.view" },
  { href: "/admin/words", label: "Blocked Words", labelAr: "الكلمات المحظورة", icon: "chatbox-ellipses-outline", perm: "messages.review" },
  { href: "/admin/custom-gifts", label: "Custom Gifts", labelAr: "الهدايا المخصصة", icon: "gift-outline", perm: "rooms.manage" },
  { href: "/admin/client-errors", label: "App Errors", labelAr: "أخطاء التطبيق", icon: "bug-outline", perm: "rooms.manage" },
  { href: "/admin/support", label: "Support Inbox", labelAr: "صندوق الدعم", icon: "headset-outline", perm: "reports.resolve" },
  { href: "/admin/activities", label: "Activity Applications", labelAr: "طلبات الأنشطة", icon: "calendar-outline", perm: "rooms.manage" },
  { href: "/admin/withdrawals", label: "Withdrawals", labelAr: "السحوبات", icon: "cash-outline", perm: "withdrawals.view" },
  { href: "/admin/audit", label: "Audit Log", labelAr: "سجل التدقيق", icon: "document-text-outline", perm: "audit.view" },
  { href: "/admin/team", label: "Admin Team", labelAr: "فريق الإدارة", icon: "shield-outline", ownerOnly: true },
  { href: "/admin/owner", label: "Owner", labelAr: "المالك", icon: "key-outline", ownerOnly: true },
];

/** Permission check helper for admin screens (Owner → always true). */
export function useAdminCan() {
  const { user } = useAuth();
  const a = user?.admin_access;
  return (perm: string) => !!a && (a.is_owner || (a.permissions || []).includes(perm));
}

export function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { width } = useWindowDimensions();
  const { user, signOut, refresh } = useAuth();
  const { lang } = useI18n();
  const compact = width < 900;
  const can = useAdminCan();
  // Permission changes apply immediately: re-read admin_access every 10s.
  useEffect(() => {
    const h = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(h);
  }, [refresh]);

  const isOwner = !!user?.admin_access?.is_owner;
  const NAV = BASE_NAV
    .filter((n) => (!n.ownerOnly || isOwner) && (!n.perm || can(n.perm)))
    .map((n) => ({ ...n, label: lang === "ar" ? n.labelAr : n.label }));

  const currentPath = "/" + segments.join("/");

  return (
    <View style={styles.root}>
      {!compact && (
        <View style={styles.sidebar}>
          <View style={styles.brand}>
            <View style={styles.brandDot} />
            <Text style={styles.brandText}>ORIO Admin</Text>
          </View>
          <View style={{ marginTop: spacing.xl }}>
            {NAV.map((n) => {
              const active = currentPath === n.href || (n.href !== "/admin" && currentPath.startsWith(n.href));
              return (
                <Pressable
                  key={n.href}
                  onPress={() => router.push(n.href as any)}
                  style={[styles.navItem, active && styles.navItemActive]}
                >
                  <Icon name={n.icon as any} size={18} color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.navLabel, active && styles.navLabelActive]}>{n.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flex: 1 }} />
          <View style={styles.userCard}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.brandPrimary }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{user?.nickname || "Admin"}</Text>
              <Text style={styles.userRole} numberOfLines={1}>
                {user?.admin_access?.is_owner ? "Owner" : "Admin"}
              </Text>
            </View>
            <Pressable onPress={async () => { await signOut(); router.replace("/admin/login"); }} style={styles.logout}>
              <Icon name="log-out-outline" size={18} color={colors.error} />
            </Pressable>
          </View>
        </View>
      )}

      <View style={{ flex: 1 }}>
        <View style={styles.topbar}>
          {compact && (
            <Pressable onPress={() => router.push("/admin" as any)} style={{ marginRight: spacing.md }}>
              <View style={styles.brandDot} />
            </Pressable>
          )}
          <Text style={styles.title}>{title}</Text>
          <View style={{ flex: 1 }} />
          {compact && (
            <Pressable onPress={async () => { await signOut(); router.replace("/admin/login"); }}>
              <Icon name="log-out-outline" size={20} color={colors.error} />
            </Pressable>
          )}
        </View>
        {compact && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.compactNav} contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
            {NAV.map((n) => {
              const active = currentPath === n.href || (n.href !== "/admin" && currentPath.startsWith(n.href));
              return (
                <Pressable key={n.href} onPress={() => router.push(n.href as any)} style={[styles.pill, active && styles.pillActive]}>
                  <Icon name={n.icon as any} size={14} color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                  <Text style={[styles.pillText, active && { color: colors.onBrandPrimary }]}>{n.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.xl, paddingBottom: 48 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.surface,
  },
  sidebar: {
    width: 260,
    backgroundColor: colors.surfaceSecondary,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  brandDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.brandPrimary,
    shadowColor: colors.purpleGlow, shadowOpacity: 0.6, shadowRadius: 12,
  },
  brandText: {
    color: colors.onSurface, fontSize: 18, fontWeight: "700",
  },
  navItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, marginBottom: 4,
  },
  navItemActive: { backgroundColor: colors.brandPrimary },
  navLabel: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "500" },
  navLabelActive: { color: colors.onBrandPrimary, fontWeight: "700" },
  userCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.sm, borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  userName: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  userRole: { color: colors.purple, fontSize: 11 },
  logout: { padding: 6 },
  topbar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "700" },
  compactNav: {
    maxHeight: 48,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    marginVertical: 8,
  },
  pillActive: { backgroundColor: colors.brandPrimary },
  pillText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
});

export const adminStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    color: colors.onSurface, fontSize: 16, fontWeight: "700",
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 10,
  },
  rowCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingVertical: 12, paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  primaryBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md,
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 13 },
  dangerBtn: {
    backgroundColor: "transparent",
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.error,
  },
  dangerBtnText: { color: colors.error, fontWeight: "700", fontSize: 13 },
  ghostBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  ghostBtnText: { color: colors.onSurface, fontWeight: "600", fontSize: 13 },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    color: colors.onSurface, fontSize: 14,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  badge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radius.pill, alignSelf: "flex-start",
  },
  badgeText: { fontSize: 10, fontWeight: "700" },
});
