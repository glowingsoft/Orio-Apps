import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import { apiPushPref, apiSetPushPref } from "@/src/api";
import { registerForPush } from "@/src/push/PushHost";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { ConfirmModal } from "@/src/components/ConfirmModal";

export default function Settings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { lang, isRTL, t } = useI18n();
  const [notifs, setNotifs] = useState(true);
  // Push ON/OFF — server-stored preference (backend skips pushes when OFF).
  useEffect(() => { apiPushPref().then((r) => setNotifs(r.enabled)).catch(() => {}); }, []);
  const togglePush = async (v: boolean) => {
    setNotifs(v);
    try {
      await apiSetPushPref(v);
      if (v) registerForPush();
    } catch { setNotifs(!v); }
  };
  const [hideOnline, setHideOnline] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  const languageLabel = lang === "ar" ? "العربية" : "English";

  const sections: { title: string; items: any[] }[] = [
    {
      title: t.preferences || "Preferences",
      items: [
        {
          icon: "language",
          label: t.language || "Language",
          // Iter-90 — Dedicated Language page (opens from Settings).
          onPress: () => router.push("/language" as any),
          right: (
            <View style={[styles.langValueBox, { flexDirection: "row" }]}>
              <Text style={styles.langValueText}>{languageLabel}</Text>
              <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.muted} />
            </View>
          ),
        },
        {
          icon: "notifications",
          label: t.notifications || "Notifications",
          right: (
            <Switch
              testID="switch-notifs"
              value={notifs}
              onValueChange={togglePush}
              trackColor={{ true: colors.gold, false: colors.border }}
            />
          ),
        },
      ],
    },
    {
      title: t.privacy || "Privacy",
      items: [
        {
          icon: "eye-off",
          label: t.hideOnlineStatusVip || "Hide Online Status (VIP 7)",
          disabled: (user?.vip_level ?? 0) < 7,
          right: (
            <Switch
              testID="switch-hide-online"
              value={hideOnline}
              onValueChange={setHideOnline}
              disabled={(user?.vip_level ?? 0) < 7}
              trackColor={{ true: colors.gold, false: colors.border }}
            />
          ),
        },
      ],
    },
    {
      title: t.account || "Account",
      items: [
        {
          icon: "people-circle",
          label: t.switchAccount || "Switch Account",
          onPress: () => router.push("/accounts" as any),
        },
        {
          icon: "key",
          label: t.changePassword || "Change Password",
          onPress: () => Alert.alert(t.comingSoonLabel || "Coming soon", t.passwordRecoverySoon || "Password recovery integration in next iteration"),
        },
        {
          icon: "trash",
          label: t.deleteAccount || "Delete Account",
          danger: true,
          onPress: () => router.push("/delete-account" as any),
        },
      ],
    },
    {
      title: t.about || "About",
      items: [
        {
          icon: "document-text",
          label: t.termsOfService || "Terms of Service",
          onPress: () => Alert.alert(t.termsOfService || "Terms of Service", t.termsBody || "By using Yazeen you agree to our Terms."),
        },
        {
          icon: "shield-checkmark",
          label: t.privacyPolicy || "Privacy Policy",
          onPress: () => Alert.alert(t.privacyPolicy || "Privacy Policy", t.privacyBody || "We respect your privacy."),
        },
        {
          icon: "people",
          label: t.communityGuidelines || "Community Guidelines",
          onPress: () => Alert.alert(t.communityGuidelines || "Community Guidelines", t.guidelinesBody || "Be respectful. No harassment. No illegal content."),
        },
      ],
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="settings-screen">
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.settings || "Settings"}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.lg }}>
        {sections.map((sec) => (
          <View key={sec.title}>
            <Text style={[styles.sectionTitle, { textAlign: isRTL ? "right" : "left" }]}>{sec.title}</Text>
            <View style={styles.section}>
              {sec.items.map((it, i) => (
                <Pressable
                  key={i}
                  testID={`setting-${it.label}`}
                  onPress={it.onPress}
                  disabled={!it.onPress && !it.right}
                  style={[
                    styles.item,
                    { flexDirection: "row" },
                    it.disabled && { opacity: 0.5 },
                  ]}
                >
                  <Icon name={it.icon} size={20} color={it.danger ? colors.error : colors.onSurface} />
                  <Text style={[styles.itemLabel, { textAlign: isRTL ? "right" : "left" }, it.danger && { color: colors.error }]}>
                    {it.label}
                  </Text>
                  {it.right || (it.onPress && (
                    <Icon name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.muted} />
                  ))}
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Pressable testID="settings-signout-button" onPress={() => setExitOpen(true)} style={[styles.signOut, { flexDirection: "row" }]}>
          <Icon name="log-out" size={18} color={colors.error} />
          <Text style={styles.signOutText}>{t.signOut || "Sign Out"}</Text>
        </Pressable>
      </ScrollView>

      {/* Iter-44 — Premium ORIO exit confirmation modal (section 4). */}
      <ConfirmModal
        visible={exitOpen}
        title={t.exitWarningTitle || "Warning"}
        body={t.exitWarningBody || "You are about to exit Yazeen"}
        primaryLabel={t.confirmExit || "Confirm Exit"}
        secondaryLabel={t.cancel || "Cancel"}
        primaryTone="danger"
        onPrimary={() => { setExitOpen(false); void signOut(); }}
        onSecondary={() => setExitOpen(false)}
        onDismiss={() => setExitOpen(false)}
        testID="exit-confirm-modal"
        hideLogo
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  sectionTitle: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: spacing.sm, paddingHorizontal: spacing.md },
  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  item: { alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  itemLabel: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  langValueBox: { alignItems: "center", gap: 4 },
  langValueText: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  signOut: { justifyContent: "center", gap: spacing.sm, alignItems: "center", padding: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.error, marginTop: spacing.md },
  signOutText: { color: colors.error, fontWeight: "800" },
});
