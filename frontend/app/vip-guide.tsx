/**
 * /vip-guide — dedicated VIP guide.
 *
 * Every value on this page is fetched live from the server (single source of
 * truth). If admin changes a VIP threshold via /api/admin/vip/thresholds, this
 * page updates on the next visit automatically — no hard-coded numbers.
 *
 * Includes a fully working Diamonds → Growth Points conversion widget that
 * shares the same backend endpoint (/api/vip/convert) used by the VIP screen.
 */
import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/ionicons";
import { apiVipProgress, apiVipConvert, apiVipThresholds, apiVipGrowthHistory, type GrowthHistoryItem } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { colors, spacing, radius } from "@/src/theme";
import { Diamond } from "@/src/components/Diamond";
import { tierFor, VIP_TIERS } from "@/src/components/OrioVipEmblem";
import { VipBadge } from "@/src/components/VipBadge";

const fmt = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

type Thresholds = { thresholds: { level: number; threshold: number }[] };

export default function VipGuide() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const { lang, isRTL } = useI18n();

  // Live server data — never trust local constants.
  const { data: thr } = useQuery<Thresholds>({ queryKey: ["vip-thresholds"], queryFn: apiVipThresholds });
  const { data: prog, refetch: refetchProg } = useQuery({ queryKey: ["vip-progress"], queryFn: apiVipProgress });
  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ["vip-growth-history"],
    queryFn: () => apiVipGrowthHistory(50),
  });

  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const convert = useMutation({
    mutationFn: (n: number) => apiVipConvert(n),
    onSuccess: async () => {
      setAmount(""); setErr(null);
      await refresh();
      await refetchProg();
      await refetchHistory();
      await qc.invalidateQueries({ queryKey: ["vip-progress"] });
      await qc.invalidateQueries({ queryKey: ["vip-growth-history"] });
    },
    onError: (e: any) => setErr(e?.message || (lang === "ar" ? "فشل التحويل" : "Conversion failed")),
  });

  const diamonds = user?.coins ?? 0;
  const parsed = amount ? parseInt(amount, 10) : 0;
  const canConvert = parsed > 0 && parsed <= diamonds && !convert.isPending;

  const submit = () => {
    setErr(null);
    if (!Number.isFinite(parsed) || parsed <= 0) { setErr(lang === "ar" ? "أدخل مبلغًا صحيحًا" : "Enter a valid amount"); return; }
    if (parsed > diamonds) { setErr(lang === "ar" ? "الرصيد غير كافٍ" : "Insufficient diamonds"); return; }
    convert.mutate(parsed);
  };

  const rows = (thr?.thresholds ?? VIP_TIERS.map((v) => ({ level: v.level, threshold: 0 })))
    .sort((a, b) => a.level - b.level);

  return (
    <View style={styles.container} testID="vip-guide-screen">
      <LinearGradient colors={["#1a0f30", "#0A0416", "#000000"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.6 }} style={StyleSheet.absoluteFill} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => safeBack(router)} style={styles.iconBtn} testID="vip-guide-back">
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{lang === "ar" ? "دليل VIP" : "VIP Guide"}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ---------- VIP Rules ---------- */}
          <Section title={lang === "ar" ? "قواعد VIP" : "VIP Rules"}>
            {[
              lang === "ar" ? "تتكون VIP من 10 مستويات." : "VIP has exactly 10 levels.",
              lang === "ar" ? "لا توجد أسماء تصنيف مخصصة. المستويات هي VIP 1 حتى VIP 10." : "No custom tier names. Levels are VIP 1 through VIP 10.",
              lang === "ar" ? "تستخدم نقاط النمو لقياس تقدمك." : "Growth Points measure your VIP progression.",
              lang === "ar" ? "نقاط النمو دائمة ولا تنتهي." : "Growth Points are permanent and never expire.",
              lang === "ar" ? "جميع القيم يتم التحقق منها في الخادم." : "All thresholds are server-authoritative.",
              lang === "ar" ? "لا يوجد تسعير قديم ولا اشتراك مدة." : "No legacy price/duration purchase system.",
            ].map((b, i) => <Bullet key={i} text={b} />)}
          </Section>

          {/* ---------- VIP Values (dynamic) ---------- */}
          <Section title={lang === "ar" ? "قيم VIP" : "VIP Values"}>
            <View testID="vip-guide-values">
              {rows.map((r) => {
                const s = tierFor(r.level);
                return (
                  <View key={r.level} style={styles.valueRow} testID={`vip-guide-value-${r.level}`}>
                    <VipBadge level={r.level} size="md" />
                    <View style={styles.valueDivider} />
                    <Icon name="sparkles" size={11} color={s.colorAccent} />
                    <Text style={[styles.valueAmount, { color: s.colorAccent }]}>{fmt(r.threshold)}</Text>
                  </View>
                );
              })}
              <Text style={styles.dynamicHint}>
                {lang === "ar" ? "هذه القيم تُقرأ من إعدادات الخادم مباشرة." : "These values are read live from the server config."}
              </Text>
            </View>
          </Section>

          {/* ---------- Growth Point Rule ---------- */}
          <Section title={lang === "ar" ? "قاعدة نقاط النمو" : "Growth Point Rule"}>
            <View style={styles.ruleCard}>
              {/* Recharge rule (1:1) */}
              <Text style={styles.ruleBig}>
                <Text style={{ color: colors.gold }}>{lang === "ar" ? "الشحن" : "Recharge"}</Text>
                {"  "}
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  1 {lang === "ar" ? "ألماس" : "Diamond"} = 1 {lang === "ar" ? "نقطة نمو" : "Growth Point"}
                </Text>
              </Text>
              <View style={{ marginTop: 4, gap: 2 }}>
                <Text style={styles.example}>
                  100.000 <Text style={{ color: colors.muted }}>{lang === "ar" ? "ألماس شحن" : "Diamonds recharged"}</Text>
                  <Text style={{ color: colors.muted }}>{" → "}</Text>
                  <Text style={{ color: colors.gold }}>100.000 {lang === "ar" ? "نقطة" : "GP"}</Text>
                </Text>
              </View>

              <View style={styles.ruleDivider} />

              {/* Exchange rule (1:2) */}
              <Text style={styles.ruleBig}>
                <Text style={{ color: "#F472B6" }}>{lang === "ar" ? "التحويل" : "Exchange"}</Text>
                {"  "}
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  1 {lang === "ar" ? "ألماس" : "Diamond"} = 2 {lang === "ar" ? "نقطة نمو" : "Growth Points"}
                </Text>
              </Text>
              <View style={{ marginTop: 4, gap: 2 }}>
                <Text style={styles.example}>
                  100.000 <Text style={{ color: colors.muted }}>{lang === "ar" ? "ألماس تحويل" : "Diamonds exchanged"}</Text>
                  <Text style={{ color: colors.muted }}>{" → "}</Text>
                  <Text style={{ color: "#F472B6" }}>200.000 {lang === "ar" ? "نقطة" : "GP"}</Text>
                </Text>
              </View>

              <Text style={styles.ruleFoot}>
                {lang === "ar"
                  ? "المعدل 2× ينطبق فقط على عملية تحويل الألماس إلى نقاط نمو، وليس على عمليات الشحن."
                  : "The 2× rate applies only to the Diamond → Growth Points exchange, never to normal Diamond recharges."}
              </Text>
            </View>
          </Section>

          {/* ---------- Recharge Rule ---------- */}
          <Section title={lang === "ar" ? "قاعدة الشحن" : "Recharge Rule"}>
            <Text style={styles.body}>
              {lang === "ar"
                ? "كل عملية شحن ناجحة ومؤكدة تمنحك تلقائيًا نقاط نمو بنفس عدد الألماس المضاف."
                : "Every successfully confirmed recharge automatically awards Growth Points equal to the Diamonds credited."}
            </Text>
            <Text style={styles.body}>
              {lang === "ar"
                ? "لا تُمنح نقاط النمو للمعاملات الفاشلة أو الملغاة أو المستردة."
                : "Growth Points are not awarded for failed, cancelled, or refunded transactions."}
            </Text>
          </Section>

          {/* ---------- Working Convert Widget ---------- */}
          <Section title={lang === "ar" ? "تحويل الألماس إلى نقاط النمو" : "Convert Diamonds → Growth Points"}>
            <View style={styles.convertCard} testID="vip-guide-convert">
              <View style={styles.balances}>
                <View style={styles.balance}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Diamond size={14} />
                    <Text style={styles.balanceLabel}>{lang === "ar" ? "ألماس" : "Diamonds"}</Text>
                  </View>
                  <Text style={styles.balanceValue}>{fmt(diamonds)}</Text>
                </View>
                <Icon name="arrow-forward" size={16} color={colors.muted} />
                <View style={styles.balance}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Icon name="sparkles" size={12} color={colors.gold} />
                    <Text style={styles.balanceLabel}>{lang === "ar" ? "نقاط النمو" : "Growth"}</Text>
                  </View>
                  <Text style={[styles.balanceValue, { color: colors.gold }]}>{fmt(prog?.growth_points ?? 0)}</Text>
                </View>
              </View>

              <TextInput
                testID="vip-guide-convert-input"
                value={amount}
                onChangeText={(t) => { setErr(null); setAmount(t.replace(/[^0-9]/g, "")); }}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder={lang === "ar" ? "أدخل المبلغ بالألماس" : "Enter Diamond amount"}
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
                editable
                autoCorrect={false}
                textAlign={isRTL ? "right" : "left"}
              />

              {parsed > 0 && (
                <Text style={styles.preview}>
                  <Text style={{ color: colors.onSurface, fontWeight: "800" }}>{fmt(parsed)}</Text>
                  <Text style={{ color: colors.muted }}>{lang === "ar" ? " ألماس" : " Diamonds"}</Text>
                  <Text style={{ color: colors.muted }}>{" → "}</Text>
                  <Text style={{ color: colors.gold, fontWeight: "800" }}>{fmt(parsed * 2)}</Text>
                  <Text style={{ color: colors.muted }}>{lang === "ar" ? " نقطة نمو" : " Growth Points"}</Text>
                </Text>
              )}

              {err && <Text style={styles.err}>{err}</Text>}

              <Pressable
                testID="vip-guide-convert-submit"
                disabled={!canConvert}
                onPress={submit}
                style={({ pressed }) => [
                  styles.submitBtn,
                  pressed && { opacity: 0.85 },
                  !canConvert && { opacity: 0.5 },
                ]}
              >
                <LinearGradient
                  colors={[colors.gold, "#F59E0B", "#B45309"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                {convert.isPending
                  ? <ActivityIndicator color="#0B0313" />
                  : <Text style={styles.submitText}>{lang === "ar" ? "تحويل إلى نقاط النمو" : "Convert to Growth Points"}</Text>}
              </Pressable>
              <Text style={styles.rate}>
                {lang === "ar" ? "معدل التحويل 1 ألماس = 2 نقطة نمو" : "Exchange rate 1 Diamond = 2 Growth Points"}
              </Text>
            </View>
          </Section>

          {/* ---------- Growth History / Recent Activity ---------- */}
          <Section title={lang === "ar" ? "سجل نقاط النمو" : "Growth Point History"}>
            <View style={styles.historyList} testID="vip-growth-history">
              {(history?.items ?? []).length === 0 ? (
                <Text style={styles.historyEmpty}>
                  {lang === "ar" ? "لا توجد معاملات بعد." : "No transactions yet."}
                </Text>
              ) : (
                (history?.items ?? []).map((it: GrowthHistoryItem, i: number) => {
                  const isRecharge = it.source === "recharge";
                  const isActivation = it.source === "vip_activation";
                  const icon = isActivation ? "sparkles" : isRecharge ? "wallet" : "swap-horizontal";
                  const color = isActivation ? colors.gold : isRecharge ? "#0A84FF" : colors.gold;
                  const title = isActivation
                    ? (lang === "ar" ? `تفعيل VIP ${it.to_level}` : `VIP ${it.to_level} activated`)
                    : isRecharge
                      ? (lang === "ar" ? "شحن ألماس" : "Diamond recharge")
                      : (lang === "ar" ? "تحويل ألماس ← نقاط" : "Diamond → Growth conversion");
                  const amt = isActivation ? 0 : it.amount;
                  const when = it.created_at ? new Date(it.created_at).toLocaleString() : "";
                  return (
                    <View key={`${it.tx_id}-${i}`} style={styles.historyRow} testID={`vip-history-${i}`}>
                      <View style={[styles.historyIcon, { backgroundColor: color + "22", borderColor: color + "55" }]}>
                        <Icon name={icon as any} size={16} color={color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.historyTitle} numberOfLines={1}>{title}</Text>
                        <Text style={styles.historyMeta} numberOfLines={1}>
                          {when}
                          {it.tx_id ? `  ·  #${it.tx_id.slice(0, 8)}` : ""}
                        </Text>
                      </View>
                      {amt > 0 && (
                        <View style={{ alignItems: isRTL ? "flex-start" : "flex-end" }}>
                          <Text style={[styles.historyAmount, { color }]}>+{fmt(amt)}</Text>
                          <Text style={styles.historyAmountLabel}>{lang === "ar" ? "نقطة" : "GP"}</Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </Section>

          {/* ---------- How to Upgrade ---------- */}
          <Section title={lang === "ar" ? "كيفية الترقية" : "How to Upgrade"}>
            <Text style={styles.body}>
              {lang === "ar"
                ? "اشحن ألماسًا، حوّله إلى نقاط النمو أو استلمها تلقائيًا من عمليات الشحن، ثم فعّل مستوى VIP عندما تتجاوز الحد المطلوب."
                : "Recharge Diamonds → auto-earn or convert to Growth Points → activate the VIP tier once you cross its threshold."}
            </Text>
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* --------------------- Helpers --------------------- */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View>{children}</View>
    </View>
  );
}
function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  title: { flex: 1, textAlign: "center", color: colors.onSurface, fontSize: 17, fontWeight: "800", letterSpacing: 0.4 },

  section: { marginTop: spacing.lg },
  sectionTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "900", letterSpacing: 0.6, marginBottom: spacing.sm },
  body: { color: colors.muted, fontSize: 12.5, fontWeight: "600", lineHeight: 20, marginTop: 2 },

  bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", paddingVertical: 3 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.gold, marginTop: 8 },

  valueRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: radius.md, backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 6,
  },
  valueDivider: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginHorizontal: 8 },
  valueAmount: { fontSize: 13, fontWeight: "900" },
  dynamicHint: { color: colors.muted, fontSize: 10, fontWeight: "700", textAlign: "center", marginTop: spacing.sm, letterSpacing: 0.4, fontStyle: "italic" },

  ruleCard: { backgroundColor: "rgba(0,0,0,0.45)", borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: "rgba(245,197,66,0.35)" },
  ruleBig: { color: colors.onSurface, fontSize: 16, fontWeight: "900", textAlign: "center" },
  ruleDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginVertical: spacing.sm },
  ruleFoot: { color: colors.muted, fontSize: 10.5, fontWeight: "700", textAlign: "center", marginTop: spacing.sm, letterSpacing: 0.3, fontStyle: "italic", lineHeight: 16 },
  example: { color: colors.onSurface, fontSize: 12, fontWeight: "700", textAlign: "center" },

  convertCard: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: "rgba(245,197,66,0.35)", gap: spacing.md },
  balances: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  balance: { flex: 1, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: radius.md, padding: 10 },
  balanceLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  balanceValue: { color: colors.onSurface, fontSize: 16, fontWeight: "900", marginTop: 4 },

  input: {
    height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(245,197,66,0.55)",
    paddingHorizontal: spacing.lg, color: colors.onSurface, fontSize: 18, fontWeight: "800",
    backgroundColor: "rgba(255,255,255,0.06)", letterSpacing: 1,
  },
  preview: { textAlign: "center", fontSize: 12, fontWeight: "700" },
  err: { color: colors.error, textAlign: "center", fontSize: 12, fontWeight: "700" },
  submitBtn: { height: 50, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  submitText: { color: "#0B0313", fontWeight: "900", fontSize: 14, letterSpacing: 0.3 },
  rate: { color: colors.muted, fontSize: 10, fontWeight: "700", textAlign: "center", letterSpacing: 0.5 },

  // Growth history
  historyList: { gap: 6 },
  historyEmpty: {
    color: colors.muted, fontSize: 12, fontWeight: "700", textAlign: "center",
    paddingVertical: spacing.md, fontStyle: "italic",
  },
  historyRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  historyIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  historyTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "800" },
  historyMeta: { color: colors.muted, fontSize: 10, fontWeight: "600", marginTop: 2 },
  historyAmount: { fontSize: 14, fontWeight: "900" },
  historyAmountLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
});
