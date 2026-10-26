// Email sign-up is disabled: email is login-only. The backend /auth/register route is
// commented out as well. Anyone opening this page is sent to the login screen.
import { Redirect } from "expo-router";

export default function Register() {
  return <Redirect href="/(auth)/login" />;
}

// ---- Original sign-up screen (kept for reference) ----
// import { useState } from "react";
// import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
// import { LinearGradient } from "expo-linear-gradient";
// import { Image } from "expo-image";
// import { Link } from "expo-router";
// import { useSafeAreaInsets } from "react-native-safe-area-context";
// import Icon from "@react-native-vector-icons/ionicons";
// import { useAuth } from "@/src/auth-context";
// import { useI18n } from "@/src/i18n";
// import { colors, spacing, radius } from "@/src/theme";
// import { FoluCoin } from "@/src/components/FoluCoin";
// import { Diamond } from "@/src/components/Diamond";
//
// export default function Register() {
//   const insets = useSafeAreaInsets();
//   const { signUp } = useAuth();
//   const { isRTL, t } = useI18n();
//   const [email, setEmail] = useState("");
//   const [username, setUsername] = useState("");
//   const [nickname, setNickname] = useState("");
//   const [password, setPassword] = useState("");
//   const [showPwd, setShowPwd] = useState(false);
//   const [loading, setLoading] = useState(false);
//   const [err, setErr] = useState<string | null>(null);
//
//   const submit = async () => {
//     setErr(null);
//     if (!email || !password || !username || !nickname) { setErr(t.fillAll); return; }
//     if (password.length < 8) { setErr(t.passwordMinError); return; }
//     setLoading(true);
//     try { await signUp(email.trim(), password, username.trim(), nickname.trim()); }
//     catch (e: any) { setErr(e.message || t.registrationFailed); }
//     finally { setLoading(false); }
//   };
//
//   const align: "right" | "left" = isRTL ? "right" : "left";
//
//   return (
//     <View style={{ flex: 1, backgroundColor: colors.surface }}>
//       <Image
//         source="https://images.unsplash.com/photo-1686593686409-43456910d65c?w=800&h=1400&fit=crop"
//         style={StyleSheet.absoluteFill}
//         contentFit="cover"
//       />
//       <LinearGradient colors={["rgba(13,13,13,0.5)", "rgba(13,13,13,0.98)"]} style={StyleSheet.absoluteFill} />
//       <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
//         <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 40, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.xl }} keyboardShouldPersistTaps="handled">
//           <View style={styles.logoRow}>
//             <Diamond size={36} />
//             <Text style={styles.logo}>{t.joinOrio}</Text>
//           </View>
//           <Text style={[styles.subtitle, { textAlign: align }]}>{t.voiceChatPartyGames}</Text>
//
//           <Text style={[styles.label, { textAlign: align }]}>{t.nicknameLabel}</Text>
//           <TextInput testID="register-nickname-input" value={nickname} onChangeText={setNickname} placeholder={t.yourDisplayName} placeholderTextColor={colors.muted} style={[styles.input, { textAlign: align }]} maxLength={30} />
//
//           <Text style={[styles.label, { textAlign: align }]}>{t.usernameLabel}</Text>
//           <TextInput testID="register-username-input" value={username} onChangeText={setUsername} placeholder={t.usernamePh} placeholderTextColor={colors.muted} autoCapitalize="none" style={[styles.input, { textAlign: align }]} maxLength={20} />
//
//           <Text style={[styles.label, { textAlign: align }]}>{t.emailLabel}</Text>
//           <TextInput testID="register-email-input" value={email} onChangeText={setEmail} placeholder={t.emailPh} placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" style={[styles.input, { textAlign: align }]} />
//
//           <Text style={[styles.label, { textAlign: align }]}>{t.passwordLabel}</Text>
//           <View style={styles.pwdWrap}>
//             <TextInput testID="register-password-input" value={password} onChangeText={setPassword} placeholder={t.atLeast8Chars} placeholderTextColor={colors.muted} secureTextEntry={!showPwd} autoCapitalize="none" autoCorrect={false} style={[styles.input, { marginBottom: 0, textAlign: align, paddingRight: isRTL ? spacing.lg : 48, paddingLeft: isRTL ? 48 : spacing.lg }]} />
//             <Pressable testID="register-toggle-password" onPress={() => setShowPwd((v) => !v)} hitSlop={10} style={[styles.eye, isRTL ? { left: 14 } : { right: 14 }]}>
//               <Icon name={showPwd ? "eye-off-outline" : "eye-outline"} size={22} color={colors.muted} />
//             </Pressable>
//           </View>
//
//           {err && <Text testID="register-error" style={styles.err}>{err}</Text>}
//
//           <Pressable testID="register-submit-button" onPress={submit} disabled={loading} style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}>
//             {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>{t.createAccountLabel}</Text>}
//           </Pressable>
//
//           <Link href="/(auth)/login" asChild>
//             <Pressable testID="go-to-login" style={{ marginTop: spacing.lg, alignItems: "center" }}>
//               <Text style={styles.linkText}>{t.haveAccount} <Text style={{ color: colors.gold, fontWeight: "700" }}>{t.signIn}</Text></Text>
//             </Pressable>
//           </Link>
//         </ScrollView>
//       </KeyboardAvoidingView>
//     </View>
//   );
// }
//
// const styles = StyleSheet.create({
//   logoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
//   logo: { fontSize: 28, fontWeight: "900", color: colors.gold },
//   subtitle: { color: "#EBEBF5", fontSize: 13, marginTop: spacing.sm, letterSpacing: 1 },
//   label: { color: colors.muted, fontSize: 13, marginTop: spacing.lg, marginBottom: spacing.sm },
//   input: { backgroundColor: colors.surfaceTertiary, color: colors.onSurface, borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 52, fontSize: 16 },
//   pwdWrap: { justifyContent: "center" },
//   eye: { position: "absolute", height: 52, justifyContent: "center" },
//   err: { color: colors.error, marginTop: spacing.md, textAlign: "center" },
//   cta: { marginTop: spacing.xl, backgroundColor: colors.gold, borderRadius: radius.md, height: 54, alignItems: "center", justifyContent: "center" },
//   ctaText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 17 },
//   linkText: { color: colors.onSurfaceSecondary },
// });
