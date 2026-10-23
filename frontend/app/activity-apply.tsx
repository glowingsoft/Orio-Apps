import { useState } from "react";
import { pickAndCrop } from "@/src/media/ImageCropper";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Linking } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Icon from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import { apiRoomEventApply } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { ScreenHeader } from "@/src/cosmetics/ui";

const MAX_NAME = 20;

export default function ActivityApply() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { lang, isRTL } = useI18n();
  const ar = lang === "ar";
  const [image, setImage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [y, setY] = useState("");
  const [m, setM] = useState("");
  const [d, setD] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [permBlocked, setPermBlocked] = useState(false);
  const [done, setDone] = useState(false);

  const dateValid = (() => {
    const yy = Number(y), mm = Number(m), dd = Number(d);
    if (y.length !== 4 || !mm || !dd || mm > 12) return false;
    const dt = new Date(Date.UTC(yy, mm - 1, dd));
    return dt.getUTCMonth() === mm - 1 && dt.getUTCDate() === dd;
  })();
  const ready = !!image && name.trim().length > 0 && name.length <= MAX_NAME && dateValid && !busy;

  const pick = async () => {
    setErr(null);
    const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
    let granted = cur.granted;
    if (!granted) {
      if (!cur.canAskAgain) { setPermBlocked(true); return; }
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      granted = req.granted;
      if (!granted) { setPermBlocked(!req.canAskAgain); return; }
    }
    setPermBlocked(false);
    const res = await pickAndCrop({ aspect: [16, 9], base64: true });
    if (res.canceled) return;
    const a = res.assets?.[0];
    if (!a) return;
    if (a.base64) setImage(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
    else if (a.uri?.startsWith("data:")) setImage(a.uri);
  };

  const submit = async () => {
    if (!ready || !image) return;
    setBusy(true); setErr(null);
    try {
      const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      await apiRoomEventApply({ name: name.trim(), date, image_url: image });
      qc.invalidateQueries({ queryKey: ["room-events"] });
      setDone(true);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("ROOM_REQUIRED")) setErr(ar ? "يجب أن تمتلك غرفة لتقديم نشاط." : "You need to own a room to apply for an activity.");
      else if (msg.includes("DATE_IN_PAST")) setErr(ar ? "لا يمكن اختيار تاريخ في الماضي." : "The date cannot be in the past.");
      else setErr(msg || (ar ? "فشل الإرسال" : "Submission failed"));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <View style={styles.container} testID="activity-apply-done">
        <ScreenHeader testID="activity-apply" title={ar ? "طلب نشاط" : "Activity Application"} />
        <View style={styles.center}>
          <Icon name="checkmark-circle" size={64} color={colors.success} />
          <Text style={styles.doneText}>
            {ar ? "تم إرسال طلب النشاط الخاص بك بنجاح. ستقوم الإدارة بمراجعته." : "Your activity application was submitted successfully. The administration will review it."}
          </Text>
          <Pressable testID="activity-apply-back" onPress={() => router.back()} style={[styles.confirm, { alignSelf: "stretch" }]}>
            <Text style={styles.confirmText}>{ar ? "حسناً" : "OK"}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const align = { textAlign: (isRTL ? "right" : "left") as "right" | "left" };
  return (
    <View style={styles.container} testID="activity-apply-screen">
      <ScreenHeader testID="activity-apply" title={ar ? "طلب نشاط" : "Activity Application"} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        <View>
          <Text style={styles.label}>{ar ? "صورة النشاط" : "Activity Image"}</Text>
          <Pressable testID="activity-image" onPress={pick} style={styles.imageBox}>
            {image ? (
              <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={{ alignItems: "center", gap: 6 }}>
                <Icon name="image-outline" size={32} color={colors.muted} />
                <Text style={styles.hint}>{ar ? "اضغط لرفع صورة" : "Tap to upload an image"}</Text>
              </View>
            )}
          </Pressable>
          {permBlocked && (
            <View style={styles.permRow}>
              <Text style={[styles.hint, { flex: 1 }]}>{ar ? "اسمح بالوصول إلى الصور لاختيار صورة النشاط." : "Allow photo access to choose an activity image."}</Text>
              <Pressable testID="open-settings" onPress={() => Linking.openSettings()} style={styles.settingsBtn}>
                <Text style={styles.settingsText}>{ar ? "فتح الإعدادات" : "Open Settings"}</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View>
          <Text style={styles.label}>{ar ? "اسم النشاط" : "Activity Name"}</Text>
          <TextInput
            testID="activity-name"
            value={name}
            onChangeText={(v) => setName(v.slice(0, MAX_NAME))}
            maxLength={MAX_NAME}
            placeholder={ar ? "أدخل اسم النشاط" : "Enter activity name"}
            placeholderTextColor={colors.muted}
            style={[styles.input, align]}
          />
          <Text style={styles.counter}>{`${name.length}/${MAX_NAME}`}</Text>
        </View>

        <View>
          <Text style={styles.label}>{ar ? "تاريخ النشاط" : "Activity Date"}</Text>
          <View style={styles.dateRow}>
            <TextInput testID="activity-day" value={d} onChangeText={(v) => setD(v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" maxLength={2} placeholder={ar ? "اليوم" : "Day"} placeholderTextColor={colors.muted} style={[styles.input, styles.dateInput]} />
            <TextInput testID="activity-month" value={m} onChangeText={(v) => setM(v.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" maxLength={2} placeholder={ar ? "الشهر" : "Month"} placeholderTextColor={colors.muted} style={[styles.input, styles.dateInput]} />
            <TextInput testID="activity-year" value={y} onChangeText={(v) => setY(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" maxLength={4} placeholder={ar ? "السنة" : "Year"} placeholderTextColor={colors.muted} style={[styles.input, styles.dateInput]} />
          </View>
        </View>

        {err ? <Text style={styles.err} testID="activity-apply-error">{err}</Text> : null}

        <Pressable testID="activity-confirm" disabled={!ready} onPress={submit} style={[styles.confirm, !ready && styles.confirmDisabled]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <Text style={[styles.confirmText, !ready && { color: colors.muted }]}>{ar ? "تأكيد الطلب" : "Confirm Application"}</Text>
          )}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  doneText: { color: colors.onSurface, fontSize: 15, fontWeight: "700", textAlign: "center", lineHeight: 22 },
  label: { color: colors.onSurface, fontSize: 14, fontWeight: "800", marginBottom: spacing.sm },
  imageBox: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  hint: { color: colors.muted, fontSize: 12 },
  permRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  settingsBtn: { borderWidth: 1, borderColor: colors.gold, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  settingsText: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  input: { backgroundColor: colors.surfaceSecondary, color: colors.onSurface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, height: 48, fontSize: 15 },
  counter: { color: colors.muted, fontSize: 11, marginTop: 4, alignSelf: "flex-end" },
  dateRow: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
  dateInput: { flex: 1, flexBasis: 0, minWidth: 0, width: undefined, paddingHorizontal: 4, textAlign: "center" },
  err: { color: colors.error, fontSize: 13, fontWeight: "600" },
  confirm: { backgroundColor: colors.gold, borderRadius: radius.pill, height: 50, alignItems: "center", justifyContent: "center" },
  confirmDisabled: { backgroundColor: colors.surfaceTertiary },
  confirmText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900" },
});
