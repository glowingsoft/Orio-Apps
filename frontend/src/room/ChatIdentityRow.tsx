/**
 * Room chat identity: avatar, then the username DIRECTLY beside it (same
 * row, mirrored natively for Arabic RTL / English LTR), the user's VIP ·
 * Wealth · Charm levels beneath. No role head icons.
 */
import React, { useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import Icon from "@react-native-vector-icons/ionicons";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { VipBadge } from "@/src/components/VipBadge";
import { VipName } from "@/src/components/VipName";
import { LevelBadgeChip } from "@/src/levels/badges";
import { colors } from "@/src/theme";

export function ChatIdentityRow({ user, text, isRTL, onOpen, renderText, testID, content }: {
  user: any; text: string; isRTL: boolean;
  onOpen: (uid: string) => void; renderText?: (t: string) => React.ReactNode; testID?: string;
  /** Batch B — custom body (e.g. animated emoji) shown instead of the text bubble. */
  content?: React.ReactNode;
}) {
  const uid = user?.id;
  const [copyOpen, setCopyOpen] = useState(false);
  useEffect(() => {
    if (!copyOpen) return;
    const t = setTimeout(() => setCopyOpen(false), 3500);
    return () => clearTimeout(t);
  }, [copyOpen]);
  return (
    <View style={[styles.row, { flexDirection: "row" }]}>
      <Pressable onPress={() => uid && onOpen(uid)} hitSlop={4}>
        {user?.avatar_url ? (
          <Image source={user.avatar_url} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.surfaceTertiary }]} />
        )}
      </Pressable>
      {/* alignItems flex-start = the avatar side in BOTH directions (RN mirrors
          start/end natively), so the name always sits right next to the avatar. */}
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        <View style={styles.nameRow}>
          <Pressable onPress={() => uid && onOpen(uid)}>
            <VipName testID={testID} style={styles.name} numberOfLines={1} name={user?.nickname || "User"} vipLevel={user?.vip_level ?? 0} />
          </Pressable>
        </View>
        <View style={styles.levels}>
          {Number(user?.vip_level ?? 0) > 0 && <VipBadge level={user.vip_level} size="sm" />}
          <LevelBadgeChip size="sm" sys="wealth" level={Math.max(1, Number(user?.wealth_level ?? 0))} />
          {Number(user?.charm_level ?? 0) >= 1 && <LevelBadgeChip size="sm" sys="charm" level={Number(user.charm_level)} />}
        </View>
        {/* Long-press → small "Copy" pill right beside the message. */}
        {content ? (
          <View style={{ marginTop: 2 }}>{content}</View>
        ) : (
        <View style={styles.bubbleRow}>
          <Pressable onLongPress={() => setCopyOpen(true)} delayLongPress={350} style={styles.bubble} testID={testID ? `${testID}-bubble` : undefined}>
            <Text style={[styles.text, { writingDirection: isRTL ? "rtl" : "ltr" }]}>{renderText ? renderText(text) : text}</Text>
          </Pressable>
          {copyOpen && (
            <Pressable
              testID="room-msg-copy"
              onPress={() => { Clipboard.setStringAsync(text || "").catch(() => {}); setCopyOpen(false); }}
              style={styles.copyPill}
            >
              <Icon name="copy-outline" size={13} color="#111114" />
              <Text style={styles.copyText}>{isRTL ? "نسخ" : "Copy"}</Text>
            </Pressable>
          )}
        </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, alignItems: "flex-start", paddingVertical: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  name: { color: colors.gold, fontWeight: "800", fontSize: 13, maxWidth: 180 },
  levels: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, flexWrap: "wrap" },
  bubble: { marginTop: 4, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "95%", flexShrink: 1 },
  text: { color: "#FFFFFF", fontSize: 13, lineHeight: 18 },
  bubbleRow: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
  copyPill: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: "#FFFFFF", elevation: 4 },
  copyText: { color: "#111114", fontSize: 12, fontWeight: "800" },
  nameRow: { flexDirection: "row", alignItems: "center", minHeight: 18 },
});
