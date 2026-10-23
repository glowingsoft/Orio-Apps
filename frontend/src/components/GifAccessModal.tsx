/**
 * VIP4 animated-GIF access modal (shown to users without GIF access).
 * • Unlock VIP4 → VIP Center
 * • Buy GIF Access — 7 Days / 19,999 Diamonds → "Friendly Reminder!" Yes/No
 *   → server deducts exactly 19,999 💎 (idempotent request_id) and grants
 *   7 days from the server purchase timestamp.
 */
import React, { useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { apiBuyGifAccess } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius } from "@/src/theme";

// Sample animated avatar (public demo GIF) + fictional username.
const SAMPLE_GIF = "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExa2Z0eGx0b3R6d3Q2bmV4b2Z0c2V2dWZ0cHNtd2V6N2c5a3d6aTRvdCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ICOgUNjpvO0PC/giphy.gif";

export function GifAccessModal({ visible, onClose, isRTL }: { visible: boolean; onClose: () => void; isRTL: boolean }) {
  const router = useRouter();
  const { refresh } = useAuth() as any;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const reqId = useRef<string>("");
  const close = () => { setConfirm(false); setMsg(null); onClose(); };

  const buy = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    // Same request id for retries of THIS confirmation → no double charge.
    if (!reqId.current) reqId.current = `gif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      await apiBuyGifAccess(reqId.current);
      reqId.current = "";
      await refresh?.();
      setConfirm(false);
      setMsg({ ok: true, text: isRTL ? "تم تفعيل صلاحية GIF لمدة 7 أيام!" : "GIF access activated for 7 days!" });
    } catch (e: any) {
      const m = String(e?.message || "");
      reqId.current = "";
      setConfirm(false);
      setMsg({ ok: false, text: /insufficient/i.test(m) ? (isRTL ? "رصيد الماس غير كافٍ" : "Not enough diamonds")
        : /ALREADY/i.test(m) ? (isRTL ? "لديك صلاحية GIF مفعّلة بالفعل" : "You already have GIF access") : (m || "Failed") });
    } finally { setBusy(false); }
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={close}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={s.card} testID="gif-access-modal">
          <Pressable onPress={close} style={s.close} hitSlop={10} testID="gif-access-close">
            <Icon name="close" size={22} color={colors.muted} />
          </Pressable>
          {confirm ? (
            <>
              <Text style={s.title}>{isRTL ? "تذكير ودي!" : "Friendly Reminder!"}</Text>
              <Text style={s.body} testID="gif-access-confirm-text">
                {isRTL ? "هل أنت متأكد أنك تريد شراء صلاحية GIF لمدة 7 أيام مقابل 19,999 ماسة؟" : "Are you sure you want to purchase 7 days of GIF access for 19,999 Diamonds?"}
              </Text>
              <View style={s.row}>
                <Pressable onPress={() => setConfirm(false)} style={[s.btn, s.btnGhost]} testID="gif-access-no">
                  <Text style={s.btnGhostText}>{isRTL ? "لا" : "No"}</Text>
                </Pressable>
                <Pressable onPress={buy} disabled={busy} style={[s.btn, s.btnGold]} testID="gif-access-yes">
                  {busy ? <ActivityIndicator color="#1A1000" /> : <Text style={s.btnGoldText}>{isRTL ? "نعم" : "Yes"}</Text>}
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={s.sample}>
                <Image source={SAMPLE_GIF} style={s.sampleAvatar} contentFit="cover" autoplay />
                <Text style={s.sampleName}>✨ Luna_Star ✨</Text>
              </View>
              <Text style={s.title} testID="gif-access-title">{isRTL ? "افتح VIP4 لاستخدام الصور الرمزية المتحركة!" : "Unlock VIP4 to use animated GIF avatars!"}</Text>
              {msg && <Text style={[s.msg, { color: msg.ok ? colors.success : colors.error }]} testID="gif-access-msg">{msg.text}</Text>}
              <Pressable onPress={() => { close(); router.push("/vip" as any); }} style={[s.btnFull, s.btnPurple]} testID="gif-access-unlock-vip4">
                <Text style={s.btnPurpleText}>{isRTL ? "افتح VIP4 وتميّز!" : "Unlock VIP4 and stand out!"}</Text>
              </Pressable>
              <Pressable onPress={() => { setMsg(null); setConfirm(true); }} style={[s.btnFull, s.btnGold]} testID="gif-access-buy">
                <Text style={s.btnGoldText}>{isRTL ? "شراء صلاحية GIF — 7 أيام / 19,999 ماسة" : "Buy GIF Access — 7 Days / 19,999 Diamonds"}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { width: "100%", maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", gap: spacing.md },
  close: { position: "absolute", top: 10, end: 10, width: 36, height: 36, alignItems: "center", justifyContent: "center", zIndex: 2 },
  sample: { alignItems: "center", gap: 6, marginTop: spacing.sm },
  sampleAvatar: { width: 92, height: 92, borderRadius: 46, borderWidth: 3, borderColor: colors.gold },
  sampleName: { color: colors.onSurface, fontWeight: "900", fontSize: 15 },
  title: { color: colors.onSurface, fontSize: 17, fontWeight: "900", textAlign: "center" },
  body: { color: colors.onSurfaceSecondary, fontSize: 14, textAlign: "center", lineHeight: 21 },
  msg: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  row: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
  btn: { flex: 1, height: 46, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  btnFull: { alignSelf: "stretch", minHeight: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  btnPurple: { backgroundColor: colors.brandPrimary },
  btnPurpleText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14 },
  btnGold: { backgroundColor: "#F5C542" },
  btnGoldText: { color: "#1A1000", fontWeight: "900", fontSize: 13, textAlign: "center" },
  btnGhost: { backgroundColor: colors.surfaceSecondary },
  btnGhostText: { color: colors.onSurface, fontWeight: "800" },
});
