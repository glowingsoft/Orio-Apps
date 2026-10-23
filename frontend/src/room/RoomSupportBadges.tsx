/**
 * Iter-121 — room-only supporter badges (shown ONLY in the room user card).
 *   🏆 Trophy  = paid diamond gifts SENT in this room (24h session memory)
 *   ⭐ Star    = paid diamond gifts RECEIVED in this room
 * Each appears after the first paid gift (hidden at 0); design tier steps at
 * 10K / 100K / 1M / 10M / 100M. Totals come from the backend and refresh on
 * the room's real-time `room_badges` socket event.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/ionicons";
import { useQuery } from "@tanstack/react-query";
import { apiRoomSupportBadges } from "@/src/api";
import { abbrevNumber } from "@/src/utils/format";

// Iter-122 — visible from the FIRST paid gift (>0); design steps up at each milestone.
const MILESTONES = [10_000, 100_000, 1_000_000, 10_000_000, 100_000_000];
const tierOf = (v: number) => (v <= 0 ? -1 : MILESTONES.reduce((t, m, i) => (v >= m ? i : t), 0));

// Fixed premium palettes (identical in all themes).
const TROPHY: [string, string, string][] = [
  ["#7A4A1E", "#C98A4B", "#F1C27D"], // 10K bronze
  ["#5E6670", "#C9D1DB", "#F4F7FA"], // 100K silver
  ["#8A5A00", "#F2C94C", "#FFF1A8"], // 1M gold
  ["#0F5E73", "#5FE1F5", "#E2FBFF"], // 10M platinum
  ["#7A1F8F", "#FF5FD2", "#FFE27A"], // 100M royal
];
const STAR: [string, string, string][] = [
  ["#3B1C78", "#7C4DDB", "#B79CFF"],
  ["#4A1C8F", "#9B5CF6", "#D6C2FF"],
  ["#5B159E", "#B14DFF", "#F0D9FF"],
  ["#3A0F8F", "#8F5BFF", "#7EF5FF"],
  ["#520F7A", "#D946EF", "#FFD6FF"],
];

function Badge({ value, kind, testID }: { value: number; kind: "trophy" | "star"; testID: string }) {
  const tier = tierOf(value);
  if (tier < 0) return null;
  const pal = (kind === "trophy" ? TROPHY : STAR)[tier];
  return (
    <View testID={testID} style={[styles.badge, { borderColor: pal[2] + "AA" }]} accessibilityLabel={`${kind} ${value}`}>
      <LinearGradient colors={[pal[0], pal[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.iconDisc, { backgroundColor: pal[2] + "33", borderColor: pal[2] }]}>
        <Icon name={kind === "trophy" ? "trophy" : "star"} size={11} color={pal[2]} />
      </View>
      <Text style={styles.text}>{abbrevNumber(value)}</Text>
      {tier >= 2 && <Icon name="sparkles" size={9} color={pal[2]} />}
    </View>
  );
}

export function RoomSupportBadges({ roomId, userId }: { roomId?: string; userId?: string }) {
  const { data } = useQuery({
    queryKey: ["room-support-badges", roomId, userId],
    queryFn: () => apiRoomSupportBadges(roomId!, userId!),
    enabled: !!roomId && !!userId,
  });
  const sent = Number(data?.sent || 0);
  const received = Number(data?.received || 0);
  if (sent <= 0 && received <= 0) return null;
  return (
    <>
      <Badge kind="trophy" value={sent} testID="room-badge-sent" />
      <Badge kind="star" value={received} testID="room-badge-received" />
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 24, borderRadius: 12, overflow: "hidden", borderWidth: 1,
    flexDirection: "row", alignItems: "center", gap: 4, paddingStart: 2, paddingEnd: 8,
  },
  iconDisc: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  text: { color: "#FFFFFF", fontSize: 11, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } },
});
