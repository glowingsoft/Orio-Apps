/**
 * Iter-121 — the single ORIO room card (Rooms list + Profile "User Room").
 * Horizontally extended purple card; circular room image at the start edge
 * (mirrors RTL/LTR); name + owner's circular flag beside it; category; and a
 * subtle glass badge with the REAL live participant count (socket presence).
 */
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n } from "@/src/i18n";
import { CountryFlag } from "@/src/components/CountryFlag";
import { spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";
import { openRoom, isRoomGated } from "@/src/room/RoomLockGate";

const CAT: Record<string, { en: string; ar: string; icon: string }> = {
  chat:  { en: "Chat",  ar: "دردشة",  icon: "chatbubbles" },
  pk:    { en: "PK",    ar: "PK",     icon: "flash" },
  music: { en: "Music", ar: "موسيقى", icon: "musical-notes" },
  games: { en: "Games", ar: "ألعاب",  icon: "game-controller" },
  cp:    { en: "CP",    ar: "CP",     icon: "heart" },
};

export function RoomCard({ room, testID, pk }: { room: any; testID?: string; pk?: boolean }) {
  const router = useRouter();
  const { isRTL } = useI18n();
  const { user } = useAuth();
  // Password / PIN rooms stay visible in discovery but dimmed with a lock.
  const locked = !!(room?.is_locked || room?.has_room_password);
  const gated = isRoomGated(room, user?.id);
  const key = pk ? "pk" : String(room?.category || "chat").toLowerCase();
  const cat = CAT[key] || CAT.chat;
  const live = Number(room?.live_count ?? 0);
  const ownerFlag = room?.owner?.country_flag || room?.country_flag;
  // Iter-122 — natural mirroring: image at the start edge (left in English LTR,
  // right in Arabic RTL) with ALL info beside it.
  const image = (
    <View style={styles.imgWrap}>
      <Image source={room?.cover_url} style={styles.img} contentFit="cover" />
    </View>
  );
  const info = (
    <View style={styles.info}>
      <View style={styles.nameRow}>
        {/* Room names are ALWAYS plain white on a semi-transparent black plate (no VIP colours). */}
        <View style={styles.namePlate}>
          <Text testID={testID ? `${testID}-name` : undefined} style={styles.name} numberOfLines={1}>{room?.name}</Text>
        </View>
        {(!!ownerFlag || !!room?.country_code) && (
          <CountryFlag testID={testID ? `${testID}-flag` : undefined} code={room?.country_code} flag={ownerFlag} size={18} />
        )}
        {locked && (
          <Icon testID={testID ? `${testID}-lock` : undefined} name="lock-closed" size={14} color="#FFFFFF" />
        )}
        {room?.is_test && (
          <View style={styles.testTag} testID={testID ? `${testID}-test` : undefined}>
            <Text style={styles.testTagText}>TEST</Text>
          </View>
        )}
      </View>
      <View style={styles.catBadge} testID={testID ? `${testID}-category` : undefined}>
        <Icon name={cat.icon as any} size={11} color="#FFFFFF" />
        <Text style={styles.catText}>{isRTL ? cat.ar : cat.en}</Text>
      </View>
      <View style={styles.liveBadge} testID={testID ? `${testID}-live` : undefined}>
        <Icon name="people" size={9} color="rgba(255,255,255,0.85)" />
        <Text style={styles.liveText}>{live.toLocaleString("en-US")}</Text>
      </View>
    </View>
  );
  return (
    <Pressable
      testID={testID}
      onPress={() => openRoom(router, room, user?.id)}
      style={({ pressed }) => [styles.card, gated && styles.dimmed, pressed && { opacity: gated ? 0.45 : 0.88 }]}
    >
      <LinearGradient colors={["#3B1C78", "#24104F", "#160A33"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {image}
      {info}
    </Pressable>
  );
}

// Fixed palette: purple card + white text identical in every theme by spec.
const styles = StyleSheet.create({
  card: {
    height: 88, borderRadius: radius.lg, overflow: "hidden",
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: "rgba(167,139,250,0.28)",
  },
  dimmed: { opacity: 0.55 },
  imgWrap: { width: 64, height: 64, borderRadius: 32, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)" },
  img: { width: "100%", height: "100%" },
  info: { flex: 1, justifyContent: "center", gap: 4, alignItems: "flex-start" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "stretch" },
  name: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  namePlate: { flexShrink: 1 },
  catBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(139,92,246,0.55)", borderRadius: radius.pill,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  catText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(255,255,255,0.10)", borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.28)",
    paddingHorizontal: 7, paddingVertical: 1,
  },
  liveText: { color: "rgba(255,255,255,0.9)", fontSize: 9, fontWeight: "700" },
  // Internal TEST-data marker (seed_test_data.py) — only test accounts/admins ever see these rooms.
  testTag: { backgroundColor: "#F59E0B", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  testTagText: { color: "#1A1000", fontSize: 8, fontWeight: "900" },
});
