/**
 * Iter-85 — Admin Dashboard layout.
 *   • Allows public access to /admin/login
 *   • Everything else requires an authenticated user with is_admin=true
 *   • Keeps the existing /admin/withdrawals subroute working
 */
import React, { useEffect } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/src/auth-context";
import { colors } from "@/src/theme";

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (loading) return;
    if (isLogin) return;
    if (!user) {
      router.replace("/admin/login");
      return;
    }
    // Iter-86 — authoritative check is admin_access from the server (Owner or
    // enabled approved admin). Never trust a locally-cached is_admin flag.
    if (!user.admin_access) {
      router.replace("/admin/login?forbidden=1");
    }
  }, [user, loading, isLogin, pathname, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
  );
}
