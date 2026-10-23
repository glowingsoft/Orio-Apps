/**
 * ORIO "NEW" badge (Iter-49)
 * -----------------------------------------------------------------------------
 * Renders a small premium "جديد" / "NEW" chip NEXT to a user's name whenever
 * the backend ships `is_new: true` on that user object.
 *
 * The backend computes `is_new` from the user's real `created_at` and returns
 * `true` for exactly 5 days from account creation (tz-safe). There is no local
 * timer / no manual flag — the client only renders what the server says.
 *
 *   import { NewUserBadge } from "@/src/components/NewUserBadge";
 *   <NewUserBadge isNew={user.is_new} />
 *
 * Pass `size="sm" | "md"` to control height (default sm for chat rows).
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useI18n } from "@/src/i18n";
import { BADGE_H, BADGE_FONT } from "@/src/levels/badges";

type Props = {
  isNew?: boolean | null;
  size?: "sm" | "md";
  style?: any;
};

export function NewUserBadge({ isNew, size = "sm", style }: Props) {
  const { isRTL } = useI18n();
  if (!isNew) return null;
  // Shared badge token → same outer height as every other badge (sm & md).
  void size;
  const dims = { paddingH: 6, font: BADGE_FONT };
  return (
    <View
      testID="orio-new-badge"
      style={[
        styles.chip,
        {
          paddingHorizontal: dims.paddingH,
          height: BADGE_H,
          justifyContent: "center",
          marginLeft: isRTL ? 0 : 6,
          marginRight: isRTL ? 6 : 0,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { fontSize: dims.font, includeFontPadding: false }]}>
        {isRTL ? "جديد" : "NEW"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: "#15C65A", // success-green so it stands out from purple accents
    borderRadius: 999,
    alignSelf: "center",
    shadowColor: "#15C65A",
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  text: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.4,
  },
});

export default NewUserBadge;
