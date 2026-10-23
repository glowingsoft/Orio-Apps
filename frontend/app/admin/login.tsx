/**
 * Iter-87 — Admin Dashboard login (Owner Google flow fully isolated).
 *
 * Access model:
 *   • Owner  — "Continue with Google" launches the Emergent Google OAuth with
 *              a redirect back to /admin/login. On return we exchange the
 *              session_id via a DEDICATED admin endpoint which only accepts
 *              the configured owner email. The Owner is NEVER routed through
 *              normal ORIO onboarding.
 *   • Admin  — approved email + enabled flag; may sign in via any supported
 *              method (email/password). Server authorises every request.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  useWindowDimensions, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/ionicons";
import { useAuth } from "@/src/auth-context";
import { apiMe, apiAdminGoogleExchange } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

const EMERGENT_AUTH_URL = "https://auth.emergentagent.com/";
const SESSION_ID_RE = /[?#&]session_id=([^&#]+)/;

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(SESSION_ID_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function AdminLogin() {
  const { signIn, user, loading, refresh } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ forbidden?: string }>();
  const { width } = useWindowDimensions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.forbidden ? "You are signed in but not authorised to access the admin dashboard." : null
  );
  const [hidePwd, setHidePwd] = useState(true);
  const processedSid = useRef<string | null>(null);

  // Auto-redirect ONLY when user already has verified admin access.
  useEffect(() => {
    if (!loading && user?.admin_access && !submitting && !googleBusy) {
      router.replace("/admin");
    }
  }, [user, loading, submitting, googleBusy, router]);

  // Iter-87 — Dedicated handler for the Google OAuth callback on /admin/login.
  // Only the configured Owner email is accepted; anyone else gets a clear
  // "not the Owner" error AND is NOT given a normal ORIO session.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      // @ts-ignore
      const href: string = typeof window !== "undefined" ? window.location.href : "";
      const sid = extractSessionId(href);
      if (!sid || processedSid.current === sid) return;
      processedSid.current = sid;

      // Clean the URL immediately so a refresh doesn't retry an expired session.
      try {
        // @ts-ignore
        const u = new URL(window.location.href);
        u.hash = u.hash.replace(SESSION_ID_RE, "");
        u.searchParams.delete("session_id");
        // @ts-ignore
        window.history.replaceState(window.history.state, "", u.toString());
      } catch {}

      setGoogleBusy(true);
      setError(null);
      (async () => {
        try {
          await apiAdminGoogleExchange(sid);
          await refresh();
          const fresh = await apiMe();
          if (fresh?.admin_access?.is_owner) {
            router.replace("/admin");
          } else {
            setError("Owner authorisation failed. Try again.");
          }
        } catch (e: any) {
          const msg = e?.message || "Google sign-in failed";
          setError(msg);
        } finally {
          setGoogleBusy(false);
        }
      })();
    } catch {}
    // We only want this to run on mount; the processedSid guard dedupes anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAndRedirect = async (): Promise<void> => {
    const fresh = await apiMe();
    if (fresh?.admin_access) {
      router.replace("/admin");
    } else {
      setError(
        "This account is not authorised to access the admin dashboard. " +
        "The Owner must sign in with the configured Google email, and " +
        "Admins must be explicitly approved by the Owner."
      );
    }
  };

  const onSubmit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter email and password");
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      await checkAndRedirect();
    } catch (e: any) {
      setError(e?.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Iter-87 — Admin Google OAuth: redirect back to /admin/login (NOT to /).
  // This ensures our dedicated callback handler owns the exchange and the
  // Owner never passes through the normal AuthProvider's generic processor.
  const onGoogle = () => {
    setError(null);
    if (Platform.OS !== "web") {
      // On native, in-app browser Google sign-in flow is more involved; the
      // admin dashboard is web-first per product spec. Direct the user to
      // open the dashboard in a browser.
      setError("Owner Google sign-in is available on the web admin dashboard.");
      return;
    }
    try {
      // @ts-ignore
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const redirect = `${origin}/admin/login`;
      const url = `${EMERGENT_AUTH_URL}?redirect=${encodeURIComponent(redirect)}`;
      setGoogleBusy(true);
      // @ts-ignore
      window.location.href = url;
    } catch (e: any) {
      setGoogleBusy(false);
      setError(e?.message || "Could not start Google sign-in");
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.card, { maxWidth: Math.min(440, width - 32) }]}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>ORIO Admin</Text>
        </View>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.subtitle}>
          Owner & approved administrators only. Access is enforced server-side.
        </Text>

        {/* OWNER — Google only, dedicated flow */}
        <View style={styles.sectionLabelWrap}>
          <Text style={styles.sectionLabel}>Owner</Text>
          <View style={styles.sectionLine} />
        </View>
        <Pressable
          onPress={onGoogle}
          disabled={submitting || googleBusy || loading}
          style={({ pressed }) => [styles.googleBtn, (googleBusy || pressed) && { opacity: 0.9 }]}
          testID="admin-google"
        >
          {googleBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name="logo-google" size={18} color="#fff" />
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.ownerHint}>
          The Owner must sign in using the configured Google account.
        </Text>

        {/* ADMIN TEAM — email/password */}
        <View style={styles.sectionLabelWrap}>
          <Text style={styles.sectionLabel}>Admin team member</Text>
          <View style={styles.sectionLine} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@company.com"
            placeholderTextColor={colors.muted}
            style={styles.input}
            testID="admin-email"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.pwdWrap}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={hidePwd}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              style={[styles.input, { flex: 1 }]}
              onSubmitEditing={onSubmit}
              testID="admin-password"
            />
            <Pressable onPress={() => setHidePwd((h) => !h)} style={styles.eyeBtn}>
              <Icon name={hidePwd ? "eye-outline" : "eye-off-outline"} size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={onSubmit}
          disabled={submitting || googleBusy || loading}
          style={({ pressed }) => [styles.submit, (submitting || pressed) && { opacity: 0.85 }]}
          testID="admin-submit"
        >
          {submitting ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.submitText}>Sign in with email</Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.replace("/(tabs)/home" as any)} style={{ marginTop: spacing.lg, alignSelf: "center" }}>
          <Text style={styles.ghostLink}>← Back to app</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  brandDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    shadowColor: colors.purpleGlow, shadowOpacity: 0.7, shadowRadius: 14,
  },
  brandText: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "700" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4, marginBottom: spacing.lg },
  sectionLabelWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  sectionLabel: {
    color: colors.purple, fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
    fontWeight: "700",
  },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.border },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: "#4285F4",
    borderRadius: radius.md, paddingVertical: 14,
  },
  googleText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  ownerHint: { color: colors.muted, fontSize: 11, marginTop: 6, textAlign: "center" },
  field: { marginBottom: spacing.md },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    color: colors.onSurface, fontSize: 15,
  } as any,
  pwdWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eyeBtn: { padding: 8 },
  error: {
    color: colors.error, fontSize: 13, marginTop: 8, marginBottom: 4,
    backgroundColor: colors.surfaceTertiary, padding: spacing.sm, borderRadius: radius.sm,
    borderLeftWidth: 3, borderLeftColor: colors.error,
  },
  submit: {
    marginTop: spacing.sm,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: colors.purpleGlow, shadowOpacity: 0.4, shadowRadius: 10,
  },
  submitText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: 15 },
  ghostLink: { color: colors.onSurfaceSecondary, fontSize: 13 },
});
