/**
 * My Bag → Entrance Effects: premium centered modal for a VIP entrance.
 * Large artwork · play icon (preview with sound) · Wear / Unequip, or
 * "Expired" when the VIP eligibility has lapsed.
 */
import React, { useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/theme";
import { ENTRANCE_EFFECTS } from "@/src/entrance/effects";
import { InlineEntrance } from "@/src/entrance/EntranceOverlay";
import { shade } from "@/src/vip/vipAssets";

export function PlayBadge({ onPress, color, testID, size = 30 }: { onPress: () => void; color: string; testID?: string; size?: number }) {
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={10}
      style={[styles.play, { width: size, height: size, borderRadius: size / 2, borderColor: color }]}>
      <Icon name="play" size={size * 0.48} color="#FFFFFF" style={{ marginStart: 2 }} />
    </Pressable>
  );
}

export function EntranceRewardModal({ item, onClose, onToggle, busy }: {
  item: any | null; onClose: () => void; onToggle: () => void; busy?: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [preview, setPreview] = useState<string | null>(null);
  const [art, setArt] = useState({ w: 0, h: 0 });
  const fx = item ? ENTRANCE_EFFECTS[item.effect_key] : null;
  if (!item || !fx) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="entrance-modal-backdrop">
        <Pressable style={[styles.modal, { borderColor: fx.accent + "66" }]} onPress={() => {}} testID="entrance-modal">
          <Pressable onPress={onClose} hitSlop={10} style={styles.close} testID="entrance-modal-close">
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
          <LinearGradient colors={[shade(fx.tint, 0.5), shade(fx.tint, 0.12)]} style={styles.art} onLayout={(e) => setArt({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            {preview ? (
              <InlineEntrance effectKey={preview} width={art.w} height={art.h} onDone={() => setPreview(null)} />
            ) : (
              <>
                <Image source={fx.thumb} style={styles.artImg} contentFit="contain" testID="entrance-modal-image" />
                <View style={styles.playCorner}>
                  <PlayBadge testID="entrance-modal-play" color={fx.accent} onPress={() => setPreview(fx.key)} size={36} />
                </View>
              </>
            )}
          </LinearGradient>
          <Text style={styles.name} testID="entrance-modal-name">{ar ? fx.name_ar : fx.name_en}</Text>
          <Text style={[styles.sub, { color: fx.accent }]}>{ar ? `مكافأة VIP${fx.vip}` : `VIP${fx.vip} Reward`}</Text>
          {item.expired ? (
            <View style={[styles.btn, styles.btnExpired]} testID="entrance-modal-expired">
              <Icon name="time-outline" size={16} color={colors.muted} />
              <Text style={[styles.btnText, { color: colors.muted }]}>{ar ? "منتهي" : "Expired"}</Text>
            </View>
          ) : (
            <Pressable testID={item.equipped ? "entrance-modal-unequip" : "entrance-modal-wear"} disabled={busy} onPress={onToggle}
              style={[styles.btn, item.equipped ? styles.btnGhost : { backgroundColor: colors.brandPrimary }]}>
              {busy ? <ActivityIndicator color={item.equipped ? colors.onSurface : colors.onBrandPrimary} /> : (
                <>
                  <Icon name={item.equipped ? "remove-circle-outline" : "shirt-outline"} size={16} color={item.equipped ? colors.onSurface : colors.onBrandPrimary} />
                  <Text style={[styles.btnText, { color: item.equipped ? colors.onSurface : colors.onBrandPrimary }]}>
                    {item.equipped ? (ar ? "إزالة" : "Unequip") : (ar ? "ارتداء" : "Wear")}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  modal: { width: "100%", maxWidth: 340, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.lg, alignItems: "center", gap: spacing.sm, borderWidth: 1 },
  close: { position: "absolute", top: 10, end: 10, zIndex: 2, width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  art: { width: "100%", aspectRatio: 1, borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center", marginTop: spacing.lg },
  artImg: { width: "88%", height: "88%" },
  playCorner: { position: "absolute", bottom: 10, end: 10 },
  // Fixed: glassy dark disc over artwork.
  play: { backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  name: { color: colors.onSurface, fontSize: 18, fontWeight: "800", marginTop: spacing.xs },
  sub: { fontSize: 12, fontWeight: "700" },
  btn: { alignSelf: "stretch", height: 48, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: spacing.sm },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnExpired: { backgroundColor: colors.surfaceSecondary },
  btnText: { fontSize: 15, fontWeight: "800" },
});
