/**
 * Full-screen dark preview of an entrance clip WITH sound.
 * Never equips anything and never touches a room.
 */
import React from "react";
import { Modal, View, Pressable, Text, StyleSheet, useWindowDimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n } from "@/src/i18n";
import { ENTRANCE_EFFECTS, EntranceFx } from "@/src/entrance/effects";
import { shade } from "@/src/vip/vipAssets";

export function EntrancePreviewModal({ effectKey, onClose }: { effectKey: string | null; onClose: () => void }) {
  const fx = effectKey ? ENTRANCE_EFFECTS[effectKey] : null;
  if (!fx) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <PreviewBody fx={fx} onClose={onClose} />
    </Modal>
  );
}

function PreviewBody({ fx, onClose }: { fx: EntranceFx; onClose: () => void }) {
  const { lang } = useI18n();
  const { width, height } = useWindowDimensions();
  const player = useVideoPlayer(fx.preview, (p) => { p.loop = false; p.muted = false; p.volume = 1; p.play(); });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const w = Math.min(width - 32, (height * 0.72) * 9 / 16);
  const replay = () => player.replay();
  return (
    <View style={styles.backdrop} testID="entrance-preview">
      <View style={[styles.frame, { width: w, height: w * 16 / 9, borderColor: fx.accent + "88", shadowColor: fx.tint }]}>
        <View style={StyleSheet.absoluteFill}>
          <VideoView testID="entrance-preview-video" player={player} style={{ width: "100%", height: "100%" }} contentFit="contain" nativeControls={false} />
        </View>
        {status === "loading" && <View style={styles.center}><Icon name="hourglass-outline" size={28} color={fx.accent} /></View>}
        {status === "readyToPlay" && !isPlaying && (
          <Pressable testID="entrance-preview-replay" onPress={replay} style={styles.center}>
            <View style={[styles.replay, { borderColor: fx.accent }]}><Icon name="play" size={30} color="#FFFFFF" /></View>
          </Pressable>
        )}
      </View>
      <LinearGradient colors={[shade(fx.tint, 0.55), fx.tint, shade(fx.tint, 0.55)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.title, { borderColor: fx.accent }]}>
        <Text style={styles.titleText}>{`VIP${fx.vip} · ${lang === "ar" ? fx.name_ar : fx.name_en}`}</Text>
      </LinearGradient>
      <Pressable testID="entrance-preview-close" onPress={onClose} hitSlop={10} style={styles.close}>
        <Icon name="close" size={22} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

// Fixed cinematic palette (always dark, independent of app theme).
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", gap: 16 },
  frame: {
    borderRadius: 20, overflow: "hidden", borderWidth: 1, backgroundColor: "#000000",
    shadowOpacity: 0.8, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 12,
  },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  replay: { width: 64, height: 64, borderRadius: 32, borderWidth: 1.5, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  title: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  titleText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", letterSpacing: 0.5, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  close: { position: "absolute", top: 48, end: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
});
