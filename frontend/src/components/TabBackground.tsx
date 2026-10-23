/**
 * Shared background for the Me / Messages / Posts / Rooms tabs.
 * Iter-137 — global PURE WHITE theme (#FFFFFF). The previous mosque artwork
 * is no longer drawn behind standard tabs; room custom backgrounds are
 * unaffected (rendered by the room screen itself).
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/src/theme";

export function TabBackground() {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]} testID="tab-background" />;
}
