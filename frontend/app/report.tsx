/**
 * ORIO Report Page (Iter-51 §6)
 * -----------------------------------------------------------------------------
 * Dedicated "إبلاغ" (Report) screen. Opened from the room user card Settings
 * menu. Collects:
 *   - one of 8 real report categories
 *   - up to 250 characters of description
 *   - optional image OR video attachment (<=2MB)
 * Submits to the existing /api/users/{user_id}/report endpoint, which
 * persists everything (including base64 media) to the `user_reports`
 * collection for moderation review.
 */
import { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, Linking,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { pickMedia, uploadMedia, type PickedMedia } from "@/src/media/upload";
import { Image } from "expo-image";
import { apiReportUser, apiReportRoom, apiReportPost, apiReportComment } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius } from "@/src/theme";

type ReasonKey =
  | "illegal" | "porn" | "very_dangerous" | "fraud"
  | "insult" | "ads" | "religious_content" | "political_content";

const REASONS: { key: ReasonKey; ar: string; en: string; icon: string }[] = [
  { key: "illegal",             ar: "غير قانوني",     en: "Illegal",             icon: "warning" },
  { key: "porn",                ar: "إباحية",         en: "Pornography",         icon: "eye-off" },
  { key: "very_dangerous",      ar: "خطير جدا",       en: "Very Dangerous",      icon: "alert-circle" },
  { key: "fraud",               ar: "احتيال",         en: "Fraud",               icon: "wallet" },
  { key: "insult",              ar: "سب",             en: "Insult",              icon: "chatbox" },
  { key: "ads",                 ar: "إعلانات",        en: "Ads",                 icon: "megaphone" },
  { key: "religious_content",   ar: "محتوى ديني",     en: "Religious Content",   icon: "book" },
  { key: "political_content",   ar: "محتوى سياسي",    en: "Political Content",   icon: "flag" },
];

const MAX_DETAIL_CHARS = 250;

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { isRTL } = useI18n();
  const params = useLocalSearchParams<{ user_id?: string; room_id?: string; post_id?: string; comment_id?: string }>();
  const postId = typeof params.post_id === "string" ? params.post_id : "";
  const commentId = typeof params.comment_id === "string" ? params.comment_id : "";
  const userId = typeof params.user_id === "string" ? params.user_id : "";
  const roomId = typeof params.room_id === "string" ? params.room_id : "";

  // 1–3 reasons; a 4th can't be picked until one is deselected.
  const [reasons, setReasons] = useState<ReasonKey[]>([]);
  const toggleReason = (k: ReasonKey) => setReasons((cur) => {
    if (cur.includes(k)) return cur.filter((x) => x !== k);
    if (cur.length >= 3) {
      toast.info(isRTL ? "يمكنك اختيار 3 أسباب كحد أقصى" : "You can select up to 3 reasons");
      return cur;
    }
    return [...cur, k];
  });
  const [details, setDetails] = useState("");
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Iter-117 — evidence: up to 3 images OR 1 video (Emergent Object Storage).
  const pick = async (kind: "image" | "video") => {
    try {
      const current = media.filter((m) => m.kind === kind);
      if (kind === "image" && current.length >= 3) {
        toast.error(isRTL ? "الحد الأقصى 3 صور" : "Up to 3 images");
        return;
      }
      const res = await pickMedia(kind, kind === "image" ? 3 - current.length : 1);
      if (res === "denied") {
        toast.error(isRTL ? "صلاحية الوصول للصور مطلوبة" : "Media library permission required");
        Linking.openSettings().catch(() => {});
        return;
      }
      if (!res.length) return;
      if (kind === "video" && (res[0].duration ?? 0) > 30.5) {
        toast.error(isRTL ? "يجب ألا يتجاوز الفيديو 30 ثانية" : "Video must be 30 seconds or shorter");
        return;
      }
      // Images and video are mutually exclusive.
      setMedia(kind === "video" ? res : [...current, ...res].slice(0, 3));
    } catch (e: any) {
      toast.error(e?.message || (isRTL ? "تعذر تحميل الوسائط" : "Failed to pick media"));
    }
  };

  const submit = async () => {
    if (!userId && !roomId && !postId && !commentId) return;
    if (!reasons.length) {
      toast.error(isRTL ? "اختر سبب الإبلاغ" : "Choose a report reason");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < media.length; i++) {
        urls.push(await uploadMedia(media[i], "report", (p) => setProgress((i + p) / media.length)));
      }
      const body = { reason: reasons[0], reasons, details: details.trim(), media_urls: urls, media_kind: media[0]?.kind };
      if (roomId) await apiReportRoom(roomId, body);
      else if (commentId) await apiReportComment(commentId, body);
      else if (postId) await apiReportPost(postId, body);
      else await apiReportUser(userId, body);
      toast.success(isRTL ? "تم إرسال البلاغ. شكراً لك." : "Report submitted. Thank you.");
      setTimeout(() => router.back(), 400);
    } catch (e: any) {
      toast.error(e?.message || (isRTL ? "فشل إرسال البلاغ" : "Report failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, flexDirection: "row" }]}>
        <Pressable
          testID="report-back"
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
        >
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isRTL ? "إبلاغ" : "Report"}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>
            {isRTL ? `اختر سبب الإبلاغ (حتى 3) · ${reasons.length}/3` : `Report reasons (up to 3) · ${reasons.length}/3`}
          </Text>
          <View style={styles.reasonsGrid}>
            {REASONS.map((r) => {
              const selected = reasons.includes(r.key);
              return (
                <Pressable
                  key={r.key}
                  testID={`reason-${r.key}`}
                  onPress={() => toggleReason(r.key)}
                  style={({ pressed }) => [
                    styles.reasonTile,
                    selected && { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "22" },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Icon
                    name={r.icon as any}
                    size={16}
                    color={selected ? colors.brandPrimary : colors.onSurface}
                  />
                  <Text style={[styles.reasonText, selected && { color: colors.brandPrimary }]}>
                    {isRTL ? r.ar : r.en}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
            {isRTL
              ? "يرجى إدخال سبب الابلاغ عن المستخدم."
              : "Please describe why you are reporting this user."}
          </Text>
          <TextInput
            testID="report-details"
            value={details}
            onChangeText={(v) => setDetails(v.slice(0, MAX_DETAIL_CHARS))}
            placeholder={isRTL ? "يمكنك الكتابة حتى 250 حرف" : "You can write up to 250 characters"}
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.textarea, { textAlign: isRTL ? "right" : "left" }]}
            maxLength={MAX_DETAIL_CHARS}
          />
          <Text style={styles.charCount}>
            {details.length}/{MAX_DETAIL_CHARS}
          </Text>

          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
            {isRTL
              ? "يرجى رفع صورة/فيديو عن الابلاغ."
              : "Please attach an image or video for the report."}
          </Text>
          <View style={[styles.mediaRow, { flexDirection: "row" }]}>
            <Pressable
              testID="report-pick-image"
              onPress={() => pick("image")}
              style={({ pressed }) => [styles.mediaBtn, pressed && { opacity: 0.85 }]}
            >
              <Icon name="image" size={18} color={colors.onSurface} />
              <Text style={styles.mediaBtnText}>{isRTL ? "صورة" : "Image"}</Text>
            </Pressable>
            <Pressable
              testID="report-pick-video"
              onPress={() => pick("video")}
              style={({ pressed }) => [styles.mediaBtn, pressed && { opacity: 0.85 }]}
            >
              <Icon name="videocam" size={18} color={colors.onSurface} />
              <Text style={styles.mediaBtnText}>{isRTL ? "فيديو" : "Video"}</Text>
            </Pressable>
          </View>

          {!!roomId && (
            <Text style={styles.roomNotice} testID="report-room-notice">
              يرجى العلم أن هذا البلاغ يستهدف القناة/الغرفة بأكملها وسيؤدي إلى حظرها. للإبلاغ عن فرد محدد، يُرجى زيارة ملخص ملفه الشخصي من داخل القناة.
            </Text>
          )}
          {media.length > 0 && (
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {media.map((m, i) => (
                <View key={m.uri + i} style={styles.mediaPreview} testID={`report-media-${i}`}>
                  {m.kind === "image" ? (
                    <Image source={m.uri} style={styles.mediaPreviewImg} contentFit="cover" />
                  ) : (
                    <View style={styles.mediaPreviewImg}>
                      <Icon name="film" size={32} color={colors.muted} />
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                        {isRTL ? "فيديو مرفق" : "Video attached"}
                      </Text>
                    </View>
                  )}
                  <Pressable
                    testID={`report-remove-media-${i}`}
                    onPress={() => setMedia(media.filter((_, j) => j !== i))}
                    style={styles.mediaRemove}
                  >
                    <Icon name="close" size={14} color="#FFF" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {submitting && media.length > 0 && (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }} testID="report-upload-progress">
              {(isRTL ? "جارٍ الرفع " : "Uploading ") + Math.round(progress * 100) + "%"}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.submitBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Pressable
          testID="report-submit"
          disabled={submitting || !reasons.length}
          onPress={submit}
          style={({ pressed }) => [
            styles.submitBtn,
            (!reasons.length || submitting) && { opacity: 0.55 },
            pressed && !submitting && reasons.length > 0 && { opacity: 0.85 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.submitText}>
              {isRTL ? "إرسال البلاغ" : "Submit Report"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  roomNotice: { color: colors.error, fontSize: 12, lineHeight: 19, marginTop: spacing.sm, writingDirection: "rtl", textAlign: "right" },
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    alignItems: "center", justifyContent: "space-between",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 0.3 },

  sectionLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },

  reasonsGrid: {
    flexDirection: "row", flexWrap: "wrap",
    gap: 10, marginTop: spacing.md,
  },
  reasonTile: {
    flexDirection: "row", alignItems: "center",
    gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    minWidth: "47%", flexGrow: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  reasonText: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },

  textarea: {
    marginTop: spacing.sm,
    minHeight: 120,
    textAlignVertical: "top",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, fontSize: 14,
  },
  charCount: { color: colors.muted, fontSize: 11, marginTop: 4, textAlign: "right" },

  mediaRow: { gap: 10, marginTop: spacing.sm },
  mediaBtn: {
    flex: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.brandPrimary + "44",
  },
  mediaBtnText: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },

  mediaPreview: {
    marginTop: spacing.md,
    width: 120, height: 120,
    position: "relative",
  },
  mediaPreviewImg: {
    width: "100%", height: "100%",
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  mediaRemove: {
    position: "absolute", top: -6, right: -6,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: "center", justifyContent: "center",
  },

  submitBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  submitBtn: {
    height: 54, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.brandPrimary,
  },
  submitText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 15, letterSpacing: 0.3 },
});
