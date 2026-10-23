/**
 * Iter-104 — Thin row separator matching the Posts feed line
 * (0.5px, colors.border). `gap` = the list's existing item gap, so the
 * line sits inside that gap without changing the original spacing.
 */
import React from "react";
import { View } from "react-native";
import { colors } from "@/src/theme";

export function RowSeparator({ gap = 0 }: { gap?: number }) {
  return (
    <View
      testID="row-separator"
      style={{ height: 0.5, alignSelf: "stretch", backgroundColor: colors.border, marginVertical: -gap / 2 }}
    />
  );
}
