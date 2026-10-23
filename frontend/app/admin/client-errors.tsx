/** Iter-155 — Web Admin: Android/iOS release-build error reports. */
import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AdminShell, adminStyles } from "@/src/components/AdminShell";
import { apiAdminClientErrors } from "@/src/api";
import { colors, spacing } from "@/src/theme";

export default function AdminClientErrors() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-client-errors"], queryFn: apiAdminClientErrors, refetchInterval: 15000 });
  return (
    <AdminShell title="App Errors · أخطاء التطبيق">
      {isLoading ? <ActivityIndicator color={colors.gold} /> : (
        <View style={{ gap: spacing.sm }}>
          {(data?.items ?? []).length === 0 && <Text style={styles.sub}>No errors reported · لا توجد أخطاء</Text>}
          {(data?.items ?? []).map((e: any, i: number) => (
            <View key={i} style={adminStyles.card} testID={`client-error-${i}`}>
              <Text style={styles.h}>[{e.kind}] {e.message}</Text>
              <Text style={styles.sub}>{e.platform} {e.os_version} · v{e.app_version} · {e.route || "—"} · {e.created_at?.replace("T", " ").slice(0, 19)}</Text>
              {!!e.stack && <Text style={styles.stack} selectable numberOfLines={8}>{e.stack}</Text>}
            </View>
          ))}
        </View>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  h: { color: colors.onSurface, fontWeight: "800", fontSize: 13 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  stack: { color: colors.onSurfaceSecondary, fontSize: 11, fontFamily: "monospace", marginTop: 6 },
});
