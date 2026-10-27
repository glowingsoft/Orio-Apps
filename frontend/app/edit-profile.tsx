import { CountryFlag } from "@/src/components/CountryFlag";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, FlatList,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { colors, spacing, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { apiUpdateMe, apiCountries, apiModerateProfileAvatar, apiUpdateProfileAvatar, apiUpdateProfileCover, apiNameChanges } from "@/src/api";
import { pickAndCrop } from "@/src/media/ImageCropper";
import { uploadMedia, mediaUrl } from "@/src/media/upload";
import { ChangePhotoChooser, type ChangePhotoChooserRef } from "@/src/components/ChangePhotoChooser";

export default function EditProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const { t, isRTL } = useI18n();
  const qc = useQueryClient();

  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [age, setAge] = useState<string>(user?.age ? String(user.age) : "");
  const [countryCode, setCountryCode] = useState<string | null>(user?.country_code ?? null);
  const [avatarLocal, setAvatarLocal] = useState<string | null>(null);
  // Iter-70: we keep the animated avatar's local URI in state for immediate
  // preview after picking; the real server write happens on Save.
  const [, setAnimatedAvatarLocal] = useState<string | null>(null);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(!!user);
  const [avatarPending, setAvatarPending] = useState<{ uri: string; kind: "photo" | "gif" } | null>(null);
  const chooserRef = useRef<ChangePhotoChooserRef>(null);
  // VIP5+ custom profile cover — picked/cropped locally, uploaded on Save.
  const canCover = Number(user?.vip_level ?? 0) >= 5;
  const [coverPending, setCoverPending] = useState<{ uri: string; mime: string } | null>(null);
  const pickCover = async () => {
    if (!canCover) { router.push("/vip" as any); return; }
    const res = await pickAndCrop({ aspect: [3, 2], maxSide: 1600 });
    const a = res.canceled ? null : res.assets?.[0];
    if (!a) return;
    if ((a.mimeType || "").includes("gif")) {
      Alert.alert(t.error || "Error", isRTL ? "يرجى اختيار صورة فقط" : "Please pick an image file only");
      return;
    }
    setCoverPending({ uri: a.uri, mime: a.mimeType || "image/jpeg" });
  };

  // Rehydrate state once auth user is available (deep-link path)
  useEffect(() => {
    if (hydrated || !user) return;
    setNickname(user.nickname ?? "");
    setBio(user.bio ?? "");
    setAge(user.age ? String(user.age) : "");
    setCountryCode(user.country_code ?? null);
    setHydrated(true);
  }, [user, hydrated]);

  const { data: countries = [] } = useQuery({ queryKey: ["countries"], queryFn: apiCountries });
  const { data: nc } = useQuery({ queryKey: ["name-changes", user?.id], queryFn: apiNameChanges, enabled: !!user });

  const selectedCountry = useMemo(
    () => (countries as any[]).find((c: any) => c.code === countryCode),
    [countries, countryCode]
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      // Iter-70 — nothing is saved until Save is tapped. Validate the
      // avatar/GIF server-side BEFORE committing the rest of the patch so
      // the whole edit is atomic (either all fields apply or none).
      if (avatarPending) {
        try {
          await apiModerateProfileAvatar(avatarPending.uri, avatarPending.kind);
          await apiUpdateProfileAvatar(avatarPending.uri, avatarPending.kind);
        } catch (e: any) {
          const msg = String(e?.message || "");
          if (msg.includes("USER_MEDIA_BLOCKED")) {
            chooserRef.current?.openBlockedModal();
            throw new Error("MEDIA_BLOCKED");
          }
          if (msg.includes("GIF_VIP4_REQUIRED") || msg.includes("GIF_VIP5_REQUIRED")) {
            throw new Error("Please upgrade to VIP4 to change your GIF profile picture.");
          }
          throw e;
        }
      }
      if (coverPending) {
        const url = await uploadMedia({ uri: coverPending.uri, kind: "image", mime: coverPending.mime, size: 0 }, "cover");
        await apiUpdateProfileCover(url);
      }
      const patch: any = {
        bio: bio.trim(),
      };
      if (nickname.trim() !== (user?.nickname ?? "")) {
        if (nc && nc.remaining <= 0) throw new Error("NAME_CHANGE_LIMIT");
        patch.nickname = nickname.trim();
      }
      if (age) {
        const n = parseInt(age, 10);
        if (!Number.isFinite(n) || n < 13 || n > 120) {
          throw new Error("Age must be between 13 and 120");
        }
        patch.age = n;
      }
      if (countryCode) patch.country_code = countryCode;
      return apiUpdateMe(patch);
    },
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
      qc.invalidateQueries({ queryKey: ["name-changes", user?.id] });
      setAvatarPending(null);
      setCoverPending(null);
      router.back();
    },
    onError: (e: any) => {
      if (String(e?.message) === "MEDIA_BLOCKED") return; // modal handled
      const m = String(e?.message || "");
      if (m.includes("NAME_CHANGE_LIMIT")) {
        Alert.alert(t.error || "Error", isRTL ? "لقد استنفدت فرص تغيير الاسم لهذا الشهر" : "You've used all name changes for this month");
        return;
      }
      if (m.includes("VIP5_REQUIRED")) {
        Alert.alert(t.error || "Error", isRTL ? "تغيير الغلاف متاح لـ VIP5 وما فوق فقط" : "Changing the cover is available for VIP5 and above only");
        return;
      }
      Alert.alert(t.error || "Error", e?.message ?? "Save failed");
    },
  });

  const pickAvatar = async () => {
    // Iter-69 — delegate to the shared ChangePhotoChooser.
    chooserRef.current?.open();
  };

  const onProfileAvatarPicked = async (dataUri: string, kind: "photo" | "gif") => {
    // Iter-70/71 — DEFER save until Save button. Only update local preview.
    if (dataUri === "__NOT_GIF__") {
      Alert.alert(t.error || "Error", isRTL ? "يرجى اختيار ملف GIF فقط" : "Please pick a GIF file only");
      return;
    }
    if (dataUri === "__NOT_PHOTO__") {
      Alert.alert(t.error || "Error", isRTL ? "يرجى اختيار صورة فقط (ليس GIF أو فيديو)" : "Please pick an image file only (no GIFs or videos)");
      return;
    }
    if (dataUri.startsWith("__GIF_TOO_LARGE__")) {
      const mb = dataUri.replace("__GIF_TOO_LARGE__", "");
      Alert.alert(t.error || "Error", isRTL ? `حجم GIF كبير جدًا (${mb} ميجا، الحد الأقصى 5 ميجا)` : `GIF too large (${mb} MB, max 5 MB)`);
      return;
    }
    setAvatarPending({ uri: dataUri, kind });
    if (kind === "gif") { setAnimatedAvatarLocal(dataUri); setAvatarLocal(dataUri); }
    else { setAvatarLocal(dataUri); setAnimatedAvatarLocal(null); }
  };

  if (!user) return null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.surface }}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="edit-back" onPress={() => router.back()} style={styles.hBtn}>
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.editProfile || "Edit Profile"}</Text>
        <Pressable
          testID="edit-save"
          onPress={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          style={styles.saveBtn}
        >
          {saveMut.isPending ? (
            <ActivityIndicator size="small" color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.saveTxt}>{t.save || "Save"}</Text>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
        {/* Profile cover at the very top (VIP5+, server-enforced) with the
            circular avatar overlapping it in front. */}
        <Pressable testID="edit-cover" onPress={pickCover} style={styles.coverBox}>
          {canCover && (coverPending?.uri || user.cover_url) ? (
            <Image source={coverPending?.uri || mediaUrl(user.cover_url)} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          ) : (
            <Image source={user.avatar_url} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={20} />
          )}
          <View style={styles.coverOverlay}>
            <Icon name={canCover ? "image-outline" : "lock-closed"} size={16} color="#FFFFFF" />
            <Text style={styles.coverOverlayText} testID={canCover ? "edit-cover-change" : "edit-cover-locked"}>
              {canCover
                ? (isRTL ? "تغيير الغلاف" : "Change cover")
                : (isRTL ? "متاح لـ VIP5 وما فوق" : "Available for VIP5 and above")}
            </Text>
          </View>
        </Pressable>
        <View style={{ alignItems: "center", marginTop: -48 }}>
          <Pressable testID="edit-avatar" onPress={pickAvatar} style={styles.avatarWrap}>
            <Image
              source={avatarLocal ?? user.avatar_url}
              style={[styles.avatar, { borderWidth: 3, borderColor: colors.surface }]}
              contentFit="cover"
              transition={150}
            />
            <View style={styles.avatarBadge}>
              <Icon name="camera" size={16} color={colors.onBrandPrimary} />
            </View>
          </Pressable>
          <Text style={styles.avatarHint}>{t.tapToChangePhoto || "Tap to change photo"}</Text>
        </View>

        {/* Numeric ID (read-only) */}
        <FieldRow label={t.numericIdLabel || "Yazeen ID"} rtl={isRTL}>
          <Text style={styles.readonlyValue}>{user.numeric_id}</Text>
        </FieldRow>

        {/* Premium ID — Coming Soon */}
        <Pressable disabled style={styles.premiumIdRow}>
          <View style={styles.premiumIdIcon}>
            <Icon name="ribbon" size={16} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.premiumIdTitle}>{t.premiumId || "Premium ID"}</Text>
            <Text style={styles.premiumIdSub}>{t.comingSoonLabel || "Coming Soon"}</Text>
          </View>
          <View style={styles.soonPill}>
            <Text style={styles.soonPillText}>{t.soon || "Soon"}</Text>
          </View>
        </Pressable>

        {/* Nickname */}
        <FieldRow label={t.nickname || "Username"} rtl={isRTL}>
          <TextInput
            testID="edit-nickname"
            value={nickname}
            onChangeText={setNickname}
            placeholder={t.yourDisplayName}
            placeholderTextColor={colors.muted}
            style={[styles.input, isRTL && { textAlign: "right" }]}
            maxLength={20}
          />
          <Text style={styles.nameHint} testID="name-changes-remaining">
            {isRTL ? "عدد فرص تغيير الاسم المتبقية" : "Name changes remaining"}: {nc ? nc.remaining : "…"}{nc ? ` / ${nc.limit}` : ""}
          </Text>
          <View style={styles.ncTable} testID="name-changes-table">
            {(nc?.table ?? []).map((r) => (
              <View key={r.vip} style={styles.ncRow}>
                <Text style={styles.ncCell}>VIP Lv.{r.vip}</Text>
                <Text style={[styles.ncCell, { textAlign: "center" }]}>
                  {isRTL ? `${r.limit} ${r.limit === 1 ? "مرة" : "مرات"} / شهرياً` : `${r.limit} change${r.limit === 1 ? "" : "s"}/month`}
                </Text>
              </View>
            ))}
          </View>
        </FieldRow>

        {/* Bio */}
        <FieldRow label={t.bio || "Bio"} rtl={isRTL}>
          <TextInput
            testID="edit-bio"
            value={bio}
            onChangeText={setBio}
            placeholder={t.tellSomething || "Tell something about yourself"}
            placeholderTextColor={colors.muted}
            multiline
            maxLength={200}
            style={[styles.input, { minHeight: 84, textAlignVertical: "top" }, isRTL && { textAlign: "right" }]}
          />
          <Text style={styles.counter}>{bio.length}/200</Text>
        </FieldRow>

        {/* Age */}
        <FieldRow label={t.age || "Age"} rtl={isRTL}>
          <TextInput
            testID="edit-age"
            value={age}
            onChangeText={(v) => setAge(v.replace(/[^0-9]/g, "").slice(0, 3))}
            placeholder="18"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            style={[styles.input, isRTL && { textAlign: "right" }]}
            maxLength={3}
          />
        </FieldRow>

        {/* Country */}
        <FieldRow label={t.country || "Country"} rtl={isRTL}>
          <Pressable
            testID="edit-country"
            onPress={() => setCountryPickerOpen(true)}
            style={styles.countryBtn}
          >
            {selectedCountry ? (
              <>
                <CountryFlag code={selectedCountry.code} flag={selectedCountry.flag} size={22} />
                <Text style={styles.countryText}>{isRTL && selectedCountry.name_ar ? selectedCountry.name_ar : selectedCountry.name}</Text>
              </>
            ) : (
              <Text style={[styles.countryText, { color: colors.muted }]}>
                {t.selectCountry || "Select country"}
              </Text>
            )}
            <View style={{ flex: 1 }} />
            <Icon name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
        </FieldRow>
      </ScrollView>

      {/* Country picker */}
      <Modal
        visible={countryPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setCountryPickerOpen(false)}>
          <Pressable
            style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.md }]}
          >
            <View style={styles.dragHandle} />
            <Text style={styles.modalTitle}>{t.selectCountry || "Select country"}</Text>
            <FlatList
              data={countries as any[]}
              keyExtractor={(c: any) => c.code}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              renderItem={({ item }) => (
                <Pressable
                  testID={`country-${item.code}`}
                  onPress={() => { setCountryCode(item.code); setCountryPickerOpen(false); }}
                  style={[styles.countryRow, countryCode === item.code && { backgroundColor: colors.gold + "22" }]}
                >
                  <CountryFlag code={item.code} flag={item.flag} size={26} />
                  <Text style={styles.countryRowName}>{isRTL && item.name_ar ? item.name_ar : item.name}</Text>
                  <View style={{ flex: 1 }} />
                  {countryCode === item.code && (
                    <Icon name="checkmark-circle" size={18} color={colors.gold} />
                  )}
                </Pressable>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Iter-69: shared ChangePhotoChooser (two options: Change Profile Photo
          / Change Profile GIF — with VIP5+ gate and 3-day block modal). */}
      <ChangePhotoChooser ref={chooserRef} isRTL={isRTL} onPicked={onProfileAvatarPicked} />
    </KeyboardAvoidingView>
  );
}

function FieldRow({ label, rtl, children }: any) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={[styles.fieldLabel, rtl && { textAlign: "right" }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  hBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: colors.onSurface, fontSize: 17, fontWeight: "800", textAlign: "center" },
  saveBtn: {
    minWidth: 72, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.gold, alignItems: "center", justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  saveTxt: { color: colors.onBrandPrimary, fontWeight: "800" },

  avatarWrap: { position: "relative" },
  avatar: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 3, borderColor: colors.gold,
    backgroundColor: colors.surfaceSecondary,
  },
  avatarBadge: {
    position: "absolute", bottom: 2, right: 2,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.gold, alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: colors.surface,
  },
  avatarHint: { color: colors.muted, fontSize: 12, marginTop: 6 },
  coverBox: { height: 140, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceSecondary, justifyContent: "flex-start" },
  nameHint: { color: colors.gold, fontSize: 12, fontWeight: "700", marginTop: 8 },
  ncTable: { marginTop: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  ncRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  ncCell: { flex: 1, color: colors.onSurface, fontSize: 12, paddingVertical: 8, paddingHorizontal: 10, fontWeight: "600" },
  coverOverlay: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", margin: spacing.sm, paddingHorizontal: 10, height: 30, borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.55)" },
  coverOverlayText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },

  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", marginBottom: 6, letterSpacing: 0.3 },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.onSurface, fontSize: 15,
  },
  readonlyValue: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.muted, fontSize: 15, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  counter: { color: colors.muted, fontSize: 11, marginTop: 4, textAlign: "right" },

  countryBtn: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  countryText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },

  premiumIdRow: {
    marginTop: spacing.md,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.gold + "33",
    opacity: 0.9,
  },
  premiumIdIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.gold + "22",
    alignItems: "center", justifyContent: "center",
  },
  premiumIdTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  premiumIdSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  soonPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.gold + "22", borderWidth: 1, borderColor: colors.gold },
  soonPillText: { color: colors.gold, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.md, height: "75%",
  },
  dragHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  modalTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800", textAlign: "center", marginBottom: spacing.md },
  countryRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md,
  },
  countryRowName: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  avatarKindRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
});
