
import {
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeAuth,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import { getFirebaseApp, GoogleSignInError, isFirebaseConfigured } from "./firebaseClient";

export { GoogleSignInError };

let auth: Auth | null = null;
function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = initializeAuth(getFirebaseApp(), { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  }
  return auth;
}

let inFlight: Promise<string> | null = null;

/** Opens the Google popup and resolves with a Firebase ID token. Concurrent calls share one popup. */
export function getGoogleIdToken(): Promise<string> {
  if (!isFirebaseConfigured()) {
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
