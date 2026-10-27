/**
 * Batch B — Permanent account deletion policy page.
 * Settings → Delete Account. Final confirmation starts a 72h window; logging
 * in again inside the window cancels it (handled server-side).
 */
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/auth-context";
import { useToast } from "@/src/components/Toast";
import { ConfirmModal } from "@/src/components/ConfirmModal";
import { apiRequestAccountDeletion } from "@/src/api";
import { colors, spacing, radius } from "@/src/theme";

type Section = { title: string; body: string[] };
type Policy = {
  title: string; intro: string; whatHappens: string; sections: Section[];
  reqTitle: string; reqIntro: string; reqs: string[];
  warnTitle: string; warn: string; question: string;
  cancel: string; cont: string;
  confirmTitle: string; confirmBody: string; confirmYes: string; confirmNo: string;
  done: string;
};

const AR: Policy = {
  title: "حذف الحساب نهائيًا",
  intro: "يرجى قراءة المعلومات التالية بعناية قبل تقديم طلب حذف حسابك.",
  whatHappens: "ماذا يحدث عند حذف حسابك؟",
  sections: [
    { title: "1. إيقاف الوصول إلى الحساب", body: ["بعد اكتمال عملية الحذف، لن تتمكن من تسجيل الدخول إلى حسابك السابق أو استعادة بياناته."] },
    { title: "2. إزالة الحساب والبيانات", body: ["سيتم حذف ملفك الشخصي ومعلومات حسابك والارتباطات الاجتماعية الخاصة به بشكل نهائي، وفقًا لسياسة الخصوصية ومتطلبات الاحتفاظ القانونية. ولن يتمكن المستخدمون الآخرون من زيارة ملفك المحذوف أو التواصل معك من خلاله."] },
    { title: "3. تحرير وسائل تسجيل الدخول", body: [
      "بعد اكتمال الحذف، سيتم إلغاء ربط رقم هاتفك وبريدك الإلكتروني ووسائل تسجيل الدخول المرتبطة بالحساب، حيثما ينطبق ذلك.",
      "يمكنك إنشاء حساب جديد لاحقًا، مع مراعاة القيود الأمنية المعتمدة في يازين، ومنها إمكانية فرض فترة انتظار تصل إلى 3 أيام قبل إعادة استخدام وسيلة التسجيل نفسها.",
    ] },
    { title: "4. الألماس والعملات والمكافآت", body: [
      "لن يتم نقل الألماس أو العملات أو المزايا الافتراضية المتبقية إلى أي حساب جديد. ويُرجى استخدام الأرصدة غير القابلة للاسترداد قبل إتمام الحذف.",
      "أما الأرباح المالية المستحقة، فيجب تسويتها وفق شروط السحب المعتمدة قبل إغلاق الحساب.",
    ] },
    { title: "5. مهلة مراجعة القرار", body: [
      "بعد إرسال طلب الحذف، يدخل حسابك في فترة انتظار مدتها 72 ساعة.",
      "يمكنك إلغاء طلب الحذف من خلال تسجيل الدخول مجددًا خلال هذه الفترة. وإذا انتهت المهلة دون إلغاء الطلب، تبدأ إجراءات الحذف النهائي.",
    ] },
  ],
  reqTitle: "متطلبات إغلاق الحساب",
  reqIntro: "قبل تأكيد طلبك، يرجى التأكد من:",
  reqs: [
    "تسوية الأرباح المالية القابلة للسحب.",
    "عدم وجود معاملات مالية معلّقة تتطلب المعالجة.",
    "الاطلاع على مصير الألماس والعملات والمزايا المتبقية.",
    "فهم أن الحساب المحذوف لا يمكن استعادته بعد اكتمال الحذف.",
  ],
  warnTitle: "تنبيه مهم",
  warn: "حذف الحساب إجراء نهائي. بعد اكتماله، لن تتمكن من استرجاع هويتك السابقة داخل يازين أو مستوياتك أو المزايا المرتبطة بحسابك.",
  question: "هل أنت متأكد من رغبتك في المتابعة؟",
  cancel: "إلغاء والعودة",
  cont: "متابعة حذف الحساب",
  confirmTitle: "تأكيد حذف الحساب",
  confirmBody: "سيتم تسجيل خروجك وبدء مهلة 72 ساعة. لإلغاء الطلب، سجّل الدخول مجددًا خلال هذه المدة. بعد انتهائها سيُحذف الحساب نهائيًا.",
  confirmYes: "تأكيد الحذف",
  confirmNo: "إلغاء",
  done: "تم استلام طلب حذف الحساب. يمكنك إلغاؤه بتسجيل الدخول خلال 72 ساعة",
};

const EN: Policy = {
  title: "Permanently Delete Account",
  intro: "Please read the following information carefully before submitting your account deletion request.",
  whatHappens: "What happens when you delete your account?",
  sections: [
    { title: "1. Account access is stopped", body: ["Once the deletion is complete, you will no longer be able to sign in to your previous account or recover its data."] },
    { title: "2. Account and data removal", body: ["Your profile, account information, and its social connections will be permanently deleted, in accordance with the Privacy Policy and legal retention requirements. Other users will no longer be able to visit your deleted profile or contact you through it."] },
    { title: "3. Release of sign-in methods", body: [
      "Once the deletion is complete, your phone number, email address, and the sign-in methods linked to the account will be unlinked, where applicable.",
      "You may create a new account later, subject to Yazeen's security restrictions, which may include a waiting period of up to 3 days before the same sign-in method can be reused.",
    ] },
    { title: "4. Diamonds, coins and rewards", body: [
      "Remaining diamonds, coins, and virtual benefits will not be transferred to any new account. Please use any non-refundable balances before the deletion is completed.",
      "Any financial earnings due must be settled according to the approved withdrawal terms before the account is closed.",
    ] },
    { title: "5. Decision review period", body: [
      "After you submit the deletion request, your account enters a 72-hour waiting period.",
      "You can cancel the deletion request by signing in again during this period. If the period ends without the request being cancelled, the permanent deletion process begins.",
    ] },
  ],
  reqTitle: "Account closure requirements",
  reqIntro: "Before confirming your request, please make sure that:",
  reqs: [
    "Withdrawable financial earnings have been settled.",
    "There are no pending financial transactions that require processing.",
    "You understand what happens to your remaining diamonds, coins, and benefits.",
    "You understand that a deleted account cannot be recovered once the deletion is complete.",
  ],
  warnTitle: "Important notice",
  warn: "Deleting your account is a permanent action. Once it is complete, you will not be able to recover your previous identity within Yazeen, your levels, or the benefits linked to your account.",
  question: "Are you sure you want to continue?",
  cancel: "Cancel and Return",
  cont: "Continue Account Deletion",
  confirmTitle: "Confirm account deletion",
  confirmBody: "You will be signed out and a 72-hour period will begin. To cancel, simply sign in again within this period. After it ends, the account is permanently deleted.",
  confirmYes: "Confirm Deletion",
  confirmNo: "Cancel",
  done: "Deletion request received. Sign in within 72 hours to cancel it",
};

export default function DeleteAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isRTL } = useI18n();
  const { signOut } = useAuth();
  const toast = useToast();
  const p = isRTL ? AR : EN;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dir = { writingDirection: isRTL ? "rtl" : "ltr", textAlign: isRTL ? "right" : "left" } as const;

  const onConfirm = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      await apiRequestAccountDeletion();
      toast.info(p.done, 4000);
      await signOut();
    } catch (e: any) {
      toast.error(e?.message || (isRTL ? "تعذر إرسال الطلب" : "Could not submit the request"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { flexDirection: "row" }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="delete-account-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{p.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} testID="delete-account-scroll">
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Icon name="trash-outline" size={26} color={colors.error} /></View>
          <Text style={[styles.intro, { textAlign: "center" }]}>{p.intro}</Text>
        </View>

        <Text style={[styles.h2, dir]}>{p.whatHappens}</Text>
        {p.sections.map((s) => (
          <View key={s.title} style={styles.card}>
            <Text style={[styles.h3, dir]}>{s.title}</Text>
            {s.body.map((b, i) => <Text key={i} style={[styles.body, dir]}>{b}</Text>)}
          </View>
        ))}

        <Text style={[styles.h2, dir]}>{p.reqTitle}</Text>
        <View style={styles.card}>
          <Text style={[styles.body, dir]}>{p.reqIntro}</Text>
          {p.reqs.map((r) => (
            <View key={r} style={[styles.reqRow, { flexDirection: "row" }]}>
              <Icon name="checkmark-circle-outline" size={16} color={colors.brandPrimary} />
              <Text style={[styles.body, styles.reqText, dir]}>{r}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, styles.warnCard]}>
          <View style={[{ flexDirection: "row", alignItems: "center", gap: 6 }]}>
            <Icon name="warning-outline" size={16} color={colors.error} />
            <Text style={[styles.h3, { color: colors.error, marginBottom: 0 }]}>{p.warnTitle}</Text>
          </View>
          <Text style={[styles.body, dir, { marginTop: 6 }]}>{p.warn}</Text>
        </View>

        <Text style={[styles.question, { textAlign: "center" }]}>{p.question}</Text>

        <Pressable style={styles.cancelBtn} onPress={() => router.back()} testID="delete-account-cancel">
          <Text style={styles.cancelText}>{p.cancel}</Text>
        </Pressable>
        <Pressable
          style={[styles.dangerBtn, busy && { opacity: 0.6 }]}
          onPress={() => setConfirmOpen(true)}
          disabled={busy}
          testID="delete-account-continue"
        >
          {busy ? <ActivityIndicator color={colors.onError} /> : <Text style={styles.dangerText}>{p.cont}</Text>}
        </Pressable>
        <View style={{ height: insets.bottom + spacing.lg }} />
      </ScrollView>

      <ConfirmModal
        visible={confirmOpen}
        title={p.confirmTitle}
        body={p.confirmBody}
        primaryLabel={p.confirmYes}
        secondaryLabel={p.confirmNo}
        primaryTone="danger"
        onPrimary={onConfirm}
        onSecondary={() => setConfirmOpen(false)}
        testID="delete-account-confirm-modal"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  hero: { alignItems: "center", marginVertical: spacing.md },
  heroIcon: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: colors.error + "14",
    alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
  },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  h2: { color: colors.onSurface, fontSize: 15, fontWeight: "800", marginTop: spacing.md, marginBottom: spacing.sm },
  h3: { color: colors.onSurface, fontSize: 14, fontWeight: "700", marginBottom: 6 },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  warnCard: { borderColor: colors.error + "55", backgroundColor: colors.error + "0D", marginTop: spacing.sm },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 4 },
  reqRow: { alignItems: "flex-start", gap: 8, marginTop: 6 },
  reqText: { flex: 1, marginBottom: 0 },
  question: { color: colors.onSurface, fontSize: 15, fontWeight: "800", marginVertical: spacing.lg },
  cancelBtn: {
    height: 50, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  cancelText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  dangerBtn: {
    height: 50, borderRadius: radius.pill, backgroundColor: colors.error,
    alignItems: "center", justifyContent: "center", marginTop: spacing.sm,
  },
  dangerText: { color: colors.onError, fontSize: 15, fontWeight: "800" },
});
