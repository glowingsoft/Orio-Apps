import { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSupportMessages, apiSupportSend } from "@/src/api";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";

export default function Support() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t, lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const { data } = useQuery({
    queryKey: ["support-messages"],
    queryFn: apiSupportMessages,
    refetchInterval: 10000,
  });
  const items = data?.items ?? [];
  // Iter-98 — VIP4+ only (server-enforced; UI reflects the server flag).
  const canSend = data ? !!data.can_send : false;

  const send = useMutation({
    mutationFn: (txt: string) => apiSupportSend(txt),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["support-messages"] });
      qc.invalidateQueries({ queryKey: ["inbox-overview"] });
    },
  });

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    send.mutate(trimmed);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="support-screen">
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.title}>{t.supportTeam}</Text>
          <Text style={styles.subtitle}>{t.supportTeamSub}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <FlatList
          data={items}
          inverted={items.length > 0}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          renderItem={({ item }) => (
            <View
              testID={`support-msg-${item.id}`}
              style={[
                styles.bubble,
                item.from_support ? styles.bubbleSupport : styles.bubbleMe,
              ]}
            >
              <Text style={[styles.bubbleText, item.from_support && { color: colors.onSurface }]}>
                {item.text}
              </Text>
              <Text style={styles.bubbleTime}>{new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
          )}
          ListEmptyComponent={() => (
            <View style={styles.emptyWrap}>
              <Icon name="headset-outline" size={56} color={colors.muted} />
              <Text style={styles.emptyText}>{t.supportTeamSub}</Text>
            </View>
          )}
        />

        {data && !canSend ? (
          <View style={[styles.restricted, { paddingBottom: insets.bottom + spacing.md }]} testID="support-restricted">
            <Icon name="lock-closed" size={18} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.restrictedTitle}>{ar ? "الدردشة مع الدعم مقيدة" : "Support chat is restricted"}</Text>
              <Text style={styles.restrictedSub}>
                {ar ? `متاحة فقط لأعضاء VIP${data.min_vip} وما فوق.` : `Only available to VIP${data.min_vip} members and above.`}
              </Text>
            </View>
            <Pressable testID="support-upgrade" onPress={() => router.push("/vip" as any)} style={styles.upgradeBtn}>
              <Text style={styles.upgradeText}>{ar ? "ترقية" : "Upgrade"}</Text>
            </Pressable>
          </View>
        ) : (
        <View style={[styles.inputRow, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput
            testID="support-input"
            value={text}
            onChangeText={setText}
            placeholder={t.typeMessagePh}
            placeholderTextColor={colors.muted}
            style={[styles.input, { textAlign: isRTL ? "right" : "left" }]}
            onSubmitEditing={submit}
            multiline
          />
          <Pressable
            testID="support-send"
            onPress={submit}
            disabled={send.isPending || !text.trim()}
            style={({ pressed }) => [styles.sendBtn, (pressed || send.isPending) && { opacity: 0.6 }, !text.trim() && { opacity: 0.4 }]}
          >
            <Icon name="send" size={18} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  bubble: { maxWidth: "78%", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMe: { alignSelf: "flex-end", backgroundColor: colors.brandPrimary },
  bubbleSupport: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  bubbleText: { color: colors.onBrandPrimary, fontSize: 14, lineHeight: 20 },
  bubbleTime: { color: colors.muted, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  emptyWrap: { alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.surfaceSecondary,
    color: colors.onSurface,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  restricted: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  restrictedTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  restrictedSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  upgradeBtn: { backgroundColor: colors.gold, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8, minHeight: 36, justifyContent: "center" },
  upgradeText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12 },
});
