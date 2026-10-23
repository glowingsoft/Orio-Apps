/**
 * Iter-117 — global Wealth/Charm level-up celebration popup.
 * Polls the server-authoritative /me/levels and compares with the last level
 * seen on this device (per account). Mounted at the root so it also appears
 * inside rooms and private chats.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet, AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth-context";
import { apiMyLevels } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { LevelBadgeImage, type LevelSys } from "@/src/levels/badges";
import { colors, spacing, radius } from "@/src/theme";

const KEY = (uid: string) => `orio_seen_levels_${uid}`;

export function LevelUpWatcher() {
  const { user } = useAuth();
  const router = useRouter();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [queue, setQueue] = useState<{ sys: LevelSys; level: number }[]>([]);
  const busy = useRef(false);

  useEffect(() => {
    if (!user?.id || !user.profile_completed) return;
    const uid = user.id;
    const check = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const lv = await apiMyLevels();
        const now = { wealth: Number(lv?.wealth?.level || 0), charm: Number(lv?.charm?.level || 0) };
        const raw = await AsyncStorage.getItem(KEY(uid));
        const seen = raw ? JSON.parse(raw) : null;
        if (seen) {
          const ups: { sys: LevelSys; level: number }[] = [];
          (["wealth", "charm"] as LevelSys[]).forEach((s) => { if (now[s] > Number(seen[s] || 0)) ups.push({ sys: s, level: now[s] }); });
          if (ups.length) setQueue((q) => [...q, ...ups]);
        }
        await AsyncStorage.setItem(KEY(uid), JSON.stringify(now));
      } catch { /* offline — retry next tick */ }
      busy.current = false;
    };
    void check();
    const h = setInterval(check, 12_000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void check(); });
    return () => { clearInterval(h); sub.remove(); };
  }, [user?.id, user?.profile_completed]);

  const cur = queue[0];
  if (!cur) return null;
  const sysName = cur.sys === "wealth" ? (ar ? "الثروة" : "Wealth") : (ar ? "الجاذبية" : "Charm");
  const msg = ar ? `تهانينا لوصولك إلى مستوى ${sysName} LV ${cur.level}` : `Congratulations on reaching ${sysName} LV ${cur.level}`;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setQueue((q) => q.slice(1))}>
      <Pressable style={styles.overlay} onPress={() => setQueue((q) => q.slice(1))} testID="level-up-popup">
        <View style={[styles.card, { borderColor: cur.sys === "wealth" ? "#F2C94C" : "#60A5FA" }]}>
          <LevelBadgeImage sys={cur.sys} level={cur.level} size={140} />
          <Text style={styles.msg} testID="level-up-text">{msg}</Text>
          <Pressable testID="level-up-details" onPress={() => {
            setQueue((q) => q.slice(1));
            router.push(`/level?sys=${cur.sys}&lv=${cur.level}` as any);
          }} style={styles.btn}>
            <Text style={styles.btnText}>{ar ? "عرض التفاصيل" : "View Details"}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 340, alignItems: "center", gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1.5, backgroundColor: colors.surface },
  msg: { color: colors.onSurface, fontSize: 18, fontWeight: "900", textAlign: "center", lineHeight: 26 },
  btn: { minWidth: 140, height: 46, borderRadius: radius.pill, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  btnText: { color: colors.onBrandPrimary, fontWeight: "900" },
});
