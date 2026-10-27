import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { AppState, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import {
  getRefreshToken,
  setRefreshToken,
  listAccounts,
  upsertAccount,
  removeAccount,
  getAccountToken,
  MAX_ACCOUNTS,
  type SavedAccount,
} from "./auth/storage";
import {
  apiAuthProviders,
  apiAppleSignIn,
  apiFacebookExchange,
  /* apiGoogleSession, */ apiGoogleFirebase,
  apiLogin,
  apiLogout,
  apiMe,
  apiPhoneSendOtp,
  apiPhoneVerifyOtp,
  /* apiRegister, */ apiRevokeRefresh,
  setAccessToken,
  tryRefresh,
  type AuthProviders,
} from "./api";
import { queryClient } from "./query-client";
import { getGoogleIdToken, GoogleSignInError } from "./auth/googleSignIn";

WebBrowser.maybeCompleteAuthSession();

type User = any | null;
type Ctx = {
  user: User;
  loading: boolean;
  providers: AuthProviders;
  signIn: (email: string, password: string) => Promise<void>;
  // Email sign-up is disabled: email is login-only.
  // signUp: (email: string, password: string, username: string, nickname: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithPhoneSendOtp: (
    phoneE164: string,
  ) => Promise<{ resend_cooldown_seconds: number }>;
  signInWithPhoneVerify: (
    phoneE164: string,
    code: string,
    nickname?: string,
  ) => Promise<void>;
  signInWithFacebook: (fbAccessToken: string) => Promise<void>;
  signInWithApple: (
    identityToken: string,
    fullName?: string | null,
    email?: string | null,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  // Multi-account (max 5 per device)
  accounts: SavedAccount[];
  maxAccounts: number;
  switchAccount: (id: string) => Promise<void>;
  addAccount: () => Promise<void>;
  removeSavedAccount: (id: string) => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

// Emergent Google auth — disabled, replaced by Firebase Google Sign-In (web).
// const EMERGENT_AUTH_URL = "https://auth.emergentagent.com/";
// const SESSION_ID_RE = /[?#&]session_id=([^&#]+)/;
const FB_ACCESS_TOKEN_RE = /[?#&]access_token=([^&#]+)/;

// function extractSessionId(url: string | null | undefined): string | null {
//   if (!url) return null;
//   const m = url.match(SESSION_ID_RE);
//   return m ? decodeURIComponent(m[1]) : null;
// }

function extractFbAccessToken(url: string | null | undefined): string | null {
  if (!url) return null;
  // Avoid false positives: only parse if the URL contains the fb_oauth marker
  // we set when we build the authorize URL, OR a direct state hint.
  const m = url.match(FB_ACCESS_TOKEN_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

const DEFAULT_PROVIDERS: AuthProviders = {
  google: true,
  email: true,
  phone: false,
  facebook: false,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<AuthProviders>(DEFAULT_PROVIDERS);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const consumedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    listAccounts().then(setAccounts);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const u = await apiMe();
      setUser(u);
      if (u?.id) {
        setAccounts(
          await upsertAccount({
            id: u.id,
            nickname: u.nickname,
            username: u.username,
            avatar_url: u.avatar_url,
            numeric_id: u.numeric_id,
          }),
        );
      }
    } catch (e: any) {
      // Iter-122 — only a genuine auth failure signs the user out; transient
      // network/server errors (phone locked, background, offline) keep the session.
      if (e?.status === 401) setUser(null);
    }
  }, []);

  // Iter-122 — returning from background/lock: silently restore the session if
  // the stored refresh token is still valid (never shows any warning).
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (s) => {
      if (s !== "active") return;
      if (await getRefreshToken()) {
        if (await tryRefresh()) await refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  // Emergent Google session — disabled.
  // const processSessionId = useCallback(async (sid: string | null) => {
  //   if (!sid) return false;
  //   if (consumedRef.current.has(sid)) return false;
  //   consumedRef.current.add(sid);
  //   try {
  //     await apiGoogleSession(sid);
  //     await refresh();
  //     return true;
  //   } catch {
  //     return false;
  //   }
  // }, [refresh]);

  const processFbAccessToken = useCallback(
    async (at: string | null) => {
      if (!at) return false;
      if (consumedRef.current.has("fb:" + at)) return false;
      consumedRef.current.add("fb:" + at);
      try {
        await apiFacebookExchange(at);
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh],
  );

  useEffect(() => {
    // Non-blocking provider probe. If this fails we keep defaults
    // (Google + Email on, Phone + Facebook off).
    apiAuthProviders()
      .then(setProviders)
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      // Iter-87 — If the browser URL path is /admin/*, let the admin login page
      // handle any session_id fragment with the admin-only Google exchange
      // (otherwise the generic handler below would process it with the normal
      // /api/auth/google/session endpoint and bounce the Owner into onboarding).
      let onAdminPath = false;
      if (Platform.OS === "web") {
        try {
          // @ts-ignore
          const p: string =
            typeof window !== "undefined" ? window.location.pathname || "" : "";
          onAdminPath = p.startsWith("/admin");
        } catch {}
      }

      // 1) Web: check hash/search for session_id first (Google) then fb access_token
      if (Platform.OS === "web" && !onAdminPath) {
        try {
          // @ts-ignore
          const href: string =
            typeof window !== "undefined" ? window.location.href : "";
          // Emergent Google session_id return — disabled.
          // const sid = extractSessionId(href);
          // if (sid) {
          //   const ok = await processSessionId(sid);
          //   // clean the URL
          //   try {
          //     // @ts-ignore
          //     const u = new URL(window.location.href);
          //     u.hash = u.hash.replace(SESSION_ID_RE, "");
          //     u.searchParams.delete("session_id");
          //     // @ts-ignore
          //     window.history.replaceState(window.history.state, "", u.toString());
          //   } catch {}
          //   if (ok) { setLoading(false); return; }
          // }
          // Facebook implicit flow returns access_token in URL fragment.
          const fbAt = extractFbAccessToken(href);
          if (fbAt) {
            const ok = await processFbAccessToken(fbAt);
            try {
              // @ts-ignore
              const u = new URL(window.location.href);
              u.hash = "";
              u.searchParams.delete("access_token");
              u.searchParams.delete("state");
              // @ts-ignore
              window.history.replaceState(
                window.history.state,
                "",
                u.toString(),
              );
            } catch {}
            if (ok) {
              setLoading(false);
              return;
            }
          }
        } catch {}
      } else {
        // 2) Native: cold-start deep link
        try {
          const initial = await Linking.getInitialURL();
          // Emergent Google session_id deep link — disabled.
          // const sid = extractSessionId(initial);
          // if (sid && await processSessionId(sid)) { setLoading(false); return; }
          const fbAt = extractFbAccessToken(initial);
          if (fbAt && (await processFbAccessToken(fbAt))) {
            setLoading(false);
            return;
          }
        } catch {}
      }
      // 3) Fallback: existing refresh token (retry briefly on network errors).
      const rt = await getRefreshToken();
      if (rt) {
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) {
          ok = await tryRefresh();
          if (!ok && !(await getRefreshToken())) break; // genuinely revoked
          if (!ok) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        }
        if (ok) await refresh();
      }
      setLoading(false);
    })();

    // Hot deep link handler (native)
    const sub = Linking.addEventListener("url", ({ url }) => {
      // Emergent Google session_id deep link — disabled.
      // const sid = extractSessionId(url);
      // if (sid) {
      //   processSessionId(sid);
      //   return;
      // }
      const fbAt = extractFbAccessToken(url);
      if (fbAt) processFbAccessToken(fbAt);
    });
    return () => {
      try {
        sub.remove();
      } catch {}
    };
  }, [refresh, processFbAccessToken]);

  const signIn = async (email: string, password: string) => {
    await apiLogin(email, password);
    await refresh();
  };
  // Email sign-up is disabled: email is login-only.
  // const signUp = async (email: string, password: string, username: string, nickname: string) => {
  //   await apiRegister(email, password, username, nickname);
  //   await refresh();
  // };
  const signOut = async () => {
    const id = user?.id;
    try {
      await apiLogout();
    } catch {}
    setAccessToken(null);
    await setRefreshToken(null);
    if (id) setAccounts(await removeAccount(id));
    queryClient.clear();
    setUser(null);
  };

  // Switch the active session to another saved account. If its session has
  // expired, the previous session is restored and the stale entry removed.
  const switchAccount = useCallback(
    async (id: string) => {
      if (user?.id === id) return;
      const rt = await getAccountToken(id);
      const prev = await getRefreshToken();
      let ok = false;
      if (rt) {
        setAccessToken(null);
        await setRefreshToken(rt);
        ok = await tryRefresh();
      }
      if (!ok) {
        if (prev) {
          await setRefreshToken(prev);
          if (await tryRefresh()) await refresh();
        }
        throw new Error("SESSION_EXPIRED");
      }
      queryClient.clear();
      await refresh();
    },
    [user, refresh],
  );

  // Park the current session in the vault and return to the login screen.
  const addAccount = useCallback(async () => {
    if (accounts.length >= MAX_ACCOUNTS) throw new Error("MAX_ACCOUNTS");
    setAccessToken(null);
    await setRefreshToken(null);
    queryClient.clear();
    setUser(null);
  }, [accounts.length]);

  // Remove a saved (non-active) account from this device and revoke its session.
  const removeSavedAccount = useCallback(
    async (id: string) => {
      if (user?.id === id) return;
      const rt = await getAccountToken(id);
      if (rt) await apiRevokeRefresh(rt);
      setAccounts(await removeAccount(id));
    },
    [user],
  );

  // Google Sign-In → Firebase ID token → /auth/google/firebase. Web uses the Firebase
  // popup (googleSignIn.web.ts); Android/iOS use native Google Sign-In (googleSignIn.ts).
  // Cancelling the popup resolves quietly; other failures throw a user-facing message.
  const signInWithGoogle = useCallback(async () => {
    let idToken: string;
    try {
      idToken = await getGoogleIdToken();
    } catch (e: any) {
      if (e instanceof GoogleSignInError && e.code === "cancelled") return;
      throw e;
    }
    await apiGoogleFirebase(idToken);
    await refresh();
  }, [refresh]);

  // Emergent Google auth — disabled.
  // const signInWithGoogle = useCallback(async () => {
  //   const redirect =
  //     Platform.OS === "web"
  //       ? // @ts-ignore
  //         typeof window !== "undefined"
  //         ? window.location.origin + "/"
  //         : ""
  //       : Linking.createURL("");
  //   const authUrl = `${EMERGENT_AUTH_URL}?redirect=${encodeURIComponent(redirect)}`;
  //
  //   if (Platform.OS === "web") {
  //     // Redirect same tab so the session_id fragment lands on our origin.
  //     try {
  //       /* @ts-ignore */ window.location.href = authUrl;
  //     } catch {}
  //     return;
  //   }
  //
  //   const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
  //   // Try to extract session_id from result.url, otherwise it will be caught by the Linking listener
  //   const url = (result as any)?.url as string | undefined;
  //   const sid = extractSessionId(url);
  //   if (sid) {
  //     const ok = await processSessionId(sid);
  //     if (!ok) throw new Error("Google sign-in failed");
  //     return;
  //   }
  //   // No URL — could be a cancel or a delayed deep-link. Give the listener a moment.
  //   await new Promise((r) => setTimeout(r, 400));
  //   if (!user) {
  //     // If still no user, treat as cancelled (silently).
  //     if (result?.type === "cancel" || result?.type === "dismiss") return;
  //     throw new Error("Google sign-in failed");
  //   }
  // }, [processSessionId, user]);

  const signInWithPhoneSendOtp = useCallback(async (phoneE164: string) => {
    const r = await apiPhoneSendOtp(phoneE164);
    return { resend_cooldown_seconds: r.resend_cooldown_seconds || 30 };
  }, []);

  const signInWithPhoneVerify = useCallback(
    async (phoneE164: string, code: string, nickname?: string) => {
      await apiPhoneVerifyOtp(phoneE164, code, nickname);
      await refresh();
    },
    [refresh],
  );

  const signInWithFacebook = useCallback(
    async (fbAccessToken: string) => {
      await apiFacebookExchange(fbAccessToken);
      await refresh();
    },
    [refresh],
  );

  const signInWithApple = useCallback(
    async (
      identityToken: string,
      fullName?: string | null,
      email?: string | null,
    ) => {
      await apiAppleSignIn(identityToken, fullName, email);
      await refresh();
    },
    [refresh],
  );

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        providers,
        signIn /* signUp, */,
        signInWithGoogle,
        signInWithPhoneSendOtp,
        signInWithPhoneVerify,
        signInWithFacebook,
        signInWithApple,
        signOut,
        refresh,
        accounts,
        maxAccounts: MAX_ACCOUNTS,
        switchAccount,
        addAccount,
        removeSavedAccount,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
