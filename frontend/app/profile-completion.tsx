/**
 * ORIO Profile Completion Screen (iter-44 Phase 2)
 * ----------------------------------------------------------------------------
 * Gated on first login (any auth method) when `user.profile_completed` is
 * false. Collects nickname, avatar, gender (immutable after confirm — server
 * enforced), country, age. Uses existing ORIO design system (dark + luminous
 * purple accents) and the central ToastProvider for feedback.
 */
import { CountryFlag } from "@/src/components/CountryFlag";
import { pickAndCrop } from "@/src/media/ImageCropper";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView, Modal, FlatList } from "react-native";
import { Image } from "expo-image";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { colors, spacing, radius } from "@/src/theme";
import { apiCompleteProfile, apiCountries, apiSetProfileMedia } from "@/src/api";

export default function ProfileCompletionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const { isRTL } = useI18n();
  const toast = useToast();

  const [nickname, setNickname] = useState<string>(user?.nickname ?? "");
  // Iter-89 — Gender is required for NEW users during registration.
  // (It's intentionally omitted from the edit-profile screen; gender is locked
  // after confirm and cannot be edited later.)
  const [gender, setGender] = useState<"male" | "female" | null>(null);
  const [age, setAge] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatar_url ?? null);
  const [countryCode, setCountryCode] = useState<string>(user?.country_code ?? "");
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const countriesQ = useQuery({ queryKey: ["countries"], queryFn: apiCountries, staleTime: 24 * 60 * 60 * 1000 });
  const selectedCountry = useMemo(
    () => (countriesQ.data ?? []).find((c: any) => c.code === countryCode),
    [countriesQ.data, countryCode],
  );

  const ageNum = parseInt(age, 10);
  const nicknameOk = nickname.trim().length >= 2 && nickname.trim().length <= 30;
  // Iter-71 — Age must be a 2-digit number between 18 and 99 (strict).
  const ageOk = /^\d{2}$/.test(age.trim()) && Number.isFinite(ageNum) && ageNum >= 18 && ageNum <= 99;
  // Iter-89 — Gender is required again at registration (locked after confirm).
  const canSubmit = nicknameOk && ageOk && !!countryCode && !!gender;

  const pickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.warning(isRTL ? "يرجى منح إذن الوصول إلى الصور" : "Please grant photo library permission");
        return;
      }
      const res = await pickAndCrop({ aspect: [1, 1], shape: "circle", base64: true, maxSide: 1080 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const dataUri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
      setUploading(true);
      await apiSetProfileMedia({ url: dataUri, kind: "avatar" });
      setAvatarUrl(dataUri);
    } catch {
      toast.error(isRTL ? "حدث خطأ أثناء رفع الصورة" : "Failed to upload photo");
    } finally {
      setUploading(false);
    }
  };

  const completeMut = useMutation({
    mutationFn: () => apiCompleteProfile({
      nickname: nickname.trim(),
      gender: gender!,
      age: ageNum,
      country_code: countryCode,
      avatar_url: avatarUrl ?? undefined,
    }),
    onSuccess: async () => {
      toast.success(isRTL ? "تم إكمال ملفك الشخصي" : "Profile completed");
      await refresh();
      router.replace("/(tabs)/home");
    },
    onError: (e: any) => {
      toast.error(e?.message ?? (isRTL ? "تعذر إكمال الملف الشخصي" : "Could not complete profile"));
    },
  });

  return (
    <View style={styles.root} testID="profile-completion-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.xxl,
            paddingHorizontal: spacing.lg,
            gap: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Headers — exact Arabic text per spec */}
          <View style={styles.headerBlock}>
            <Text style={[styles.titleAr, { writingDirection: "rtl" }]}>
              تكمل ملفك الشخصي لجذب الناس إليك
            </Text>
            <Text style={[styles.noteAr, { writingDirection: "rtl" }]}>
              ملاحظة لا يمكنك تغيير جنسك بعد الاختيار ثم التأكيد
            </Text>
          </View>

          {/* Avatar */}
          <View style={styles.avatarBlock}>
            <Pressable onPress={pickAvatar} style={styles.avatarButton} testID="avatar-picker">
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Icon name="person" size={44} color={colors.muted} />
                </View>
              )}
              <View style={styles.avatarBadge}>
                {uploading ? (
                  <ActivityIndicator color={colors.onBrandPrimary} size="small" />
                ) : (
                  <Icon name="camera" size={16} color={colors.onBrandPrimary} />
                )}
              </View>
            </Pressable>
          </View>

          {/* Nickname */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{isRTL ? "الاسم" : "Name"}</Text>
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              maxLength={30}
              placeholder={isRTL ? "أدخل اسمك" : "Enter your name"}
              placeholderTextColor={colors.muted}
              style={[styles.input, { textAlign: isRTL ? "right" : "left" }]}
              testID="input-nickname"
            />
          </View>

          {/* Iter-89 — Gender (new users only; locked after confirm) */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{isRTL ? "الجنس" : "Gender"}</Text>
            <View style={styles.genderRow}>
              <GenderOption
                selected={gender === "male"}
                icon="male"
                label={isRTL ? "ذكر" : "Male"}
                color="#5AC8FA"
                onPress={() => setGender("male")}
                testID="gender-male"
              />
              <GenderOption
                selected={gender === "female"}
                icon="female"
                label={isRTL ? "أنثى" : "Female"}
                color="#FF69B4"
                onPress={() => setGender("female")}
                testID="gender-female"
              />
            </View>
          </View>

          {/* Country */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{isRTL ? "البلد" : "Country"}</Text>
            <Pressable
              style={[styles.input, styles.selectBtn]}
              onPress={() => setCountryPickerOpen(true)}
              testID="country-picker"
            >
              {selectedCountry ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <CountryFlag code={selectedCountry.code} flag={selectedCountry.flag} size={22} />
                  <Text style={styles.selectText}>{isRTL && selectedCountry.name_ar ? selectedCountry.name_ar : selectedCountry.name}</Text>
                </View>
              ) : (
                <Text style={[styles.selectText, { color: colors.muted }]}>
                  {isRTL ? "اختر بلدك" : "Select your country"}
                </Text>
              )}
              <Icon name="chevron-down" size={18} color={colors.muted} />
            </Pressable>
          </View>

          {/* Age */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{isRTL ? "العمر" : "Age"}</Text>
            <TextInput
              value={age}
              onChangeText={(v) => setAge(v.replace(/[^0-9]/g, "").slice(0, 2))}
              keyboardType="number-pad"
              placeholder={isRTL ? "18 - 99" : "18 - 99"}
              placeholderTextColor={colors.muted}
              style={[styles.input, { textAlign: isRTL ? "right" : "left" }]}
              testID="input-age"
            />
          </View>

          {/* Submit */}
          <Pressable
            style={[styles.submitBtn, (!canSubmit || completeMut.isPending) && { opacity: 0.5 }]}
            disabled={!canSubmit || completeMut.isPending}
            onPress={() => setConfirmOpen(true)}
            testID="profile-complete-submit"
          >
            {completeMut.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.submitText}>{isRTL ? "تأكيد" : "Confirm"}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country picker modal */}
      <CountryPicker
        visible={countryPickerOpen}
        items={countriesQ.data ?? []}
        selected={countryCode}
        onSelect={(c) => { setCountryCode(c); setCountryPickerOpen(false); }}
        onClose={() => setCountryPickerOpen(false)}
      />

      {/* Confirmation — explicit so user understands gender becomes immutable */}
      <ConfirmModal
        visible={confirmOpen}
        title={isRTL ? "تأكيد" : "Confirm"}
        body={
          isRTL
            ? "بعد التأكيد لا يمكنك تغيير الجنس. هل تريد المتابعة؟"
            : "After confirming, you cannot change your gender. Continue?"
        }
        primaryLabel={isRTL ? "تأكيد" : "Confirm"}
        secondaryLabel={isRTL ? "إلغاء" : "Cancel"}
        onPrimary={() => { setConfirmOpen(false); completeMut.mutate(); }}
        onSecondary={() => setConfirmOpen(false)}
        onDismiss={() => setConfirmOpen(false)}
      />
    </View>
  );
}

function GenderOption({ selected, icon, label, color, onPress, testID }: {
  selected: boolean;
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      style={[
        styles.genderBtn,
        selected && { backgroundColor: color + "22", borderColor: color },
      ]}
      onPress={onPress}
      testID={testID}
    >
      <View style={[styles.genderIconWrap, selected && { backgroundColor: color }]}>
        <Icon name={icon as any} size={22} color={selected ? colors.onSurface : colors.muted} />
      </View>
      <Text style={[styles.genderLabel, selected && { color: colors.onSurface, fontWeight: "900" }]}>{label}</Text>
    </Pressable>
  );
}

function CountryPicker({ visible, items, selected, onSelect, onClose }: {
  visible: boolean;
  items: any[];
  selected: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { isRTL } = useI18n();
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter((c: any) =>
      (c.name ?? "").toLowerCase().includes(f) || (c.name_ar ?? "").includes(filter.trim()) || (c.code ?? "").toLowerCase().includes(f),
    );
  }, [items, filter]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose} testID="country-picker-backdrop">
        <Pressable style={[styles.pickerCard, { paddingBottom: insets.bottom + spacing.md, height: "75%" }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.pickerDrag} />
          <Text style={styles.pickerTitle}>{isRTL ? "اختر بلدك" : "Select Country"}</Text>
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder={isRTL ? "ابحث" : "Search"}
            placeholderTextColor={colors.muted}
            style={[styles.input, { marginHorizontal: spacing.md, marginBottom: spacing.sm, textAlign: isRTL ? "right" : "left" }]}
            testID="country-filter"
          />
          <FlatList
            style={{ flex: 1 }}
            data={filtered}
            keyExtractor={(c: any) => c.code}
            contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: c }: { item: any }) => (
              <Pressable
                style={[styles.countryItem, selected === c.code && { backgroundColor: colors.brandPrimary + "22" }]}
                onPress={() => onSelect(c.code)}
                testID={`country-${c.code}`}
              >
                <CountryFlag code={c.code} flag={c.flag} size={26} />
                <Text style={styles.countryName}>{isRTL && c.name_ar ? c.name_ar : c.name}</Text>
                {selected === c.code && <Icon name="checkmark" size={18} color={colors.brandPrimary} />}
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  headerBlock: { gap: spacing.sm, alignItems: "center", paddingHorizontal: spacing.md },
  titleAr: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 0.3,
  },
  noteAr: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  avatarBlock: { alignItems: "center" },
  avatarButton: { width: 112, height: 112, borderRadius: 56, position: "relative" },
  avatarImage: { width: 112, height: 112, borderRadius: 56, borderWidth: 2, borderColor: colors.brandPrimary + "66" },
  avatarPlaceholder: {
    width: 112, height: 112, borderRadius: 56,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  avatarBadge: {
    position: "absolute",
    bottom: 0, right: 0,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.surface,
  },
  fieldBlock: { gap: spacing.xs },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  input: {
    backgroundColor: colors.surfaceSecondary,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    fontSize: 15,
    borderWidth: 1, borderColor: colors.border,
  },
  selectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  genderRow: { flexDirection: "row", gap: spacing.sm },
  genderBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  genderIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  genderLabel: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  submitBtn: {
    marginTop: spacing.md,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
    shadowColor: colors.brandPrimary,
    shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  submitText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: spacing.md,
    borderWidth: 1, borderColor: colors.brandPrimary + "33",
  },
  pickerDrag: {
    alignSelf: "center",
    width: 48, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  pickerTitle: {
    color: colors.onSurface, fontSize: 16, fontWeight: "900",
    textAlign: "center", marginBottom: spacing.sm,
  },
  countryItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md,
  },
  countryFlag: { fontSize: 22 },
  countryName: { color: colors.onSurface, fontSize: 15, flex: 1, fontWeight: "600" },
});
