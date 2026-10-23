/**
 * Iter-117 — Create Post page: ≤1000 chars, up to 9 images OR one ≤60s video,
 * curated hashtags. Media goes to Emergent Object Storage (chunked upload).
 */
import { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { apiCreatePostFull } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { pickMedia, uploadMedia, type PickedMedia } from "@/src/media/upload";
import { HashtagChips } from "@/src/posts/PostParts";
import { colors, spacing, radius } from "@/src/theme";

const MAX_CHARS = 1000;

export default function CreatePost() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { isRTL, lang } = useI18n();
  const ar = lang === "ar";
  const [text, setText] = useState("");
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"public" | "mutual">("public");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const hasVideo = media[0]?.kind === "video";

  const pick = async (kind: "image" | "video") => {
    if (kind === "image" && (hasVideo || media.length >= 9)) {
      toast.error(ar ? "حتى 9 صور أو فيديو واحد" : "Up to 9 images OR one video");
      return;
    }
    if (kind === "video" && media.length > 0) {
      toast.error(ar ? "حتى 9 صور أو فيديو واحد" : "Up to 9 images OR one video");
      return;
    }
    const res = await pickMedia(kind, kind === "image" ? 9 - media.length : 1, true);
    if (res === "denied") {
      toast.error(ar ? "صلاحية الصور مطلوبة — افتح الإعدادات" : "Photo access needed — open Settings");
      Linking.openSettings().catch(() => {});
      return;
    }
    if (!res.length) return;
    if (kind === "video" && (res[0].duration ?? 0) > 60.5) {
      toast.error(ar ? "يجب ألا يتجاوز الفيديو 60 ثانية" : "Video must be 60 seconds or shorter");
      return;
    }
    setMedia((m) => [...m, ...res].slice(0, kind === "image" ? 9 : 1));
  };

  const canPost = !busy && (text.trim().length > 0 || media.length > 0);

  const publish = async () => {
    if (!canPost) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < media.length; i++) {
        urls.push(await uploadMedia(media[i], "post", (p) => setProgress((i + p) / media.length)));
      }
      await apiCreatePostFull({
        text: text.trim(),
        images: hasVideo ? [] : urls,
        video_url: hasVideo ? urls[0] : undefined,
        video_duration: hasVideo ? media[0].duration ?? null : null,
        hashtags: tags,
        visibility,
      });
      await qc.invalidateQueries({ queryKey: ["posts"] });
      toast.success(ar ? "تم النشر" : "Posted");
      router.back();
    } catch (e: any) {
      toast.error(e?.message || (ar ? "فشل النشر" : "Failed to post"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="create-post-screen">
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="create-post-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{ar ? "منشور جديد" : "New Post"}</Text>
        <Pressable testID="create-post-submit" disabled={!canPost} onPress={publish} style={[styles.postBtn, !canPost && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.postBtnText}>{ar ? "نشر" : "Post"}</Text>}
        </Pressable>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }} keyboardShouldPersistTaps="handled">
          <TextInput
            testID="create-post-text"
            value={text}
            onChangeText={(v) => setText(v.slice(0, MAX_CHARS))}
            placeholder={ar ? "بماذا تفكر؟" : "What's on your mind?"}
            placeholderTextColor={colors.muted}
            multiline
            maxLength={MAX_CHARS}
            style={[styles.input, { textAlign: isRTL ? "right" : "left" }]}
          />
          <Text style={[styles.counter, { textAlign: isRTL ? "left" : "right" }]} testID="create-post-counter">{text.length}/{MAX_CHARS}</Text>

          {media.length > 0 && (
            <View style={styles.mediaRow}>
              {media.map((m, i) => (
                <View key={m.uri + i} style={styles.thumb} testID={`create-post-media-${i}`}>
                  {m.kind === "image" ? (
                    <Image source={m.uri} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                      <Icon name="film" size={28} color={colors.muted} />
                      <Text style={styles.thumbText}>{Math.round(m.duration ?? 0)}s</Text>
                    </View>
                  )}
                  <Pressable onPress={() => setMedia(media.filter((_, j) => j !== i))} style={styles.remove} hitSlop={6}>
                    <Icon name="close" size={14} color="#FFF" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {busy && media.length > 0 && (
            <Text style={styles.progress} testID="create-post-progress">{(ar ? "جارٍ الرفع " : "Uploading ") + Math.round(progress * 100) + "%"}</Text>
          )}

          <View style={[styles.pickRow, { flexDirection: "row" }]}>
            <Pressable testID="create-post-pick-image" onPress={() => pick("image")} style={styles.pickBtn}>
              <Icon name="images" size={18} color={colors.onSurface} />
              <Text style={styles.pickText}>{ar ? `صور (${hasVideo ? 0 : media.length}/9)` : `Photos (${hasVideo ? 0 : media.length}/9)`}</Text>
            </Pressable>
            <Pressable testID="create-post-pick-video" onPress={() => pick("video")} style={styles.pickBtn}>
              <Icon name="videocam" size={18} color={colors.onSurface} />
              <Text style={styles.pickText}>{ar ? "فيديو ≤60ث" : "Video ≤60s"}</Text>
            </Pressable>
          </View>

          <View style={[styles.pickRow, { flexDirection: "row" }]}>
            {(["public", "mutual"] as const).map((v) => (
              <Pressable key={v} testID={`create-post-vis-${v}`} onPress={() => setVisibility(v)}
                style={[styles.pickBtn, visibility === v && { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "18" }]}>
                <Icon name={v === "public" ? "earth-outline" : "people-outline"} size={16} color={visibility === v ? colors.brandPrimary : colors.onSurface} />
                <Text style={styles.pickText}>{v === "public" ? (ar ? "عام" : "Public") : (ar ? "الأصدقاء المتبادلون" : "Mutual Friends")}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.label, { textAlign: isRTL ? "right" : "left" }]}>{ar ? "الوسوم" : "Hashtags"}</Text>
          <HashtagChips
            testIDPrefix="create-post-tag"
            selected={tags}
            maxHeight={200}
            onToggle={(tg) => setTags((s) => (s.includes(tg) ? s.filter((x) => x !== tg) : [...s, tg]))}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  postBtn: { minWidth: 72, height: 38, borderRadius: radius.pill, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  postBtnText: { color: colors.onBrandPrimary, fontWeight: "900" },
  input: { minHeight: 160, color: colors.onSurface, fontSize: 16, paddingHorizontal: spacing.lg, paddingTop: spacing.md, textAlignVertical: "top" },
  counter: { color: colors.muted, fontSize: 12, paddingHorizontal: spacing.lg },
  mediaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  thumb: { width: 96, height: 96, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceSecondary },
  thumbText: { color: colors.muted, fontSize: 11, marginTop: 2 },
  remove: { position: "absolute", top: 4, end: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  progress: { color: colors.muted, fontSize: 12, paddingHorizontal: spacing.lg, marginTop: 6 },
  pickRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  pickBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", height: 46, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  pickText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "800", paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
});
