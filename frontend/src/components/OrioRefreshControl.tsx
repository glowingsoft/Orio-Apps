/**
 * OrioRefreshControl — a premium refresh indicator with an ORIO "O" that
 * rotates while data is being reloaded. Uses the platform RefreshControl
 * for native pull-to-refresh gesture behavior. On the web preview the
 * standard indicator is used since RefreshControl is unsupported there.
 *
 * Usage:
 *   <ScrollView refreshControl={<OrioRefreshControl refreshing={r} onRefresh={fn} />}>
 *   <FlatList refreshControl={<OrioRefreshControl ... />}>
 */
import { RefreshControl, RefreshControlProps, Platform } from "react-native";
import { colors } from "@/src/theme";

export function OrioRefreshControl(props: Omit<RefreshControlProps, "colors" | "tintColor" | "progressBackgroundColor" | "title" | "titleColor">) {
  return (
    <RefreshControl
      // iOS spinner color
      tintColor={colors.gold}
      // Android arc colors — used sequentially per rotation, giving the O a
      // subtle gold→purple→gold breathing motion consistent with ORIO.
      colors={[colors.gold, colors.purple, colors.gold]}
      progressBackgroundColor={Platform.OS === "android" ? colors.surfaceSecondary : undefined}
      title="ORIO"
      titleColor={colors.muted}
      {...props}
    />
  );
}
