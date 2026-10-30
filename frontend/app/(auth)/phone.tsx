import { CountryFlag } from "@/src/components/CountryFlag";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Modal, FlatList,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { safeBack } from "@/src/navigation/safeBack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { colors, radius, spacing } from "@/src/theme";
import { COUNTRIES, type Country } from "@/src/utils/country-codes";

type Step = "phone" | "otp";

// Keep local E.164 normalization in sync with the backend. The server will
// reject non-E.164 input anyway, this is just to catch obvious mistakes early.
function normalizeE164(dial: string, raw: string): string | null {
  const digitsOnly = (raw || "").replace(/\D/g, "");
  if (!digitsOnly) return null;
  // Strip a leading 0 (common for local-dial numbers).
  const national = digitsOnly.replace(/^0+/, "");
  if (!national) return null;
  const full = `${dial}${national}`.replace(/[^\d+]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(full)) return null;
  return full;
}

export default function PhoneAuth() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const toast = useToast();
  const { signInWithPhoneSendOtp, signInWithPhoneVerify, providers } = useAuth();

  const [step, setStep] = useState<Step>("phone");
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [phoneLocal, setPhoneLocal] = useState("");
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const normalized = useMemo(() => normalizeE164(country.dial, phoneLocal), [country.dial, phoneLocal]);

  // Countdown timer for resend.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const filteredCountries = useMemo(() => {
    if (!filter.trim()) return COUNTRIES;
    const q = filter.trim().toLowerCase();
    return COUNTRIES.filter((c) =>
      c.name.toLowerCase().includes(q) || c.dial.includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [filter]);

  const sendCode = async () => {
    if (!providers.phone) {
      toast.error(t.phoneNotConfigured);
      return;
    }
    if (!normalized) {
      toast.error("Please enter a valid phone number");
      return;
    }
    setSending(true);
    try {
      const r = await signInWithPhoneSendOtp(normalized);
      toast.success(t.otpSentTo(normalized));
      setResendIn(r.resend_cooldown_seconds || 30);
      setStep("otp");
    } catch (e: any) {
      const msg = e?.message || "Failed to send code";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (!normalized) return;
    if (otp.replace(/\D/g, "").length < 4) {
      toast.error("Enter the full code");
      return;
    }
    setVerifying(true);
    try {
      await signInWithPhoneVerify(normalized, otp.trim());
      // On success, AuthGate will route to profile-completion or home.
    } catch (e: any) {
      const msg = e?.message || t.otpInvalid;
      toast.error(msg);
    } finally {
      setVerifying(false);
    }
  };

  const otpInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (step === "otp") {
      const id = setTimeout(() => otpInputRef.current?.focus(), 200);
      return () => clearTimeout(id);
    }
  }, [step]);

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#000000", "#050014", "#000000"]} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={["rgba(139,92,246,0.18)", "rgba(139,92,246,0.06)", "rgba(0,0,0,0)"]}
        start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
        style={[StyleSheet.absoluteFill, { opacity: 0.9 }]}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          testID="phone-back"
          onPress={() => (step === "otp" ? setStep("phone") : safeBack(router))}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Icon name={isRTL ? "chevron-forward" : "chevron-back"} size={22} color="#FFF" />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 72,
            paddingBottom: insets.bottom + spacing.xl,
            paddingHorizontal: spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>{t.phoneTitle}</Text>
          <Text style={styles.subtitle}>{t.phoneSubtitle}</Text>

          {step === "phone" ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.label}>{t.phoneNumber}</Text>
              <View style={[styles.phoneRow, { flexDirection: "row" }]}>
                <Pressable
                  testID="phone-country"
                  onPress={() => { setFilter(""); setPickerOpen(true); }}
                  style={styles.countryBtn}
                >
                  <CountryFlag code={country.code} flag={country.flag} size={20} />
                  <Text style={styles.countryDial}>{country.dial}</Text>
                  <Icon name="chevron-down" size={14} color="#CDBDFF" />
                </Pressable>
                <TextInput
                  testID="phone-input"
                  value={phoneLocal}
                  onChangeText={(v) => setPhoneLocal(v.replace(/[^\d\s\-]/g, ""))}
                  placeholder="123 456 7890"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  maxLength={18}
                  style={[styles.phoneInput, { textAlign: isRTL ? "right" : "left" }]}
                />
              </View>
              <Text style={styles.hint}>
                {normalized ? normalized : "+country code + number (e.g. +14155550123)"}
              </Text>

              <Pressable
                testID="phone-send-code"
                onPress={sendCode}
                disabled={sending || !normalized || !providers.phone}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (!normalized || !providers.phone) && { opacity: 0.5 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                {sending
                  ? <ActivityIndicator color={colors.onBrandPrimary} />
                  : <Text style={styles.primaryBtnText}>{t.sendCode}</Text>}
              </Pressable>

              {!providers.phone && (
                <Text style={styles.err}>{t.phoneNotConfigured}</Text>
              )}
            </View>
          ) : (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={styles.label}>{t.enterCode}</Text>
              <Text style={styles.hint}>{t.otpSentTo(normalized || "")}</Text>
              <TextInput
                ref={otpInputRef}
                testID="phone-otp-input"
                value={otp}
                onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 10))}
                placeholder="123456"
                placeholderTextColor="rgba(255,255,255,0.4)"
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={10}
                style={[styles.otpInput, { textAlign: "center" }]}
              />

              <Pressable
                testID="phone-verify"
                onPress={verify}
                disabled={verifying || otp.length < 4}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (otp.length < 4) && { opacity: 0.5 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                {verifying
                  ? <ActivityIndicator color={colors.onBrandPrimary} />
                  : <Text style={styles.primaryBtnText}>{t.verifyCode}</Text>}
              </Pressable>

              <View style={{ alignItems: "center", marginTop: spacing.lg, gap: 8 }}>
                <Pressable
                  testID="phone-resend"
                  disabled={resendIn > 0 || sending}
                  onPress={sendCode}
                  style={{ opacity: resendIn > 0 ? 0.55 : 1 }}
                >
                  <Text style={styles.secondaryLink}>
                    {resendIn > 0 ? t.resendIn(resendIn) : t.resendCode}
                  </Text>
                </Pressable>
                <Pressable
                  testID="phone-change"
                  onPress={() => { setOtp(""); setStep("phone"); }}
                >
                  <Text style={styles.secondaryLink}>{t.changePhone}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBg}>
          <Pressable style={{ flex: 1 }} onPress={() => setPickerOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Select country</Text>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Search country or code"
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.sheetSearch}
              autoCorrect={false}
            />
            <FlatList
              data={filteredCountries}
              keyExtractor={(c) => c.code + c.dial}
              style={{ maxHeight: 400 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  testID={`country-${item.code}`}
                  onPress={() => { setCountry(item); setPickerOpen(false); }}
                  style={({ pressed }) => [styles.countryRow, pressed && { opacity: 0.75 }]}
                >
                  <CountryFlag code={item.code} flag={item.flag} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.countryName}>{item.name}</Text>
                  </View>
                  <Text style={styles.countryDial}>{item.dial}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, zIndex: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  title: {
    color: "#FFF", fontSize: 28, fontWeight: "900", letterSpacing: 0.3,
    textShadowColor: "rgba(139,92,246,0.5)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  subtitle: { color: "#CDBDFF", marginTop: 8, fontSize: 14, lineHeight: 20 },

  label: { color: "#B8A4E8", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  phoneRow: {
    alignItems: "center", gap: 10,
  },
  countryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, height: 54,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radius.md,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.35)",
  },
  countryFlag: { fontSize: 20 },
  countryDial: { color: "#FFF", fontWeight: "800", fontSize: 15 },
  phoneInput: {
    flex: 1, height: 54,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(139,92,246,0.35)",
    color: "#FFF", borderRadius: radius.md,
    paddingHorizontal: spacing.lg, fontSize: 16,
  },
  otpInput: {
    height: 64,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(139,92,246,0.45)",
    color: "#FFF", borderRadius: radius.md,
    paddingHorizontal: spacing.lg, fontSize: 24, fontWeight: "800", letterSpacing: 10,
    marginTop: 10,
  },
  hint: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 6, marginBottom: 4 },
  err: { color: "#FF8585", fontSize: 13, textAlign: "center", marginTop: spacing.md },

  primaryBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill,
    height: 54, alignItems: "center", justifyContent: "center",
    shadowColor: "#8B5CF6", shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 16, letterSpacing: 0.3 },
  secondaryLink: { color: "#C4B5FD", fontWeight: "700", fontSize: 14 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#0F0725",
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: spacing.lg, paddingTop: 10,
    borderTopWidth: 1, borderColor: "rgba(139,92,246,0.3)",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginBottom: spacing.md,
  },
  sheetTitle: { color: "#FFF", fontSize: 16, fontWeight: "800", marginBottom: spacing.md },
  sheetSearch: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(139,92,246,0.3)",
    color: "#FFF", borderRadius: radius.md,
    paddingHorizontal: spacing.lg, height: 44, fontSize: 14,
    marginBottom: 10,
  },
  countryRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.05)",
  },
  countryFlagBig: { fontSize: 24 },
  countryName: { color: "#FFF", fontSize: 15, fontWeight: "600" },
});
