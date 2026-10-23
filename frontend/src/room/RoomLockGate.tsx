/**
 * Room Locked gate — 5-digit PIN / Room Password entry. The backend is the
 * only authority: /rooms/{id}/join verifies the code (bcrypt) and records a
 * short-lived grant; the room socket + voice token refuse anyone without it.
 */
import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { apiJoinRoomWithCode } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

type LockTarget = { id: string; name?: string };
let listener: ((r: LockTarget) => void) | null = null;

export function requestRoomUnlock(r: LockTarget) { listener?.(r); }

export function isRoomGated(room: any, myId?: string | null) {
  if (!room || !(room.is_locked || room.has_room_password)) return false;
  if (myId && (room.owner_id === myId || room.owner?.id === myId || (room.moderators || []).includes(myId))) return false;
  return true;
}

/** Open a room from discovery: locked rooms show the PIN modal first. */
export function openRoom(router: any, room: any, myId?: string | null) {
  if (isRoomGated(room, myId)) requestRoomUnlock({ id: room.id, name: room.name });
  else router.push(`/room/${room.id}` as any);
}

export function RoomLockHost() {
  const router = useRouter();
  const { isRTL } = useI18n();
  const [target, setTarget] = useState<LockTarget | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    listener = (r) => { setTarget(r); setCode(""); setErr(null); };
    return () => { listener = null; };
  }, []);

  const close = () => { setTarget(null); setCode(""); setErr(null); };

  const submit = async (c: string) => {
    if (!target || c.length !== 5 || busy) return;
    setBusy(true); setErr(null);
    try {
      await apiJoinRoomWithCode(target.id, c);
      const id = target.id;
      close();
      router.push(`/room/${id}` as any);
    } catch (e: any) {
      const m = String(e?.message || "");
      setErr(/too many/i.test(m)
        ? (isRTL ? "محاولات كثيرة خاطئة، حاول لاحقًا" : "Too many wrong attempts — try again later")
        : (isRTL ? "رمز غير صحيح" : "Incorrect code"));
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.card} onPress={() => inputRef.current?.focus()} testID="room-locked-modal">
          <View style={styles.lockIcon}><Icon name="lock-closed" size={26} color={colors.brandPrimary} /></View>
          <Text style={styles.title}>{isRTL ? "الغرفة مقفلة" : "Room Locked"}</Text>
          {!!target?.name && <Text style={styles.sub} numberOfLines={1}>{target.name}</Text>}
          <Text style={styles.sub}>{isRTL ? "أدخل الرمز المكوّن من 5 أرقام" : "Enter the 5-digit code"}</Text>
          <View style={styles.boxes}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={[styles.box, code.length === i && styles.boxActive, !!err && styles.boxErr]} testID={`pin-box-${i}`}>
                <Text style={styles.digit}>{code[i] ? "•" : ""}</Text>
              </View>
            ))}
          </View>
          <TextInput
            ref={inputRef}
            testID="room-pin-input"
            value={code}
            onChangeText={(v) => {
              const d = v.replace(/\D/g, "").slice(0, 5);
              setCode(d); setErr(null);
              if (d.length === 5) submit(d);
            }}
            keyboardType="number-pad"
            maxLength={5}
            autoFocus
            style={styles.hidden}
            caretHidden
          />
          {busy ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.sm }} />
            : err ? <Text style={styles.err} testID="room-pin-error">{err}</Text> : null}
          <Pressable onPress={close} style={styles.cancel} testID="room-pin-cancel">
            <Text style={styles.cancelText}>{isRTL ? "إلغاء" : "Cancel"}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: { width: "100%", maxWidth: 340, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: "center", gap: 6 },
  lockIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { color: colors.onSurface, fontSize: 19, fontWeight: "900" },
  sub: { color: colors.muted, fontSize: 13, maxWidth: 260 },
  boxes: { flexDirection: "row", gap: 10, marginTop: spacing.md },
  box: { width: 46, height: 54, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  boxActive: { borderColor: colors.brandPrimary },
  boxErr: { borderColor: colors.error },
  digit: { color: colors.onSurface, fontSize: 26, fontWeight: "900" },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
  err: { color: colors.error, fontSize: 13, fontWeight: "700", marginTop: spacing.sm },
  cancel: { marginTop: spacing.md, paddingHorizontal: spacing.xl, height: 44, justifyContent: "center" },
  cancelText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
});
