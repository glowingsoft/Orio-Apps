/**
 * Iter-90 — ORIO Language page.
 * A dedicated full-screen picker opened from Settings → Language.
 * Picking a language persists it and triggers a FULL app reload so RTL/LTR
 * direction flips everywhere immediately.
 */
import React, { useState } from "react";
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n, type Lang } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

type Row = {
  code: Lang;
  nativeName: string;
  englishName: string;
  direction: "ltr" | "rtl";
};

const LANGS: Row[] = [
  { code: "en", nativeName: "English",   englishName: "English", direction: "ltr" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic",  direction: "rtl" },
];

export default function LanguageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lang, setLang, isRTL, t } = useI18n();
  const [applying, setApplying] = useState<Lang | null>(null);

  const onPick = async (code: Lang) => {
    if (applying) return;
    if (code === lang) {
      safeBack(router);
      return;
    }
    setApplying(code);
    try {
      // Close the Language page first, then apply (strings switch instantly;
      // a direction flip triggers the automatic in-place reload).
      if (router.canGoBack()) router.back(); else router.replace("/(tabs)/me" as any);
      await new Promise((r) => setTimeout(r, 120));
      await setLang(code);
      // The i18n provider's setLang schedules a reload (web -> location.reload,
      // native -> expo-updates reloadAsync if available). The reload applies
      // RTL/LTR direction + translated strings globally.
    } catch {
      setApplying(null);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="language-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.chooseLanguage || "Choose Language"}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Subtitle */}
      <Text style={styles.subtitle}>
        {isRTL
          ? "اختر لغتك المفضلة. سيتم تطبيقها فورًا."
          : "Pick your preferred language. It applies immediately."}
      </Text>

      {/* Language rows */}
      <View style={styles.list}>
        {LANGS.map((row) => {
          const selected = row.code === lang;
          const busy = applying === row.code;
          return (
            <Pressable
              key={row.code}
              onPress={() => onPick(row.code)}
              disabled={!!applying}
              style={({ pressed }) => [
                styles.row,
                { flexDirection: "row" },
                selected && styles.rowActive,
                pressed && { opacity: 0.9 },
              ]}
              testID={`language-row-${row.code}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.nativeName}>{row.nativeName}</Text>
                <Text style={styles.englishName}>
                  {row.englishName} · {row.direction === "rtl" ? "RTL" : "LTR"}
                </Text>
              </View>
              {busy ? (
                <ActivityIndicator color={colors.gold} />
              ) : selected ? (
                <View style={styles.checkDot}>
                  <Icon name="checkmark" size={16} color={colors.onBrandPrimary} />
                </View>
              ) : (
                <View style={styles.checkDotMuted} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Info */}
      <View style={styles.infoCard}>
        <Icon name="information-circle-outline" size={16} color={colors.muted} />
        <Text style={styles.infoText}>
          {isRTL
            ? "اللغة المحفوظة ستُطبَّق تلقائياً في كل مرة تفتح فيها التطبيق."
            : "Your choice is saved and auto-applied every time you open Yazeen."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  title: {
    flex: 1, textAlign: "center",
    color: colors.onSurface, fontSize: 18, fontWeight: "800",
  },
  subtitle: {
    color: colors.muted, fontSize: 13,
    paddingHorizontal: spacing.lg, marginVertical: spacing.md,
    textAlign: "center",
  },
  list: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  rowActive: { borderColor: colors.gold },
  flag: { fontSize: 28 },
  nativeName: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  englishName: { color: colors.muted, fontSize: 11, marginTop: 2 },
  checkDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.gold,
    alignItems: "center", justifyContent: "center",
  },
  checkDotMuted: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 1, borderColor: colors.border,
  },
  infoCard: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: spacing.lg, marginTop: spacing.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    opacity: 0.9,
  },
  infoText: {
    flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16,
  },
});
