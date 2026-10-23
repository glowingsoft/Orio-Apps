/**
 * Iter-118 — full-screen ban notice with a server-synchronised countdown.
 * Shown whenever the API returns 403 BANNED. "فهمت" clears the local session.
 */
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal } from "react-native";
import { onBan, emitBan, type BanInfo } from "@/src/auth/device";
import { useAuth } from "@/src/auth-context";
import { setAccessToken } from "@/src/api";
import { setRefreshToken } from "@/src/auth/storage";
import Icon from "@react-native-vector-icons/ionicons";
import { colors, spacing, radius } from "@/src/theme";

function remainingMs(b: BanInfo, now: number) {
  if (!b.expires_at) return null;
  // Server-synchronised: offset local clock by the server's "now" at receipt.
  const skew = new Date(b.server_now).getTime() - b.receivedAt;
  return Math.max(0, new Date(b.expires_at).getTime() - (now + skew));
}

export function BanScreen() {
  const [ban, setBan] = useState<BanInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  const { user } = useAuth();
  useEffect(() => onBan(setBan), []);
  useEffect(() => {
    if (!ban) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [ban]);
  if (!ban) return null;
  const ms = remainingMs(ban, now);
  const s = ms == null ? 0 : Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const units = [
    { v: s > 9 * 86400 ? "9+" : String(d), l: "يوم" },
    { v: String(h).padStart(2, "0"), l: "ساعة" },
    { v: String(m).padStart(2, "0"), l: "دقيقة" },
    { v: String(sec).padStart(2, "0"), l: "ثانية" },
  ];
  const ok = async () => {
    setAccessToken(null);
    await setRefreshToken(null);
    emitBan(null);
    if (user) { /* auth context resolves to signed-out on next refresh */ }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.overlay} testID="ban-screen">
        <View style={styles.card}>
          <Icon name="ban-outline" size={44} color={colors.error} />
          <Text style={styles.msg} testID="ban-message">{ban.message}</Text>
          {ban.permanent || ms == null ? (
            <Text style={styles.perm} testID="ban-permanent">حظر دائم</Text>
          ) : (
            <View style={styles.row} testID="ban-countdown">
              {units.map((u) => (
                <View key={u.l} style={styles.unit}>
                  <Text style={styles.unitV}>{u.v}</Text>
                  <Text style={styles.unitL}>{u.l}</Text>
                </View>
              ))}
            </View>
          )}
          <Pressable testID="ban-ok" onPress={ok} style={styles.btn}>
            <Text style={styles.btnText}>فهمت</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: spacing.lg, borderWidth: 1, borderColor: colors.error },
  msg: { color: colors.onSurface, fontSize: 17, fontWeight: "800", textAlign: "center", lineHeight: 26 },
  perm: { color: colors.error, fontSize: 18, fontWeight: "900" },
  row: { flexDirection: "row-reverse", gap: spacing.sm },
  unit: { minWidth: 62, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  unitV: { color: colors.onSurface, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  unitL: { color: colors.muted, fontSize: 11, marginTop: 2 },
  btn: { minWidth: 160, height: 48, borderRadius: radius.pill, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  btnText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 16 },
});
