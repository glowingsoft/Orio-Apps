import { useEffect, useState } from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Modal } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/auth-context";
import { useI18n } from "@/src/i18n";
import { useToast } from "@/src/components/Toast";
import { spacing, radius, colors } from "@/src/theme";

// Uploaded ORIO O logo (official identity)
const LOGO_URL = "https://customer-assets-jai6qajn.emergentagent.net/job_audio-community-9/artifacts/sfgy7e9a_file_00000000bb1c81f5a0ea217fa46f828f.png";

// Extract a Facebook access_token from an OAuth redirect URL (implicit flow).
function extractFbAccessToken(url: string | null | undefined): string | null {
  if (!url) return null;
  // Facebook returns ...#access_token=XYZ or ...?access_token=XYZ depending on flow.
  const m = url.match(/[?#&]access_token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function Login() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, signInWithGoogle, signInWithFacebook, signInWithApple, providers } = useAuth();
  const { lang, setLang, isRTL, t } = useI18n();
  const toast = useToast();
  const [mode, setMode] = useState<"email" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [fbLoading, setFbLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [langOpen, setLangOpen] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!email || !password) { setErr(t.fillAll); return; }
    setLoading(true);
    try { await signIn(email.trim(), password); }
    catch (e: any) { setErr(e.message || "Login failed"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const onApple = async () => {
    setErr(null);
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) throw new Error(t.appleFailed);
      const fullName = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(" ") || null;
      await signInWithApple(cred.identityToken, fullName, cred.email);
    } catch (e: any) {
      if (e?.code === "ERR_REQUEST_CANCELED") return;
      toast.error(e?.message || t.appleFailed);
    }
  };

  const onGoogle = async () => {
    setErr(null);
    setGoogleLoading(true);
    try { await signInWithGoogle(); }
    catch (e: any) {
      setErr(e?.message || t.googleFailed);
    } finally { setGoogleLoading(false); }
  };

  const onPhone = () => {
    if (!providers.phone) {
      toast.error(t.phoneNotConfigured);
      return;
    }
    router.push("/(auth)/phone");
  };

  const onFacebook = async () => {
    setErr(null);
    if (!providers.facebook) {
      toast.error(t.fbNotConfigured);
      return;
    }
    setFbLoading(true);
    try {
      // Hard-coded FB App ID is NOT in the frontend bundle: we fetch an authorize
      // URL from the backend to avoid leaking the app id in web source maps and
      // to allow swapping the id without a frontend redeploy.
      const base = (process.env.EXPO_PUBLIC_BACKEND_URL ?? "") + "/api";
      // Request the FB authorize URL from backend; backend returns the configured
      // app_id or 503 if credentials are missing.
      const providersResp = await fetch(`${base}/auth/providers`).then((r) => r.json());
      if (!providersResp?.facebook) {
        throw new Error(t.fbNotConfigured);
      }
      // Build the Facebook OAuth URL using the (public) app_id delivered via providers.
      // We ask backend for the public app_id in a dedicated call so we never hardcode.
      const fbCfg = await fetch(`${base}/auth/facebook/public-config`).then((r) => r.ok ? r.json() : null).catch(() => null);
      const appId = fbCfg?.app_id;
      if (!appId) throw new Error(t.fbNotConfigured);

      const redirect = Platform.OS === "web"
        // @ts-ignore
        ? (typeof window !== "undefined" ? window.location.origin + "/" : "")
        : Linking.createURL("fb-auth");
      const state = Math.random().toString(36).slice(2, 12);
      const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${encodeURIComponent(appId)}` +
        `&redirect_uri=${encodeURIComponent(redirect)}` +
        `&response_type=token` +
        `&scope=${encodeURIComponent("public_profile,email")}` +
        `&state=${state}`;

      let userAt: string | null = null;
      if (Platform.OS === "web") {
        // Fallback: full-page redirect so the fragment lands back on this origin.
        // @ts-ignore
        window.location.href = authUrl;
        return;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
        if (result?.type === "cancel" || result?.type === "dismiss") {
          toast.info(t.fbCancelled);
          return;
        }
        userAt = extractFbAccessToken((result as any)?.url);
      }
      if (!userAt) throw new Error(t.fbFailed);
      await signInWithFacebook(userAt);
    } catch (e: any) {
      const msg = e?.message || t.fbFailed;
      setErr(msg);
      toast.error(msg);
    } finally {
      setFbLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Near-black background with subtle hidden purple glow */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]} />
      <LinearGradient
        colors={["rgba(139,92,246,0.10)", "rgba(139,92,246,0.03)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
        style={[StyleSheet.absoluteFill, { opacity: 0.9 }]}
      />
      <LinearGradient
        colors={["rgba(255,255,255,0)", "rgba(107,33,168,0.05)", "rgba(255,255,255,0)"]}
        start={{ x: 1, y: 1 }} end={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.bottomGlow} pointerEvents="none" />

      {/* Language selector: absolute end-aligned (auto flips in RTL) */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="lang-btn" onPress={() => setLangOpen(true)} style={styles.langBtn}>
          <Icon name="globe-outline" size={16} color={colors.onSurface} />
          <Text style={styles.langBtnText}>{t.language}</Text>
          <Icon name="chevron-down" size={14} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 90, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.xl }} keyboardShouldPersistTaps="handled">

          {/* Upper ORIO O logo (slightly smaller than before) */}
          <View style={{ alignItems: "center", marginBottom: spacing.md }}>
            <View style={styles.logoContainer}>
              <View style={styles.logoInnerGlow} pointerEvents="none" />
              <Image source={LOGO_URL} style={styles.logoImg} contentFit="contain" />
            </View>
            {/* ORIO wordmark — LARGER than the O logo */}
            <Text style={styles.wordmark} accessibilityRole="header">ORIO</Text>
            <Text style={styles.tagline}>{t.tagline}</Text>
          </View>

          {mode === "email" ? (
            <View style={{ writingDirection: isRTL ? "rtl" : "ltr" }}>
              <TextInput testID="login-email-input" value={email} onChangeText={setEmail} placeholder={t.email} placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" style={[styles.input, { textAlign: isRTL ? "right" : "left" }]} />
              <View style={styles.pwdWrap}>
                <TextInput testID="login-password-input" value={password} onChangeText={setPassword} placeholder={t.password} placeholderTextColor={colors.muted} secureTextEntry={!showPwd} autoCapitalize="none" autoCorrect={false} style={[styles.input, { marginBottom: 0, textAlign: isRTL ? "right" : "left", paddingRight: isRTL ? spacing.lg : 48, paddingLeft: isRTL ? 48 : spacing.lg }]} />
                <Pressable testID="login-toggle-password" onPress={() => setShowPwd((v) => !v)} hitSlop={10} style={[styles.eye, isRTL ? { left: 14 } : { right: 14 }]}>
                  <Icon name={showPwd ? "eye-off-outline" : "eye-outline"} size={22} color={colors.muted} />
                </Pressable>
              </View>
              {err && <Text testID="login-error" style={styles.err}>{err}</Text>}
              <Pressable testID="login-submit-button" onPress={submit} disabled={loading} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}>
                {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>{t.continue}</Text>}
              </Pressable>
              <Pressable onPress={() => setMode(null)} style={{ marginTop: spacing.md, alignItems: "center" }}>
                <Text style={{ color: colors.brandPrimary, fontSize: 13, fontWeight: "700" }}>{t.otherOptions}</Text>
              </Pressable>
              <Link href="/(auth)/register" asChild>
                <Pressable testID="go-to-register" style={{ marginTop: spacing.md, alignItems: "center" }}>
                  <Text style={{ color: colors.onSurfaceSecondary }}>{t.newHere} <Text style={{ color: colors.brandPrimary, fontWeight: "800" }}>{t.createAccount}</Text></Text>
                </Pressable>
              </Link>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {/* 1. Continue with Google — white, most prominent */}
              <Provider
                testID="btn-google"
                bg="#FFFFFF"
                fg="#111"
                iconName="logo-google"
                iconColor="#EA4335"
                label={t.continueGoogle}
                loading={googleLoading}
                onPress={onGoogle}
                isRTL={isRTL}
              />
              {/* 1b. Sign in with Apple — native button, iOS only */}
              {appleAvailable && providers.apple !== false && (
                <AppleAuthentication.AppleAuthenticationButton
                  testID="btn-apple"
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={28}
                  style={styles.appleBtn}
                  onPress={onApple}
                />
              )}
              {/* 2. Continue with Email — dark translucent */}
              <Provider
                testID="btn-email"
                bg={colors.surfaceSecondary}
                fg={colors.onSurface}
                bordered
                iconName="mail"
                iconColor={colors.onSurface}
                label={t.email}
                onPress={() => setMode("email")}
                isRTL={isRTL}
              />
              {/* 3. Continue with Phone — dark translucent */}
              <Provider
                testID="btn-phone"
                bg={colors.surfaceSecondary}
                fg={colors.onSurface}
                bordered
                iconName="phone-portrait"
                iconColor={colors.onSurface}
                label={t.continuePhone}
                onPress={onPhone}
                isRTL={isRTL}
                dimmed={!providers.phone}
              />
              {/* 4. Continue with Facebook — official blue */}
              <Provider
                testID="btn-facebook"
                bg="#1877F2"
                fg="#FFFFFF"
                iconName="logo-facebook"
                iconColor="#FFFFFF"
                label={t.continueFacebook}
                loading={fbLoading}
                onPress={onFacebook}
                isRTL={isRTL}
                dimmed={!providers.facebook}
              />
              {err && <Text testID="login-error" style={styles.err}>{err}</Text>}
            </View>
          )}

          <Text style={styles.legal}>
            {t.termsPre}
            {"\n"}
            <Text style={styles.legalLink}>{t.termsLink}</Text> {t.andLink} <Text style={styles.legalLink}>{t.privacyLink}</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={langOpen} transparent animationType="fade" onRequestClose={() => setLangOpen(false)}>
        <Pressable onPress={() => setLangOpen(false)} style={styles.modalBg}>
          <Pressable onPress={() => {}} style={styles.langModal}>
            <Text style={styles.langModalTitle}>{t.chooseLanguage}</Text>
            {[{ id: "en" as const, label: "English" }, { id: "ar" as const, label: "العربية" }].map((l) => (
              <Pressable key={l.id} testID={`lang-${l.id}`} onPress={async () => { await setLang(l.id); setLangOpen(false); }} style={[styles.langOpt, lang === l.id && styles.langOptActive]}>
                <Text style={[styles.langOptText, lang === l.id && { color: "#FFF" }]}>{l.label}</Text>
                {lang === l.id && <Icon name="checkmark-circle" size={20} color="#8B5CF6" />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Provider({ bg, fg, iconName, iconColor, label, onPress, bordered, testID, loading, isRTL, dimmed }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={loading} style={({ pressed }) => [
      {
        height: 56,
        backgroundColor: bg,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 10,
        borderWidth: bordered ? 1 : 0,
        borderColor: colors.border,
        opacity: dimmed ? 0.55 : 1,
      },
      pressed && { opacity: 0.85 },
    ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          <Icon name={iconName} size={20} color={iconColor || fg} />
          <Text style={{ color: fg, fontWeight: "800", fontSize: 15, letterSpacing: 0.3 }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  bottomGlow: {
    position: "absolute", left: -60, right: -60, bottom: -120, height: 320,
    backgroundColor: "rgba(107,33,168,0.06)", borderRadius: 999, opacity: 0.7,
  },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg, zIndex: 10 },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  langBtnText: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  logoContainer: {
    width: 140, height: 140, borderRadius: 28, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(20,10,40,0.55)",
    borderWidth: 1, borderColor: "rgba(139,92,246,0.28)",
    shadowColor: "#8B5CF6", shadowOpacity: 0.55, shadowRadius: 26, shadowOffset: { width: 0, height: 0 },
  },
  logoInnerGlow: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(139,92,246,0.06)",
  },
  logoImg: { width: 140, height: 140 },
  wordmark: {
    color: colors.onSurface, fontSize: 48, fontWeight: "900", letterSpacing: 4,
    marginTop: spacing.sm,
    textShadowColor: "rgba(139,92,246,0.55)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  tagline: { color: colors.muted, fontSize: 13, marginTop: 6, letterSpacing: 0.3, fontWeight: "600", textAlign: "center", opacity: 0.9 },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: "rgba(139,92,246,0.35)", color: colors.onSurface, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 54, fontSize: 16, marginBottom: spacing.md },
  pwdWrap: { marginBottom: spacing.md, justifyContent: "center" },
  eye: { position: "absolute", height: 54, justifyContent: "center" },
  appleBtn: { height: 56, width: "100%" },
  err: { color: "#FF6B6B", marginTop: 4, marginBottom: 4, textAlign: "center", fontSize: 13 },
  primaryBtn: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, height: 54, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 16 },
  orRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: spacing.md },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  socialRow: { flexDirection: "row", justifyContent: "center", gap: 14, marginTop: 4 },
  socialBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  legal: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: spacing.xl, lineHeight: 18 },
  legalLink: { color: colors.brandPrimary },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  langModal: { backgroundColor: "#0F0725", borderRadius: radius.lg, padding: spacing.lg, width: "100%", maxWidth: 320, borderWidth: 1, borderColor: "rgba(139,92,246,0.3)" },
  langModalTitle: { color: "#FFF", fontSize: 18, fontWeight: "800", marginBottom: spacing.md, textAlign: "center" },
  langOpt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md, marginTop: 6 },
  langOptActive: { backgroundColor: "rgba(139,92,246,0.15)", borderWidth: 1, borderColor: "#8B5CF6" },
  langOptText: { color: "#B8A4E8", fontSize: 15, fontWeight: "700" },
});
