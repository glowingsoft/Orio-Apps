import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { useRoomSession } from "@/src/room/RoomSession";
import { colors, spacing, radius } from "@/src/theme";

export default function Accounts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, accounts, maxAccounts, switchAccount, addAccount, removeSavedAccount } = useAuth();
  const { leave } = useRoomSession();
  const { isRTL, t } = useI18n();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const full = accounts.length >= maxAccounts;

  const onSwitch = async (id: string) => {
    if (id === user?.id || busyId) return;
    setBusyId(id);
    try {
      await leave();
      await switchAccount(id);
      toast.success(t.accountSwitched || "Switched account");
      router.replace("/(tabs)/home");
    } catch {
      // Iter-122 — no "session expired" warning; quietly drop the stale entry.
      try { await removeSavedAccount(id); } catch {}
    } finally { setBusyId(null); }
  };

  const onAdd = async () => {
    if (full) { toast.error(t.accountsMaxReached || "Maximum 5 accounts per device"); return; }
    await leave();
    await addAccount();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="accounts-screen">
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t.switchAccount || "Switch Account"}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl, gap: spacing.md }}>
        <Text style={[styles.hint, { textAlign: isRTL ? "right" : "left" }]}>
          {(t.accountsHint || "Saved accounts on this device") + ` (${accounts.length}/${maxAccounts})`}
        </Text>
        <View style={styles.section}>
          {accounts.map((a) => {
            const active = a.id === user?.id;
            return (
              <Pressable
                key={a.id}
                testID={`account-row-${a.id}`}
                onPress={() => onSwitch(a.id)}
                style={[styles.row, { flexDirection: "row" }, active && styles.rowActive]}
              >
                {a.avatar_url ? (
                  <Image source={a.avatar_url} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Icon name="person" size={22} color={colors.muted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.name, { textAlign: isRTL ? "right" : "left" }]}>{a.nickname || a.username || "—"}</Text>
                  {!!a.numeric_id && (
                    <Text style={[styles.sub, { textAlign: isRTL ? "right" : "left" }]}>ID: {a.numeric_id}</Text>
                  )}
                </View>
                {busyId === a.id ? (
                  <ActivityIndicator color={colors.gold} />
                ) : active ? (
                  <View style={styles.badge} testID="account-current-badge">
                    <Text style={styles.badgeText}>{t.currentAccount || "Current"}</Text>
                  </View>
                ) : (
                  <Pressable testID={`account-remove-${a.id}`} hitSlop={10} onPress={() => setRemoveId(a.id)} style={styles.removeBtn}>
                    <Icon name="close" size={18} color={colors.muted} />
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          testID="add-account-button"
          onPress={onAdd}
          style={[styles.addBtn, { flexDirection: "row" }, full && { opacity: 0.5 }]}
        >
          <Icon name="add-circle" size={20} color={colors.gold} />
          <Text style={styles.addText}>{t.addAccount || "Add Account"}</Text>
        </Pressable>
        {full && (
          <Text style={[styles.hint, { textAlign: "center" }]}>{t.accountsMaxReached || "Maximum 5 accounts per device"}</Text>
        )}
      </ScrollView>

      <ConfirmModal
        visible={!!removeId}
        title={t.removeAccountTitle || "Remove account?"}
        body={t.removeAccountBody || "This account will be signed out and removed from this device."}
        primaryLabel={t.remove || "Remove"}
        secondaryLabel={t.cancel || "Cancel"}
        primaryTone="danger"
        onPrimary={async () => { const id = removeId; setRemoveId(null); if (id) await removeSavedAccount(id); }}
        onSecondary={() => setRemoveId(null)}
        onDismiss={() => setRemoveId(null)}
        testID="remove-account-modal"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, fontWeight: "600", paddingHorizontal: spacing.sm },
  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: "hidden" },
  row: { alignItems: "center", gap: spacing.md, padding: spacing.md, borderBottomWidth: 0.5, borderBottomColor: colors.border, minHeight: 72 },
  rowActive: { backgroundColor: colors.surface },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.gold },
  badgeText: { color: colors.gold, fontSize: 11, fontWeight: "800" },
  removeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  addBtn: { justifyContent: "center", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.gold, minHeight: 48 },
  addText: { color: colors.gold, fontWeight: "800" },
});
