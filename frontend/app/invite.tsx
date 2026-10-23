import { View, Text, StyleSheet, Pressable, Share, ActivityIndicator, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { TextInput } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { apiReferralStatus, apiReferralRedeem } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { FoluCoin } from "@/src/components/FoluCoin";
import { Diamond } from "@/src/components/Diamond";

export default function Invite() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL, t } = useI18n();
  const [copied, setCopied] = useState(false);
  const { data: ref, isLoading } = useQuery({ queryKey: ["referral"], queryFn: apiReferralStatus });
  const qc = useQueryClient();
  const toast = useToast();
  const [codeIn, setCodeIn] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const ar = isRTL;
  const redeem = async () => {
    if (!codeIn.trim() || redeeming) return;
    setRedeeming(true);
    try {
      await apiReferralRedeem(codeIn.trim());
      toast.success(ar ? "تم استخدام الرمز بنجاح" : "Code redeemed");
      setCodeIn("");
      qc.invalidateQueries({ queryKey: ["referral"] });
    } catch (e: any) {
      toast.error(e?.message || (ar ? "تعذر استخدام الرمز" : "Could not redeem code"));
    } finally { setRedeeming(false); }
  };
  const expiresAt = ref?.redeem_expires_at ? new Date(ref.redeem_expires_at) : null;
  const hoursLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 3_600_000)) : 0;
  const statusText = ref?.status === "redeemed"
    ? (ar ? `تم استخدام رمز الدعوة: ${ref.redeemed_code}` : `Referral code used: ${ref.redeemed_code}`)
    : ref?.status === "expired"
      ? (ar ? "انتهت مهلة 24 ساعة لاستخدام رمز دعوة" : "The 24-hour window to enter a code has expired")
      : (ar ? `يمكنك إدخال رمز صديق خلال ${hoursLeft} ساعة` : `You can enter a friend's code within ${hoursLeft}h`);

  const copy = async () => {
    if (ref?.code) {
      await Clipboard.setStringAsync(ref.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const share = async () => {
    try {
      await Share.share({ message: t.inviteShareMessage(ref?.code ?? "", ref?.reward_per_referral ?? 0) });
    } catch {}
  };

  return (
    <View style={styles.container} testID="invite-screen">
      <LinearGradient colors={[colors.purple, colors.purpleDeep, colors.surface]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color="#FFF" />
        </Pressable>
        <Text style={styles.title}>{t.inviteFriendsTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Icon name="gift" size={80} color={colors.gold} />
        <Text style={styles.heroTitle}>{t.earnDiamondsTitle}</Text>
        <Text style={styles.heroSub}>{t.shareYourCodeSub}</Text>

        {isLoading ? (
          <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>{t.yourCodeLabel}</Text>
              <Text style={styles.code} testID="referral-code">{ref?.code}</Text>
            </View>

            <View style={styles.rewardCard}>
              <Diamond size={20} />
              <Text style={styles.rewardText}>{t.diamondsPerReferral(ref?.reward_per_referral ?? 0)}</Text>
            </View>

            <View style={styles.redeemCard} testID="referral-redeem-card">
              <Text style={styles.codeLabel}>{ar ? "أدخل رمز دعوة صديق" : "ENTER A FRIEND'S CODE"}</Text>
              {ref?.can_redeem ? (
                <View style={[styles.redeemRow, { flexDirection: "row" }]}>
                  <TextInput
                    testID="referral-code-input"
                    value={codeIn}
                    onChangeText={(v) => setCodeIn(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))}
                    placeholder={ar ? "الرمز" : "Code"}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    style={styles.redeemInput}
                  />
                  <Pressable testID="referral-redeem-btn" onPress={redeem} disabled={!codeIn || redeeming} style={[styles.redeemBtn, (!codeIn || redeeming) && { opacity: 0.5 }]}>
                    {redeeming ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.actText}>{ar ? "تأكيد" : "Redeem"}</Text>}
                  </Pressable>
                </View>
              ) : null}
              <Text style={styles.redeemStatus} testID="referral-status">{statusText}</Text>
            </View>

            <Text style={styles.stat} testID="referral-count">{t.friendsInvited(ref?.referrals_count ?? 0)}</Text>

            <View style={styles.actions}>
              <Pressable testID="copy-btn" onPress={copy} style={styles.actBtn}>
                <Icon name={copied ? "checkmark" : "copy"} size={18} color={colors.onBrandPrimary} />
                <Text style={styles.actText}>{copied ? t.copiedToast : t.copyLabel}</Text>
              </Pressable>
              <Pressable testID="share-btn" onPress={share} style={[styles.actBtn, { backgroundColor: colors.purple }]}>
                <Icon name="share-social" size={18} color="#FFF" />
                <Text style={[styles.actText, { color: "#FFF" }]}>{t.shareLabel}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: "#FFF", fontSize: 18, fontWeight: "800" },
  body: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
  heroTitle: { color: "#FFF", fontSize: 26, fontWeight: "900", marginTop: spacing.md },
  heroSub: { color: "rgba(255,255,255,0.7)", fontSize: 14, textAlign: "center" },
  codeCard: { marginTop: spacing.xl, alignSelf: "stretch", backgroundColor: "rgba(0,0,0,0.5)", padding: spacing.xl, borderRadius: radius.lg, alignItems: "center", borderWidth: 1, borderColor: colors.gold },
  codeLabel: { color: colors.muted, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  code: { color: colors.gold, fontSize: 42, fontWeight: "900", letterSpacing: 4, marginTop: 8, fontFamily: "monospace" },
  rewardCard: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill },
  rewardText: { color: "#FFF", fontWeight: "700" },
  stat: { color: colors.muted, fontSize: 13, marginTop: spacing.md },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg, alignSelf: "stretch" },
  actBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold, height: 50, borderRadius: radius.pill },
  actText: { color: colors.onBrandPrimary, fontWeight: "800" },
  redeemCard: { alignSelf: "stretch", backgroundColor: "rgba(0,0,0,0.5)", padding: spacing.md, borderRadius: radius.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  redeemRow: { gap: spacing.sm, alignItems: "center" },
  redeemInput: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, fontWeight: "800", letterSpacing: 2 },
  redeemBtn: { height: 46, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  redeemStatus: { color: colors.muted, fontSize: 12, textAlign: "center" },
});
