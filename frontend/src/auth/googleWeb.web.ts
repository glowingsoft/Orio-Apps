/**
 * Google Sign-In for the web build, via Firebase Authentication.
 *
 * Flow: Google popup → Firebase user → Firebase ID token → our backend
 * (/auth/google/firebase) verifies it and returns the normal ORIO session.
 *
 * Firebase is only a one-shot token source here: auth state is kept in memory
 * and cleared right after the ID token is read, so no Firebase refresh token is
 * written to browser storage. The ORIO session handles restore and sign-out.
 *
 * Native builds resolve ./googleWeb.ts instead and never load Firebase.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";

export class GoogleSignInError extends Error {
  code: "cancelled" | "popup_blocked" | "network" | "not_configured" | "unauthorized_domain" | "failed";
  constructor(code: GoogleSignInError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export function isGoogleWebConfigured(): boolean {
  return !!(config.apiKey && config.authDomain && config.projectId && config.appId);
}

let auth: Auth | null = null;
function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
  auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  return auth;
}

let inFlight: Promise<string> | null = null;

/** Opens the Google popup and resolves with a Firebase ID token. Concurrent calls share one popup. */
export function getGoogleIdTokenWeb(): Promise<string> {
  if (!isGoogleWebConfigured()) {
    return Promise.reject(new GoogleSignInError("not_configured", "Google sign-in is not configured"));
  }
  if (!inFlight) {
    inFlight = (async () => {
      const a = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const cred = await signInWithPopup(a, provider);
        return await cred.user.getIdToken();
      } catch (e: any) {
        const code = String(e?.code || "");
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled") {
          throw new GoogleSignInError("cancelled", "Sign-in cancelled");
        }
        if (code === "auth/popup-blocked") {
          throw new GoogleSignInError("popup_blocked", "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.");
        }
        if (code === "auth/network-request-failed") {
          throw new GoogleSignInError("network", "Network error. Check your connection and try again.");
        }
        if (code === "auth/unauthorized-domain") {
          throw new GoogleSignInError("unauthorized_domain", "Google sign-in is not enabled for this website yet.");
        }
        throw new GoogleSignInError("failed", "Google sign-in failed");
      } finally {
        // Firebase state is only needed to read the token; drop it straight away.
        signOut(a).catch(() => {});
      }
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
}
